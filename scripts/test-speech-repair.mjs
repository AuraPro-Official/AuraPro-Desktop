import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import {
  configureWebUISpeech,
  isRecord,
  localSpeechOrigin,
  readAdminAccount,
  SpeechRepairError
} from '../src/main/utils/speech-repair-webui.ts'
import {
  speechRepairLanguages,
  speechModelSupport
} from '../src/main/utils/speech-language-presets.ts'

test('speech repair defaults include every installed and custom dictionary pair, not just the active one', () => {
  const settings = {
    smart_source_lang: 'English',
    smart_target_lang: 'French',
    active_glossary_id: 'first',
    glossaries: [
      { id: 'first', source_lang: 'Chinese (Mandarin)', target_lang: 'Spanish' },
      {
        id: 'second',
        source_lang: 'zh',
        target_lang: 'Portuguese (Brazil)',
        glossary_lang: 'pt-BR'
      },
      { id: 'invalid', source_lang: 3, target_lang: 'unmapped language' }
    ]
  }
  assert.deepEqual(
    speechRepairLanguages(settings, [{ source_lang: 'Chinese', target_lang: 'Russian' }]).sort(),
    ['en', 'es', 'fr', 'pt', 'pt-BR', 'ru', 'zh']
  )
  assert.deepEqual(speechRepairLanguages({}, []), ['zh', 'en'])
  assert.deepEqual(speechModelSupport('zh'), { asr: true, tts: true })
  assert.deepEqual(speechModelSupport('hy'), { asr: true, tts: false })
  assert.deepEqual(speechModelSupport('nan'), { asr: false, tts: true })
})

test('repair only accepts the managed local WebUI listener', () => {
  const managed = 'https://127.0.0.1:8081'
  assert.equal(localSpeechOrigin(managed, `${managed}/c/chat`), managed)
  for (const url of [
    'https://localhost:8081/',
    'https://example.test:8081/',
    'https://127.0.0.1:8082/',
    'http://127.0.0.1:8081/',
    'https://user@localhost:8081/',
    'https://127.0.0.1.evil.test:8081/',
    'file:///index.html'
  ])
    assert.equal(localSpeechOrigin(managed, url), null, url)
  assert.equal(localSpeechOrigin(null, managed), null)
})

test('WebUI switches both engines and resets only logged-in account speech preferences', async () => {
  const system = {
    stt: { WHISPER_MODEL: 'old', ENGINE: 'web' },
    tts: { SPLIT_ON: 'paragraph', ENGINE: 'openai' }
  }
  const personal = {
    ui: {
      theme: 'dark',
      audio: {
        inputDeviceId: 'mic',
        outputDeviceId: 'speaker',
        simultaneous: { mode: 'call' },
        stt: { engine: 'web', language: 'fr', autoSend: true },
        tts: { engine: 'browser-kokoro', voice: 'old', playbackRate: 1.25 }
      }
    }
  }
  const writes = []
  await configureWebUISpeech(
    async (route, body) => {
      if (route === 'auths/') return { id: 'current', role: 'admin' }
      if (route === 'audio/config') return system
      if (route === 'users/user/settings') return personal
      writes.push([route, body])
      return body
    },
    'http://127.0.0.1:39392',
    'current'
  )
  assert.deepEqual(
    writes.map(([route]) => route),
    ['audio/config/update', 'users/user/settings/update']
  )
  const [, updated] = writes[0]
  assert.equal(updated.stt.ENGINE, 'sherpa')
  assert.equal(updated.tts.ENGINE, 'sherpa')
  assert.equal(updated.stt.WHISPER_MODEL, 'old')
  assert.equal(updated.tts.SPLIT_ON, 'paragraph')
  assert.equal(updated.stt.OPENAI_API_BASE_URL, 'http://127.0.0.1:39392/v1')
  assert.deepEqual(updated.tts.OPENAI_PARAMS, {})
  const [, { ui }] = writes[1]
  assert.deepEqual(ui, {
    ...personal.ui,
    audio: {
      ...personal.ui.audio,
      stt: { engine: '', language: '', autoSend: true },
      tts: { engine: '', voice: '0', defaultVoice: '0', playbackRate: 1.25 }
    }
  })
})

test('WebUI rejects non-admins or a changed account and does not reset preferences if admin save fails', async () => {
  await assert.rejects(
    readAdminAccount(async () => ({ id: 'other', role: 'user' })),
    { code: 'adminRequired' }
  )
  await assert.rejects(
    readAdminAccount(async () => null),
    { code: 'signIn' }
  )
  await assert.rejects(
    configureWebUISpeech(
      async (route) => {
        assert.equal(route, 'auths/')
        return { id: 'other', role: 'admin' }
      },
      'http://127.0.0.1:39384',
      'current'
    ),
    { code: 'accountChanged' }
  )
  await assert.rejects(
    configureWebUISpeech(
      async (route) => {
        if (route === 'auths/') return { id: 'current', role: 'admin' }
        if (route === 'audio/config') return { stt: {}, tts: {} }
        if (route === 'users/user/settings') return null
        assert.equal(route, 'audio/config/update')
        return { stt: {}, tts: {} }
      },
      'http://127.0.0.1:39384',
      'current'
    ),
    { code: 'webuiFailed' }
  )
})

const loadBinding = (filename, name, context) => {
  const ast = ts.createSourceFile(
    filename,
    fs.readFileSync(filename, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
  const statement = ast.statements.find(
    (node) =>
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some((decl) => decl.name.getText(ast) === name)
  )
  assert.ok(statement, name)
  const code = statement.getText(ast).replace(/^export /, '')
  vm.runInContext(
    ts.transpileModule(`${code}; globalThis.${name}=${name}`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 }
    }).outputText,
    context
  )
}

test('repair checks admin before reinstalling and switches WebUI only after Sherpa passes both checks', async () => {
  const calls = []
  const previous = { port: 39384, enabled: true, ttsModel: 'old' }
  const service = { url: 'http://127.0.0.1:39390', pid: 1 }
  let isAdmin = false
  let failCheck = false
  const context = vm.createContext({
    URL,
    CONFIG: null,
    speechRepairInProgress: false,
    speechOperations: 0,
    glossarySpeechDownloadPending: false,
    isSherpaStarting: () => false,
    isRecord,
    SpeechRepairError,
    readAdminAccount,
    getSpeechRepairWebUI: async () => ({
      request: async (route) =>
        route === 'auths/'
          ? { id: 'account', role: isAdmin ? 'admin' : 'user' }
          : { stt: {}, tts: {} },
      assertLocal: () => undefined,
      guest: { isDestroyed: () => false, reload: () => calls.push('reload') }
    }),
    getSpeechRepairOptions: async () => ({
      defaults: ['zh', 'en', 'es'],
      languages: ['zh', 'en', 'es'].map((code) => ({ code, asr: true, tts: true }))
    }),
    getConfig: async () => ({ sherpa: previous }),
    setConfig: async ({ sherpa }, policy) => {
      assert.equal(policy.replaceSherpa, true)
      assert.equal(sherpa.port, 39390)
      assert.equal(sherpa.ttsModel, undefined)
      calls.push('save-desktop')
    },
    validateSherpaProcess: () => true,
    isPythonInstalled: () => true,
    stopSherpa: async () => calls.push('stop'),
    SHERPA_ONNX_VERSION: 'test-version',
    installPackage: async (name, version, _progress, options) => {
      assert.equal(name, 'sherpa-onnx')
      assert.equal(version, 'test-version')
      assert.equal(options.reinstallPackages[0], name)
      calls.push('reinstall')
    },
    prepareSherpaRepairModels: async (config) => {
      assert.equal(config.enabledLanguages.join(','), 'zh,es')
      assert.equal(config.excludedGlossaryLanguages.join(','), 'en')
      calls.push('models')
      return config
    },
    checkSherpaRepairModels: () => [],
    startSherpa: async (_port, _progress, config) => {
      calls.push(config === previous ? 'restore' : 'start')
      return service
    },
    waitForSherpaRepairReady: async () => calls.push('health'),
    verifySherpaRepairSpeech: async () => {
      calls.push('test-speech')
      if (failCheck) throw new Error('failed playback')
    },
    configureWebUISpeech: async () => calls.push('apply-webui'),
    getErrorMessage: (error) => error.message,
    toIpcSafeValue: (result) => result,
    sendToRenderer: () => undefined,
    log: { warn: () => undefined }
  })
  loadBinding('src/main/index.ts', 'runSpeechRepair', context)
  assert.equal((await context.runSpeechRepair({}, 1, ['es'])).code, 'adminRequired')
  assert.deepEqual(calls, [])
  isAdmin = true
  assert.equal((await context.runSpeechRepair({}, 1, ['invalid'])).code, 'invalidSelection')
  assert.deepEqual(calls, [])
  failCheck = true
  assert.equal((await context.runSpeechRepair({}, 1, ['es'])).code, 'sherpaFailed')
  assert.deepEqual(calls.splice(0), [
    'stop',
    'reinstall',
    'models',
    'start',
    'health',
    'test-speech',
    'stop',
    'restore'
  ])
  failCheck = false
  assert.equal((await context.runSpeechRepair({}, 1, ['es'])).ok, true)
  assert.deepEqual(calls, [
    'stop',
    'reinstall',
    'models',
    'start',
    'health',
    'test-speech',
    'save-desktop',
    'apply-webui',
    'reload'
  ])
})

test('repair translations are complete in all four supported locales', () => {
  const load = (language) =>
    JSON.parse(
      fs.readFileSync(`src/renderer/src/lib/i18n/locales/${language}/translation.json`, 'utf8')
    )
  const english = Object.keys(load('en-US')).filter((key) => key.startsWith('speechRepair.'))
  assert.ok(english.includes('speechRepair.steps.testing'))
  for (const language of ['zh-CN', 'zh-TW', 'es-ES']) {
    const localized = load(language)
    for (const key of english) assert.ok(localized[key], `${language}: ${key}`)
  }
})
