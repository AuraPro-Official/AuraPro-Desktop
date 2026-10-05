import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import vm from 'node:vm'
import ts from 'typescript'
import {
  SPEECH_TTS_REPOS,
  selectedSpeechLanguages,
  speechAsrGroup
} from '../src/main/utils/speech-language-presets.ts'
import { DEFAULT_ASR_PRESETS, RECOMMENDED_ASR_PRESETS } from '../src/main/utils/sherp_config.ts'

test('fresh languages are Chinese and English; explicit empty selection stays empty', () => {
  assert.deepEqual(selectedSpeechLanguages({}), ['zh', 'en'])
  assert.deepEqual(selectedSpeechLanguages({ enabledLanguages: [] }), [])
  assert.deepEqual(selectedSpeechLanguages({ enabledLanguages: ['en', 'en', 'fr'] }), ['en', 'fr'])
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
    ['es', 'fr']
  )
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
test('TTS mapping includes 46 languages plus both Portuguese regions', () => {
  assert.equal(Object.keys(SPEECH_TTS_REPOS).length, 48)
  assert.notEqual(SPEECH_TTS_REPOS['pt-BR'], SPEECH_TTS_REPOS['pt-PT'])
  assert.match(SPEECH_TTS_REPOS.zh, /matcha/)
})
