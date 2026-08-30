import {
  app,
  shell,
  session,
  clipboard,
  nativeImage,
  desktopCapturer,
  screen,
  systemPreferences,
  BrowserWindow,
  globalShortcut,
  MessageChannelMain,
  Notification,
  Menu,
  ipcMain,
  Tray,
  dialog,
  webContents,
  type MenuItemConstructorOptions
} from 'electron'
import path, { join } from 'path'
import { access, cp, mkdir, readFile, readdir, rm, statfs } from 'fs/promises'
import { execFile } from 'child_process'
import { userInfo } from 'os'

import { electronApp, optimizer, is } from '@electron-toolkit/utils'

// Use default system userData path to ensure persistence across updates

import {
  getLogFilePath,
  checkUrlAndOpen,
  clearAllServerLogs,
  getConfig,
  getOpenWebUIDataPath,
  getUserDataPath,
  getInstallDir,
  getServerLog,
  getServerPIDs,
  getServerPty,
  installPackage,
  installPython,
  isPackageInstalled,
  isPythonInstalled,
  getExactPackageVersion,
  getPackageVersion,
  ensureOpenWebUIPackage,
  getOpenWebUIPackageNameForVersion,
  cleanupPythonPackageCaches,
  AURAPRO_UI_TARGET_VERSION,
  resolveOpenWebUITargetVersion,
  getLocalNetworkAddresses,
  uninstallPackage,
  isUvInstalled,
  openUrl,
  resetApp,
  setConfig,
  startServer,
  stopAllServers,
  validateRemoteUrl,
  getSystemInfo,
  type AppConfig,
  type Connection
} from './utils'
import { installLocalCertificate } from './utils/local-certificate'
import { scheduleCacheCleanup } from './utils/cache-cleanup'

import {
  startOpenTerminal,
  stopOpenTerminal,
  getOpenTerminalInfo,
  getOpenTerminalPty,
  getOpenTerminalLog,
  validateOpenTerminalProcess
} from './utils/open-terminal'

import {
  setupOpenCode,
  startOpenCode,
  stopOpenCode,
  uninstallOpenCode,
  getOpenCodeInfo,
  getOpenCodePty,
  getOpenCodeLog,
  validateOpenCodeProcess,
  setOpenCodeRuntimeStatusHandler,
  isOpenCodeInstalled
} from './utils/opencode'

import {
  setupLlamaCpp,
  startLlamaCppWithFallback,
  stopLlamaCpp,
  getLlamaCppInfo,
  getLlamaCppLog,
  getLlamaCppPty,
  validateLlamaCppProcess,
  checkLlamaCppUpdate,
  updateLlamaCpp,
  uninstallLlamaCpp,
  setLlamaCppRuntimeAnomalyHandler
} from './utils/llamacpp'
import { diagnoseLlamaCpp, repairLlamaCpp } from './utils/llamacpp-diagnostics'

import {
  startSherpa,
  stopSherpa,
  getSherpaInfo,
  getSherpaLog,
  getSherpaPty,
  validateSherpaProcess,
  isSherpaInstalled,
  ensureDefaultAsrModel,
  ensureDefaultTtsModel,
  reinitSherpaServerScript
} from './utils/sherpa'

import {
  listModels,
  listSherpaModels,
  downloadModel,
  deleteModel,
  cancelDownload,
  getModelsDir,
  searchModels,
  getRepoFiles
} from './utils/huggingface'

import { initUpdater, checkForUpdates, downloadUpdate, installUpdate } from './updater'
import {
  getOfficialGlossaryStatus,
  installOfficialGlossaries,
  uninstallOfficialGlossaries
} from './utils/official-glossaries'
import { redactConfigForLog } from './utils/redact'
import {
  probeInstallDirectoryWritable,
  type InstallDirectoryWriteProbe
} from './utils/install-preflight'

import log from 'electron-log'
log.transports.file.resolvePathFn = () => getLogFilePath('main')

import iconPng from '../../resources/icon.png?asset'
import iconIco from '../../resources/AuraPro.ico?asset'

const icon = process.platform === 'win32' ? iconIco : iconPng

import { existsSync, writeFileSync, readFileSync, unlinkSync, mkdirSync, watchFile } from 'fs'

const getPackagedDataDir = (): string =>
  app.isPackaged ? join(process.resourcesPath, 'data') : join(app.getAppPath(), 'data')

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox')

  // 解决 AppImage 和其他容器化产品中 /dev/shm 访问失败的问题
  // 此标志告诉 Chromium 使用 /tmp 作为共享内存，避免由于 FUSE 挂载限制导致的崩溃
  app.commandLine.appendSwitch('disable-dev-shm-usage')

  // Force XWayland (x11) instead of native Wayland.
  // When GPU acceleration is disabled (--disable-gpu), Chromium's software compositor
  // cannot properly share buffers with <webview> guests under native Wayland, resulting
  // in a permanent grey/blank screen for AuraPro. Forcing X11 resolves this (#119).
  // Note: This may affect Wayland-native GlobalShortcuts, but rendering takes priority.
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto')

  // Replace --disable-gpu with --in-process-gpu to improve compatibility
  // with <webview> rendering under certain Linux environments/Wayland while
  // still avoiding most driver-related grey screen issues.
  app.commandLine.appendSwitch('use-gl', 'angle')
  app.commandLine.appendSwitch('use-angle', 'swiftshader')
  app.commandLine.appendSwitch('disable-gpu-sandbox')
}

// ─── GPU Crash Recovery ─────────────────────────────────
// When the GPU process crashes fatally (common on certain NVIDIA/Intel
// driver + Windows combos), we write a marker file and relaunch with
// --disable-gpu-sandbox so the user doesn't have to manually edit
// shortcut properties. On the next launch the marker is detected and
// the switch is applied preemptively.

const gpuCrashMarkerPath = join(app.getPath('userData'), '.gpu-sandbox-disabled')
const gpuSandboxDisabled = existsSync(gpuCrashMarkerPath)

if (gpuSandboxDisabled) {
  log.info('GPU sandbox disabled due to previous GPU process crash')
  app.commandLine.appendSwitch('disable-gpu-sandbox')
}

// Prevent Chromium from permanently blocking WebGL / 3-D APIs after
// repeated GPU process crashes within the same session.
app.disableDomainBlockingFor3DAPIs()

// ─── State ──────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null
let spotlightWindow: BrowserWindow | null = null
let voiceInputWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuiting = false
let quitCleanupComplete = false
let quitCleanupInProgress = false

let CONFIG: AppConfig | null = null
let SERVER_URL: string | null = null
let SERVER_STATUS: string | null = null
let SERVER_REACHABLE = false
let SERVER_PID: number | null = null
type RuntimeStartupBusyPhase = 'checking' | 'updating' | 'starting' | 'waiting'
type RuntimeStartupPhase = 'idle' | RuntimeStartupBusyPhase | 'ready' | 'failed'
interface RuntimeStartupState {
  phase: RuntimeStartupPhase
  detail: string
  updatedAt: number
}
let WEBUI_STARTUP_STATE: RuntimeStartupState = {
  phase: 'idle',
  detail: '',
  updatedAt: Date.now()
}
let LLAMACPP_STARTUP_STATE: RuntimeStartupState = {
  phase: 'idle',
  detail: '',
  updatedAt: Date.now()
}
let AUTH_TOKEN: string | null = null
let voiceInputRecording = false

// ─── Global Shortcuts ───────────────────────────────────

/**
 * Check whether the current environment supports Electron's globalShortcut
 * API.  Since Chromium 134+ (Electron 33+) the GlobalShortcutsPortal
 * feature is enabled by default, which lets `globalShortcut.register()`
 * work transparently on Wayland via `xdg-desktop-portal`.  Combined with
 * `--ozone-platform-hint=auto` (set above for Linux), shortcuts should
 * "just work" on most modern desktops.
 *
 * We only bail out when we can positively detect an environment where
 * neither X11 key-grabs nor the portal will succeed (e.g. an older
 * Flatpak base app that doesn't expose the portal D-Bus name).
 */
function isGlobalShortcutSupported(): boolean {
  if (process.platform !== 'linux') return true

  // On Wayland the portal handles registration.  On X11 the classic
  // key-grab path is used.  Both should work, so we optimistically
  // return true and let tryRegisterShortcut surface per-shortcut
  // failures via notifications.
  return true
}

/**
 * Try to register a single global shortcut.  Returns true on success.
 * On failure a user-facing notification is shown (unless `silent` is set).
 */
function tryRegisterShortcut(
  accel: string,
  label: string,
  callback: () => void,
  silent = false
): boolean {
  try {
    const ok = globalShortcut.register(accel, callback)
    if (ok) {
      log.info(`${label} shortcut "${accel}" registered`)
      return true
    }
    log.warn(`${label} shortcut "${accel}" could not be registered (returned false)`)
    if (!silent) {
      new Notification({
        title: label,
        body: `Could not register shortcut "${accel}". It may be in use by another application.`
      }).show()
    }
    return false
  } catch (error) {
    log.warn(`${label} shortcut "${accel}" registration threw:`, error)
    if (!silent) {
      new Notification({
        title: label,
        body: `Failed to register shortcut "${accel}". It may conflict with another application.`
      }).show()
    }
    return false
  }
}

const registerShortcuts = (
  globalAccel?: string,
  spotlightAccel?: string,
  voiceInputAccel?: string,
  callAccel?: string
): void => {
  globalShortcut.unregisterAll()

  // On Wayland / Flatpak global shortcuts are unsupported — skip silently.
  if (!isGlobalShortcutSupported()) {
    log.info(
      'Global shortcut registration skipped — unsupported environment ' +
        `(XDG_SESSION_TYPE=${process.env['XDG_SESSION_TYPE'] ?? '(unset)'}, ` +
        `FLATPAK_ID=${process.env['FLATPAK_ID'] ?? '(unset)'})`
    )
    return
  }

  // Global shortcut – bring main window to foreground
  if (globalAccel) {
    tryRegisterShortcut(globalAccel, 'AuraPro', () => {
      if (mainWindow) {
        mainWindow.show()
        mainWindow.focus()
      } else {
        createMainWindow()
      }
    })
  }

  // Spotlight shortcut – toggle the spotlight input bar
  if (spotlightAccel) {
    tryRegisterShortcut(spotlightAccel, 'Spotlight', () => {
      const text =
        CONFIG?.spotlightClipboardPaste !== false ? clipboard.readText()?.trim() || '' : ''
      toggleSpotlight(text)
    })
  }

  // Voice input shortcut – toggle microphone recording
  if (voiceInputAccel && CONFIG?.voiceInputEnabled !== false) {
    tryRegisterShortcut(voiceInputAccel, 'Voice Input', () => {
      toggleVoiceInput()
    })
  } else {
    log.info(
      `Voice input shortcut skipped — accel="${voiceInputAccel}", enabled=${CONFIG?.voiceInputEnabled}`
    )
  }

  // Call shortcut – open the voice/video call overlay
  if (callAccel && CONFIG?.callEnabled !== false) {
    tryRegisterShortcut(callAccel, 'Call', () => {
      toggleCall()
    })
  } else {
    log.info(`Call shortcut skipped — accel="${callAccel}", enabled=${CONFIG?.callEnabled}`)
  }
}

// ─── Spotlight Window ───────────────────────────────────
// Bar position within the fullscreen window (persisted to config).
let spotlightBarOffset: { x: number; y: number } | null = null

function loadSpotlightPosition(): void {
  if (CONFIG?.spotlightPosition) {
    spotlightBarOffset = { ...CONFIG.spotlightPosition }
  }
}

function createSpotlightWindow(): BrowserWindow {
  const cursorPoint = screen.getCursorScreenPoint()
  const activeDisplay = screen.getDisplayNearestPoint(cursorPoint)
  const { x: sx, y: sy, width: sw, height: sh } = activeDisplay.bounds

  spotlightWindow = new BrowserWindow({
    x: sx,
    y: sy,
    width: sw,
    height: sh,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    show: false,
    focusable: true,
    icon: icon,
    webPreferences: {
      preload: join(__dirname, '../preload/spotlight-preload.js'),
      sandbox: false,
      webviewTag: false
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    spotlightWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/spotlight.html`)
  } else {
    spotlightWindow.loadFile(join(__dirname, '../renderer/spotlight.html'))
  }

  // Hide on blur — but only when the window was truly visible and settled.
  let blurArmed = false
  spotlightWindow.on('focus', () => {
    blurArmed = false
    setTimeout(() => {
      blurArmed = true
    }, 200)
  })
  spotlightWindow.on('blur', () => {
    if (blurArmed) {
      spotlightWindow?.hide()
    }
  })

  spotlightWindow.on('closed', () => {
    spotlightWindow = null
  })

  return spotlightWindow
}

function showAndFocusSpotlight(win: BrowserWindow, initialQuery?: string): void {
  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(true, { skipTransformProcessType: true })
  }

  // Reposition fullscreen window to the active display
  const cursorPoint = screen.getCursorScreenPoint()
  const activeDisplay = screen.getDisplayNearestPoint(cursorPoint)
  const { x: sx, y: sy, width: sw, height: sh } = activeDisplay.bounds
  win.setBounds({ x: sx, y: sy, width: sw, height: sh })

  // Hide main window so it doesn't appear behind the transparent overlay
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    mainWindow.hide()
  }

  win.show()
  win.focus()
  win.webContents.focus()

  // Send initial data to the renderer (bar offset + optional query)
  win.webContents.send('spotlight:init', {
    barOffset: spotlightBarOffset,
    screenSize: { width: sw, height: sh },
    query: initialQuery || ''
  })
}

function toggleSpotlight(selectedText?: string): void {
  if (spotlightWindow && !spotlightWindow.isDestroyed()) {
    if (spotlightWindow.isVisible()) {
      spotlightWindow.hide()
    } else {
      showAndFocusSpotlight(spotlightWindow, selectedText)
    }
  } else {
    const win = createSpotlightWindow()
    win.once('ready-to-show', () => {
      showAndFocusSpotlight(win, selectedText)
    })
  }
}

// ─── Voice Input Window ─────────────────────────────────

function createVoiceInputWindow(): BrowserWindow {
  const cursorPoint = screen.getCursorScreenPoint()
  const activeDisplay = screen.getDisplayNearestPoint(cursorPoint)
  const { x: sx, y: sy, width: sw } = activeDisplay.bounds

  const winW = 340
  const winH = 72

  voiceInputWindow = new BrowserWindow({
    x: sx + Math.round((sw - winW) / 2),
    y: sy + 120,
    width: winW,
    height: winH,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    show: false,
    focusable: true,
    icon: icon,
    webPreferences: {
      preload: join(__dirname, '../preload/voice-input-preload.js'),
      sandbox: false,
      webviewTag: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  })

  // Grant microphone permission for the voice input window
  voiceInputWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      const allowed = ['media', 'clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']
      log.info(
        `[voiceInput] Permission requested: ${permission}, allowed: ${allowed.includes(permission)}`
      )
      callback(allowed.includes(permission))
    }
  )

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    voiceInputWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/voice-input.html`)
  } else {
    voiceInputWindow.loadFile(join(__dirname, '../renderer/voice-input.html'))
  }

  voiceInputWindow.on('closed', () => {
    voiceInputWindow = null
    voiceInputRecording = false
  })

  return voiceInputWindow
}

function playChime(ascending: boolean): Promise<void> {
  return new Promise((resolve) => {
    const file = ascending ? 'chime-start.wav' : 'chime-stop.wav'
    const soundPath = app.isPackaged
      ? join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'sounds', file)
      : join(app.getAppPath(), 'resources', 'sounds', file)

    const exists = existsSync(soundPath)
    log.info(`playChime: ${ascending ? 'start' : 'stop'}, path=${soundPath}, exists=${exists}`)

    if (!exists) {
      resolve()
      return
    }

    if (process.platform === 'darwin') {
      execFile('afplay', [soundPath], (err, _stdout, stderr) => {
        if (err) log.warn('afplay error:', err.message, stderr)
        resolve()
      })
    } else if (process.platform === 'win32') {
      execFile(
        'powershell',
        ['-NoProfile', '-Command', `(New-Object Media.SoundPlayer '${soundPath}').PlaySync()`],
        () => resolve()
      )
    } else {
      execFile('paplay', [soundPath], (err) => {
        if (err) execFile('aplay', [soundPath], () => resolve())
        else resolve()
      })
    }
  })
}

async function toggleVoiceInput(): Promise<void> {
  if (voiceInputRecording) {
    // Stop recording — chime plays in done/close handler after mic is released
    voiceInputRecording = false
    if (voiceInputWindow && !voiceInputWindow.isDestroyed()) {
      voiceInputWindow.webContents.send('voiceInput:state', { recording: false })
    }
    return
  }

  // Pre-flight: check microphone permission on macOS
  if (process.platform === 'darwin') {
    const micStatus = systemPreferences.getMediaAccessStatus('microphone')
    if (micStatus !== 'granted') {
      const granted = await systemPreferences.askForMediaAccess('microphone')
      if (!granted) {
        log.warn('Voice input: microphone permission denied')
        new Notification({
          title: 'Voice Input',
          body: 'Microphone access denied. Enable it in System Settings → Privacy & Security → Microphone, then restart the app.'
        }).show()
        return
      }
    }
  }

  // Pre-flight: check a connection is configured
  try {
    const config = await getConfig()
    if (!config.defaultConnectionId || config.connections.length === 0) {
      log.warn('Voice input: no connection configured')
      new Notification({
        title: 'Voice Input',
        body: 'No connection configured. Set up a connection in Settings before using voice input.'
      }).show()
      return
    }
    const conn = config.connections.find((c) => c.id === config.defaultConnectionId)
    if (!conn) {
      log.warn('Voice input: default connection not found')
      new Notification({
        title: 'Voice Input',
        body: 'Default connection not found. Check your connection settings.'
      }).show()
      return
    }
  } catch (err: unknown) {
    log.warn('Voice input: config check failed:', err)
  }

  // Start recording — chime plays concurrently (separate audio output path from mic input)
  voiceInputRecording = true
  playChime(true)

  if (voiceInputWindow && !voiceInputWindow.isDestroyed()) {
    voiceInputWindow.show()
    voiceInputWindow.focus()
    voiceInputWindow.webContents.send('voiceInput:state', { recording: true })
  } else {
    const win = createVoiceInputWindow()
    win.once('ready-to-show', () => {
      win.show()
      win.focus()
      setTimeout(() => {
        win.webContents.send('voiceInput:state', { recording: true })
      }, 100)
    })
  }
}

// ─── Call Shortcut ──────────────────────────────────────

async function toggleCall(): Promise<void> {
  // Pre-flight: check a connection is configured
  try {
    const config = await getConfig()
    if (!config.defaultConnectionId || config.connections.length === 0) {
      log.warn('Call: no connection configured')
      new Notification({
        title: 'Call',
        body: 'No connection configured. Set up a connection in Settings before using the call shortcut.'
      }).show()
      return
    }
    const conn = config.connections.find((c) => c.id === config.defaultConnectionId)
    if (!conn) {
      log.warn('Call: default connection not found')
      new Notification({
        title: 'Call',
        body: 'Default connection not found. Check your connection settings.'
      }).show()
      return
    }

    let url = conn.url
    if (conn.type === 'local' && SERVER_URL) {
      url = SERVER_URL
    }
    if (/^https?:\/\/0\.0\.0\.0/.test(url)) {
      url = url.replace(/^https?:\/\/0\.0\.0\.0/, (match) => match.replace('0.0.0.0', 'localhost'))
    }

    // Include shortcut action so the webview can activate the extension
    const callAction = CONFIG?.shortcutActions?.call || null
    sendToRenderer('call', { connectionId: conn.id, url, shortcutAction: callAction })

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
    }
  } catch (err: unknown) {
    log.warn('Call: config check failed:', err)
  }
}

// ─── Windows ────────────────────────────────────────────

const DEFAULT_WINDOW_WIDTH = 1280
const DEFAULT_WINDOW_HEIGHT = 800
const MIN_WINDOW_WIDTH = 480
const MIN_WINDOW_HEIGHT = 360
const BOUNDS_SAVE_DEBOUNCE_MS = 500
const MIN_VISIBLE_OVERLAP_PX = 100

/** Last known non-maximized bounds, used to preserve restore geometry. */
let lastNormalBounds: Electron.Rectangle | null = null

/** Debounced persistence of the current window geometry to config. */
let boundsDebounceTimer: ReturnType<typeof setTimeout> | null = null

function debounceSaveWindowBounds(win: BrowserWindow): void {
  if (boundsDebounceTimer) clearTimeout(boundsDebounceTimer)
  boundsDebounceTimer = setTimeout(() => {
    if (win.isDestroyed()) return
    const maximized = win.isMaximized()
    const bounds = maximized ? (lastNormalBounds ?? win.getNormalBounds()) : win.getBounds()
    setConfig({ windowBounds: bounds, windowMaximized: maximized }).catch((err) =>
      log.warn('Failed to save window bounds:', err)
    )
  }, BOUNDS_SAVE_DEBOUNCE_MS)
}

/**
 * Returns true when at least `MIN_VISIBLE_OVERLAP_PX` of the saved
 * rectangle would be visible on one of the connected displays.
 */
function isBoundsOnVisibleDisplay(bounds: { x: number; y: number }): boolean {
  const targetPoint = {
    x: bounds.x + MIN_VISIBLE_OVERLAP_PX / 2,
    y: bounds.y + MIN_VISIBLE_OVERLAP_PX / 2
  }
  const display = screen.getDisplayNearestPoint(targetPoint)
  const { x, y, width, height } = display.workArea
  return (
    bounds.x + MIN_VISIBLE_OVERLAP_PX > x &&
    bounds.x < x + width &&
    bounds.y + MIN_VISIBLE_OVERLAP_PX > y &&
    bounds.y < y + height
  )
}

function trackNormalBounds(win: BrowserWindow): void {
  if (!win.isDestroyed() && !win.isMaximized()) {
    lastNormalBounds = win.getBounds()
  }
}

function createMainWindow(show = true): void {
  const saved = CONFIG?.windowBounds
  const windowOpts: Electron.BrowserWindowConstructorOptions = {
    width: saved?.width ?? DEFAULT_WINDOW_WIDTH,
    height: saved?.height ?? DEFAULT_WINDOW_HEIGHT,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    icon: icon,
    show: false,
    titleBarStyle: process.platform === 'win32' ? 'default' : 'hidden',
    trafficLightPosition: { x: 10, y: 10 },
    autoHideMenuBar: true,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    ...(process.platform === 'win32' ? { frame: true } : {}),
    ...(process.platform === 'linux' ? { icon } : {}),
    ...(process.platform !== 'darwin' ? { titleBarOverlay: true } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webviewTag: true,
      backgroundThrottling: false
    }
  }

  // Restore position only when the saved location is still on a visible display
  // (e.g. an external monitor may have been disconnected since last session).
  if (saved?.x != null && saved?.y != null && isBoundsOnVisibleDisplay(saved)) {
    windowOpts.x = saved.x
    windowOpts.y = saved.y
  }

  mainWindow = new BrowserWindow(windowOpts)
  mainWindow.setIcon(icon)

  if (CONFIG?.windowMaximized) {
    mainWindow.maximize()
  }

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools()
  }

  if (show) {
    mainWindow.on('ready-to-show', () => {
      mainWindow?.show()
    })
  }

  mainWindow.webContents.setWindowOpenHandler((details) => {
    openUrl(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // ── Persist window bounds on geometry changes ──
  const onBoundsChanged = (): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    trackNormalBounds(mainWindow)
    debounceSaveWindowBounds(mainWindow)
  }
  mainWindow.on('resize', onBoundsChanged)
  mainWindow.on('move', onBoundsChanged)
  mainWindow.on('maximize', onBoundsChanged)
  mainWindow.on('unmaximize', onBoundsChanged)

  mainWindow.on('close', (event) => {
    if (!isQuiting) {
      if (CONFIG?.runInBackground === false) {
        isQuiting = true
        app.quit()
      } else {
        event.preventDefault()
        mainWindow?.hide()
      }
    }
  })
}

// ─── Tray ───────────────────────────────────────────────

const updateTray = () => {
  if (!tray || !CONFIG) return
  const currentConfig = CONFIG

  const connectionItems: MenuItemConstructorOptions[] = (currentConfig.connections || []).map(
    (conn) => ({
      label: `${conn.id === currentConfig.defaultConnectionId ? '★ ' : ''}${conn.name}`,
      sublabel: conn.url,
      click: async () => {
        const result = await connectTo(conn)
        if (result) sendToRenderer('connection:open', result)
      }
    })
  )
  const separator: MenuItemConstructorOptions = { type: 'separator' }

  const trayMenuTemplate: MenuItemConstructorOptions[] = [
    {
      label: 'Show AuraPro',
      click: () => {
        mainWindow?.show()
        mainWindow?.focus()
      }
    },
    separator,
    ...(connectionItems.length > 0
      ? [{ label: 'Connections', enabled: false }, ...connectionItems, separator]
      : []),
    ...(SERVER_STATUS === 'started' && SERVER_URL
      ? [
          {
            label: `Local: ${SERVER_URL}`,
            click: () => {
              if (SERVER_URL) clipboard.writeText(SERVER_URL)
            }
          },
          separator
        ]
      : []),
    {
      label: 'Quit AuraPro',
      accelerator: 'CommandOrControl+Q',
      click: async () => {
        await stopServerHandler()
        isQuiting = true
        app.quit()
      }
    }
  ]

  const trayMenu = Menu.buildFromTemplate(trayMenuTemplate)
  tray?.setContextMenu(trayMenu)
}

// ─── Connection Management ──────────────────────────────

const connectTo = async (connection: Connection) => {
  let url = connection.url

  if (connection.type === 'local') {
    // Start local server if needed
    if (SERVER_STATUS !== 'started') {
      const started = await startServerHandler()
      if (!started) return null
    }
    // Wait for the server to actually be reachable before opening the view.
    // startServerHandler returns as soon as the process spawns, but the HTTP
    // endpoint might not be ready yet (especially on first launch).
    if (!SERVER_REACHABLE) {
      updateWebUIStartupState('waiting', 'Waiting for the WebUI service to become ready...')
      const maxWait = 600_000
      const poll = 2_000
      const t0 = Date.now()
      while (!SERVER_REACHABLE && Date.now() - t0 < maxWait) {
        await new Promise((r) => setTimeout(r, poll))
      }
      if (!SERVER_REACHABLE) {
        log.warn('connectTo: server did not become reachable within timeout')
        updateWebUIStartupState('failed', 'The WebUI service did not become ready in time.')
        return null
      }
    }
    url = SERVER_URL || connection.url
    updateWebUIStartupState('ready')
  }

  // Normalize URL
  if (/^https?:\/\/0\.0\.0\.0/.test(url)) {
    url = url.replace(/^https?:\/\/0\.0\.0\.0/, (match) => match.replace('0.0.0.0', 'localhost'))
  }

  return { url, connectionId: connection.id }
}

// ─── Server Lifecycle ───────────────────────────────────

const startServerHandler = async (): Promise<boolean> => {
  if (SERVER_STATUS === 'starting') {
    log.info('[server] Already running or starting, skipping duplicate start')
    return true
  }
  if (SERVER_STATUS === 'started') {
    log.info('[server] Already running, skipping duplicate start')
    updateWebUIStartupState(SERVER_REACHABLE ? 'ready' : 'waiting')
    return true
  }
  await stopServerHandler(true)
  updateWebUIStartupState('checking', 'Preparing to check the installed WebUI version...')
  SERVER_STATUS = 'starting'
  sendToRenderer('status:server', SERVER_STATUS)

  try {
    CONFIG = await getConfig()
    const { url, pid } = await startServer(
      CONFIG?.localServer?.serveOnLocalNetwork ?? true,
      CONFIG?.localServer?.port ?? null,
      (status, phase) => updateWebUIStartupState(phase, status)
    )
    SERVER_URL = url
    SERVER_PID = pid
    const localConnection: Connection = {
      id: 'local',
      name: 'Local',
      type: 'local',
      url: SERVER_URL
    }
    // Other optional services start concurrently and may have updated their
    // own config sections while the server was booting. Merge into the latest
    // snapshot so the local connection update cannot overwrite those writes.
    const latestConfig = await getConfig()
    const existingLocalIndex = latestConfig.connections.findIndex(
      (connection) => connection.id === 'local' || connection.type === 'local'
    )
    if (existingLocalIndex >= 0) {
      latestConfig.connections[existingLocalIndex] = {
        ...latestConfig.connections[existingLocalIndex],
        ...localConnection
      }
    } else {
      latestConfig.connections.push(localConnection)
    }
    if (!latestConfig.defaultConnectionId) {
      latestConfig.defaultConnectionId = 'local'
    }
    await setConfig({
      connections: latestConfig.connections,
      defaultConnectionId: latestConfig.defaultConnectionId
    })
    CONFIG = await getConfig()
    sendToRenderer('config:updated', CONFIG)
    SERVER_STATUS = 'started'
    log.info('Server started:', SERVER_URL, SERVER_PID)
    sendToRenderer('status:server', SERVER_STATUS)
    updateWebUIStartupState('waiting', 'Waiting for the WebUI service to become ready...')

    // Handle unexpected exit
    const pty = getServerPty(pid)
    pty?.onExit(({ exitCode, signal }) => {
      if (SERVER_PID === pid) {
        log.error(`Server process ${pid} exited unexpectedly: code=${exitCode}, signal=${signal}`)
        SERVER_STATUS = SERVER_REACHABLE ? 'stopped' : 'failed'
        SERVER_REACHABLE = false
        SERVER_PID = null
        sendToRenderer('status:server', SERVER_STATUS)
        updateWebUIStartupState(
          'failed',
          `The WebUI service exited before it became ready (code ${exitCode}).`
        )
        updateTray()
      }
    })

    // Auto-push PTY port so an already-open log panel picks up live output
    connectPtyPort(pid)
    updateTray()

    checkUrlAndOpen(SERVER_URL, async () => {
      if (SERVER_PID !== pid) return
      SERVER_REACHABLE = true
      sendToRenderer('server:ready', { url: SERVER_URL })
      updateWebUIStartupState('ready')
      updateTray()
    })

    return true
  } catch (error) {
    log.error('Failed to start server:', error)
    SERVER_STATUS = 'failed'
    sendToRenderer('status:server', SERVER_STATUS)
    updateWebUIStartupState('failed', getErrorMessage(error))
    sendToRenderer('error', { message: `Failed to start server: ${getErrorMessage(error)}` })
    updateTray()
    return false
  }
}

// Active PTY data listeners — one per PID, replaced on each pty:connect for that PID
const activePtyDisposables: Map<number, { dispose: () => void }> = new Map()

/**
 * Creates a MessagePort-based channel between a PTY process and the renderer.
 * Supports multiple concurrent PTYs — each identified by PID.
 *
 * Flow:
 *   PTY stdout → port1.postMessage → [transfer] → port2 (renderer) → xterm.write
 *   xterm.onData → port2.postMessage → [transfer] → port1 (main) → PTY.write
 */
const connectPtyPort = (pid?: number): void => {
  const targetPid = pid ?? SERVER_PID
  if (!mainWindow) return

  const { port1, port2 } = new MessageChannelMain()

  if (!targetPid) {
    if (SERVER_STATUS === 'starting') {
      log.info('pty:connect — server is starting, no PID yet')
    } else {
      log.info('pty:connect — no active server')
      port1.postMessage({ type: 'output', data: '[No active server process]\r\n' })
    }
    mainWindow.webContents.postMessage('pty:port', { pid: 0 }, [port2])
    return
  }

  // Clean up previous connection for this PID
  activePtyDisposables.get(targetPid)?.dispose()
  activePtyDisposables.delete(targetPid)

  const ptyProcess = getServerPty(targetPid)
  log.info(`pty:connect — PID ${targetPid}, pty exists: ${!!ptyProcess}`)

  // Replay buffered output so renderer sees full history
  const buffer = getServerLog(targetPid)
  if (buffer?.length) {
    for (const chunk of buffer) {
      port1.postMessage({ type: 'output', data: chunk })
    }
  }

  // PTY → port1 → renderer
  if (ptyProcess) {
    const disposable = ptyProcess.onData((data: string) => {
      port1.postMessage({ type: 'output', data })
    })
    activePtyDisposables.set(targetPid, disposable)

    // Renderer → port1 → PTY (interactive input)
    port1.on('message', (event) => {
      const msg = event.data
      const currentPty = getServerPty(targetPid)
      if (!currentPty) return

      try {
        if (msg.type === 'input') {
          currentPty.write(msg.data)
        } else if (msg.type === 'resize') {
          currentPty.resize(msg.cols, msg.rows)
        }
      } catch (error) {
        log.warn(`Ignoring PTY ${msg.type} for exited process ${targetPid}:`, error)
        activePtyDisposables.get(targetPid)?.dispose()
        activePtyDisposables.delete(targetPid)
      }
    })
    port1.start()
  }

  // Transfer port2 to the renderer
  mainWindow.webContents.postMessage('pty:port', { pid: targetPid }, [port2])
}

/**
 * MessagePort channel for the Open Terminal PTY — read-only log viewer.
 */
let activeOpenTerminalDisposable: { dispose: () => void } | null = null

const connectOpenTerminalPtyPort = (): void => {
  if (!mainWindow) return

  const { port1, port2 } = new MessageChannelMain()

  const otPty = getOpenTerminalPty()
  if (!otPty) {
    port1.postMessage({ type: 'output', data: '[Open Terminal is not running]\r\n' })
    mainWindow.webContents.postMessage('open-terminal:pty:port', null, [port2])
    return
  }

  // Clean up previous
  activeOpenTerminalDisposable?.dispose()

  // Replay log buffer
  const buffer = getOpenTerminalLog()
  for (const chunk of buffer) {
    port1.postMessage({ type: 'output', data: chunk })
  }

  // Live data
  const disposable = otPty.onData((data: string) => {
    port1.postMessage({ type: 'output', data })
  })
  activeOpenTerminalDisposable = disposable

  port1.start()
  mainWindow.webContents.postMessage('open-terminal:pty:port', null, [port2])
}

/**
 * MessagePort channel for the OpenCode PTY - read-only log viewer.
 */
let activeOpenCodeDisposable: { dispose: () => void } | null = null

const connectOpenCodePtyPort = (): void => {
  if (!mainWindow) return

  const { port1, port2 } = new MessageChannelMain()
  const openCodePty = getOpenCodePty()
  if (!openCodePty) {
    port1.postMessage({ type: 'output', data: '[OpenCode is not running]\r\n' })
    mainWindow.webContents.postMessage('opencode:pty:port', null, [port2])
    return
  }

  activeOpenCodeDisposable?.dispose()
  for (const chunk of getOpenCodeLog()) {
    port1.postMessage({ type: 'output', data: chunk })
  }

  activeOpenCodeDisposable = openCodePty.onData((data: string) => {
    port1.postMessage({ type: 'output', data })
  })

  port1.start()
  mainWindow.webContents.postMessage('opencode:pty:port', null, [port2])
}

/**
 * MessagePort channel for the llamacpp PTY — log viewer.
 */
let activeLlamaCppDisposable: { dispose: () => void } | null = null

const connectLlamaCppPtyPort = (): void => {
  if (!mainWindow) return

  const { port1, port2 } = new MessageChannelMain()

  const lsPty = getLlamaCppPty()
  if (!lsPty) {
    port1.postMessage({ type: 'output', data: '[llamacpp is not running]\r\n' })
    mainWindow.webContents.postMessage('llamacpp:pty:port', null, [port2])
    return
  }

  // Clean up previous
  activeLlamaCppDisposable?.dispose()

  // Replay log buffer
  const buffer = getLlamaCppLog()
  for (const chunk of buffer) {
    port1.postMessage({ type: 'output', data: chunk })
  }

  // Live data
  const disposable = lsPty.onData((data: string) => {
    port1.postMessage({ type: 'output', data })
  })
  activeLlamaCppDisposable = disposable

  port1.start()
  mainWindow.webContents.postMessage('llamacpp:pty:port', null, [port2])
}

/**
 * MessagePort channel for the sherpa PTY log viewer.
 */
let activeSherpaDisposable: { dispose: () => void } | null = null

const connectSherpaPtyPort = (): void => {
  if (!mainWindow) return

  const { port1, port2 } = new MessageChannelMain()

  const sherpaPty = getSherpaPty()
  if (!sherpaPty) {
    port1.postMessage({ type: 'output', data: '[sherpa is not running]\r\n' })
    mainWindow.webContents.postMessage('sherpa:pty:port', null, [port2])
    return
  }

  activeSherpaDisposable?.dispose()

  const buffer = getSherpaLog()
  for (const chunk of buffer) {
    port1.postMessage({ type: 'output', data: chunk })
  }

  const disposable = sherpaPty.onData((data: string) => {
    port1.postMessage({ type: 'output', data })
  })
  activeSherpaDisposable = disposable

  port1.start()
  mainWindow.webContents.postMessage('sherpa:pty:port', null, [port2])
}

const stopServerHandler = async (preserveStartupState = false): Promise<boolean> => {
  try {
    SERVER_PID = null
    await stopAllServers()
    if (SERVER_STATUS) {
      SERVER_STATUS = 'stopped'
      updateTray()
    }
    SERVER_REACHABLE = false
    SERVER_URL = null
    sendToRenderer('status:server', SERVER_STATUS)
    if (!preserveStartupState) updateWebUIStartupState('idle')
    return true
  } catch (error) {
    log.error('Failed to stop server:', error)
    return false
  }
}

const resetAppHandler = async () => {
  const serviceWarnings: string[] = []
  try {
    // Prevent in-flight model downloads from recreating files while reset is
    // deleting the configured installation directories.
    cancelDownload()

    await stopServerHandler()
    SERVER_STATUS = null
    SERVER_PID = null
    SERVER_REACHABLE = false
    SERVER_URL = null
    sendToRenderer('status:server', null)

    // Stop Open Terminal if running
    try {
      await stopOpenTerminal()
      sendToRenderer('status:open-terminal', null)
    } catch (e) {
      log.warn('Failed to stop Open Terminal during reset:', e)
      serviceWarnings.push(`Open Terminal: ${getErrorMessage(e)}`)
    }
    try {
      await stopOpenCode()
      sendToRenderer('status:opencode', null)
      sendToRenderer('status:opencode-setup', '')
    } catch (e) {
      log.warn('Failed to stop OpenCode during reset:', e)
      serviceWarnings.push(`OpenCode: ${getErrorMessage(e)}`)
    }
    // Sherpa runs from the bundled Python directory and must be stopped before
    // that directory can be removed on Windows.
    try {
      await stopSherpa()
      sendToRenderer('status:sherpa', null)
      sendToRenderer('status:sherpa-setup', '')
    } catch (e) {
      log.warn('Failed to stop Sherpa during reset:', e)
      serviceWarnings.push(`Sherpa: ${getErrorMessage(e)}`)
    }
    // Stop and uninstall llama.cpp if running
    try {
      await uninstallLlamaCpp()
      sendToRenderer('status:llamacpp', null)
      sendToRenderer('status:llamacpp-setup', '')
    } catch (e) {
      log.warn('Failed to uninstall llama.cpp during reset:', e)
      serviceWarnings.push(`llama.cpp: ${getErrorMessage(e)}`)
    }
    // Remove GPU crash marker so sandbox is re-tested on next launch
    try {
      if (existsSync(gpuCrashMarkerPath)) {
        unlinkSync(gpuCrashMarkerPath)
        log.info('GPU crash marker removed during reset')
      }
    } catch (e) {
      log.warn('Failed to remove GPU crash marker during reset:', e)
      serviceWarnings.push(`GPU marker: ${getErrorMessage(e)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
    const result = await resetApp()
    result.warnings.push(...serviceWarnings)
    CONFIG = await getConfig()

    try {
      if (result.success) {
        new Notification({ title: 'AuraPro', body: 'Application has been reset.' }).show()
      } else {
        new Notification({
          title: 'AuraPro',
          body: `Reset is incomplete. ${result.failed.length} item(s) could not be removed.`
        }).show()
      }
    } catch (notificationError) {
      log.warn('Failed to show factory reset notification:', notificationError)
    }
    return result
  } catch (error: unknown) {
    log.error('Failed to reset:', error)
    try {
      new Notification({ title: 'AuraPro', body: `Reset failed: ${getErrorMessage(error)}` }).show()
    } catch (notificationError) {
      log.warn('Failed to show factory reset error notification:', notificationError)
    }
    return {
      success: false,
      removed: [],
      failed: [
        {
          label: 'Factory reset',
          path: getInstallDir(),
          error: getErrorMessage(error)
        }
      ],
      warnings: serviceWarnings
    }
  }
}

// ─── Helpers ────────────────────────────────────────────

const toIpcSafeValue = (value: unknown, seen = new WeakSet<object>()): unknown => {
  if (value === null || value === undefined) return value
  const type = typeof value
  if (type === 'string' || type === 'number' || type === 'boolean') return value
  if (type === 'bigint') return value.toString()
  if (type === 'function' || type === 'symbol') return undefined
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack
    }
  }
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map((item) => toIpcSafeValue(item, seen))
  if (type === 'object') {
    if (seen.has(value)) return '[Circular]'
    seen.add(value)
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      const safeItem = toIpcSafeValue(item, seen)
      if (safeItem !== undefined) output[key] = safeItem
    }
    seen.delete(value)
    return output
  }
  return String(value)
}

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(toIpcSafeValue(error))
  } catch {
    return String(error)
  }
}

const sendToRenderer = (type: string, data?: unknown) => {
  const payload = { type, data: toIpcSafeValue(data) }
  try {
    mainWindow?.webContents.send('main:data', payload)
  } catch (error) {
    log.warn(`Failed to send renderer event "${type}", retrying with stringified payload:`, error)
    mainWindow?.webContents.send('main:data', {
      type,
      data: typeof payload.data === 'string' ? payload.data : JSON.stringify(payload.data)
    })
  }
}

const updateWebUIStartupState = (phase: RuntimeStartupPhase, detail = ''): void => {
  WEBUI_STARTUP_STATE = {
    phase,
    detail,
    updatedAt: Date.now()
  }
  sendToRenderer('webui:startup', WEBUI_STARTUP_STATE)
}

const updateLlamaCppStartupState = (phase: RuntimeStartupPhase, detail = ''): void => {
  LLAMACPP_STARTUP_STATE = {
    phase,
    detail,
    updatedAt: Date.now()
  }
  sendToRenderer('llamacpp:startup', LLAMACPP_STARTUP_STATE)
}

const updateLlamaCppStartupProgress = (
  status: string,
  fallbackPhase: RuntimeStartupBusyPhase = 'starting'
): void => {
  const detail = String(status ?? '')
  const phase =
    /download|updat|install|extract|fetch|remove|reinstall|release|fallback|unavailable|trying/i.test(
      detail
    )
      ? 'updating'
      : fallbackPhase
  updateLlamaCppStartupState(phase, detail)
}

const preferLocalConnectionOnStartup = async (config: AppConfig): Promise<AppConfig> => {
  const localConnection = config.connections.find((connection) => connection.type === 'local')
  if (!localConnection || config.defaultConnectionId === localConnection.id) return config

  log.info(
    `[startup] Local loopback connection detected; switching default connection from ${config.defaultConnectionId ?? 'none'} to ${localConnection.id}`
  )
  await setConfig({ defaultConnectionId: localConnection.id })
  return getConfig()
}

const migrateDataIfNeeded = async (): Promise<void> => {
  if (!CONFIG) CONFIG = await getConfig()
  const requiredDataVersion = 3
  const currentDataVersion = Number(CONFIG.dataVersion ?? CONFIG.version ?? 0)
  if (currentDataVersion >= requiredDataVersion) return

  log.info(
    `Migrating data from version ${currentDataVersion} to ${requiredDataVersion} (replacing data directory)...`
  )
  sendToRenderer('startup:migration', { status: 'starting' })

  try {
    const packagedDataDir = getPackagedDataDir()
    const targetDataDir = getOpenWebUIDataPath()
    const glossaryBackupDir = join(app.getPath('temp'), `aurapro-glossary-backup-${Date.now()}`)
    const glossaryItemsToPreserve = [
      'glossaries',
      'glossary.settings.json',
      'glossary.json',
      'official-glossaries.manifest.json'
    ]
    const preservedGlossaryItems: string[] = []

    if (!(await pathExists(packagedDataDir))) {
      throw new Error(`Bundled data directory not found: ${packagedDataDir}`)
    }

    if (await pathExists(targetDataDir)) {
      const entries = await readdir(targetDataDir, { withFileTypes: true })
      for (const entry of entries) {
        if (
          entry.isFile() &&
          /^glossary_[A-Za-z0-9_]+\.json$/.test(entry.name) &&
          !glossaryItemsToPreserve.includes(entry.name)
        ) {
          glossaryItemsToPreserve.push(entry.name)
        }
      }

      sendToRenderer('startup:migration', { status: 'backing-up' })
      for (const item of glossaryItemsToPreserve) {
        const source = join(targetDataDir, item)
        if (await pathExists(source)) {
          await mkdir(glossaryBackupDir, { recursive: true })
          await cp(source, join(glossaryBackupDir, item), { recursive: true, force: true })
          preservedGlossaryItems.push(item)
        }
      }
      await rm(targetDataDir, { recursive: true, force: true })
    }

    sendToRenderer('startup:migration', { status: 'copying' })
    await cp(packagedDataDir, targetDataDir, { recursive: true, force: true })

    for (const item of preservedGlossaryItems) {
      await cp(join(glossaryBackupDir, item), join(targetDataDir, item), {
        recursive: true,
        force: true
      })
    }

    if (preservedGlossaryItems.length > 0) {
      await rm(glossaryBackupDir, { recursive: true, force: true })
      log.info(
        `Preserved user glossary data during database version ${requiredDataVersion} update: ${preservedGlossaryItems.join(', ')}`
      )
    }

    await setConfig({ version: requiredDataVersion, dataVersion: requiredDataVersion })
    CONFIG = await getConfig()
    log.info(`Successfully replaced data folder for database version ${requiredDataVersion} update`)
    sendToRenderer('config:updated', CONFIG)
    sendToRenderer('startup:migration', { status: 'completed' })
  } catch (error) {
    log.error('Data migration failed:', error)
    sendToRenderer('startup:migration', {
      status: 'failed',
      message: getErrorMessage(error)
    })
  }
}

const migrateWebUIDistributionConfigIfNeeded = async (): Promise<void> => {
  if (!CONFIG) CONFIG = await getConfig()
  const currentConfig = CONFIG
  const requiredMigrationVersion = 1
  if (Number(currentConfig.webuiDistributionMigrationVersion ?? 0) >= requiredMigrationVersion) {
    return
  }

  const configuredVersion = `${currentConfig.localServer?.version ?? ''}`.trim()
  let upgradeLegacyTarget = false

  if (configuredVersion) {
    try {
      const resolvedVersion = resolveOpenWebUITargetVersion(configuredVersion)
      upgradeLegacyTarget = getOpenWebUIPackageNameForVersion(resolvedVersion) === 'aurapro-ui'
    } catch (error) {
      log.warn(
        `Preserving unsupported custom WebUI version during distribution migration: ${configuredVersion}`,
        error
      )
    }
  }

  await setConfig({
    webuiDistributionMigrationVersion: requiredMigrationVersion,
    ...(upgradeLegacyTarget ? { localServer: { version: AURAPRO_UI_TARGET_VERSION } } : {})
  })
  CONFIG = await getConfig()

  if (upgradeLegacyTarget) {
    log.info(
      `Migrated legacy WebUI target ${configuredVersion} to ${AURAPRO_UI_TARGET_VERSION}; ` +
        'the existing data directory will be preserved during package replacement.'
    )
  }
}

let lastAutomaticLlamaDiagnosticFingerprint: string | null = null

const runAutomaticLlamaDiagnostic = async (
  trigger: string,
  startupError?: string
): Promise<void> => {
  try {
    const report = await diagnoseLlamaCpp(trigger, startupError)
    if (report.healthy) {
      lastAutomaticLlamaDiagnosticFingerprint = null
      return
    }
    const errorIssues = report.issues.filter((issue) => issue.severity === 'error')
    const transientIssueIds = new Set([
      'gpu-offload-missing',
      'mtp-runtime-error',
      'model-load-failed',
      'startup-failed'
    ])
    const runtimeStillActive = ['setting-up', 'starting', 'started'].includes(
      report.runtime.status ?? ''
    )
    const isConfirmation = trigger.endsWith('-confirmed')
    if (
      !isConfirmation &&
      runtimeStillActive &&
      errorIssues.length > 0 &&
      errorIssues.every((issue) => transientIssueIds.has(issue.id.split(':')[0]))
    ) {
      const gracePeriodMs = report.models.mtpEnabled ? 90000 : 30000
      scheduleAutomaticLlamaDiagnostic(`${trigger}-confirmed`, undefined, gracePeriodMs)
      return
    }
    if (errorIssues.length > 0 && report.fingerprint !== lastAutomaticLlamaDiagnosticFingerprint) {
      lastAutomaticLlamaDiagnosticFingerprint = report.fingerprint
      sendToRenderer('llamacpp:diagnostic-alert', report)
    }
  } catch (error) {
    log.warn('Automatic llama.cpp diagnostics failed:', error)
  }
}

const scheduleAutomaticLlamaDiagnostic = (
  trigger: string,
  startupError?: string,
  delayMs = 500
): void => {
  setTimeout(() => {
    void runAutomaticLlamaDiagnostic(trigger, startupError)
  }, delayMs)
}

setLlamaCppRuntimeAnomalyHandler((message) => {
  scheduleAutomaticLlamaDiagnostic('runtime-anomaly', message, 250)
})

setOpenCodeRuntimeStatusHandler((nextStatus) => {
  sendToRenderer('status:opencode', nextStatus)
})
let glossarySettingsSyncing = false
let glossarySettingsWatcherStarted = false
let lastGlossaryLlamaSettings: SharedLlamaRuntimeSettings | null = null
let glossaryLlamaRestartTimer: NodeJS.Timeout | null = null

interface SharedLlamaRuntimeSettings {
  ctxSize: number
  mtpEnabled: boolean
  multimodalEnabled: boolean
}

interface StoredGlossaryLlamaRuntimeSettings {
  ctxSize: number | null
  mtpEnabled: boolean | null
  multimodalEnabled: boolean | null
}

const normalizeCtxSize = (value: unknown): number | null => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.max(1, Math.floor(parsed))
}

const normalizeOptionalBoolean = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') return value
  if (value === 'true' || value === 1 || value === '1') return true
  if (value === 'false' || value === 0 || value === '0') return false
  return null
}

const getLlamaRuntimeSettingsFromConfig = (
  config: AppConfig | null | undefined
): SharedLlamaRuntimeSettings => ({
  ctxSize: normalizeCtxSize(config?.llamaCpp?.ctxSize) ?? 16384,
  mtpEnabled: config?.llamaCpp?.mtpEnabled === true,
  multimodalEnabled: config?.llamaCpp?.multimodalEnabled !== false
})

const sameLlamaRuntimeSettings = (
  left: SharedLlamaRuntimeSettings | null,
  right: SharedLlamaRuntimeSettings
): boolean =>
  Boolean(
    left &&
    left.ctxSize === right.ctxSize &&
    left.mtpEnabled === right.mtpEnabled &&
    left.multimodalEnabled === right.multimodalEnabled
  )

const getGlossarySettingsPath = () => join(getOpenWebUIDataPath(), 'glossary.settings.json')

const readGlossaryLlamaRuntimeSettings = (): StoredGlossaryLlamaRuntimeSettings => {
  const empty = { ctxSize: null, mtpEnabled: null, multimodalEnabled: null }
  const settingsPath = getGlossarySettingsPath()
  if (!existsSync(settingsPath)) return empty

  try {
    const raw = readFileSync(settingsPath, 'utf-8')
    const settings = JSON.parse(raw)
    return {
      ctxSize: normalizeCtxSize(settings?.token_limit),
      mtpEnabled: normalizeOptionalBoolean(settings?.mtp_enabled),
      multimodalEnabled: normalizeOptionalBoolean(settings?.multimodal_enabled)
    }
  } catch (error) {
    log.warn('Failed to read shared llama.cpp settings:', error)
    return empty
  }
}

const writeGlossaryLlamaRuntimeSettings = async (runtime: SharedLlamaRuntimeSettings) => {
  const settingsPath = getGlossarySettingsPath()
  mkdirSync(path.dirname(settingsPath), { recursive: true })

  let settings: Record<string, unknown> = {}
  if (existsSync(settingsPath)) {
    try {
      const parsed = JSON.parse(readFileSync(settingsPath, 'utf-8'))
      settings = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch (error) {
      log.warn('Failed to parse glossary settings before syncing llama.cpp settings:', error)
    }
  }

  const current: SharedLlamaRuntimeSettings = {
    ctxSize: normalizeCtxSize(settings.token_limit) ?? 16384,
    mtpEnabled: normalizeOptionalBoolean(settings.mtp_enabled) ?? false,
    multimodalEnabled: normalizeOptionalBoolean(settings.multimodal_enabled) ?? true
  }
  const hasAllFields =
    normalizeCtxSize(settings.token_limit) !== null &&
    normalizeOptionalBoolean(settings.mtp_enabled) !== null &&
    normalizeOptionalBoolean(settings.multimodal_enabled) !== null
  if (hasAllFields && sameLlamaRuntimeSettings(current, runtime)) {
    lastGlossaryLlamaSettings = runtime
    return
  }

  glossarySettingsSyncing = true
  try {
    settings.token_limit = runtime.ctxSize
    settings.mtp_enabled = runtime.mtpEnabled
    settings.multimodal_enabled = runtime.multimodalEnabled
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
    lastGlossaryLlamaSettings = runtime
  } finally {
    setTimeout(() => {
      glossarySettingsSyncing = false
    }, 500)
  }
}

const syncGlossaryLlamaSettingsFromConfig = async () => {
  const config = await getConfig()
  await writeGlossaryLlamaRuntimeSettings(getLlamaRuntimeSettingsFromConfig(config))
}

const restartLlamaCppAfterRuntimeSettingsChange = async (reason: string) => {
  const info = getLlamaCppInfo()
  const config = await getConfig()
  const shouldRestart = config?.llamaCpp?.enabled || info.status === 'started'
  if (!shouldRestart) return

  try {
    log.info(`Restarting llama.cpp after runtime settings changed: ${reason}`)
    if (info.url) {
      sendToRenderer('connections:openai', {
        action: 'remove',
        url: `${info.url}/v1`
      })
    }

    sendToRenderer('status:llamacpp', 'starting')
    sendToRenderer('status:llamacpp-setup', 'Applying llama.cpp settings...')
    updateLlamaCppStartupState('starting', 'Applying llama.cpp settings...')
    await stopLlamaCpp()
    const result = await startLlamaCppWithFallback((status) => {
      sendToRenderer('status:llamacpp-setup', status)
      updateLlamaCppStartupProgress(status)
    })

    sendToRenderer('status:llamacpp', 'started')
    sendToRenderer('llamacpp:ready', result)
    updateLlamaCppStartupState('ready')
    sendToRenderer('status:llamacpp-setup', '')

    if (result.url) {
      sendToRenderer('connections:openai', {
        action: 'add',
        url: `${result.url}/v1`
      })
      setTimeout(() => sendToRenderer('models:refresh'), 1000)
    }

    const latestConfig = await getConfig()
    await setConfig({ llamaCpp: { ...latestConfig.llamaCpp, enabled: true } })
    CONFIG = await getConfig()
  } catch (error) {
    log.error('Failed to restart llama.cpp after runtime settings changed:', error)
    sendToRenderer('status:llamacpp', 'failed')
    updateLlamaCppStartupState('failed', getErrorMessage(error))
    sendToRenderer('error', {
      message: `llama.cpp settings restart failed: ${getErrorMessage(error)}`
    })
  }
}

const scheduleLlamaCppRuntimeSettingsRestart = (reason: string) => {
  if (glossaryLlamaRestartTimer) clearTimeout(glossaryLlamaRestartTimer)
  glossaryLlamaRestartTimer = setTimeout(() => {
    restartLlamaCppAfterRuntimeSettingsChange(reason).catch((error) => {
      log.error('Failed to apply shared llama.cpp settings:', error)
    })
  }, 500)
}

const applyGlossaryLlamaSettingsToConfig = async (runtime: SharedLlamaRuntimeSettings) => {
  const config = await getConfig()
  const current = getLlamaRuntimeSettingsFromConfig(config)
  if (sameLlamaRuntimeSettings(current, runtime)) return

  await setConfig({
    llamaCpp: {
      ...config.llamaCpp,
      ctxSize: runtime.ctxSize,
      mtpEnabled: runtime.mtpEnabled,
      multimodalEnabled: runtime.multimodalEnabled
    }
  })
  CONFIG = await getConfig()
  sendToRenderer('config:updated', CONFIG)
  scheduleLlamaCppRuntimeSettingsRestart('shared settings changed')
}

const startGlossaryCtxSizeSync = async () => {
  if (glossarySettingsWatcherStarted) return
  glossarySettingsWatcherStarted = true

  const config = await getConfig()
  const desktopSettings = getLlamaRuntimeSettingsFromConfig(config)
  const stored = readGlossaryLlamaRuntimeSettings()
  const resolved: SharedLlamaRuntimeSettings = {
    ctxSize: stored.ctxSize ?? desktopSettings.ctxSize,
    mtpEnabled: stored.mtpEnabled ?? desktopSettings.mtpEnabled,
    multimodalEnabled: stored.multimodalEnabled ?? desktopSettings.multimodalEnabled
  }

  if (!sameLlamaRuntimeSettings(desktopSettings, resolved)) {
    await setConfig({
      llamaCpp: {
        ...config.llamaCpp,
        ctxSize: resolved.ctxSize,
        mtpEnabled: resolved.mtpEnabled,
        multimodalEnabled: resolved.multimodalEnabled
      }
    })
    CONFIG = await getConfig()
  }
  lastGlossaryLlamaSettings = resolved
  await writeGlossaryLlamaRuntimeSettings(resolved)

  const settingsPath = getGlossarySettingsPath()
  watchFile(settingsPath, { interval: 1000 }, async () => {
    if (glossarySettingsSyncing) return

    const nextStored = readGlossaryLlamaRuntimeSettings()
    if (
      nextStored.ctxSize === null &&
      nextStored.mtpEnabled === null &&
      nextStored.multimodalEnabled === null
    )
      return

    const currentConfig = await getConfig()
    const current = getLlamaRuntimeSettingsFromConfig(currentConfig)
    const next: SharedLlamaRuntimeSettings = {
      ctxSize: nextStored.ctxSize ?? current.ctxSize,
      mtpEnabled: nextStored.mtpEnabled ?? current.mtpEnabled,
      multimodalEnabled: nextStored.multimodalEnabled ?? current.multimodalEnabled
    }
    if (sameLlamaRuntimeSettings(lastGlossaryLlamaSettings, next)) return

    lastGlossaryLlamaSettings = next
    await applyGlossaryLlamaSettingsToConfig(next)
  })
}

const reloadLlamaCppModelsAfterDownload = async (filepath: string | null | undefined) => {
  if (!filepath || path.extname(filepath).toLowerCase() !== '.gguf') return

  const info = getLlamaCppInfo()
  const config = await getConfig()
  const shouldReload = config?.llamaCpp?.enabled || info.status === 'started'
  if (!shouldReload) return

  try {
    log.info(`Reloading llama.cpp after model download: ${filepath}`)
    if (info.url) {
      sendToRenderer('connections:openai', {
        action: 'remove',
        url: `${info.url}/v1`
      })
    }

    sendToRenderer('status:llamacpp', 'starting')
    sendToRenderer('status:llamacpp-setup', 'Reloading models...')
    await stopLlamaCpp()
    const result = await startLlamaCppWithFallback((status) => {
      sendToRenderer('status:llamacpp-setup', status)
    })

    sendToRenderer('status:llamacpp', 'started')
    sendToRenderer('llamacpp:ready', result)
    sendToRenderer('status:llamacpp-setup', '')

    if (result.url) {
      sendToRenderer('connections:openai', {
        action: 'add',
        url: `${result.url}/v1`
      })
      setTimeout(() => sendToRenderer('models:refresh'), 1000)
    }

    await setConfig({ llamaCpp: { ...config.llamaCpp, enabled: true } })
    CONFIG = await getConfig()
  } catch (error) {
    log.error('Failed to reload llama.cpp after model download:', error)
    sendToRenderer('status:llamacpp', 'failed')
    sendToRenderer('error', {
      message: `llama.cpp model reload failed: ${getErrorMessage(error)}`
    })
  }
}

const startConfiguredServices = async (defaultConnection?: Connection): Promise<void> => {
  log.info('[startup] Starting configured background services')

  validateOpenTerminalProcess()
  validateOpenCodeProcess()
  validateLlamaCppProcess()
  validateSherpaProcess()

  const startupTasks: Promise<void>[] = []

  // Start the default connection first so the primary UI does not wait for
  // optional inference, terminal, or speech services.
  if (!isQuiting && defaultConnection) {
    startupTasks.push(
      (async () => {
        try {
          const result = await connectTo(defaultConnection)
          if (result) sendToRenderer('connection:open', result)
        } catch (error) {
          log.error('Auto-connect to default connection failed:', error)
        }
      })()
    )
  }

  if (!isQuiting && CONFIG?.openTerminal?.enabled) {
    startupTasks.push(
      (async () => {
        try {
          sendToRenderer('status:open-terminal', 'starting')
          const result = await startOpenTerminal(
            CONFIG?.openTerminal?.port ?? null,
            (status: string) => sendToRenderer('status:open-terminal', status)
          )
          sendToRenderer('status:open-terminal', 'started')
          sendToRenderer('open-terminal:ready', result)
        } catch (error) {
          log.error('Auto-start Open Terminal failed:', error)
          sendToRenderer('status:open-terminal', 'failed')
        }
      })()
    )
  }

  if (!isQuiting && CONFIG?.openCode?.enabled && isOpenCodeInstalled()) {
    startupTasks.push(
      (async () => {
        try {
          sendToRenderer('status:opencode', 'starting')
          const result = await startOpenCode(CONFIG?.openCode?.port ?? null, (message) => {
            sendToRenderer('status:opencode-setup', message)
          })
          sendToRenderer('status:opencode', 'started')
          sendToRenderer('status:opencode-setup', '')
          sendToRenderer('opencode:ready', result)
        } catch (error) {
          log.error('Auto-start OpenCode failed:', error)
          sendToRenderer('status:opencode', 'failed')
          sendToRenderer('status:opencode-setup', getErrorMessage(error))
        }
      })()
    )
  }

  if (!isQuiting && CONFIG?.llamaCpp?.enabled) {
    startupTasks.push(
      (async () => {
        try {
          sendToRenderer('status:llamacpp', 'starting')
          updateLlamaCppStartupState('checking', 'Preparing the llama.cpp runtime...')
          const result = await startLlamaCppWithFallback((status) => {
            sendToRenderer('status:llamacpp-setup', status)
            updateLlamaCppStartupProgress(status)
          })
          sendToRenderer('status:llamacpp', 'started')
          sendToRenderer('llamacpp:ready', result)
          updateLlamaCppStartupState('ready')
          if (result.url) {
            sendToRenderer('connections:openai', {
              action: 'add',
              url: `${result.url}/v1`
            })
            setTimeout(() => sendToRenderer('models:refresh'), 1000)
          }
          scheduleAutomaticLlamaDiagnostic('startup-check', undefined, 4000)
        } catch (error) {
          log.error('Auto-start llama.cpp failed:', error)
          sendToRenderer('status:llamacpp', 'failed')
          updateLlamaCppStartupState('failed', getErrorMessage(error))
          scheduleAutomaticLlamaDiagnostic('startup-failed', getErrorMessage(error))
        }
      })()
    )
  }

  if (!isQuiting && CONFIG?.sherpa?.enabled) {
    startupTasks.push(
      (async () => {
        try {
          sendToRenderer('status:sherpa', 'starting')
          const result = await startSherpa(CONFIG?.sherpa?.port ?? null, (status: string) => {
            sendToRenderer('status:sherpa-setup', String(status ?? ''))
          })
          const safeResult = toIpcSafeValue(result)
          sendToRenderer('status:sherpa', 'started')
          sendToRenderer('sherpa:ready', safeResult)
          if (result.url) {
            sendToRenderer('audio:sherpa', {
              action: 'add',
              url: `${result.url}/v1`
            })
          }
        } catch (error) {
          log.error('Auto-start sherpa failed:', error)
          sendToRenderer('status:sherpa', 'failed')
        }
      })()
    )
  }

  await Promise.allSettled(startupTasks)
}

// ─── App Lifecycle ──────────────────────────────────────

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.setAboutPanelOptions({
    applicationName: 'AuraPro',
    iconPath: icon,
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    website: 'https://aurapro.site',
    copyright: `© ${new Date().getFullYear()} AuraPro`
  })

  app.whenReady().then(async () => {
    CONFIG = await getConfig()
    CONFIG = await preferLocalConnectionOnStartup(CONFIG)

    loadSpotlightPosition()
    log.info('Config:', redactConfigForLog(CONFIG))

    app.name = 'AuraPro'
    if (process.platform === 'darwin' && app.dock) {
      app.dock.setIcon(icon)
    }
    electronApp.setAppUserModelId('com.aurapro.desktop')

    // ─── GPU Process Crash Recovery ──────────────────
    // If the GPU process exits fatally (e.g. sandbox init failure on
    // certain NVIDIA/Intel drivers), write a marker and relaunch with
    // --disable-gpu-sandbox so the user doesn't have to manually edit
    // shortcut targets (see issue #110).
    app.on('child-process-gone', (_event, details) => {
      if (details.type === 'GPU') {
        log.error(`GPU process gone: reason=${details.reason}, exitCode=${details.exitCode}`)

        // Only auto-recover from fatal crashes, not normal/clean exits
        if (
          details.reason === 'crashed' ||
          details.reason === 'launch-failed' ||
          details.reason === 'abnormal-exit'
        ) {
          if (!gpuSandboxDisabled) {
            log.info('Writing GPU crash marker and relaunching with --disable-gpu-sandbox')
            try {
              writeFileSync(gpuCrashMarkerPath, new Date().toISOString(), 'utf-8')
            } catch (e) {
              log.warn('Failed to write GPU crash marker:', e)
            }
            app.relaunch({ args: [...process.argv.slice(1), '--disable-gpu-sandbox'] })
            app.exit(0)
          }
        }
      }
    })

    // If we previously set the GPU sandbox marker and this session
    // started successfully, log it so it's visible in diagnostics.
    if (gpuSandboxDisabled) {
      log.info('Running with GPU sandbox disabled (marker file present)')
    }

    // ─── Self-Signed / Untrusted Certificate Support ─
    // Allow connections to AuraPro instances that use self-signed or
    // otherwise untrusted SSL certificates (issue #108). The user
    // explicitly configures the server URL, so trusting all certs is
    // acceptable — this matches the behaviour of VS Code, Postman, and
    // other Electron apps used in enterprise/self-hosted environments.
    app.on('certificate-error', (event, _webContents, url, error, certificate, callback) => {
      log.warn(
        `Certificate error: ${error} for ${url} ` +
          `(subject: ${certificate.subjectName}, issuer: ${certificate.issuerName})`
      )
      event.preventDefault()
      callback(true)
    })

    // Trust all certs on the default session (used by net.fetch() in
    // validateRemoteUrl / checkUrlAndOpen).
    session.defaultSession.setCertificateVerifyProc((_request, callback) => {
      callback(0) // 0 = verified/trusted
    })

    // Webviews use partitioned sessions (persist:connection-*). Each
    // new partition's session also needs to trust all certs.
    app.on('session-created', (newSession) => {
      newSession.setCertificateVerifyProc((_request, callback) => {
        callback(0)
      })

      // Grant media / notification permissions for webview partition sessions
      // so that auth flows, media capture, and notifications work correctly.
      newSession.setPermissionRequestHandler((_webContents, permission, callback) => {
        const allowed = [
          'media',
          'mediaKeySystem',
          'notifications',
          'clipboard-read',
          'clipboard-write',
          'clipboard-sanitized-write'
        ]
        log.info(
          `[session] Permission requested: ${permission}, allowed: ${allowed.includes(permission)}`
        )
        callback(allowed.includes(permission))
      })
    })

    // Log webview guest renderer crashes for diagnostics — the existing
    // 'crashed' listener in Content.svelte surfaces these to the user.
    //
    // For webview guests we also intercept navigation and popup events
    // so that external links open in the user's default browser instead
    // of navigating the webview or spawning a new Electron window (#165).
    app.on('web-contents-created', (_event, contents) => {
      contents.on('render-process-gone', (_e, details) => {
        if (details.reason !== 'clean-exit') {
          log.error(
            `WebContents render-process-gone: type=${contents.getType()}, ` +
              `reason=${details.reason}, exitCode=${details.exitCode}`
          )
        }
      })

      if (contents.getType() === 'webview') {
        // Keep streaming timers and frame callbacks active inside guest pages.
        contents.setBackgroundThrottling(false)

        // ── Popups (target="_blank" links) → open in default browser ──
        contents.setWindowOpenHandler(({ url }) => {
          openUrl(url)
          return { action: 'deny' }
        })

        // ── In-page navigation to a different origin → open externally ──
        // This catches regular link clicks (no target) that would navigate
        // the webview away from the AuraPro instance.
        contents.on('will-navigate', (event, url) => {
          try {
            const currentOrigin = new URL(contents.getURL()).origin
            const targetOrigin = new URL(url).origin
            if (targetOrigin !== currentOrigin) {
              event.preventDefault()
              openUrl(url)
            }
          } catch {
            // Malformed URL — let it through so Chromium can handle/reject it
          }
        })

        // ── Native right-click context menu (#161) ──────────────────
        // Electron <webview> guests don't show a context menu by default,
        // which blocks right-click → Paste / Autofill / password-manager
        // integration on login pages.  Build a native menu with standard
        // editing actions, spell-check suggestions, and link handling.
        contents.on('context-menu', (_event, params) => {
          const menuItems: Electron.MenuItemConstructorOptions[] = []

          // Spell-check suggestions (if any)
          if (params.misspelledWord && params.dictionarySuggestions?.length) {
            for (const suggestion of params.dictionarySuggestions) {
              menuItems.push({
                label: suggestion,
                click: () => contents.replaceMisspelling(suggestion)
              })
            }
            menuItems.push({ type: 'separator' })
          }

          // Link handling
          if (params.linkURL) {
            menuItems.push({
              label: 'Open Link in Browser',
              click: () => openUrl(params.linkURL)
            })
            menuItems.push({
              label: 'Copy Link',
              click: () => clipboard.writeText(params.linkURL)
            })
            menuItems.push({ type: 'separator' })
          }

          // Editable field actions (input, textarea, contenteditable)
          if (params.isEditable) {
            menuItems.push(
              { label: 'Undo', role: 'undo', enabled: params.editFlags.canUndo },
              { label: 'Redo', role: 'redo', enabled: params.editFlags.canRedo },
              { type: 'separator' },
              { label: 'Cut', role: 'cut', enabled: params.editFlags.canCut },
              { label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy },
              { label: 'Paste', role: 'paste', enabled: params.editFlags.canPaste },
              { label: 'Select All', role: 'selectAll', enabled: params.editFlags.canSelectAll }
            )
          } else if (params.selectionText) {
            // Non-editable text selection
            menuItems.push({ label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy })
          }

          if (menuItems.length > 0) {
            Menu.buildFromTemplate(menuItems).popup()
          }
        })
      }
    })

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)

      // Auto-reload when the renderer process dies so the user doesn't
      // see a permanent blank/grey screen.
      window.webContents.on('render-process-gone', (_event, details) => {
        log.error(`Renderer process gone: reason=${details.reason}, exitCode=${details.exitCode}`)
        if (details.reason !== 'clean-exit') {
          window.webContents.reload()
        }
      })
    })

    // ─── IPC Handlers ─────────────────────────────────

    const getAppInfoSnapshot = () => ({
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      username: userInfo().username,
      gpuSandboxDisabled
    })
    const getServerInfoSnapshot = () => ({
      url: SERVER_URL,
      status: SERVER_STATUS,
      pid: SERVER_PID,
      reachable: SERVER_REACHABLE
    })

    ipcMain.handle('get:version', () => app.getVersion())
    ipcMain.handle('app:bootstrap', () => ({
      appInfo: getAppInfoSnapshot(),
      config: CONFIG,
      connections: CONFIG?.connections ?? [],
      serverInfo: getServerInfoSnapshot(),
      webuiStartup: WEBUI_STARTUP_STATE,
      llamaCppStartup: LLAMACPP_STARTUP_STATE,
      contentPreloadPath: `file://${join(__dirname, '../preload/content-preload.js')}`
    }))
    ipcMain.handle('app:info', getAppInfoSnapshot)

    ipcMain.handle('app:contentPreloadPath', () => {
      return `file://${join(__dirname, '../preload/content-preload.js')}`
    })

    ipcMain.handle('app:defaultDataPath', () => {
      return getOpenWebUIDataPath()
    })

    ipcMain.handle('app:installDir', () => {
      return getInstallDir()
    })

    ipcMain.handle('app:defaultInstallDir', () => {
      return getUserDataPath()
    })

    const resolveDiskSpaceProbePath = (targetPath?: string): string => {
      let probePath = targetPath || getUserDataPath()
      try {
        probePath = path.resolve(probePath)
        while (!existsSync(probePath)) {
          const parent = path.dirname(probePath)
          if (!parent || parent === probePath) break
          probePath = parent
        }
      } catch {
        probePath = getUserDataPath()
      }
      return probePath
    }

    ipcMain.handle('system:diskSpace', async (_event, targetPath?: string) => {
      try {
        const probePath = resolveDiskSpaceProbePath(targetPath)
        const stats = await statfs(probePath)
        return { free: stats.bavail * stats.bsize, path: probePath }
      } catch (error) {
        log.error('Failed to check disk space:', error)
        return { free: -1 }
      }
    })

    ipcMain.handle('system:detectBitdefender', async () => {
      if (process.platform !== 'win32') return false
      try {
        const { exec } = await import('child_process')
        const { promisify } = await import('util')
        const execAsync = promisify(exec)

        // Build the detection script, then Base64-encode it to avoid
        // any PowerShell command-line quoting / escaping issues.
        const psScript = `
$found = $false
# Registry paths used by different Bitdefender product lines
$regPaths = @(
  'HKLM:\\SOFTWARE\\Bitdefender',
  'HKLM:\\SOFTWARE\\WOW6432Node\\Bitdefender',
  'HKLM:\\SOFTWARE\\Bitdefender SRL',
  'HKLM:\\SOFTWARE\\WOW6432Node\\Bitdefender SRL'
)
foreach ($p in $regPaths) {
  if (Test-Path $p) { $found = $true; break }
}
# Uninstall entries (catches branded variants like "Bitdefender Total Security")
if (-not $found) {
  $uninstallRoots = @(
    'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
  )
  foreach ($root in $uninstallRoots) {
    if (Test-Path $root) {
      $match = Get-ChildItem $root -ErrorAction SilentlyContinue |
        Get-ItemProperty -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -like '*Bitdefender*' } |
        Select-Object -First 1
      if ($match) { $found = $true; break }
    }
  }
}
# Running processes (multiple known Bitdefender service names)
if (-not $found) {
  $bdProcs = @('bdagent','bdservicehost','bdserviceshost','vsserv','bdredline','epag','bdwtxag','product.console','epintegrationservice','bdntwrk')
  foreach ($proc in $bdProcs) {
    if (Get-Process -Name $proc -ErrorAction SilentlyContinue) { $found = $true; break }
  }
}
if (-not $found) {
  $serviceMatch = Get-Service -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like '*bd*' -or $_.DisplayName -like '*Bitdefender*' } |
    Select-Object -First 1
  if ($serviceMatch) { $found = $true }
}
if (-not $found) {
  $securityProducts = Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction SilentlyContinue |
    Where-Object { $_.displayName -like '*Bitdefender*' } |
    Select-Object -First 1
  if ($securityProducts) { $found = $true }
}
if ($found) { Write-Output 'true' } else { Write-Output 'false' }
`
        // Encode as UTF-16LE Base64 (PowerShell -EncodedCommand expects this)
        const encoded = Buffer.from(psScript, 'utf16le').toString('base64')
        const { stdout } = await execAsync(
          `powershell -NonInteractive -NoProfile -EncodedCommand ${encoded}`,
          { timeout: 10000 }
        )
        return stdout.trim().toLowerCase() === 'true'
      } catch {
        return false
      }
    })

    ipcMain.handle('get:config', () => getConfig())
    ipcMain.handle('set:config', async (_event, config) => {
      const previousShortcuts = {
        global: CONFIG?.globalShortcut,
        spotlight: CONFIG?.spotlightShortcut,
        voice: CONFIG?.voiceInputShortcut,
        call: CONFIG?.callShortcut
      }
      const previousLlamaRuntimeSettings = getLlamaRuntimeSettingsFromConfig(CONFIG)
      await setConfig(config)
      CONFIG = await getConfig()
      const nextLlamaRuntimeSettings = getLlamaRuntimeSettingsFromConfig(CONFIG)
      if (!sameLlamaRuntimeSettings(previousLlamaRuntimeSettings, nextLlamaRuntimeSettings)) {
        await syncGlossaryLlamaSettingsFromConfig()
        scheduleLlamaCppRuntimeSettingsRestart('desktop settings changed')
      }
      updateTray()
      voiceInputRecording = false
      if (
        previousShortcuts.global !== CONFIG.globalShortcut ||
        previousShortcuts.spotlight !== CONFIG.spotlightShortcut ||
        previousShortcuts.voice !== CONFIG.voiceInputShortcut ||
        previousShortcuts.call !== CONFIG.callShortcut
      ) {
        registerShortcuts(
          CONFIG.globalShortcut,
          CONFIG.spotlightShortcut,
          CONFIG.voiceInputShortcut,
          CONFIG.callShortcut
        )
      }
    })

    // Python/uv
    ipcMain.handle('install:python', async () => {
      try {
        log.info('Starting Python installation...')
        sendToRenderer('status:install', 'Downloading Python…')
        const res = await installPython(undefined, (status: string) => {
          sendToRenderer('status:install', status)
        })
        sendToRenderer('status:python', res)
        return res
      } catch (error: unknown) {
        log.error('Python installation IPC handler error:', error)
        sendToRenderer('status:python', false)
        // Re-throw so the renderer's promise rejects with the actual error message
        throw new Error(
          getErrorMessage(error) ||
            'Python installation failed. Please check your internet connection and try again.'
        )
      }
    })

    ipcMain.handle('status:python', async () => {
      return (await isPythonInstalled()) && (await isUvInstalled())
    })

    // Package
    ipcMain.handle('install:package', async () => {
      try {
        log.info('Starting package installation...')
        CONFIG = await getConfig()
        const owuiVersion = resolveOpenWebUITargetVersion(CONFIG?.localServer?.version)
        const otVersion = CONFIG?.openTerminal?.version || undefined

        sendToRenderer('status:install', 'Installing AuraPro…')
        await ensureOpenWebUIPackage(
          owuiVersion,
          (status: string) => {
            sendToRenderer('status:install', status)
          },
          { forceLatest: true, cleanupCaches: false }
        )
        sendToRenderer('status:install', 'Installing Open Terminal…')
        await installPackage('open-terminal', otVersion, (status: string) => {
          sendToRenderer('status:install', status)
        }).catch((e) => log.warn('open-terminal install failed (non-fatal):', e))

        try {
          const packagedDataDir = getPackagedDataDir()
          const targetDataDir = getOpenWebUIDataPath()
          const targetHasData =
            (await pathExists(targetDataDir)) && (await readdir(targetDataDir)).length > 0
          if ((await pathExists(packagedDataDir)) && !targetHasData) {
            await cp(packagedDataDir, targetDataDir, { recursive: true })
            log.info('Copied bundled data to', targetDataDir)
          } else if (targetHasData) {
            log.info('Preserving existing AuraPro/Open WebUI data at', targetDataDir)
          }
        } catch (e) {
          log.error('Failed to copy bundled data:', e)
        }

        await cleanupPythonPackageCaches((status) => {
          sendToRenderer('status:install', status)
        })
        sendToRenderer('status:package', true)
        return true
      } catch (error: unknown) {
        log.error('Package installation IPC handler error:', error)
        sendToRenderer('status:package', false)
        throw new Error(
          getErrorMessage(error) ||
            'Package installation failed. Please check your internet connection and try again.'
        )
      }
    })

    ipcMain.handle('status:package', async () => {
      const config = await getConfig()
      const owuiVersion = resolveOpenWebUITargetVersion(config?.localServer?.version)
      const packageName = getOpenWebUIPackageNameForVersion(owuiVersion)
      const installedVersion = getExactPackageVersion(packageName)
      return owuiVersion === 'latest' ? installedVersion !== null : installedVersion === owuiVersion
    })

    // Server
    ipcMain.handle('server:start', () => startServerHandler())
    ipcMain.handle('server:stop', () => stopServerHandler())
    ipcMain.handle('server:restart', async () => {
      await stopServerHandler()
      return startServerHandler()
    })
    ipcMain.handle('server:logs', () => (SERVER_PID ? getServerLog(SERVER_PID) : []))
    ipcMain.handle('server:logs:clear', () => clearAllServerLogs())
    ipcMain.handle('security:installLocalCertificate', async () => {
      const certificatePath = join(getUserDataPath(), 'certs', 'aurapro-lan.cert.pem')
      const result = await installLocalCertificate(certificatePath)
      if (result.success) {
        log.info('Installed local HTTPS certificate for the current user:', certificatePath)
      } else {
        log.warn('Failed to install local HTTPS certificate:', result.error)
      }
      return result
    })

    // PTY MessagePort channel
    ipcMain.handle('pty:list', () => getServerPIDs())
    ipcMain.handle('pty:connect', (_event, pid?: number) => connectPtyPort(pid))
    ipcMain.handle('server:info', getServerInfoSnapshot)
    ipcMain.handle('server:share-local', async () => {
      const config = await getConfig()
      const port = config.localServer?.port ?? 8081
      const needsLanRestart = config.localServer?.serveOnLocalNetwork !== true
      const useHttps = config.localServer?.httpsEnabled !== false
      const needsProtocolRestart = Boolean(
        SERVER_URL &&
        ((useHttps && SERVER_URL.startsWith('http://')) ||
          (!useHttps && SERVER_URL.startsWith('https://')))
      )

      if (needsLanRestart) {
        config.localServer = { ...(config.localServer ?? {}), port, serveOnLocalNetwork: true }
        await setConfig(config)
        CONFIG = config
      }

      if (SERVER_STATUS !== 'started' || needsLanRestart || needsProtocolRestart) {
        await stopServerHandler()
        await startServerHandler()
      }

      const activePort = SERVER_URL ? Number(new URL(SERVER_URL).port || port) : port
      const urls = getLocalNetworkAddresses().map(
        (address) => `${useHttps ? 'https' : 'http'}://${address}:${activePort}`
      )
      const fallbackUrl =
        SERVER_URL?.replace('0.0.0.0', '127.0.0.1') ??
        `${useHttps ? 'https' : 'http'}://127.0.0.1:${activePort}`
      const url = urls[0] ?? fallbackUrl
      clipboard.writeText(url)

      return {
        url,
        urls,
        copied: true,
        serveOnLocalNetwork: true
      }
    })

    // Connections
    ipcMain.handle('connections:list', async () => {
      const config = await getConfig()
      return config.connections
    })

    ipcMain.handle('connections:add', async (_event, connection: Connection) => {
      const config = await getConfig()
      const existingIndex = config.connections.findIndex((c) => c.id === connection.id)
      if (existingIndex >= 0) {
        config.connections[existingIndex] = { ...config.connections[existingIndex], ...connection }
      } else {
        config.connections.push(connection)
      }
      if (!config.defaultConnectionId) {
        config.defaultConnectionId = connection.id
      }
      await setConfig(config)
      CONFIG = await getConfig()
      updateTray()
      return CONFIG.connections
    })

    ipcMain.handle('connections:remove', async (_event, id: string) => {
      const config = await getConfig()
      config.connections = config.connections.filter((c) => c.id !== id)
      if (config.defaultConnectionId === id) {
        config.defaultConnectionId = config.connections[0]?.id || null
      }
      await setConfig(config)
      CONFIG = await getConfig()
      updateTray()
      return CONFIG.connections
    })

    ipcMain.handle(
      'connections:update',
      async (_event, id: string, updates: Partial<Connection>) => {
        const config = await getConfig()
        const idx = config.connections.findIndex((c) => c.id === id)
        if (idx !== -1) {
          config.connections[idx] = { ...config.connections[idx], ...updates }
          await setConfig(config)
          CONFIG = await getConfig()
          updateTray()
        }
        return CONFIG?.connections ?? config.connections
      }
    )

    ipcMain.handle('connections:setDefault', async (_event, id: string) => {
      const config = await getConfig()
      config.defaultConnectionId = id
      await setConfig(config)
      CONFIG = config
      updateTray()
    })

    ipcMain.handle('connections:connect', async (_event, id: string) => {
      const config = await getConfig()
      const conn = config.connections.find((c) => c.id === id)
      if (conn) {
        return await connectTo(conn)
      }
      return null
    })

    ipcMain.handle('validate:url', async (_event, url: string) => {
      return await validateRemoteUrl(url)
    })

    // Updater
    ipcMain.handle('updater:check', () => checkForUpdates())
    ipcMain.handle('updater:download', () => downloadUpdate())
    ipcMain.handle('updater:install', () => installUpdate())

    // Changelog
    ipcMain.handle('app:changelog', async () => {
      try {
        const changelogPath = app.isPackaged
          ? join(process.resourcesPath, 'CHANGELOG.zh-CN.md')
          : join(app.getAppPath(), 'CHANGELOG.zh-CN.md')
        return await readFile(changelogPath, 'utf-8')
      } catch {
        return null
      }
    })

    // Auth token relay from webview
    ipcMain.handle('app:setAuthToken', (_event, token: string) => {
      AUTH_TOKEN = token || null
      log.info('Auth token updated from webview')
    })

    // Direct clipboard write (fallback for webview restrictions)
    ipcMain.handle('app:copyToClipboard', (_event, text: string) => {
      if (typeof text === 'string') {
        clipboard.writeText(text)
        return true
      }
      return false
    })

    // Misc
    ipcMain.handle('app:reset', () => resetAppHandler())

    // Spotlight
    ipcMain.handle('spotlight:submit', async (_event, query: string, images?: string[]) => {
      const config = await getConfig()
      if (!config.defaultConnectionId || config.connections.length === 0) {
        mainWindow?.show()
        mainWindow?.focus()
        return
      }
      const conn = config.connections.find((c) => c.id === config.defaultConnectionId)
      if (!conn) {
        mainWindow?.show()
        mainWindow?.focus()
        return
      }

      let url = conn.url
      if (conn.type === 'local' && SERVER_URL) {
        url = SERVER_URL
      }
      if (/^https?:\/\/0\.0\.0\.0/.test(url)) {
        url = url.replace(/^https?:\/\/0\.0\.0\.0/, (match) =>
          match.replace('0.0.0.0', 'localhost')
        )
      }

      // Build files payload from screenshot images
      const files = images?.map((dataUrl, i) => ({
        name: `screenshot-${Date.now()}-${i + 1}.png`,
        mimeType: 'image/png',
        dataUrl
      }))

      // Include spotlight shortcut action so the webview can activate the extension
      const spotlightAction = config.shortcutActions?.spotlight || null
      sendToRenderer('query', {
        query,
        connectionId: conn.id,
        url,
        files,
        shortcutAction: spotlightAction
      })

      // Hide spotlight first (blur handler will restore main window)
      spotlightWindow?.hide()
      // Ensure main window is focused to receive the query
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show()
        mainWindow.focus()
      }
    })
    ipcMain.handle('spotlight:close', () => {
      spotlightWindow?.hide()
      // blur handler restores main window
    })

    // Persist bar offset within the fullscreen spotlight window
    ipcMain.handle('spotlight:savePosition', async (_event, offset: { x: number; y: number }) => {
      spotlightBarOffset = offset
      setConfig({ spotlightPosition: offset }).catch((err) =>
        log.warn('Failed to persist spotlight bar position:', err)
      )
    })

    // Capture a region of the screen (called from Spotlight renderer after drag)
    ipcMain.handle(
      'spotlight:captureRegion',
      async (_event, rect: { x: number; y: number; width: number; height: number }) => {
        try {
          // ── Permission check (macOS) ──
          if (process.platform === 'darwin') {
            const status = systemPreferences.getMediaAccessStatus('screen')
            if (status !== 'granted') {
              log.warn(`spotlight:captureRegion — screen recording permission: ${status}`)
              new Notification({
                title: 'Screen Recording Permission Required',
                body: 'AuraPro needs Screen Recording access to capture screenshots. Please enable it in System Settings → Privacy & Security → Screen Recording, then restart the app.'
              }).show()
              // Open the correct System Preferences pane
              shell
                .openExternal(
                  'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
                )
                .catch(() => {})
              return 'no-permission'
            }
          }

          // Make spotlight invisible (but don't hide it — hiding triggers macOS
          // window activation which brings up the main window behind it)
          spotlightWindow?.setOpacity(0)
          // Small delay to let the window fully disappear before capture
          await new Promise((r) => setTimeout(r, 150))

          const cursorPoint = screen.getCursorScreenPoint()
          const display = screen.getDisplayNearestPoint(cursorPoint)
          const scaleFactor = display.scaleFactor || 1

          const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: {
              width: Math.round(display.bounds.width * scaleFactor),
              height: Math.round(display.bounds.height * scaleFactor)
            }
          })

          // Find the source matching this display
          const source = sources.find((s) => s.display_id === String(display.id)) || sources[0]
          if (!source) {
            spotlightWindow?.setOpacity(1)
            return null
          }

          const fullImage = source.thumbnail
          // Validate thumbnail is not empty (can happen without permission)
          if (fullImage.isEmpty()) {
            log.warn('spotlight:captureRegion — captured thumbnail is empty (likely no permission)')
            spotlightWindow?.setOpacity(1)
            return null
          }

          const cropped = fullImage.crop({
            x: Math.round(rect.x * scaleFactor),
            y: Math.round(rect.y * scaleFactor),
            width: Math.round(rect.width * scaleFactor),
            height: Math.round(rect.height * scaleFactor)
          })

          // Restore spotlight visibility
          if (spotlightWindow && !spotlightWindow.isDestroyed()) {
            spotlightWindow.setOpacity(1)
          }

          return cropped.toDataURL()
        } catch (err) {
          log.error('spotlight:captureRegion failed:', err)
          // Restore spotlight on error
          spotlightWindow?.setOpacity(1)
          return null
        }
      }
    )

    // ── Voice Input ─────────────────────────────────────

    // Check microphone permission (macOS)
    ipcMain.handle('voiceInput:micPermission', async () => {
      if (process.platform === 'darwin') {
        const status = systemPreferences.getMediaAccessStatus('microphone')
        if (status !== 'granted') {
          const granted = await systemPreferences.askForMediaAccess('microphone')
          return granted ? 'granted' : 'denied'
        }
        return 'granted'
      }
      return 'granted' // Windows/Linux don't need explicit permission
    })

    // Transcribe audio via the connected server's STT endpoint
    ipcMain.handle(
      'voiceInput:transcribe',
      async (
        _event,
        audioBuffer: ArrayBuffer,
        rendererToken?: string,
        mimeType?: string,
        options?: {
          streamId?: string
          chunkIndex?: number
          resetStream?: boolean
          languageCandidates?: string[] | string
        }
      ) => {
        try {
          const config = await getConfig()
          if (!config.defaultConnectionId || config.connections.length === 0) {
            throw new Error('No connection configured. Set up a connection in Settings first.')
          }
          const conn = config.connections.find((c) => c.id === config.defaultConnectionId)
          if (!conn)
            throw new Error('Default connection not found. Check your connection settings.')

          let url = conn.url
          if (conn.type === 'local' && SERVER_URL) {
            url = SERVER_URL
          }
          if (/^https?:\/\/0\.0\.0\.0/.test(url)) {
            url = url.replace(/^https?:\/\/0\.0\.0\.0/, (match) =>
              match.replace('0.0.0.0', 'localhost')
            )
          }

          // Use stored auth token (relayed from webview), fall back to renderer-provided or contentWindow
          let token = AUTH_TOKEN || rendererToken || ''
          if (!token) {
            // Scan all webContents to find the AuraPro webview and read its token
            try {
              const allContents = webContents.getAllWebContents()
              for (const contents of allContents) {
                try {
                  if (contents.getType() === 'webview' && !contents.isDestroyed()) {
                    const t = await contents.executeJavaScript(
                      `localStorage.getItem('token') || ''`
                    )
                    if (t) {
                      token = t
                      break
                    }
                  }
                } catch {
                  // Skip inaccessible webContents
                }
              }
            } catch {
              log.warn('voiceInput:transcribe — could not extract token from webviews')
            }
          }

          if (!token) {
            throw new Error(
              'Not authenticated. Open a connection and sign in before using voice input.'
            )
          }

          let languageCandidates = options?.languageCandidates
          const shortcutAction = config.shortcutActions?.voice || null
          if (!languageCandidates) {
            if (
              shortcutAction === 'translation' ||
              shortcutAction === 'manuscript_translation' ||
              shortcutAction === 'simultaneous' ||
              shortcutAction === 'learning'
            ) {
              try {
                const glossaryResponse = await fetch(`${url}/api/v1/glossary/settings`, {
                  method: 'GET',
                  headers: {
                    Accept: 'application/json',
                    Authorization: `Bearer ${token}`
                  }
                })
                if (glossaryResponse.ok) {
                  const payload = await glossaryResponse.json()
                  const settings = payload?.settings ?? payload
                  const targetLang = settings?.target_lang || settings?.glossary_lang || ''
                  const sourceLang = settings?.source_lang || ''

                  languageCandidates = targetLang
                    ? [sourceLang, targetLang].filter(Boolean)
                    : ['zh']
                }
              } catch (error) {
                log.warn(
                  'voiceInput:transcribe could not load glossary language candidates:',
                  error
                )
              }
            }
            languageCandidates = languageCandidates || ['zh']
          }

          // Build multipart form data manually using Node.js
          const boundary = '----VoiceInput' + Date.now()
          const buffer = Buffer.from(audioBuffer)
          const contentType = mimeType || 'audio/webm'
          const ext = contentType.includes('mp4')
            ? 'mp4'
            : contentType.includes('wav')
              ? 'wav'
              : contentType.includes('mpeg') || contentType.includes('mp3')
                ? 'mp3'
                : 'webm'
          const filename = `recording-${Date.now()}.${ext}`

          const fields: string[] = []
          const appendField = (
            name: string,
            value: string | number | boolean | undefined
          ): void => {
            if (value === undefined || value === null || value === '') return
            fields.push(
              [
                `--${boundary}`,
                `Content-Disposition: form-data; name="${name}"`,
                '',
                String(value)
              ].join('\r\n')
            )
          }

          appendField('stream_id', options?.streamId)
          appendField('chunk_index', options?.chunkIndex)
          appendField('reset_stream', options?.resetStream)
          appendField(
            'language_candidates',
            Array.isArray(languageCandidates)
              ? languageCandidates.filter(Boolean).join(',')
              : languageCandidates
          )

          const header = [
            ...fields,
            `--${boundary}`,
            `Content-Disposition: form-data; name="file"; filename="${filename}"`,
            `Content-Type: ${contentType}`,
            '',
            ''
          ].join('\r\n')

          const footer = `\r\n--${boundary}--\r\n`
          const headerBuf = Buffer.from(header, 'utf-8')
          const footerBuf = Buffer.from(footer, 'utf-8')
          const body = Buffer.concat([headerBuf, buffer, footerBuf])

          const response = await fetch(`${url}/api/v1/audio/transcriptions`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': `multipart/form-data; boundary=${boundary}`
            },
            body
          })

          if (!response.ok) {
            const text = await response.text().catch(() => '')
            throw new Error(
              `Transcription failed (HTTP ${response.status}). ${text || 'Check that your server has Speech-to-Text configured.'}`
            )
          }

          const result = await response.json()
          return result
        } catch (error: unknown) {
          log.error('voiceInput:transcribe failed:', error)
          new Notification({
            title: 'Voice Input Failed',
            body: getErrorMessage(error) || 'Transcription failed. Check logs for details.'
          }).show()
          throw error
        }
      }
    )

    // Voice input completed — deliver text to chat
    ipcMain.handle('voiceInput:done', async (_event, text: string) => {
      voiceInputRecording = false
      playChime(false)
      if (voiceInputWindow && !voiceInputWindow.isDestroyed()) {
        voiceInputWindow.hide()
      }

      if (!text?.trim()) return

      // Deliver text through the same path as Spotlight
      const config = await getConfig()
      if (!config.defaultConnectionId || config.connections.length === 0) {
        mainWindow?.show()
        mainWindow?.focus()
        return
      }
      const conn = config.connections.find((c) => c.id === config.defaultConnectionId)
      if (!conn) {
        mainWindow?.show()
        mainWindow?.focus()
        return
      }

      let url = conn.url
      if (conn.type === 'local' && SERVER_URL) {
        url = SERVER_URL
      }
      if (/^https?:\/\/0\.0\.0\.0/.test(url)) {
        url = url.replace(/^https?:\/\/0\.0\.0\.0/, (match) =>
          match.replace('0.0.0.0', 'localhost')
        )
      }

      // Include voice shortcut action so the webview can activate the extension
      const voiceAction = config.shortcutActions?.voice || null
      sendToRenderer('query', {
        query: text.trim(),
        connectionId: conn.id,
        url,
        shortcutAction: voiceAction
      })

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show()
        mainWindow.focus()
      }
    })

    // Voice input window requests close
    ipcMain.handle('voiceInput:close', () => {
      voiceInputRecording = false
      playChime(false)
      if (voiceInputWindow && !voiceInputWindow.isDestroyed()) {
        voiceInputWindow.hide()
      }
    })

    // Voice input error
    ipcMain.handle('voiceInput:error', (_event, message: string) => {
      log.warn('Voice input error:', message)
      voiceInputRecording = false
      new Notification({
        title: 'Voice Input Error',
        body: message || 'An unknown error occurred with voice input.'
      }).show()
    })

    // Open Terminal
    ipcMain.handle('open-terminal:start', async () => {
      try {
        sendToRenderer('status:open-terminal', 'starting')
        const result = await startOpenTerminal(
          CONFIG?.openTerminal?.port ?? null,
          (status: string) => sendToRenderer('status:open-terminal', status)
        )
        sendToRenderer('status:open-terminal', 'started')
        sendToRenderer('open-terminal:ready', result)
        // Notify webview to register terminal server at system level
        sendToRenderer('connections:terminal', {
          action: 'add',
          url: result.url,
          key: result.apiKey
        })
        // Save enabled state
        await setConfig({ openTerminal: { ...CONFIG?.openTerminal, enabled: true } })
        CONFIG = await getConfig()
        return result
      } catch (error) {
        log.error('Failed to start Open Terminal:', error)
        sendToRenderer('status:open-terminal', 'failed')
        sendToRenderer('error', { message: `Open Terminal failed: ${getErrorMessage(error)}` })
        return null
      }
    })

    ipcMain.handle('open-terminal:stop', async () => {
      try {
        const info = getOpenTerminalInfo()
        await stopOpenTerminal()
        sendToRenderer('status:open-terminal', 'stopped')
        // Notify webview to unregister terminal server
        if (info.url) {
          sendToRenderer('connections:terminal', {
            action: 'remove',
            url: info.url
          })
        }
        await setConfig({ openTerminal: { ...CONFIG?.openTerminal, enabled: false } })
        CONFIG = await getConfig()
        return true
      } catch (error) {
        log.error('Failed to stop Open Terminal:', error)
        return false
      }
    })

    ipcMain.handle('open-terminal:info', () => getOpenTerminalInfo())
    ipcMain.handle('open-terminal:status', () => isPackageInstalled('open-terminal'))
    ipcMain.handle('open-terminal:pty:connect', () => connectOpenTerminalPtyPort())

    // OpenCode
    ipcMain.handle('opencode:install', async () => {
      try {
        sendToRenderer('status:opencode', 'installing')
        const binary = await setupOpenCode(CONFIG?.openCode?.version, (message) => {
          sendToRenderer('status:opencode-setup', message)
        })
        sendToRenderer('status:opencode', 'stopped')
        sendToRenderer('status:opencode-setup', '')
        sendToRenderer('opencode:installed', true)
        return binary
      } catch (error) {
        const message = getErrorMessage(error)
        log.error('Failed to install OpenCode:', error)
        sendToRenderer('status:opencode', 'failed')
        sendToRenderer('status:opencode-setup', message)
        throw new Error(message)
      }
    })

    ipcMain.handle('opencode:update', async () => {
      try {
        const shouldRestart = Boolean(CONFIG?.openCode?.enabled)
        await stopOpenCode()
        sendToRenderer('status:opencode', 'installing')
        await setupOpenCode(
          CONFIG?.openCode?.version,
          (message) => sendToRenderer('status:opencode-setup', message),
          true
        )
        if (!shouldRestart) {
          sendToRenderer('status:opencode', 'stopped')
          sendToRenderer('status:opencode-setup', '')
          sendToRenderer('opencode:installed', true)
          return getOpenCodeInfo()
        }
        const result = await startOpenCode(CONFIG?.openCode?.port ?? null, (message) => {
          sendToRenderer('status:opencode-setup', message)
        })
        sendToRenderer('status:opencode', 'started')
        sendToRenderer('status:opencode-setup', '')
        sendToRenderer('opencode:ready', result)
        return getOpenCodeInfo()
      } catch (error) {
        const message = getErrorMessage(error)
        log.error('Failed to update OpenCode:', error)
        sendToRenderer('status:opencode', 'failed')
        sendToRenderer('status:opencode-setup', message)
        throw new Error(message)
      }
    })

    ipcMain.handle('opencode:start', async () => {
      try {
        sendToRenderer('status:opencode', 'starting')
        const result = await startOpenCode(CONFIG?.openCode?.port ?? null, (message) => {
          sendToRenderer('status:opencode-setup', message)
        })
        const resultPort = Number(new URL(result.url).port)
        await setConfig({
          openCode: { ...CONFIG?.openCode, enabled: true, port: resultPort }
        })
        CONFIG = await getConfig()
        sendToRenderer('status:opencode', 'started')
        sendToRenderer('status:opencode-setup', '')
        sendToRenderer('opencode:ready', result)
        return result
      } catch (error) {
        const message = getErrorMessage(error)
        log.error('Failed to start OpenCode:', error)
        sendToRenderer('status:opencode', 'failed')
        sendToRenderer('status:opencode-setup', message)
        throw new Error(message)
      }
    })

    ipcMain.handle('opencode:stop', async () => {
      await stopOpenCode()
      await setConfig({ openCode: { ...CONFIG?.openCode, enabled: false } })
      CONFIG = await getConfig()
      sendToRenderer('status:opencode', 'stopped')
      return true
    })
    ipcMain.handle('opencode:info', () => getOpenCodeInfo())
    ipcMain.handle('opencode:status', () => isOpenCodeInstalled())
    ipcMain.handle('opencode:logs', () => getOpenCodeLog())
    ipcMain.handle('opencode:pty:connect', () => connectOpenCodePtyPort())
    ipcMain.handle('opencode:uninstall', async () => {
      const removed = await uninstallOpenCode()
      await setConfig({ openCode: { ...CONFIG?.openCode, enabled: false } })
      CONFIG = await getConfig()
      sendToRenderer('status:opencode', null)
      sendToRenderer('status:opencode-setup', '')
      sendToRenderer('opencode:installed', false)
      return removed
    })

    // llama.cpp
    ipcMain.handle('llamacpp:setup', async () => {
      try {
        sendToRenderer('status:llamacpp', 'setting-up')
        updateLlamaCppStartupState('checking', 'Checking the llama.cpp runtime...')
        const binary = await setupLlamaCpp((status) => {
          sendToRenderer('status:llamacpp-setup', status)
          updateLlamaCppStartupProgress(status, 'updating')
        })
        sendToRenderer('status:llamacpp', 'ready')
        updateLlamaCppStartupState('ready')
        return binary
      } catch (error) {
        log.error('Failed to setup llamacpp:', error)
        sendToRenderer('status:llamacpp', 'failed')
        updateLlamaCppStartupState('failed', getErrorMessage(error))
        sendToRenderer('error', { message: `llamacpp setup failed: ${getErrorMessage(error)}` })
        scheduleAutomaticLlamaDiagnostic('setup-failed', getErrorMessage(error))
        throw error
      }
    })

    ipcMain.handle('llamacpp:start', async () => {
      try {
        sendToRenderer('status:llamacpp', 'starting')
        updateLlamaCppStartupState('checking', 'Preparing the llama.cpp runtime...')
        const result = await startLlamaCppWithFallback((status) => {
          sendToRenderer('status:llamacpp-setup', status)
          updateLlamaCppStartupProgress(status)
        })
        sendToRenderer('status:llamacpp', 'started')
        sendToRenderer('llamacpp:ready', result)
        updateLlamaCppStartupState('ready')
        // Notify webview to register llama-server as OpenAI endpoint
        if (result.url) {
          sendToRenderer('connections:openai', {
            action: 'add',
            url: `${result.url}/v1`
          })
          // Refresh model list after backend registers the endpoint
          setTimeout(() => sendToRenderer('models:refresh'), 1000)
        }
        await setConfig({ llamaCpp: { ...CONFIG?.llamaCpp, enabled: true } })
        CONFIG = await getConfig()
        scheduleAutomaticLlamaDiagnostic('startup-check', undefined, 4000)
        return result
      } catch (error) {
        log.error('Failed to start llamacpp:', error)
        sendToRenderer('status:llamacpp', 'failed')
        updateLlamaCppStartupState('failed', getErrorMessage(error))
        sendToRenderer('error', { message: `llamacpp failed: ${getErrorMessage(error)}` })
        scheduleAutomaticLlamaDiagnostic('startup-failed', getErrorMessage(error))
        throw error
      }
    })

    ipcMain.handle('llamacpp:stop', async () => {
      try {
        const info = getLlamaCppInfo()
        await stopLlamaCpp()
        sendToRenderer('status:llamacpp', 'stopped')
        updateLlamaCppStartupState('idle')
        // Notify webview to unregister llama-server
        if (info.url) {
          sendToRenderer('connections:openai', {
            action: 'remove',
            url: `${info.url}/v1`
          })
          // Refresh model list after removing endpoint
          setTimeout(() => sendToRenderer('models:refresh'), 500)
        }
        await setConfig({ llamaCpp: { ...CONFIG?.llamaCpp, enabled: false } })
        CONFIG = await getConfig()
        return true
      } catch (error) {
        log.error('Failed to stop llamacpp:', error)
        return false
      }
    })

    ipcMain.handle('llamacpp:info', () => getLlamaCppInfo())
    ipcMain.handle('llamacpp:logs', () => getLlamaCppLog())
    ipcMain.handle('llamacpp:pty:connect', () => connectLlamaCppPtyPort())
    ipcMain.handle('llamacpp:diagnose', async () => {
      const report = await diagnoseLlamaCpp('manual')
      sendToRenderer('llamacpp:diagnostic-report', report)
      return report
    })
    ipcMain.handle('llamacpp:repair', async (_event, issueIds?: string[]) => {
      try {
        sendToRenderer('llamacpp:repair-progress', 'Preparing repair...')
        const result = await repairLlamaCpp(
          Array.isArray(issueIds) ? issueIds.filter((value) => typeof value === 'string') : [],
          (status) => sendToRenderer('llamacpp:repair-progress', status)
        )
        const info = getLlamaCppInfo()
        if (info.status === 'started' && info.url) {
          sendToRenderer('status:llamacpp', 'started')
          sendToRenderer('llamacpp:ready', info)
          updateLlamaCppStartupState('ready')
          sendToRenderer('connections:openai', {
            action: 'add',
            url: `${info.url}/v1`
          })
          setTimeout(() => sendToRenderer('models:refresh'), 1000)
        } else {
          sendToRenderer('status:llamacpp', 'failed')
          updateLlamaCppStartupState('failed', 'The repair did not start llama.cpp.')
        }
        CONFIG = await getConfig()
        sendToRenderer('config:updated', CONFIG)
        lastAutomaticLlamaDiagnosticFingerprint = result.report.healthy
          ? null
          : result.report.fingerprint
        const safeResult = toIpcSafeValue(result)
        sendToRenderer('llamacpp:repair-complete', safeResult)
        sendToRenderer('llamacpp:diagnostic-report', result.report)
        return safeResult
      } catch (error) {
        const message = getErrorMessage(error)
        log.error('Failed to repair llama.cpp:', error)
        try {
          CONFIG = await getConfig()
          sendToRenderer('config:updated', CONFIG)
        } catch (configError) {
          log.warn('Failed to refresh config after llama.cpp repair error:', configError)
        }
        sendToRenderer('llamacpp:repair-progress', '')
        updateLlamaCppStartupState('failed', message)
        sendToRenderer('llamacpp:repair-failed', { message })
        throw new Error(message)
      }
    })

    ipcMain.handle(
      'system:installPreflight',
      async (_event, targetPath?: string, requiredBytes = 0) => {
        const installPath = path.resolve(targetPath || getInstallDir())
        const pathSupported = process.platform !== 'win32' || !/[^\x20-\x7e]/.test(installPath)
        let writeProbe: InstallDirectoryWriteProbe | null = null
        if (pathSupported) {
          writeProbe = await probeInstallDirectoryWritable(installPath)
          if (writeProbe.cleanupError) {
            log.warn('Install preflight probe cleanup was delayed:', writeProbe.cleanupError)
          }
        }

        let free = -1
        let diskPath = installPath
        try {
          diskPath = resolveDiskSpaceProbePath(installPath)
          const stats = await statfs(diskPath)
          free = stats.bavail * stats.bsize
        } catch (error) {
          log.warn('Install preflight disk check failed:', error)
        }

        return {
          path: installPath,
          pathSupported,
          diskPath,
          writable: writeProbe?.writable ?? false,
          writeError: writeProbe?.writeError ?? null,
          writeErrorCode: writeProbe?.writeErrorCode ?? null,
          writeAttempts: writeProbe?.writeAttempts ?? 0,
          free,
          requiredBytes,
          enoughSpace: free < 0 || free >= Math.max(0, Number(requiredBytes) || 0)
        }
      }
    )

    // Official glossary package
    ipcMain.handle('official-glossaries:status', () => getOfficialGlossaryStatus())
    ipcMain.handle('official-glossaries:install', async (_event, password: string) => {
      try {
        const result = await installOfficialGlossaries(password, (status) => {
          sendToRenderer('status:official-glossaries', status)
        })
        sendToRenderer('status:official-glossaries', '')
        sendToRenderer('official-glossaries:updated', result)
        return result
      } catch (error) {
        const message = getErrorMessage(error)
        log.error('Failed to install official glossaries:', message)
        sendToRenderer('status:official-glossaries', '')
        throw new Error(message)
      }
    })
    ipcMain.handle('official-glossaries:uninstall', async () => {
      try {
        const removed = await uninstallOfficialGlossaries()
        sendToRenderer('status:official-glossaries', '')
        sendToRenderer('official-glossaries:updated', {
          installed: false,
          version: null
        })
        return removed
      } catch (error) {
        const message = getErrorMessage(error)
        log.error('Failed to uninstall official glossaries:', message)
        throw new Error(message)
      }
    })

    // sherpa
    ipcMain.handle('sherpa:start', async () => {
      try {
        sendToRenderer('status:sherpa', 'starting')
        const result = await startSherpa(CONFIG?.sherpa?.port ?? null, (status: string) => {
          sendToRenderer('status:sherpa-setup', String(status ?? ''))
        })
        const safeResult = toIpcSafeValue(result)
        sendToRenderer('status:sherpa', 'started')
        sendToRenderer('sherpa:ready', safeResult)
        if (result.url) {
          sendToRenderer('audio:sherpa', {
            action: 'add',
            url: `${result.url}/v1`
          })
        }
        const resultPort = result.url
          ? Number(new URL(result.url).port)
          : CONFIG?.sherpa?.port || 39384
        await setConfig({ sherpa: { ...CONFIG?.sherpa, enabled: true, port: resultPort } })
        CONFIG = await getConfig()
        return safeResult
      } catch (error) {
        const message = getErrorMessage(error)
        log.error('Failed to start sherpa:', error)
        sendToRenderer('status:sherpa', 'failed')
        sendToRenderer('error', { message: `sherpa failed: ${message}` })
        throw new Error(message)
      }
    })

    ipcMain.handle('sherpa:stop', async () => {
      try {
        await stopSherpa()
        sendToRenderer('status:sherpa', 'stopped')
        sendToRenderer('audio:sherpa', { action: 'remove' })
        await setConfig({ sherpa: { ...CONFIG?.sherpa, enabled: false } })
        CONFIG = await getConfig()
        return true
      } catch (error) {
        log.error('Failed to stop sherpa:', error)
        return false
      }
    })

    ipcMain.handle('sherpa:info', () => getSherpaInfo())
    ipcMain.handle('sherpa:status', () => isSherpaInstalled())
    ipcMain.handle('sherpa:logs', () => getSherpaLog())
    ipcMain.handle('sherpa:pty:connect', () => connectSherpaPtyPort())
    ipcMain.handle('sherpa:models:list', (_event, kind?: 'asr' | 'tts') => listSherpaModels(kind))
    ipcMain.handle('sherpa:update', async () => {
      try {
        sendToRenderer('status:sherpa-setup', 'Updating sherpa-onnx...')
        await installPackage('sherpa-onnx', undefined, (status: string) => {
          sendToRenderer('status:sherpa-setup', status)
        })
        sendToRenderer('status:sherpa-setup', 'Updating faster-whisper...')
        await installPackage('faster-whisper', undefined, (status: string) => {
          sendToRenderer('status:sherpa-setup', status)
        })
        if (CONFIG?.sherpa?.enabled) {
          await stopSherpa()
          const result = await startSherpa(CONFIG?.sherpa?.port ?? null, (status: string) => {
            sendToRenderer('status:sherpa-setup', String(status ?? ''))
          })
          sendToRenderer('sherpa:ready', toIpcSafeValue(result))
        }
        return true
      } catch (error) {
        const message = getErrorMessage(error)
        log.error('Failed to update sherpa:', error)
        sendToRenderer('error', { message: `sherpa update failed: ${message}` })
        return false
      }
    })
    ipcMain.handle('sherpa:downloadTTSModel', async (_event, isDelete?: boolean) => {
      const config = await getConfig()
      const sherpaConfig = config.sherpa ?? {}
      ensureDefaultTtsModel(
        sherpaConfig,
        (status) => sendToRenderer('status:sherpa-setup', status),
        isDelete
      )
    })
    ipcMain.handle('sherpa:downloadAsrModel', async (_event, isDelete?: boolean) => {
      const config = await getConfig()
      const sherpaConfig = config.sherpa ?? {}
      ensureDefaultAsrModel(
        sherpaConfig,
        (status) => sendToRenderer('status:sherpa-setup', status),
        isDelete
      )
    })

    ipcMain.handle('sherpa:reinit-server-script', () => {
      try {
        reinitSherpaServerScript()
        return true
      } catch (error) {
        log.error('Failed to reinitialize sherpa server script:', error)
        return false
      }
    })

    ipcMain.handle('llamacpp:uninstall', async () => {
      try {
        const info = getLlamaCppInfo()
        await uninstallLlamaCpp()
        sendToRenderer('status:llamacpp', null)
        updateLlamaCppStartupState('idle')
        // Unregister OpenAI endpoint if it was running
        if (info.url) {
          sendToRenderer('connections:openai', {
            action: 'remove',
            url: `${info.url}/v1`
          })
          setTimeout(() => sendToRenderer('models:refresh'), 500)
        }
        await setConfig({ llamaCpp: { ...CONFIG?.llamaCpp, enabled: false } })
        CONFIG = await getConfig()
        return true
      } catch (error) {
        log.error('Failed to uninstall llamacpp:', error)
        return false
      }
    })

    // Hugging Face models
    ipcMain.handle('huggingface:models:list', () => listModels())
    ipcMain.handle('huggingface:models:dir', () => getModelsDir())
    ipcMain.handle('huggingface:models:delete', (_event, repo: string, filename: string) => {
      return deleteModel(repo, filename)
    })
    ipcMain.handle('huggingface:models:cancel', (_event, repo?: string, filename?: string) => {
      cancelDownload(repo, filename)
      return true
    })
    ipcMain.handle('huggingface:search', async (_event, query: string, token?: string) => {
      return searchModels(query, token)
    })
    ipcMain.handle('huggingface:repo:files', async (_event, repo: string, token?: string) => {
      return getRepoFiles(repo, token)
    })
    ipcMain.handle(
      'huggingface:models:download',
      async (
        _event,
        repo: string,
        filename: string,
        token?: string,
        expectedSize?: number,
        saveAs?: string,
        saveRepoAs?: string,
        subDir?: string
      ) => {
        const displayRepo = saveRepoAs || repo
        const displayFilename = saveAs || filename
        try {
          sendToRenderer('status:huggingface-download', {
            repo: displayRepo,
            filename: displayFilename,
            status: 'downloading',
            percent: 0
          })
          const filepath = await downloadModel(
            repo,
            filename,
            (progress) => {
              sendToRenderer('status:huggingface-download', {
                repo: displayRepo,
                filename: displayFilename,
                status: 'downloading',
                percent: progress.percent,
                downloadedBytes: progress.downloadedBytes,
                totalBytes: progress.totalBytes,
                bytesPerSecond: progress.bytesPerSecond,
                etaSeconds: progress.etaSeconds
              })
            },
            token,
            expectedSize,
            saveAs,
            saveRepoAs,
            subDir
          )
          sendToRenderer('status:huggingface-download', {
            repo: displayRepo,
            filename: displayFilename,
            status: 'done',
            percent: 100,
            filepath
          })
          scheduleCacheCleanup(['huggingface'], 'manual-model-download')
          await reloadLlamaCppModelsAfterDownload(filepath)
          return filepath
        } catch (error) {
          const message = getErrorMessage(error)
          log.error('Failed to download model:', error)
          sendToRenderer('status:huggingface-download', {
            repo: displayRepo,
            filename: displayFilename,
            status: 'failed',
            error: message
          })
          sendToRenderer('error', { message: `Model download failed: ${message}` })
          throw new Error(message || `Failed to download ${displayRepo}/${displayFilename}`)
        }
      }
    )

    ipcMain.handle('package:version', (_event, packageName: string) =>
      getPackageVersion(packageName)
    )
    ipcMain.handle('package:uninstall', async (_event, packageName: string) => {
      return uninstallPackage(packageName)
    })
    ipcMain.handle('app:systemInfo', (_event, options?: { includeDedicatedVram?: boolean }) =>
      getSystemInfo(options)
    )

    ipcMain.handle('dialog:selectFolder', async () => {
      const result = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openDirectory']
      })
      return result.canceled ? null : (result.filePaths[0] ?? null)
    })

    ipcMain.handle('app:launchAtLogin:get', () => {
      return app.getLoginItemSettings().openAtLogin
    })
    ipcMain.handle('app:launchAtLogin:set', (_event, enabled: boolean) => {
      app.setLoginItemSettings({ openAtLogin: enabled })
    })

    ipcMain.handle('open:browser', async (_event, { url }) => {
      if (!url) throw new Error('No URL provided')
      let normalizedUrl = url
      if (/^https?:\/\/0\.0\.0\.0/.test(normalizedUrl)) {
        normalizedUrl = normalizedUrl.replace(/^https?:\/\/0\.0\.0\.0/, (match) =>
          match.replace('0.0.0.0', 'localhost')
        )
      }
      await openUrl(normalizedUrl)
    })

    ipcMain.handle('open:path', async (_event, folderPath: string) => {
      if (!folderPath) throw new Error('No path provided')
      await shell.openPath(folderPath)
    })

    ipcMain.handle('notification', async (_event, { title, body }) => {
      new Notification({ title, body }).show()
    })

    ipcMain.handle('llamacpp:check-update', async () => {
      try {
        return await checkLlamaCppUpdate()
      } catch (error) {
        log.error('Failed to check llamacpp update:', error)
        throw error
      }
    })

    ipcMain.handle('llamacpp:update', async () => {
      try {
        sendToRenderer('status:llamacpp', 'setting-up')
        updateLlamaCppStartupState('updating', 'Checking for llama.cpp updates...')
        const result = await updateLlamaCpp((status) => {
          sendToRenderer('status:llamacpp-setup', status)
          updateLlamaCppStartupProgress(status, 'updating')
        })
        sendToRenderer('status:llamacpp', 'ready')
        updateLlamaCppStartupState('ready')
        return result
      } catch (error) {
        const message = getErrorMessage(error)
        log.error('Failed to update llamacpp:', error)
        sendToRenderer('status:llamacpp', 'failed')
        updateLlamaCppStartupState('failed', message)
        sendToRenderer('error', { message: `llamacpp update failed: ${message}` })
        throw error
      }
    })

    // ─── Startup ──────────────────────────────────────

    // Create tray
    const trayIcon = nativeImage.createFromPath(icon)
    tray = new Tray(trayIcon.resize({ width: 16, height: 16 }))
    tray.setToolTip('AuraPro')
    updateTray()

    // Global shortcut
    registerShortcuts(
      CONFIG.globalShortcut,
      CONFIG.spotlightShortcut,
      CONFIG.voiceInputShortcut,
      CONFIG.callShortcut
    )

    // Enable screen capture
    session.defaultSession.setDisplayMediaRequestHandler(
      (_request, callback) => {
        desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
          callback({ video: sources[0], audio: 'loopback' })
        })
      },
      { useSystemPicker: true }
    )

    const defaultConnection = CONFIG.defaultConnectionId
      ? CONFIG.connections.find((connection) => connection.id === CONFIG?.defaultConnectionId)
      : undefined
    const windowCreationStartedAt = Date.now()

    // Show the desktop shell before any optional runtime performs network,
    // package, model, or process checks.
    createMainWindow()
    const startupWindow = mainWindow

    const startBackgroundStartup = (): void => {
      log.info(`[startup] Main window ready in ${Date.now() - windowCreationStartedAt}ms`)

      if (startupWindow && !startupWindow.isDestroyed()) {
        initUpdater(startupWindow)
      }

      void (async () => {
        try {
          await migrateWebUIDistributionConfigIfNeeded()
          await migrateDataIfNeeded()
          await startGlossaryCtxSizeSync()
          await startConfiguredServices(defaultConnection)
        } finally {
          scheduleCacheCleanup(['huggingface'], 'application-startup-after-services')
        }
      })().catch((error) => {
        log.error('[startup] Background startup failed:', error)
      })
    }

    if (startupWindow) {
      // createMainWindow registers its show handler first, so this listener
      // starts background work only after the window has actually been shown.
      startupWindow.once('ready-to-show', startBackgroundStartup)
    } else {
      startBackgroundStartup()
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
      else {
        mainWindow?.show()
        mainWindow?.focus()
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('before-quit', async (event) => {
    if (quitCleanupComplete) return
    event.preventDefault()
    if (quitCleanupInProgress) return

    quitCleanupInProgress = true
    isQuiting = true
    try {
      await stopSherpa()
      await stopLlamaCpp()
      await stopOpenTerminal()
      await stopOpenCode()
      await stopServerHandler()
      globalShortcut.unregisterAll()
      mainWindow = null
      if (spotlightWindow && !spotlightWindow.isDestroyed()) {
        spotlightWindow.destroy()
      }
      spotlightWindow = null
      if (voiceInputWindow && !voiceInputWindow.isDestroyed()) {
        voiceInputWindow.destroy()
      }
      voiceInputWindow = null
      tray?.destroy()
      tray = null
    } catch (error) {
      log.error('Error while cleaning up before quit:', error)
    } finally {
      quitCleanupComplete = true
      quitCleanupInProgress = false
      app.quit()
    }
  })
}
