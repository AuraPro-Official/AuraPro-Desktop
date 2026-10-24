import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = ts.createSourceFile(
  'index.ts',
  readFileSync(new URL('../src/main/utils/index.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)

// Exercise the production orchestration with fake installers, without loading Electron
// or touching the user's Python environment and package caches.
const loadFunction = (name, dependencies) => {
  const statement = source.statements.find(
    (node) =>
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(
        (declaration) => declaration.name.getText(source) === name
      )
  )
  assert.ok(statement, `Missing production function: ${name}`)
  const { outputText } = ts.transpileModule(statement.getText(source), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  })
  const exports = {}
  runInNewContext(outputText, { exports, ...dependencies })
  return exports[name]
}

const setup = ({
  versions = { 'aurapro-webui': '3.9.32' },
  torchChanged = false,
  epubChanged = false
} = {}) => {
  const events = []
  const installed = { ...versions }
  const ensure = loadFunction('ensureOpenWebUIPackage', {
    AURAPRO_UI_TARGET_VERSION: '3.9.32',
    AURAPRO_UI_LAST_VERSION: '3.9.3',
    resolveOpenWebUITargetVersion: (version) => version,
    isLatestOpenWebUITarget: (version) => version === 'latest',
    getOpenWebUIPackageNameForVersion: () => 'aurapro-webui',
    getExactPackageVersions: async () => ({ ...installed }),
    getExactPackageVersion: (name) => installed[name] ?? null,
    isVersionAtOrBefore: () => true,
    hasOpenWebUICoreFiles: () => true,
    hasSharedPythonRuntimeImports: () => true,
    getOpenWebUIDataPath: () => '/preserved-data',
    log: { info: () => undefined, warn: () => undefined },
    prepareOpenWebUIPackageMutation: async () => events.push('prepare'),
    installPackage: async (name, version) => {
      events.push('install')
      installed[name] = version ?? '3.9.33'
    },
    removeSupersededOpenWebUIDistribution: (name) => {
      events.push(`remove:${name}`)
      delete installed[name]
    },
    installTorchPackage: async (_version, _status, onInstalled) => {
      events.push('torch')
      if (torchChanged) onInstalled()
      return true
    },
    ensureEpubConceptRuntimePackage: async (_status, onInstalled) => {
      events.push('epub')
      if (epubChanged) onInstalled()
    },
    cleanupPythonPackageCaches: async () => events.push('cleanup')
  })
  return { ensure, events, installed }
}

test('ordinary startup and latest startup do not clean unchanged package caches', async () => {
  for (const version of ['3.9.32', 'latest']) {
    const { ensure, events } = setup()
    assert.equal(await ensure(version), 'aurapro-webui')
    assert.deepEqual(events, ['torch', 'epub'])
  }
})

test('fresh install, update and downgrade clean only after all runtime dependencies finish', async () => {
  for (const versions of [{}, { 'aurapro-webui': '3.9.31' }, { 'aurapro-webui': '3.9.33' }]) {
    const { ensure, events, installed } = setup({ versions })
    await ensure('3.9.32')
    assert.equal(installed['aurapro-webui'], '3.9.32')
    assert.deepEqual(events, ['prepare', 'install', 'torch', 'epub', 'cleanup'])
  }
})

test('explicit latest update cleans, but setup can defer cleanup until all modules finish', async () => {
  for (const cleanupCaches of [true, false]) {
    const { ensure, events } = setup()
    await ensure('latest', undefined, { forceLatest: true, cleanupCaches })
    assert.deepEqual(events, [
      'prepare',
      'install',
      'torch',
      'epub',
      ...(cleanupCaches ? ['cleanup'] : [])
    ])
  }
})

test('repairing torch or EPUB dependencies also triggers exactly one cleanup', async () => {
  for (const changes of [
    { torchChanged: true },
    { epubChanged: true },
    { torchChanged: true, epubChanged: true }
  ]) {
    const { ensure, events } = setup(changes)
    await ensure()
    assert.deepEqual(events, ['torch', 'epub', 'cleanup'])
  }
})

test('legacy migration preserves the new distribution and cleans after dependency checks', async () => {
  const { ensure, events, installed } = setup({ versions: { 'aurapro-ui': '3.9.3' } })
  await ensure()
  assert.deepEqual(installed, { 'aurapro-webui': '3.9.32' })
  assert.deepEqual(events, ['prepare', 'install', 'remove:aurapro-ui', 'torch', 'epub', 'cleanup'])
})

const setupTorch = ({
  platform = 'win32',
  arch = 'x64',
  release = '23.0.0',
  variant = 'cpu',
  acceleration = false,
  installedVersion = null
} = {}) => {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  let started = false
  let installArgs
  const install = loadFunction('installTorchPackage', {
    getConfig: async () => ({
      llamaCpp: { variant },
      localServer: { ragHardwareAcceleration: acceleration }
    }),
    getExactPackageVersion: () => installedVersion,
    getPythonPath: () => 'test-python',
    pythonEnv: () => ({}),
    process: { platform, arch },
    os: { release: () => release },
    log: { info: () => undefined, warn: () => undefined },
    spawn: (_python, args, options) => {
      installArgs = args
      assert.equal(options.windowsHide, true)
      started = true
      return child
    }
  })
  return { child, install, isStarted: () => started, getArgs: () => installArgs }
}

test('torch selects published security-patched wheels and preserves legacy Mac compatibility', async () => {
  for (const [options, expected, backend] of [
    [{}, '2.13.0+cpu', 'cpu'],
    [{ platform: 'linux' }, '2.13.0+cpu', 'cpu'],
    [{ platform: 'linux', arch: 'arm64' }, '2.13.0+cpu', 'cpu'],
    [{ arch: 'arm64' }, '2.13.0+cpu', 'cpu'],
    [{ variant: 'cuda-12.4', acceleration: true }, '2.13.0+cu126', 'cu126'],
    [{ variant: 'cuda-13.3', acceleration: true }, '2.13.0+cu130', 'cu130'],
    [{ variant: 'cuda-13.3' }, '2.13.0+cpu', 'cpu'],
    [{ platform: 'darwin', arch: 'x64' }, '2.2.2', null],
    [{ platform: 'darwin', arch: 'arm64', release: '22.6.0' }, '2.8.0', null],
    [{ platform: 'darwin', arch: 'arm64' }, '2.13.0', null]
  ]) {
    const { child, install, getArgs } = setupTorch(options)
    const pending = install('3.9.32')
    await new Promise((resolve) => setImmediate(resolve))
    const args = getArgs()
    assert.ok(args.includes(`torch==${expected}`), JSON.stringify(options))
    if (backend) {
      assert.equal(
        args[args.indexOf('--index-url') + 1],
        `https://download.pytorch.org/whl/${backend}`
      )
    } else {
      assert.ok(!args.includes('--index-url'))
    }
    assert.ok(!args.includes('--extra-index-url'))
    child.emit('close', 0)
    assert.equal(await pending, true)
  }
})

test('torch keeps newer compatible wheels instead of downgrading every startup', async () => {
  for (const options of [
    { installedVersion: '2.13.0+cpu' },
    { installedVersion: '2.14.1+cpu' },
    { installedVersion: '2.14.1+cu130', variant: 'cuda-13.3', acceleration: true },
    { platform: 'darwin', arch: 'arm64', installedVersion: '2.14.1' },
    { platform: 'darwin', arch: 'x64', installedVersion: '2.2.2' }
  ]) {
    const { install, isStarted } = setupTorch(options)
    assert.equal(await install('3.9.32'), true)
    assert.equal(isStarted(), false)
  }
})

test('torch installation yields to the event loop and streams progress before completion', async () => {
  const { child, install, isStarted } = setupTorch()
  const statuses = []
  let changed = false
  const pending = install(
    '3.9.32',
    (status) => statuses.push(status),
    () => (changed = true)
  )
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(isStarted(), true)
  assert.equal(changed, false)
  child.stderr.emit('data', Buffer.from('Downloading torch'))
  assert.ok(statuses.includes('Downloading torch'))
  child.emit('close', 0)
  assert.equal(await pending, true)
  assert.equal(changed, true)
})

test('torch subprocess failure stays non-fatal and is not reported as a successful mutation', async () => {
  for (const failure of ['error', 'close']) {
    const { child, install } = setupTorch()
    let changed = false
    const pending = install('3.9.32', undefined, () => (changed = true))
    await new Promise((resolve) => setImmediate(resolve))
    child.emit(failure, failure === 'error' ? new Error('spawn failed') : 1)
    assert.equal(await pending, false)
    assert.equal(changed, false)
  }
})
