import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import vm from 'node:vm'
import ts from 'typescript'
import {
  SPEECH_TTS_REPOS,
  speechLanguageCode,
  selectedSpeechLanguages,
  speechAsrGroup,
  glossarySpeechLanguages
} from '../src/main/utils/speech-language-presets.ts'
import { DEFAULT_ASR_PRESETS, RECOMMENDED_ASR_PRESETS } from '../src/main/utils/sherp_config.ts'

test('Chinese is mandatory; fresh install does not download English automatically', () => {
  assert.deepEqual(selectedSpeechLanguages({}), ['zh'])
  assert.deepEqual(selectedSpeechLanguages({ enabledLanguages: [] }), ['zh'])
  assert.deepEqual(selectedSpeechLanguages({ enabledLanguages: ['en', 'en', 'fr'] }), [
    'zh',
    'en',
    'fr'
  ])
})
test('existing language profiles initialize selection without group keys', () => {
  assert.deepEqual(
    selectedSpeechLanguages({
      asrProfiles: { eu: {}, zh: {}, fr: {}, default: {} },
      ttsProfiles: { 'pt-BR': {} }
    }),
    ['zh', 'fr', 'pt-BR']
  )
})

test('legacy user models initialize their actual language instead of fresh defaults', () => {
  assert.deepEqual(
    selectedSpeechLanguages({
      asrModel: 'custom.onnx',
      asrLanguage: 'Spanish',
      ttsModel: 'voice.onnx',
      ttsLanguage: 'French'
    }),
    ['zh', 'es', 'fr']
  )
})

test('fixed and smart dictionary languages resolve only configured speech languages', () => {
  assert.deepEqual(
    glossarySpeechLanguages({
      glossary_mode: 'smart',
      smart_source_lang: '中文',
      smart_target_lang: '西班牙语'
    }),
    ['zh', 'es']
  )
  assert.deepEqual(
    glossarySpeechLanguages({
      active_glossary_id: 'a',
      glossaries: [
        { id: 'a', source_lang: 'Chinese', target_lang: 'French' },
        { id: 'b', target_lang: 'Russian' }
      ]
    }),
    ['zh', 'fr']
  )
  assert.deepEqual(glossarySpeechLanguages({ target_lang: 'not a configured language' }), [])
})
test('language routing shares European models and keeps specialist models', () => {
  for (const language of ['en', 'es', 'fr', 'de', 'pt-BR'])
    assert.equal(speechAsrGroup(language), 'eu')
  for (const language of ['zh', 'ru', 'ar', 'tl', 'ka', 'hy'])
    assert.equal(speechAsrGroup(language), language)
  assert.equal(speechAsrGroup('ja'), 'asia')
  assert.equal(speechAsrGroup('hi'), 'hindi')
  assert.equal(speechAsrGroup('sw'), 'others')
})
test('Chinese STT definition is byte-for-byte equivalent to the existing default', () => {
  const source = execFileSync('git', ['show', 'HEAD:src/main/utils/sherp_config.ts'], {
    encoding: 'utf8'
  })
  const context = { exports: {} }
  vm.runInNewContext(
    ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    context
  )
  assert.equal(
    JSON.stringify(DEFAULT_ASR_PRESETS[0]),
    JSON.stringify(context.exports.DEFAULT_ASR_PRESETS[0])
  )
  assert.equal(RECOMMENDED_ASR_PRESETS[0], DEFAULT_ASR_PRESETS[0])
})
test('TTS mapping includes reference voices plus both Portuguese regions', () => {
  assert.equal(Object.keys(SPEECH_TTS_REPOS).length, 52)
  assert.notEqual(SPEECH_TTS_REPOS['pt-BR'], SPEECH_TTS_REPOS['pt-PT'])
  assert.match(SPEECH_TTS_REPOS.zh, /matcha/)
})

test('additional reference voices resolve independently from Mandarin', () => {
  for (const language of ['ga', 'tn', 'yue', 'nan']) assert.ok(SPEECH_TTS_REPOS[language])
  for (const name of ['Cantonese', '粤语', 'zh-yue']) assert.equal(speechLanguageCode(name), 'yue')
  for (const name of ['Min-nan', '闽南语', 'zh-min-nan'])
    assert.equal(speechLanguageCode(name), 'nan')
  assert.equal(speechAsrGroup('yue'), 'unsupported')
  assert.equal(speechAsrGroup('nan'), 'unsupported')
  assert.deepEqual(glossarySpeechLanguages({ target_lang: '粤语' }), ['yue'])
})
