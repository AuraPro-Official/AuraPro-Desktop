import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path, { join } from 'node:path'
import test from 'node:test'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import {
  classifyStartupFailure,
  dependencySpec,
  lastStartupEvidence,
  makeStartupIssue,
  repairFailingPythonImports,
  startupPackage
} from '../src/main/utils/startup-diagnostics.ts'

test('recognizes the Sherpa Tokenizer failure and allows only the known Python package', () => {
  const trace =
    "File faster_whisper/tokenizer.py\nAttributeError: module 'tokenizers' has no attribute 'Tokenizer'"
  const failure = classifyStartupFailure(trace)
  assert.deepEqual(failure, {
    kind: 'dependency',
    repair: 'dependencies',
    dependency: 'tokenizers'
  })
  assert.equal(dependencySpec(failure.dependency), 'tokenizers==0.22.2')
  assert.equal(makeStartupIssue('sherpa', failure, trace).repairable, true)
  assert.equal(makeStartupIssue('agent', failure, trace).repairable, false)

  const untrusted = "ModuleNotFoundError: No module named 'unknown_publisher'"
  assert.equal(
    makeStartupIssue('webui', classifyStartupFailure(untrusted), untrusted).repairable,
    false
  )
})

test('diagnoses missing faster-whisper, database libraries, and broken Python standard libraries separately', () => {
  for (const [name, expected] of [
    ['faster_whisper', 'faster-whisper==1.2.1'],
    ['sqlalchemy', 'sqlalchemy==2.0.50'],
    ['onnxruntime', process.platform === 'darwin' ? 'onnxruntime==1.23.2' : 'onnxruntime==1.26.0']
  ]) {
    const issue = classifyStartupFailure(`ModuleNotFoundError: No module named '${name}'`)
    assert.equal(dependencySpec(issue.dependency), expected)
  }
  assert.equal(classifyStartupFailure("No module named 'encodings'").kind, 'python')
  assert.equal(classifyStartupFailure("No module named 'pip'").kind, 'installer')
})

test('recognizes Brotli decoder initialization and repairs only allowlisted packages', async () => {
  const message =
    "  DECODER_ERROR_CLASSES += (brotli.error,)\nAttributeError: module 'brotlicffi' has no attribute 'error'"
  const failure = classifyStartupFailure(message)
  assert.equal(failure.dependency, 'brotlicffi')
  assert.equal(dependencySpec(failure.dependency), 'brotlicffi==1.2.1.0')
  assert.equal(makeStartupIssue('sherpa', failure, message).repairable, true)
  assert.equal(
    classifyStartupFailure("ImportError: cannot import name 'error' from 'brotlicffi'").dependency,
    'brotlicffi'
  )
  assert.equal(
    classifyStartupFailure('ImportError: DLL load failed while importing _brotlicffi: broken')
      .dependency,
    'brotlicffi'
  )
  const events = []
  let healthy = false
  await repairFailingPythonImports(
    async () => {
      events.push('import')
      if (!healthy) throw new Error(message)
    },
    async (dependency) => {
      events.push(dependency)
      healthy = true
      return true
    }
  )
  assert.deepEqual(events, ['import', 'brotlicffi', 'import'])
  await assert.rejects(
    repairFailingPythonImports(
      async () => {
        throw new Error("ModuleNotFoundError: No module named 'unknown_module'")
      },
      async () => {
        assert.fail('Must not install an unknown module')
      }
    ),
    /unknown_module/
  )
})

const brotliWebUITrace = [
  '\u250c Traceback (most recent call last) \u2510',
  '\u2502    84 \u2502   if ssl_autogen_dir and (not ssl_keyfile or not ssl_certfile): \u2502',
  '\u2502 >  477 \u2502   DECODER_ERROR_CLASSES += (brotli.error,) \u2502',
  '\u2514\u2500\u2518',
  "AttributeError: module 'brotlicffi' has no attribute 'error'"
].join('\n')

test('classifies the WebUI Rich traceback by its actual exception, not SSL source lines', () => {
  const failure = classifyStartupFailure(brotliWebUITrace)
  assert.deepEqual(failure, {
    kind: 'dependency',
    repair: 'dependencies',
    dependency: 'brotlicffi'
  })
  const issue = makeStartupIssue('webui', failure, brotliWebUITrace)
  assert.equal(issue.repairable, true)
  assert.equal(issue.data.evidence, "AttributeError: module 'brotlicffi' has no attribute 'error'")
  const tls = [
    'Loading local HTTPS settings with --ssl-autogen-dir and SSL_CERTFILE',
    '\u2502 ssl.SSLError: [SSL] PEM lib (_ssl.c:3900) \u2502'
  ].join('\n')
  assert.equal(classifyStartupFailure(tls).kind, 'certificate')
  assert.equal(classifyStartupFailure(tls.split('\n')[0]).kind, 'unknown')
})

const lockedNativePackage = String.raw`error: failed to remove file 'C:\Users\Admin\AppData\Roaming\aurapro\python\Lib\site-packages\81d243bd2c585b0f4821__mypyc.cp312-win_amd64.pyd': 拒绝访问。 (os error 5)`

test('only offers a scoped Sherpa retry for an unattributed Python package file', () => {
  const failure = classifyStartupFailure(lockedNativePackage)
  assert.deepEqual(failure, {
    kind: 'locked',
    repair: 'retry-sherpa-dependencies',
    dependency: undefined
  })
  assert.equal(makeStartupIssue('sherpa', failure, lockedNativePackage).repairable, true)
  assert.equal(makeStartupIssue('webui', failure, lockedNativePackage).repairable, false)
  const outsidePackages = lockedNativePackage.replace('site-packages', 'data')
  assert.equal(classifyStartupFailure(outsidePackages).repair, undefined)
})

const missingMetadata = String.raw`error: failed to open file C:\Admin\aurapro\python\Lib\site-packages\onnxruntime-1.26.0.dist-info\METADATA: 系统找不到指定的文件。 (os error 2)`

test('missing WebUI package metadata recommends a scoped repair', () => {
  const failure = classifyStartupFailure(missingMetadata)
  assert.equal(failure.repair, 'metadata')
  assert.equal(makeStartupIssue('webui', failure, missingMetadata).repairable, true)
  assert.equal(makeStartupIssue('sherpa', failure, missingMetadata).repairable, true)
  assert.equal(
    classifyStartupFailure(`${missingMetadata}\naccess is denied (os error 5)`).kind,
    'locked'
  )
})

test('separates locked Python packages from manual disk, permission, database, and network failures', () => {
  const locked = String.raw`warning: missing RECORD file; Failed to rename file C:\Admin\aurapro\python\Lib\site-packages\charset_normalizer\tmp.pyd: access is denied (os error 5)`
  assert.deepEqual(classifyStartupFailure(locked), {
    kind: 'locked',
    repair: 'dependencies',
    dependency: 'charset_normalizer'
  })
  assert.equal(dependencySpec('charset_normalizer', '3.5.2'), 'charset-normalizer==3.5.2')
  const cases = [
    ['OSError: [Errno 28] No space left on device', 'disk'],
    ['sqlite3.OperationalError: database is locked', 'database'],
    ['[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed', 'certificate'],
    ['HTTP 429 Too Many Requests from https://example.test/?token=secret', 'network'],
    ['PermissionError: [WinError 13] Permission denied', 'permission'],
    ['OSError: [WinError 32] process cannot access file', 'locked'],
    ['Error [WinError 4551]: blocked by Windows application control', 'security'],
    ['[Errno 10048] Address already in use', 'port'],
    ['Error: bad CPU type in executable', 'platform'],
    ['MSVCP140.dll missing', 'native'],
    ['Out of memory', 'memory'],
    ['Prepare the selected Pro model in Desktop settings first', 'model']
  ]
  for (const [trace, kind] of cases) {
    const issue = makeStartupIssue('webui', classifyStartupFailure(trace), trace)
    assert.equal(issue.data.kind, kind, trace)
    assert.equal(issue.repairable, false, trace)
    assert.ok(!issue.data.evidence.includes('secret'), trace)
  }
})

const load = (file, name, values) => {
  const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const declaration = ast.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((node) => node.name.getText(ast) === name)
  const context = createContext(values)
  runInContext(
    ts.transpileModule(`globalThis.run = ${declaration.initializer.getText(ast)}`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 }
    }).outputText,
    context
  )
  return context.run
}

test('Windows refuses to mutate shared Python while the scoped process check reports a user', async () => {
  let platform = 'win32'
  let pids = ''
  let queryError
  let calls = 0
  const check = load('src/main/utils/index.ts', 'assertBundledWindowsPythonIdle', {
    process: {
      get platform() {
        return platform
      },
      env: {}
    },
    path: path.win32,
    fs: { existsSync: () => true },
    getPythonInstallationDir: () => 'C:/AuraPro/python',
    execFile: (exe, args, options, callback) => {
      calls++
      assert.equal(exe, 'powershell.exe')
      assert.match(args.at(-1), /ExecutablePath\.StartsWith\(\$root/)
      assert.equal(options.env.AURAPRO_PYTHON_CHECK_ROOT, 'C:\\AuraPro\\python\\')
      callback(queryError, pids)
    }
  })
  await check()
  pids = '123\n456'
  await assert.rejects(check(), /PID: 123, 456/)
  queryError = new Error('CIM query failed')
  await assert.rejects(check(), /Could not verify/)
  platform = 'linux'
  await check()
  assert.equal(calls, 3)
})

test(
  'bundled Python import probe detects a partial Brotli module but tolerates its absence',
  {
    skip: !process.env.AURAPRO_TEST_PYTHON
  },
  () => {
    const imports = load('src/main/utils/index.ts', 'brotliStartupImports', {})
    const result = spawnSync(
      process.env.AURAPRO_TEST_PYTHON,
      [
        '-IBS',
        '-c',
        `
import sys, tempfile
from pathlib import Path
with tempfile.TemporaryDirectory() as folder:
    root = Path(folder)
    (root / "urllib3.py").write_text("class PoolManager: pass")
    sys.path.insert(0, folder)
    exec(sys.argv[1])
    (root / "brotlicffi").mkdir()
    exec(sys.argv[1])
`,
        imports.join('\n')
      ],
      { encoding: 'utf8' }
    )
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /cannot import name 'error' from 'brotlicffi'/)
    assert.equal(classifyStartupFailure(result.stderr).dependency, 'brotlicffi')
  }
)

test('reports failed local services without treating an unused WebUI or disabled Sherpa as broken', async () => {
  const diagnostic = (overrides = {}) =>
    load('src/main/index.ts', 'diagnoseLocalStartup', {
      diagnoseLlamaCpp: async () => ({
        healthy: true,
        fingerprint: 'test',
        software: { webuiVersion: null, optionalComponents: [] },
        runtime: { name: 'llama.cpp' },
        issues: []
      }),
      getConfig: async () => ({ defaultConnectionId: 'remote' }),
      getSherpaServiceState: () => ({ status: null }),
      getInstallDir: () => '/bundled',
      getPythonPath: () => '/bundled/python',
      existsSync: () => true,
      hasEmptyBundledPythonDependencies: async () => false,
      join,
      SERVER_STATUS: null,
      SERVER_REACHABLE: false,
      SERVER_PID: null,
      WEBUI_STARTUP_STATE: { phase: 'idle' },
      LLAMACPP_STARTUP_STATE: { phase: 'idle' },
      webUIStartupEvidence: '',
      webUIInstallationEvidence: '',
      isSherpaStarting: () => false,
      agentStartupError: '',
      makeStartupIssue,
      classifyStartupFailure,
      ...overrides
    })
  assert.equal((await diagnostic()()).healthy, true)
  const archiveError = 'llama.cpp ZIP is in use: llama.zip. Close any program using it and retry.'
  let receivedError
  await diagnostic({
    LLAMACPP_STARTUP_STATE: { phase: 'failed', detail: archiveError },
    diagnoseLlamaCpp: async (_trigger, error) => {
      receivedError = error
      return {
        healthy: true,
        fingerprint: 'test',
        software: { webuiVersion: null, optionalComponents: [] },
        runtime: { name: 'llama.cpp' },
        issues: []
      }
    }
  })()
  assert.equal(receivedError, archiveError)
  const installReport = await diagnostic({ webUIInstallationEvidence: missingMetadata })()
  assert.equal(installReport.issues[0].id, 'service-startup:webui:metadata')
  const report = await diagnostic({
    SERVER_STATUS: 'failed',
    WEBUI_STARTUP_STATE: { phase: 'failed', detail: 'Process exited' },
    webUIStartupEvidence: "ImportError: No module named 'pydantic_core'",
    getSherpaServiceState: () => ({ status: 'failed' }),
    getSherpaLog: () => ["AttributeError: module 'tokenizers' has no attribute 'Tokenizer'"]
  })()
  assert.equal(report.healthy, false)
  assert.deepEqual(
    Array.from(report.issues, ({ data }) => data.packageName),
    ['pydantic-core', 'tokenizers']
  )
  const emptied = await diagnostic({
    getConfig: async () => ({ defaultConnectionId: 'local', sherpa: { enabled: true } }),
    hasEmptyBundledPythonDependencies: async () => true
  })()
  assert.deepEqual(
    Array.from(emptied.issues, ({ id }) => id),
    ['service-startup:webui:environment', 'service-startup:sherpa:environment']
  )
})

test('WebUI readiness failures never pass through to the legacy homepage check', async () => {
  for (const [ready, expected, fallback] of [
    [
      new Response('{"status":true}', { headers: { 'content-type': 'application/json' } }),
      true,
      false
    ],
    [new Response('{"detail":"Database not ready"}', { status: 503 }), false, false],
    [new Response('not found', { status: 404 }), true, true],
    [new Response('<html>Legacy</html>', { headers: { 'content-type': 'text/html' } }), true, true]
  ]) {
    const calls = []
    const reached = []
    let active = true
    const run = load('src/main/utils/index.ts', 'checkUrlAndOpen', {
      URL,
      AbortSignal,
      electronNet: {
        fetch: async (url) => {
          calls.push(url)
          return calls.length === 1 ? ready : new Response(null)
        }
      },
      setTimeout: (resolve) => {
        active = false
        resolve()
      },
      log: { info: () => {}, error: assert.fail }
    })
    await run(
      'http://127.0.0.1:8081',
      () => {
        reached.push(true)
      },
      { active: () => active }
    )
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(reached.length > 0, expected)
    assert.deepEqual(
      calls,
      fallback
        ? ['http://127.0.0.1:8081/ready', 'http://127.0.0.1:8081']
        : ['http://127.0.0.1:8081/ready']
    )
  }
})

test('diagnostic WebUI restart uses the configured installed distribution without invoking installers', async () => {
  const commands = []
  const noAction = () => {}
  const server = load('src/main/utils/index.ts', 'startServer', {
    stopAllServers: async () => {},
    killStaleOpenWebUIProcesses: assert.fail,
    getConfig: async () => ({ localServer: { version: 'legacy' } }),
    resolveOpenWebUITargetVersion: (version) => version,
    getOpenWebUIPackageNameForVersion: () => 'aurapro-ui',
    getExactPackageVersions: async () => ({ 'aurapro-webui': '3.10.13', 'aurapro-ui': '3.9.11' }),
    hasOpenWebUICoreFiles: () => true,
    ensureOpenWebUIPackage: assert.fail,
    ensureFfmpeg: assert.fail,
    isPythonInstalled: () => true,
    getLocalOpenWebUISourcePath: () => null,
    getPythonPath: () => '/bundled/python',
    getOpenWebUIDataPath: () => '/test/data',
    getSecretKey: () => 'temporary-key',
    getInferenceControlEnv: async () => ({}),
    getEpubConceptRuntimeFilePath: () => 'runtime.json',
    getOpenCodeRuntimeFilePath: () => 'agent.json',
    path: { join },
    fs: { existsSync: () => true },
    portInUse: async () => false,
    pythonEnv: (env) => env,
    log: { info: noAction },
    serverPIDs: new Set(),
    serverLogs: new Map(),
    serverPtyProcesses: new Map(),
    spawnHiddenServerProcess: (cmd, args) => {
      commands.push([cmd, ...args])
      return { pid: 42, onData: noAction, onExit: noAction }
    }
  })
  const result = await server(false, 8090, undefined, { installedOnly: true })
  assert.equal(result.url, 'http://127.0.0.1:8090')
  assert.deepEqual(commands[0].slice(0, 4), ['/bundled/python', '-I', '-u', '-c'])
  assert.deepEqual(commands[0].slice(5), [
    'aurapro-ui',
    'serve',
    '--host',
    '127.0.0.1',
    '--port',
    '8090'
  ])
})

const repair = (events, overrides = {}) =>
  load('src/main/index.ts', 'repairLocalStartup', {
    getErrorMessage: (error) => error.message,
    getConfig: async () => ({ sherpa: { port: 39384 }, defaultConnectionId: 'local' }),
    URL,
    validateSherpaProcess: () => false,
    getSherpaServiceState: () => ({ status: 'failed' }),
    SERVER_REACHABLE: true,
    SERVER_STATUS: 'started',
    SERVER_PID: 123,
    SERVER_URL: 'http://127.0.0.1:8081',
    serverStartPending: null,
    isSherpaStarting: () => false,
    stopServerHandler: async () => {
      events.push('stop-webui')
      return true
    },
    getServerPIDs: () => [],
    stopSherpa: async () => {
      events.push('stop-sherpa')
    },
    assertBundledWindowsPythonIdle: async () => {},
    existsSync: () => true,
    isPythonInstalled: () => true,
    getPythonPath: () => '/bundled/python',
    getInstallDir: () => '/bundled',
    join,
    isUvInstalled: () => true,
    webUIInstallationEvidence: '',
    startupPackage,
    dependencySpec,
    getExactPackageVersions: async (names) =>
      Object.fromEntries(names.map((name) => [name, '0.22.2'])),
    repairStartupPythonPackage: async (spec) => {
      events.push(spec)
    },
    checkSherpaStartupImports: async () => {},
    checkWebUIStartupImports: async () => {},
    repairFailingPythonImports,
    repairBundledPackageMetadata: async (install) => install(),
    classifyStartupFailure,
    makeStartupIssue,
    lastStartupEvidence,
    startServerHandler: async (installedOnly) => {
      assert.equal(installedOnly, true)
      events.push('start-webui')
      return true
    },
    waitForWebUIAfterRepair: async () => {
      events.push('ready-webui')
    },
    startSherpa: async (port, _onStatus, _config, options) => {
      assert.equal(port, 39384)
      assert.equal(options.installedOnly, true)
      events.push('start-sherpa')
      return { url: 'http://127.0.0.1:39384' }
    },
    sendToRenderer: () => {},
    toIpcSafeValue: (value) => value,
    ...overrides
  })
test('metadata repair runs the configured WebUI installer before verifying the service', async () => {
  const events = []
  const issue = makeStartupIssue('webui', classifyStartupFailure(missingMetadata), missingMetadata)
  const result = await repair(events, {
    getConfig: async () => ({ localServer: { version: '3.10.13' } }),
    resolveOpenWebUITargetVersion: (version) => version,
    ensureOpenWebUIPackage: async (version, _onStatus, options) => {
      assert.equal(options.repairMetadata, true)
      events.push(`install-webui:${version}`)
    }
  })({ issues: [issue] }, [issue.id], () => {})
  assert.deepEqual(events, [
    'stop-webui',
    'stop-sherpa',
    'install-webui:3.10.13',
    'start-webui',
    'ready-webui'
  ])
  assert.equal(result.errors.length, 0)
})

test('empty dependency directory restores the installer, WebUI and Sherpa before restarting', async () => {
  const events = []
  const evidence = 'Bundled Python package directory is missing or empty.'
  const issues = ['webui', 'sherpa'].map((service) =>
    makeStartupIssue(service, classifyStartupFailure(evidence), evidence)
  )
  const result = await repair(events, {
    isUvInstalled: () => false,
    installPython: assert.fail,
    ensureOpenWebUIPackage: async (_version, _status, options) => {
      assert.equal(options.repairMetadata, true)
      events.push('install-webui')
    },
    resolveOpenWebUITargetVersion: () => '3.10.14',
    ensureSherpaStartupDependencies: async (_config, _status, options) => {
      assert.equal(options.restore, true)
      events.push('install-sherpa')
    },
    checkSherpaStartupImports: async () => events.push('probe-sherpa')
  })(
    { issues },
    issues.map(({ id }) => id),
    () => {}
  )
  assert.deepEqual(events, [
    'stop-webui',
    'stop-sherpa',
    'uv',
    'install-webui',
    'install-sherpa',
    'probe-sherpa',
    'start-sherpa',
    'start-webui',
    'ready-webui'
  ])
  assert.deepEqual([...result.errors], [])
})

test('repairs missing faster-whisper and its broken AV dependency in the same repair', async () => {
  const events = []
  const evidence = "No module named 'faster_whisper'"
  const issue = makeStartupIssue('sherpa', classifyStartupFailure(evidence), evidence)
  let probed = false
  const result = await repair(events, {
    getExactPackageVersions: async () => ({}),
    checkSherpaStartupImports: async () => {
      if (!probed) {
        probed = true
        throw new Error("No module named 'av'")
      }
    }
  })({ issues: [issue] }, [issue.id], () => {})
  assert.deepEqual(events, [
    'stop-webui',
    'stop-sherpa',
    'faster-whisper==1.2.1',
    'av==17.1.0',
    'start-sherpa',
    'start-webui',
    'ready-webui'
  ])
  assert.deepEqual([...result.errors], [])
})

test('repairs multiple WebUI imports before starting the WebUI', async () => {
  const events = []
  const evidence = "No module named 'sqlalchemy'"
  const issue = makeStartupIssue('webui', classifyStartupFailure(evidence), evidence)
  let probed = false
  const result = await repair(events, {
    getExactPackageVersions: async () => ({}),
    checkWebUIStartupImports: async () => {
      if (!probed) {
        probed = true
        throw new Error("No module named 'aiosqlite'")
      }
    }
  })({ issues: [issue] }, [issue.id], () => {})
  assert.deepEqual(events, [
    'stop-webui',
    'stop-sherpa',
    'sqlalchemy==2.0.50',
    'aiosqlite==0.22.1',
    'start-webui',
    'ready-webui'
  ])
  assert.deepEqual([...result.errors], [])
})

test('repairs the package named by the reported WebUI traceback before checking WebUI readiness', async () => {
  const events = []
  const issue = makeStartupIssue(
    'webui',
    classifyStartupFailure(brotliWebUITrace),
    brotliWebUITrace
  )
  const result = await repair(events, {
    getExactPackageVersions: async () => ({}),
    checkWebUIStartupImports: async () => events.push('probe-webui')
  })({ issues: [issue] }, [issue.id], () => {})
  assert.deepEqual(events, [
    'stop-webui',
    'stop-sherpa',
    'brotlicffi==1.2.1.0',
    'probe-webui',
    'start-webui',
    'ready-webui'
  ])
  assert.deepEqual([...result.errors], [])
})

test('retries required Sherpa packages only after checking the shared Python runtime is idle', async () => {
  const evidence = lockedNativePackage
  const issue = makeStartupIssue('sherpa', classifyStartupFailure(evidence), evidence)
  for (const persistLock of [false, true]) {
    const events = []
    const result = await repair(events, {
      assertBundledWindowsPythonIdle: async () => events.push('python-idle'),
      ensureSherpaStartupDependencies: async (_config, _status, options) => {
        assert.equal(options.restore, true)
        events.push('retry-sherpa-dependencies')
        if (persistLock) throw new Error(lockedNativePackage)
      },
      repairStartupPythonPackage: assert.fail,
      checkSherpaStartupImports: async () => events.push('probe-sherpa')
    })({ issues: [issue] }, [issue.id], () => {})
    assert.deepEqual(events, [
      'stop-webui',
      'stop-sherpa',
      'python-idle',
      'retry-sherpa-dependencies',
      ...(persistLock ? [] : ['probe-sherpa', 'start-sherpa']),
      'start-webui',
      'ready-webui'
    ])
    if (persistLock) {
      assert.match(result.errors[0], /os error 5/)
      assert.equal(result.repairIssue.id, issue.id)
      assert.equal(result.repairIssue.repairable, false)
      assert.equal(result.actions.includes('Sherpa is responding'), false)
    } else assert.deepEqual([...result.errors], [])
  }
})

const runSpeechRepair = (run, selected = true) => {
  const issue = makeStartupIssue(
    'sherpa',
    classifyStartupFailure("No module named 'tokenizers'"),
    ''
  )
  return run({ issues: [issue] }, selected ? [issue.id] : [], () => {})
}

test('stops only managed Python services before writing one package and waits for startup', async () => {
  const events = []
  const result = await runSpeechRepair(repair(events))
  assert.deepEqual(events, [
    'stop-webui',
    'stop-sherpa',
    'tokenizers==0.22.2',
    'start-sherpa',
    'start-webui',
    'ready-webui'
  ])
  assert.deepEqual([...result.errors], [])
  assert.deepEqual(
    [...result.actions],
    ['Repaired Python dependency tokenizers==0.22.2', 'Sherpa is responding', 'WebUI is responding']
  )
})

test('does not repair an unselected issue or write while WebUI still holds files', async () => {
  const events = []
  const run = repair(events, { getServerPIDs: () => [42] })
  await runSpeechRepair(run, false)
  assert.deepEqual(events, [])
  const result = await runSpeechRepair(run)
  assert.deepEqual(events, ['stop-webui'])
  assert.match(result.errors[0], /still using Python/)
})

test('package install alone does not count as service recovery', async () => {
  const events = []
  const result = await runSpeechRepair(
    repair(events, {
      startSherpa: async () => {
        throw new Error('health check failed')
      }
    })
  )
  assert.ok(!result.actions.includes('Sherpa is responding'))
  assert.match(result.errors[0], /health check failed/)
})

test('checks each remaining Sherpa import before restoring services', async () => {
  const events = []
  let probes = 0
  const result = await runSpeechRepair(
    repair(events, {
      checkSherpaStartupImports: async () => {
        events.push('probe')
        if (!probes++) throw new Error("No module named 'python_multipart'")
      },
      getExactPackageVersions: async () => ({})
    })
  )
  assert.deepEqual(events, [
    'stop-webui',
    'stop-sherpa',
    'tokenizers==0.22.2',
    'probe',
    'python-multipart==0.0.32',
    'probe',
    'start-sherpa',
    'start-webui',
    'ready-webui'
  ])
  assert.equal(result.errors.length, 0)
})

test('only an absent or empty Python installation can be rebuilt automatically', async () => {
  for (const [value, expected] of [
    [[], true],
    [['site-packages'], false],
    ['ENOENT', true],
    ['EACCES', false]
  ]) {
    const run = load('src/main/utils/index.ts', 'canRestoreMissingPython', {
      fs: {
        promises: {
          lstat: async () => ({ isDirectory: () => true }),
          readdir: async () => {
            if (typeof value === 'string') throw Object.assign(new Error(value), { code: value })
            return value
          }
        }
      }
    })
    assert.equal(await run('python'), expected)
  }
})

test('distinguishes an empty bundled site-packages from a populated or inaccessible directory', async () => {
  const root = path.resolve('python')
  const site = join(root, 'Lib', 'site-packages')
  for (const [directories, entries, expected] of [
    [[site], 'ENOENT', true],
    [[site], [], true],
    [[site], ['__pycache__'], true],
    [[site], ['torch'], false],
    [[site], 'EACCES', false],
    [[path.resolve('other', 'site-packages')], [], false]
  ]) {
    const run = load('src/main/utils/index.ts', 'hasEmptyBundledPythonDependencies', {
      path,
      fs: {
        promises: {
          realpath: async (file) => file,
          readdir: async () => {
            if (typeof entries === 'string')
              throw Object.assign(new Error(entries), { code: entries })
            return entries
          }
        }
      },
      getPythonInstallationDir: () => root,
      getManagedPythonSiteDirectories: async () => directories
    })
    assert.equal(await run(), expected)
  }
})

test('does not enter Python setup or trigger another install after a repair failure', async () => {
  const events = []
  const result = await runSpeechRepair(
    repair(events, {
      repairStartupPythonPackage: async () => {
        throw new Error('no matching distribution')
      }
    })
  )
  assert.deepEqual(events, ['stop-webui', 'stop-sherpa', 'start-webui', 'ready-webui'])
  assert.match(result.errors[0], /no matching distribution/)
  assert.ok(!result.actions.includes('Sherpa is responding'))
  assert.equal(result.repairIssue.data.kind, 'platform')
  assert.equal(result.repairIssue.repairable, false)
})

test('a missing local WebUI Python runtime restores the configured WebUI before starting it', async () => {
  const events = []
  const issue = makeStartupIssue('webui', classifyStartupFailure('Python is not installed'), '')
  const result = await repair(events, {
    SERVER_REACHABLE: false,
    SERVER_STATUS: 'failed',
    SERVER_PID: null,
    existsSync: () => false,
    isPythonInstalled: () => false,
    canRestoreMissingPython: async () => true,
    installPython: async (_path, _status, options) => {
      assert.equal(options.preserveExisting, true)
      events.push('install-python')
      return true
    },
    getExactPackageVersions: async () => ({}),
    resolveOpenWebUITargetVersion: () => '3.10.13',
    getOpenWebUIPackageNameForVersion: () => 'aurapro-webui',
    ensureOpenWebUIPackage: async (version) => {
      events.push(`install-webui:${version}`)
    }
  })({ issues: [issue] }, [issue.id], () => {})
  assert.deepEqual(events, [
    'stop-webui',
    'stop-sherpa',
    'install-python',
    'install-webui:3.10.13',
    'start-webui',
    'ready-webui'
  ])
  assert.equal(result.errors.length, 0)
})

test('a Python symlink or junction is not eligible for an automatic runtime restore', async () => {
  const run = load('src/main/utils/index.ts', 'canRestoreMissingPython', {
    fs: {
      promises: {
        lstat: async () => ({ isDirectory: () => false }),
        readdir: async () => {
          assert.fail('must not read through a symlink')
        }
      }
    }
  })
  assert.equal(await run('python'), false)
})

test('Pro repair never switches away from a running standard inference runtime', async () => {
  const events = []
  const issue = makeStartupIssue('pro', classifyStartupFailure('Pro health check failed'), '')
  const result = await repair(events, { inferenceCoordinator: { current: 'standard' } })(
    { issues: [issue] },
    [issue.id],
    () => {}
  )
  assert.deepEqual(events, [])
  assert.match(result.errors[0], /standard inference runtime is active/)
})

test('missing RECORD retries just that exact wheel; file locks do not trigger an overwrite', async () => {
  for (const [stderr, fallback] of [
    ['Missing RECORD file', true],
    ['Failed to uninstall due to missing `RECORD` file.', true],
    ['Access denied (os error 5)', false],
    ['Warning: missing RECORD file\nAccess denied (os error 5)', false]
  ]) {
    const calls = []
    const run = load('src/main/utils/index.ts', 'repairStartupPythonPackage', {
      getPythonPath: () => '/bundled/python',
      process,
      pythonEnv: () => ({
        UV_INDEX_URL: 'https://example.invalid',
        PIP_INDEX_URL: 'https://example.invalid'
      }),
      getErrorMessage: (error) => error.message,
      isPackageFileLockedError: load('src/main/utils/index.ts', 'isPackageFileLockedError', {
        getErrorMessage: (error) => error.message
      }),
      execFile: (_python, args, options, callback) => {
        assert.equal(options.env.UV_INDEX_URL, undefined)
        assert.equal(options.env.PIP_INDEX_URL, undefined)
        calls.push(args)
        queueMicrotask(() => callback(calls.length === 1 ? new Error('install') : null, '', stderr))
        return {}
      }
    })
    if (fallback) await run('tokenizers==0.22.2')
    else await assert.rejects(run('tokenizers==0.22.2'), /os error 5/)
    assert.equal(calls.length, fallback ? 2 : 1)
    assert.ok(
      calls.every((args) => args.includes('--no-deps') && args.at(-1) === 'tokenizers==0.22.2')
    )
    if (fallback) assert.ok(calls[1].includes('--ignore-installed'))
  }
})

test('restores missing pip from the bundled standard library before installing and checking uv', async () => {
  const commands = []
  const run = load('src/main/utils/index.ts', 'repairStartupPythonPackage', {
    getPythonPath: () => '/bundled/python',
    process,
    pythonEnv: () => ({ PIP_INDEX_URL: 'https://example.invalid' }),
    execFile: (_python, args, options, callback) => {
      assert.equal(options.env.PIP_INDEX_URL, undefined)
      commands.push(args)
      queueMicrotask(() =>
        commands.length === 1
          ? callback(new Error('pip missing'), '', 'No module named pip')
          : callback(null, '', '')
      )
      return {}
    }
  })
  await run('uv')
  assert.deepEqual(
    commands.map((args) => Array.from(args).slice(1, 4)),
    [
      ['-m', 'pip', '--version'],
      ['-m', 'ensurepip', '--upgrade'],
      ['-m', 'pip', '--version'],
      ['-m', 'pip', '--isolated'],
      ['-m', 'uv', '--version']
    ]
  )
})
