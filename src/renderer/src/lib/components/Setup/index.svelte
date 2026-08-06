<script lang="ts">
  import { onMount } from 'svelte'
  import { fly } from 'svelte/transition'
  import { appState, connections, config } from '../../stores'
  import i18n from '../../i18n'
  import LocalInstall from './LocalInstall.svelte'

  let view = $state('main') // main | install
  let url = $state('')
  let connecting = $state(false)
  let error = $state('')
  let mounted = $state(false)

  const normalizeServerUrl = (value: string) => {
    const trimmed = value.trim()
    if (/^https?:\/\//i.test(trimmed)) return trimmed

    const lower = trimmed.toLowerCase()
    const looksLocal =
      lower === 'localhost' ||
      lower.startsWith('localhost:') ||
      lower.startsWith('127.') ||
      lower.startsWith('10.') ||
      lower.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(lower) ||
      /^[a-z0-9.-]+:\d+(\/.*)?$/i.test(trimmed)

    return `${looksLocal ? 'http' : 'https'}://${trimmed}`
  }

  onMount(() => {
    setTimeout(() => {
      mounted = true
    }, 100)
  })

  const connect = async () => {
    if (!url.trim()) return
    let u = normalizeServerUrl(url)
    error = ''
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
      const conns = await window.electronAPI.getConnections()
      await window.electronAPI.connectTo(conns[conns.length - 1].id)
      appState.set('ready')
    } catch {
      error = $i18n.t('setup.connectionFailed')
    } finally {
      connecting = false
    }
  }
</script>

<div
  class="h-full w-full relative overflow-hidden bg-[#f5f5f7] dark:bg-[#0a0a0a] text-[#1d1d1f] dark:text-[#fafafa]"
>
  <!-- Drag region -->
  <div class="absolute top-0 left-0 right-0 h-8 drag-region z-10"></div>

  <!-- Content -->
  {#if mounted}
    <div class="relative z-10 h-full flex flex-col justify-end px-8 pb-10">
      {#if view === 'main'}
        <div class="max-w-md" in:fly={{ duration: 500, y: 10 }}>
          <div class="mb-2 text-sm font-normal opacity-50">{$i18n.t('app.name')}</div>

          <h1 class="text-3xl leading-tight font-light tracking-tight mb-6">Choose how to start</h1>

          <div class="grid grid-cols-1 gap-2.5 mb-6">
            <button
              class="group text-left px-4 py-3 bg-white/75 dark:bg-white/[0.08] hover:bg-white dark:hover:bg-white/[0.12] text-[#1d1d1f] dark:text-[#fafafa] transition border-none rounded-lg"
              onclick={() => (view = 'install')}
            >
              <div class="flex items-center justify-between gap-4">
                <div>
                  <div class="text-[14px] font-medium">Install on this computer</div>
                  <div class="text-[12px] opacity-45 mt-1">
                    Run AuraPro locally and share it with your home network.
                  </div>
                </div>
                <svg
                  class="h-4 w-4 opacity-40 group-hover:opacity-70 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="1.5"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M17 8l4 4m0 0l-4 4m4-4H3"
                  />
                </svg>
              </div>
            </button>

            <div class="px-4 py-3 bg-black/[0.04] dark:bg-white/[0.06] rounded-lg">
              <div class="text-[14px] font-medium mb-1">Connect to another computer</div>
              <div class="text-[12px] opacity-45 mb-3">
                Paste a family member's AuraPro LAN link.
              </div>

              <div class="flex gap-2">
                <input
                  type="text"
                  bind:value={url}
                  placeholder="http://192.168.1.10:8081"
                  class="flex-1 px-4 py-2.5 bg-black/[0.04] dark:bg-white/[0.06] text-[13px] text-[#1d1d1f] dark:text-[#fafafa] placeholder:opacity-20 outline-none focus:bg-white/[0.1] transition no-drag border-none"
                  onkeydown={(e) => e.key === 'Enter' && connect()}
                />

                <button
                  class="inline-flex items-center gap-2 bg-white px-6 py-2.5 text-black text-[13px] transition hover:bg-gray-100 disabled:opacity-30 border-none shrink-0"
                  onclick={connect}
                  disabled={connecting || !url.trim()}
                >
                  {connecting ? $i18n.t('common.connecting') : $i18n.t('common.connect')}
                  {#if !connecting}
                    <svg
                      class="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      stroke-width="1.5"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M17 8l4 4m0 0l-4 4m4-4H3"
                      />
                    </svg>
                  {/if}
                </button>
              </div>

              {#if error}
                <p class="text-[11px] text-red-400 opacity-80">{error}</p>
              {/if}
            </div>
          </div>
        </div>
      {:else if view === 'install'}
        <div class="max-w-sm">
          <LocalInstall onBack={() => (view = 'main')} onComplete={() => appState.set('ready')} />
        </div>
      {/if}
    </div>
  {/if}
</div>
