<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import { config } from '../../../stores'
  import i18n from '../../../i18n'
  import { getErrorMessage } from '../../../utils/errors'
  import { K2_ASR_MODELS, K2_TTS_MODELS } from './sherpa-model-catalog'

  type SherpaPresetFile = {
    filename: string
    saveAs: string
    field: string
  }

  type SherpaPreset = {
    id: string
    label: string
    repo: string
    language?: string
    files?: SherpaPresetFile[]
    asrType?: string
    ttsType?: string
  }

  type HfFileInfo = {
    filename: string
    size?: number
  }

  type SherpaProfile = Record<string, string>

  interface SherpaConfig {
    [key: string]: unknown
    enabled?: boolean
    language?: string
    asrLanguage?: string
    asrAutoDetect?: boolean
    asrLanguageDetectorModel?: string
    asrLanguageDetectorDevice?: string
    asrLanguageDetectorComputeType?: string
    asrProfiles?: Record<string, SherpaProfile>
    asrPreset?: string
    asrType?: string
    asrModel?: string
    asrEncoder?: string
    asrDecoder?: string
    asrJoiner?: string
    asrPreprocessor?: string
    asrCachedDecoder?: string
    asrUncachedDecoder?: string
    asrMergedDecoder?: string
    asrTokens?: string
    ttsLanguage?: string
    ttsProfiles?: Record<string, SherpaProfile>
    ttsPreset?: string
    ttsType?: string
    ttsModel?: string
    ttsTokens?: string
    ttsLexicon?: string
    ttsVoices?: string
    ttsDataDir?: string
    ttsDictDir?: string
  }

  interface SherpaModel {
    filename: string
    [key: string]: unknown
  }

  interface SherpaEventPayload {
    filename?: string
    percent?: number
    version?: string
    url?: string
    pid?: number
  }

  interface SherpaEvent {
    type: string
    data?: string | SherpaEventPayload
  }

  const bundledAsrPresets: SherpaPreset[] = [
    {
      id: 'csukuangfj/sherpa-onnx-paraformer-zh-small-2024-03-09',
      label: 'Paraformer small Chinese/English',
      language: 'Chinese',
      repo: 'csukuangfj/sherpa-onnx-paraformer-zh-small-2024-03-09',
      asrType: 'paraformer',
      files: [
        {
          filename: 'model.int8.onnx',
          saveAs: 'sherpa-asr-paraformer-zh-small-model.int8.onnx',
          field: 'asrModel'
        },
        {
          filename: 'tokens.txt',
          saveAs: 'sherpa-asr-paraformer-zh-small-tokens.txt',
          field: 'asrTokens'
        }
      ]
    },
    {
      id: 'csukuangfj/sherpa-onnx-paraformer-zh-2024-03-09',
      label: 'Paraformer Chinese/English',
      language: 'Chinese',
      repo: 'csukuangfj/sherpa-onnx-paraformer-zh-2024-03-09',
      asrType: 'paraformer',
      files: [
        {
          filename: 'model.int8.onnx',
          saveAs: 'sherpa-asr-paraformer-zh-model.int8.onnx',
          field: 'asrModel'
        },
        {
          filename: 'tokens.txt',
          saveAs: 'sherpa-asr-paraformer-zh-tokens.txt',
          field: 'asrTokens'
        }
      ]
    }
  ]

  const bundledTtsPresets: SherpaPreset[] = [
    {
      id: 'csukuangfj/vits-zh-aishell3|174 speakers',
      label: 'VITS Chinese Aishell3 int8',
      language: 'Chinese (Mandarin, 普通话)',
      repo: 'csukuangfj/vits-zh-aishell3',
      files: [
        {
          filename: 'vits-aishell3.int8.onnx',
          saveAs: 'sherpa-tts-vits-zh-aishell3.int8.onnx',
          field: 'ttsModel'
        },
        {
          filename: 'tokens.txt',
          saveAs: 'sherpa-tts-vits-zh-aishell3-tokens.txt',
          field: 'ttsTokens'
        },
        {
          filename: 'lexicon.txt',
          saveAs: 'sherpa-tts-vits-zh-aishell3-lexicon.txt',
          field: 'ttsLexicon'
        }
      ]
    }
  ]

  const asrPresets: SherpaPreset[] = K2_ASR_MODELS.map((model) => ({
    id: model.id,
    label: model.label,
    language: model.language,
    repo: model.repo,
    ...(bundledAsrPresets.find((preset) => preset.id === model.id) ?? {})
  }))

  const ttsPresets: SherpaPreset[] = K2_TTS_MODELS.map((model) => ({
    id: model.id,
    label: model.label,
    language: model.language,
    repo: model.repo,
    ...(bundledTtsPresets.find((preset) => preset.id === model.id) ?? {})
  }))

  let sherpaConfig = $state<SherpaConfig>({})
  let sherpaInfo = $state<{ url?: string; status?: string; pid?: number } | null>(null)
  let setupStatus = $state('')
  let downloading = $state<string | null>(null)
  let downloadProgress = $state<Record<string, number>>({})
  let starting = $state(false)
  let stopping = $state(false)
  let updating = $state(false)
  let uninstalling = $state(false)
  let installing = $state(false)
  let loaded = $state(false)
  let restarting = $state(false)

  let sherpaVersion = $state<string | null>(null)
  let downloadedAsrModels = $state<SherpaModel[]>([])
  let downloadedTtsModels = $state<SherpaModel[]>([])
  let audioInputDeviceId = $state('')
  let audioOutputDeviceId = $state('')
  let audioInputDevices = $state<MediaDeviceInfo[]>([])
  let audioOutputDevices = $state<MediaDeviceInfo[]>([])
  let cleanup: (() => void) | null = null

  const installed = $derived(sherpaVersion !== null)
  const selectedAsrLanguage = $derived(sherpaConfig.asrLanguage ?? 'Chinese')
  const selectedTtsLanguage = $derived(sherpaConfig.ttsLanguage ?? 'Chinese (Mandarin, 普通话)')
  const filteredAsrPresets = $derived(
    asrPresets.filter((preset) => preset.language === selectedAsrLanguage)
  )
  const filteredTtsPresets = $derived(
    ttsPresets.filter((preset) => preset.language === selectedTtsLanguage)
  )
  const selectedAsrPreset = $derived(
    asrPresets.find(
      (preset) =>
        preset.id ===
        (sherpaConfig.asrPreset ?? 'csukuangfj/sherpa-onnx-paraformer-zh-small-2024-03-09')
    ) ??
      filteredAsrPresets[0] ??
      asrPresets[0]
  )
  const selectedTtsPreset = $derived(
    ttsPresets.find(
      (preset) =>
        preset.id === (sherpaConfig.ttsPreset ?? 'csukuangfj/vits-zh-aishell3|174 speakers')
    ) ??
      filteredTtsPresets[0] ??
      ttsPresets[0]
  )
  const selectedAsrDownloadable = $derived(Boolean(selectedAsrPreset))
  const selectedTtsDownloadable = $derived(Boolean(selectedTtsPreset))
  const asrReady = $derived(
    Boolean(
      (sherpaConfig.asrModel &&
        (sherpaConfig.asrTokens || ['nemo_ctc', 'sense_voice'].includes(sherpaConfig.asrType))) ||
      (sherpaConfig.asrEncoder &&
        (sherpaConfig.asrDecoder ||
          sherpaConfig.asrCachedDecoder ||
          sherpaConfig.asrUncachedDecoder ||
          sherpaConfig.asrMergedDecoder))
    )
  )
  const ttsReady = $derived(
    Boolean(
      (sherpaConfig.ttsModel && sherpaConfig.ttsTokens) ||
      Object.values(sherpaConfig.ttsProfiles ?? {}).some((profile) => profile.SHERPA_TTS_MODEL)
    )
  )
  const serviceRunning = $derived(sherpaInfo?.status === 'started')

  const refreshSherpaModels = async () => {
    downloadedAsrModels = (await window.electronAPI.listSherpaModels?.('asr')) ?? []
    downloadedTtsModels = (await window.electronAPI.listSherpaModels?.('tts')) ?? []
  }

  const refreshAudioDevices = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    const devices = await navigator.mediaDevices.enumerateDevices()
    audioInputDevices = devices.filter((device) => device.kind === 'audioinput')
    audioOutputDevices = devices.filter((device) => device.kind === 'audiooutput')
  }

  const requestAudioDeviceLabels = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((track) => track.stop())
    await refreshAudioDevices()
  }

  const saveAudioDevice = async (
    key: 'audioInputDeviceId' | 'audioOutputDeviceId',
    value: string
  ) => {
    if (key === 'audioInputDeviceId') audioInputDeviceId = value
    if (key === 'audioOutputDeviceId') audioOutputDeviceId = value
    await window.electronAPI.setConfig({ [key]: value })
    config.set(await window.electronAPI.getConfig())
  }

  const load = async () => {
    const cfg = await window.electronAPI.getConfig()
    audioInputDeviceId = cfg?.audioInputDeviceId ?? ''
    audioOutputDeviceId = cfg?.audioOutputDeviceId ?? ''
    sherpaConfig = {
      language: 'zh-CN',
      asrLanguage: 'Chinese',
      asrAutoDetect: true,
      asrLanguageDetectorModel: 'large-v3-turbo',
      asrLanguageDetectorDevice: 'cpu',
      asrLanguageDetectorComputeType: 'int8',
      asrProfiles: {},
      ttsLanguage: 'Chinese (Mandarin, 普通话)',
      asrPreset: 'csukuangfj/sherpa-onnx-paraformer-zh-small-2024-03-09',
      ttsPreset: 'csukuangfj/vits-zh-aishell3|174 speakers',
      ttsProfiles: {},
      ...(cfg?.sherpa ?? {})
    }
    if (sherpaConfig.asrPreset === 'paraformer-zh-small') {
      sherpaConfig.asrPreset = 'csukuangfj/sherpa-onnx-paraformer-zh-small-2024-03-09'
    } else if (sherpaConfig.asrPreset === 'paraformer-zh') {
      sherpaConfig.asrPreset = 'csukuangfj/sherpa-onnx-paraformer-zh-2024-03-09'
    }
    if (sherpaConfig.ttsPreset === 'vits-zh-aishell3-int8') {
      sherpaConfig.ttsPreset = 'csukuangfj/vits-zh-aishell3|174 speakers'
    }
    sherpaInfo = await window.electronAPI.getSherpaInfo()
    sherpaVersion =
      sherpaInfo?.version ?? (await window.electronAPI.getPackageVersion('sherpa-onnx'))
    await refreshSherpaModels()
    await refreshAudioDevices()
  }

  const saveSherpaConfig = async (updates: SherpaConfig) => {
    const current = await window.electronAPI.getConfig()
    const sherpa = { ...(current?.sherpa ?? {}), ...sherpaConfig, ...updates }
    await window.electronAPI.setConfig({ sherpa })
    config.set(await window.electronAPI.getConfig())
    sherpaConfig = sherpa
  }

  const basename = (filename: string) => filename.split('/').pop() ?? filename
  const cleanId = (id: string) => id.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  const asrProfileKeysForPreset = (preset: SherpaPreset) => {
    const language = (preset.language ?? '').toLowerCase()
    const repo = (preset.repo ?? preset.id ?? '').toLowerCase()

    if (language.includes('chinese') || repo.includes('-zh') || repo.includes('chinese'))
      return ['zh', 'default', 'others']
    if (language.includes('english') || repo.includes('-en') || repo.includes('english'))
      return ['en', 'others']
    if (language.includes('spanish') || repo.includes('-es') || repo.includes('spanish'))
      return ['es', 'others']
    if (language.includes('french') || repo.includes('-fr') || repo.includes('french'))
      return ['fr', 'others']
    if (language.includes('german') || repo.includes('-de') || repo.includes('german'))
      return ['de', 'others']
    if (language.includes('portuguese') || repo.includes('-pt') || repo.includes('portuguese'))
      return ['pt', 'others']
    if (language.includes('vietnamese') || repo.includes('-vi') || repo.includes('vietnamese'))
      return ['vi', 'asia', 'others']
    if (language.includes('japanese') || repo.includes('-ja') || repo.includes('japanese'))
      return ['ja', 'asia', 'others']
    if (language.includes('korean') || repo.includes('-ko') || repo.includes('korean'))
      return ['ko', 'asia', 'others']
    if (language.includes('thai') || repo.includes('-th') || repo.includes('thai'))
      return ['th', 'asia', 'others']
    if (language.includes('russian') || repo.includes('-ru') || repo.includes('russian'))
      return ['ru', 'others']
    if (language.includes('arabic') || repo.includes('-ar') || repo.includes('arabic'))
      return ['ar', 'others']
    if (
      language.includes('tagalog') ||
      language.includes('filipino') ||
      repo.includes('tagalog') ||
      repo.includes('filipino')
    )
      return ['tl', 'asia', 'others']
    if (
      language.includes('hindi') ||
      language.includes('urdu') ||
      language.includes('bengali') ||
      language.includes('tamil')
    )
      return ['hindi', 'others']
    if (
      language.includes('japanese') ||
      language.includes('korean') ||
      language.includes('thai') ||
      language.includes('vietnamese')
    )
      return ['asia', 'others']
    if (
      language.includes('english') ||
      language.includes('spanish') ||
      language.includes('french') ||
      language.includes('german') ||
      language.includes('italian') ||
      language.includes('portuguese') ||
      language.includes('europe')
    )
      return ['eu', 'others']

    return ['others']
  }

  const ttsProfileKeysForPreset = (preset: SherpaPreset): string[] => {
    const language = (preset.language ?? '').toLowerCase()
    const repo = (preset.repo ?? preset.id ?? '').toLowerCase()

    if (language.includes('chinese') || repo.includes('-zh')) return ['zh', 'default', 'others']
    if (language.includes('english') || repo.includes('-en')) return ['en', 'default', 'others']
    if (language.includes('spanish') || repo.includes('-es')) return ['es', 'others']
    if (language.includes('french') || repo.includes('-fr')) return ['fr', 'others']
    if (language.includes('german') || repo.includes('-de')) return ['de', 'others']
    if (language.includes('portuguese') || repo.includes('-pt')) return ['pt', 'others']
    if (language.includes('russian') || repo.includes('-ru')) return ['ru', 'others']
    if (language.includes('japanese') || repo.includes('-ja')) return ['ja', 'others']
    if (language.includes('korean') || repo.includes('-ko')) return ['ko', 'others']
    if (language.includes('multilang') || repo.includes('multi')) return ['default', 'others']
    return ['others']
  }

  const buildAsrProfile = (updates: SherpaConfig, preset: SherpaPreset) => {
    const profile: Record<string, string> = {
      SHERPA_ASR_NAME: preset.id,
      SHERPA_ASR_TYPE: updates.asrType ?? preset.asrType ?? 'paraformer',
      SHERPA_ASR_MODEL: updates.asrModel ?? '',
      SHERPA_ASR_ENCODER: updates.asrEncoder ?? '',
      SHERPA_ASR_DECODER: updates.asrDecoder ?? '',
      SHERPA_ASR_JOINER: updates.asrJoiner ?? '',
      SHERPA_ASR_PREPROCESSOR: updates.asrPreprocessor ?? '',
      SHERPA_ASR_CACHED_DECODER: updates.asrCachedDecoder ?? '',
      SHERPA_ASR_UNCACHED_DECODER: updates.asrUncachedDecoder ?? '',
      SHERPA_ASR_MERGED_DECODER: updates.asrMergedDecoder ?? '',
      SHERPA_ASR_TOKENS: updates.asrTokens ?? '',
      SHERPA_ASR_NUM_THREADS: '4',
      SHERPA_ASR_PROVIDER: 'cpu',
      SHERPA_LANGUAGE: sherpaConfig.language ?? 'zh-CN'
    }
    return Object.fromEntries(Object.entries(profile).filter(([, value]) => Boolean(value)))
  }

  const buildTtsProfile = (updates: SherpaConfig, preset: SherpaPreset) => {
    const profile: Record<string, string> = {
      SHERPA_TTS_NAME: preset.id,
      SHERPA_TTS_TYPE: updates.ttsType ?? preset.ttsType ?? 'vits',
      SHERPA_TTS_MODEL: updates.ttsModel ?? '',
      SHERPA_TTS_TOKENS: updates.ttsTokens ?? '',
      SHERPA_TTS_VOICES: updates.ttsVoices ?? '',
      SHERPA_TTS_LEXICON: updates.ttsLexicon ?? '',
      SHERPA_TTS_DATA_DIR: updates.ttsDataDir ?? '',
      SHERPA_TTS_DICT_DIR: updates.ttsDictDir ?? '',
      SHERPA_TTS_LANG: preset.language ?? '',
      SHERPA_TTS_NUM_THREADS: '4',
      SHERPA_TTS_PROVIDER: 'cpu'
    }
    return Object.fromEntries(Object.entries(profile).filter(([, v]) => Boolean(v)))
  }

  const firstFile = (files: HfFileInfo[], predicate: (filename: string) => boolean) =>
    files.find((file) => predicate(file.filename.toLowerCase()))?.filename ?? ''

  const inferAsrFiles = (preset: SherpaPreset, repoFiles: HfFileInfo[]): SherpaPresetFile[] => {
    if (preset.files?.length) return preset.files

    const files = repoFiles.filter(
      (file) => !file.filename.toLowerCase().includes('README'.toLowerCase())
    )
    const tokens = firstFile(files, (name) => name.endsWith('tokens.txt'))
    const repoKey = cleanId(preset.id)
    const repo = preset.repo.toLowerCase()
    const encoder = firstFile(files, (name) => name.endsWith('.onnx') && name.includes('encoder'))
    const decoder = firstFile(files, (name) => name.endsWith('.onnx') && name.includes('decoder'))
    const joiner = firstFile(files, (name) => name.endsWith('.onnx') && name.includes('joiner'))

    if (repo.includes('whisper') && encoder && decoder) {
      preset.asrType = 'whisper'
      return [
        {
          filename: encoder,
          saveAs: `sherpa-asr-${repoKey}-${basename(encoder)}`,
          field: 'asrEncoder'
        },
        {
          filename: decoder,
          saveAs: `sherpa-asr-${repoKey}-${basename(decoder)}`,
          field: 'asrDecoder'
        }
      ]
    }

    if (repo.includes('moonshine') && encoder) {
      const preprocessor = firstFile(
        files,
        (name) => name.endsWith('.onnx') && name.includes('preprocessor')
      )
      const cached = firstFile(files, (name) => name.endsWith('.onnx') && name.includes('cached'))
      const uncached = firstFile(
        files,
        (name) => name.endsWith('.onnx') && name.includes('uncached')
      )
      const merged = firstFile(files, (name) => name.endsWith('.onnx') && name.includes('merged'))
      preset.asrType = 'moonshine'
      return [
        ...(preprocessor
          ? [
              {
                filename: preprocessor,
                saveAs: `sherpa-asr-${repoKey}-${basename(preprocessor)}`,
                field: 'asrPreprocessor'
              }
            ]
          : []),
        {
          filename: encoder,
          saveAs: `sherpa-asr-${repoKey}-${basename(encoder)}`,
          field: 'asrEncoder'
        },
        ...(decoder
          ? [
              {
                filename: decoder,
                saveAs: `sherpa-asr-${repoKey}-${basename(decoder)}`,
                field: 'asrDecoder'
              }
            ]
          : []),
        ...(cached
          ? [
              {
                filename: cached,
                saveAs: `sherpa-asr-${repoKey}-${basename(cached)}`,
                field: 'asrCachedDecoder'
              }
            ]
          : []),
        ...(uncached
          ? [
              {
                filename: uncached,
                saveAs: `sherpa-asr-${repoKey}-${basename(uncached)}`,
                field: 'asrUncachedDecoder'
              }
            ]
          : []),
        ...(merged
          ? [
              {
                filename: merged,
                saveAs: `sherpa-asr-${repoKey}-${basename(merged)}`,
                field: 'asrMergedDecoder'
              }
            ]
          : [])
      ]
    }

    if (encoder && decoder && joiner && tokens) {
      preset.asrType = repo.includes('streaming-zipformer') ? 'online_transducer' : 'transducer'
      return [
        {
          filename: encoder,
          saveAs: `sherpa-asr-${repoKey}-${basename(encoder)}`,
          field: 'asrEncoder'
        },
        {
          filename: decoder,
          saveAs: `sherpa-asr-${repoKey}-${basename(decoder)}`,
          field: 'asrDecoder'
        },
        {
          filename: joiner,
          saveAs: `sherpa-asr-${repoKey}-${basename(joiner)}`,
          field: 'asrJoiner'
        },
        {
          filename: tokens,
          saveAs: `sherpa-asr-${repoKey}-${basename(tokens)}`,
          field: 'asrTokens'
        }
      ]
    }

    const model =
      firstFile(files, (name) => name.endsWith('.onnx') && name.includes('int8')) ||
      firstFile(files, (name) => name.endsWith('.onnx') && name.includes('model')) ||
      firstFile(files, (name) => name.endsWith('.onnx'))

    if (model && tokens) {
      preset.asrType = repo.includes('zipformer-ctc')
        ? 'zipformer_ctc'
        : repo.includes('wenet')
          ? 'wenet_ctc'
          : repo.includes('nemo')
            ? 'nemo_ctc'
            : repo.includes('sense-voice')
              ? 'sense_voice'
              : 'paraformer'
      return [
        { filename: model, saveAs: `sherpa-asr-${repoKey}-${basename(model)}`, field: 'asrModel' },
        {
          filename: tokens,
          saveAs: `sherpa-asr-${repoKey}-${basename(tokens)}`,
          field: 'asrTokens'
        }
      ]
    }

    if (model && (repo.includes('sense-voice') || repo.includes('nemo'))) {
      preset.asrType = repo.includes('sense-voice') ? 'sense_voice' : 'nemo_ctc'
      return [
        { filename: model, saveAs: `sherpa-asr-${repoKey}-${basename(model)}`, field: 'asrModel' }
      ]
    }

    return []
  }

  const ttsLocaleCodes = (preset: SherpaPreset): SvelteSet<string> => {
    const text = `${preset.repo} ${preset.id}`.toLowerCase()
    const match = text.match(/vits-piper-([a-z]{2,3})[_-]([a-z]{2})/)
    const codes = new SvelteSet<string>()
    if (match) {
      const lang = match[1]
      const region = match[2]
      codes.add(lang)
      codes.add(`${lang}-${region}`)
      codes.add(`${lang}_${region}`)
    }
    const language = (preset.language ?? '').toLowerCase()
    if (language.includes('english')) codes.add('en')
    if (language.includes('spanish')) codes.add('es')
    if (language.includes('chinese')) {
      codes.add('zh')
      codes.add('cmn')
    }
    return codes
  }

  const isMatchingTtsLanguageFile = (filename: string, codes: Set<string>): boolean => {
    const name = filename.toLowerCase().replace(/\\/g, '/')
    const base = basename(name)

    if (name.startsWith('espeak-ng-data/lang/')) {
      return [...codes].some(
        (code) => base === code || base.startsWith(`${code}-`) || base.startsWith(`${code}_`)
      )
    }

    if (name.startsWith('espeak-ng-data/') && base.endsWith('_dict')) {
      return [...codes].some((code) => {
        const normalized = code.replace('-', '_')
        return base === `${normalized}_dict` || base === `${code}_dict`
      })
    }

    if (name.startsWith('dict/')) {
      return [...codes].some(
        (code) => base === code || base.startsWith(`${code}.`) || base.startsWith(`${code}_`)
      )
    }

    return false
  }

  const inferTtsFiles = (preset: SherpaPreset, repoFiles: HfFileInfo[]): SherpaPresetFile[] => {
    if (preset.files?.length) {
      preset.ttsType = preset.ttsType ?? 'vits'
      return preset.files
    }

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
    const commonEspeakFiles = new SvelteSet(['phontab', 'phonindex', 'phondata', 'intonations'])
    const dataFiles = files
      .filter((file) => {
        const name = file.filename.toLowerCase().replace(/\\/g, '/')
        const base = basename(name)
        return (
          name.startsWith('espeak-ng-data/') &&
          (commonEspeakFiles.has(base) || isMatchingTtsLanguageFile(name, localeCodes))
        )
      })
      .map((file) => file.filename)
    const dictFiles = files
      .filter(
        (file) =>
          file.filename.toLowerCase().replace(/\\/g, '/').startsWith('dict/') &&
          isMatchingTtsLanguageFile(file.filename, localeCodes)
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

    if (!model || !tokens) return []

    const repo = preset.repo.toLowerCase()
    const inferredType = repo.includes('kokoro')
      ? 'kokoro'
      : repo.includes('kitten')
        ? 'kitten'
        : 'vits'
    preset.ttsType = inferredType

    const result: SherpaPresetFile[] = [
      { filename: model, saveAs: `sherpa-tts-${repoKey}-${basename(model)}`, field: 'ttsModel' },
      { filename: tokens, saveAs: `sherpa-tts-${repoKey}-${basename(tokens)}`, field: 'ttsTokens' }
    ]

    if ((inferredType === 'kokoro' || inferredType === 'kitten') && voices) {
      result.push({
        filename: voices,
        saveAs: `sherpa-tts-${repoKey}-${basename(voices)}`,
        field: 'ttsVoices'
      })
    }
    for (const lexicon of lexicons) {
      result.push({
        filename: lexicon,
        saveAs: `sherpa-tts-${repoKey}-${basename(lexicon)}`,
        field: 'ttsLexicon'
      })
    }

    if (inferredType === 'kokoro' || repo.includes('piper')) {
      for (const file of dataFiles) {
        result.push({
          filename: file,
          saveAs: `sherpa-tts-${repoKey}/${file}`,
          field: 'ttsDataDirFile'
        })
      }
    }

    if (inferredType === 'kokoro') {
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

  const downloadTTSModel = async (isDelete?: boolean) => {
    await window.electronAPI.downloadSherpaTTSModel(isDelete)
  }

  const downloadAsrModel = async (isDelete?: boolean) => {
    await window.electronAPI.downloadSherpaAsrModel(isDelete)
  }

  const _downloadPreset = async (kind: 'asr' | 'tts', isDelete?: boolean) => {
    const preset = kind === 'asr' ? selectedAsrPreset : selectedTtsPreset
    downloading = preset.id
    setupStatus = isDelete
      ? `Deleting and refreshing ${preset.label}...`
      : `Inspecting ${preset.repo}...`
    let files = preset.files ?? []
    if (!files.length) {
      const repoFiles = await window.electronAPI.getHfRepoFiles(preset.repo)
      files = kind === 'asr' ? inferAsrFiles(preset, repoFiles) : inferTtsFiles(preset, repoFiles)
    }

    if (!files.length) {
      setupStatus =
        'This model repository is listed, but AuraPro could not infer the required Sherpa files automatically yet.'
      downloading = null
      return
    }
    setupStatus = `Downloading ${preset.label}...`
    downloadProgress = {}

    try {
      const updates: SherpaConfig =
        kind === 'asr'
          ? {
              asrPreset: preset.id,
              asrType: preset.asrType ?? 'paraformer',
              asrModel: '',
              asrEncoder: '',
              asrDecoder: '',
              asrJoiner: '',
              asrPreprocessor: '',
              asrCachedDecoder: '',
              asrUncachedDecoder: '',
              asrMergedDecoder: ''
            }
          : {
              ttsPreset: preset.id,
              ttsType: preset.ttsType ?? 'vits',
              ttsModel: '',
              ttsTokens: '',
              ttsLexicon: '',
              ttsVoices: '',
              ttsDataDir: '',
              ttsDictDir: ''
            }

      const shouldReload = serviceRunning || sherpaConfig.enabled

      for (const file of files) {
        const filepath = await window.electronAPI.downloadHfModel(
          preset.repo,
          file.filename,
          undefined,
          undefined,
          file.saveAs,
          `sherpa-${preset.id}`,
          `sherpa/${kind}/${cleanId(preset.id)}`
        )
        if (!filepath) throw new Error(`Download failed: ${file.filename}`)
        updates[file.field] = filepath
      }

      if (kind === 'asr' && updates.asrType === 'transducer') {
        updates.asrModel = ''
      }

      if (kind === 'asr') {
        const nextProfiles = { ...(sherpaConfig.asrProfiles ?? {}) }
        const profile = buildAsrProfile(updates, preset)
        for (const key of asrProfileKeysForPreset(preset)) {
          nextProfiles[key] = profile
        }
        updates.asrAutoDetect = true
        updates.asrLanguageDetectorModel = sherpaConfig.asrLanguageDetectorModel ?? 'large-v3-turbo'
        updates.asrLanguageDetectorDevice = sherpaConfig.asrLanguageDetectorDevice ?? 'cpu'
        updates.asrLanguageDetectorComputeType =
          sherpaConfig.asrLanguageDetectorComputeType ?? 'int8'
        updates.asrProfiles = nextProfiles
      }

      if (kind === 'tts') {
        const nextProfiles = { ...(sherpaConfig.ttsProfiles ?? {}) }
        const profile = buildTtsProfile(updates, preset)
        for (const key of ttsProfileKeysForPreset(preset)) {
          nextProfiles[key] = profile
        }
        updates.ttsProfiles = nextProfiles
      }

      await saveSherpaConfig(updates)
      await refreshSherpaModels()

      if (shouldReload) {
        setupStatus = 'Reloading Sherpa...'
        await window.electronAPI.stopSherpa()
        const result = await window.electronAPI.startSherpa()
        sherpaInfo = { ...result, status: 'started' }
        await saveSherpaConfig({ enabled: true })
        setupStatus = 'Model is ready and Sherpa has been reloaded'
      } else {
        setupStatus = 'Model is ready'
      }
    } catch (error: unknown) {
      setupStatus = getErrorMessage(error, 'Download failed')
    } finally {
      downloading = null
    }
  }

  const installSherpa = async () => {
    installing = true
    setupStatus = 'Installing Sherpa...'
    try {
      await window.electronAPI.reinitSherpaServerScript?.()
      const result = await window.electronAPI.startSherpa()
      sherpaInfo = { ...result, status: 'started' }
      sherpaVersion = await window.electronAPI.getPackageVersion('sherpa-onnx')
      await saveSherpaConfig({ enabled: true })
      setupStatus = 'Sherpa installed and started'
    } catch (error: unknown) {
      setupStatus = getErrorMessage(error, 'Install failed')
    } finally {
      installing = false
    }
  }

  const uninstallSherpa = async () => {
    if (
      !confirm(
        $i18n.t('settings.sherpa.uninstallConfirm') || '确定要卸载 Sherpa 吗？此操作不可逆。'
      )
    ) {
      return
    }

    uninstalling = true
    setupStatus = 'Uninstalling Sherpa...'
    try {
      await window.electronAPI.stopSherpa()
      await window.electronAPI.uninstallPackage?.('sherpa-onnx') // 需要后端支持此 API
      sherpaInfo = null
      sherpaVersion = null
      setupStatus = 'Sherpa has been uninstalled'
    } catch (error: unknown) {
      setupStatus = getErrorMessage(error, 'Uninstall failed')
    } finally {
      uninstalling = false
    }
  }

  const startSherpa = async () => {
    starting = true
    setupStatus = ''
    try {
      const result = await window.electronAPI.startSherpa()
      sherpaInfo = { ...result, status: 'started' }
      await saveSherpaConfig({ enabled: true })
    } catch (error: unknown) {
      setupStatus = getErrorMessage(error, 'Failed to start sherpa')
    } finally {
      starting = false
    }
  }

  const restartSherpa = async () => {
    restarting = true
    setupStatus = 'Restarting Sherpa...'
    try {
      await window.electronAPI.stopSherpa()
      const result = await window.electronAPI.startSherpa()
      sherpaInfo = { ...result, status: 'started' }
      await saveSherpaConfig({ enabled: true })
      setupStatus = 'Sherpa restarted'
    } catch (error: unknown) {
      setupStatus = getErrorMessage(error, 'Failed to restart sherpa')
    } finally {
      restarting = false
    }
  }

  const updateSherpa = async () => {
    updating = true
    setupStatus = 'Updating Sherpa...'
    try {
      await window.electronAPI.updateSherpa?.()
      await window.electronAPI.reinitSherpaServerScript?.()
      sherpaInfo = await window.electronAPI.getSherpaInfo()
      sherpaVersion =
        sherpaInfo?.version ?? (await window.electronAPI.getPackageVersion('sherpa-onnx'))
      setupStatus = 'Sherpa updated'
    } catch (error: unknown) {
      setupStatus = getErrorMessage(error, 'Failed to update sherpa')
    } finally {
      updating = false
    }
  }

  const stopSherpa = async () => {
    stopping = true
    try {
      await window.electronAPI.stopSherpa()
      sherpaInfo = { status: 'stopped' }
      await saveSherpaConfig({ enabled: false })
    } finally {
      stopping = false
    }
  }

  onMount(async () => {
    console.log('Initializing Sherpa settings...')
    await window.electronAPI.reinitSherpaServerScript?.()

    await load()
    loaded = true

    cleanup = window.electronAPI.onData((data: SherpaEvent) => {
      if (data.type === 'status:sherpa' && typeof data.data === 'string') {
        sherpaInfo = { ...sherpaInfo, status: data.data }
      }
      if (data.type === 'status:sherpa-setup') {
        setupStatus = typeof data.data === 'string' ? data.data : ''
      }
      if (data.type === 'sherpa:ready' && data.data && typeof data.data !== 'string') {
        sherpaInfo = { ...data.data, status: 'started' }
        sherpaVersion = data.data?.version ?? sherpaVersion
      }
      if (
        data.type === 'status:huggingface-download' &&
        data.data &&
        typeof data.data !== 'string' &&
        data.data.filename
      ) {
        downloadProgress = {
          ...downloadProgress,
          [data.data.filename]: Math.round(data.data.percent ?? 0)
        }
      }
    })
  })

  onDestroy(() => {
    cleanup?.()
  })
</script>

<div class="space-y-5">
  <div class="flex items-center justify-between">
    <div>
      <div class="text-[13px] opacity-70">Sherpa speech service</div>
      <div class="text-[11px] opacity-30 mt-0.5">
        {#if installed}
          {serviceRunning ? (sherpaInfo?.url ?? 'Running') : 'Voice input and TTS'}
          {#if sherpaVersion}
            - sherpa-onnx {sherpaVersion}{/if}
        {:else}
          Not installed
        {/if}
      </div>
    </div>

    {#if installed}
      <div class="flex gap-2">
        {#if serviceRunning}
          <button
            class="text-[12px] opacity-50 hover:opacity-80 px-3 py-1.5 bg-black/[0.04] dark:bg-white/[0.06] rounded-xl border-none"
            disabled={restarting || stopping}
            onclick={restartSherpa}
          >
            {restarting ? '重启中...' : '重启'}
          </button>
          <button
            class="text-[12px] opacity-50 hover:opacity-80 px-3 py-1.5 bg-black/[0.04] dark:bg-white/[0.06] rounded-xl border-none"
            disabled={stopping}
            onclick={stopSherpa}
          >
            {stopping ? '停止中...' : '停止'}
          </button>
        {:else}
          <button
            class="text-[12px] opacity-60 hover:opacity-90 px-3 py-1.5 bg-black/[0.06] dark:bg-white/[0.08] rounded-xl border-none"
            disabled={starting || !asrReady || !ttsReady}
            onclick={startSherpa}
          >
            {starting ? '启动中...' : '启动'}
          </button>
        {/if}
        <button
          class="text-[12px] opacity-50 hover:opacity-80 px-3 py-1.5 bg-black/[0.04] dark:bg-white/[0.06] rounded-xl border-none"
          disabled={updating}
          onclick={updateSherpa}
        >
          {updating ? '更新中...' : '更新'}
        </button>
        <button
          class="text-[12px] opacity-50 hover:opacity-80 px-3 py-1.5 bg-black/[0.04] dark:bg-white/[0.06] rounded-xl border-none"
          disabled={uninstalling}
          onclick={uninstallSherpa}
        >
          {uninstalling ? '卸载中...' : '卸载'}
        </button>
      </div>
    {:else}
      <button
        class="text-[12px] opacity-60 hover:opacity-90 px-6 py-1.5 bg-black/[0.04] dark:bg-white/[0.06] text-white rounded-xl border-none flex items-center gap-2"
        disabled={installing}
        onclick={installSherpa}
      >
        {#if installing}
          <div
            class="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin"
          ></div>
          安装中...
        {:else}
          安装 Sherpa
        {/if}
      </button>
    {/if}
  </div>

  {#if !loaded}
    <div class="py-6 text-[12px] opacity-20 text-center">{$i18n.t('common.loading')}</div>
  {:else if installed}
    <!-- 已安装状态 -->
    <div class="space-y-5">
      <!-- 音频设备 -->
      <div class="py-4 border-t border-black/[0.04] dark:border-white/[0.04]">
        <div class="flex items-center justify-between gap-4">
          <div class="min-w-0">
            <div class="text-[13px] opacity-70">{$i18n.t('settings.speech.audioDevices')}</div>
            <div class="text-[11px] opacity-30 mt-0.5 truncate">
              {$i18n.t('settings.speech.audioDevicesDesc')}
            </div>
          </div>
          <button
            class="text-[12px] opacity-60 hover:opacity-90 px-3 py-1.5 bg-black/[0.06] dark:bg-white/[0.08] rounded-xl border-none shrink-0"
            onclick={requestAudioDeviceLabels}
          >
            {$i18n.t('common.refresh')}
          </button>
        </div>
        <div class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <select
            class="w-full bg-black/[0.04] dark:bg-white/[0.06] rounded-xl px-3 py-2 text-[12px] outline-none"
            value={audioInputDeviceId}
            onchange={(e) => saveAudioDevice('audioInputDeviceId', e.currentTarget.value)}
          >
            <option value="">{$i18n.t('settings.speech.defaultMicrophone')}</option>
            {#each audioInputDevices as device, index (device.deviceId)}
              <option value={device.deviceId}
                >{device.label ||
                  $i18n.t('settings.speech.microphoneNumber', { number: index + 1 })}</option
              >
            {/each}
          </select>
          <select
            class="w-full bg-black/[0.04] dark:bg-white/[0.06] rounded-xl px-3 py-2 text-[12px] outline-none"
            value={audioOutputDeviceId}
            onchange={(e) => saveAudioDevice('audioOutputDeviceId', e.currentTarget.value)}
            disabled={!('setSinkId' in HTMLMediaElement.prototype)}
          >
            <option value="">{$i18n.t('settings.speech.defaultSpeaker')}</option>
            {#each audioOutputDevices as device, index (device.deviceId)}
              <option value={device.deviceId}
                >{device.label ||
                  $i18n.t('settings.speech.speakerNumber', { number: index + 1 })}</option
              >
            {/each}
          </select>
        </div>
      </div>

      <div class="py-4 border-t border-black/[0.04] dark:border-white/[0.04]">
        <div class="flex items-center justify-between gap-4">
          <div class="min-w-0">
            <div class="text-[13px] opacity-70">Automatic voice input</div>
            <div class="text-[11px] opacity-30 mt-0.5 truncate">
              Detects language with faster-whisper and switches Sherpa ASR automatically
            </div>
          </div>
          <button
            class="text-[12px] opacity-60 hover:opacity-90 px-3 py-1.5 bg-black/[0.06] dark:bg-white/[0.08] rounded-xl border-none shrink-0"
            disabled={downloading !== null}
            onclick={() => downloadAsrModel(true)}
          >
            {downloading === selectedAsrPreset.id
              ? 'Downloading...'
              : selectedAsrDownloadable
                ? asrReady
                  ? 'Update base ASR'
                  : 'Download base ASR'
                : 'Download'}
          </button>
        </div>
        <div class="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
          <div class="rounded-xl bg-black/[0.03] dark:bg-white/[0.04] px-3 py-2">
            <div class="opacity-35">Language detection</div>
            <div class="opacity-60 truncate">
              {sherpaConfig.asrLanguageDetectorModel ?? 'large-v3-turbo'} / CPU int8
            </div>
          </div>
          <div class="rounded-xl bg-black/[0.03] dark:bg-white/[0.04] px-3 py-2">
            <div class="opacity-35">Routing profiles</div>
            <div class="opacity-60 truncate">
              {Object.keys(sherpaConfig.asrProfiles ?? {}).length || (asrReady ? 1 : 0)} ready
            </div>
          </div>
          <div class="rounded-xl bg-black/[0.03] dark:bg-white/[0.04] px-3 py-2">
            <div class="opacity-35">Fallback ASR</div>
            <div class="opacity-60 truncate">
              {asrReady ? selectedAsrPreset.label : 'Not downloaded'}
            </div>
          </div>
        </div>
        {#if downloadedAsrModels.length > 0}
          <div class="mt-3 rounded-xl bg-black/[0.03] dark:bg-white/[0.04] px-3 py-2">
            <div class="text-[11px] opacity-40 mb-1">Downloaded voice input model pool</div>
            {#each downloadedAsrModels.slice(0, 8) as model (model.filename)}
              <div class="text-[11px] opacity-55 truncate">{model.filename}</div>
            {/each}
          </div>
        {/if}
      </div>

      <div class="py-4 border-t border-black/[0.04] dark:border-white/[0.04]">
        <div class="flex items-center justify-between gap-4">
          <div class="min-w-0">
            <div class="text-[13px] opacity-70">TTS model</div>
            <div class="text-[11px] opacity-30 mt-0.5 truncate">
              {ttsReady
                ? sherpaConfig.ttsModel
                : selectedTtsDownloadable
                  ? 'Select and download to configure automatically'
                  : 'Listed from k2-fsa Space; loader pending'}
            </div>
          </div>
          <button
            class="text-[12px] opacity-60 hover:opacity-90 px-3 py-1.5 bg-black/[0.06] dark:bg-white/[0.08] rounded-xl border-none shrink-0"
            disabled={downloading !== null}
            onclick={() => downloadTTSModel(true)}
          >
            {downloading === selectedTtsPreset.id
              ? 'Downloading...'
              : selectedTtsDownloadable
                ? ttsReady
                  ? 'Update'
                  : 'Download'
                : 'Select'}
          </button>
        </div>
        <div class="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
          <div class="rounded-xl bg-black/[0.03] dark:bg-white/[0.04] px-3 py-2">
            <div class="opacity-35">Routing profiles</div>
            <div class="opacity-60 truncate">
              {Object.keys(sherpaConfig.ttsProfiles ?? {}).length || (ttsReady ? 1 : 0)} ready
            </div>
          </div>
          <div class="rounded-xl bg-black/[0.03] dark:bg-white/[0.04] px-3 py-2">
            <div class="opacity-35">Fallback TTS</div>
            <div class="opacity-60 truncate">
              {ttsReady ? selectedTtsPreset.label : 'Not downloaded'}
            </div>
          </div>
        </div>
        {#if downloadedTtsModels.length > 0}
          <div class="mt-3 rounded-xl bg-black/[0.03] dark:bg-white/[0.04] px-3 py-2">
            <div class="text-[11px] opacity-40 mb-1">Downloaded TTS models</div>
            {#each downloadedTtsModels.slice(0, 8) as model (model.filename)}
              <div class="text-[11px] opacity-55 truncate">{model.filename}</div>
            {/each}
          </div>
        {/if}
      </div>

      {#if setupStatus || Object.keys(downloadProgress).length > 0}
        <div
          class="rounded-xl bg-black/[0.04] dark:bg-white/[0.05] px-3 py-2 text-[11px] opacity-60"
        >
          <div>{setupStatus}</div>
          {#each Object.entries(downloadProgress) as [filename, percent] (filename)}
            <div class="mt-1">{filename}: {percent}%</div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>
