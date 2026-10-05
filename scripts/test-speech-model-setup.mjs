import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import ts from 'typescript'
import * as presets from '../src/main/utils/sherp_config.ts'
import * as languages from '../src/main/utils/speech-language-presets.ts'

const require = createRequire(import.meta.url)
const source = fs.readFileSync(new URL('../src/main/utils/sherpa.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    esModuleInterop: true
  }
}).outputText

function harness(initial = {}, options = {}) {
  let config = {
    sherpa: {
      ...initial,
      asrProfiles: { zh: { SHERPA_ASR_MODEL: 'existing-chinese.onnx' }, ...initial.asrProfiles },
      ttsProfiles: {
        zh: { SHERPA_TTS_MODEL: 'existing-chinese-voice.onnx' },
        ...initial.ttsProfiles
      }
    },
    envVars: options.envVars ?? {}
  }
  let active = 0
  let maximum = 0
  const downloads = []
  const files = new Set()
  const fixtures = [
    'model-steps-3.onnx',
    'tokens.txt',
    'lexicon.txt',
    'date.fst',
    'number.fst',
    'phone.fst',
    'dict/jieba.dict.utf8',
    'dict/pos_dict/prob_start.utf8'
  ]
  const modules = {
    fs: {
      ...fs,
      existsSync: (file) =>
        files.has(file) ||
        file.endsWith('phontab') ||
        Boolean(options.glossary && file.endsWith('glossary.settings.json')),
      readFileSync: (file, ...args) =>
        options.glossary && file.endsWith('glossary.settings.json')
          ? JSON.stringify(options.glossary)
          : fs.readFileSync(file, ...args),
      mkdirSync() {
        return undefined
      },
      rmSync() {
        throw new Error('Must never delete existing models')
      }
    },
    'electron-log': {
      info() {
        return undefined
      },
      warn() {
        return undefined
      },
      error() {
        return undefined
      }
    },
    'node-pty': {},
    './service-lock': { ServiceLock: class {}, isProcessAlive: () => false },
    './index': {
      getConfig: async () => config,
      setConfig: async (updates) => {
        config = { ...config, ...updates }
      },
      getInstallDir: () => 'cache',
      getOpenWebUIDataPath: () => 'webui-data',
      getPackageVersion: () => '1.13.8'
    },
    './sherp_config': presets,
    './speech-language-presets': languages,
    './huggingface': {
      getHfCacheDir: () => 'cache',
      getRepoFiles: async (repo, token) => {
        if (repo.includes('indic-conformer')) assert.equal(token, undefined)
        if (repo.includes('indic-conformer') && options.failMetadata) throw new Error('HTTP 401')
        return (
          repo.includes('matcha')
            ? fixtures
            : repo.includes('indic-conformer')
              ? [
                  'assets/encoder.onnx',
                  'assets/ctc_decoder.onnx',
                  'assets/vocab.json',
                  'assets/language_masks.json',
                  'assets/onnx__MatMul_1',
                  'assets/layers.0.weight',
                  'assets/rnnt_decoder.onnx'
                ]
              : ['model.onnx', 'tokens.txt', 'voices.bin', 'lexicon.txt']
        ).map((filename) => ({ filename }))
      },
      downloadModel: async (repo, filename, _progress, token, _b, saveAs, _saveRepo, subdir) => {
        if (repo.includes('indic-conformer')) {
          assert.equal(token, undefined)
          if (options.failIndic) throw new Error('HTTP 401')
        }
        if (options.failFallback && repo.includes('funasr-nano'))
          throw new Error('Network unavailable')
        downloads.push({ repo, filename })
        maximum = Math.max(maximum, ++active)
        await new Promise((resolve) => setTimeout(resolve, 1))
        --active
        const result = path.join('cache', subdir, saveAs || filename)
        files.add(result)
        return result
      }
    }
  }
  const context = {
    exports: {},
    process,
    setTimeout,
    require: (name) => modules[name] ?? require(name)
  }
  vm.runInNewContext(compiled, context)
  return { api: context.exports, downloads, config: () => config.sherpa, maximum: () => maximum }
}

test('selected European languages download one shared model, not every language', async () => {
  const h = harness({ enabledLanguages: ['en', 'fr', 'es'] })
  const cfg = await h.api.ensureDefaultAsrModel(h.config())
  assert.equal(h.downloads.length, 4)
  assert.ok(h.downloads.every((file) => file.repo.includes('parakeet')))
  assert.ok(cfg.asrProfiles.en, JSON.stringify(cfg.asrProfiles))
  assert.equal(cfg.asrProfiles.en, cfg.asrProfiles.fr)
  assert.equal(cfg.asrProfiles.en, cfg.asrProfiles.es)
  assert.equal(cfg.asrProfiles.en, cfg.asrProfiles.de)
  assert.equal(cfg.asrProfiles.en, cfg.asrProfiles.uk)
  assert.equal(cfg.asrProfiles.ru, undefined)
  const count = h.downloads.length
  await h.api.ensureDefaultAsrModel(cfg)
  assert.equal(h.downloads.length, count)
})

test('fresh install downloads Chinese even with an empty selection', async () => {
  const h = harness({ enabledLanguages: [], asrProfiles: { zh: undefined } })
  const cfg = await h.api.ensureDefaultAsrModel(h.config())
  assert.equal(h.downloads.length, 4)
  assert.ok(h.downloads.every(({ repo }) => repo.includes('zipformer-zh')))
  assert.deepEqual(Array.from(cfg.enabledLanguages), ['zh'])
})

test('Chinese-Spanish dictionary downloads the shared European STT and only Spanish TTS', async () => {
  const h = harness(
    { enabledLanguages: ['zh'] },
    {
      glossary: {
        glossary_mode: 'smart',
        smart_source_lang: '中文',
        smart_target_lang: '西班牙语'
      }
    }
  )
  const asr = await h.api.ensureDefaultAsrModel(h.config())
  assert.equal(h.downloads.length, 4)
  assert.equal(asr.asrProfiles.es, asr.asrProfiles.fr)
  assert.equal(asr.asrProfiles.es, asr.asrProfiles.de)
  assert.equal(asr.asrProfiles.ja, undefined)
  const tts = await h.api.ensureDefaultTtsModel(asr)
  assert.ok(tts.ttsProfiles.es)
  assert.equal(tts.ttsProfiles.fr, undefined)
  assert.deepEqual(Array.from(tts.enabledLanguages), ['zh', 'es'])
})
test('Chinese and user selected voice models are never overwritten, even with the old delete flag', async () => {
  const original = {
    enabledLanguages: ['zh'],
    asrLanguage: 'Chinese',
    asrModel: 'custom-zh.onnx',
    asrTokens: 'custom-tokens.txt',
    ttsLanguage: 'Chinese',
    ttsModel: 'my-voice.onnx',
    ttsTokens: 'voice-tokens.txt'
  }
  const h = harness(original)
  const asr = await h.api.ensureDefaultAsrModel(original, undefined, true)
  const tts = await h.api.ensureDefaultTtsModel(asr, undefined, true)
  assert.equal(h.downloads.length, 0)
  assert.equal(tts.asrModel, original.asrModel)
  assert.equal(tts.ttsModel, original.ttsModel)
})
test('Matcha downloads its vocoder, text rules and dictionary without unrelated voices', async () => {
  const h = harness({ enabledLanguages: ['zh'], ttsProfiles: { zh: undefined } })
  const cfg = await h.api.ensureDefaultTtsModel(h.config())
  assert.ok(h.downloads.every(({ repo }) => repo.includes('matcha') || repo.includes('hifigan')))
  const profile = cfg.ttsProfiles.zh
  assert.equal(profile.SHERPA_TTS_TYPE, 'matcha')
  assert.match(profile.SHERPA_TTS_VOCODER, /hifigan_v2/)
  assert.equal(profile.SHERPA_TTS_RULE_FSTS.split(',').length, 3)
  assert.equal(path.basename(profile.SHERPA_TTS_DICT_DIR), 'dict')
})
test('ASR and TTS downloads share the concurrency limit', async () => {
  const h = harness({
    enabledLanguages: ['zh', 'en', 'fr', 'ru'],
    asrProfiles: {},
    ttsProfiles: {}
  })
  await Promise.all([
    h.api.ensureDefaultAsrModel(h.config()),
    h.api.ensureDefaultTtsModel(h.config())
  ])
  assert.ok(h.maximum() <= 2)
  assert.ok(h.config().asrProfiles.en)
  assert.ok(h.config().ttsProfiles.en)
})
test('deselecting languages does not download or delete anything', async () => {
  const h = harness({
    enabledLanguages: [],
    asrProfiles: { en: { SHERPA_ASR_MODEL: 'existing.onnx' } }
  })
  const cfg = await h.api.ensureDefaultAsrModel(h.config())
  assert.equal(h.downloads.length, 0)
  assert.equal(cfg.asrProfiles.en.SHERPA_ASR_MODEL, 'existing.onnx')
})

test('Georgian and Armenian download only their dedicated transducer files', async () => {
  const h = harness({ enabledLanguages: ['ka', 'hy'] })
  const cfg = await h.api.ensureDefaultAsrModel(h.config())
  assert.equal(h.downloads.length, 8)
  assert.ok(h.downloads.every(({ repo }) => repo.includes('fastconformer')))
  assert.ok(h.maximum() <= 2)
  for (const language of ['ka', 'hy']) {
    const profile = cfg.asrProfiles[language]
    assert.equal(profile.SHERPA_ASR_TYPE, 'nemo_transducer')
    assert.equal(profile.SHERPA_LANGUAGE, language)
    for (const field of ['ENCODER', 'DECODER', 'JOINER', 'TOKENS'])
      assert.ok(profile[`SHERPA_ASR_${field}`])
  }
  assert.notEqual(cfg.asrProfiles.ka, cfg.asrProfiles.hy)
  await h.api.ensureDefaultAsrModel(cfg)
  assert.equal(h.downloads.length, 8)
})

test('dedicated language defaults preserve manually configured recognizers', async () => {
  const original = { SHERPA_ASR_MODEL: 'custom.onnx', SHERPA_ASR_TYPE: 'dolphin_ctc' }
  const h = harness({ enabledLanguages: ['ka', 'hy'], asrProfiles: { ka: original, hy: original } })
  const cfg = await h.api.ensureDefaultAsrModel(h.config())
  assert.equal(h.downloads.length, 0)
  assert.equal(cfg.asrProfiles.ka.SHERPA_ASR_MODEL, 'custom.onnx')
  assert.equal(cfg.asrProfiles.hy.SHERPA_ASR_MODEL, 'custom.onnx')
})

test('Indic languages share CTC files and external weights, never download RNNT graphs', async () => {
  const h = harness({ enabledLanguages: ['hi', 'ta', 'bn'] })
  const cfg = await h.api.ensureDefaultAsrModel(h.config())
  assert.equal(h.downloads.length, 6)
  assert.ok(h.downloads.every(({ repo }) => repo === 'ai4bharat/indic-conformer-600m-multilingual'))
  assert.ok(h.downloads.every(({ filename }) => !filename.includes('rnnt')))
  assert.equal(cfg.asrProfiles.hi.SHERPA_ASR_TYPE, 'indic_ctc')
  assert.equal(cfg.asrProfiles.hi, cfg.asrProfiles.ta)
  assert.equal(cfg.asrProfiles.hi, cfg.asrProfiles.bn)
  assert.equal(JSON.parse(cfg.asrProfiles.hi.SHERPA_ASR_EXTERNAL_FILES).length, 2)
  await h.api.ensureDefaultAsrModel(cfg)
  assert.equal(h.downloads.length, 6)
})

test('managed old Indic defaults are replaced while manual models are preserved', async () => {
  const old = {
    SHERPA_ASR_NAME: 'csukuangfj/sherpa-onnx-sense-voice-funasr-nano-int8-2025-12-17',
    SHERPA_ASR_MODEL: 'old.onnx',
    SHERPA_ASR_MANAGED: 'true'
  }
  const custom = { SHERPA_ASR_MODEL: 'my-bengali.onnx' }
  const h = harness({
    enabledLanguages: ['hi', 'bn'],
    asrProfiles: { hindi: old, hi: old, bn: custom }
  })
  const cfg = await h.api.ensureDefaultAsrModel(h.config())
  assert.equal(cfg.asrProfiles.hi.SHERPA_ASR_TYPE, 'indic_ctc')
  assert.equal(cfg.asrProfiles.bn.SHERPA_ASR_MODEL, 'my-bengali.onnx')
})

test('Indic downloads ignore user tokens and fall back after access failure', async () => {
  const original = { enabledLanguages: ['hi'], asrProfiles: {} }
  const h = harness(original, { envVars: { HF_TOKEN: 'test-user-token' }, failIndic: true })
  const fallback = await h.api.ensureDefaultAsrModel(h.config())
  assert.equal(fallback.asrProfiles.hi.SHERPA_ASR_TYPE, 'sense_voice')
  assert.equal(fallback.asrProfiles.hi.SHERPA_ASR_INDIC_FALLBACK, 'true')
  assert.ok(h.downloads.every(({ repo }) => repo.includes('funasr-nano')))
  await h.api.ensureDefaultAsrModel(fallback)
  assert.equal(h.downloads.length, 2)
  const authorized = harness(original, { envVars: { HF_TOKEN: 'test-user-token' } })
  const cfg = await authorized.api.ensureDefaultAsrModel(authorized.config())
  assert.equal(cfg.asrProfiles.hi.SHERPA_ASR_TYPE, 'indic_ctc')
})

test('Indic metadata failure falls back; failure of both downloads preserves configuration', async () => {
  const original = { enabledLanguages: ['hi'], asrProfiles: {} }
  const h = harness(original, { failMetadata: true })
  const result = await h.api.ensureDefaultAsrModel(h.config())
  assert.equal(result.asrProfiles.hi.SHERPA_ASR_TYPE, 'sense_voice')
  const broken = harness(original, { failIndic: true, failFallback: true })
  const before = broken.config()
  await assert.rejects(broken.api.ensureDefaultAsrModel(broken.config()), /Network unavailable/)
  assert.deepEqual(broken.config(), before)
})
