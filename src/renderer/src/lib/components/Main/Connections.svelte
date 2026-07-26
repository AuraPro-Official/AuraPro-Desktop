<script lang="ts">
  import type * as Electron from 'electron'
  import { onMount } from 'svelte'
  import { SvelteMap } from 'svelte/reactivity'
  import { fade } from 'svelte/transition'
  import { connections, config, serverInfo, appInfo } from '../../stores'
  import i18n from '../../i18n'
  import {
    diagnoseInstallationFailure,
    type InstallationFailureReport,
    type InstallationStage
  } from '../../utils/install-diagnostics'
  import { getErrorMessage } from '../../utils/errors'

  import Sidebar from './Connections/Sidebar.svelte'
  import Content from './Connections/Content.svelte'
  import StatusBar from './Connections/StatusBar.svelte'
  import LogPanel from './Connections/LogPanel.svelte'

  type LlamaDiagnosticsComponentType =
    (typeof import('./Connections/LlamaDiagnostics.svelte'))['default']

  interface Props {
    onOpenSettings: (tab?: string) => void
    sidebarOpen: boolean
    activeConnectionName?: string
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

  interface AuraModel {
    name: string
    sizeBytes: number
    hfRepo: string
    filename: string
    mmprojRepo?: string
    mmprojFilename?: string
    mtpRepo?: string
    mtpFilename?: string
  }

  interface InstallOptions {
    installOpenTerminal?: boolean
    installLlamaCpp?: boolean
    installSherpa?: boolean
    installDir?: string
    selectedModel?: AuraModel
    llamaCppVariant?: string
    ragHardwareAcceleration?: boolean
  }

  interface ServiceInfo {
    url?: string
    status?: string
    pid?: number
    binaryPath?: string
  }

  interface ConnectionResult {
    connectionId: string
    url: string
  }

  interface MainEventPayload extends Partial<DownloadItem>, ServiceInfo {
    connectionId?: string
    query?: string
    files?: unknown[]
    shortcutAction?: string | null
  }

  interface MainEvent {
    type: string
    data?: unknown
  }

  let { onOpenSettings, sidebarOpen, activeConnectionName = $bindable('') }: Props = $props()

  let showingLogs = $state(false)

  let url = $state('')
  let connecting = $state(false)
  let error = $state('')
  let view = $state('welcome') // welcome | install | connected
  let autoInstall = $state(false)
  let installPhase = $state('idle') // idle | working | error
  let installError = $state('')
  let toastVisible = $state(false)
  let toastTimeout: ReturnType<typeof setTimeout> | null = null
  let installStatus = $state('')
  let installProgress = $state(0)
  let installFailure = $state<InstallationFailureReport | null>(null)
  let installAutoRepairing = $state(false)
  let installAutoRepairAttempts = $state<Record<string, number>>({})
  let currentInstallStage = $state<InstallationStage>('preflight')
  let downloadItemsByKey = $state<Record<string, DownloadItem>>({})
  let activeCoreDownloadKey = $state('')
  let settingsOpen = $state(false)
  let activeConnectionId = $state('')
  let connectingId = $state('')
  let lastInstallOptions = $state<InstallOptions | null>(null)
  const openConnections = new SvelteMap<string, string>()
  let localInstalled = $state(false)
  let showAddConnectionModal = $state(false)
  let LlamaDiagnosticsComponent = $state<LlamaDiagnosticsComponentType | null>(null)
  let llamaDiagnosticsLoadPromise: Promise<LlamaDiagnosticsComponentType> | null = null

  // Active log panel
  let activeLog = $state<'server' | 'open-terminal' | 'llama-server' | 'sherpa' | null>(null)

  const loadLlamaDiagnostics = () => {
    llamaDiagnosticsLoadPromise ??= import('./Connections/LlamaDiagnostics.svelte').then(
      (module) => {
        LlamaDiagnosticsComponent = module.default
        return LlamaDiagnosticsComponent
      }
    )
    return llamaDiagnosticsLoadPromise
  }

  const serverStatus = $derived($serverInfo?.status)
  const serverReachable = $derived($serverInfo?.reachable)

  const localConn = $derived(($connections ?? []).find((c) => c.type === 'local'))
  const remoteConnections = $derived(($connections ?? []).filter((c) => c.type !== 'local'))
  const statusBarServiceActive = (status: string | null) => Boolean(status && status !== 'stopped')
  const showOpenTerminalInStatusBar = $derived(
    Boolean($config?.openTerminal?.enabled) || statusBarServiceActive(openTerminalStatus)
  )
  const showSherpaInStatusBar = $derived(
    Boolean($config?.sherpa?.enabled) || statusBarServiceActive(sherpaStatus)
  )
  const clampPercent = (value: number) =>
    Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
  const downloadKey = (item: { repo?: string; filename?: string }) =>
    `${item.repo ?? ''}/${item.filename ?? ''}`
  const downloadItems = $derived(Object.values(downloadItemsByKey))
  const totalDownloadProgress = $derived(
    (() => {
      const items = Object.values(downloadItemsByKey)
      if (items.length === 0) return 0

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

  const updateDownloadItem = (data: Partial<DownloadItem> & { filename?: string }) => {
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

  const requiredInstallBytes = (options: InstallOptions) => {
    const gib = 1024 * 1024 * 1024
    const modelBytes = Number(options?.selectedModel?.sizeBytes ?? 0)
    const coreBytes = 6 * gib
    const sherpaBytes = options?.installSherpa === false ? 0 : 2 * gib
    const ragCudaBytes =
      String(options?.llamaCppVariant ?? '').startsWith('cuda-') &&
      options?.ragHardwareAcceleration === true
        ? 3 * gib
        : 0
    return coreBytes + modelBytes + sherpaBytes + ragCudaBytes
  }

  const shouldEnableMtpForModel = (model?: AuraModel) => {
    const name = String(model?.name ?? '').toLowerCase()
    if (!name) return false
    if (name === 'lowest.gguf' || name.startsWith('low_') || name.startsWith('low-')) return false
    return name.startsWith('medium') || name.startsWith('high')
  }

  const showToast = (message: string) => {
    installError = message
    toastVisible = true
    if (toastTimeout) clearTimeout(toastTimeout)
    toastTimeout = setTimeout(() => {
      toastVisible = false
    }, 5000)
  }
  const shareLocal = async () => {
    try {
      installStatus = 'Preparing LAN share link...'
      const result = await window.electronAPI.shareLocalServer()
      serverInfo.set(await window.electronAPI.getServerInfo())
      config.set(await window.electronAPI.getConfig())
      installStatus = ''
      showToast(`LAN link copied: ${result?.url ?? 'local link'}`)
    } catch (error: unknown) {
      installStatus = ''
      showToast(`Unable to share LAN link: ${getErrorMessage(error, String(error))}`)
    }
  }

  // Open Terminal state
  let openTerminalStatus = $state<string | null>(null)
  // Llama Server state
  let llamaCppStatus = $state<string | null>(null)
  let llamaCppInfo = $state<{ url?: string; pid?: number } | null>(null)
  let llamaCppSetupStatus = $state('')

  // sherpa state
  let sherpaStatus = $state<string | null>(null)
  let sherpaSetupStatus = $state('')

  const waitForInstallRepair = (milliseconds: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, milliseconds))
  const sherpaInstallStatus = (): string =>
    ($i18n.language ?? '').toLowerCase().startsWith('zh')
      ? '正在启动 Sherpa（首次安装语音模型预计需要 5-15 分钟）'
      : 'Starting Sherpa (initial speech model setup takes about 5-15 minutes)'

  const prepareInstallRepair = async (stage: InstallationStage): Promise<void> => {
    try {
      if (stage === 'model-download') {
        await window.electronAPI.cancelHfDownload()
      } else if (stage === 'llama-runtime') {
        await window.electronAPI.stopLlamaCpp()
      } else if (stage === 'terminal') {
        await window.electronAPI.stopOpenTerminal()
      } else if (stage === 'speech') {
        await window.electronAPI.stopSherpa()
      } else if (stage === 'webui-start' || stage === 'connection') {
        await window.electronAPI.stopServer()
      }
    } catch (repairError) {
      console.warn('Failed to prepare automatic installation repair:', repairError)
    }
  }

  const startInstall = async (options?: InstallOptions, automaticRetry = false) => {
    const resolvedOptions = options ?? lastInstallOptions ?? {}
    if (!automaticRetry) {
      installAutoRepairAttempts = {}
    }
    if (options) lastInstallOptions = options

    installPhase = 'working'
    installError = ''
    installFailure = null
    installStatus = 'Preparing installation...'
    installProgress = 2
    downloadItemsByKey = {}
    activeCoreDownloadKey = ''
    toastVisible = false
    try {
      currentInstallStage = 'preflight'
      installStatus = '正在检查安装路径和空间...'
      installProgress = 5
      const targetInstallDir =
        resolvedOptions?.installDir || (await window.electronAPI.getInstallDir())
      const requiredBytes = requiredInstallBytes(resolvedOptions)
      const preflight = await window.electronAPI.checkInstallPreflight(
        targetInstallDir,
        requiredBytes
      )
      if (preflight?.pathSupported === false) {
        throw new Error(`INSTALL_PATH_UNSUPPORTED: ${preflight.path || targetInstallDir}`)
      }
      if (preflight?.writable === false) {
        throw new Error(`INSTALL_PERMISSION_DENIED: ${preflight.writeError || targetInstallDir}`)
      }
      if (preflight?.enoughSpace === false) {
        const requiredGB = (requiredBytes / (1024 * 1024 * 1024)).toFixed(1)
        const availableGB = (preflight.free / (1024 * 1024 * 1024)).toFixed(1)
        throw new Error(
          `磁盘空间不足。当前安装至少需要 ${requiredGB} GB 可用空间，当前安装位置所在磁盘仅剩 ${availableGB} GB。请重新设置安装位置或清理硬盘空间后重试。`
        )
      }

      // Save custom install directory and variant before anything else
      const currentConfig = await window.electronAPI.getConfig()
      const configUpdates: Record<string, unknown> = {}
      const selectedVariant =
        resolvedOptions?.llamaCppVariant || currentConfig.llamaCpp?.variant || 'cpu'
      configUpdates.localServer = {
        ...(currentConfig.localServer || {}),
        serveOnLocalNetwork: true,
        ragHardwareAcceleration:
          selectedVariant.startsWith('cuda-') && resolvedOptions?.ragHardwareAcceleration === true
      }
      if (Object.prototype.hasOwnProperty.call(resolvedOptions, 'installOpenTerminal')) {
        configUpdates.openTerminal = {
          ...(currentConfig.openTerminal || {}),
          enabled: resolvedOptions.installOpenTerminal === true
        }
      }
      if (Object.prototype.hasOwnProperty.call(resolvedOptions, 'installSherpa')) {
        configUpdates.sherpa = {
          ...(currentConfig.sherpa || {}),
          enabled: resolvedOptions.installSherpa === true
        }
      }
      if (resolvedOptions?.installDir) {
        const currentDir = await window.electronAPI.getInstallDir()
        if (resolvedOptions.installDir !== currentDir) {
          configUpdates.installDir = resolvedOptions.installDir
        }
      }
      if (resolvedOptions?.llamaCppVariant) {
        configUpdates.llamaCpp = {
          ...(currentConfig.llamaCpp || {}),
          variant: resolvedOptions.llamaCppVariant
        }
      }
      if (resolvedOptions?.selectedModel) {
        configUpdates.llamaCpp = {
          ...(currentConfig.llamaCpp || {}),
          ...(configUpdates.llamaCpp || {}),
          mtpEnabled: shouldEnableMtpForModel(resolvedOptions.selectedModel)
        }
      }

      if (Object.keys(configUpdates).length > 0) {
        await window.electronAPI.setConfig(configUpdates)
      }

      // Ensure Python and uv are installed before attempting package install
      currentInstallStage = 'python'
      const pythonReady = await window.electronAPI.getPythonStatus()
      if (!pythonReady) {
        installStatus = 'Installing Python runtime...'
        installProgress = 10
        await window.electronAPI.installPython()
      }

      currentInstallStage = 'packages'
      installStatus = $i18n.t('main.install.installingPackage')
      installProgress = 25
      const ok = await window.electronAPI.installPackage()
      if (!ok) throw new Error($i18n.t('error.installFailedGeneric'))

      // Download selected model if provided
      if (resolvedOptions?.selectedModel) {
        installStatus = `Downloading model: ${resolvedOptions.selectedModel.name}...`
        try {
          if (resolvedOptions.selectedModel.name === 'low_EQ4_MAC_8G.gguf') {
            const current = await window.electronAPI.getConfig()
            const llamaCpp = {
              ...(current.llamaCpp || {}),
              mtpEnabled: shouldEnableMtpForModel(resolvedOptions.selectedModel),
              ctxSize: 8192,
              parallel: 1,
              extraArgs: ['-b', '512', '--ubatch-size', '256']
            }
            await window.electronAPI.setConfig({ llamaCpp })
            config.set(await window.electronAPI.getConfig())
          }

          if (resolvedOptions?.installLlamaCpp) {
            currentInstallStage = 'llama-runtime'
            installStatus = 'Preparing local model runtime...'
            installProgress = 45
            await window.electronAPI.setupLlamaCpp()
          }

          const modelKey = resolvedOptions.selectedModel.name.replace('.gguf', '')
          currentInstallStage = 'model-download'
          installStatus = `Downloading model: ${resolvedOptions.selectedModel.name}...`
          installProgress = 52
          await window.electronAPI.downloadHfModel(
            resolvedOptions.selectedModel.hfRepo,
            resolvedOptions.selectedModel.filename,
            undefined,
            resolvedOptions.selectedModel.sizeBytes,
            resolvedOptions.selectedModel.name, // e.g. "low_E4.gguf"
            modelKey,
            modelKey
          )

          if (
            resolvedOptions.selectedModel.mmprojRepo &&
            resolvedOptions.selectedModel.mmprojFilename
          ) {
            installStatus = `Downloading vision projector: ${resolvedOptions.selectedModel.name}...`
            installProgress = 60
            await window.electronAPI.downloadHfModel(
              resolvedOptions.selectedModel.mmprojRepo,
              resolvedOptions.selectedModel.mmprojFilename,
              undefined,
              undefined,
              'mmproj-F16.gguf',
              modelKey,
              modelKey
            )
          }

          if (resolvedOptions.selectedModel.mtpRepo && resolvedOptions.selectedModel.mtpFilename) {
            installStatus = `Downloading MTP draft model: ${resolvedOptions.selectedModel.name}...`
            installProgress = 66
            await window.electronAPI.downloadHfModel(
              resolvedOptions.selectedModel.mtpRepo,
              resolvedOptions.selectedModel.mtpFilename,
              undefined,
              undefined,
              resolvedOptions.selectedModel.mtpFilename,
              modelKey,
              modelKey
            )
          }
        } catch (e) {
          console.error('Initial model download failed', e)
          throw e
        }
      } else if (resolvedOptions?.installLlamaCpp) {
        currentInstallStage = 'llama-runtime'
        installStatus = 'Preparing llama.cpp...'
        installProgress = 45
        await window.electronAPI.setupLlamaCpp()
      }

      if (resolvedOptions?.installLlamaCpp) {
        currentInstallStage = 'llama-runtime'
        installStatus = 'Starting llama-server...'
        installProgress = 72
        const llamaResult = await window.electronAPI.startLlamaCpp()
        if (!llamaResult?.url) {
          throw new Error('llama-server did not start. Check the llama.cpp log for details.')
        }
      }

      if (resolvedOptions?.installOpenTerminal) {
        currentInstallStage = 'terminal'
        installStatus = 'Starting Open Terminal...'
        installProgress = 80
        const openTerminalResult = await window.electronAPI.startOpenTerminal()
        if (!openTerminalResult?.url) {
          throw new Error('Open Terminal did not start. Check the Open Terminal log for details.')
        }
        openTerminalStatus = 'started'
      }

      if (resolvedOptions?.installSherpa) {
        currentInstallStage = 'speech'
        installStatus = sherpaInstallStatus()
        installProgress = 86
        const sherpaResult = await window.electronAPI.startSherpa()
        if (!sherpaResult?.url) {
          throw new Error('sherpa did not start. Check the sherpa log for details.')
        }
        sherpaStatus = 'started'
      }

      currentInstallStage = 'webui-start'
      installStatus = $i18n.t('main.install.startingServer')
      installProgress = 92
      const serverStarted = await window.electronAPI.startServer()
      if (!serverStarted) {
        throw new Error('AuraPro WebUI failed to start. Check the Web-UI log for details.')
      }
      const info = await window.electronAPI.getServerInfo()

      currentInstallStage = 'connection'
      installStatus = $i18n.t('main.install.settingUpConnection')
      installProgress = 95
      await window.electronAPI.addConnection({
        id: 'local',
        name: 'Local',
        type: 'local',
        url: info?.url || 'https://127.0.0.1:8080'
      })
      await window.electronAPI.setDefaultConnection('local')
      connections.set(await window.electronAPI.getConnections())
      config.set(await window.electronAPI.getConfig())

      // Wait for server to actually be reachable before showing connected view
      installStatus = $i18n.t('main.install.launchingOpenWebUI')
      installProgress = 97
      const maxWait = 1800000
      const pollInterval = 2000
      const startTime = Date.now()
      let lastStatusUpdate = 0
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
        const elapsed = Date.now() - startTime
        if (elapsed - lastStatusUpdate >= 30000) {
          const minutes = Math.max(1, Math.ceil(elapsed / 60000))
          installStatus = `Initializing AuraPro for the first time... ${minutes} min`
          lastStatusUpdate = elapsed
        }
        await new Promise((r) => setTimeout(r, pollInterval))
      }

      if (!reachable) {
        const si = await window.electronAPI.getServerInfo()
        if (si?.status === 'started' || si?.status === 'starting') {
          throw new Error(
            'AuraPro is still initializing longer than expected. Please check the Web-UI log, then retry if it does not finish.'
          )
        }
        throw new Error('AuraPro did not become reachable. Please check the Web-UI log and retry.')
      }

      // Now connect — the server is ready
      installStatus = ''
      installProgress = 100
      localInstalled = true
      connect('local')
      installPhase = 'idle'
      installAutoRepairing = false
    } catch (error: unknown) {
      const report = diagnoseInstallationFailure(
        currentInstallStage,
        error,
        $appInfo?.platform ?? navigator.platform,
        installStatus
      )
      const repairKey = report.id
      installFailure = report
      installError =
        report.technicalDetail || getErrorMessage(error, $i18n.t('error.somethingWentWrong'))

      if (report.autoRepairable && (installAutoRepairAttempts[repairKey] ?? 0) < 1) {
        installAutoRepairAttempts = {
          ...installAutoRepairAttempts,
          [repairKey]: (installAutoRepairAttempts[repairKey] ?? 0) + 1
        }
        installAutoRepairing = true
        installPhase = 'working'
        installStatus = `正在自动修复：${report.repairDescription}`
        await prepareInstallRepair(currentInstallStage)
        await waitForInstallRepair(1500)
        await startInstall(undefined, true)
        return
      }

      installAutoRepairing = false
      installPhase = 'error'
      showToast(report.title)
    }
  }

  const addConnection = async () => {
    if (!url.trim()) return
    let u = url.trim()
    if (!/^https?:\/\//i.test(u)) {
      const lower = u.toLowerCase()
      const looksLocal =
        lower === 'localhost' ||
        lower.startsWith('localhost:') ||
        lower.startsWith('127.') ||
        lower.startsWith('10.') ||
        lower.startsWith('192.168.') ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(lower) ||
        /^[a-z0-9.-]+:\d+(\/.*)?$/i.test(u)

      u = `${looksLocal ? 'http' : 'https'}://${u}`
    }
    error = ''
    try {
      new URL(u)
    } catch {
      error = $i18n.t('setup.invalidUrl')
      return
    }
    connecting = true
    try {
      const valid = await window.electronAPI.validateUrl(u)
      if (!valid) {
        error = $i18n.t('setup.couldNotReachServer')
        connecting = false
        return
      }
      await window.electronAPI.addConnection({
        id: crypto.randomUUID(),
        name: new URL(u).hostname,
        type: 'remote',
        url: u
      })
      connections.set(await window.electronAPI.getConnections())
      config.set(await window.electronAPI.getConfig())
      url = ''
      error = ''
      showAddConnectionModal = false
      view = 'welcome'
    } catch {
      error = $i18n.t('setup.connectionFailed')
    } finally {
      connecting = false
    }
  }

  const connect = (id: string) => {
    showingLogs = false
    // Toggle: clicking the active connection unselects it
    if (activeConnectionId === id && view === 'connected') {
      connectingId = ''
      activeConnectionId = ''
      view = 'welcome'
      return
    }
    // Persist as default so spotlight/startup always use the last-selected connection
    window.electronAPI.setDefaultConnection(id)
    // Already-open connection — just switch to it
    if (openConnections.has(id)) {
      connectingId = ''
      activeConnectionId = id
      view = 'connected'
      return
    }

    const conn = ($connections ?? []).find((c) => c.id === id)
    if (!conn) return

    activeConnectionId = id

    if (conn.type === 'local') {
      // Local needs server start — use IPC
      connectingId = id
      view = 'welcome'
      window.electronAPI.connectTo(id).then((result: ConnectionResult | null) => {
        if (!result?.url) {
          if (connectingId === id) connectingId = ''
          return
        }
        if (!openConnections.has(result.connectionId)) {
          openConnections.set(result.connectionId, result.url)
        }
        if (connectingId === id) {
          activeConnectionId = result.connectionId
          connectingId = ''
          if (installPhase !== 'working') {
            view = 'connected'
          }
        }
      })
    } else {
      // Remote — open immediately, no IPC needed
      connectingId = ''
      openConnections.set(id, conn.url)
      view = 'connected'
    }
  }

  const disconnect = () => {
    activeConnectionId = ''
    view = 'welcome'
  }

  const remove = async (id: string) => {
    await window.electronAPI.removeConnection(id)
    connections.set(await window.electronAPI.getConnections())
    config.set(await window.electronAPI.getConfig())
    if (activeConnectionId === id) {
      disconnect()
    }
    openConnections.delete(id)
  }

  // Sync active connection info to parent
  $effect(() => {
    const conn = ($connections ?? []).find((c) => c.id === activeConnectionId)
    activeConnectionName = conn?.name ?? ''
  })

  // React to showingLogs from parent — open the server log panel
  // Only react when parent sets showingLogs to true; don't close on false
  // (the status bar manages its own open/close via activeLog)
  $effect(() => {
    if (showingLogs) {
      activeLog = 'server'
    }
  })

  // Sync back: when panel closes, tell parent
  $effect(() => {
    if (activeLog === null) {
      showingLogs = false
    }
  })

  const openGithub = () => {
    settingsOpen = false
    window.electronAPI?.openInBrowser?.('https://github.com/AuraPro-Official/AuraPro-Desktop')
  }

  // ── Log panel PTY helpers ─────────────────────────────
  const getConnectPty = (log: string) => {
    return (callback: (data: string) => void) => {
      if (log === 'server') {
        window.electronAPI.connectPty(callback)
      } else if (log === 'open-terminal') {
        window.electronAPI.connectOpenTerminalPty(callback)
      } else if (log === 'llama-server') {
        window.electronAPI.connectLlamaCppPty(callback)
      } else if (log === 'sherpa') {
        window.electronAPI.connectSherpaPty(callback)
      }
    }
  }

  const getDisconnectPty = (log: string) => {
    return () => {
      if (log === 'server') {
        window.electronAPI.disconnectPty()
      } else if (log === 'open-terminal') {
        window.electronAPI?.disconnectOpenTerminalPty?.()
      } else if (log === 'llama-server') {
        window.electronAPI?.disconnectLlamaCppPty?.()
      } else if (log === 'sherpa') {
        window.electronAPI?.disconnectSherpaPty?.()
      }
    }
  }

  const getOnWrite = (log: string) => {
    if (log === 'server') {
      return (data: string) => window.electronAPI.writePty(data)
    }
    return undefined
  }

  const getOnResize = (log: string) => {
    if (log === 'server') {
      return (cols: number, rows: number) => window.electronAPI.resizePty(cols, rows)
    }
    return undefined
  }

  // ── Status bar log selection ──────────────────────────
  const selectLog = (log: string) => {
    activeLog = activeLog === log ? null : (log as typeof activeLog)
  }

  // ── Webview event delivery ─────────────────────────────
  // Single path: all events from the main process flow through here.
  // Query events target a specific webview; everything else broadcasts.
  const sendToWebview = (event: unknown, connId?: string) => {
    const container = document.querySelector('.content-webview-container')
    if (!container) return

    const webviews = connId
      ? [
          container.querySelector<Electron.WebviewTag>(
            `webview[partition="persist:connection-${connId}"]`
          )
        ].filter(Boolean)
      : Array.from(container.querySelectorAll<Electron.WebviewTag>('webview'))

    for (const wv of webviews) {
      try {
        // Attempt to send — throws if webview hasn't fired dom-ready yet
        wv.send('desktop:event', event)
      } catch {
        // Webview not ready — queue delivery until dom-ready
        const onReady = () => {
          wv.removeEventListener('dom-ready', onReady)
          try {
            wv.send('desktop:event', event)
          } catch {}
        }
        wv.addEventListener('dom-ready', onReady)
      }
    }
  }

  // Listen for events from main process
  onMount(() => {
    const disposeDataListener = window.electronAPI.onData((data: MainEvent) => {
      const payload =
        data.data && typeof data.data === 'object' ? (data.data as MainEventPayload) : undefined
      const textPayload = typeof data.data === 'string' ? data.data : ''
      // ── Connection opened (startup, tray click) ───────
      if (data.type === 'connection:open' && payload?.url) {
        const connId = payload.connectionId ?? ''
        const incomingUrl = payload.url

        if (!openConnections.has(connId)) {
          openConnections.set(connId, incomingUrl)
        }

        if (view !== 'connected') {
          activeConnectionId = connId
          if (installPhase !== 'working') view = 'connected'
        }
        return
      }

      // ── Spotlight / desktop query ─────────────────────
      if (data.type === 'query' && (payload?.query || payload?.files?.length)) {
        const connId = payload.connectionId ?? ''
        const query = payload.query
        const files = payload.files
        const baseUrl = payload.url ?? ''
        const shortcutAction = payload.shortcutAction ?? null

        if (!openConnections.has(connId)) {
          openConnections.set(connId, baseUrl)
        }
        activeConnectionId = connId
        if (installPhase !== 'working') view = 'connected'

        // Targeted delivery — wait a frame for the webview DOM to exist
        requestAnimationFrame(() => {
          sendToWebview({ type: 'query', data: { query, files, shortcutAction } }, connId)
        })
        return
      }

      // ── Call shortcut ─────────────────────────────────
      if (data.type === 'call' && payload?.connectionId) {
        const connId = payload.connectionId
        const baseUrl = payload.url ?? ''
        const shortcutAction = payload.shortcutAction ?? null

        if (!openConnections.has(connId)) {
          openConnections.set(connId, baseUrl)
        }
        activeConnectionId = connId
        if (installPhase !== 'working') view = 'connected'

        // Targeted delivery — wait a frame for the webview DOM to exist
        requestAnimationFrame(() => {
          sendToWebview({ type: 'call', data: { shortcutAction } }, connId)
        })
        return
      }

      // ── Desktop-only state (not forwarded to webviews) ─
      if (data.type === 'status:open-terminal') {
        openTerminalStatus = textPayload
        return
      }
      if (data.type === 'open-terminal:ready') {
        openTerminalStatus = 'started'
        return
      }
      if (data.type === 'status:llamacpp') {
        llamaCppStatus = textPayload
        return
      }
      if (data.type === 'status:llamacpp-setup') {
        llamaCppSetupStatus = textPayload
        if (installPhase === 'working') {
          installStatus = textPayload
          trackCoreInstallDownload(installStatus)
        }
        return
      }
      if (data.type === 'llamacpp:ready') {
        llamaCppInfo = payload
        llamaCppStatus = 'started'
        llamaCppSetupStatus = ''
        return
      }
      if (data.type === 'status:sherpa') {
        sherpaStatus = textPayload
        return
      }
      if (data.type === 'status:sherpa-setup') {
        sherpaSetupStatus = textPayload
        return
      }
      if (data.type === 'sherpa:ready') {
        sherpaStatus = 'started'
        sherpaSetupStatus = ''
        return
      }
      if (data.type === 'status:install') {
        installStatus = textPayload
        trackCoreInstallDownload(installStatus)
        return
      }
      if (data.type === 'status:huggingface-download') {
        if (payload) updateDownloadItem(payload)
        return
      }
      if (
        data.type.startsWith('llamacpp:diagnostic-') ||
        data.type.startsWith('llamacpp:repair-')
      ) {
        return
      }

      // ── Everything else → broadcast to all webviews ───
      sendToWebview(data)
    })

    // Check current Open Terminal state on mount
    window.electronAPI.getOpenTerminalInfo().then((info: ServiceInfo | null) => {
      if (info?.status) {
        openTerminalStatus = info.status
      }
    })

    // Check if AuraPro package is installed
    window.electronAPI.getPackageVersion('aurapro-ui').then((v: string | null) => {
      localInstalled = v !== null
    })

    // Check llama-server state on mount
    window.electronAPI.getLlamaCppInfo().then((info: ServiceInfo | null) => {
      if (info?.status) {
        llamaCppStatus = info.status
      }
      if (info?.binaryPath || info?.status) {
        llamaCppInfo = info
      }
    })

    window.electronAPI.getSherpaInfo().then((info: ServiceInfo | null) => {
      if (info?.status) {
        sherpaStatus = info.status
      }
    })

    let cancelDeferredDiagnosticsLoad: () => void
    if ('requestIdleCallback' in window) {
      const idleId = window.requestIdleCallback(() => void loadLlamaDiagnostics(), {
        timeout: 2500
      })
      cancelDeferredDiagnosticsLoad = () => window.cancelIdleCallback(idleId)
    } else {
      const timeoutId = window.setTimeout(() => void loadLlamaDiagnostics(), 750)
      cancelDeferredDiagnosticsLoad = () => window.clearTimeout(timeoutId)
    }

    return () => {
      disposeDataListener?.()
      cancelDeferredDiagnosticsLoad()
      if (toastTimeout) {
        clearTimeout(toastTimeout)
        toastTimeout = null
      }
    }
  })

  const toggleOpenTerminal = async () => {
    if (openTerminalStatus === 'starting') return
    if (openTerminalStatus === 'started') {
      openTerminalStatus = 'stopping'
      await window.electronAPI.stopOpenTerminal()
      openTerminalStatus = null
    } else {
      openTerminalStatus = 'starting'
      const result = await window.electronAPI.startOpenTerminal()
      if (result) {
        openTerminalStatus = 'started'
      } else {
        openTerminalStatus = 'failed'
      }
    }
  }

  const toggleLlamaCpp = async () => {
    if (llamaCppStatus === 'starting' || llamaCppStatus === 'setting-up') return
    if (llamaCppStatus === 'started') {
      llamaCppStatus = 'stopping'
      await window.electronAPI.stopLlamaCpp()
      llamaCppStatus = null
      llamaCppInfo = null
    } else {
      llamaCppStatus = 'starting'
      const result = await window.electronAPI.startLlamaCpp()
      if (result) {
        llamaCppInfo = result
        llamaCppStatus = 'started'
      } else {
        llamaCppStatus = 'failed'
      }
    }
  }

  const toggleSherpa = async () => {
    if (sherpaStatus === 'starting') return
    if (sherpaStatus === 'started') {
      sherpaStatus = 'stopping'
      await window.electronAPI.stopSherpa()
      sherpaStatus = null
    } else {
      sherpaStatus = 'starting'
      const result = await window.electronAPI.startSherpa()
      if (result) {
        sherpaStatus = 'started'
      } else {
        sherpaStatus = 'failed'
      }
    }
  }

  const restartLogService = async (log: 'server' | 'open-terminal' | 'llama-server' | 'sherpa') => {
    if (log === 'server') {
      await window.electronAPI.restartServer()
      serverInfo.set(await window.electronAPI.getServerInfo())
      return
    }

    if (log === 'open-terminal') {
      openTerminalStatus = 'stopping'
      await window.electronAPI.stopOpenTerminal()
      openTerminalStatus = 'starting'
      const result = await window.electronAPI.startOpenTerminal()
      if (result) {
        openTerminalStatus = 'started'
      } else {
        openTerminalStatus = 'failed'
      }
      return
    }

    if (log === 'llama-server') {
      llamaCppStatus = 'stopping'
      await window.electronAPI.stopLlamaCpp()
      llamaCppInfo = null
      llamaCppStatus = 'starting'
      const result = await window.electronAPI.startLlamaCpp()
      if (result) {
        llamaCppInfo = result
        llamaCppStatus = 'started'
      } else {
        llamaCppStatus = 'failed'
      }
      return
    }

    sherpaStatus = 'stopping'
    await window.electronAPI.stopSherpa()
    sherpaStatus = 'starting'
    const result = await window.electronAPI.startSherpa()
    if (result) {
      sherpaStatus = 'started'
    } else {
      sherpaStatus = 'failed'
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="h-full w-full flex flex-col bg-[#f5f5f7] dark:bg-[#0a0a0a] text-[#1d1d1f] dark:text-[#fafafa]"
  in:fade={{ duration: 200 }}
>
  <div class="flex-1 min-h-0 flex">
    {#if sidebarOpen}
      <Sidebar
        {activeConnectionId}
        {connectingId}
        {localConn}
        {localInstalled}
        {remoteConnections}
        {serverStatus}
        {serverReachable}
        bind:settingsOpen
        onConnect={connect}
        onDisconnect={disconnect}
        onAddView={() => {
          showAddConnectionModal = true
        }}
        {onOpenSettings}
        onShareLocal={shareLocal}
        onRename={async (id, name) => {
          await window.electronAPI.updateConnection(id, { name })
          connections.set(await window.electronAPI.getConnections())
        }}
        onRemove={remove}
        {openGithub}
      />
    {/if}

    <Content
      {sidebarOpen}
      bind:view
      {activeConnectionId}
      {connectingId}
      {openConnections}
      {localConn}
      {localInstalled}
      {remoteConnections}
      bind:installPhase
      bind:installError
      bind:installStatus
      bind:installFailure
      {installAutoRepairing}
      {installProgress}
      {downloadItems}
      {totalDownloadProgress}
      bind:toastVisible
      bind:url
      bind:connecting
      bind:error
      bind:showAddConnectionModal
      bind:autoInstall
      onStartInstall={startInstall}
      onAddConnection={addConnection}
      onSetView={(v) => {
        view = v
      }}
    />
  </div>

  {#if activeLog}
    <LogPanel
      {activeLog}
      serviceReady={activeLog === 'server'
        ? serverStatus === 'started'
        : activeLog === 'open-terminal'
          ? openTerminalStatus === 'started'
          : activeLog === 'llama-server'
            ? llamaCppStatus === 'started'
            : sherpaStatus === 'started'}
      statusText={activeLog === 'server'
        ? serverStatus === 'starting'
          ? 'Starting AuraPro…'
          : serverStatus === 'running' && !serverReachable
            ? 'Waiting for server…'
            : installStatus || ''
        : activeLog === 'open-terminal'
          ? openTerminalStatus === 'stopping'
            ? 'Stopping Open Terminal…'
            : openTerminalStatus === 'starting'
              ? 'Starting Open Terminal…'
              : ''
          : activeLog === 'llama-server'
            ? llamaCppStatus === 'stopping'
              ? 'Stopping llama-server…'
              : llamaCppSetupStatus ||
                (llamaCppStatus === 'starting'
                  ? 'Starting llama-server…'
                  : llamaCppStatus === 'setting-up'
                    ? 'Setting up llama.cpp…'
                    : '')
            : sherpaStatus === 'stopping'
              ? 'Stopping sherpa…'
              : sherpaSetupStatus || (sherpaStatus === 'starting' ? 'Starting sherpa…' : '')}
      connectPty={getConnectPty(activeLog)}
      disconnectPty={getDisconnectPty(activeLog)}
      readonly={activeLog !== 'server'}
      onWrite={getOnWrite(activeLog)}
      onResize={getOnResize(activeLog)}
      onStop={activeLog === 'open-terminal'
        ? toggleOpenTerminal
        : activeLog === 'llama-server'
          ? toggleLlamaCpp
          : activeLog === 'sherpa'
            ? toggleSherpa
            : undefined}
      onRestart={() => restartLogService(activeLog)}
      onClose={() => {
        activeLog = null
        showingLogs = false
      }}
    />
  {/if}

  <StatusBar
    {serverStatus}
    {serverReachable}
    {openTerminalStatus}
    {llamaCppStatus}
    {sherpaStatus}
    openWebuiInstalled={localInstalled}
    openTerminalInstalled={showOpenTerminalInStatusBar}
    llamaCppInstalled={!!llamaCppInfo?.binaryPath}
    sherpaInstalled={showSherpaInStatusBar}
    {activeLog}
    onSelectLog={selectLog}
    onStartServer={async () => {
      if (!localInstalled) {
        // Not installed — trigger full install (handles Python/uv + package)
        startInstall()
        return
      }
      // Already installed — start the server
      await window.electronAPI.startServer()
      // Force-refresh serverInfo immediately (don't wait for 3s poll)
      const info = await window.electronAPI.getServerInfo()
      serverInfo.set(info)
    }}
    onToggleOpenTerminal={toggleOpenTerminal}
    onToggleLlamaCpp={toggleLlamaCpp}
    onToggleSherpa={toggleSherpa}
    {onOpenSettings}
    onPrepareDiagnostics={loadLlamaDiagnostics}
  />
  {#if LlamaDiagnosticsComponent}
    <LlamaDiagnosticsComponent />
  {/if}
</div>
