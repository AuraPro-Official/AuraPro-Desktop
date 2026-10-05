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
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
