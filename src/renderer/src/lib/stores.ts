import { writable } from 'svelte/store'

export interface WebUIStartupState {
  phase: 'idle' | 'checking' | 'updating' | 'starting' | 'waiting' | 'ready' | 'failed'
  detail: string
  updatedAt: number
}

export const appInfo = writable(null)
export const config = writable(null)
export const connections = writable([])
export const serverInfo = writable(null)
export const webuiStartup = writable<WebUIStartupState>({
  phase: 'idle',
  detail: '',
  updatedAt: 0
})
export const contentPreloadPath = writable('')
export const startupMigration = writable(null)
export const appState = writable('loading') // loading | initializing | setup | ready
