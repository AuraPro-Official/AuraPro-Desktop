import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { normalizeKvCacheType } from '../src/main/utils/llamacpp-settings.ts'

const parse = (file) =>
  ts.createSourceFile(
    file,
    readFileSync(new URL(file, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
const main = parse('../src/main/index.ts')
const llama = parse('../src/main/utils/llamacpp.ts')

// Load production functions without Electron, model downloads, or live services.
const evaluate = (code, context) =>
  runInContext(
    ts.transpileModule(code, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText,
    context
  )

const load = (source, names, context) => {
  for (const name of names) {
    const statement = source.statements.find(
      (node) =>
        ts.isVariableStatement(node) &&
        node.declarationList.declarations.some(
          (declaration) => declaration.name.getText(source) === name
        )
    )
    assert.ok(statement, `Missing production function ${name}`)
    evaluate(`${statement.getText(source)}\nglobalThis.${name} = ${name}`, context)
  }
}

const setupSync = (kvCacheType, stored = {}) => {
  let config = {
    llamaCpp: { enabled: true, ctxSize: 16384, kvCacheType, extraArgs: ['--offline'] }
  }
  let file = JSON.stringify(stored)
  const events = []
  const restarts = []
  let watcher
  const context = createContext({
    normalizeKvCacheType,
    path,
    join: path.join,
    CONFIG: config,
    glossarySettingsSyncing: false,
    glossarySettingsWatcherStarted: false,
    lastGlossaryLlamaSettings: null,
    log: { warn: () => undefined },
    getConfig: async () => config,
    setConfig: async (update) => {
      config = { ...config, ...update }
    },
    getOpenWebUIDataPath: () => '/test-data',
    existsSync: () => true,
    mkdirSync: () => undefined,
    readFileSync: () => file,
    writeFileSync: (_path, data) => {
      file = data
    },
    sendToRenderer: (type, data) => events.push({ type, data }),
    setTimeout: (callback) => {
      callback()
      return 1
    },
    watchFile: (_path, _options, callback) => {
      watcher = callback
    },
    scheduleLlamaCppRuntimeSettingsRestart: (reason) => restarts.push(reason),
    updateTray: () => undefined,
    registerShortcuts: () => undefined,
    voiceInputRecording: false
  })
  load(
    main,
    [
      'normalizeCtxSize',
      'normalizeOptionalBoolean',
      'getLlamaRuntimeSettingsFromConfig',
      'sameLlamaRuntimeSettings',
      'getGlossarySettingsPath',
      'readGlossaryLlamaRuntimeSettings',
      'writeGlossaryLlamaRuntimeSettings',
      'syncGlossaryLlamaSettingsFromConfig',
      'applyGlossaryLlamaSettingsToConfig',
      'startGlossaryCtxSizeSync'
    ],
    context
  )
  let configHandler
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(main) === 'ipcMain.handle' &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === 'set:config'
    ) {
      configHandler = node.arguments[1]
    }
    ts.forEachChild(node, visit)
  }
  visit(main)
  assert.ok(configHandler)
  evaluate(`globalThis.saveDesktopConfig = ${configHandler.getText(main)}`, context)
  return {
    context,
    events,
    restarts,
    config: () => config,
    stored: () => JSON.parse(file),
    changeWebUI: async (values) => {
      file = JSON.stringify({ ...JSON.parse(file), ...values })
      await watcher()
    }
  }
}

test('KV cache accepts only the three supported formats and defaults to Q8', () => {
  for (const value of ['q8_0', 'q4_0', 'f16']) assert.equal(normalizeKvCacheType(value), value)
  for (const value of [undefined, null, 'q3', 8, {}, ''])
    assert.equal(normalizeKvCacheType(value), null)
  const { context } = setupSync()
  assert.equal(context.getLlamaRuntimeSettingsFromConfig({}).kvCacheType, 'q8_0')
})

test('startup persists Q8 for an installation without a KV setting and preserves glossary data', async () => {
  const state = setupSync(undefined, { token_limit: 32768, glossaries: [{ id: 'user' }] })
  await state.context.startGlossaryCtxSizeSync()
  assert.equal(state.config().llamaCpp.kvCacheType, 'q8_0')
  assert.equal(state.stored().kv_cache_type, 'q8_0')
  assert.equal(state.config().llamaCpp.ctxSize, 32768)
  assert.deepEqual(state.stored().glossaries, [{ id: 'user' }])
  assert.equal(state.restarts.length, 0)
})

test('startup keeps a saved F16 selection', async () => {
  const state = setupSync('q8_0', { kv_cache_type: 'f16', token_limit: 16384 })
  await state.context.startGlossaryCtxSizeSync()
  assert.equal(state.config().llamaCpp.kvCacheType, 'f16')
  assert.equal(state.stored().kv_cache_type, 'f16')
})

test('desktop save synchronizes Q4 and F16 and requests one restart per change', async () => {
  const state = setupSync('q8_0')
  await state.context.startGlossaryCtxSizeSync()
  for (const kvCacheType of ['q4_0', 'f16', 'q8_0']) {
    const before = state.restarts.length
    await state.context.saveDesktopConfig(null, {
      llamaCpp: { ...state.config().llamaCpp, kvCacheType }
    })
    assert.equal(state.stored().kv_cache_type, kvCacheType)
    assert.equal(state.restarts.length, before + 1)
    await state.context.saveDesktopConfig(null, {
      llamaCpp: { ...state.config().llamaCpp, kvCacheType }
    })
    assert.equal(state.restarts.length, before + 1)
  }
  assert.ok(state.events.some((event) => event.type === 'llamacpp:settings-updated'))
})

test('WebUI changes update desktop immediately without a feedback restart loop', async () => {
  const state = setupSync('q8_0')
  await state.context.startGlossaryCtxSizeSync()
  await state.changeWebUI({ kv_cache_type: 'q4_0' })
  assert.equal(state.config().llamaCpp.kvCacheType, 'q4_0')
  assert.deepEqual(state.config().llamaCpp.extraArgs, ['--offline'])
  assert.equal(state.events.at(-1).type, 'config:updated')
  assert.equal(state.restarts.length, 1)
  await state.changeWebUI({ kv_cache_type: 'q4_0' })
  assert.equal(state.restarts.length, 1)
  await state.changeWebUI({ kv_cache_type: 'f16', token_limit: 32768 })
  assert.equal(state.config().llamaCpp.kvCacheType, 'f16')
  assert.equal(state.config().llamaCpp.ctxSize, 32768)
  assert.equal(state.restarts.length, 2)
})

test('presets apply the selected precision to both K and V for every managed model', async () => {
  for (const kvCacheType of [undefined, 'q8_0', 'q4_0', 'f16']) {
    let preset
    const context = createContext({
      normalizeKvCacheType,
      path,
      log: { info: () => undefined },
      migrateOfficialRootModels: () => undefined,
      ensureAutoMmproj: async () => {},
      ensureAutoMtp: async () => {},
      normalizePositiveInteger: () => 1,
      getDefaultParallel: () => 1,
      sortModelsForPreset: (models) => models,
      listLocalLlmModels: () => [{ filepath: '/models/high_Q4.gguf' }],
      getInstallDir: () => '/test-data',
      getPresetModelId: () => 'high_Q4',
      findModelMmproj: () => null,
      getPresetModelOverrides: () => ({}),
      escapeIniSection: (id) => id,
      toIniPath: (file) => file,
      fs: {
        mkdirSync: () => undefined,
        writeFileSync: (_file, text) => {
          preset = text
        }
      }
    })
    load(llama, ['writeModelsPreset'], context)
    await context.writeModelsPreset('/models', { kvCacheType })
    assert.ok(preset.includes(`cache-type-k = ${kvCacheType ?? 'q8_0'}\n`))
    assert.ok(preset.includes(`cache-type-v = ${kvCacheType ?? 'q8_0'}\n`))
    assert.ok(preset.includes('[high_Q4]'))
    const globalDefaults = preset.split('[high_Q4]')[0]
    assert.ok(globalDefaults.startsWith('[*]\n'))
    assert.ok(globalDefaults.includes('temp = 0.5\n'))
    assert.ok(globalDefaults.includes('top-p = 0.95\n'))
    assert.ok(globalDefaults.includes('top-k = 64\n'))
    assert.ok(globalDefaults.includes('min-p = 0.05\n'))
  }
})

test('launch arguments use the selection even with conflicting custom cache arguments', async () => {
  for (const kvCacheType of ['q8_0', 'q4_0', 'f16']) {
    let args
    const context = createContext({
      normalizeKvCacheType,
      path,
      process: { env: {} },
      status: null,
      stopLlamaCpp: async () => {},
      setupLlamaCpp: async () => '/test/llama-server',
      getConfig: async () => ({
        llamaCpp: { kvCacheType, extraArgs: ['-ctk', 'f16', '--cache-type-v=q4_0', '--offline'] }
      }),
      resolveVariant: () => 'cpu',
      portInUse: async () => false,
      getInstallDir: () => '/test-data',
      hasExplicitArg: (args, arg) => args.includes(arg),
      ensureEpubConceptModel: async () => {
        throw new Error('EPUB must not download a model')
      },
      writeModelsPreset: async () => '/test/models.ini',
      log: { info: () => undefined },
      getErrorMessage: (error) => error.message,
      pty: {
        spawn: (_binary, command) => {
          args = command
          throw new Error('test-stop-before-spawn')
        }
      }
    })
    load(llama, ['stripArgsWithValue', 'startLlamaCppAttempt'], context)
    await assert.rejects(context.startLlamaCppAttempt(), /test-stop-before-spawn/)
    assert.equal(args[args.indexOf('--cache-type-k') + 1], kvCacheType)
    assert.equal(args[args.indexOf('--cache-type-v') + 1], kvCacheType)
    assert.equal(args.filter((arg) => arg.startsWith('--cache-type-v')).length, 1)
    assert.ok(!args.includes('-ctk'))
    assert.ok(args.includes('--offline'))
  }
})
