import { ipcRenderer, contextBridge } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// ─── PTY MessagePort ────────────────────────────────────
// MessagePorts stay in the preload (cannot cross contextBridge).
// We expose simple functions so the renderer never touches the port.
let activePtyPort: MessagePort | null = null
let ptyOutputCallback: ((data: string) => void) | null = null

ipcRenderer.on('pty:port', (event, _data) => {
  const [port] = event.ports
  if (!port) return
  if (activePtyPort) activePtyPort.close()
  activePtyPort = port
  port.onmessage = (ev: MessageEvent) => {
    if (ev.data?.type === 'output' && ptyOutputCallback) ptyOutputCallback(ev.data.data)
  }
  port.start()
})

// ─── Open Terminal PTY MessagePort ──────────────────────
let activeOtPtyPort: MessagePort | null = null
let otPtyOutputCallback: ((data: string) => void) | null = null

ipcRenderer.on('open-terminal:pty:port', (event, _data) => {
  const [port] = event.ports
  if (!port) return
  if (activeOtPtyPort) activeOtPtyPort.close()
  activeOtPtyPort = port
  port.onmessage = (ev: MessageEvent) => {
    if (ev.data?.type === 'output' && otPtyOutputCallback) otPtyOutputCallback(ev.data.data)
  }
  port.start()
})

// ─── llama.cpp PTY MessagePort ──────────────────────────
let activeLsCppPtyPort: MessagePort | null = null
let lsCppPtyOutputCallback: ((data: string) => void) | null = null

ipcRenderer.on('llamacpp:pty:port', (event, _data) => {
  const [port] = event.ports
  if (!port) return
  if (activeLsCppPtyPort) activeLsCppPtyPort.close()
  activeLsCppPtyPort = port
  port.onmessage = (ev: MessageEvent) => {
    if (ev.data?.type === 'output' && lsCppPtyOutputCallback) lsCppPtyOutputCallback(ev.data.data)
  }
  port.start()
})

// sherpa PTY MessagePort
let activeSherpaPtyPort: MessagePort | null = null
let sherpaPtyOutputCallback: ((data: string) => void) | null = null

ipcRenderer.on('sherpa:pty:port', (event, _data) => {
  const [port] = event.ports
  if (!port) return
  if (activeSherpaPtyPort) activeSherpaPtyPort.close()
  activeSherpaPtyPort = port
  port.onmessage = (ev: MessageEvent) => {
    if (ev.data?.type === 'output' && sherpaPtyOutputCallback) sherpaPtyOutputCallback(ev.data.data)
  }
  port.start()
})

const toPlainStringArray = (values?: unknown): string[] =>
  Array.isArray(values)
    ? values.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : []

export interface ConnectionInput {
  id: string
  name: string
  type: 'local' | 'remote'
  url: string
}

const api = {
  onData: <T = unknown>(callback: (data: T) => void) => {
    const handler = (_event: IpcRendererEvent, data: unknown): void => callback(data as T)
    ipcRenderer.on('main:data', handler)
    return () => ipcRenderer.removeListener('main:data', handler)
  },

  // App
  getBootstrapState: () => ipcRenderer.invoke('app:bootstrap'),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  getSystemInfo: (options?: { includeDedicatedVram?: boolean }) =>
    ipcRenderer.invoke('app:systemInfo', options),
  getVersion: () => ipcRenderer.invoke('get:version'),
  resetApp: () => ipcRenderer.invoke('app:reset'),
  getDefaultDataPath: () => ipcRenderer.invoke('app:defaultDataPath'),
  getInstallDir: () => ipcRenderer.invoke('app:installDir'),
  getDefaultInstallDir: () => ipcRenderer.invoke('app:defaultInstallDir'),
  getContentPreloadPath: () => ipcRenderer.invoke('app:contentPreloadPath'),
  getDiskSpace: (targetPath?: string) => ipcRenderer.invoke('system:diskSpace', targetPath),
  checkInstallPreflight: (targetPath?: string, requiredBytes?: number) =>
    ipcRenderer.invoke('system:installPreflight', targetPath, requiredBytes),
  detectBitdefender: () => ipcRenderer.invoke('system:detectBitdefender'),
  getLaunchAtLogin: () => ipcRenderer.invoke('app:launchAtLogin:get'),
  setLaunchAtLogin: (enabled: boolean) => ipcRenderer.invoke('app:launchAtLogin:set', enabled),
  openInBrowser: (url: string) => ipcRenderer.invoke('open:browser', { url }),
  openPath: (folderPath: string) => ipcRenderer.invoke('open:path', folderPath),
  notification: (title: string, body: string) =>
    ipcRenderer.invoke('notification', { title, body }),

  // Config
  getConfig: () => ipcRenderer.invoke('get:config'),
  setConfig: (config: Record<string, unknown>) => ipcRenderer.invoke('set:config', config),

  // Python/uv
  installPython: () => ipcRenderer.invoke('install:python'),
  getPythonStatus: () => ipcRenderer.invoke('status:python'),

  // Package
  installPackage: () => ipcRenderer.invoke('install:package'),
  getPackageStatus: () => ipcRenderer.invoke('status:package'),

  // Official glossary package
  getOfficialGlossaryStatus: () => ipcRenderer.invoke('official-glossaries:status'),
  installOfficialGlossaries: (password: string) =>
    ipcRenderer.invoke('official-glossaries:install', password),
  uninstallOfficialGlossaries: () => ipcRenderer.invoke('official-glossaries:uninstall'),

  // Server
  startServer: () => ipcRenderer.invoke('server:start'),
  stopServer: () => ipcRenderer.invoke('server:stop'),
  restartServer: () => ipcRenderer.invoke('server:restart'),
  getServerInfo: () => ipcRenderer.invoke('server:info'),
  getServerLogs: () => ipcRenderer.invoke('server:logs'),
  clearServerLogs: () => ipcRenderer.invoke('server:logs:clear'),
  shareLocalServer: () => ipcRenderer.invoke('server:share-local'),

  // PTY — MessagePort stays in preload, renderer uses these functions
  listPtys: () => ipcRenderer.invoke('pty:list'),
  connectPty: (onOutput: (data: string) => void, pid?: number) => {
    ptyOutputCallback = onOutput
    ipcRenderer.invoke('pty:connect', pid)
  },
  writePty: (data: string) => {
    activePtyPort?.postMessage({ type: 'input', data })
  },
  resizePty: (cols: number, rows: number) => {
    activePtyPort?.postMessage({ type: 'resize', cols, rows })
  },
  disconnectPty: () => {
    ptyOutputCallback = null
    if (activePtyPort) {
      activePtyPort.close()
      activePtyPort = null
    }
  },

  // Open Terminal
  startOpenTerminal: () => ipcRenderer.invoke('open-terminal:start'),
  stopOpenTerminal: () => ipcRenderer.invoke('open-terminal:stop'),
  getOpenTerminalInfo: () => ipcRenderer.invoke('open-terminal:info'),
  getOpenTerminalStatus: () => ipcRenderer.invoke('open-terminal:status'),
  connectOpenTerminalPty: (onOutput: (data: string) => void) => {
    otPtyOutputCallback = onOutput
    ipcRenderer.invoke('open-terminal:pty:connect')
  },
  disconnectOpenTerminalPty: () => {
    otPtyOutputCallback = null
    if (activeOtPtyPort) {
      activeOtPtyPort.close()
      activeOtPtyPort = null
    }
  },

  // llama.cpp
  setupLlamaCpp: () => ipcRenderer.invoke('llamacpp:setup'),
  startLlamaCpp: () => ipcRenderer.invoke('llamacpp:start'),
  stopLlamaCpp: () => ipcRenderer.invoke('llamacpp:stop'),
  getLlamaCppInfo: () => ipcRenderer.invoke('llamacpp:info'),
  getLlamaCppLogs: () => ipcRenderer.invoke('llamacpp:logs'),
  connectLlamaCppPty: (onOutput: (data: string) => void) => {
    lsCppPtyOutputCallback = onOutput
    ipcRenderer.invoke('llamacpp:pty:connect')
  },
  disconnectLlamaCppPty: () => {
    lsCppPtyOutputCallback = null
    if (activeLsCppPtyPort) {
      activeLsCppPtyPort.close()
      activeLsCppPtyPort = null
    }
  },
  checkLlamaCppUpdate: () => ipcRenderer.invoke('llamacpp:check-update'),
  updateLlamaCpp: () => ipcRenderer.invoke('llamacpp:update'),
  uninstallLlamaCpp: () => ipcRenderer.invoke('llamacpp:uninstall'),
  diagnoseLlamaCpp: () => ipcRenderer.invoke('llamacpp:diagnose'),
  repairLlamaCpp: (issueIds?: string[]) =>
    ipcRenderer.invoke('llamacpp:repair', toPlainStringArray(issueIds)),

  // sherpa
  startSherpa: () => ipcRenderer.invoke('sherpa:start'),
  stopSherpa: () => ipcRenderer.invoke('sherpa:stop'),
  getSherpaInfo: () => ipcRenderer.invoke('sherpa:info'),
  getSherpaStatus: () => ipcRenderer.invoke('sherpa:status'),
  getSherpaLogs: () => ipcRenderer.invoke('sherpa:logs'),
  listSherpaModels: (kind?: 'asr' | 'tts') => ipcRenderer.invoke('sherpa:models:list', kind),
  updateSherpa: () => ipcRenderer.invoke('sherpa:update'),
  reinitSherpaServerScript: () => ipcRenderer.invoke('sherpa:reinit-server-script'),
  connectSherpaPty: (onOutput: (data: string) => void) => {
    sherpaPtyOutputCallback = onOutput
    ipcRenderer.invoke('sherpa:pty:connect')
  },
  disconnectSherpaPty: () => {
    sherpaPtyOutputCallback = null
    if (activeSherpaPtyPort) {
      activeSherpaPtyPort.close()
      activeSherpaPtyPort = null
    }
  },
  downloadSherpaAsrModel: (isDelete?: boolean) =>
    ipcRenderer.invoke('sherpa:downloadAsrModel', isDelete),
  downloadSherpaTTSModel: (isDelete?: boolean) =>
    ipcRenderer.invoke('sherpa:downloadTTSModel', isDelete),

  // Hugging Face models
  listHfModels: () => ipcRenderer.invoke('huggingface:models:list'),
  getHfModelsDir: () => ipcRenderer.invoke('huggingface:models:dir'),
  downloadHfModel: (
    repo: string,
    filename: string,
    token?: string,
    expectedSize?: number,
    saveAs?: string,
    saveRepoAs?: string,
    subDir?: string
  ) =>
    ipcRenderer.invoke(
      'huggingface:models:download',
      repo,
      filename,
      token,
      expectedSize,
      saveAs,
      saveRepoAs,
      subDir
    ),
  deleteHfModel: (repo: string, filename: string) =>
    ipcRenderer.invoke('huggingface:models:delete', repo, filename),
  cancelHfDownload: (repo?: string, filename?: string) =>
    ipcRenderer.invoke('huggingface:models:cancel', repo, filename),
  searchHfModels: (query: string, token?: string) =>
    ipcRenderer.invoke('huggingface:search', query, token),
  getHfRepoFiles: (repo: string, token?: string) =>
    ipcRenderer.invoke('huggingface:repo:files', repo, token),

  // Package
  getPackageVersion: (packageName: string) => ipcRenderer.invoke('package:version', packageName),
  uninstallPackage: (packageName: string) => ipcRenderer.invoke('package:uninstall', packageName),

  // Connections
  getConnections: () => ipcRenderer.invoke('connections:list'),
  addConnection: (connection: ConnectionInput) => ipcRenderer.invoke('connections:add', connection),
  removeConnection: (id: string) => ipcRenderer.invoke('connections:remove', id),
  updateConnection: (id: string, updates: Partial<ConnectionInput>) =>
    ipcRenderer.invoke('connections:update', id, updates),
  setDefaultConnection: (id: string) => ipcRenderer.invoke('connections:setDefault', id),
  connectTo: (id: string) => ipcRenderer.invoke('connections:connect', id),
  validateUrl: (url: string) => ipcRenderer.invoke('validate:url', url),
  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),

  // Updater
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),

  // Changelog
  getChangelog: () => ipcRenderer.invoke('app:changelog'),

  // Auth token relay from webview
  setAuthToken: (token: string) => ipcRenderer.invoke('app:setAuthToken', token),

  // Clipboard
  copyToClipboard: (data: string | { text: string }) => {
    const text = typeof data === 'string' ? data : data.text
    return ipcRenderer.invoke('app:copyToClipboard', text)
  }
}

export type DesktopApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('electronAPI', api)
  } catch (error) {
    console.error(error)
  }
} else {
  Object.assign(window, { electron: electronAPI, electronAPI: api })
}
