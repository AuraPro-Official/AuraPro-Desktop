<script lang="ts">
  import ModelCapabilityBadges from '../../common/ModelCapabilityBadges.svelte'
  import {
    INDEX_TRANSLATE_MODELS,
    indexTranslateCatalogEntry
  } from '../../../../../../shared/index-translate-models'
  import { onMount } from 'svelte'
  import { fade, scale } from 'svelte/transition'
  import i18n from '../../../i18n'
  import { detectWindowsLlamaVariant } from '../../../utils/llamacpp'
  import {
    proRequirementLabel,
    recommendWizardModel,
    standardGuide,
    standardRequirementLabel,
    type ModelPreference
  } from '../../../utils/install-model-recommendation'
  import Switch from '../../common/Switch.svelte'
  import HardwareDetectionStatus from '../../Setup/HardwareDetectionStatus.svelte'
  import ProModelSwitch from '../../Setup/ProModelSwitch.svelte'
  import UnsupportedInstallPathDialog from '../../Setup/UnsupportedInstallPathDialog.svelte'
  import {
    SPEECH_TTS_REPOS,
    SPEECH_ASR_LANGUAGES,
    selectedSpeechLanguages
  } from '../../../../../../main/utils/speech-language-presets'

  interface Props {
    onContinue: (options: {
      installOpenCode: boolean
      installLlamaCpp: boolean
      installSherpa: boolean
      speechLanguages: string[]
      installDir: string
      selectedModel: AuraModel
      llamaCppVariant?: string
      ragHardwareAcceleration?: boolean
    }) => void
    onCancel: () => void
  }

  interface AuraModel {
    name: string
    sizeStr: string
    repo: string
    hfRepo: string
    filename: string
    mmprojRepo: string
    mmprojFilename: string
    mtpRepo?: string
    mtpFilename?: string
    sizeBytes: number
    macOnly?: boolean
    proModelId?: string
    proPreset?: string
  }

  interface SystemInfo {
    totalMemGB?: number
    architecture?: string
    dedicatedVramGB?: number
    gpuName?: string
  }

  let { onContinue, onCancel }: Props = $props()

  const AURA_MODELS: AuraModel[] = [
    indexTranslateCatalogEntry(INDEX_TRANSLATE_MODELS.lowest),
    {
      name: 'low_E4.gguf',
      sizeStr: '~5G',
      repo: 'AuraPro',
      hfRepo: 'unsloth/gemma-4-E4B-it-qat-GGUF',
      filename: 'gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf',
      mmprojRepo: 'unsloth/gemma-4-E4B-it-qat-GGUF',
      mmprojFilename: 'mmproj-F16.gguf',
      mtpRepo: 'unsloth/gemma-4-E4B-it-qat-GGUF',
      mtpFilename: 'mtp-gemma-4-E4B-it.gguf',
      sizeBytes: 5 * 1024 * 1024 * 1024
    },
    {
      name: 'medium_IQ2.gguf',
      sizeStr: '~11G',
      repo: 'AuraPro',
      hfRepo: 'unsloth/gemma-4-26B-A4B-it-GGUF',
      filename: 'gemma-4-26B-A4B-it-UD-Q2_K_XL.gguf',
      mmprojRepo: 'unsloth/gemma-4-26B-A4B-it-GGUF',
      mmprojFilename: 'mmproj-F16.gguf',
      mtpRepo: 'unsloth/gemma-4-26B-A4B-it-GGUF',
      mtpFilename: 'mtp-gemma-4-26B-A4B-it.gguf',
      sizeBytes: 11 * 1024 * 1024 * 1024
    },
    indexTranslateCatalogEntry(INDEX_TRANSLATE_MODELS.mediumQ3),
    indexTranslateCatalogEntry(INDEX_TRANSLATE_MODELS.medium),
    {
      name: 'high_Q4.gguf',
      sizeStr: '~15G',
      repo: 'AuraPro',
      hfRepo: 'unsloth/gemma-4-26B-A4B-it-qat-GGUF',
      filename: 'gemma-4-26B-A4B-it-qat-UD-Q4_K_XL.gguf',
      mmprojRepo: 'unsloth/gemma-4-26B-A4B-it-qat-GGUF',
      mmprojFilename: 'mmproj-F16.gguf',
      mtpRepo: 'unsloth/gemma-4-26B-A4B-it-qat-GGUF',
      mtpFilename: 'mtp-gemma-4-26B-A4B-it.gguf',
      sizeBytes: 15 * 1024 * 1024 * 1024
    },
    indexTranslateCatalogEntry(INDEX_TRANSLATE_MODELS.high)
  ]

  let installOpenCode = $state(false)
  let installSherpa = $state(true)
  let selectedSpeech = $state(['zh'])
  const speechLanguageOptions = [
    ...new Set([...SPEECH_ASR_LANGUAGES, ...Object.keys(SPEECH_TTS_REPOS)])
  ].sort()
  const speechLanguageName = (language: string) => {
    try {
      return new Intl.DisplayNames([$i18n.language], { type: 'language' }).of(language) || language
    } catch {
      return language
    }
  }
  let installDir = $state('')
  let defaultInstallDir = $state('')
  let advancedOpen = $state(false)
  let proMode = $state(false)
  let loadingProModels = $state(true)
  let manualModel = $state<string | null>(null)
  let proModels = $state<AuraModel[]>([])
  let llamaCppVariant = $state('cpu')
  let ragHardwareAcceleration = $state(false)
  let systemMemGB = $state<number | null>(null)
  let systemArchitecture = $state('')
  let dedicatedVramGB = $state(0)
  let proVramGB = $state(0)
  let detectingHardware = $state(true)
  let hardwareDetectionFailed = $state(false)
  let modelPreference = $state<ModelPreference>('quality')
  let showUnsupportedInstallPath = $state(false)
  let diskFreeBytes = $state<number | null>(null)
  let checkingDiskSpace = $state(false)

  const platform = $derived(
    (() => {
      const info = navigator.userAgent
      if (info.includes('Mac')) return 'darwin'
      if (info.includes('Win')) return 'win32'
      return 'linux'
    })()
  )

  const visibleModels = $derived(
    proMode ? proModels : AURA_MODELS.filter((model) => platform === 'darwin' || !model.macOnly)
  )
  const recommendation = $derived(
    recommendWizardModel(
      {
        platform,
        architecture: systemArchitecture,
        memoryGiB: systemMemGB ?? 8,
        vramGiB: proMode ? proVramGB : dedicatedVramGB,
        preference: modelPreference
      },
      AURA_MODELS,
      proModels,
      proMode
    )
  )
  const selectedModel = $derived(
    visibleModels.find((model) => model.filename === manualModel) ?? recommendation
  )

  const setPreference = (preference: ModelPreference) => {
    modelPreference = preference
    manualModel = null
  }

  const setProMode = (value: boolean) => {
    proMode = value
    manualModel = null
  }

  const validateInstallPath = async (): Promise<boolean> => {
    const targetPath = installDir || defaultInstallDir
    checkingDiskSpace = true
    try {
      const result = await window.electronAPI.checkInstallPreflight(targetPath, 0)
      diskFreeBytes = typeof result?.free === 'number' ? result.free : -1
      const supported = result?.pathSupported !== false
      showUnsupportedInstallPath = !supported
      if (!supported) advancedOpen = true
      return supported
    } finally {
      checkingDiskSpace = false
    }
  }

  const detectHardware = async (quickSysInfo?: SystemInfo | null) => {
    detectingHardware = true
    try {
      const sysInfo = await window.electronAPI.getSystemInfo({
        includeDedicatedVram: platform !== 'darwin'
      })
      systemMemGB = sysInfo?.totalMemGB || quickSysInfo?.totalMemGB || 8
      systemArchitecture = sysInfo?.architecture || quickSysInfo?.architecture || ''
      dedicatedVramGB = sysInfo?.dedicatedVramGB || 0
      proVramGB = sysInfo?.proVramGB ?? dedicatedVramGB
    } catch {
      hardwareDetectionFailed = true
      systemMemGB = 8
      systemArchitecture = ''
      dedicatedVramGB = 0
      proVramGB = 0
    } finally {
      detectingHardware = false
    }
  }

  const variantOptions = $derived(
    (() => {
      if (platform === 'darwin') return [{ value: 'cpu', label: 'Apple Metal (Default)' }]
      if (platform === 'win32') {
        if (systemArchitecture === 'arm64') return [{ value: 'cpu', label: 'CPU Only' }]
        return [
          { value: 'cuda-12.4', label: 'NVIDIA CUDA 12.4 (RTX 40 / older)' },
          { value: 'cuda-13.3', label: 'NVIDIA CUDA 13.3 (RTX 50)' },
          { value: 'vulkan', label: 'Vulkan (For AMD / Intel discrete GPU)' },
          { value: 'cpu', label: 'CPU Only' }
        ]
      }
      if (systemArchitecture === 'arm64')
        return [
          { value: 'cpu', label: 'CPU Only' },
          { value: 'vulkan', label: 'Vulkan' }
        ]
      return [
        { value: 'cpu', label: 'CPU Only' },
        { value: 'vulkan', label: 'Vulkan' },
        { value: 'rocm', label: 'ROCm' }
      ]
    })()
  )

  const GIB = 1024 * 1024 * 1024
  const CORE_INSTALL_BYTES = 6 * GIB
  const SHERPA_INSTALL_BYTES = 2 * GIB
  const OPEN_CODE_INSTALL_BYTES = 512 * 1024 * 1024
  const RAG_CUDA_INSTALL_BYTES = 3 * GIB
  const requiredInstallBytes = () =>
    CORE_INSTALL_BYTES +
    (selectedModel?.sizeBytes ?? 0) +
    (installSherpa ? SHERPA_INSTALL_BYTES : 0) +
    (installOpenCode ? OPEN_CODE_INSTALL_BYTES : 0) +
    (llamaCppVariant.startsWith('cuda-') && ragHardwareAcceleration ? RAG_CUDA_INSTALL_BYTES : 0)
  const formatInstallGb = (bytes: number) => {
    const value = bytes / GIB
    return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)
  }

  onMount(async () => {
    const initialConfig = await window.electronAPI.getConfig()
    selectedSpeech = selectedSpeechLanguages(initialConfig?.sherpa ?? {})
    defaultInstallDir = await window.electronAPI.getInstallDir()
    installDir = defaultInstallDir
    await validateInstallPath()

    // Improved Hardware Detection
    try {
      let quickSysInfo: SystemInfo | null = null
      // Detect llama.cpp variant
      if (platform === 'win32') {
        quickSysInfo = await window.electronAPI.getSystemInfo()
        llamaCppVariant = detectWindowsLlamaVariant(quickSysInfo?.gpuName || '')
      } else if (platform === 'darwin') {
        llamaCppVariant = 'cpu' // Metal is built into CPU variant on Mac
      } else {
        llamaCppVariant = 'cpu'
      }

      await detectHardware(quickSysInfo)
    } catch (err) {
      console.error('Hardware detection failed:', err)
      hardwareDetectionFailed = true
      // Fallback to defaults
      llamaCppVariant = 'cpu'
      systemMemGB = 8
      systemArchitecture = ''
      dedicatedVramGB = 0
      proVramGB = 0
      detectingHardware = false
    }
    try {
      const pro = await window.electronAPI.getStrataInfo()
      if (pro.supported) {
        proModels = pro.models.map((model) => ({
          name: `Pro_V1 · ${model.name}`,
          sizeStr: `~${model.sizeGiB}G`,
          repo: '',
          hfRepo: '',
          filename: model.id,
          mmprojRepo: '',
          mmprojFilename: '',
          sizeBytes: model.sizeBytes + 12 * GIB,
          proModelId: model.id,
          proPreset: model.name
        }))
      }
    } catch (error) {
      console.warn('Unable to read Pro setup options:', error)
    } finally {
      loadingProModels = false
    }
  })

  const changeInstallDir = async () => {
    const folder = await window.electronAPI.selectFolder()
    if (folder) {
      installDir = folder
      await validateInstallPath()
    }
  }

  const continueInstall = async (): Promise<void> => {
    const model = selectedModel
    if (!model || detectingHardware) return
    if (!(await validateInstallPath())) return
    if (selectedModel !== model) return
    onContinue({
      installOpenCode,
      installLlamaCpp: !model.proModelId,
      installSherpa,
      speechLanguages: $state.snapshot(selectedSpeech),
      installDir,
      selectedModel: $state.snapshot(model),
      llamaCppVariant,
      ragHardwareAcceleration: llamaCppVariant.startsWith('cuda-') && ragHardwareAcceleration
    })
  }
</script>

<HardwareDetectionStatus detecting={detectingHardware} failed={hardwareDetectionFailed} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto p-2 sm:p-4"
  transition:fade={{ duration: 150 }}
  onmousedown={onCancel}
>
  <div class="absolute inset-0 bg-black/50 backdrop-blur-sm"></div>

  <div
    class="relative w-full max-w-3xl max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain rounded-xl bg-white shadow-2xl sm:rounded-3xl dark:bg-gray-950"
    transition:scale={{ start: 0.97, duration: 180 }}
    onmousedown={(e) => e.stopPropagation()}
  >
    <!-- Visual header -->
    <div
      class="relative flex h-28 items-center justify-center overflow-hidden bg-gradient-to-br from-gray-900 via-gray-800 to-black dark:from-white dark:via-gray-100 dark:to-gray-200"
    >
      <div
        class="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent"
      ></div>
      <div class="relative z-10 text-center">
        <div class="mb-2.5 flex justify-center">
          <div class="rounded-full bg-white/10 p-3 dark:bg-black/10">
            <svg
              class="w-6 h-6 text-white dark:text-gray-900"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z"
              />
            </svg>
          </div>
        </div>
        <h2 class="text-lg font-semibold tracking-tight text-white dark:text-gray-900">
          {$i18n.t('main.getStarted.title')}
        </h2>
        <p class="mt-1 text-xs text-white/60 dark:text-gray-900/50">
          {$i18n.t('main.getStarted.description')}
        </p>
      </div>
    </div>

    <!-- Options -->
    {#if !detectingHardware && hardwareDetectionFailed}
      <div role="status" class="px-6 pt-4 text-sm text-amber-700 dark:text-amber-300">
        {$i18n.t('main.getStarted.hardwareDetectionFailed')}
      </div>
    {/if}
    <div class="px-6 py-4 flex flex-col divide-y divide-gray-100/30 dark:divide-gray-800/15">
      <div class="py-3 flex items-center justify-between gap-4">
        <div>
          <div
            class="text-[13px] font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1.5"
          >
            {proMode ? $i18n.t('settings.pro.title') : $i18n.t('main.getStarted.llamaCpp')}
          </div>
          <div class="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
            {$i18n.t('main.getStarted.llamaCppHardwareDesc')}
          </div>
        </div>
        {#if proMode}
          <span class="text-[12px] text-gray-400 dark:text-gray-500"
            >{platform === 'darwin' ? 'llama.cpp' : 'AuraPro-Engine'} · 18882</span
          >
        {:else}
          <select
            class="bg-gray-50 dark:bg-gray-900 text-[12px] text-gray-700 dark:text-gray-200 px-3 py-1.5 border-none outline-none rounded-xl cursor-pointer"
            onchange={(e) => {
              llamaCppVariant = (e.target as HTMLSelectElement).value
              if (!llamaCppVariant.startsWith('cuda-')) ragHardwareAcceleration = false
            }}
          >
            {#each variantOptions as opt (opt.value)}
              <option value={opt.value} selected={llamaCppVariant === opt.value}>{opt.label}</option
              >
            {/each}
          </select>
        {/if}
      </div>

      {#if llamaCppVariant.startsWith('cuda-')}
        <div class="py-3 flex items-center justify-between gap-4">
          <div>
            <div class="text-[13px] font-medium text-gray-700 dark:text-gray-300">RAG 硬件加速</div>
            <div class="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
              使用 NVIDIA 显卡加速文档检索。开启后会额外安装 CUDA 版 PyTorch。
            </div>
          </div>
          <Switch
            checked={ragHardwareAcceleration}
            onchange={(value) => {
              ragHardwareAcceleration = value
            }}
          />
        </div>
      {/if}

      <div class="py-3 flex items-center justify-between gap-4">
        <div>
          <div class="text-[13px] font-medium text-gray-700 dark:text-gray-300">sherpa</div>
          <div class="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
            {$i18n.t('main.getStarted.sherpaDesc')}
          </div>
        </div>
        <Switch
          checked={installSherpa}
          onchange={(v) => {
            installSherpa = v
          }}
        />
      </div>

      {#if installSherpa}
        <details class="pb-3">
          <summary class="text-[12px] cursor-pointer text-gray-600 dark:text-gray-400"
            >{$i18n.t('settings.speech.enabledLanguages')}: {selectedSpeech
              .map(speechLanguageName)
              .join(', ')}</summary
          >
          <div class="mt-2 grid grid-cols-2 sm:grid-cols-3 max-h-40 overflow-y-auto gap-2">
            {#each speechLanguageOptions as language (language)}
              <label class="text-[12px] flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedSpeech.includes(language)}
                  disabled={language === 'zh'}
                  onchange={(event) => {
                    selectedSpeech = event.currentTarget.checked
                      ? [...new Set([...selectedSpeech, language])]
                      : selectedSpeech.filter((code) => code !== language)
                  }}
                />
                {speechLanguageName(language)}
              </label>
            {/each}
          </div>
        </details>
      {/if}
      <!-- Model Selection -->
      <div class="py-4">
        <div class="text-[12px] font-medium text-gray-700 dark:text-gray-300 mb-2">
          {$i18n.t('main.getStarted.modelSelection')}
        </div>
        <div class="grid grid-cols-2 gap-2 mb-2">
          <button
            type="button"
            class="rounded-xl border border-solid px-3 py-1 text-center transition {modelPreference ===
            'quality'
              ? 'border-emerald-500 bg-emerald-500/5 dark:bg-emerald-500/10'
              : 'border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700'}"
            aria-pressed={modelPreference === 'quality'}
            onclick={() => setPreference('quality')}
          >
            <div
              class="text-[11px] font-medium {modelPreference === 'quality'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-gray-700 dark:text-gray-300'}"
            >
              {$i18n.t('main.getStarted.modelPreferenceQuality')}
            </div>
          </button>
          <button
            type="button"
            class="rounded-xl border border-solid px-3 py-1 text-center transition {modelPreference ===
            'balanced'
              ? 'border-emerald-500 bg-emerald-500/5 dark:bg-emerald-500/10'
              : 'border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700'}"
            aria-pressed={modelPreference === 'balanced'}
            onclick={() => setPreference('balanced')}
          >
            <div
              class="text-[11px] font-medium {modelPreference === 'balanced'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-gray-700 dark:text-gray-300'}"
            >
              {$i18n.t('main.getStarted.modelPreferenceBalanced')}
            </div>
          </button>
        </div>
        <ProModelSwitch
          checked={proMode}
          label={$i18n.t('main.getStarted.useProModels')}
          onchange={setProMode}
        />
        {#if proMode}
          <div class="py-1 text-[12px] text-gray-600 dark:text-gray-400" role="status">
            {$i18n.t('main.getStarted.autoInstallModel')}: {detectingHardware || loadingProModels
              ? $i18n.t('common.loading')
              : (recommendation?.name ?? $i18n.t('main.getStarted.noAutoModel'))}
          </div>
        {/if}
        <details class="@container">
          <summary class="cursor-pointer py-2 text-[12px] text-gray-700 dark:text-gray-300">
            {$i18n.t('main.getStarted.selectedDownloadModel')}:
            <span class="font-medium break-all text-emerald-600 dark:text-emerald-400"
              >{selectedModel?.name ?? $i18n.t('main.getStarted.noAutoModel')}</span
            >
            <span class="ml-2 text-[11px] text-gray-500"
              >{$i18n.t('main.getStarted.changeModel')}</span
            >
          </summary>
          <div class="mt-2 grid grid-cols-1 gap-2 @min-[520px]:grid-cols-2">
            {#each visibleModels as model (model.filename)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="flex min-w-0 flex-col px-3 py-2 rounded-xl border border-solid cursor-pointer transition-all {selectedModel?.name ===
                model.name
                  ? 'border-emerald-500 bg-emerald-500/5 dark:bg-emerald-500/10'
                  : 'border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700'}"
                onclick={() => (manualModel = model.filename)}
              >
                <div
                  class="text-[11px] font-medium break-words {selectedModel?.name === model.name
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-gray-700 dark:text-gray-300'}"
                >
                  {model.name}
                </div>
                <div class="text-[11px] leading-snug text-gray-600 dark:text-gray-400">
                  {model.proPreset ? model.sizeStr : `~${standardGuide(model.name).sizeGiB}G`} ·
                  {model.proPreset
                    ? proRequirementLabel(model.proPreset)
                    : standardRequirementLabel(model.name)}
                </div>
                <ModelCapabilityBadges
                  name={model.name}
                  mtp={!!(model.proModelId || model.mtpFilename)}
                />
              </div>
            {/each}
          </div>
        </details>
      </div>
    </div>

    <!-- Advanced (collapsed) -->
    <div class="px-6 pb-4">
      <button
        class="flex items-center gap-1.5 bg-transparent border-none p-0 cursor-pointer"
        onclick={() => {
          advancedOpen = !advancedOpen
        }}
      >
        <svg
          class="w-2.5 h-2.5 text-gray-400 dark:text-gray-500 transition-transform duration-200 {advancedOpen
            ? 'rotate-90'
            : ''}"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span class="text-[11px] text-gray-400 dark:text-gray-500"
          >{$i18n.t('common.advanced')}</span
        >
      </button>

      {#if advancedOpen}
        <div class="mt-3" transition:fade={{ duration: 150 }}>
          <div class="text-[11px] text-gray-400 dark:text-gray-500 mb-1.5">
            {$i18n.t('setup.install.installLocation')}
          </div>
          <div class="flex items-center gap-2">
            <div
              class="flex-1 min-w-0 px-3 py-2 bg-gray-50 dark:bg-gray-900 text-[11px] text-gray-500 dark:text-gray-400 font-mono truncate rounded-xl"
              title={installDir}
            >
              {installDir || '…'}
            </div>
            <button
              class="shrink-0 text-[11px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 px-3 py-2 bg-gray-50 dark:bg-gray-900 rounded-xl transition border-none cursor-pointer"
              onclick={changeInstallDir}
            >
              {$i18n.t('setup.install.changeLocation')}
            </button>
          </div>
          <div class="text-[10px] text-gray-300 dark:text-gray-600 mt-1">
            {$i18n.t('setup.install.installLocationDesc')}
          </div>
        </div>
      {/if}
    </div>

    <!-- Footer -->
    <div class="sticky bottom-0 z-10 flex flex-col gap-2 bg-white px-5 pb-5 pt-2 dark:bg-gray-950">
      <div class="border-t border-gray-100 pt-3 dark:border-gray-800">
        <div class="flex items-center justify-between gap-4">
          <span class="text-[12px] font-medium text-gray-700 dark:text-gray-300"
            >预计安装所需空间</span
          >
          <span
            class="shrink-0 font-mono text-[13px] font-medium text-emerald-600 dark:text-emerald-400"
          >
            约 {formatInstallGb(requiredInstallBytes())} GB
          </span>
        </div>
        <div class="mt-1 flex items-center justify-between gap-4">
          <span class="text-[11px] text-gray-400 dark:text-gray-500">当前安装磁盘剩余空间</span>
          <span
            class="shrink-0 font-mono text-[12px] {diskFreeBytes !== null &&
            diskFreeBytes >= 0 &&
            diskFreeBytes < requiredInstallBytes()
              ? 'text-red-500 dark:text-red-400'
              : 'text-gray-500 dark:text-gray-400'}"
          >
            {checkingDiskSpace || diskFreeBytes === null
              ? '检测中...'
              : diskFreeBytes < 0
                ? '无法检测'
                : `${formatInstallGb(diskFreeBytes)}G`}
          </span>
        </div>
        <div class="mt-1 text-[10px] leading-relaxed text-gray-400 dark:text-gray-500">
          核心组件 6G · 模型 {selectedModel
            ? selectedModel.proPreset
              ? selectedModel.sizeStr
              : `~${standardGuide(selectedModel.name).sizeGiB}G`
            : $i18n.t('main.getStarted.noAutoModel')}
          {installSherpa ? ' · Sherpa 约 2G' : ''}
          {installOpenCode ? ' · Agent 预留 0.5 GB（扩展另计）' : ''}
          {llamaCppVariant.startsWith('cuda-') && ragHardwareAcceleration
            ? ' · RAG CUDA 约 3G'
            : ''}
        </div>
      </div>
      <button
        class="w-full rounded-xl bg-gray-900 dark:bg-white px-4 py-2.5 text-sm font-medium text-white dark:text-gray-900 transition-all duration-200 hover:bg-gray-800 dark:hover:bg-gray-100 active:scale-[0.98] border-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
        onclick={continueInstall}
        disabled={detectingHardware || !selectedModel || checkingDiskSpace}
      >
        {$i18n.t('main.getStarted.continue')}
      </button>
      <button
        class="w-full rounded-xl px-4 py-2 text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition bg-transparent border-none cursor-pointer"
        onclick={onCancel}
      >
        {$i18n.t('common.cancel')}
      </button>
    </div>
  </div>
</div>

{#if showUnsupportedInstallPath}
  <UnsupportedInstallPathDialog
    path={installDir || defaultInstallDir}
    onCancel={() => {
      showUnsupportedInstallPath = false
    }}
    onChange={changeInstallDir}
  />
{/if}
