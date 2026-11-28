<script lang="ts">
  import { onMount } from 'svelte'
  import { localModelUpgradeNotice } from '../../../../../../shared/index-translate-models'
  import i18n from '../../../i18n'
  import { getErrorMessage } from '../../../utils/errors'

  type ModelEvent = {
    type: string
    data?: { status?: string; repo?: string; filename?: string; percent?: number }
  }

  let {
    onOpenSettings,
    hasProReplacement
  }: { onOpenSettings: (tab: string) => void; hasProReplacement: boolean } = $props()
  let installedModels = $state.raw<Parameters<typeof localModelUpgradeNotice>[0]>([])
  const notice = $derived(localModelUpgradeNotice(installedModels, hasProReplacement))
  let downloading = $state(false)
  let progress = $state(0)
  let switching = $state(false)
  let downloadError = $state('')
  const reminderKey = 'aurapro-model-upgrade-remind-next-launch'
  let dismissed = $state(sessionStorage.getItem(reminderKey) === 'yes')
  let disposed = false
  let scan: ReturnType<typeof setTimeout> | undefined

  const refresh = async () => {
    if (dismissed || downloading) return
    const models = await window.electronAPI.listHfModels()
    if (!disposed && !downloading) installedModels = models
  }

  onMount(() => {
    const requestScan = () => {
      if (scan) clearTimeout(scan)
      scan = setTimeout(() => void refresh().catch(console.warn), 750)
    }
    requestScan()
    const dispose = window.electronAPI.onData<ModelEvent>((event) => {
      if (event.type === 'llamacpp:ready') requestScan()
      if (event.type === 'model:upgrade-switch' && downloading) switching = true
      if (event.type === 'model:upgrade-progress' && downloading) {
        progress = Math.round(event.data?.percent ?? 0)
        return
      }
      if (event.type !== 'status:huggingface-download') return
      const data = event.data
      if (!data) return
      if (!downloading && data.status === 'done') requestScan()
    })
    return () => {
      disposed = true
      if (scan) clearTimeout(scan)
      dispose?.()
    }
  })

  const remindLater = () => {
    sessionStorage.setItem(reminderKey, 'yes')
    dismissed = true
  }

  const update = async () => {
    if (!notice || downloading) return
    if (notice.kind === 'pro') {
      onOpenSettings('inference-pro')
      remindLater()
      return
    }
    downloading = true
    progress = 0
    switching = false
    downloadError = ''
    try {
      await window.electronAPI.upgradeHfModel(notice.fromRepo, notice.from)
    } catch (error) {
      downloadError = getErrorMessage(error, String(error))
    } finally {
      downloading = false
      if (!downloadError) await refresh().catch(console.warn)
    }
  }
</script>

{#if notice && !dismissed}
  <aside
    class="fixed bottom-9 right-3 z-30 w-[min(340px,calc(100vw-24px))] rounded-lg border border-black/10 bg-white px-4 py-3 shadow-lg dark:border-white/15 dark:bg-[#202021]"
    aria-label={$i18n.t('settings.models.upgradeTitle')}
  >
    <div class="text-[13px] font-semibold">{$i18n.t('settings.models.upgradeTitle')}</div>
    <div class="mt-1 break-words text-[12px] leading-5 opacity-75">
      {$i18n.t(
        notice.kind === 'revision' || notice.from === notice.to
          ? 'settings.models.upgradeRevision'
          : notice.kind === 'pro'
            ? 'settings.models.upgradePro'
            : 'settings.models.upgradeReplacement',
        { from: notice.from.replace(/\.gguf$/i, ''), to: notice.to.replace(/\.gguf$/i, '') }
      )}
    </div>
    {#if downloading}
      <div class="mt-2 text-[11px] opacity-65" role="status">
        {switching ? $i18n.t('common.restarting') : $i18n.t('common.downloading')}{!switching &&
        progress
          ? ` ${progress}%`
          : ''}
      </div>
    {:else}
      {#if downloadError}
        <div
          class="mt-1 max-h-20 overflow-auto break-words text-[11px] text-red-600 dark:text-red-400"
          role="alert"
        >
          {downloadError}
        </div>
      {/if}
      <div class="mt-3 flex flex-wrap items-start justify-end gap-2">
        <button
          type="button"
          class="rounded-md px-2.5 py-1.5 text-[12px] hover:bg-black/5 dark:hover:bg-white/10"
          onclick={remindLater}
        >
          {$i18n.t('settings.models.remindLater')}
        </button>
        <div class="flex flex-col items-end gap-0.5">
          <button
            type="button"
            class="rounded-md bg-[#1d1d1f] px-2.5 py-1.5 text-[12px] font-medium text-white dark:bg-white dark:text-[#1d1d1f]"
            onclick={update}
          >
            {$i18n.t('settings.models.updateModel')}
          </button>
          <span class="text-[10px] opacity-55">{$i18n.t('settings.models.upgradeEstimate')}</span>
        </div>
      </div>
    {/if}
  </aside>
{/if}
