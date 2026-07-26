import { ipcRenderer, contextBridge } from 'electron'
import type { IpcRendererEvent } from 'electron'

// ─── Desktop ↔ AuraPro Generic Protocol ──────────────
// This preload is a dumb relay. It passes typed {type, data}
// messages between the embedder (desktop renderer) and the
// AuraPro page. Business logic lives elsewhere.
// To add new features, just add new event types — this file
// never needs to change.

type EventCallback = (data: unknown) => void
type BridgeRequest = { type: string; [key: string]: unknown }
type BridgeResponse = { _responseId?: string; data?: unknown }
const eventCallbacks: EventCallback[] = []

// Embedder → Guest (push events from desktop)
// Supported events:
// - theme:update { theme: 'light'|'dark'|'system' }
// - action:activate { action: string } (triggered by global shortcuts)
ipcRenderer.on('desktop:event', (_event, data) => {
  eventCallbacks.forEach((cb) => cb(data))
})

contextBridge.exposeInMainWorld('applyTheme', () => {
  const theme = localStorage.getItem('theme') ?? 'system'
  ipcRenderer.sendToHost('webview:event', { type: 'theme:update', data: { theme } })
})

// Override navigator.clipboard.writeText to ensure it works in Electron webview
try {
  if (navigator.clipboard) {
    const originalWriteText = navigator.clipboard.writeText.bind(navigator.clipboard)
    Object.defineProperty(navigator.clipboard, 'writeText', {
      value: async (text: string) => {
        try {
          await originalWriteText(text)
        } catch {
          // Fallback to desktop shell IPC if standard write fails (common in webview)
          ipcRenderer.sendToHost('webview:send', { type: 'copyToClipboard', text })
        }
      },
      configurable: true,
      writable: true
    })
  }
} catch (e) {
  console.error('Failed to override clipboard API:', e)
}

// Expose to the AuraPro page via contextBridge (secure, unforgeable)
contextBridge.exposeInMainWorld('electronAPI', {
  // Push events: desktop → AuraPro
  onEvent: (callback: EventCallback): void => {
    eventCallbacks.push(callback)
  },

  // Request/Response: AuraPro → desktop
  send: (data: BridgeRequest): Promise<unknown> => {
    return new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2)
      const handler = (_event: IpcRendererEvent, response: BridgeResponse) => {
        if (response?._responseId === id) {
          ipcRenderer.removeListener('desktop:response', handler)
          resolve(response.data)
        }
      }
      ipcRenderer.on('desktop:response', handler)
      ipcRenderer.sendToHost('webview:send', { ...data, _requestId: id })
    })
  },

  // Navigation: AuraPro → desktop
  load: (page: string): void => {
    ipcRenderer.sendToHost('webview:load', page)
  }
})
