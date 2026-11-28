import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

import { InferenceCoordinator } from '../src/main/utils/inference-coordinator.ts'
import { isNewerLlamaBuild } from '../src/main/utils/llamacpp-release.ts'

const source = ts.createSourceFile(
  'llamacpp.ts',
  fs.readFileSync(new URL('../src/main/utils/llamacpp.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const names = new Set(['performLlamaCppUpdate', 'updateLlamaCpp', 'updatePromise'])
const { outputText } = ts.transpileModule(
  source.statements
    .filter(
      (statement) =>
        ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some((declaration) =>
          names.has(declaration.name.getText(source))
        )
    )
    .map((statement) => statement.getText(source))
    .join('\n'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
)

class LlamaStartError extends Error {
  canFallback = true
}

const fixture = async (t, options = {}) => {
  const dir = await fs.promises.mkdtemp(path.join(tmpdir(), 'aurapro-llama-update-'))
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }))
  const root = path.join(dir, 'llama.cpp')
  const old = path.join(root, 'b12000', 'llama-server')
  const failedTag = options.tag ?? 'b12500'
  const target = path.join(root, failedTag, 'llama-server')
  await fs.promises.mkdir(path.dirname(old), { recursive: true })
  await fs.promises.writeFile(old, 'old build')

  const coordinator = new InferenceCoordinator()
  const events = []
  let config = { llamaCpp: { version: 'b12000', variant: 'cpu', badVersions: ['b9999'] } }
  let pid = 101
  let binaryPath = old
  let status = 'started'
  const getInfo = () => ({
    pid,
    binaryPath,
    status,
    version: binaryPath ? path.relative(root, binaryPath).split(path.sep)[0] : null
  })
  const stop = async () => {
    events.push('stop')
    pid = null
    status = null
  }
  coordinator.register('standard', { start: async () => {}, stop })
  coordinator.register('pro', { start: async () => {}, stop: async () => events.push('stop-pro') })
  await coordinator.start('standard', async () => {})
  const exports = {}
  const context = {
    exports,
    fs,
    path,
    inferenceCoordinator: coordinator,
    isNewerLlamaBuild,
    getConfig: async () => config,
    setConfig: async (next) => {
      events.push('commit')
      config = next
    },
    getLlamaCppInfo: getInfo,
    getInstallDir: () => dir,
    isPidRunning: () => true,
    fetchLatestLlamaRelease: async () => ({ tag_name: failedTag }),
    resolveVariant: (variant) => variant,
    installLlamaRelease: async (release, stagedDir) => {
      events.push('download')
      assert.equal(release.tag_name, failedTag)
      assert.equal(pid, 101)
      if (options.download) await options.download()
      await fs.promises.mkdir(stagedDir, { recursive: true })
      const file = path.join(stagedDir, 'llama-server')
      await fs.promises.writeFile(file, 'prepared build')
      return file
    },
    promisify: () => async (binary, args) => {
      events.push('preflight')
      assert.equal(pid, 101)
      assert.deepEqual([...args], ['--version'])
      assert.ok(binary.includes(`${path.sep}updates${path.sep}`))
      if (options.probeError) throw new Error('missing runtime DLL')
    },
    execFile: () => {},
    process,
    withLlamaCppVersionCache: async (fn) => fn(),
    stopLlamaCpp: () => coordinator.stop('standard', stop),
    startManagedLlamaCpp: async (_progress, binary) => {
      const updating = binary === target
      events.push(updating ? 'start-new' : 'restore-old')
      assert.equal(pid, null)
      assert.ok(fs.existsSync(old), 'the previous binary is retained throughout the switch')
      assert.ok(fs.existsSync(binary))
      binaryPath = binary
      if (updating && options.healthError) throw new LlamaStartError('health check failed')
      pid = 102
      status = 'started'
      return { pid }
    },
    scheduleLlamaCppVersionCleanup: (tag) => events.push(`cleanup:${tag}`),
    markVersionBad: async (tag) => events.push(`bad:${tag}`),
    LlamaStartError,
    getErrorMessage: (error) => error.message,
    log: { warn: () => {}, error: () => {} }
  }
  for (const key of ['binaryPath', 'status']) {
    Object.defineProperty(context, key, {
      get: () => (key === 'binaryPath' ? binaryPath : status),
      set: (value) => {
        if (key === 'binaryPath') binaryPath = value
        else status = value
      }
    })
  }
  runInNewContext(outputText, context)
  return {
    update: exports.updateLlamaCpp,
    getInfo,
    config: () => config,
    events,
    target,
    coordinator
  }
}

test('download, ZIP and executable failures never stop the old runtime', async (t) => {
  for (const [options, error, lastStage] of [
    [
      {
        download: () => {
          throw new Error('network error')
        }
      },
      /network error/,
      'download'
    ],
    [
      {
        download: () => {
          throw new Error('ZIP is in use')
        }
      },
      /ZIP is in use/,
      'download'
    ],
    [{ probeError: true }, /missing runtime DLL/, 'preflight']
  ]) {
    const f = await fixture(t, options)
    await assert.rejects(f.update(), error)
    assert.equal(f.getInfo().pid, 101)
    assert.equal(f.getInfo().version, 'b12000')
    assert.equal(f.config().llamaCpp.version, 'b12000')
    assert.equal(f.events.at(-1), lastStage)
    assert.equal(fs.existsSync(f.target), false)
  }
})

test('settings and cleanup change only after the exact prepared build starts', async (t) => {
  const f = await fixture(t)
  const release = await f.coordinator.acquire('standard')
  let switchBegun
  const switching = new Promise((resolve) => (switchBegun = resolve))
  const update = f.update((message) => {
    if (message.startsWith('Switching')) switchBegun()
  })
  const duplicate = f.update()
  try {
    await switching
    assert.equal(f.getInfo().pid, 101)
    assert.deepEqual(f.events, ['download', 'preflight'])
  } finally {
    release()
  }
  assert.equal((await update).version, 'b12500')
  assert.equal((await duplicate).version, 'b12500')
  assert.deepEqual(f.events, [
    'download',
    'preflight',
    'stop',
    'start-new',
    'commit',
    'cleanup:b12500'
  ])
  assert.equal(f.config().llamaCpp.version, 'latest')
  assert.deepEqual([...f.config().llamaCpp.badVersions], ['b9999'])
})

test('a failed startup restores the original binary and still reports the update error', async (t) => {
  const f = await fixture(t, { healthError: true })
  await assert.rejects(f.update(), /health check failed.*Restored b12000/)
  assert.equal(f.getInfo().version, 'b12000')
  assert.equal(f.getInfo().status, 'started')
  assert.equal(f.config().llamaCpp.version, 'b12000')
  assert.equal(fs.existsSync(f.target), false)
  assert.deepEqual(f.events, [
    'download',
    'preflight',
    'stop',
    'start-new',
    'stop',
    'restore-old',
    'bad:b12500'
  ])
})

test('an upstream build older than the installed build is not staged or started', async (t) => {
  const f = await fixture(t, { tag: 'b11900' })
  assert.equal((await f.update()).pid, 101)
  assert.deepEqual(f.events, [])
})

test('manual updates for the standard build do not stop an active Pro runtime', async (t) => {
  const f = await fixture(t)
  await f.coordinator.start('pro', async () => {})
  f.events.length = 0
  await assert.rejects(f.update(), /Stop the Pro runtime/)
  assert.deepEqual(f.events, [])
  assert.equal(f.coordinator.current, 'pro')
})
