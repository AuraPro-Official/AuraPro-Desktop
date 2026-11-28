import * as tar from 'tar'
import fs from 'fs'
import path from 'path'
import log from 'electron-log'
import * as pty from 'node-pty'
import { setTimeout as delay } from 'node:timers/promises'
import {
  getPythonPath,
  getConfig,
  getOpenWebUIDataPath,
  setConfig,
  installPackage,
  isPackageInstalled,
  getPackageVersion,
  getExactPackageVersions,
  isPythonInstalled,
  isUvInstalled,
  repairStartupPythonPackage,
  installPython,
  portInUse,
  getInstallDir,
  ensureFfmpeg,
  getFfmpegDir,
  downloadFileWithProgress
} from './index'
import {
  downloadModel,
  getRepoFiles,
  downloadFromUrl,
  getHfCacheDir,
  recordSherpaAsrFiles,
  type HfFileInfo
} from './huggingface'
import { downloadIndicMirrorFile, fetchIndicMirrorManifest } from './indicconformer-mirror'
import { ServiceLock, isProcessAlive } from './service-lock'
import {
  RECOMMENDED_ASR_PRESETS as DEFAULT_ASR_PRESETS,
  RETIRED_INDIC_ASR_REPO,
  DEFAULT_TTS_PRESETS,
  SERVER_SOURCE
} from './sherp_config'
import {
  SPEECH_TTS_REPOS,
  SPEECH_ASR_LANGUAGES,
  SPEECH_LANGUAGE_ALIASES,
  speechLanguageCode,
  selectedSpeechLanguages,
  speechAsrGroup,
  glossarySpeechLanguages,
  speechModelSupport
} from './speech-language-presets'

export const SHERPA_ONNX_VERSION = '1.13.8'

let ptyProcess: pty.IPty | null = null
let pid: number | null = null
let url: string | null = null
let status: string | null = null
let logBuffer: string[] = []
let pendingStart: Promise<{ url: string; pid: number }> | null = null

const lock = new ServiceLock('sherpa')
type SherpaPreset = (typeof DEFAULT_TTS_PRESETS)[number]
type SherpaPresetFile = SherpaPreset['files'][number] & { repo?: string }

interface SherpaConfig {
  [key: string]: unknown
  enabled?: boolean
  enabledLanguages?: string[]
  excludedGlossaryLanguages?: string[]
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
      const profile = compactEnv(value as Record<string, unknown>)
      if (
        profile.SHERPA_ASR_NAME !== RETIRED_INDIC_ASR_REPO &&
        profile.SHERPA_ASR_INDIC_FALLBACK !== 'true'
      )
        profiles[key] = profile
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

  if (
    legacyProfile.SHERPA_ASR_NAME !== RETIRED_INDIC_ASR_REPO &&
    (legacyProfile.SHERPA_ASR_MODEL || legacyProfile.SHERPA_ASR_ENCODER)
  ) {
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

const requestedSpeechLanguages = (config: SherpaConfig): string[] => {
  let dictionaryLanguages: string[] = []
  try {
    const file = path.join(getOpenWebUIDataPath(), 'glossary.settings.json')
    if (fs.existsSync(file))
      dictionaryLanguages = glossarySpeechLanguages(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch (error) {
    log.warn('Unable to read glossary speech languages:', error)
  }
  return [
    ...new Set([
      ...selectedSpeechLanguages(config),
      ...(!Array.isArray(config.enabledLanguages) &&
      (config.asrPreset === RETIRED_INDIC_ASR_REPO ||
        config.asrProfiles?.hindi?.SHERPA_ASR_NAME === RETIRED_INDIC_ASR_REPO ||
        config.asrProfiles?.hindi?.SHERPA_ASR_INDIC_FALLBACK === 'true')
        ? [speechLanguageCode(config.asrLanguage || config.language) || 'hi'].map((code) =>
            speechAsrGroup(code) === 'hindi' ? code : 'hi'
          )
        : []),
      ...dictionaryLanguages.filter(
        (language) => !config.excludedGlossaryLanguages?.includes(language)
      )
    ])
  ]
}

const speechProfileReady = (profile?: Record<string, string>): boolean => {
  if (!profile?.SHERPA_ASR_MODEL && !profile?.SHERPA_ASR_ENCODER && !profile?.SHERPA_TTS_MODEL)
    return false
  if (profile.SHERPA_ASR_TYPE === 'indic_ctc') {
    try {
      const external: unknown = JSON.parse(profile.SHERPA_ASR_EXTERNAL_FILES || 'null')
      if (
        !profile.SHERPA_ASR_LANGUAGE_MASKS ||
        !Array.isArray(external) ||
        external.length === 0 ||
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

export const indicSpeechModelUpdateLanguages = (config: SherpaConfig): string[] => {
  const profiles = buildAsrProfiles(config)
  return requestedSpeechLanguages(config).filter((language) => {
    if (speechAsrGroup(language) !== 'hindi') return false
    const specific = profiles[language]
    const shared = profiles.hindi
    if ([specific, shared].some((profile) => profile && profile.SHERPA_ASR_MANAGED !== 'true'))
      return false
    return (
      (specific && specific.SHERPA_ASR_TYPE !== 'indic_ctc') ||
      shared?.SHERPA_ASR_TYPE !== 'indic_ctc' ||
      !speechProfileReady(shared)
    )
  })
}

export const prepareIndicSpeechModelUpdate = (
  config: SherpaConfig,
  onStatus?: (status: string) => void
) => queueSpeechDownload(() => ensureAsrModels(config, onStatus, false, 'only-indic'))

const ensureAsrModels = async (
  sherpaConfig: SherpaConfig,
  onStatus?: (status: string) => void,
  persist = true,
  mode: 'all' | 'only-indic' | 'without-indic' = 'all'
): Promise<SherpaConfig> => {
  const profiles = buildAsrProfiles(sherpaConfig)
  const selected = requestedSpeechLanguages(sherpaConfig)
  const selectedForDownload = selected.filter((language) => {
    const indic = speechAsrGroup(language) === 'hindi'
    return mode === 'all' || (mode === 'only-indic' ? indic : !indic)
  })
  let normalizedIndicProfiles = false
  if (
    mode !== 'without-indic' &&
    selectedForDownload.some((language) => speechAsrGroup(language) === 'hindi')
  ) {
    for (const key of [
      'hindi',
      ...selectedForDownload.filter((language) => speechAsrGroup(language) === 'hindi')
    ]) {
      if (
        profiles[key]?.SHERPA_ASR_MANAGED === 'true' &&
        profiles[key].SHERPA_ASR_TYPE !== 'indic_ctc'
      ) {
        delete profiles[key]
        normalizedIndicProfiles = true
      }
    }
  }
  const groups = new Set(
    selectedForDownload
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
  if (
    presets.length === 0 &&
    !normalizedIndicProfiles &&
    selectedForDownload.every(
      (language) => profiles[language] || profiles[speechAsrGroup(language)]
    )
  ) {
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
  const downloadedByPreset: Record<string, string>[] = presets.map(() => ({}))
  const downloadResults: { presetIndex: number; field: string; filepath: string }[] = []
  for (const [presetIndex, original] of presets.entries()) {
    const downloadPreset = async (preset: (typeof presets)[number]) =>
      parallelLimit(
        preset.files.map((file) => async () => {
          const filepath = await downloadModel(
            preset.repo,
            file.filename,
            (progress) => {
              if (progress.percent) {
                onStatus?.(`Downloading Sherpa ASR ${Math.round(progress.percent)}%...`)
              }
            },
            undefined,
            undefined,
            file.saveAs,
            `sherpa-${preset.id}`,
            `sherpa/asr/${cleanModelId(preset.id)}`
          )
          return { presetIndex, field: file.field, filepath }
        }),
        2
      )
    if (original.asrType === 'indic_ctc') {
      try {
        const fields = new Map(original.files.map((file) => [file.filename, file.field]))
        const { revision, files } = await fetchIndicMirrorManifest([...fields.keys()])
        const directory = path.join(getHfCacheDir(), 'sherpa', 'asr', 'indicconformer')
        const completed = new Map<string, number>()
        const total = files.reduce((sum, file) => sum + file.size, 0)
        let transferred = 0
        let reported = -1
        const reportProgress = (filename: string, bytes: number) => {
          transferred += bytes - (completed.get(filename) ?? 0)
          completed.set(filename, bytes)
          const percent = Math.min(99, Math.floor((transferred / total) * 100))
          if (percent > reported) {
            reported = percent
            onStatus?.(`Downloading Sherpa ASR ${percent}%...`)
          }
        }
        const downloaded = await parallelLimit(
          files.map((file) => async () => {
            const filepath = await downloadIndicMirrorFile(
              directory,
              revision,
              file,
              (url, target) =>
                downloadFileWithProgress(
                  url,
                  target,
                  (_percent, bytes) => reportProgress(file.path, Math.min(bytes, file.size)),
                  AbortSignal.timeout(60 * 60 * 1000)
                )
            )
            reportProgress(file.path, file.size)
            return { filename: file.path, filepath }
          }),
          2
        )
        recordSherpaAsrFiles(original.repo, downloaded)
        downloadResults.push(
          ...downloaded.map(({ filename, filepath }) => ({
            presetIndex,
            filepath,
            field: fields.get(filename) ?? 'asrExternalData'
          }))
        )
        continue
      } catch (error) {
        throw new Error(
          `IndicConformer download failed: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error }
        )
      }
    }
    downloadResults.push(...(await downloadPreset(presets[presetIndex])))
  }
  for (const { presetIndex, field, filepath } of downloadResults) {
    downloadedByPreset[presetIndex][field] = filepath
  }

  for (const [presetIndex, preset] of presets.entries()) {
    const downloaded = downloadedByPreset[presetIndex]
    const profile = compactEnv({
      SHERPA_ASR_NAME: preset.id,
      SHERPA_ASR_MANAGED: true,
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
    if (shared?.SHERPA_ASR_TYPE === 'indic_ctc') {
      if (nextProfiles[language]?.SHERPA_ASR_MANAGED === 'true') delete nextProfiles[language]
    } else if (
      shared &&
      (!nextProfiles[language] || nextProfiles[language].SHERPA_ASR_MANAGED === 'true')
    ) {
      nextProfiles[language] = shared
    }
  }
  // Share only preset languages, without treating them as requests for unrelated TTS downloads.
  for (const language of SPEECH_ASR_LANGUAGES) {
    const group = speechAsrGroup(language)
    const shared = nextProfiles[group]
    if (
      shared &&
      shared.SHERPA_ASR_TYPE !== 'indic_ctc' &&
      speechProfileReady(shared) &&
      (!nextProfiles[language] || nextProfiles[language].SHERPA_ASR_MANAGED === 'true')
    )
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
  }
  for (const file of files.filter((file) => file.filename.endsWith('.fst'))) {
    result.push({ filename: file.filename, saveAs: basename(file.filename), field: 'ttsRuleFst' })
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
  const selected = requestedSpeechLanguages(sherpaConfig)
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
        (preset.ttsType === 'vits' &&
          !preset.repo.includes('vits-mms-') &&
          !modelFiles.some((file) => file.field === 'ttsLexicon'))
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

export const isSherpaStarting = (): boolean => pendingStart !== null

export const startSherpa = (
  port: number | null = null,
  onStatus?: (status: string) => void,
  preparedConfig?: SherpaConfig,
  { installedOnly = false } = {}
): Promise<{ url: string; pid: number }> => {
  if (pendingStart) return pendingStart
  pendingStart = startSherpaInternal(port, onStatus, preparedConfig, installedOnly)
    .catch((error) => {
      if (!ptyProcess) lock.release()
      status = 'failed'
      logBuffer.push(`\r\n[Sherpa startup failed] ${String(error)}\r\n`)
      throw error
    })
    .finally(() => {
      pendingStart = null
    })
  return pendingStart
}

export const ensureSherpaStartupDependencies = async (
  speechConfig: SherpaConfig,
  onStatus?: (status: string) => void,
  { restore = false, includeIndic = true, onlyIndic = false } = {}
): Promise<void> => {
  const requiredPackages = onlyIndic
    ? []
    : [
        'sherpa-onnx',
        'fast-langdetect',
        'soundfile',
        'fastapi',
        'uvicorn',
        'python-multipart',
        'faster-whisper'
      ]

  if (
    includeIndic &&
    requestedSpeechLanguages(speechConfig).some((language) => speechAsrGroup(language) === 'hindi')
  )
    requiredPackages.push('kaldi-native-fbank', 'onnxruntime', 'scipy')

  const installedVersions = restore ? await getExactPackageVersions(requiredPackages) : undefined
  let installerChecked = restore
  for (const pkg of requiredPackages) {
    const pinnedVersion =
      pkg === 'sherpa-onnx'
        ? SHERPA_ONNX_VERSION
        : pkg === 'kaldi-native-fbank'
          ? '1.22.3'
          : pkg === 'faster-whisper'
            ? '1.2.1'
            : pkg === 'onnxruntime' && process.platform === 'darwin'
              ? '1.23.2'
              : undefined
    const installed = installedVersions ? Boolean(installedVersions[pkg]) : isPackageInstalled(pkg)
    const version = installedVersions
      ? installedVersions[pkg]
      : pinnedVersion
        ? getPackageVersion(pkg)
        : undefined
    if (!installed || (pinnedVersion && version !== pinnedVersion)) {
      if (!installerChecked) {
        if (!isUvInstalled()) await repairStartupPythonPackage('uv', onStatus)
        installerChecked = true
      }
      onStatus?.(`Installing ${pkg}...`)
      await installPackage(pkg, pinnedVersion, onStatus, { upgrade: !restore })
    }
  }
}

const startSherpaInternal = async (
  port: number | null,
  onStatus: ((status: string) => void) | undefined,
  preparedConfig: SherpaConfig | undefined,
  installedOnly: boolean
): Promise<{ url: string; pid: number }> => {
  if (!lock.acquire()) {
    if (url && pid) return { url, pid }
    throw new Error('Sherpa is already starting')
  }

  await stopSherpa()
  ensureServerScript()

  if (!isPythonInstalled()) {
    if (installedOnly) throw new Error('Bundled Python is missing or incomplete.')
    onStatus?.('Installing Python...')
    const ok = await installPython(undefined, onStatus, { preserveExisting: true })
    if (!ok) throw new Error('Python installation failed')
  }

  if (!installedOnly) {
    const speechConfig = preparedConfig ?? (await getConfig()).sherpa ?? {}
    await ensureSherpaStartupDependencies(speechConfig, onStatus, {
      includeIndic: speechProfileReady(buildAsrProfiles(speechConfig).hindi)
    })
    try {
      await ensureFfmpeg(onStatus)
    } catch (err) {
      log.warn('Failed to ensure ffmpeg for sherpa audio decoding:', err)
    }
  }

  const config = await getConfig()
  const configEnvVars = config.envVars ?? {}
  let sherpaConfig: SherpaConfig = { ...(preparedConfig ?? config.sherpa ?? {}) }
  if (!preparedConfig && !installedOnly) {
    sherpaConfig = await ensureDefaultAsrModel(sherpaConfig, onStatus, false, 'without-indic')
    sherpaConfig = await ensureDefaultTtsModel(sherpaConfig, onStatus, false, false)
    await setConfig({ sherpa: { ...(config.sherpa ?? {}), ...sherpaConfig } })
  }
  const asrProfiles = buildAsrProfiles(sherpaConfig)
  // The recognizer discovers the external tensors from ONNX; only the desktop needs their list.
  for (const profile of Object.values(asrProfiles)) delete profile.SHERPA_ASR_EXTERNAL_FILES
  const ttsProfiles = buildTtsProfiles(sherpaConfig)
  const legacyAsr = sherpaConfig.asrPreset === RETIRED_INDIC_ASR_REPO ? {} : sherpaConfig

  // log.info('Sherpa TTS profiles:', sherpaConfigTts)
  const host = '127.0.0.1'
  const desiredPort = port || sherpaConfig.port || 39384
  let availablePort = desiredPort
  while (await portInUse(availablePort, host)) {
    if (installedOnly) throw new Error(`Sherpa port ${desiredPort} is occupied.`)
    availablePort++
    if (availablePort > desiredPort + 100) {
      throw new Error('No available port found for sherpa')
    }
  }

  const scriptPath = getServerScriptPath()
  const pythonPath = getPythonPath()
  const commandArgs = ['-Iu', scriptPath, '--host', host, '--port', availablePort.toString()]

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
        SHERPA_LANGUAGE_ALIASES: JSON.stringify(SPEECH_LANGUAGE_ALIASES),
        SHERPA_ASR_PROFILES: JSON.stringify(asrProfiles),
        SHERPA_TTS_PROFILES: JSON.stringify(ttsProfiles),
        ...(sherpaConfig.language ? { SHERPA_LANGUAGE: sherpaConfig.language } : {}),
        ...(legacyAsr.asrPreset ? { SHERPA_ASR_NAME: legacyAsr.asrPreset } : {}),
        ...(sherpaConfig.ttsPreset ? { SHERPA_TTS_NAME: sherpaConfig.ttsPreset } : {}),
        ...(legacyAsr.asrModel ? { SHERPA_ASR_MODEL: legacyAsr.asrModel } : {}),
        ...(legacyAsr.asrEncoder ? { SHERPA_ASR_ENCODER: legacyAsr.asrEncoder } : {}),
        ...(legacyAsr.asrDecoder ? { SHERPA_ASR_DECODER: legacyAsr.asrDecoder } : {}),
        ...(legacyAsr.asrJoiner ? { SHERPA_ASR_JOINER: legacyAsr.asrJoiner } : {}),
        ...(legacyAsr.asrPreprocessor
          ? { SHERPA_ASR_PREPROCESSOR: legacyAsr.asrPreprocessor }
          : {}),
        ...(legacyAsr.asrCachedDecoder
          ? { SHERPA_ASR_CACHED_DECODER: legacyAsr.asrCachedDecoder }
          : {}),
        ...(legacyAsr.asrUncachedDecoder
          ? { SHERPA_ASR_UNCACHED_DECODER: legacyAsr.asrUncachedDecoder }
          : {}),
        ...(legacyAsr.asrMergedDecoder
          ? { SHERPA_ASR_MERGED_DECODER: legacyAsr.asrMergedDecoder }
          : {}),
        ...(legacyAsr.asrTokens ? { SHERPA_ASR_TOKENS: legacyAsr.asrTokens } : {}),
        ...(legacyAsr.asrType ? { SHERPA_ASR_TYPE: legacyAsr.asrType } : {}),
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
    if (ptyProcess !== spawned) return
    logBuffer.push(data)
    if (logBuffer.length > 500) logBuffer.shift()
    log.info(`[sherpa:${spawnedPid}] ${data.replace(/[\r\n]+/g, ' ').trim()}`)
  })

  spawned.onExit(({ exitCode, signal }) => {
    if (ptyProcess !== spawned) return
    const exitMsg = `\r\n[sherpa exited with code ${exitCode}${signal ? ` signal ${signal}` : ''}]\r\n`
    logBuffer.push(exitMsg)
    log.info(`[sherpa:${spawnedPid}] Exited code=${exitCode} signal=${signal}`)
    ptyProcess = null
    pid = null
    url = null
    status = 'failed'
    lock.release()
  })

  const serverUrl = `http://${host}:${availablePort}`
  url = serverUrl
  try {
    await waitForSherpaRepairReady({ url: serverUrl, pid: spawnedPid }, false)
  } catch (error) {
    await stopSherpa(true)
    throw error
  }
  status = 'started'
  log.info(`sherpa service started - PID: ${spawnedPid}, URL: ${serverUrl}`)

  if (!preparedConfig) {
    const currentConfig = await getConfig()
    await setConfig({ sherpa: { ...currentConfig.sherpa, enabled: true, port: availablePort } })
  }

  return { url: serverUrl, pid: spawnedPid }
}

export const prepareSherpaRepairModels = (
  config: SherpaConfig,
  onStatus?: (status: string) => void
) =>
  queueSpeechDownload(async () => {
    const withAsr = await ensureAsrModels(config, onStatus, false)
    return ensureTtsModels(withAsr, onStatus, false, false)
  })

export const checkSherpaRepairModels = (config: SherpaConfig, languages: string[]): string[] => {
  const asr = buildAsrProfiles(config)
  const tts = buildTtsProfiles(config)
  for (const language of languages) {
    const support = speechModelSupport(language)
    const asrProfile = asr[language] ?? asr[speechAsrGroup(language)]
    if (support.asr && !speechProfileReady(asrProfile))
      throw new Error(`Missing Sherpa ASR files: ${language}`)
    if (support.tts && !speechProfileReady(tts[language]))
      throw new Error(`Missing Sherpa TTS files: ${language}`)
  }
  return []
}

export const waitForSherpaRepairReady = async (
  server: { url: string; pid: number },
  requireModels = true
): Promise<void> => {
  const deadline = Date.now() + 25_000
  while (Date.now() < deadline) {
    if (pid !== server.pid || !isProcessAlive(server.pid)) break
    try {
      const response = await fetch(new URL('/health', server.url), {
        signal: AbortSignal.timeout(1_000),
        redirect: 'error'
      })
      const health = response.ok ? await response.json() : (await response.body?.cancel(), null)
      if (
        health?.ok === true &&
        (!requireModels || (health.asr_configured === true && health.tts_configured === true)) &&
        pid === server.pid
      )
        return
    } catch {
      // Allow the new process to finish importing dependencies and bind its port.
    }
    await delay(400)
  }
  throw new Error(
    requireModels
      ? 'Sherpa did not report ready speech models. Check the Sherpa log and try again.'
      : 'Sherpa did not become ready. Check the Sherpa log and try again.'
  )
}

export const verifySherpaRecognition = async (
  server: { url: string; pid: number },
  language: string,
  expectedProfile?: string
): Promise<void> => {
  // One second of generated PCM silence; no microphone or user recordings are read.
  const wave = new ArrayBuffer(44 + 32_000)
  const header = new DataView(wave)
  header.setUint32(0, 0x52494646) // RIFF
  header.setUint32(4, wave.byteLength - 8, true)
  header.setUint32(8, 0x57415645) // WAVE
  header.setUint32(12, 0x666d7420) // fmt
  header.setUint32(16, 16, true)
  header.setUint16(20, 1, true)
  header.setUint16(22, 1, true)
  header.setUint32(24, 16_000, true)
  header.setUint32(28, 32_000, true)
  header.setUint16(32, 2, true)
  header.setUint16(34, 16, true)
  header.setUint32(36, 0x64617461) // data
  header.setUint32(40, 32_000, true)

  const form = new FormData()
  form.append('file', new Blob([wave], { type: 'audio/wav' }), 'speech-repair-test.wav')
  form.append('language', language)
  const asr = await fetch(new URL('/v1/audio/transcriptions', server.url), {
    method: 'POST',
    body: form,
    redirect: 'error',
    signal: AbortSignal.timeout(45_000)
  })
  if (!asr.ok) {
    await asr.body?.cancel()
    throw new Error(`Sherpa recognition check failed (HTTP ${asr.status}).`)
  }
  const result = await asr.json()
  if (
    typeof result?.text !== 'string' ||
    (expectedProfile && result.profile !== expectedProfile) ||
    pid !== server.pid
  )
    throw new Error('Invalid Sherpa recognition response.')
}

export const verifySherpaRepairSpeech = async (server: {
  url: string
  pid: number
}): Promise<void> => {
  await verifySherpaRecognition(server, 'zh')
  const tts = await fetch(new URL('/v1/audio/speech', server.url), {
    method: 'POST',
    body: JSON.stringify({ input: '\u4f60\u597d', language: 'zh', voice: '0' }),
    headers: { 'Content-Type': 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(45_000)
  })
  if (!tts.ok) {
    await tts.body?.cancel()
    throw new Error(`Sherpa playback check failed (HTTP ${tts.status}).`)
  }
  const audio = await tts.arrayBuffer()
  if (
    audio.byteLength <= 44 ||
    new DataView(audio).getUint32(0) !== 0x52494646 ||
    pid !== server.pid
  )
    throw new Error('Invalid Sherpa playback response.')
}

export const stopSherpa = async (preserveLog = false): Promise<void> => {
  if (ptyProcess) {
    const current = ptyProcess
    const currentPid = pid
    ptyProcess = null
    try {
      current.kill()
    } catch (e) {
      log.warn('Failed to kill sherpa PTY:', e)
    }
    await delay(1000)
    if (currentPid && isProcessAlive(currentPid)) {
      try {
        process.kill(currentPid, 'SIGKILL')
      } catch {}
      for (let attempt = 0; attempt < 10 && isProcessAlive(currentPid); attempt++) {
        await delay(100)
      }
      if (isProcessAlive(currentPid)) {
        ptyProcess = current
        throw new Error('The Sherpa process is still using Python files.')
      }
    }
  }
  ptyProcess = null
  pid = null
  url = null
  if (!preserveLog || status !== 'failed') status = null
  if (!preserveLog) logBuffer = []
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
