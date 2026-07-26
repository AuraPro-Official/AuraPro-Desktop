import * as tar from 'tar'
import fs from 'fs'
import path from 'path'
import log from 'electron-log'
import * as pty from 'node-pty'
import { rmSync } from 'fs'
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
import { DEFAULT_ASR_PRESETS, DEFAULT_TTS_PRESETS, SERVER_SOURCE } from './sherp_config'

let ptyProcess: pty.IPty | null = null
let pid: number | null = null
let url: string | null = null
let status: string | null = null
let logBuffer: string[] = []

const lock = new ServiceLock('sherpa')
type SherpaPreset = (typeof DEFAULT_TTS_PRESETS)[number]
type SherpaPresetFile = SherpaPreset['files'][number]

interface SherpaConfig {
  [key: string]: unknown
  enabled?: boolean
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
  if (!fs.existsSync(scriptPath)) {
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
    profiles.others ??= legacyProfile
    if ((sherpaConfig.asrLanguage ?? '').toLowerCase().includes('chinese')) {
      profiles.zh ??= legacyProfile
    }
  }

  return profiles
}

const cleanModelId = (id: string): string =>
  id.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')

const REQUIRED_ASR_PROFILE_KEYS = [
  'zh',
  'en',
  'es',
  'fr',
  'de',
  'pt',
  'vi',
  'ja',
  'ko',
  'th',
  'tl',
  'ar',
  'hindi',
  'ru',
  'eu',
  'asia',
  'others'
]

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

/**
 * Build the expected SHERPA_ASR_NAME per profile key from DEFAULT_ASR_PRESETS.
 * Used to detect when a stored profile is using an outdated model and needs re-download.
 */
const buildExpectedProfileModelMap = (): Record<string, string> => {
  const map: Record<string, string> = {}
  for (const preset of DEFAULT_ASR_PRESETS) {
    for (const key of preset.profileKeys) {
      if (!map[key]) map[key] = preset.id // first preset per key wins
    }
  }
  return map
}

const hasAsrProfile = (profiles: Record<string, Record<string, string>>): boolean => {
  const expectedModels = buildExpectedProfileModelMap()
  return REQUIRED_ASR_PROFILE_KEYS.every((key) => {
    const profile = profiles[key]
    // Missing entirely
    if (!profile?.SHERPA_ASR_MODEL && !profile?.SHERPA_ASR_ENCODER) return false
    // If the stored model name doesn't match the current preset, treat as outdated
    const expectedId = expectedModels[key]
    const storedId = profile?.SHERPA_ASR_NAME
    if (expectedId && storedId && storedId !== expectedId) return false
    return true
  })
}

export const ensureDefaultAsrModel = async (
  sherpaConfig: SherpaConfig,
  onStatus?: (status: string) => void,
  isDelete?: boolean,
  persist = true
): Promise<SherpaConfig> => {
  if (isDelete) {
    onStatus?.('Deleting old ASR models...')
    const asrDir = path.join(getHfCacheDir(), 'sherpa/asr')
    if (fs.existsSync(asrDir)) {
      try {
        rmSync(asrDir, { recursive: true, force: true })
        log.info('Deleted ASR models directory:', asrDir)
      } catch (err) {
        log.warn('Failed to delete ASR models directory:', err)
      }
    }
  }

  const profiles = buildAsrProfiles(sherpaConfig)
  if (!isDelete && hasAsrProfile(profiles)) {
    return sherpaConfig
  }

  onStatus?.('Downloading recommended Sherpa ASR models...')
  const updates: SherpaConfig = {
    asrPreset: DEFAULT_ASR_PRESETS[0].id,
    asrType: DEFAULT_ASR_PRESETS[0].asrType,
    asrModel: '',
    asrTokens: '',
    asrAutoDetect: true,
    asrLanguageDetectorModel: sherpaConfig.asrLanguageDetectorModel || 'large-v3-turbo',
    asrLanguageDetectorDevice: sherpaConfig.asrLanguageDetectorDevice || 'cpu',
    asrLanguageDetectorComputeType: sherpaConfig.asrLanguageDetectorComputeType || 'int8'
  }

  const nextProfiles = { ...(sherpaConfig.asrProfiles ?? {}) }
  const downloadTasks = DEFAULT_ASR_PRESETS.flatMap((preset, presetIndex) =>
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
    })
  )
  const downloadedByPreset: Record<string, string>[] = DEFAULT_ASR_PRESETS.map(() => ({}))
  const downloadResults = await parallelLimit(downloadTasks, 4)
  for (const { presetIndex, field, filepath } of downloadResults) {
    downloadedByPreset[presetIndex][field] = filepath
  }

  for (const [presetIndex, preset] of DEFAULT_ASR_PRESETS.entries()) {
    const downloaded = downloadedByPreset[presetIndex]
    const profile = compactEnv({
      SHERPA_ASR_NAME: preset.id,
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
      SHERPA_ASR_NUM_THREADS: sherpaConfig.asrNumThreads ?? 4,
      SHERPA_ASR_PROVIDER: sherpaConfig.asrProvider ?? 'cpu',
      SHERPA_LANGUAGE: preset.language
    })

    for (const key of preset.profileKeys) {
      nextProfiles[key] = profile
    }

    if (preset.profileKeys.includes('zh')) {
      updates.asrModel = downloaded.asrModel
      updates.asrTokens = downloaded.asrTokens
    }
  }
  updates.asrProfiles = nextProfiles

  const nextSherpaConfig = { ...sherpaConfig, ...updates }
  if (persist) {
    const current = await getConfig()
    await setConfig({ sherpa: { ...(current?.sherpa ?? {}), ...nextSherpaConfig } })
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
const dirname = (filename: string) => filename.replace(/[\\/][^\\/]*$/, '')
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
    .filter((file) => file.filename.toLowerCase().replace(/\\/g, '/').startsWith('dict/'))
    .map((file) => file.filename)
  const voices =
    firstFile(files, (name) => name.endsWith('.bin') && name.includes('voices')) ||
    firstFile(files, (name) => name.endsWith('.pt') && name.includes('voices')) ||
    firstFile(files, (name) => name.endsWith('.npy') && name.includes('voices'))

  const model =
    firstFile(files, (name) => name.endsWith('.onnx') && name.includes('int8')) ||
    firstFile(files, (name) => name.endsWith('.onnx') && name.includes('model')) ||
    firstFile(files, (name) => name.endsWith('.onnx'))

  if (!model || !tokens) return []

  const repo = preset.repo.toLowerCase()
  const inferredType = repo.includes('kokoro')
    ? 'kokoro'
    : repo.includes('kitten')
      ? 'kitten'
      : 'vits'
  preset.ttsType = inferredType
  const definedFields = new Set(preset.files?.map((f) => f.field) || [])

  const result: SherpaPresetFile[] = []
  if (preset.files && preset.files.length > 0) {
    for (const f of preset.files) {
      result.push({ ...f })
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
    for (const lexicon of lexicons) {
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

  return inferredType === 'vits' || voices ? result : []
}

export const ensureDefaultTtsModel = async (
  sherpaConfig: SherpaConfig,
  onStatus?: (status: string) => void,
  isDelete?: boolean,
  persist = true
): Promise<SherpaConfig> => {
  if (isDelete) {
    onStatus?.('Deleting old TTS models...')
    const ttsDir = path.join(getHfCacheDir(), 'sherpa/tts')
    if (fs.existsSync(ttsDir)) {
      try {
        rmSync(ttsDir, { recursive: true, force: true })
        log.info('Deleted TTS models directory:', ttsDir)
      } catch (err) {
        log.warn('Failed to delete TTS models directory:', err)
      }
    }
  }

  const profiles = buildTtsProfiles(sherpaConfig)
  if (!isDelete && (profiles.default?.SHERPA_TTS_MODEL || profiles.en?.SHERPA_TTS_MODEL)) {
    return sherpaConfig
  }

  const espeakDataPromise = ensureEspeakData(onStatus).catch((error) => {
    log.warn('Failed to prepare shared espeak data, will fallback to per-model download', error)
    return ''
  })

  onStatus?.('Downloading recommended Sherpa TTS models...')
  log.info('No Sherpa TTS model found in config, downloading default models...')
  const updates: SherpaConfig = {
    ttsPreset: DEFAULT_TTS_PRESETS[0].id,
    ttsType: DEFAULT_TTS_PRESETS[0].ttsType,
    ttsModel: '',
    ttsTokens: '',
    ttsVoices: ''
  }

  const nextProfiles = { ...(sherpaConfig.ttsProfiles ?? {}) }
  const presetResults = await parallelLimit(
    DEFAULT_TTS_PRESETS.map((preset) => async () => {
      onStatus?.(`Downloading ${preset.id}...`)

      log.info(`Fetched files for repo ${preset.repo}:`)
      const repoFiles = await getRepoFiles(preset.repo)
      preset.files = getTtsFiles(preset, repoFiles)
      const espeakDataDir = await espeakDataPromise

      const tasks = preset.files.map((file) => async () => {
        if (file.field === 'ttsDataDirFile') {
          return { field: file.field, filepath: espeakDataDir }
        }

        const filepath = await downloadModel(
          preset.repo,
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
        downloaded[field] = filepath
      }
      return { preset, downloaded, espeakDataDir }
    }),
    3
  )

  for (const { preset, downloaded, espeakDataDir } of presetResults) {
    let dataDir = ''
    if (downloaded.ttsDataDirFile) {
      dataDir = espeakDataDir
    }

    const profile = compactEnv({
      SHERPA_TTS_NAME: preset.id,
      SHERPA_TTS_TYPE: preset.ttsType,
      SHERPA_TTS_MODEL: downloaded.ttsModel,
      SHERPA_TTS_TOKENS: downloaded.ttsTokens,
      SHERPA_TTS_VOICES: downloaded.ttsVoices,
      SHERPA_TTS_LEXICON: downloaded.ttsLexicon,
      SHERPA_TTS_DATA_DIR: dataDir,
      SHERPA_TTS_DICT_DIR: dirname(downloaded.ttsDictDirFile || ''),
      SHERPA_TTS_NUM_THREADS: sherpaConfig.ttsNumThreads ?? 4,
      SHERPA_TTS_PROVIDER: sherpaConfig.ttsProvider ?? 'cpu',
      SHERPA_TTS_LANG: preset.language
    })

    for (const key of preset.profileKeys) {
      nextProfiles[key] = profile
    }

    if (!updates.ttsModel && downloaded.ttsModel) {
      updates.ttsModel = downloaded.ttsModel
      updates.ttsTokens = downloaded.ttsTokens
      updates.ttsVoices = downloaded.ttsVoices
    }
  }
  updates.ttsProfiles = nextProfiles

  const nextSherpaConfig = { ...sherpaConfig, ...updates }
  if (persist) {
    const current = await getConfig()
    await setConfig({ sherpa: { ...(current?.sherpa ?? {}), ...nextSherpaConfig } })
  }
  onStatus?.('Sherpa TTS models are ready')
  return nextSherpaConfig
}

export const getSherpaInfo = () => ({
  url,
  status,
  pid,
  version: getPackageVersion('sherpa-onnx')
})

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

  for (const pkg of requiredPackages) {
    if (!isPackageInstalled(pkg)) {
      onStatus?.(`Installing ${pkg}...`)
      await installPackage(pkg, undefined, onStatus)
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
  const modelSetupResults = await Promise.allSettled([
    ensureDefaultAsrModel(sherpaConfig, onStatus, false, false),
    ensureDefaultTtsModel(sherpaConfig, onStatus, false, false)
  ])
  const modelSetupFailure = modelSetupResults.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  )
  if (modelSetupFailure) throw modelSetupFailure.reason

  const [asrConfig, ttsConfig] = modelSetupResults.map(
    (result) => (result as PromiseFulfilledResult<SherpaConfig>).value
  )
  sherpaConfig = {
    ...sherpaConfig,
    ...Object.fromEntries(Object.entries(asrConfig).filter(([key]) => key.startsWith('asr'))),
    ...Object.fromEntries(Object.entries(ttsConfig).filter(([key]) => key.startsWith('tts')))
  }
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
