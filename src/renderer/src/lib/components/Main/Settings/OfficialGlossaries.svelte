<script lang="ts">
  import { onMount } from 'svelte'
  import i18n from '../../../i18n'

  interface GlossaryStatus {
    installed: boolean
    version: string | null
    fileCount: number
    healthy: boolean
    missingFiles: string[]
    corruptedFiles: string[]
    latestVersion: string | null
    updateAvailable: boolean
    updateCheckedAt: string | null
  }

  interface MainDataEvent {
    type?: string
    data?: unknown
  }

  const getErrorMessage = (error: unknown, fallback = ''): string => {
    if (
      typeof error === 'object' &&
      error !== null &&
      'message' in error &&
      typeof error.message === 'string'
    ) {
      return error.message
    }
    return fallback || String(error)
  }

  let loaded = $state(false)
  let accessCode = $state('')
  let status = $state<GlossaryStatus>({
    installed: false,
    version: null,
    fileCount: 0,
    healthy: true,
    missingFiles: [],
    corruptedFiles: [],
    latestVersion: null,
    updateAvailable: false,
    updateCheckedAt: null
  })
  let working = $state(false)
  let removing = $state(false)
  let progress = $state('')
  let message = $state('')
  let errorMessage = $state('')

  const refreshStatus = async () => {
    status = await window.electronAPI.getOfficialGlossaryStatus()
  }

  onMount(() => {
    let active = true
    refreshStatus()
      .catch((error: unknown) => {
        if (active) errorMessage = getErrorMessage(error)
      })
      .finally(() => {
        if (active) loaded = true
      })

    const cleanup = window.electronAPI.onData((data: MainDataEvent) => {
      if (data?.type === 'status:official-glossaries') {
        progress = String(data.data ?? '')
      }
      if (data?.type === 'official-glossaries:update-check-complete') {
        void refreshStatus().catch((error: unknown) => {
          errorMessage = getErrorMessage(error)
        })
      }
    })

    return () => {
      active = false
      cleanup?.()
    }
  })

  const installOrUpdate = async () => {
    if (!accessCode.trim()) {
      errorMessage = $i18n.t('settings.glossaries.passwordRequired')
      return
    }

    working = true
    message = ''
    errorMessage = ''
    try {
      const result = await window.electronAPI.installOfficialGlossaries(accessCode)
      await refreshStatus()
      message = result.updated
        ? $i18n.t('settings.glossaries.installComplete', { version: result.version })
        : $i18n.t('settings.glossaries.upToDate', { version: result.version })
      accessCode = ''
    } catch (error: unknown) {
      errorMessage = getErrorMessage(error, $i18n.t('settings.glossaries.installFailed'))
    } finally {
      working = false
      progress = ''
    }
  }

  const uninstall = async () => {
    if (!confirm($i18n.t('settings.glossaries.uninstallConfirm'))) return

    removing = true
    message = ''
    errorMessage = ''
    try {
      await window.electronAPI.uninstallOfficialGlossaries()
      await refreshStatus()
      message = $i18n.t('settings.glossaries.uninstallComplete')
    } catch (error: unknown) {
      errorMessage = getErrorMessage(error, $i18n.t('settings.glossaries.uninstallFailed'))
    } finally {
      removing = false
    }
  }
</script>

{#if !loaded}
  <div class="py-6 text-[12px] opacity-20 text-center">{$i18n.t('common.loading')}</div>
{:else}
  <div class="flex flex-col divide-y divide-black/[0.04] dark:divide-white/[0.04]">
    <div class="py-4">
      <div class="flex items-center justify-between gap-4">
        <div>
          <div class="flex items-center gap-2">
            <div class="text-[13px] opacity-70">{$i18n.t('settings.glossaries.package')}</div>
            <span
              class="rounded-[4px] bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-700 dark:bg-amber-400/10 dark:text-amber-300/80"
            >
              {$i18n.t('settings.glossaries.betaBadge')}
            </span>
          </div>
          <div class="text-[11px] opacity-25 mt-0.5">
            {$i18n.t('settings.glossaries.packageDesc')}
          </div>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <div
            class="w-1.5 h-1.5 rounded-full {status.installed && status.healthy
              ? 'bg-emerald-400'
              : status.installed
                ? 'bg-amber-400'
                : 'bg-black/15 dark:bg-white/20'}"
          ></div>
          <span class="text-[12px] opacity-50">
            {#if status.installed}
              v{status.version} · {status.fileCount}
            {:else}
              {$i18n.t('settings.glossaries.notInstalled')}
            {/if}
          </span>
        </div>
      </div>

      {#if status.installed && !status.healthy}
        <div class="mt-3 text-[11px] text-amber-600 dark:text-amber-400/80 leading-relaxed">
          {$i18n.t('settings.glossaries.damaged', {
            count: status.missingFiles.length + status.corruptedFiles.length
          })}
        </div>
      {/if}
      {#if status.installed && status.updateAvailable && status.latestVersion}
        <div class="mt-3 text-[11px] text-amber-600 dark:text-amber-400/80 leading-relaxed">
          {$i18n.t('settings.glossaries.updateAvailable', {
            version: status.latestVersion
          })}
        </div>
      {/if}
    </div>

    <div class="py-4">
      <label class="block text-[13px] opacity-70 mb-1.5" for="official-glossary-access-code">
        {$i18n.t('settings.glossaries.password')}
      </label>
      <div class="text-[11px] opacity-25 mb-3">
        {$i18n.t('settings.glossaries.passwordDesc')}
      </div>
      <div class="flex items-center gap-2">
        <input
          id="official-glossary-access-code"
          type="password"
          autocomplete="off"
          class="flex-1 min-w-0 bg-black/[0.04] dark:bg-white/[0.06] text-[12px] text-[#1d1d1f] dark:text-[#fafafa] px-3 py-2 border-none outline-none rounded-lg opacity-70"
          placeholder={$i18n.t('settings.glossaries.passwordPlaceholder')}
          bind:value={accessCode}
          onkeydown={(event) => {
            if (event.key === 'Enter' && !working) void installOrUpdate()
          }}
        />
        <button
          class="shrink-0 text-[12px] opacity-50 hover:opacity-80 px-3 py-2 bg-black/[0.05] dark:bg-white/[0.07] transition border-none text-[#1d1d1f] dark:text-[#fafafa] rounded-lg flex items-center gap-1.5 disabled:pointer-events-none disabled:opacity-20"
          disabled={working || !accessCode.trim()}
          onclick={installOrUpdate}
        >
          {#if working}
            <div
              class="w-2.5 h-2.5 rounded-full border-[1.5px] border-black/20 dark:border-white/30 border-t-transparent animate-spin"
            ></div>
          {/if}
          {status.installed
            ? $i18n.t('settings.glossaries.checkUpdate')
            : $i18n.t('settings.glossaries.install')}
        </button>
      </div>
      <div class="mt-2 flex flex-wrap items-center gap-x-1 text-[11px] opacity-40">
        <span>{$i18n.t('settings.glossaries.betaApply')}</span>
        <button
          type="button"
          class="border-none bg-transparent p-0 text-[#1d1d1f] underline decoration-black/20 underline-offset-2 transition hover:opacity-70 dark:text-[#fafafa] dark:decoration-white/25"
          onclick={() => window.electronAPI.openInBrowser('mailto:Aurapro.com@gmail.com')}
        >
          Aurapro.com@gmail.com
        </button>
      </div>

      {#if progress}
        <div class="mt-3 text-[11px] opacity-40 leading-relaxed">{progress}</div>
      {/if}
      {#if message}
        <div class="mt-3 text-[11px] text-emerald-600 dark:text-emerald-400/80 leading-relaxed">
          {message}
        </div>
      {/if}
      {#if errorMessage}
        <div class="mt-3 text-[11px] text-red-500/80 leading-relaxed">{errorMessage}</div>
      {/if}
    </div>

    {#if status.installed}
      <div class="py-4 flex items-center justify-between gap-4">
        <div>
          <div class="text-[13px] opacity-70">{$i18n.t('settings.glossaries.uninstall')}</div>
          <div class="text-[11px] opacity-25 mt-0.5">
            {$i18n.t('settings.glossaries.uninstallDesc')}
          </div>
        </div>
        <button
          class="text-[12px] opacity-40 hover:opacity-70 px-3 py-1.5 bg-black/[0.04] dark:bg-white/[0.06] transition border-none text-[#1d1d1f] dark:text-[#fafafa] rounded-lg disabled:pointer-events-none disabled:opacity-20"
          disabled={removing}
          onclick={uninstall}
        >
          {removing ? $i18n.t('common.uninstalling') : $i18n.t('settings.glossaries.uninstall')}
        </button>
      </div>
    {/if}
  </div>
{/if}
