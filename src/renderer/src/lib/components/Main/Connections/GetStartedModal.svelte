<script lang="ts">
  import { onMount } from 'svelte'
  import { fade, scale } from 'svelte/transition'
  import i18n from '../../../i18n'
  import { detectWindowsLlamaVariant } from '../../../utils/llamacpp'
  import Switch from '../../common/Switch.svelte'
  import UnsupportedInstallPathDialog from '../../Setup/UnsupportedInstallPathDialog.svelte'

  interface Props {
    onContinue: (options: {
      installOpenTerminal: boolean
      installLlamaCpp: boolean
      installSherpa: boolean
      installDir: string
      selectedModel: AuraModel
      llamaCppVariant?: string
      ragHardwareAcceleration?: boolean
    }) => void
    onCancel: () => void
  }

  type ModelCapability = 'image' | 'video' | 'audio'

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
    ramInfo: string
    macOnly?: boolean
  }

  interface SystemInfo {
    totalMemGB?: number
    architecture?: string
    dedicatedVramGB?: number
    gpuName?: string
  }

  let { onContinue, onCancel }: Props = $props()

  const AURA_MODELS: AuraModel[] = [
    {
      name: 'lowest.gguf',
      sizeStr: '~3GB',
      repo: 'AuraPro',
      hfRepo: 'unsloth/gemma-4-E2B-it-qat-GGUF',
      filename: 'gemma-4-E2B-it-qat-UD-Q4_K_XL.gguf',
      mmprojRepo: 'unsloth/gemma-4-E2B-it-qat-GGUF',
      mmprojFilename: 'mmproj-F16.gguf',
      mtpRepo: 'unsloth/gemma-4-E2B-it-qat-GGUF',
      mtpFilename: 'mtp-gemma-4-E2B-it.gguf',
      sizeBytes: 3 * 1024 * 1024 * 1024,
      ramInfo: 'RAM 8G+'
    },
    {
      name: 'low_E4.gguf',
      sizeStr: '~5GB',
      repo: 'AuraPro',
      hfRepo: 'unsloth/gemma-4-E4B-it-qat-GGUF',
      filename: 'gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf',
      mmprojRepo: 'unsloth/gemma-4-E4B-it-qat-GGUF',
      mmprojFilename: 'mmproj-F16.gguf',
      mtpRepo: 'unsloth/gemma-4-E4B-it-qat-GGUF',
      mtpFilename: 'mtp-gemma-4-E4B-it.gguf',
      sizeBytes: 5 * 1024 * 1024 * 1024,
      ramInfo: 'RAM+VRAM 16G+0G / UMA 8G'
    },
    {
      name: 'medium_IQ2.gguf',
      sizeStr: '~11GB',
      repo: 'AuraPro',
      hfRepo: 'unsloth/gemma-4-26B-A4B-it-GGUF',
      filename: 'gemma-4-26B-A4B-it-UD-Q2_K_XL.gguf',
      mmprojRepo: 'unsloth/gemma-4-26B-A4B-it-GGUF',
      mmprojFilename: 'mmproj-F16.gguf',
      mtpRepo: 'unsloth/gemma-4-26B-A4B-it-GGUF',
      mtpFilename: 'mtp-gemma-4-26B-A4B-it.gguf',
      sizeBytes: 11 * 1024 * 1024 * 1024,
      ramInfo: 'RAM+VRAM 24G+4G / UMA 18G'
    },
    {
      name: 'medium_Q4.gguf',
      sizeStr: '~7GB',
      repo: 'AuraPro',
      hfRepo: 'unsloth/gemma-4-12B-it-qat-GGUF',
      filename: 'gemma-4-12B-it-qat-UD-Q4_K_XL.gguf',
      mmprojRepo: 'unsloth/gemma-4-12B-it-qat-GGUF',
      mmprojFilename: 'mmproj-F16.gguf',
      mtpRepo: 'unsloth/gemma-4-12B-it-qat-GGUF',
      mtpFilename: 'mtp-gemma-4-12B-it.gguf',
      sizeBytes: 7 * 1024 * 1024 * 1024,
      ramInfo: 'RAM+VRAM 16G+8G / UMA 10G'
    },
    {
      name: 'high_Q4.gguf',
      sizeStr: '~15GB',
      repo: 'AuraPro',
      hfRepo: 'unsloth/gemma-4-26B-A4B-it-qat-GGUF',
      filename: 'gemma-4-26B-A4B-it-qat-UD-Q4_K_XL.gguf',
      mmprojRepo: 'unsloth/gemma-4-26B-A4B-it-qat-GGUF',
      mmprojFilename: 'mmproj-F16.gguf',
      mtpRepo: 'unsloth/gemma-4-26B-A4B-it-qat-GGUF',
      mtpFilename: 'mtp-gemma-4-26B-A4B-it.gguf',
      sizeBytes: 15 * 1024 * 1024 * 1024,
      ramInfo: 'RAM+VRAM 32G+4G / UMA 24G'
    },
    {
      name: 'high-code_IQ4.gguf',
      sizeStr: '~19GB',
      repo: 'AuraPro',
      hfRepo: 'unsloth/Qwen3.6-35B-A3B-MTP-GGUF',
      filename: 'Qwen3.6-35B-A3B-UD-IQ4_NL.gguf',
      mmprojRepo: 'unsloth/Qwen3.6-35B-A3B-GGUF',
      mmprojFilename: 'mmproj-F16.gguf',
      sizeBytes: 19 * 1024 * 1024 * 1024,
      ramInfo: 'RAM+VRAM 32G+6G / UMA 28G'
    }
  ]

  const AUDIO_CAPABLE_MODELS = new Set(['lowest.gguf', 'low_E4.gguf', 'medium_Q4.gguf'])
  const modelCapabilities = (modelName: string): ModelCapability[] => {
    const capabilities: ModelCapability[] = ['image', 'video']
    if (AUDIO_CAPABLE_MODELS.has(modelName)) capabilities.push('audio')
    return capabilities
  }

  let installOpenTerminal = $state(false)
  let installSherpa = $state(true)
  let installDir = $state('')
  let defaultInstallDir = $state('')
  let advancedOpen = $state(false)
  let selectedModel = $state<AuraModel>(AURA_MODELS[0])
  let llamaCppVariant = $state('cpu')
  let ragHardwareAcceleration = $state(false)
  let systemMemGB = $state<number | null>(null)
  let systemArchitecture = $state('')
  let dedicatedVramGB = $state(0)
  let detectingHardware = $state(false)
  let modelPreference = $state<'quality' | 'speed'>('quality')
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

  const modelByName = (name: string) =>
    AURA_MODELS.find((model) => model.name === name) ??
    AURA_MODELS.find((model) => model.name === 'low_E4.gguf') ??
    AURA_MODELS[0]
  const isHighOrAboveModel = (model: AuraModel) =>
    model.name.startsWith('high_') || model.name.startsWith('high-')
  const visibleModels = () =>
    AURA_MODELS.filter((model) => {
      if (platform !== 'darwin' && model.macOnly) return false
      if (platform !== 'darwin' && (systemMemGB ?? 0) < 24 && isHighOrAboveModel(model)) {
        const speedOverride =
          modelPreference === 'speed' &&
          ((model.name === 'high_Q4.gguf' && dedicatedVramGB >= 12) ||
            (model.name === 'medium_Q4.gguf' && dedicatedVramGB >= 8))
        if (!speedOverride) return false
      }
      return true
    })
  const isAppleSiliconMac = () => platform === 'darwin' && systemArchitecture === 'arm64'

  const qualityRecommendation = () => {
    const mem = systemMemGB ?? 8
    if (platform === 'darwin') {
      if (!isAppleSiliconMac())
        return mem >= 16 ? modelByName('low_E4.gguf') : modelByName('lowest.gguf')
      if (mem >= 20) return modelByName('high_Q4.gguf')
      if (mem >= 10) return modelByName('medium_Q4.gguf')
      return modelByName('low_E4.gguf')
    }

    if (mem < 15) return modelByName('lowest.gguf')
    if (mem > 48) return modelByName('high_Q4.gguf')
    if (mem > 31 && dedicatedVramGB >= 4) return modelByName('high_Q4.gguf')
    if (mem >= 24 && dedicatedVramGB >= 4) return modelByName('medium_IQ2.gguf')
    return modelByName('low_E4.gguf')
  }

  const recommendedModel = () => {
    const mem = systemMemGB ?? 8
    if (platform === 'darwin') {
      if (!isAppleSiliconMac()) {
        if (modelPreference === 'speed')
          return mem >= 24 ? modelByName('low_E4.gguf') : modelByName('lowest.gguf')
        return qualityRecommendation()
      }
      if (modelPreference === 'speed') {
        if (mem >= 20) return modelByName('high_Q4.gguf')
        if (mem >= 18) return modelByName('medium_IQ2.gguf')
        return modelByName('low_E4.gguf')
      }
      return qualityRecommendation()
    }

    if (modelPreference === 'speed') {
      if (dedicatedVramGB >= 12) return modelByName('high_Q4.gguf')
      if (mem > 31 && dedicatedVramGB >= 4) return modelByName('high_Q4.gguf')
      if (dedicatedVramGB >= 8) return modelByName('medium_Q4.gguf')
      if (mem < 15) return modelByName('lowest.gguf')
      if (mem >= 24 && dedicatedVramGB >= 4) return modelByName('medium_IQ2.gguf')
      return modelByName('low_E4.gguf')
    }

    return qualityRecommendation()
  }

  const applyRecommendedModel = () => {
    selectedModel = recommendedModel()
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
      applyRecommendedModel()
    } catch {
      systemMemGB = 8
      systemArchitecture = ''
      dedicatedVramGB = 0
      applyRecommendedModel()
    } finally {
      detectingHardware = false
    }
  }

  const variantOptions = $derived(
    (() => {
      if (platform === 'darwin') return [{ value: 'cpu', label: 'Apple Metal (Default)' }]
      if (platform === 'win32')
        return [
          { value: 'cuda-12.4', label: 'NVIDIA CUDA 12.4 (RTX 40 / older)' },
          { value: 'cuda-13.3', label: 'NVIDIA CUDA 13.3 (RTX 50)' },
          { value: 'vulkan', label: 'Vulkan (For AMD / Intel discrete GPU)' },
          { value: 'cpu', label: 'CPU Only' }
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
  const RAG_CUDA_INSTALL_BYTES = 3 * GIB
  const requiredInstallBytes = () =>
    CORE_INSTALL_BYTES +
    selectedModel.sizeBytes +
    (installSherpa ? SHERPA_INSTALL_BYTES : 0) +
    (llamaCppVariant.startsWith('cuda-') && ragHardwareAcceleration ? RAG_CUDA_INSTALL_BYTES : 0)
  const formatInstallGb = (bytes: number) => {
    const value = bytes / GIB
    return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)
  }

  onMount(async () => {
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
      // Fallback to defaults
      llamaCppVariant = 'cpu'
      systemMemGB = 8
      systemArchitecture = ''
      dedicatedVramGB = 0
      applyRecommendedModel()
      detectingHardware = false
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
    if (!(await validateInstallPath())) return
    onContinue({
      installOpenTerminal,
      installLlamaCpp: true,
      installSherpa,
      installDir,
      selectedModel,
      llamaCppVariant,
      ragHardwareAcceleration: llamaCppVariant.startsWith('cuda-') && ragHardwareAcceleration
    })
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto p-2 sm:p-4"
  transition:fade={{ duration: 150 }}
  onmousedown={onCancel}
>
  <div class="absolute inset-0 bg-black/50 backdrop-blur-sm"></div>

  <div
    class="relative w-full max-w-xl max-h-[calc(100vh-1rem)] overflow-y-auto rounded-xl bg-white shadow-2xl sm:rounded-3xl dark:bg-gray-950"
    transition:scale={{ start: 0.97, duration: 180 }}
    onmousedown={(e) => e.stopPropagation()}
  >
    <!-- Visual header -->
    <div
      class="relative flex h-36 items-center justify-center overflow-hidden bg-gradient-to-br from-gray-900 via-gray-800 to-black dark:from-white dark:via-gray-100 dark:to-gray-200"
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
    <div class="px-6 py-4 flex flex-col divide-y divide-gray-100/30 dark:divide-gray-800/15">
      <div class="py-3 flex items-center justify-between gap-4">
        <div>
          <div class="text-[13px] font-medium text-gray-700 dark:text-gray-300">
            {$i18n.t('main.getStarted.openTerminal')}
          </div>
          <div class="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
            {$i18n.t('main.getStarted.openTerminalDesc')}
          </div>
        </div>
        <Switch
          checked={installOpenTerminal}
          onchange={(v) => {
            installOpenTerminal = v
          }}
        />
      </div>

      <div class="py-3 flex items-center justify-between gap-4">
        <div>
          <div
            class="text-[13px] font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1.5"
          >
            {$i18n.t('main.getStarted.llamaCpp')}
            <span class="text-[9px] opacity-30 uppercase tracking-wide"
              >{$i18n.t('common.experimental')}</span
            >
          </div>
          <div class="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
            Select the optimized version for your hardware
          </div>
        </div>
        <select
          class="bg-gray-50 dark:bg-gray-900 text-[12px] text-gray-700 dark:text-gray-200 px-3 py-1.5 border-none outline-none rounded-xl cursor-pointer"
          onchange={(e) => {
            llamaCppVariant = (e.target as HTMLSelectElement).value
            if (!llamaCppVariant.startsWith('cuda-')) ragHardwareAcceleration = false
          }}
        >
          {#each variantOptions as opt (opt.value)}
            <option value={opt.value} selected={llamaCppVariant === opt.value}>{opt.label}</option>
          {/each}
        </select>
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
            Local speech input and TTS runtime
          </div>
        </div>
        <Switch
          checked={installSherpa}
          onchange={(v) => {
            installSherpa = v
          }}
        />
      </div>

      <!-- Model Selection -->
      <div class="py-4">
        <div class="text-[12px] font-medium text-gray-700 dark:text-gray-300 mb-2">
          Select Model (Recommended: {selectedModel.name.replace('.gguf', '')})
        </div>
        {#if detectingHardware}
          <div
            class="mb-2 rounded-xl bg-gray-50 px-3 py-2 text-[11px] text-gray-400 dark:bg-gray-900 dark:text-gray-500"
          >
            正在检测配置，请稍候。
          </div>
        {/if}
        <div class="grid grid-cols-2 gap-2 mb-2">
          <button
            type="button"
            class="rounded-xl border border-solid px-3 py-1 text-center transition {modelPreference ===
            'quality'
              ? 'border-emerald-500 bg-emerald-500/5 dark:bg-emerald-500/10'
              : 'border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700'}"
            onclick={() => {
              modelPreference = 'quality'
              applyRecommendedModel()
            }}
          >
            <div
              class="text-[11px] font-medium {modelPreference === 'quality'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-gray-700 dark:text-gray-300'}"
            >
              注重质量
            </div>
          </button>
          <button
            type="button"
            class="rounded-xl border border-solid px-3 py-1 text-center transition {modelPreference ===
            'speed'
              ? 'border-emerald-500 bg-emerald-500/5 dark:bg-emerald-500/10'
              : 'border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700'}"
            onclick={() => {
              modelPreference = 'speed'
              applyRecommendedModel()
            }}
          >
            <div
              class="text-[11px] font-medium {modelPreference === 'speed'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-gray-700 dark:text-gray-300'}"
            >
              注重速度
            </div>
          </button>
        </div>
        <div class="grid grid-cols-2 gap-2">
          {#each visibleModels() as model (model.filename)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="flex flex-col px-3 py-2 rounded-xl border border-solid cursor-pointer transition-all {selectedModel.name ===
              model.name
                ? 'border-emerald-500 bg-emerald-500/5 dark:bg-emerald-500/10'
                : 'border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700'}"
              onclick={() => (selectedModel = model)}
            >
              <div
                class="text-[11px] font-medium {selectedModel.name === model.name
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-gray-700 dark:text-gray-300'}"
              >
                {model.name}
              </div>
              <div class="text-[9px] text-gray-400 dark:text-gray-500">
                {model.sizeStr} · {model.ramInfo}{model.macOnly ? ' · Mac only' : ''}
              </div>
              <div class="mt-1 flex flex-wrap gap-1">
                {#each modelCapabilities(model.name) as capability (capability)}
                  <span
                    class="rounded border border-gray-200/70 px-1.5 py-px text-[9px] text-gray-400 dark:border-gray-700/70 dark:text-gray-500"
                  >
                    {$i18n.t('settings.models.capability.' + capability)}
                  </span>
                {/each}
              </div>
            </div>
          {/each}
        </div>
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
                : `${formatInstallGb(diskFreeBytes)} GB`}
          </span>
        </div>
        <div class="mt-1 text-[10px] leading-relaxed text-gray-400 dark:text-gray-500">
          核心组件 6 GB · 模型 {selectedModel.sizeStr}
          {installSherpa ? ' · Sherpa 约 2 GB' : ''}
          {llamaCppVariant.startsWith('cuda-') && ragHardwareAcceleration
            ? ' · RAG CUDA 约 3 GB'
            : ''}
        </div>
      </div>
      <button
        class="w-full rounded-xl bg-gray-900 dark:bg-white px-4 py-2.5 text-sm font-medium text-white dark:text-gray-900 transition-all duration-200 hover:bg-gray-800 dark:hover:bg-gray-100 active:scale-[0.98] border-none cursor-pointer"
        onclick={continueInstall}
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
