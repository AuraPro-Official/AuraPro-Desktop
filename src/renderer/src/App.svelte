<script lang="ts">
  import { onMount } from 'svelte'
  import { normalizeDesktopTheme } from '../../shared/desktop-theme'
  import {
    appInfo,
    appState,
    config,
    connections,
    contentPreloadPath,
    llamaCppStartup,
    serverInfo,
    startupMigration,
    webuiStartup
  } from './lib/stores'
  import Main from './lib/components/Main.svelte'
  import OfficialGlossaryStartup from './lib/components/Setup/OfficialGlossaryStartup.svelte'

  let bootstrapped = $state(false)
  let systemDark = $state(window.matchMedia('(prefers-color-scheme: dark)').matches)

  interface MainDataEvent {
    type: string
    data?: unknown
  }

  $effect(() => {
    const theme = normalizeDesktopTheme($config?.theme)
    const dark = theme === 'dark' || (theme === 'system' && systemDark)
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.classList.toggle('light', !dark)
  })

  onMount(() => {
    const api = window?.electronAPI
    if (!api) return

    const themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const themeChangeHandler = () => (systemDark = themeMediaQuery.matches)
    themeMediaQuery.addEventListener('change', themeChangeHandler)

    let disposed = false
    let receivedServerEvent = false
    let receivedWebUIStartupEvent = false
    let receivedLlamaCppStartupEvent = false

    const disposeMainData = api.onData((data: MainDataEvent) => {
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
      if (data.type === 'webui:startup') {
        receivedWebUIStartupEvent = true
        webuiStartup.set(data.data as Parameters<typeof webuiStartup.set>[0])
      }
      if (data.type === 'llamacpp:startup') {
        receivedLlamaCppStartupEvent = true
        llamaCppStartup.set(data.data as Parameters<typeof llamaCppStartup.set>[0])
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
        if (!receivedWebUIStartupEvent && state.webuiStartup) {
          webuiStartup.set(state.webuiStartup)
        }
        if (!receivedLlamaCppStartupEvent && state.llamaCppStartup) {
          llamaCppStartup.set(state.llamaCppStartup)
        }

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
      disposeMainData?.()
      themeMediaQuery.removeEventListener('change', themeChangeHandler)
    }
  })
</script>

<main class="w-full h-full">
  <OfficialGlossaryStartup />
  {#if bootstrapped}
    <Main />
  {/if}
</main>
