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

const require = createRequire(import.meta.url)
const source = ts.transpileModule(fs.readFileSync('src/main/utils/strata.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurapro-control-'))
  const root = path.join(dir, 'strata')
  const calls = []
  const archive = Buffer.from('verified test Control archive')
  const state = { corrupt: false, checkAvailable: false, installFail: false, cancel: false }
  const write = (file, value) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, value)
  }
  const json = (file, value) => write(file, JSON.stringify(value))
  const old = path.join(root, 'versions', 'legacy')
  const oldModel = 'qwen-iq2_xs'
  const weights = path.join(root, 'data', 'models', 'IQ2_XS', 'weights.gguf')
  write(weights, 'preserve model data')
  write(path.join(old, '.venv', 'Scripts', 'python.exe'), 'python')
  write(path.join(old, 'engine', 'strata.exe'), 'old engine')
  const installedFile = path.join(root, 'installed.json')
  const oldInstalled = { source: 'legacy', version: '0.1.49', backend: 'cuda' }
  json(installedFile, oldInstalled)
  json(path.join(root, 'settings.json'), { ...models.DEFAULT_STRATA_SETTINGS, model: oldModel })
  json(path.join(old, models.strataConfigName(oldModel)), {
    exe: path.join(old, 'engine', 'strata.exe'),
    backend: 'cuda',
    args: ['--native', weights],
    vision: { exe: path.join(old, 'engine', 'strata-vision.exe') }
  })
  let server
  const execFile = () => {}
  execFile[promisify.custom] = async (exe, args, options) => {
    calls.push(['exec', exe, args, options])
    if (exe === 'tar') {
      const target = args[args.indexOf('-C') + 1]
      for (const file of ['setup.py', 'strata.py', 'python/python.exe'])
        write(path.join(target, file), 'test')
      json(path.join(target, 'BUNDLE.json'), { version: '0.1.61' })
    } else if (exe === 'taskkill') {
      server.exitCode = 0
    }
    return {
      stdout: 'AURAPRO_RESULT:' + JSON.stringify({ available: state.checkAvailable }),
      stderr: ''
    }
  }
  const exports = {}
  const coordinator = {
    register: () => {},
    start: async (_name, action) => action(),
    stop: async (_name, action) => action(),
    configure: async (_name, action) => action()
  }
  vm.runInNewContext(source, {
    exports,
    Buffer,
    AbortController,
    AbortSignal,
    setTimeout,
    process: {
      platform: 'win32',
      arch: 'x64',
      env: { PYTHONPATH: 'untrusted', VIRTUAL_ENV: 'external' }
    },
    require: (name) => {
      if (name === './strata-models') return models
      if (name === './index') return { getInstallDir: () => dir, portInUse: async () => false }
      if (name === './inference-coordinator') return { inferenceCoordinator: coordinator }
      if (name === './llamacpp') return {}
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
            if (args.includes('install')) {
              setImmediate(() => {
                child.stdout.emit(
                  'data',
                  Buffer.from(
                    'AURAPRO_RESULT:' +
                      JSON.stringify({
                        version: '0.1.60',
                        backend: 'cuda',
                        control: '0.1.61'
                      }) +
                      '\n'
                  )
                )
                child.exitCode = state.installFail ? 1 : 0
                child.emit('close', child.exitCode)
              })
            } else server = child
            return child
          }
        }
      return require(name)
    },
    fetch: async (url) => {
      calls.push(['fetch', url])
      if (url.endsWith('/health')) return Response.json({ service: 'strata', loaded: true })
      if (url.startsWith('https://api.github.com/'))
        return Response.json({
          tag_name: models.STRATA_RELEASE,
          prerelease: false,
          draft: false,
          assets: [
            {
              name: 'strata-control-0.1.61-windows-x86_64.zip',
              size: archive.length,
              digest: 'sha256:' + createHash('sha256').update(archive).digest('hex'),
              browser_download_url: `https://github.com/Niko1221/Strata/releases/download/${models.STRATA_RELEASE}/control.zip`
            }
          ]
        })
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
    assert.equal(info.installed.managed, 'control')
    assert.equal(info.installed.version, '0.1.60')
    assert.equal(info.installed.productVersion, models.STRATA_RELEASE)
    assert.equal(info.settings.model, f.oldModel)
    assert.equal(info.legacyModels[0].id, f.oldModel)
    const migrated = JSON.parse(
      fs.readFileSync(
        path.join(f.root, 'versions', info.installed.source, models.strataConfigName(f.oldModel))
      )
    )
    assert.equal(migrated.exe, 'component:strata-engine')
    assert.equal(migrated.args[1], f.weights)
    assert.equal(fs.readFileSync(f.weights, 'utf8'), 'preserve model data')
    assert.equal(fs.existsSync(path.join(f.old, 'engine', 'strata.exe')), true)
    const beforeStart = f.calls.length
    await f.exports.startStrata()
    const startup = f.calls.slice(beforeStart)
    assert.deepEqual(
      startup.filter(([type]) => type === 'fetch').map((call) => call[1]),
      ['http://127.0.0.1:18882/health']
    )
    const launch = startup.find(([type]) => type === 'spawn')
    assert.ok(launch[2].includes('--offline'))
    assert.equal(launch[3].env.STRATA_NO_ACQUIRE, '1')
    assert.equal(launch[3].env.STRATA_REQUIRE_SIGNED_COMPONENTS, '1')
    assert.equal(launch[3].env.PYTHONPATH, undefined)
    assert.equal(launch[3].env.VIRTUAL_ENV, undefined)
    assert.equal(launch[3].env.STRATA_SETTINGS_FILE, path.join(f.root, 'control-settings.json'))
    await f.exports.stopStrata()
    assert.equal((await f.exports.checkStrataUpdate()).available, false)
    f.state.checkAvailable = true
    assert.equal((await f.exports.checkStrataUpdate()).available, true)
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
    await f.exports.installStrata(false, models.DEFAULT_STRATA_SETTINGS)
    const installed = (await f.exports.getStrataInfo()).installed
    const dir = path.join(f.root, 'versions', installed.source)
    fs.writeFileSync(
      path.join(dir, models.strataConfigName(models.DEFAULT_STRATA_SETTINGS.model)),
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
    await f.exports.stopStrata()
  } finally {
    f.cleanup()
  }
})
