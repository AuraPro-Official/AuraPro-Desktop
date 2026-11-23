import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'
import ts from 'typescript'
import * as models from '../src/main/utils/strata-models.ts'
import { InferenceCoordinator } from '../src/main/utils/inference-coordinator.ts'
import * as llamaRelease from '../src/main/utils/llamacpp-release.ts'

const require = createRequire(import.meta.url)
const source = ts.transpileModule(fs.readFileSync('src/main/utils/strata.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText

function fixture({
  control = false,
  installedEngine,
  backoff = false,
  release = models.AURAPRO_ENGINE_RELEASE
} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurapro-control-'))
  const root = path.join(dir, 'strata')
  const calls = []
  const archive = Buffer.from('verified test Control archive')
  const state = {
    corrupt: false,
    wrongNativePin: false,
    installFail: false,
    cancel: false,
    startFail: false,
    offline: false,
    missingLatest: false
  }
  const digest = createHash('sha256').update(archive).digest('hex')
  const nativeAsset = 'aurapro-engine-native-0.1.66-windows-x86_64-cuda-cuda13.tar.gz'
  const controlAsset = `aurapro-engine-control-${release.slice(1)}-windows-x86_64.zip`
  const releaseUrl = `https://github.com/${models.AURAPRO_ENGINE_REPO}/releases/download/${release}`
  const write = (file, value) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, value)
  }
  const json = (file, value) => write(file, JSON.stringify(value))
  const old = path.join(root, 'versions', 'legacy')
  const oldModel = 'qwen-iq2_xs'
  const weights = path.join(root, 'data', 'models', 'IQ2_XS', 'weights.gguf')
  write(weights, 'preserve model data')
  const tokenizer = path.join(old, 'tokenizer')
  write(path.join(tokenizer, 'vocab.json'), 'keep old tokenizer')
  write(path.join(old, '.venv', 'Scripts', 'python.exe'), 'python')
  write(path.join(old, 'engine', 'strata.exe'), 'old engine')
  const installedFile = path.join(root, 'installed.json')
  const oldInstalled = {
    source: 'legacy',
    version: '0.1.49',
    backend: 'cuda',
    ...(installedEngine
      ? { managed: 'aurapro-engine', productVersion: installedEngine }
      : control
        ? { managed: 'control', productVersion: 'v0.2.15' }
        : {})
  }
  json(installedFile, oldInstalled)
  if (backoff) json(path.join(root, 'failed-update.json'), { version: release, at: Date.now() })
  json(path.join(root, 'settings.json'), { ...models.DEFAULT_STRATA_SETTINGS, model: oldModel })
  json(path.join(old, models.strataConfigName(oldModel)), {
    exe: path.join(old, 'engine', 'strata.exe'),
    tokenizer,
    backend: 'cuda',
    args: ['--native', weights],
    before_load: ['not used'],
    mcp_servers: { external: {} },
    cors_origins: ['*'],
    api_monitor: true,
    env: { PYTHONPATH: 'outside', STRATA_ROUTE_TAIL_SKIP: '0' },
    vision: { exe: path.join(old, 'engine', 'strata-vision.exe') }
  })
  let server
  const execFile = () => {}
  execFile[promisify.custom] = async (exe, args, options) => {
    calls.push(['exec', exe, args, options])
    if (path.win32.basename(exe) === 'tar.exe') {
      const target = args[args.indexOf('-C') + 1]
      for (const file of ['terminal/setup.py', 'desktop_runtime.py', 'python/python.exe'])
        write(path.join(target, file), 'test')
      json(path.join(target, 'BUNDLE.json'), { version: release.slice(1) })
    } else if (exe === 'taskkill') {
      server.exitCode = 0
    }
    return { stdout: '', stderr: '' }
  }
  const exports = {}
  const coordinator = new InferenceCoordinator()
  vm.runInNewContext(source, {
    exports,
    Buffer,
    AbortController,
    AbortSignal,
    setTimeout,
    process: {
      platform: 'win32',
      arch: 'x64',
      env: {
        PYTHONPATH: 'untrusted',
        VIRTUAL_ENV: 'external',
        HF_ENDPOINT: 'custom',
        HF_TOKEN: 'not forwarded',
        Strata_Source: 'modelscope',
        STRATA_ALLOW_UNPINNED: '1',
        MODELSCOPE_ENDPOINT: 'custom',
        CUDA_VISIBLE_DEVICES: '0'
      }
    },
    require: (name) => {
      if (name === './strata-models') return models
      if (name === './index') return { getInstallDir: () => dir, portInUse: async () => false }
      if (name === './inference-coordinator') return { inferenceCoordinator: coordinator }
      if (name === './llamacpp') return {}
      if (name === './llamacpp-release') return llamaRelease
      if (name.includes('strata_adapter.py')) return { default: 'adapter.py' }
      if (name === 'node:child_process')
        return {
          execFile,
          spawn: (exe, args, options) => {
            calls.push(['spawn', exe, args, options])
            const child = Object.assign(new EventEmitter(), {
              pid: 1234,
              exitCode: null,
              signalCode: null,
              stdout: new EventEmitter(),
              stderr: new EventEmitter()
            })
            if (args.includes('install') || args.includes('select')) {
              setImmediate(() => {
                child.stdout.emit(
                  'data',
                  Buffer.from(
                    'AURAPRO_RESULT:' +
                      JSON.stringify(
                        args.includes('select')
                          ? {
                              name: nativeAsset,
                              sha256: state.wrongNativePin ? '0'.repeat(64) : digest,
                              size: archive.length
                            }
                          : { version: '0.1.66', backend: 'cuda' }
                      ) +
                      '\n'
                  )
                )
                child.exitCode = state.installFail && args.includes('install') ? 1 : 0
                child.emit('close', child.exitCode)
              })
            } else {
              child.managed = args.some((arg) => arg.endsWith('desktop_runtime.py'))
              server = child
            }
            return child
          }
        }
      return require(name)
    },
    fetch: async (url) => {
      calls.push(['fetch', url])
      if (url.endsWith('/health')) {
        if (server.managed && state.startFail) {
          server.exitCode = 1
          server.emit('exit', 1)
          return new Response(null, { status: 503 })
        }
        return Response.json({
          service: server.managed ? 'aurapro-engine' : 'strata',
          loaded: true
        })
      }
      if (url.startsWith('https://api.github.com/')) {
        if (state.offline) throw new Error('offline')
        if (state.missingLatest && url.endsWith('/latest'))
          return new Response(null, { status: 404 })
        return Response.json({
          tag_name: release,
          prerelease: false,
          draft: false,
          assets: [controlAsset, nativeAsset].map((name) => ({
            name,
            size: archive.length,
            digest: 'sha256:' + digest,
            browser_download_url: `${releaseUrl}/${name}`
          }))
        })
      }
      if (state.cancel) {
        await exports.cancelStrataOperation()
        throw new Error('download cancelled')
      }
      return new Response(state.corrupt ? Buffer.alloc(archive.length) : archive)
    }
  })
  return {
    exports,
    state,
    calls,
    root,
    weights,
    tokenizer,
    old,
    oldModel,
    installedFile,
    oldInstalled,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true })
  }
}

test('Control verifies downloads, migrates configs and starts offline without preparation or updates', async () => {
  const f = fixture()
  try {
    assert.equal((await f.exports.getStrataInfo()).upgradeRequired, true)
    await f.exports.installStrata(true, { ...models.DEFAULT_STRATA_SETTINGS, model: f.oldModel })
    const info = await f.exports.getStrataInfo()
    assert.equal(info.installed.managed, 'aurapro-engine')
    assert.equal(info.installed.version, '0.1.66')
    assert.equal(info.installed.productVersion, models.AURAPRO_ENGINE_RELEASE)
    assert.equal(info.upgradeRequired, false)
    assert.equal(f.calls.filter(([type]) => type === 'fetch').length, 3)
    assert.ok(
      f.calls
        .filter(([type]) => type === 'fetch')
        .every(([, url]) => url.includes(models.AURAPRO_ENGINE_REPO))
    )
    assert.equal(info.settings.model, f.oldModel)
    assert.equal(info.legacyModels[0].id, f.oldModel)
    const migrated = JSON.parse(
      fs.readFileSync(
        path.join(f.root, 'versions', info.installed.source, models.strataConfigName(f.oldModel))
      )
    )
    assert.equal(migrated.exe, 'component:strata-engine')
    assert.equal(migrated.args[1], f.weights)
    assert.equal(migrated.tokenizer, f.tokenizer)
    assert.equal(fs.readFileSync(f.weights, 'utf8'), 'preserve model data')
    assert.equal(fs.existsSync(path.join(f.old, 'engine', 'strata.exe')), true)
    const beforeStart = f.calls.length
    await f.exports.startStrata()
    assert.equal((await f.exports.getStrataInfo()).installed.rollback, undefined)
    const startup = f.calls.slice(beforeStart)
    assert.deepEqual(
      startup.filter(([type]) => type === 'fetch').map((call) => call[1]),
      ['http://127.0.0.1:18882/health']
    )
    const launch = startup.find(([type]) => type === 'spawn')
    assert.deepEqual(Array.from(launch[2].slice(0, 5)), [
      '-B',
      '-E',
      '-s',
      path.join(launch[3].cwd, 'desktop_runtime.py'),
      'serve'
    ])
    assert.ok(launch[2].includes('--offline'))
    assert.equal(launch[3].env.STRATA_NO_ACQUIRE, '1')
    assert.equal(launch[3].env.STRATA_REQUIRE_SIGNED_COMPONENTS, '1')
    assert.equal(launch[3].env.PYTHONPATH, undefined)
    assert.equal(launch[3].env.VIRTUAL_ENV, undefined)
    assert.equal(launch[3].env.HF_ENDPOINT, 'https://huggingface.co')
    assert.equal(launch[3].env.STRATA_SOURCE, 'huggingface')
    assert.equal(launch[3].env.HF_TOKEN, undefined)
    assert.equal(launch[3].env.Strata_Source, undefined)
    assert.equal(launch[3].env.STRATA_ALLOW_UNPINNED, undefined)
    assert.equal(launch[3].env.MODELSCOPE_ENDPOINT, undefined)
    assert.equal(launch[3].env.CUDA_VISIBLE_DEVICES, '0')
    assert.equal(launch[3].env.STRATA_SETTINGS_FILE, path.join(f.root, 'control-settings.json'))
    const active = JSON.parse(fs.readFileSync(path.join(launch[3].cwd, 'aurapro-active.json')))
    for (const key of ['before_load', 'mcp_servers', 'api_monitor', 'cors_origins'])
      assert.equal(active[key], undefined)
    assert.deepEqual(active.env, { STRATA_ROUTE_TAIL_SKIP: '0' })
    await f.exports.stopStrata()
    assert.equal((await f.exports.checkStrataUpdate()).available, false)
  } finally {
    f.cleanup()
  }
})

test('Native package must match both the control pin and official release digest', async () => {
  const f = fixture()
  try {
    f.state.wrongNativePin = true
    await assert.rejects(f.exports.installStrata(), /no verified package/)
    assert.deepEqual(JSON.parse(fs.readFileSync(f.installedFile)), f.oldInstalled)
    assert.equal(f.calls.filter(([type]) => type === 'fetch').length, 2)
  } finally {
    f.cleanup()
  }
})

test('ordinary Pro start migrates an installed Strata Control despite its larger version number', async () => {
  const f = fixture({ control: true })
  try {
    f.state.missingLatest = true
    assert.equal((await f.exports.checkStrataUpdate()).available, true)
    await f.exports.startStrata()
    const info = await f.exports.getStrataInfo()
    assert.equal(info.installed.productVersion, models.AURAPRO_ENGINE_RELEASE)
    assert.equal(info.installed.managed, 'aurapro-engine')
    assert.equal(info.upgradeRequired, false)
    assert.equal(info.settings.model, f.oldModel)
    assert.equal(fs.readFileSync(f.weights, 'utf8'), 'preserve model data')
    assert.ok(f.calls.some(([, url]) => url.endsWith('/tags/v0.0.1')))
    const afterFirstStart = f.calls.length
    await f.exports.startStrata()
    assert.equal(f.calls.length, afterFirstStart)
    await f.exports.stopStrata()
  } finally {
    f.cleanup()
  }
})

test('an already migrated Pro automatically installs the next stable AuraPro Engine version', async () => {
  const f = fixture({ installedEngine: 'v0.0.1', release: 'v0.0.2' })
  try {
    await f.exports.startStrata()
    const info = await f.exports.getStrataInfo()
    assert.equal(info.installed.productVersion, 'v0.0.2')
    assert.equal(info.installed.rollback, undefined)
    assert.equal(info.status, 'started')
    assert.equal(fs.readFileSync(f.weights, 'utf8'), 'preserve model data')
    await f.exports.stopStrata()
  } finally {
    f.cleanup()
  }
})

test('automatic update failure restores old runtime when the new model process exits', async () => {
  const f = fixture({ control: true })
  try {
    f.state.startFail = true
    await f.exports.startStrata()
    const info = await f.exports.getStrataInfo()
    assert.deepEqual(JSON.parse(fs.readFileSync(f.installedFile)), f.oldInstalled)
    assert.equal(info.settings.model, f.oldModel)
    assert.equal(info.status, 'started')
    assert.equal(info.progress.stage, 'restored')
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(f.root, 'failed-update.json'))).version,
      models.AURAPRO_ENGINE_RELEASE
    )
    await f.exports.stopStrata()
  } finally {
    f.cleanup()
  }
})

test('a recent failed migration skips its payload, but manual update still retries', async () => {
  const f = fixture({ control: true, backoff: true })
  try {
    await f.exports.startStrata()
    assert.deepEqual(JSON.parse(fs.readFileSync(f.installedFile)), f.oldInstalled)
    assert.equal(
      f.calls.some(([kind, url]) => kind === 'fetch' && url.includes('/download/')),
      false
    )
    await f.exports.installStrata(true)
    await f.exports.startStrata()
    assert.equal((await f.exports.getStrataInfo()).installed.managed, 'aurapro-engine')
    await f.exports.stopStrata()
  } finally {
    f.cleanup()
  }
})

test('offline automatic check keeps a working Strata install usable', async () => {
  const f = fixture({ control: true })
  try {
    f.state.offline = true
    await f.exports.startStrata()
    const info = await f.exports.getStrataInfo()
    assert.equal(info.status, 'started')
    assert.equal(info.installed.managed, 'control')
    assert.match(info.logs, /Automatic update skipped/)
    await f.exports.stopStrata()
  } finally {
    f.cleanup()
  }
})

test('updates compare AuraPro Engine product versions, without reinstalling or downgrading', async () => {
  const f = fixture({ release: 'v0.0.2' })
  try {
    await f.exports.installStrata(true)
    const installed = JSON.parse(fs.readFileSync(f.installedFile))
    assert.equal(installed.productVersion, 'v0.0.2')
    fs.writeFileSync(f.installedFile, JSON.stringify({ ...installed, productVersion: 'v0.0.3' }))
    assert.equal((await f.exports.checkStrataUpdate()).available, false)
    const downloads = f.calls.filter(
      ([kind, url]) => kind === 'fetch' && url.includes('/download/')
    ).length
    await f.exports.installStrata(true)
    assert.equal(
      f.calls.filter(([kind, url]) => kind === 'fetch' && url.includes('/download/')).length,
      downloads
    )
    assert.equal((await f.exports.getStrataInfo()).installed.productVersion, 'v0.0.3')
  } finally {
    f.cleanup()
  }
})

test('Invalid archive never extracts or replaces the installed runtime', async () => {
  const f = fixture()
  try {
    f.state.corrupt = true
    await assert.rejects(f.exports.installStrata(true), /checksum verification failed/)
    assert.equal(
      f.calls.some(([type]) => type === 'exec'),
      false
    )
    assert.deepEqual(JSON.parse(fs.readFileSync(f.installedFile)), f.oldInstalled)
    assert.equal(fs.existsSync(f.weights), true)
    assert.deepEqual(fs.readdirSync(path.join(f.root, 'versions')), ['legacy'])
  } finally {
    f.cleanup()
  }
})

test('Failed engine update preserves the previous installation and settings', async () => {
  const f = fixture()
  try {
    f.state.installFail = true
    await assert.rejects(f.exports.installStrata(true), /command exited with code 1/)
    assert.deepEqual(JSON.parse(fs.readFileSync(f.installedFile)), f.oldInstalled)
    assert.equal(f.exports.getStrataSettings().model, f.oldModel)
    assert.deepEqual(fs.readdirSync(path.join(f.root, 'versions')), ['legacy'])
  } finally {
    f.cleanup()
  }
})

test('Cancelling a Control download preserves the old runtime and removes staging files', async () => {
  const f = fixture()
  try {
    f.state.cancel = true
    await assert.rejects(f.exports.installStrata(true), /download cancelled/)
    assert.deepEqual(JSON.parse(fs.readFileSync(f.installedFile)), f.oldInstalled)
    assert.equal((await f.exports.getStrataInfo()).progress.stage, 'cancelled')
    assert.deepEqual(fs.readdirSync(path.join(f.root, 'versions')), ['legacy'])
  } finally {
    f.cleanup()
  }
})

test('Qwen3.6 starts through Control without unsupported Flash-Next KV flags', async () => {
  const f = fixture()
  try {
    const settings = { ...models.DEFAULT_STRATA_SETTINGS, model: 'qwen36-ud-q4_k_xl' }
    await f.exports.installStrata(false, settings)
    const installed = (await f.exports.getStrataInfo()).installed
    const dir = path.join(f.root, 'versions', installed.source)
    fs.writeFileSync(
      path.join(dir, models.strataConfigName(settings.model)),
      JSON.stringify({
        exe: 'component:strata-engine',
        backend: 'cuda',
        arch: 'qwen35moe',
        tokenizer: 'qwen',
        args: ['--native', f.weights, '--mtp', '2']
      })
    )
    await f.exports.startStrata()
    const config = JSON.parse(fs.readFileSync(path.join(dir, 'aurapro-active.json')))
    assert.equal(config.args.includes('--kv'), false)
    assert.equal(config.args.includes('--kv-resident'), false)
    assert.equal(config.args[config.args.indexOf('--max-context') + 1], '32768')
    assert.equal(config.arch, 'qwen35moe')
    assert.equal(config.tokenizer, 'qwen')
    assert.equal(config.args[config.args.indexOf('--mtp') + 1], '2')
    const info = await f.exports.getStrataInfo()
    assert.deepEqual(config.aliases, ['aurapro-pro', 'lite_Q4'])
    assert.equal(info.models.length, 9)
    assert.deepEqual(
      Array.from(
        info.models.filter((model) => model.family === 'qwen36'),
        (model) => model.name
      ),
      ['lite_Q4', 'lite_Q6']
    )
    assert.equal(
      info.legacyModels.some((model) => model.id === settings.model),
      false
    )
    await f.exports.stopStrata()
  } finally {
    f.cleanup()
  }
})

test('Q8 is never downloaded, even if an old configuration still selects it', async () => {
  const f = fixture()
  try {
    const settings = { ...models.DEFAULT_STRATA_SETTINGS, model: 'qwen36-q8_0' }
    await assert.rejects(f.exports.prepareStrataModel(settings), /retired/)
    assert.deepEqual(f.calls, [])
  } finally {
    f.cleanup()
  }
})
