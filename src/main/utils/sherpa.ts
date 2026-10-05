import * as tar from 'tar'
import fs from 'fs'
import path from 'path'
import log from 'electron-log'
import * as pty from 'node-pty'
import {
  getPythonPath,
  getConfig,
  setConfig,
  installPackage,
  isPackageInstalled,
  getPackageVersion,
  isPythonInstalled,
  installPython,
  portInUse,
  getInstallDir,
  ensureFfmpeg,
  getFfmpegDir
} from './index'
import {
  downloadModel,
  getRepoFiles,
  downloadFromUrl,
  getHfCacheDir,
  type HfFileInfo
} from './huggingface'
import { ServiceLock, isProcessAlive } from './service-lock'
import {
  RECOMMENDED_ASR_PRESETS as DEFAULT_ASR_PRESETS,
  DEFAULT_ASR_PRESETS as LEGACY_ASR_PRESETS,
  DEFAULT_TTS_PRESETS,
  SERVER_SOURCE
} from './sherp_config'
import {
  SPEECH_TTS_REPOS,
  SPEECH_ASR_LANGUAGES,
  speechLanguageCode,
  selectedSpeechLanguages,
  speechAsrGroup
} from './speech-language-presets'

let ptyProcess: pty.IPty | null = null
let pid: number | null = null
let url: string | null = null
let status: string | null = null
let logBuffer: string[] = []

const lock = new ServiceLock('sherpa')
type SherpaPreset = (typeof DEFAULT_TTS_PRESETS)[number]
type SherpaPresetFile = SherpaPreset['files'][number] & { repo?: string }

interface SherpaConfig {
  [key: string]: unknown
  enabled?: boolean
  enabledLanguages?: string[]
  language?: string
  port?: number
  asrAutoDetect?: boolean
  asrCachedDecoder?: string
  asrDecoder?: string
  asrEncoder?: string
  asrJoiner?: string
  asrLanguage?: string
  asrLanguageDetectorComputeType?: string
  asrLanguageDetectorDevice?: string
  asrLanguageDetectorModel?: string
  asrMergedDecoder?: string
  asrModel?: string
  asrNumThreads?: number
  asrPreprocessor?: string
  asrPreset?: string
  asrProfiles?: Record<string, Record<string, string>>
  asrProvider?: string
  asrTask?: string
  asrTokens?: string
  asrType?: string
  asrUncachedDecoder?: string
  asrUseItn?: boolean
  ttsDataDir?: string
  ttsDictDir?: string
  ttsLanguage?: string
  ttsLang?: string
  ttsLexicon?: string
  ttsMaxSentences?: number
  ttsModel?: string
  ttsNumThreads?: number
  ttsPreset?: string
  ttsProfiles?: Record<string, Record<string, string>>
  ttsProvider?: string
  ttsTokens?: string
  ttsType?: string
  ttsVoices?: string
}

const getSherpaDir = (): string => {
  const dir = path.join(getInstallDir(), 'sherpa')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

const ensureServerScript = (): void => {
  const scriptPath = path.join(getSherpaDir(), 'aurapro_sherpa_server.py')
  if (!fs.existsSync(scriptPath) || fs.readFileSync(scriptPath, 'utf8') !== SERVER_SOURCE) {
    fs.writeFileSync(scriptPath, SERVER_SOURCE, 'utf8')
  }
}

const reinitializeServerScript = (): void => {
  const scriptPath = path.join(getSherpaDir(), 'aurapro_sherpa_server.py')
  fs.writeFileSync(scriptPath, SERVER_SOURCE, 'utf8')
}

const getServerScriptPath = (): string => {
  return path.join(getSherpaDir(), 'aurapro_sherpa_server.py')
}

const pythonEnv = (extra: Record<string, string> = {}): Record<string, string> => {
  const base = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => Boolean(entry[1]))
  )
  if (process.platform === 'win32') {
    const pythonDir = path.dirname(getPythonPath())
    const ffmpegDir = getFfmpegDir()
    const currentPath = process.env['PATH'] || process.env['Path'] || ''
    base['PATH'] = `${pythonDir};${ffmpegDir};${currentPath}`
    base['PYTHONIOENCODING'] = 'utf-8'
  }
  return { ...base, ...extra }
}

const compactEnv = (values: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => [key, String(value)])
  )

const buildAsrProfiles = (sherpaConfig: SherpaConfig): Record<string, Record<string, string>> => {
  const configuredProfiles =
    sherpaConfig.asrProfiles && typeof sherpaConfig.asrProfiles === 'object'
      ? sherpaConfig.asrProfiles
      : {}

  const profiles: Record<string, Record<string, string>> = {}
  for (const [key, value] of Object.entries(configuredProfiles)) {
    if (value && typeof value === 'object') {
      profiles[key] = compactEnv(value as Record<string, unknown>)
    }
  }

  const legacyProfile = compactEnv({
    SHERPA_ASR_NAME: sherpaConfig.asrPreset,
    SHERPA_ASR_TYPE: sherpaConfig.asrType,
    SHERPA_ASR_MODEL: sherpaConfig.asrModel,
    SHERPA_ASR_ENCODER: sherpaConfig.asrEncoder,
    SHERPA_ASR_DECODER: sherpaConfig.asrDecoder,
    SHERPA_ASR_JOINER: sherpaConfig.asrJoiner,
    SHERPA_ASR_PREPROCESSOR: sherpaConfig.asrPreprocessor,
    SHERPA_ASR_CACHED_DECODER: sherpaConfig.asrCachedDecoder,
    SHERPA_ASR_UNCACHED_DECODER: sherpaConfig.asrUncachedDecoder,
    SHERPA_ASR_MERGED_DECODER: sherpaConfig.asrMergedDecoder,
    SHERPA_ASR_TOKENS: sherpaConfig.asrTokens,
    SHERPA_ASR_NUM_THREADS: sherpaConfig.asrNumThreads ?? 4,
    SHERPA_ASR_PROVIDER: sherpaConfig.asrProvider ?? 'cpu',
    SHERPA_ASR_TASK: sherpaConfig.asrTask,
    SHERPA_ASR_USE_ITN: sherpaConfig.asrUseItn,
    SHERPA_LANGUAGE: sherpaConfig.language
  })

  if (legacyProfile.SHERPA_ASR_MODEL || legacyProfile.SHERPA_ASR_ENCODER) {
    profiles.default ??= legacyProfile
    const legacyLanguage = speechLanguageCode(sherpaConfig.asrLanguage || sherpaConfig.language)
    if (legacyLanguage) profiles[legacyLanguage] ??= legacyProfile
    if (
      (sherpaConfig.asrLanguage ?? '').toLowerCase().includes('chinese') ||
      sherpaConfig.language?.startsWith('zh')
    ) {
      profiles.zh ??= legacyProfile
    }
    const language = (sherpaConfig.asrLanguage ?? '').toLowerCase()
    if (language.includes('english') || language.startsWith('en')) profiles.en ??= legacyProfile
  }

  return profiles
}

const cleanModelId = (id: string): string =>
  id.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')

const speechProfileReady = (profile?: Record<string, string>): boolean => {
  if (!profile?.SHERPA_ASR_MODEL && !profile?.SHERPA_ASR_ENCODER && !profile?.SHERPA_TTS_MODEL)
    return false
  if (profile.SHERPA_ASR_TYPE === 'indic_ctc') {
    try {
      const external: unknown = JSON.parse(profile.SHERPA_ASR_EXTERNAL_FILES || 'null')
      if (
        !profile.SHERPA_ASR_LANGUAGE_MASKS ||
        !Array.isArray(external) ||
        !external.every((file) => typeof file === 'string' && fs.existsSync(file))
      )
        return false
    } catch {
      return false
    }
  }
  const files = Object.entries(profile).filter(
    ([key, value]) =>
      value &&
      /_(MODEL|ENCODER|DECODER|JOINER|TOKENS|LANGUAGE_MASKS|VOICES|CONV_FRONTEND|TOKENIZER|VOCODER|LEXICON|DATA_DIR|DICT_DIR|RULE_FSTS)$/.test(
        key
      )
  )
  return (
    files.every(([, value]) => value.split(',').every((file) => fs.existsSync(file))) &&
    (profile.SHERPA_ASR_TYPE !== 'qwen3_asr' ||
      ['vocab.json', 'merges.txt', 'tokenizer_config.json'].every((file) =>
        fs.existsSync(path.join(profile.SHERPA_ASR_TOKENIZER || '', file))
      ))
  )
}

async function parallelLimit<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let index = 0
  let failed = false
  let firstError: unknown = null

  async function worker() {
    while (!failed && index < tasks.length) {
      const current = index++
      try {
        results[current] = await tasks[current]()
      } catch (error) {
        failed = true
        firstError = error
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
  if (failed) throw firstError
  return results
}

let speechDownloadQueue: Promise<unknown> = Promise.resolve()
const queueSpeechDownload = (task: () => Promise<SherpaConfig>): Promise<SherpaConfig> => {
  const result = speechDownloadQueue.then(task, task)
  speechDownloadQueue = result.catch(() => undefined)
  return result
}
export const ensureDefaultAsrModel = (...args: Parameters<typeof ensureAsrModels>) =>
  queueSpeechDownload(() => ensureAsrModels(...args))
export const ensureDefaultTtsModel = (...args: Parameters<typeof ensureTtsModels>) =>
  queueSpeechDownload(() => ensureTtsModels(...args))

const ensureAsrModels = async (
  sherpaConfig: SherpaConfig,
  onStatus?: (status: string) => void,
  _isDelete?: boolean,
  persist = true
): Promise<SherpaConfig> => {
  const profiles = buildAsrProfiles(sherpaConfig)
  const selected = selectedSpeechLanguages(sherpaConfig)
  const oldIndicRepo = 'csukuangfj/sherpa-onnx-sense-voice-funasr-nano-int8-2025-12-17'
  for (const key of Object.keys(profiles)) {
    if (
      (key === 'hindi' || speechAsrGroup(key) === 'hindi') &&
      profiles[key].SHERPA_ASR_NAME === oldIndicRepo &&
      profiles[key].SHERPA_ASR_MANAGED === 'true' &&
      (profiles[key].SHERPA_ASR_INDIC_FALLBACK !== 'true' || _isDelete)
    )
      delete profiles[key]
  }
  const groups = new Set(
    selected
      .filter((language) => {
        const profile = profiles[language] || profiles[speechAsrGroup(language)]
        return !profile || (profile.SHERPA_ASR_MANAGED === 'true' && !speechProfileReady(profile))
      })
      .map(speechAsrGroup)
  )
  const presets = DEFAULT_ASR_PRESETS.filter((preset) =>
    preset.profileKeys.some(
      (key) =>
        groups.has(key) &&
        (!profiles[key] ||
          (profiles[key].SHERPA_ASR_MANAGED === 'true' && !speechProfileReady(profiles[key])))
    )
  )
  if (presets.length === 0 && selected.every((language) => profiles[language])) {
    return sherpaConfig
  }

  onStatus?.('Downloading recommended Sherpa ASR models...')
  const updates: SherpaConfig = {
    enabledLanguages: selected,
    asrLanguageDetectorModel: sherpaConfig.asrLanguageDetectorModel || 'large-v3-turbo',
    asrLanguageDetectorDevice: sherpaConfig.asrLanguageDetectorDevice || 'cpu',
    asrLanguageDetectorComputeType: sherpaConfig.asrLanguageDetectorComputeType || 'int8'
  }

  const nextProfiles = { ...profiles }
  // Public downloads never consume the user's global Hugging Face credentials.
  const token = undefined
  const fallbackIndic = (index: number) => {
    presets[index] = LEGACY_ASR_PRESETS.find((preset) => preset.profileKeys.includes('hindi'))!
    onStatus?.(
      'IndicConformer download unavailable; falling back to FunASR Nano int8. Not all Indic languages are supported by this fallback.'
    )
    log.warn('IndicConformer download unavailable; using legacy FunASR Nano int8 fallback')
  }
  const filesByPreset = await Promise.all(
    presets.map(async (preset, index) => {
      if (preset.asrType !== 'indic_ctc') return preset.files
      try {
        const files = await getRepoFiles(preset.repo, token)
        // ONNX external tensors must remain next to the encoder; do not download RNNT graphs.
        const external = files.filter(
          ({ filename }) =>
            /^assets\/[A-Za-z0-9_.-]+$/.test(filename) && !/\.(onnx|json|ts)$/.test(filename)
        )
        return [
          ...preset.files,
          ...external.map(({ filename }) => ({
            filename,
            saveAs: filename,
            field: 'asrExternalData'
          }))
        ]
      } catch {
        fallbackIndic(index)
        return presets[index].files
      }
    })
  )
  const downloadedByPreset: Record<string, string>[] = presets.map(() => ({}))
  const downloadResults: { presetIndex: number; field: string; filepath: string }[] = []
  for (let presetIndex = 0; presetIndex < presets.length; presetIndex++) {
    const downloadPreset = async () =>
      parallelLimit(
        filesByPreset[presetIndex].map((file) => async () => {
          const preset = presets[presetIndex]
          const filepath = await downloadModel(
            preset.repo,
            file.filename,
            (progress) => {
              if (progress.percent) {
                onStatus?.(`Downloading Sherpa ASR ${Math.round(progress.percent)}%...`)
              }
            },
            token,
            undefined,
            file.saveAs,
            `sherpa-${preset.id}`,
            `sherpa/asr/${cleanModelId(preset.id)}`
          )
          return { presetIndex, field: file.field, filepath }
        }),
        2
      )
    try {
      downloadResults.push(...(await downloadPreset()))
    } catch (error) {
      if (presets[presetIndex].asrType !== 'indic_ctc') throw error
      fallbackIndic(presetIndex)
      filesByPreset[presetIndex] = presets[presetIndex].files
      downloadResults.push(...(await downloadPreset()))
    }
  }
  for (const { presetIndex, field, filepath } of downloadResults) {
    downloadedByPreset[presetIndex][field] = filepath
  }

  for (const [presetIndex, preset] of presets.entries()) {
    const downloaded = downloadedByPreset[presetIndex]
    const profile = compactEnv({
      SHERPA_ASR_NAME: preset.id,
      SHERPA_ASR_MANAGED: true,
      SHERPA_ASR_INDIC_FALLBACK: preset.repo === oldIndicRepo ? true : undefined,
      SHERPA_ASR_TYPE: preset.asrType,
      SHERPA_ASR_MODEL: downloaded.asrModel,
      SHERPA_ASR_ENCODER: downloaded.asrEncoder,
      SHERPA_ASR_DECODER: downloaded.asrDecoder,
      SHERPA_ASR_JOINER: downloaded.asrJoiner,
      SHERPA_ASR_PREPROCESSOR: downloaded.asrPreprocessor,
      SHERPA_ASR_CACHED_DECODER: downloaded.asrCachedDecoder,
      SHERPA_ASR_UNCACHED_DECODER: downloaded.asrUncachedDecoder,
      SHERPA_ASR_MERGED_DECODER: downloaded.asrMergedDecoder,
      SHERPA_ASR_TOKENS: downloaded.asrTokens,
      SHERPA_ASR_LANGUAGE_MASKS: downloaded.asrLanguageMasks,
      SHERPA_ASR_EXTERNAL_FILES:
        preset.asrType === 'indic_ctc'
          ? JSON.stringify(
              downloadResults
                .filter(
                  (result) =>
                    result.presetIndex === presetIndex && result.field === 'asrExternalData'
                )
                .map((result) => result.filepath)
            )
          : undefined,
      SHERPA_ASR_CONV_FRONTEND: downloaded.asrConvFrontend,
      SHERPA_ASR_TOKENIZER: downloaded.asrTokenizer
        ? path.dirname(downloaded.asrTokenizer)
        : undefined,
      SHERPA_ASR_NUM_THREADS: sherpaConfig.asrNumThreads ?? 4,
      SHERPA_ASR_PROVIDER: sherpaConfig.asrProvider ?? 'cpu',
      SHERPA_LANGUAGE: preset.language
    })

    for (const key of preset.profileKeys) {
      if (!nextProfiles[key] || nextProfiles[key].SHERPA_ASR_MANAGED === 'true')
        nextProfiles[key] = profile
    }
  }
  for (const language of selected) {
    const shared = nextProfiles[speechAsrGroup(language)]
    if (shared && (!nextProfiles[language] || nextProfiles[language].SHERPA_ASR_MANAGED === 'true'))
      nextProfiles[language] = shared
  }
  updates.asrProfiles = nextProfiles

  const nextSherpaConfig = { ...sherpaConfig, ...updates }
  if (persist) {
    const current = await getConfig()
    await setConfig({ sherpa: { ...(current?.sherpa ?? {}), ...updates } })
  }
  onStatus?.('Sherpa ASR model is ready')
  return nextSherpaConfig
}

const buildTtsProfiles = (sherpaConfig: SherpaConfig): Record<string, Record<string, string>> => {
  const configuredProfiles =
    sherpaConfig.ttsProfiles && typeof sherpaConfig.ttsProfiles === 'object'
      ? sherpaConfig.ttsProfiles
      : {}

  const profiles: Record<string, Record<string, string>> = {}
  for (const [key, value] of Object.entries(configuredProfiles)) {
    if (value && typeof value === 'object') {
      profiles[key] = compactEnv(value as Record<string, unknown>)
    }
  }

  const legacyProfile = compactEnv({
    SHERPA_TTS_NAME: sherpaConfig.ttsPreset,
    SHERPA_TTS_TYPE: sherpaConfig.ttsType,
    SHERPA_TTS_MODEL: sherpaConfig.ttsModel,
    SHERPA_TTS_TOKENS: sherpaConfig.ttsTokens,
    SHERPA_TTS_VOICES: sherpaConfig.ttsVoices,
    SHERPA_TTS_LEXICON: sherpaConfig.ttsLexicon,
    SHERPA_TTS_DATA_DIR: sherpaConfig.ttsDataDir,
    SHERPA_TTS_DICT_DIR: sherpaConfig.ttsDictDir,
    SHERPA_TTS_LANG: sherpaConfig.ttsLang,
    SHERPA_TTS_NUM_THREADS: sherpaConfig.ttsNumThreads ?? 4,
    SHERPA_TTS_PROVIDER: sherpaConfig.ttsProvider ?? 'cpu',
    SHERPA_TTS_MAX_SENTENCES: sherpaConfig.ttsMaxSentences ?? 1
  })

  if (legacyProfile.SHERPA_TTS_MODEL) {
    profiles.default ??= legacyProfile
    profiles.others ??= legacyProfile
    const legacyLanguage = speechLanguageCode(sherpaConfig.ttsLanguage || sherpaConfig.ttsLang)
    if (legacyLanguage) profiles[legacyLanguage] ??= legacyProfile
    const language = (sherpaConfig.ttsLanguage || sherpaConfig.ttsLang || '').toLowerCase()
    if (language.includes('chinese') || language.startsWith('zh')) profiles.zh ??= legacyProfile
    if (language.includes('english') || language.startsWith('en')) profiles.en ??= legacyProfile
  }

  return profiles
}

const ESPEAK_DATA_URL =
  'https://gh-proxy.com/https://github.com/thewh1teagle/espeakng-loader/releases/download/v0.1.0/espeak-ng-data.tar.gz'

const getSharedEspeakDir = (): string => {
  const dir = path.join(getHfCacheDir(), 'sherpa/tts/espeak-ng-data')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 确保 espeak-ng-data 已下载并解压（全局只下载一次）
 */
export const ensureEspeakData = async (onStatus?: (status: string) => void): Promise<string> => {
  const targetDir = getSharedEspeakDir()

  if (fs.existsSync(path.join(targetDir, 'phontab'))) {
    log.info('espeak-ng-data already exists, skipping download')
    return targetDir
  }

  onStatus?.('Downloading shared espeak-ng-data (only once)...')

  const ttsDir = path.join(getHfCacheDir(), 'sherpa/tts')
  const tarPath = path.join(ttsDir, 'espeak-ng-data.tar.gz')
  fs.mkdirSync(path.dirname(ttsDir), { recursive: true })

  try {
    await downloadFromUrl(ESPEAK_DATA_URL, tarPath, (progress) => {
      onStatus?.(`Downloading espeak-ng-data ${progress.percent}%...`)
    })

    log.info('Download complete, extracting espeak-ng-data...')
    // 解压
    onStatus?.('Extracting espeak-ng-data...')
    await tar.x({
      file: tarPath,
      cwd: ttsDir
    })

    if (fs.existsSync(tarPath)) fs.unlinkSync(tarPath)
    onStatus?.('espeak-ng-data ready')
    return targetDir
  } catch (err) {
    if (fs.existsSync(tarPath)) fs.unlinkSync(tarPath)
    log.error('Failed to download/extract espeak-ng-data:', err)
    throw new Error('Failed to prepare espeak-ng-data')
  }
}

const basename = (filename: string) => filename.split('/').pop() ?? filename
const cleanId = (id: string) => id.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
const firstFile = (files: HfFileInfo[], predicate: (filename: string) => boolean) =>
  files.find((file) => predicate(file.filename.toLowerCase()))?.filename ?? ''

const ttsLocaleCodes = (preset: SherpaPreset): Set<string> => {
  const repo = (preset.repo || '').toLowerCase()
  const id = (preset.id || '').toLowerCase()
  const language = (preset.language ?? '').toLowerCase()
  const text = `${repo} ${id} ${language}`.toLowerCase()
  log.info('tts text: ', text)
  const codes = new Set<string>()
  const patterns = [
    /vits-piper[_-]([a-z]{2,3})[_-]([a-z]{2})/gi,
    /kokoro[_-]([a-z]{2,3})/gi,
    /\b(en|zh|ja|ko|fr|de|ru|es|it|pt|ar|hi|tr)\b/gi
  ]

  for (const pattern of patterns) {
    const matches = [...text.matchAll(pattern)]
    for (const match of matches) {
      if (match[1]) {
        const lang = match[1].toLowerCase()
        codes.add(lang)
        if (match[2]) {
          const region = match[2].toLowerCase()
          codes.add(`${lang}-${region}`)
          codes.add(`${lang}_${region}`)
        }
      }
    }
  }

  const langMap: Record<string, string[]> = {
    english: ['en'],
    chinese: ['zh', 'cmn'],
    russian: ['ru'],
    french: ['fr'],
    japanese: ['ja'],
    spanish: ['es'],
    german: ['de']
  }

  for (const [key, values] of Object.entries(langMap)) {
    if (language.includes(key)) {
      values.forEach((code) => codes.add(code))
    }
  }

  log.info('Extracted locale codes:', codes)
  return codes
}

const getTtsFiles = (preset: SherpaPreset, repoFiles: HfFileInfo[]): SherpaPresetFile[] => {
  const files = repoFiles.filter((file) => !file.filename.toLowerCase().includes('readme'))
  const repoKey = cleanId(preset.id)
  const tokens = firstFile(files, (name) => name.endsWith('tokens.txt'))
  const lexicons = files
    .filter((file) => {
      const name = file.filename.toLowerCase()
      return (
        name.endsWith('lexicon.txt') ||
        name.endsWith('lexicon.txt.gz') ||
        /lexicon-[^/]+\.txt$/.test(name)
      )
    })
    .map((file) => file.filename)
  const localeCodes = ttsLocaleCodes(preset)
  log.info('locale codes:', localeCodes)

  // const isAutoLanguage = (preset.language ?? '').toLowerCase() === 'auto'
  const commonEspeakFiles = new Set(['phontab', 'phonindex', 'phondata', 'intonations'])
  const dataFiles = files
    .filter((file) => {
      const name = file.filename.toLowerCase().replace(/\\/g, '/')
      const base = basename(name)
      if (!name.startsWith('espeak-ng-data/')) return false
      if (commonEspeakFiles.has(base)) return true
      return true
      // if (isAutoLanguage) {
      //   return true
      // } else {
      //   return isMatchingTtsLanguageFile(name, localeCodes)
      // }
    })
    .map((file) => file.filename)

  const dictFiles = files
    .filter(
      (file) =>
        (localeCodes.has('zh') || preset.repo.includes('matcha')) &&
        file.filename.toLowerCase().replace(/\\/g, '/').startsWith('dict/') &&
        file.filename.endsWith('.utf8')
    )
    .map((file) => file.filename)
  const voices =
    firstFile(files, (name) => name.endsWith('.bin') && name.includes('voices')) ||
    firstFile(files, (name) => name.endsWith('.pt') && name.includes('voices')) ||
    firstFile(files, (name) => name.endsWith('.npy') && name.includes('voices'))

  const model =
    firstFile(files, (name) => name.endsWith('.onnx') && name.includes('int8')) ||
    firstFile(files, (name) => name.endsWith('.onnx') && name.includes('model')) ||
    firstFile(files, (name) => name.endsWith('.onnx'))

  if (!model || !tokens) throw new Error(`Incomplete Sherpa TTS model: ${preset.repo}`)

  const repo = preset.repo.toLowerCase()
  const inferredType = repo.includes('kokoro')
    ? 'kokoro'
    : repo.includes('kitten')
      ? 'kitten'
      : repo.includes('matcha')
        ? 'matcha'
        : 'vits'
  preset.ttsType = inferredType
  const definedFields = new Set(preset.files?.map((f) => f.field) || [])

  const result: SherpaPresetFile[] = []
  if (preset.files && preset.files.length > 0) {
    for (const f of preset.files) {
      result.push({ ...f })
    }
  }
  if (!definedFields.has('ttsModel'))
    result.push({ filename: model, saveAs: basename(model), field: 'ttsModel' })
  if (!definedFields.has('ttsTokens'))
    result.push({ filename: tokens, saveAs: basename(tokens), field: 'ttsTokens' })
  if (inferredType === 'matcha') {
    result.push({
      repo: 'csukuangfj/sherpa-onnx-hifigan',
      filename: 'hifigan_v2.onnx',
      saveAs: 'hifigan_v2.onnx',
      field: 'ttsVocoder'
    })
    for (const file of files.filter((file) => file.filename.endsWith('.fst'))) {
      result.push({ filename: file.filename, saveAs: basename(file.filename), field: 'ttsRuleFst' })
    }
  }

  if (!definedFields.has('ttsVoices')) {
    if ((inferredType === 'kokoro' || inferredType === 'kitten') && voices) {
      result.push({
        filename: voices,
        saveAs: `sherpa-tts-${repoKey}-${basename(voices)}`,
        field: 'ttsVoices'
      })
    }
  }

  if (!definedFields.has('ttsLexicon')) {
    for (const lexicon of lexicons.filter((file) => {
      const match = file.match(/lexicon-(?:[^/]+-)?([a-z]{2,3})\.txt$/)
      return !match || localeCodes.has(match[1])
    })) {
      result.push({
        filename: lexicon,
        saveAs: `sherpa-tts-${repoKey}-${basename(lexicon)}`,
        field: 'ttsLexicon'
      })
    }
  }

  if (dataFiles.length > 0) {
    for (const file of dataFiles) {
      result.push({
        filename: file,
        saveAs: `sherpa-tts-${repoKey}/${file}`,
        field: 'ttsDataDirFile'
      })
    }
  }

  if (dictFiles.length > 0) {
    for (const file of dictFiles) {
      result.push({
        filename: file,
        saveAs: `sherpa-tts-${repoKey}/${file}`,
        field: 'ttsDictDirFile'
      })
    }
  }

  if (['kokoro', 'kitten'].includes(inferredType) && !voices)
    throw new Error(`Missing TTS voices: ${preset.repo}`)
  return result
}

const ensureTtsModels = async (
  sherpaConfig: SherpaConfig,
  onStatus?: (status: string) => void,
  _isDelete?: boolean,
  persist = true
): Promise<SherpaConfig> => {
  const profiles = buildTtsProfiles(sherpaConfig)
  const selected = selectedSpeechLanguages(sherpaConfig)
  const presets: SherpaPreset[] = selected
    .filter(
      (language) =>
        !profiles[language] ||
        (profiles[language].SHERPA_TTS_MANAGED === 'true' &&
          !speechProfileReady(profiles[language]))
    )
    .flatMap((language) => {
      const repo = SPEECH_TTS_REPOS[language === 'pt' ? 'pt-PT' : language]
      return repo
        ? [
            {
              id: repo.split('/')[1],
              label: language,
              repo,
              language,
              profileKeys: [language],
              ttsType: 'vits',
              files: []
            }
          ]
        : []
    })
  if (presets.length === 0) {
    return sherpaConfig
  }

  onStatus?.('Downloading recommended Sherpa TTS models...')
  log.info('No Sherpa TTS model found in config, downloading default models...')
  const updates: SherpaConfig = { enabledLanguages: selected }

  const nextProfiles = { ...profiles }
  const presetResults = await parallelLimit(
    presets.map((preset) => async () => {
      onStatus?.(`Downloading ${preset.id}...`)

      log.info(`Fetched files for repo ${preset.repo}:`)
      const repoFiles = await getRepoFiles(preset.repo)
      const modelFiles = getTtsFiles(preset, repoFiles)
      const needsEspeak =
        modelFiles.some((file) => file.field === 'ttsDataDirFile') ||
        (preset.ttsType === 'vits' && !modelFiles.some((file) => file.field === 'ttsLexicon'))
      let espeakDataDir = ''
      if (needsEspeak) {
        try {
          espeakDataDir = await ensureEspeakData(onStatus)
        } catch (error) {
          if (!modelFiles.some((file) => file.field === 'ttsDataDirFile')) throw error
          log.warn('Shared espeak unavailable; downloading the selected model data instead', error)
        }
      }

      const tasks = modelFiles.map((file) => async () => {
        if (file.field === 'ttsDataDirFile' && espeakDataDir) {
          return { field: file.field, filepath: espeakDataDir }
        }

        const filepath = await downloadModel(
          file.repo || preset.repo,
          file.filename,
          (progress) => {
            if (progress.percent) {
              onStatus?.(`Downloading Sherpa TTS ${Math.round(progress.percent)}%...`)
            }
          },
          undefined,
          undefined,
          file.saveAs,
          `sherpa-${preset.id}`,
          `sherpa/tts/${cleanModelId(preset.id)}`
        )
        return { field: file.field, filepath }
      })

      const results = await parallelLimit(tasks, 2)
      const downloaded: Record<string, string> = {}
      for (const { field, filepath } of results) {
        downloaded[field] =
          (field === 'ttsRuleFst' || field === 'ttsLexicon') && downloaded[field]
            ? `${downloaded[field]},${filepath}`
            : filepath
      }
      return { preset, downloaded, espeakDataDir }
    }),
    1
  )

  for (const { preset, downloaded, espeakDataDir } of presetResults) {
    let dataDir = espeakDataDir
    if (downloaded.ttsDataDirFile) {
      dataDir =
        espeakDataDir ||
        path.join(
          getHfCacheDir(),
          `sherpa/tts/${cleanModelId(preset.id)}/sherpa-tts-${cleanId(preset.id)}/espeak-ng-data`
        )
    }

    const profile = compactEnv({
      SHERPA_TTS_NAME: preset.id,
      SHERPA_TTS_MANAGED: true,
      SHERPA_TTS_TYPE: preset.ttsType,
      SHERPA_TTS_MODEL: downloaded.ttsModel,
      SHERPA_TTS_TOKENS: downloaded.ttsTokens,
      SHERPA_TTS_VOICES: downloaded.ttsVoices,
      SHERPA_TTS_LEXICON: downloaded.ttsLexicon,
      SHERPA_TTS_DATA_DIR: dataDir,
      SHERPA_TTS_DICT_DIR: downloaded.ttsDictDirFile
        ? downloaded.ttsDictDirFile.split(`${path.sep}dict${path.sep}`)[0] + `${path.sep}dict`
        : '',
      SHERPA_TTS_VOCODER: downloaded.ttsVocoder,
      SHERPA_TTS_RULE_FSTS: downloaded.ttsRuleFst,
      SHERPA_TTS_NUM_THREADS: sherpaConfig.ttsNumThreads ?? 4,
      SHERPA_TTS_PROVIDER: sherpaConfig.ttsProvider ?? 'cpu',
      SHERPA_TTS_LANG: preset.language
    })

    for (const key of preset.profileKeys) {
      nextProfiles[key] = profile
    }
  }
  updates.ttsProfiles = nextProfiles

  const nextSherpaConfig = { ...sherpaConfig, ...updates }
  if (persist) {
    const current = await getConfig()
    await setConfig({ sherpa: { ...(current?.sherpa ?? {}), ...updates } })
  }
  onStatus?.('Sherpa TTS models are ready')
  return nextSherpaConfig
}

export const getSherpaServiceState = () => ({ url, status, pid })

export const getSherpaInfo = async () => {
  const sherpaConfig = (await getConfig()).sherpa ?? {}
  const asr = buildAsrProfiles(sherpaConfig)
  const tts = buildTtsProfiles(sherpaConfig)
  return {
    url,
    status,
    pid,
    version: getPackageVersion('sherpa-onnx'),
    languages: Object.fromEntries(
      [
        ...new Set([
          ...SPEECH_ASR_LANGUAGES,
          ...Object.keys(SPEECH_TTS_REPOS),
          ...selectedSpeechLanguages(sherpaConfig)
        ])
      ].map((language) => {
        return [
          language,
          {
            asr: speechProfileReady(asr[language] || asr[speechAsrGroup(language)]),
            tts: speechProfileReady(tts[language])
          }
        ]
      })
    )
  }
}

export const getSherpaPty = (): pty.IPty | null => ptyProcess
export const getSherpaLog = (): string[] => logBuffer

export const isSherpaInstalled = (): boolean => {
  return isPackageInstalled('sherpa-onnx')
}

export const startSherpa = async (
  port: number | null = null,
  onStatus?: (status: string) => void
): Promise<{ url: string; pid: number }> => {
  if (!lock.acquire()) {
    if (url && pid) return { url, pid }
    throw new Error('Sherpa is already starting')
  }

  await stopSherpa()
  ensureServerScript()

  if (!isPythonInstalled()) {
    onStatus?.('Installing Python...')
    const ok = await installPython(undefined, onStatus)
    if (!ok) throw new Error('Python installation failed')
  }

  const requiredPackages = [
    'sherpa-onnx',
    'fast_langdetect',
    'soundfile',
    'fastapi',
    'uvicorn',
    'faster-whisper'
  ]

  const speechConfig = (await getConfig()).sherpa ?? {}
  if (
    selectedSpeechLanguages(speechConfig).some((language) => speechAsrGroup(language) === 'hindi')
  )
    requiredPackages.push('kaldi-native-fbank', 'onnxruntime', 'scipy')

  for (const pkg of requiredPackages) {
    const pinnedVersion =
      pkg === 'sherpa-onnx'
        ? '1.13.8'
        : pkg === 'kaldi-native-fbank'
          ? '1.22.3'
          : pkg === 'onnxruntime' && process.platform === 'darwin' && process.arch === 'x64'
            ? '1.23.2'
            : undefined
    if (!isPackageInstalled(pkg) || (pinnedVersion && getPackageVersion(pkg) !== pinnedVersion)) {
      onStatus?.(`Installing ${pkg}...`)
      await installPackage(pinnedVersion ? `${pkg}==${pinnedVersion}` : pkg, undefined, onStatus)
    }
  }

  try {
    await ensureFfmpeg(onStatus)
  } catch (err) {
    log.warn('Failed to ensure ffmpeg for sherpa audio decoding:', err)
  }

  const config = await getConfig()
  const configEnvVars = config.envVars ?? {}
  let sherpaConfig: SherpaConfig = { ...(config.sherpa ?? {}) }
  sherpaConfig = await ensureDefaultAsrModel(sherpaConfig, onStatus, false, false)
  sherpaConfig = await ensureDefaultTtsModel(sherpaConfig, onStatus, false, false)
  await setConfig({ sherpa: { ...(config.sherpa ?? {}), ...sherpaConfig } })
  const asrProfiles = buildAsrProfiles(sherpaConfig)
  const ttsProfiles = buildTtsProfiles(sherpaConfig)

  // log.info('Sherpa TTS profiles:', sherpaConfigTts)
  const host = '127.0.0.1'
  const desiredPort = port || sherpaConfig.port || 39384
  let availablePort = desiredPort
  while (await portInUse(availablePort, host)) {
    availablePort++
    if (availablePort > desiredPort + 100) {
      throw new Error('No available port found for sherpa')
    }
  }

  const scriptPath = getServerScriptPath()
  const pythonPath = getPythonPath()
  const commandArgs = [scriptPath, '--host', host, '--port', availablePort.toString()]

  log.info('Starting sherpa service...', pythonPath, commandArgs.join(' '))

  let spawned: pty.IPty
  try {
    spawned = pty.spawn(pythonPath, commandArgs, {
      name: 'xterm-256color',
      cols: 200,
      rows: 50,
      env: pythonEnv({
        ...configEnvVars,
        PYTHONUNBUFFERED: '1',
        PYTHONWARNINGS: 'ignore::SyntaxWarning',
        HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
        HF_HUB_VERBOSITY: 'error',
        SHERPA_DATA_DIR: getSherpaDir(),
        SHERPA_ASR_AUTO_DETECT: sherpaConfig.asrAutoDetect === false ? 'false' : 'true',
        SHERPA_LANG_DETECT_MODEL: sherpaConfig.asrLanguageDetectorModel || 'small', // 'large-v3-turbo'
        SHERPA_LANG_DETECT_DEVICE: sherpaConfig.asrLanguageDetectorDevice || 'cpu',
        SHERPA_LANG_DETECT_COMPUTE_TYPE: sherpaConfig.asrLanguageDetectorComputeType || 'int8',
        SHERPA_ASR_PROFILES: JSON.stringify(asrProfiles),
        SHERPA_TTS_PROFILES: JSON.stringify(ttsProfiles),
        ...(sherpaConfig.language ? { SHERPA_LANGUAGE: sherpaConfig.language } : {}),
        ...(sherpaConfig.asrPreset ? { SHERPA_ASR_NAME: sherpaConfig.asrPreset } : {}),
        ...(sherpaConfig.ttsPreset ? { SHERPA_TTS_NAME: sherpaConfig.ttsPreset } : {}),
        ...(sherpaConfig.asrModel ? { SHERPA_ASR_MODEL: sherpaConfig.asrModel } : {}),
        ...(sherpaConfig.asrEncoder ? { SHERPA_ASR_ENCODER: sherpaConfig.asrEncoder } : {}),
        ...(sherpaConfig.asrDecoder ? { SHERPA_ASR_DECODER: sherpaConfig.asrDecoder } : {}),
        ...(sherpaConfig.asrJoiner ? { SHERPA_ASR_JOINER: sherpaConfig.asrJoiner } : {}),
        ...(sherpaConfig.asrPreprocessor
          ? { SHERPA_ASR_PREPROCESSOR: sherpaConfig.asrPreprocessor }
          : {}),
        ...(sherpaConfig.asrCachedDecoder
          ? { SHERPA_ASR_CACHED_DECODER: sherpaConfig.asrCachedDecoder }
          : {}),
        ...(sherpaConfig.asrUncachedDecoder
          ? { SHERPA_ASR_UNCACHED_DECODER: sherpaConfig.asrUncachedDecoder }
          : {}),
        ...(sherpaConfig.asrMergedDecoder
          ? { SHERPA_ASR_MERGED_DECODER: sherpaConfig.asrMergedDecoder }
          : {}),
        ...(sherpaConfig.asrTokens ? { SHERPA_ASR_TOKENS: sherpaConfig.asrTokens } : {}),
        ...(sherpaConfig.asrType ? { SHERPA_ASR_TYPE: sherpaConfig.asrType } : {}),
        ...(sherpaConfig.ttsModel ? { SHERPA_TTS_MODEL: sherpaConfig.ttsModel } : {}),
        ...(sherpaConfig.ttsTokens ? { SHERPA_TTS_TOKENS: sherpaConfig.ttsTokens } : {}),
        ...(sherpaConfig.ttsType ? { SHERPA_TTS_TYPE: sherpaConfig.ttsType } : {}),
        ...(sherpaConfig.ttsVoices ? { SHERPA_TTS_VOICES: sherpaConfig.ttsVoices } : {}),
        ...(sherpaConfig.ttsLexicon ? { SHERPA_TTS_LEXICON: sherpaConfig.ttsLexicon } : {}),
        ...(sherpaConfig.ttsDataDir ? { SHERPA_TTS_DATA_DIR: sherpaConfig.ttsDataDir } : {}),
        ...(sherpaConfig.ttsDictDir ? { SHERPA_TTS_DICT_DIR: sherpaConfig.ttsDictDir } : {})
      })
    })
  } catch (error) {
    lock.release()
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to spawn sherpa service: ${message}`)
  }

  const spawnedPid = spawned.pid
  logBuffer = []
  ptyProcess = spawned
  pid = spawnedPid
  status = 'starting'

  spawned.onData((data: string) => {
    logBuffer.push(data)
    log.info(`[sherpa:${spawnedPid}] ${data.replace(/[\r\n]+/g, ' ').trim()}`)
  })

  spawned.onExit(({ exitCode, signal }) => {
    const exitMsg = `\r\n[sherpa exited with code ${exitCode}${signal ? ` signal ${signal}` : ''}]\r\n`
    logBuffer.push(exitMsg)
    log.info(`[sherpa:${spawnedPid}] Exited code=${exitCode} signal=${signal}`)
    ptyProcess = null
    pid = null
    url = null
    status = 'stopped'
    lock.release()
  })

  const serverUrl = `http://${host}:${availablePort}`
  url = serverUrl
  status = 'started'
  log.info(`sherpa service started - PID: ${spawnedPid}, URL: ${serverUrl}`)

  const currentConfig = await getConfig()
  await setConfig({ sherpa: { ...currentConfig.sherpa, enabled: true, port: availablePort } })

  return { url: serverUrl, pid: spawnedPid }
}

export const stopSherpa = async (): Promise<void> => {
  if (ptyProcess) {
    try {
      ptyProcess.kill()
    } catch (e) {
      log.warn('Failed to kill sherpa PTY:', e)
    }
    await new Promise((r) => setTimeout(r, 1000))
    if (pid) {
      try {
        process.kill(pid, 0)
        process.kill(pid, 'SIGKILL')
      } catch {}
    }
  }
  ptyProcess = null
  pid = null
  url = null
  status = null
  logBuffer = []
  lock.release()
}

export const validateSherpaProcess = (): boolean => {
  if (!pid) return false
  if (isProcessAlive(pid)) return true
  pid = null
  status = null
  lock.release()
  return false
}

export const reinitSherpaServerScript = (): void => {
  reinitializeServerScript()
}
