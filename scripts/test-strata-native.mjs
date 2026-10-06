import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import ts from 'typescript'
import * as models from '../src/main/utils/strata-models.ts'

const require = createRequire(import.meta.url)

test('Mac Pro installs, downloads, starts, diagnoses and stops without global llama config', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurapro-native-pro-'))
  const calls = []
  let downloadMode = 'success'
  let registered
  const exe = path.join(dir, 'strata', 'llama.cpp', 'b12000', 'llama-server')
  const coordinator = {
    current: null,
    register: (_name, runtime) => {
      registered = runtime
    },
    stop: async (_name, action) => {
      await action()
      coordinator.current = null
    },
    start: async (_name, action) => {
      await registered.validate()
      await action()
      coordinator.current = 'pro'
    },
    configure: async (_name, action) => action()
  }
  const source = fs.readFileSync('src/main/utils/strata.ts', 'utf8')
  const exports = {}
  const context = {
    exports,
    Buffer,
    AbortController,
    AbortSignal,
    setTimeout,
    process: {
      platform: 'darwin',
      arch: 'arm64',
      env: {},
      kill: () => {
        child.exitCode = 0
      }
    },
    require: (name) => {
      if (name === './strata-models') return models
      if (name === './index') return { getInstallDir: () => dir, portInUse: async () => false }
      if (name === './inference-coordinator') return { inferenceCoordinator: coordinator }
      if (name === './llamacpp')
        return {
          setupIsolatedLlamaCpp: async (_progress, options) => {
            calls.push(['install', options])
            fs.mkdirSync(path.dirname(exe), { recursive: true })
            fs.writeFileSync(exe, 'test')
            return exe
          },
          latestLlamaCppVersion: async () => 'b12000'
        }
      if (name.includes('strata_adapter.py')) return { default: 'unused.py' }
      if (name === 'node:child_process')
        return {
          spawn: (binary, args) => {
            calls.push(['spawn', binary, args])
            return child
          },
          execFile: () => {}
        }
      return require(name)
    },
    fetch: async (url) => {
      calls.push(['fetch', url])
      if (url.endsWith('/health')) return Response.json({ status: 'ok' })
      if (url.includes('/api/models/'))
        return Response.json({
          siblings: models
            .nativeProFiles('qwen-iq2_xs')
            .files.map((rfilename) => ({ rfilename, lfs: { size: 8 } }))
        })
      if (downloadMode === 'failed') return new Response('unavailable', { status: 503 })
      if (downloadMode === 'cancelled') {
        await exports.cancelStrataOperation()
        throw new Error('download cancelled')
      }
      return new Response(Buffer.from('GGUFtest'))
    }
  }
  const child = new EventEmitter()
  Object.assign(child, {
    pid: 123,
    exitCode: null,
    signalCode: null,
    stdout: new EventEmitter(),
    stderr: new EventEmitter()
  })
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText,
    context
  )
  try {
    await exports.installStrata(false)
    const options = calls.find((call) => call[0] === 'install')[1]
    assert.equal(options.cacheDir, path.join(dir, 'strata', 'llama.cpp'))
    assert.equal(options.variant, 'auto')
    await exports.prepareStrataModel({
      ...models.DEFAULT_STRATA_SETTINGS,
      context: 20000,
      backend: 'metal'
    })
    const info = await exports.getStrataInfo()
    assert.equal(info.supported, true)
    assert.equal(info.runtime, 'llama.cpp')
    assert.equal(info.models.find((model) => model.id === 'qwen-iq2_xs').installed, true)
    assert.equal((await exports.checkStrataUpdate()).version, 'b12000')
    await exports.startStrata()
    const liveLogs = []
    const unsubscribe = exports.subscribeStrataLogs((data) => liveLogs.push(data))
    child.stdout.emit('data', Buffer.from('Pro inference log\n'))
    assert.equal(liveLogs.at(-1), 'Pro inference log\n')
    unsubscribe()
    child.stderr.emit('data', Buffer.from('retained after unsubscribe\n'))
    assert.equal(liveLogs.at(-1), 'Pro inference log\n')
    const replay = []
    const stopReplay = exports.subscribeStrataLogs((data) => replay.push(data))
    assert.match(replay[0], /retained after unsubscribe/)
    stopReplay()
    const launch = calls.find((call) => call[0] === 'spawn')
    assert.equal(launch[1], exe)
    assert.equal(launch[2][launch[2].indexOf('--ctx-size') + 1], '20000')
    assert.equal(launch[2][launch[2].indexOf('--port') + 1], '18882')
    assert.equal((await exports.checkStrataHealth()).health, 'healthy')
    await exports.stopStrata()
    assert.equal((await exports.getStrataInfo()).status, 'stopped')
    const shard = path.join(
      dir,
      'strata',
      'native-models',
      'qwen-iq2_xs',
      models.nativeProFiles('qwen-iq2_xs').files[1]
    )
    fs.writeFileSync(shard, 'bad')
    assert.equal(
      (await exports.getStrataInfo()).models.find((model) => model.id === 'qwen-iq2_xs').installed,
      false
    )
    await assert.rejects(exports.startStrata(), /Prepare the selected Pro model/)
    downloadMode = 'failed'
    await assert.rejects(exports.prepareStrataModel(info.settings), /download failed: 503/)
    assert.equal((await exports.getStrataInfo()).status, 'failed')
    downloadMode = 'cancelled'
    await assert.rejects(exports.prepareStrataModel(info.settings), /download cancelled/)
    assert.equal((await exports.getStrataInfo()).progress.stage, 'cancelled')
    assert.equal((await exports.getStrataInfo()).status, 'stopped')
    downloadMode = 'success'
    await exports.prepareStrataModel(info.settings)
    assert.equal(
      (await exports.getStrataInfo()).models.find((model) => model.id === 'qwen-iq2_xs').installed,
      true
    )
    const sharedData = path.join(dir, 'strata', 'data', 'model.gguf')
    const ordinaryRuntime = path.join(dir, 'llama.cpp', 'llama-server')
    for (const file of [sharedData, ordinaryRuntime]) {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, 'preserved')
    }
    fs.mkdirSync(path.join(dir, 'strata', 'versions', 'old'), { recursive: true })
    const deletedWeight = path.join(dir, 'strata', 'data', 'models', 'IQ2_XS', 'weight.gguf')
    const keptWeight = path.join(dir, 'strata', 'data', 'models', 'Q2_0', 'weight.gguf')
    const sharedMtp = path.join(dir, 'strata', 'data', 'mtp', 'rt', 'experts.bin')
    const deletedPack = path.join(dir, 'strata', 'data', 'packs', 'iq2_xs', 'experts.bin')
    const oldConfig = path.join(
      dir,
      'strata',
      'versions',
      'old',
      models.strataConfigName('qwen-iq2_xs')
    )
    for (const file of [deletedWeight, keptWeight, sharedMtp, deletedPack, oldConfig]) {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, 'test')
    }
    child.exitCode = null
    await exports.startStrata()
    await assert.rejects(exports.deleteStrataModel('../outside'), /Unknown Pro model/)
    await exports.deleteStrataModel('qwen-iq2_xs')
    assert.equal(child.exitCode, 0)
    assert.equal(fs.existsSync(shard), false)
    assert.equal(fs.existsSync(exe), true)
    assert.equal(fs.existsSync(sharedData), true)
    assert.equal(fs.existsSync(deletedWeight), false)
    assert.equal(fs.existsSync(deletedPack), false)
    assert.equal(fs.existsSync(oldConfig), false)
    assert.equal(fs.existsSync(keptWeight), true)
    assert.equal(fs.existsSync(sharedMtp), true)
    assert.equal(
      (await exports.getStrataInfo()).models.find((model) => model.id === 'qwen-iq2_xs').installed,
      false
    )
    await exports.uninstallStrata()
    assert.equal(child.exitCode, 0)
    const removed = await exports.getStrataInfo()
    assert.equal(removed.installed, null)
    assert.equal(removed.status, 'stopped')
    assert.equal(removed.progress, null)
    assert.equal(fs.existsSync(exe), false)
    assert.equal(fs.existsSync(path.join(dir, 'strata', 'versions')), false)
    assert.equal(fs.existsSync(shard), false)
    assert.equal(fs.existsSync(sharedData), false)
    assert.equal(fs.existsSync(ordinaryRuntime), true)
    assert.equal(removed.settings.context, models.DEFAULT_STRATA_SETTINGS.context)
    assert.equal(fs.existsSync(path.join(dir, 'strata')), false)
    await exports.uninstallStrata()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
