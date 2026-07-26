<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import {
    appInfo,
    appState,
    config,
    connections,
    contentPreloadPath,
    serverInfo,
    startupMigration
  } from './lib/stores'
  import Main from './lib/components/Main.svelte'

  let themeMediaQuery: MediaQueryList
  let themeChangeHandler: ((event: MediaQueryListEvent) => void) | null = null
  let disposeMainData: (() => void) | null = null
  let bootstrapped = $state(false)

  interface MainDataEvent {
    type: string
    data?: unknown
  }

  const applyResolvedTheme = (theme: string) => {
    let resolved = theme
    if (theme === 'system') {
      resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    document.documentElement.classList.remove('light', 'dark')
    document.documentElement.classList.add(resolved)
  }

  onMount(() => {
    const api = window?.electronAPI
    if (!api) return

    let disposed = false
    let receivedServerEvent = false

    disposeMainData = api.onData((data: MainDataEvent) => {
      if (data.type === 'status:server') {
        receivedServerEvent = true
        serverInfo.update((info) => ({ ...info, status: String(data.data ?? '') }))
      }
      if (data.type === 'server:ready') {
        receivedServerEvent = true
        const payload = data.data as { url?: string } | undefined
        serverInfo.update((info) => ({ ...info, reachable: true, url: payload?.url }))
      }
      if (data.type === 'config:updated') {
        config.set(data.data as Parameters<typeof config.set>[0])
      }
      if (data.type === 'startup:migration') {
        startupMigration.set(data.data as Parameters<typeof startupMigration.set>[0])
      }
    })

    const initialize = async () => {
      try {
        const state = await api.getBootstrapState()
        if (disposed) return

        appInfo.set(state.appInfo)
        config.set(state.config)
        connections.set(state.connections)
        contentPreloadPath.set(state.contentPreloadPath ?? '')
        if (!receivedServerEvent) {
          serverInfo.set(state.serverInfo)
        }

        applyResolvedTheme(state.config?.theme ?? 'system')
        themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
        themeChangeHandler = () => {
          const currentTheme = $config?.theme ?? 'system'
          if (currentTheme === 'system') {
            applyResolvedTheme('system')
          }
        }
        themeMediaQuery.addEventListener('change', themeChangeHandler)
        appState.set('ready')
      } catch (error) {
        console.error('Failed to initialize desktop state:', error)
      } finally {
        if (!disposed) bootstrapped = true
      }
    }

    void initialize()

    return () => {
      disposed = true
    }
  })

  onDestroy(() => {
    disposeMainData?.()
    disposeMainData = null
    if (themeMediaQuery && themeChangeHandler) {
      themeMediaQuery.removeEventListener('change', themeChangeHandler)
    }
  })
</script>

<main class="w-full h-full bg-[#f5f5f7] dark:bg-[#0a0a0a]">
  {#if bootstrapped}
    <Main />
  {/if}
</main>
