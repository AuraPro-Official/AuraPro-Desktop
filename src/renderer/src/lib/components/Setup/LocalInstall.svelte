<script lang="ts">
  import { untrack } from 'svelte'
  import { fade } from 'svelte/transition'
  import { onMount } from 'svelte'
  import { connections, config, serverInfo } from '../../stores'
  import i18n from '../../i18n'
  import { detectWindowsLlamaVariant } from '../../utils/llamacpp'

  import logoImage from '../../assets/images/splash.png'
  import BitdefenderGuide from './BitdefenderGuide.svelte'
  import InstallFailurePanel from './InstallFailurePanel.svelte'
  import UnsupportedInstallPathDialog from './UnsupportedInstallPathDialog.svelte'
  import Switch from '../common/Switch.svelte'
  import {
    createOptionalInstallWarning,
    diagnoseInstallationFailure,
    type InstallationFailureReport,
    type InstallationStage
  } from '../../utils/install-diagnostics'

  interface DownloadEventData {
    repo?: string
    filename?: string
    status?: DownloadItem['status']
    percent?: number
    downloadedBytes?: number
    totalBytes?: number
    bytesPerSecond?: number
    etaSeconds?: number
    detail?: string
    error?: string
  }

  interface MainEvent {
    type: string
    data?: unknown
  }

  let { onBack, onComplete, autoStart = false } = $props()

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

  interface DownloadItem {
    repo: string
    filename: string
    status: 'downloading' | 'done' | 'failed'
    percent: number
    downloadedBytes?: number
    totalBytes?: number
    bytesPerSecond?: number
    etaSeconds?: number
    detail?: string
    error?: string
  }

  let phase = $state(untrack(() => (autoStart ? 'working' : 'ready'))) // ready | core_installing | model_selection | model_downloading | done | error
  let errorMsg = $state('')
  let installDir = $state('')
  let defaultInstallDir = $state('')
  let systemMemGB = $state<number | null>(null)
  let systemArchitecture = $state('')
  let dedicatedVramGB = $state(0)
  let detectingHardware = $state(false)
  let modelPreference = $state<'quality' | 'speed'>('quality')

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
      sizeStr: '~14GB',
      repo: 'AuraPro',
      hfRepo: 'unsloth/Qwen3.8-27B-GGUF',
      filename: 'Qwen3.8-27B-UD-IQ4_XS.gguf',
      mmprojRepo: 'unsloth/Qwen3.8-27B-GGUF',
      mmprojFilename: 'mmproj-F16.gguf',
      mtpRepo: 'unsloth/Qwen3.8-27B-GGUF',
      mtpFilename: 'MTP/mtp-Qwen3.8-27B-Q4_0.gguf',
      sizeBytes: 14_252_845_984,
      ramInfo: 'RAM+VRAM 32GB+6GB / UMA 24GB'
    },
    {
      name: 'high-code_Q4.gguf',
      sizeStr: '~16GB',
      repo: 'AuraPro',
      hfRepo: 'unsloth/Qwen3.8-27B-GGUF',
      filename: 'Qwen3.8-27B-UD-Q4_K_M.gguf',
      mmprojRepo: 'unsloth/Qwen3.8-27B-GGUF',
      mmprojFilename: 'mmproj-F16.gguf',
      mtpRepo: 'unsloth/Qwen3.8-27B-GGUF',
      mtpFilename: 'MTP/mtp-Qwen3.8-27B-Q4_0.gguf',
      sizeBytes: 16_464_440_224,
      ramInfo: 'RAM+VRAM 32GB+8GB / UMA 24GB'
    }
  ]

  const AUDIO_CAPABLE_MODELS = new Set(['lowest.gguf', 'low_E4.gguf', 'medium_Q4.gguf'])
  const modelCapabilities = (modelName: string): ModelCapability[] => {
    const capabilities: ModelCapability[] = ['image', 'video']
    if (AUDIO_CAPABLE_MODELS.has(modelName)) capabilities.push('audio')
    return capabilities
  }

  let selectedModel = $state<AuraModel>(AURA_MODELS[0])
  let downloadProgress = $state<number | null>(null)
  let coreProgress = $state(0)
  let downloadItemsByKey = $state<Record<string, DownloadItem>>({})
  let installStatus = $state('')
  let installFailure = $state<InstallationFailureReport | null>(null)
  let installWarnings = $state<InstallationFailureReport[]>([])
  let autoRepairing = $state(false)
  let autoRepairAttempts = $state<Record<string, number>>({})
  let failedOperation = $state<'core' | 'model'>('core')
  let currentInstallStage = $state<InstallationStage>('preflight')
  let llamaCppVariant = $state('cpu')
  let ragHardwareAcceleration = $state(false)
  let installSherpaRecommended = $state(true)
  let installOpenCode = $state(false)
  let diskFreeBytes = $state<number | null>(null)
  let diskProbePath = $state('')
  let showUnsupportedInstallPath = $state(false)
  let checkingDiskSpace = $state(false)
  let activeCoreDownloadKey = $state('')

  const clampPercent = (value: number) =>
    Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
  const formatBytes = (bytes?: number) => {
    if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let value = bytes
    let unitIndex = 0
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024
      unitIndex += 1
    }
    const digits = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2
    return `${value.toFixed(digits)} ${units[unitIndex]}`
  }
  const formatSpeed = (bytesPerSecond?: number) =>
    bytesPerSecond && Number.isFinite(bytesPerSecond) && bytesPerSecond > 0
      ? `${formatBytes(bytesPerSecond)}/s`
      : '--'
  const formatEta = (seconds?: number) => {
    if (!seconds || !Number.isFinite(seconds) || seconds < 0) return '--'
    const rounded = Math.ceil(seconds)
    const hours = Math.floor(rounded / 3600)
    const minutes = Math.floor((rounded % 3600) / 60)
    const remainingSeconds = rounded % 60
    if (hours > 0) return `${hours}h ${minutes}m`
    if (minutes > 0) return `${minutes}m ${remainingSeconds}s`
    return `${remainingSeconds}s`
  }
  const downloadKey = (item: { repo?: string; filename?: string }) =>
    `${item.repo ?? ''}/${item.filename ?? ''}`

  const downloadItems = $derived(Object.values(downloadItemsByKey))
  const coreDownloadsDone = $derived(
    downloadItems.length > 0 && downloadItems.every((i) => i.status === 'done')
  )
  const modelLoadingPhase = $derived(
    phase === 'model_downloading' &&
      downloadItems.length > 0 &&
      downloadItems.every((i) => i.status === 'done')
  )
  const totalDownloadProgress = $derived(
    (() => {
      const items = Object.values(downloadItemsByKey)
      if (items.length === 0) return clampPercent(downloadProgress ?? 0)

      const hasKnownSizes = items.some((item) => (item.totalBytes ?? 0) > 0)
      if (hasKnownSizes) {
        let totalBytes = 0
        let downloadedBytes = 0
        for (const item of items) {
          const total = item.totalBytes ?? 0
          if (total > 0) {
            totalBytes += total
            downloadedBytes +=
              item.status === 'done' ? total : Math.min(item.downloadedBytes ?? 0, total)
          } else {
            totalBytes += 100
            downloadedBytes += item.status === 'done' ? 100 : clampPercent(item.percent)
          }
        }
        return totalBytes > 0 ? clampPercent((downloadedBytes / totalBytes) * 100) : 0
      }

      return clampPercent(
        items.reduce((sum, item) => sum + (item.status === 'done' ? 100 : item.percent), 0) /
          items.length
      )
    })()
  )
  const installOverallProgress = $derived(
    (() => {
      if (phase === 'done') return 100
      if (phase === 'model_downloading') return clampPercent(45 + totalDownloadProgress * 0.5)
      if (phase === 'model_selection') return 45
      if (phase === 'core_installing' || phase === 'working') return clampPercent(coreProgress)
      if (phase === 'error')
        return clampPercent(
          Math.max(coreProgress, totalDownloadProgress ? 45 + totalDownloadProgress * 0.5 : 0)
        )
      return 0
    })()
  )

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
    void refreshDiskSpace()
  }

  const selectModel = (model: AuraModel) => {
    selectedModel = model
    void refreshDiskSpace()
  }

  const detectHardware = async () => {
    detectingHardware = true
    try {
      const sysInfo = await window.electronAPI.getSystemInfo({
        includeDedicatedVram: platform !== 'darwin'
      })
      systemMemGB = sysInfo?.totalMemGB || 8
      systemArchitecture = sysInfo?.architecture || ''
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
      if (platform === 'win32') {
        if (systemArchitecture === 'arm64') return [{ value: 'cpu', label: 'CPU Only' }]
        return [
          { value: 'cuda-12.4', label: 'NVIDIA CUDA 12.4 (RTX 40 / older)' },
          { value: 'cuda-13.3', label: 'NVIDIA CUDA 13.3 (RTX 50)' },
          { value: 'vulkan', label: 'Vulkan (AMD / Intel discrete GPU)' },
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

  const updateDownloadItem = (data: DownloadEventData) => {
    if (!data?.filename) return
    const key = downloadKey(data)
    const current = downloadItemsByKey[key]
    const totalBytes = data.totalBytes ?? current?.totalBytes
    const percent =
      data.status === 'done' ? 100 : clampPercent(data.percent ?? current?.percent ?? 0)
    const next: DownloadItem = {
      ...(current ?? {}),
      repo: data.repo ?? current?.repo ?? '',
      filename: data.filename,
      status: data.status ?? current?.status ?? 'downloading',
      percent,
      downloadedBytes:
        data.status === 'done'
          ? (totalBytes ?? data.downloadedBytes ?? current?.downloadedBytes)
          : (data.downloadedBytes ?? current?.downloadedBytes),
      totalBytes,
      bytesPerSecond: data.bytesPerSecond ?? current?.bytesPerSecond,
      etaSeconds: data.etaSeconds ?? current?.etaSeconds,
      detail: data.detail ?? current?.detail,
      error: data.error ?? current?.error
    }

    downloadItemsByKey = { ...downloadItemsByKey, [key]: next }
    downloadProgress = totalDownloadProgress
  }

  const updateCoreDownloadItem = (filename: string, status: string) => {
    const percentMatch = status.match(/(\d+(?:\.\d+)?)%/)
    if (!percentMatch) return

    const percent = clampPercent(Number(percentMatch[1]))
    updateDownloadItem({
      repo: 'core',
      filename,
      status: percent >= 100 ? 'done' : 'downloading',
      percent,
      detail: status
    })
  }

  const trackCoreInstallDownload = (status: string) => {
    if (!status) return

    let filename = ''
    if (status.includes('Downloading Python')) {
      filename = 'Python runtime'
    } else if (status.includes('Downloading ffmpeg')) {
      filename = 'ffmpeg'
    } else if (status.includes('Downloading llama.cpp') || status.includes('llama.cpp')) {
      filename = 'llama.cpp'
    } else {
      const assetMatch = status.match(/^Downloading\s+(.+)\.\.\.$/)
      if (assetMatch?.[1]) {
        activeCoreDownloadKey = assetMatch[1]
        return
      }
      if (status.startsWith('Downloading...') && activeCoreDownloadKey) {
        filename = activeCoreDownloadKey
      }
    }

    if (!filename) return
    activeCoreDownloadKey = filename
    updateCoreDownloadItem(filename, status)
  }

  const requiredModelInstallBytes = () =>
    selectedModel.sizeBytes +
    (installSherpaRecommended ? 5 : 3) * 1024 * 1024 * 1024 +
    (installOpenCode ? 512 * 1024 * 1024 : 0) +
    (llamaCppVariant.startsWith('cuda-') && ragHardwareAcceleration ? 3 : 0) * 1024 * 1024 * 1024

  const formatGb = (bytes: number) => (bytes / 1024 / 1024 / 1024).toFixed(1)
  const hasEnoughDiskSpace = () =>
    diskFreeBytes === null || diskFreeBytes < 0 || diskFreeBytes >= requiredModelInstallBytes()

  const refreshDiskSpace = async () => {
    const targetPath = installDir || defaultInstallDir
    if (!targetPath) return
    checkingDiskSpace = true
    try {
      const disk = await window.electronAPI.getDiskSpace(targetPath)
      diskFreeBytes = typeof disk?.free === 'number' ? disk.free : -1
      diskProbePath = disk?.path ?? targetPath
    } catch {
      diskFreeBytes = -1
      diskProbePath = targetPath
    } finally {
      checkingDiskSpace = false
    }
  }

  const hasEnoughDiskSpaceForModel = async () => {
    await refreshDiskSpace()
    const requiredBytes = requiredModelInstallBytes()
    if (diskFreeBytes === null || diskFreeBytes < 0) return true
    if (diskFreeBytes >= requiredBytes) return true

    errorMsg =
      `磁盘空间不足。当前模型至少需要 ${formatGb(requiredBytes)} GB 可用空间，` +
      `当前安装位置所在磁盘仅剩 ${formatGb(diskFreeBytes)} GB。` +
      '请重新设置安装位置或清理硬盘空间后重试。'
    return false
  }

  const CORE_INSTALL_REQUIRED_BYTES = 6 * 1024 * 1024 * 1024
  const RAG_CUDA_INSTALL_BYTES = 3 * 1024 * 1024 * 1024
  const requiredCoreInstallBytes = () =>
    CORE_INSTALL_REQUIRED_BYTES +
    (llamaCppVariant.startsWith('cuda-') && ragHardwareAcceleration ? RAG_CUDA_INSTALL_BYTES : 0) +
    (installOpenCode ? 512 * 1024 * 1024 : 0)
  const wait = (milliseconds: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, milliseconds))
  const sherpaInstallStatus = (): string =>
    ($i18n.language ?? '').toLowerCase().startsWith('zh')
      ? '正在启动 Sherpa（首次安装语音模型预计需要 5-15 分钟）'
      : 'Starting Sherpa (initial speech model setup takes about 5-15 minutes)'

  const validateInstallPath = async (): Promise<boolean> => {
    const targetPath = installDir || defaultInstallDir
    const result = await window.electronAPI.checkInstallPreflight(targetPath, 0)
    const supported = result?.pathSupported !== false
    showUnsupportedInstallPath = !supported
    return supported
  }

  const runInstallPreflight = async (requiredBytes: number): Promise<boolean> => {
    const targetPath = installDir || defaultInstallDir
    const result = await window.electronAPI.checkInstallPreflight(targetPath, requiredBytes)
    diskFreeBytes = typeof result?.free === 'number' ? result.free : diskFreeBytes
    diskProbePath = result?.diskPath ?? result?.path ?? targetPath
    if (result?.pathSupported === false) {
      showUnsupportedInstallPath = true
      return false
    }
    if (result?.writable === false) {
      throw new Error(`INSTALL_PERMISSION_DENIED: ${result.writeError || targetPath}`)
    }
    if (result?.enoughSpace === false) {
      throw new Error(
        `磁盘空间不足。当前阶段至少需要 ${formatGb(requiredBytes)} GB，` +
          `当前安装位置仅剩 ${formatGb(result.free)} GB。`
      )
    }
    return true
  }

  const prepareAutomaticRepair = async (stage: InstallationStage): Promise<void> => {
    try {
      if (stage === 'model-download') {
        await window.electronAPI.cancelHfDownload()
      } else if (stage === 'llama-runtime') {
        await window.electronAPI.stopLlamaCpp()
      } else if (stage === 'speech') {
        await window.electronAPI.stopSherpa()
      } else if (stage === 'terminal') {
        await window.electronAPI.stopOpenTerminal()
      } else if (stage === 'opencode') {
        await window.electronAPI.stopOpenCode()
      } else if (stage === 'webui-start') {
        await window.electronAPI.stopServer()
      }
    } catch (error) {
      console.warn('Failed to prepare installation retry:', error)
    }
  }

  const handleInstallationFailure = async (
    stage: InstallationStage,
    operation: 'core' | 'model',
    error: unknown
  ): Promise<void> => {
    const report = diagnoseInstallationFailure(stage, error, platform, installStatus)
    const repairKey = `${operation}:${report.id}`
    failedOperation = operation
    installFailure = report
    errorMsg = report.technicalDetail

    if (report.autoRepairable && (autoRepairAttempts[repairKey] ?? 0) < 1) {
      autoRepairAttempts = {
        ...autoRepairAttempts,
        [repairKey]: (autoRepairAttempts[repairKey] ?? 0) + 1
      }
      autoRepairing = true
      phase = 'repairing'
      installStatus = `正在自动修复：${report.repairDescription}`
      await prepareAutomaticRepair(stage)
      await wait(1500)
      autoRepairing = false
      if (operation === 'core') {
        await startCoreInstall(true)
      } else {
        await startModelDownload(true)
      }
      return
    }

    autoRepairing = false
    phase = 'error'
  }

  const retryFailedInstallation = (): void => {
    autoRepairAttempts = {}
    installFailure = null
    errorMsg = ''
    if (failedOperation === 'core') {
      void startCoreInstall()
    } else {
      void startModelDownload()
    }
  }

  const returnFromInstallFailure = (): void => {
    installFailure = null
    errorMsg = ''
    phase = failedOperation === 'model' ? 'model_selection' : 'ready'
  }

  const changeInstallDirFromFailure = async (): Promise<void> => {
    const folder = await window.electronAPI.selectFolder()
    if (!folder) return
    installDir = folder
    if (!(await validateInstallPath())) return
    installFailure = null
    errorMsg = ''
    await refreshDiskSpace()
    phase = failedOperation === 'model' ? 'model_selection' : 'ready'
  }

  onMount(async () => {
    defaultInstallDir = await window.electronAPI.getInstallDir()
    installDir = defaultInstallDir
    await refreshDiskSpace()
    const pathSupported = await validateInstallPath()

    // Detect variant
    if (platform === 'win32') {
      try {
        const sysInfo = await window.electronAPI.getSystemInfo()
        llamaCppVariant = detectWindowsLlamaVariant(sysInfo?.gpuName || '')
      } catch {
        llamaCppVariant = 'cpu'
      }
    } else if (platform === 'darwin') {
      llamaCppVariant = 'cpu'
    }

    await detectHardware()

    window.electronAPI.onData((data: MainEvent) => {
      if (data.type === 'status:install') {
        installStatus = typeof data.data === 'string' ? data.data : ''
        trackCoreInstallDownload(installStatus)
        return
      }
      if (data.type === 'status:llamacpp-setup') {
        installStatus = typeof data.data === 'string' ? data.data : ''
        trackCoreInstallDownload(installStatus)
        return
      }
      if (
        data.type === 'status:huggingface-download' &&
        data.data &&
        typeof data.data === 'object'
      ) {
        updateDownloadItem(data.data)
      }
    })

    if (autoStart && pathSupported) {
      if (!(await showBitdefenderWarningIfNeeded())) {
        startCoreInstall()
      }
    } else if (!autoStart && pathSupported) {
      void showBitdefenderWarningIfNeeded()
    } else {
      phase = 'ready'
    }
  })

  const startCoreInstall = async (automaticRetry = false): Promise<void> => {
    if (!automaticRetry) {
      autoRepairAttempts = {}
      installWarnings = []
    }
    phase = 'core_installing'
    installFailure = null
    errorMsg = ''
    installStatus = ''
    downloadProgress = null
    downloadItemsByKey = {}
    activeCoreDownloadKey = ''
    coreProgress = 5
    try {
      currentInstallStage = 'preflight'
      if (!(await runInstallPreflight(requiredCoreInstallBytes()))) {
        phase = 'ready'
        return
      }

      // Save custom install directory and variant
      const current = await window.electronAPI.getConfig()
      const configUpdates: Record<string, unknown> = {}
      configUpdates.localServer = {
        ...(current.localServer || {}),
        serveOnLocalNetwork: true,
        ragHardwareAcceleration: llamaCppVariant.startsWith('cuda-') && ragHardwareAcceleration
      }
      configUpdates.openTerminal = {
        ...(current.openTerminal || {}),
        enabled: false
      }
      configUpdates.sherpa = {
        ...(current.sherpa || {}),
        enabled: installSherpaRecommended
      }
      configUpdates.openCode = {
        ...(current.openCode || {}),
        enabled: installOpenCode
      }
      if (installDir && installDir !== defaultInstallDir) {
        configUpdates.installDir = installDir
      }
      if (llamaCppVariant) {
        configUpdates.llamaCpp = { ...(current.llamaCpp || {}), variant: llamaCppVariant }
      }

      if (Object.keys(configUpdates).length > 0) {
        await window.electronAPI.setConfig(configUpdates)
      }

      const pythonReady = await window.electronAPI.getPythonStatus()
      if (!pythonReady) {
        currentInstallStage = 'python'
        coreProgress = 12
        await window.electronAPI.installPython()
      }
      coreProgress = 24

      coreProgress = 28
      currentInstallStage = 'packages'
      const ok = await window.electronAPI.installPackage()
      if (!ok) throw new Error($i18n.t('setup.install.failed'))
      coreProgress = 34

      if (!(await window.electronAPI.getOpenTerminalStatus())) {
        installWarnings = [
          ...installWarnings,
          createOptionalInstallWarning('Open Terminal', 'The optional package was not installed.')
        ]
      }

      if (installOpenCode) {
        currentInstallStage = 'opencode'
        coreProgress = 35
        installStatus = $i18n.t('setup.install.opencodeInstalling')
        try {
          await window.electronAPI.installOpenCode()
          const openCodeResult = await window.electronAPI.startOpenCode()
          if (!openCodeResult?.url) {
            throw new Error('OpenCode did not become ready. Check the OpenCode log for details.')
          }
        } catch (firstError) {
          console.warn('OpenCode install failed; retrying once:', firstError)
          await prepareAutomaticRepair('opencode')
          await wait(1000)
          try {
            await window.electronAPI.installOpenCode()
            await window.electronAPI.startOpenCode()
          } catch (retryError) {
            console.warn('OpenCode install failed; continuing setup:', retryError)
            installWarnings = [
              ...installWarnings,
              createOptionalInstallWarning('OpenCode', retryError)
            ]
          }
        }
      }

      if (installSherpaRecommended) {
        currentInstallStage = 'speech'
        coreProgress = 36
        installStatus = sherpaInstallStatus()
        serverInfo.set({ ...(await window.electronAPI.getServerInfo()), status: installStatus })
        try {
          await window.electronAPI.startSherpa()
        } catch (firstError) {
          console.warn('Sherpa recommended install failed; retrying once:', firstError)
          await prepareAutomaticRepair('speech')
          await wait(1000)
          try {
            await window.electronAPI.startSherpa()
          } catch (retryError) {
            console.warn('Sherpa recommended install failed; continuing setup:', retryError)
            installWarnings = [
              ...installWarnings,
              createOptionalInstallWarning('Sherpa speech service', retryError)
            ]
          }
        }
      }
      coreProgress = 40

      currentInstallStage = 'webui-start'
      const serverStarted = await window.electronAPI.startServer()
      if (!serverStarted) {
        throw new Error('Open WebUI failed to start. Check the WebUI log for details.')
      }
      coreProgress = 42
      const info = await window.electronAPI.getServerInfo()

      currentInstallStage = 'connection'
      await window.electronAPI.addConnection({
        id: 'local',
        name: 'Local',
        type: 'local',
        url: info?.url || 'https://127.0.0.1:8081'
      })
      await window.electronAPI.setDefaultConnection('local')
      connections.set(await window.electronAPI.getConnections())
      config.set(await window.electronAPI.getConfig())

      const maxWait = 1800000
      const pollInterval = 2000
      const startTime = Date.now()
      let reachable = false
      while (Date.now() - startTime < maxWait) {
        const si = await window.electronAPI.getServerInfo()
        if (si?.reachable) {
          reachable = true
          break
        }
        if (si?.status === 'failed' || si?.status === 'stopped') {
          break
        }
        await new Promise((r) => setTimeout(r, pollInterval))
      }
      coreProgress = 45

      if (!reachable) {
        throw new Error(
          'AuraPro is still initializing. Please check the Web-UI log and retry if it does not finish.'
        )
      }

      phase = 'model_selection'
      await refreshDiskSpace()
    } catch (e) {
      await handleInstallationFailure(currentInstallStage, 'core', e)
    }
  }

  const startModelDownload = async (automaticRetry = false): Promise<void> => {
    if (!automaticRetry) {
      autoRepairAttempts = {}
    }
    installFailure = null
    errorMsg = ''
    if (!(await hasEnoughDiskSpaceForModel())) {
      await handleInstallationFailure('preflight', 'model', new Error(errorMsg))
      return
    }

    phase = 'model_downloading'
    downloadProgress = null
    downloadItemsByKey = {}
    try {
      currentInstallStage = 'preflight'
      if (!(await runInstallPreflight(requiredModelInstallBytes()))) {
        phase = 'model_selection'
        return
      }

      const current = await window.electronAPI.getConfig()
      const llamaCpp = {
        ...(current.llamaCpp || {}),
        mtpEnabled: false,
        multimodalEnabled: true
      }
      await window.electronAPI.setConfig({ llamaCpp })
      config.set(await window.electronAPI.getConfig())

      const modelKey = selectedModel.name.replace('.gguf', '')
      currentInstallStage = 'model-download'
      const downloadResults = await Promise.all([
        window.electronAPI.downloadHfModel(
          selectedModel.hfRepo,
          selectedModel.filename,
          undefined,
          selectedModel.sizeBytes,
          selectedModel.name,
          modelKey,
          modelKey
        ),
        selectedModel.mmprojRepo && selectedModel.mmprojFilename
          ? window.electronAPI.downloadHfModel(
              selectedModel.mmprojRepo,
              selectedModel.mmprojFilename,
              undefined,
              undefined,
              'mmproj-F16.gguf',
              modelKey,
              modelKey
            )
          : Promise.resolve(),
        selectedModel.mtpRepo && selectedModel.mtpFilename
          ? window.electronAPI.downloadHfModel(
              selectedModel.mtpRepo,
              selectedModel.mtpFilename,
              undefined,
              undefined,
              selectedModel.mtpFilename.split('/').pop() ?? selectedModel.mtpFilename,
              modelKey,
              modelKey
            )
          : Promise.resolve()
      ])
      if (downloadResults.some((result) => result === null || result === false)) {
        throw new Error('One or more selected model files failed to download.')
      }

      // Restart llama.cpp so it picks up the new model
      currentInstallStage = 'llama-runtime'
      installStatus = 'Starting local model service...'
      const llamaResult = await window.electronAPI.startLlamaCpp()
      if (!llamaResult?.url) {
        throw new Error('llama-server did not start. Check the llama.cpp log for details.')
      }

      phase = 'done'

      setTimeout(async () => {
        await window.electronAPI.connectTo('local')
        onComplete()
      }, 1000)
    } catch (e) {
      console.error('Model download failed', e)
      await handleInstallationFailure(currentInstallStage, 'model', e)
    }
  }

  const changeInstallDir = async () => {
    const folder = await window.electronAPI.selectFolder()
    if (folder) {
      installDir = folder
      if (!(await validateInstallPath())) return
      await refreshDiskSpace()
    }
  }

  let showBitdefenderGuide = $state(false)
  let bitdefenderGuideAcknowledged = $state(false)

  const showBitdefenderWarningIfNeeded = async () => {
    if (platform !== 'win32' || bitdefenderGuideAcknowledged || showBitdefenderGuide) {
      return false
    }
    showBitdefenderGuide = true
    return true
  }

  const handleInstallClick = async () => {
    if (await showBitdefenderWarningIfNeeded()) return
    startCoreInstall()
  }
</script>

<div class="flex flex-col" in:fade={{ duration: 200 }}>
  <button
    class="self-start text-[12px] opacity-40 hover:opacity-70 transition mb-6 bg-transparent border-none text-[#1d1d1f] dark:text-[#fafafa] disabled:opacity-20"
    onclick={onBack}
    disabled={phase === 'core_installing' || phase === 'model_downloading' || phase === 'repairing'}
  >
    {$i18n.t('common.back')}
  </button>

  {#if phase === 'ready'}
    <div class="mb-1 text-sm font-normal opacity-50">{$i18n.t('app.name')}</div>
    <h1 class="text-2xl font-light tracking-tight mb-2">Step 1: Application Setup</h1>
    <p class="text-[12px] opacity-30 mb-6 leading-relaxed">
      {$i18n.t('setup.install.description')}
    </p>

    <!-- Install location -->
    <div class="mb-5">
      <div class="text-[11px] opacity-40 mb-1.5">{$i18n.t('setup.install.installLocation')}</div>
      <div class="flex items-center gap-2">
        <div
          class="flex-1 min-w-0 px-3 py-2 bg-black/[0.04] dark:bg-white/[0.06] text-[12px] text-[#1d1d1f] dark:text-[#fafafa] opacity-50 font-mono truncate rounded-lg"
          title={installDir}
        >
          {installDir || '...'}
        </div>
        <button
          class="shrink-0 text-[11px] opacity-40 hover:opacity-70 px-2.5 py-2 bg-black/[0.04] dark:bg-white/[0.06] transition border-none text-[#1d1d1f] dark:text-[#fafafa] rounded-lg"
          onclick={changeInstallDir}
        >
          {$i18n.t('setup.install.changeLocation')}
        </button>
      </div>
    </div>

    <!-- Variant -->
    <div class="mb-8">
      <div class="text-[11px] opacity-40 mb-1.5">Llama.cpp Optimization (Accelerate)</div>
      <select
        class="w-full bg-black/[0.04] dark:bg-white/[0.06] text-[12px] text-[#1d1d1f] dark:text-[#fafafa] px-3 py-2 border-none outline-none rounded-lg cursor-pointer"
        onchange={(e) => {
          llamaCppVariant = (e.target as HTMLSelectElement).value
          if (!llamaCppVariant.startsWith('cuda-')) ragHardwareAcceleration = false
        }}
      >
        {#each variantOptions as opt (opt.value)}
          <option value={opt.value} selected={llamaCppVariant === opt.value}>{opt.label}</option>
        {/each}
      </select>
      <div class="text-[10px] opacity-20 mt-1">
        Select the best version for your GPU to get maximum speed.
      </div>
    </div>

    {#if llamaCppVariant.startsWith('cuda-')}
      <div
        class="mb-8 flex items-start justify-between gap-4 rounded-xl bg-black/[0.03] px-4 py-3 dark:bg-white/[0.04]"
      >
        <div>
          <div class="text-[12px] opacity-70">RAG 硬件加速</div>
          <div class="mt-1 text-[10px] leading-relaxed opacity-25">
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

    <div class="mb-8 rounded-xl bg-black/[0.03] dark:bg-white/[0.04] px-4 py-3">
      <label class="flex items-start gap-3 cursor-pointer">
        <input type="checkbox" class="mt-0.5" bind:checked={installSherpaRecommended} />
        <div>
          <div class="text-[12px] opacity-70">Install Sherpa speech service (Recommended)</div>
          <div class="text-[10px] opacity-25 mt-1 leading-relaxed">
            Enables local voice input and TTS. You can change or remove it later in Speech settings.
          </div>
        </div>
      </label>
    </div>

    <div class="mb-8 rounded-xl bg-black/[0.03] px-4 py-3 dark:bg-white/[0.04]">
      <label class="flex cursor-pointer items-start gap-3">
        <input type="checkbox" class="mt-0.5" bind:checked={installOpenCode} />
        <div>
          <div class="text-[12px] opacity-70">{$i18n.t('setup.install.opencode')}</div>
          <div class="mt-1 text-[10px] leading-relaxed opacity-25">
            {$i18n.t('setup.install.opencodeDesc')}
          </div>
        </div>
      </label>
    </div>

    <div class="mb-6 border-t border-black/[0.06] pt-3 dark:border-white/[0.08]">
      <div class="flex items-center justify-between gap-4">
        <span class="text-[12px] opacity-55">当前步骤预计所需空间</span>
        <span class="shrink-0 font-mono text-[13px] text-emerald-500">
          约 {formatGb(requiredCoreInstallBytes())} GB
        </span>
      </div>
      <div class="mt-1 flex items-center justify-between gap-4">
        <span class="text-[11px] opacity-35">当前安装磁盘剩余空间</span>
        <span
          class="shrink-0 font-mono text-[12px] {diskFreeBytes !== null &&
          diskFreeBytes >= 0 &&
          diskFreeBytes < requiredCoreInstallBytes()
            ? 'text-red-500 dark:text-red-400'
            : 'opacity-45'}"
        >
          {checkingDiskSpace || diskFreeBytes === null
            ? '检测中...'
            : diskFreeBytes < 0
              ? '无法检测'
              : `${formatGb(diskFreeBytes)} GB`}
        </span>
      </div>
      <div class="mt-1 text-[10px] leading-relaxed opacity-25">
        核心组件 6 GB{llamaCppVariant.startsWith('cuda-') && ragHardwareAcceleration
          ? ' · RAG CUDA 约 3 GB'
          : ''}
        {installOpenCode ? ' · OpenCode 约 0.5 GB' : ''}
      </div>
    </div>

    <button
      class="w-fit inline-flex items-center gap-2 bg-white px-8 py-2.5 text-black text-[13px] transition hover:bg-gray-100 border-none"
      onclick={handleInstallClick}
    >
      Install AuraPro Core
      <svg
        class="h-3.5 w-3.5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="1.5"
      >
        <path stroke-linecap="round" stroke-linejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
      </svg>
    </button>
  {:else if phase === 'core_installing'}
    <div class="flex flex-col items-center gap-5 py-10" in:fade={{ duration: 250 }}>
      <img src={logoImage} class="size-12 rounded-full dark:invert animate-pulse" alt="logo" />
      <div class="flex flex-col items-center gap-2 text-center">
        <div class="text-sm opacity-60">Installing Core Components...</div>
        {#if installStatus}
          <div
            class="text-[11px] opacity-30 max-w-[320px] leading-relaxed"
            in:fade={{ duration: 200 }}
          >
            {installStatus}
          </div>
        {:else if $serverInfo?.status}
          <div
            class="text-[11px] opacity-30 max-w-[220px] leading-relaxed"
            in:fade={{ duration: 200 }}
          >
            {$serverInfo.status}
          </div>
        {:else}
          <div class="text-[11px] opacity-20">
            {$i18n.t('setup.install.mightTakeMinutes')}
          </div>
        {/if}
      </div>

      <div class="w-full max-w-[340px] rounded-xl bg-black/[0.03] dark:bg-white/[0.04] px-4 py-3">
        <div class="mb-2 flex items-center justify-between text-[10px] opacity-40">
          <span>总进度</span>
          <span>{installOverallProgress.toFixed(1)}%</span>
        </div>
        <div class="h-[4px] overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.06]">
          <div
            class="h-full rounded-full bg-emerald-400/70 transition-[width] duration-300"
            style="width: {installOverallProgress}%"
          ></div>
        </div>

        {#if downloadItems.length > 0}
          <div class="mt-4 border-t border-black/[0.06] pt-3 dark:border-white/[0.08]">
            {#if coreDownloadsDone}
              <!-- All core downloads finished — collapse to a single summary row -->
              <div class="flex items-center gap-2 text-[10px]" in:fade={{ duration: 200 }}>
                <svg
                  class="h-3.5 w-3.5 shrink-0 text-emerald-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                <span class="opacity-40">已完成 {downloadItems.length} 项文件下载</span>
              </div>
            {:else}
              <!-- Active downloads — show item cards (no redundant summary bar) -->
              <div class="flex flex-col gap-2 text-left">
                {#each downloadItems.slice(-3) as item (downloadKey(item))}
                  {#if item.status === 'done'}
                    <!-- Compact done row -->
                    <div
                      class="flex items-center gap-2 px-1 text-[10px]"
                      in:fade={{ duration: 150 }}
                    >
                      <svg
                        class="h-3 w-3 shrink-0 text-emerald-400/70"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        stroke-width="2.5"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          d="M4.5 12.75l6 6 9-13.5"
                        />
                      </svg>
                      <span class="min-w-0 truncate font-mono opacity-35" title={item.filename}
                        >{item.filename}</span
                      >
                    </div>
                  {:else}
                    <!-- Full card for active download -->
                    <div class="rounded-lg bg-white/[0.45] px-3 py-2 dark:bg-black/[0.16]">
                      <div class="mb-1 flex items-center justify-between gap-3">
                        <div
                          class="min-w-0 truncate font-mono text-[10px] opacity-60"
                          title={item.filename}
                        >
                          {item.filename}
                        </div>
                        <div class="shrink-0 text-[10px] opacity-40">
                          {item.status === 'failed' ? '失败' : `${item.percent.toFixed(1)}%`}
                        </div>
                      </div>
                      <div class="mb-1.5 text-[10px] leading-relaxed opacity-35">
                        {item.detail ??
                          `${formatBytes(item.downloadedBytes)} / ${item.totalBytes ? formatBytes(item.totalBytes) : '未知大小'} · ${formatSpeed(item.bytesPerSecond)} · 预计 ${formatEta(item.etaSeconds)}`}
                      </div>
                      <div
                        class="h-[2px] overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.06]"
                      >
                        <div
                          class="h-full rounded-full bg-emerald-400/60 transition-[width] duration-300"
                          style="width: {item.percent}%"
                        ></div>
                      </div>
                    </div>
                  {/if}
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  {:else if phase === 'repairing' && installFailure}
    <div class="flex flex-col items-center gap-4 py-6" in:fade={{ duration: 200 }}>
      <div class="flex flex-col items-center gap-2 text-center">
        <div
          class="h-5 w-5 rounded-full border-2 border-black/15 border-t-emerald-400 animate-spin dark:border-white/15"
        ></div>
        <div class="text-[12px] font-medium opacity-65">正在自动诊断和修复安装故障</div>
        <div class="max-w-[360px] text-[10px] leading-relaxed opacity-35">{installStatus}</div>
      </div>
      <InstallFailurePanel
        report={installFailure}
        repairing={true}
        onRetry={retryFailedInstallation}
        onBack={returnFromInstallFailure}
      />
    </div>
  {:else if phase === 'model_selection'}
    <div in:fade={{ duration: 250 }}>
      <div class="mb-1 text-sm font-normal opacity-50">{$i18n.t('app.name')}</div>
      <h1 class="text-2xl font-light tracking-tight mb-2">Step 2: Model Selection</h1>
      <p class="text-[12px] opacity-30 mb-6 leading-relaxed">
        Select the AI model you want to use. You can also download more later from settings.
      </p>

      {#if installWarnings.length > 0}
        <div class="mb-5 grid gap-2">
          {#each installWarnings as warning (warning.id)}
            <div class="rounded-lg border border-amber-500/15 bg-amber-500/[0.06] px-3 py-2.5">
              <div class="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                {warning.title}
              </div>
              <div class="mt-1 text-[10px] leading-relaxed opacity-40">{warning.detail}</div>
            </div>
          {/each}
        </div>
      {/if}

      {#if detectingHardware}
        <div
          class="mb-5 rounded-xl bg-black/[0.03] dark:bg-white/[0.04] px-4 py-3 text-[12px] opacity-50"
        >
          正在检测配置，请稍候。
        </div>
      {/if}

      <div class="mb-5">
        <div class="text-[11px] opacity-40 mb-1.5">Recommendation Focus</div>
        <div class="grid grid-cols-2 gap-2">
          <button
            type="button"
            class="rounded-xl border-none px-4 py-1.5 text-center transition {modelPreference ===
            'quality'
              ? 'bg-white/[0.08] ring-1 ring-white/20'
              : 'bg-black/[0.03] dark:bg-white/[0.03] hover:bg-white/[0.05]'}"
            onclick={() => {
              modelPreference = 'quality'
              applyRecommendedModel()
            }}
          >
            <div
              class="text-[13px] font-medium {modelPreference === 'quality'
                ? 'text-emerald-400'
                : 'opacity-80'}"
            >
              注重质量
            </div>
          </button>
          <button
            type="button"
            class="rounded-xl border-none px-4 py-1.5 text-center transition {modelPreference ===
            'speed'
              ? 'bg-white/[0.08] ring-1 ring-white/20'
              : 'bg-black/[0.03] dark:bg-white/[0.03] hover:bg-white/[0.05]'}"
            onclick={() => {
              modelPreference = 'speed'
              applyRecommendedModel()
            }}
          >
            <div
              class="text-[13px] font-medium {modelPreference === 'speed'
                ? 'text-emerald-400'
                : 'opacity-80'}"
            >
              注重速度
            </div>
          </button>
        </div>
      </div>

      <div class="mb-8">
        <div class="text-[11px] opacity-40 mb-1.5">
          Recommended based on RAM/VRAM: {systemMemGB ?? '?'}GB / {dedicatedVramGB}GB
        </div>
        <div class="flex flex-col gap-2">
          {#each visibleModels() as model (model.filename)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="flex items-center justify-between px-4 py-3 rounded-xl cursor-pointer transition-all {selectedModel.name ===
              model.name
                ? 'bg-white/[0.08] ring-1 ring-white/20'
                : 'bg-black/[0.03] dark:bg-white/[0.03] hover:bg-white/[0.05]'}"
              onclick={() => selectModel(model)}
            >
              <div class="flex flex-col">
                <span
                  class="text-[13px] font-medium {selectedModel.name === model.name
                    ? 'text-emerald-400'
                    : 'opacity-80'}">{model.name.replace('.gguf', '')}</span
                >
                <span class="text-[10px] opacity-30">
                  {model.sizeStr} · {model.ramInfo}{model.macOnly ? ' · Mac only' : ''}
                </span>
                <div class="mt-1 flex flex-wrap gap-1">
                  {#each modelCapabilities(model.name) as capability (capability)}
                    <span
                      class="rounded border border-black/[0.06] px-1.5 py-px text-[9px] opacity-30 dark:border-white/[0.08]"
                    >
                      {$i18n.t('settings.models.capability.' + capability)}
                    </span>
                  {/each}
                </div>
              </div>
              {#if selectedModel.name === model.name}
                <div class="size-2 rounded-full bg-emerald-400"></div>
              {/if}
            </div>
          {/each}
        </div>
      </div>

      <div class="mb-5 rounded-xl bg-black/[0.03] px-4 py-3 dark:bg-white/[0.04]">
        <div class="mb-2 flex items-center justify-between gap-3 text-[11px] opacity-50">
          <span>安装空间检查</span>
          <span class={hasEnoughDiskSpace() ? 'text-emerald-400' : 'text-red-400'}>
            {checkingDiskSpace ? '检测中' : hasEnoughDiskSpace() ? '空间充足' : '空间不足'}
          </span>
        </div>
        <div class="grid gap-1.5 text-[10px] leading-relaxed opacity-35">
          <div class="flex items-center justify-between gap-3">
            <span>至少需要</span>
            <span class="font-mono">{formatGb(requiredModelInstallBytes())} GB</span>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span>当前剩余</span>
            <span class="font-mono">
              {diskFreeBytes === null
                ? '检测中...'
                : diskFreeBytes < 0
                  ? '无法检测'
                  : `${formatGb(diskFreeBytes)} GB`}
            </span>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span>Sherpa</span>
            <span>{installSherpaRecommended ? '模型大小 + 5GB' : '模型大小 + 3GB'}</span>
          </div>
          <div class="mt-1 truncate font-mono opacity-70" title={diskProbePath || installDir}>
            {diskProbePath || installDir}
          </div>
        </div>
      </div>

      {#if errorMsg}
        <div
          class="mb-5 rounded-xl bg-red-500/[0.08] px-4 py-3 text-[12px] leading-relaxed text-red-500 dark:text-red-300"
        >
          {errorMsg}
        </div>
      {/if}

      <button
        class="w-fit inline-flex items-center gap-2 bg-white px-8 py-2.5 text-black text-[13px] transition hover:bg-gray-100 border-none"
        onclick={startModelDownload}
      >
        Download & Finish Setup
        <svg
          class="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="1.5"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
        </svg>
      </button>
    </div>
  {:else if phase === 'model_downloading'}
    <div class="flex flex-col items-center gap-5 py-10" in:fade={{ duration: 250 }}>
      <img src={logoImage} class="size-12 rounded-full dark:invert animate-pulse" alt="logo" />

      {#if modelLoadingPhase}
        <!-- All files downloaded — model service is starting -->
        <div
          class="flex w-full max-w-[360px] flex-col items-center gap-4 text-center"
          in:fade={{ duration: 200 }}
        >
          <div class="flex flex-col items-center gap-1.5">
            <div class="text-sm opacity-70">模型文件下载完成</div>
            <div class="text-[11px] opacity-35 leading-relaxed">
              {installStatus || '正在加载模型服务，请稍候...'}
            </div>
          </div>
          <div class="w-full rounded-xl bg-black/[0.03] px-4 py-3 dark:bg-white/[0.04]">
            <!-- Completed files summary -->
            <div class="flex flex-col gap-1.5 mb-3">
              {#each downloadItems as item (downloadKey(item))}
                <div class="flex items-center gap-2 text-[10px]">
                  <svg
                    class="h-3 w-3 shrink-0 text-emerald-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    stroke-width="2.5"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M4.5 12.75l6 6 9-13.5"
                    />
                  </svg>
                  <span class="min-w-0 truncate font-mono opacity-40" title={item.filename}
                    >{item.filename}</span
                  >
                  <span class="ml-auto shrink-0 opacity-25"
                    >{item.totalBytes ? formatBytes(item.totalBytes) : ''}</span
                  >
                </div>
              {/each}
            </div>
            <!-- Loading indicator -->
            <div
              class="border-t border-black/[0.06] dark:border-white/[0.08] pt-3 flex items-center gap-2"
            >
              <div class="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping shrink-0"></div>
              <div
                class="h-[2px] flex-1 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.06]"
              >
                <div
                  class="h-full w-full rounded-full bg-emerald-400/50 origin-left animate-pulse"
                ></div>
              </div>
            </div>
          </div>
        </div>
      {:else}
        <!-- Files are downloading -->
        <div class="flex w-full max-w-[360px] flex-col items-center gap-3 text-center">
          <div class="flex flex-col items-center gap-1">
            <div class="text-sm opacity-60">正在下载模型...</div>
            <div class="text-[11px] opacity-35 font-mono">{selectedModel.name}</div>
          </div>

          <div class="w-full rounded-xl bg-black/[0.03] px-4 py-3 dark:bg-white/[0.04]">
            <!-- Single download progress bar -->
            <div class="mb-2 flex items-center justify-between text-[10px] opacity-40">
              <span>下载进度</span>
              <span>{totalDownloadProgress.toFixed(1)}%</span>
            </div>
            <div class="h-[4px] overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.06]">
              <div
                class="h-full rounded-full bg-emerald-400/70 transition-[width] duration-300"
                style="width: {totalDownloadProgress}%"
              ></div>
            </div>

            <div class="mt-4 flex flex-col gap-2 text-left">
              {#if downloadItems.length > 0}
                {#each downloadItems as item (downloadKey(item))}
                  {#if item.status === 'done'}
                    <!-- Compact done row -->
                    <div
                      class="flex items-center gap-2 px-1 text-[10px]"
                      in:fade={{ duration: 150 }}
                    >
                      <svg
                        class="h-3 w-3 shrink-0 text-emerald-400/80"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        stroke-width="2.5"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          d="M4.5 12.75l6 6 9-13.5"
                        />
                      </svg>
                      <span class="min-w-0 truncate font-mono opacity-40" title={item.filename}
                        >{item.filename}</span
                      >
                      <span class="ml-auto shrink-0 opacity-25"
                        >{item.totalBytes ? formatBytes(item.totalBytes) : ''}</span
                      >
                    </div>
                  {:else}
                    <!-- Full card for active/failed download -->
                    <div class="rounded-lg bg-white/[0.45] px-3 py-2 dark:bg-black/[0.16]">
                      <div class="mb-1 flex items-center justify-between gap-3">
                        <div
                          class="min-w-0 truncate font-mono text-[10px] opacity-65"
                          title={item.filename}
                        >
                          {item.filename}
                        </div>
                        <div
                          class="shrink-0 text-[10px] {item.status === 'failed'
                            ? 'text-red-400'
                            : 'opacity-45'}"
                        >
                          {item.status === 'failed' ? '失败' : `${item.percent.toFixed(1)}%`}
                        </div>
                      </div>
                      <div class="mb-2 text-[10px] leading-relaxed opacity-35">
                        {item.detail ??
                          `${formatBytes(item.downloadedBytes)} / ${item.totalBytes ? formatBytes(item.totalBytes) : '未知大小'} · ${formatSpeed(item.bytesPerSecond)} · 预计 ${formatEta(item.etaSeconds)}`}
                      </div>
                      <div
                        class="h-[3px] overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.06]"
                      >
                        <div
                          class="h-full rounded-full {item.status === 'failed'
                            ? 'bg-red-400/60'
                            : 'bg-emerald-400/55'} transition-[width] duration-300"
                          style="width: {item.percent}%"
                        ></div>
                      </div>
                    </div>
                  {/if}
                {/each}
              {:else}
                <div class="px-1 text-[10px] opacity-25">正在准备下载任务...</div>
              {/if}
            </div>
          </div>
        </div>
      {/if}
    </div>
  {:else if phase === 'done'}
    <div class="flex flex-col items-center gap-4 py-10" in:fade={{ duration: 250 }}>
      <img src={logoImage} class="size-12 rounded-full dark:invert" alt="logo" />
      <div class="text-sm text-green-400 opacity-70">AuraPro is ready!</div>
    </div>
  {:else if phase === 'error'}
    <div class="flex flex-col items-center py-4" in:fade={{ duration: 250 }}>
      {#if installFailure}
        <InstallFailurePanel
          report={installFailure}
          repairing={autoRepairing}
          onRetry={retryFailedInstallation}
          onBack={returnFromInstallFailure}
          onChooseFolder={changeInstallDirFromFailure}
        />
      {:else}
        <div class="text-[12px] text-red-400 opacity-80">{errorMsg}</div>
      {/if}
    </div>
  {/if}
</div>

{#if showBitdefenderGuide}
  <BitdefenderGuide
    onClose={() => {
      showBitdefenderGuide = false
    }}
    onContinue={() => {
      bitdefenderGuideAcknowledged = true
      showBitdefenderGuide = false
      startCoreInstall()
    }}
  />
{/if}

{#if showUnsupportedInstallPath}
  <UnsupportedInstallPathDialog
    path={installDir || defaultInstallDir}
    onCancel={() => {
      showUnsupportedInstallPath = false
    }}
    onChange={changeInstallDir}
  />
{/if}
