<script lang="ts">
  import { onMount } from 'svelte'
  import i18n from '../../i18n'
  import OfficialGlossaries from '../Main/Settings/OfficialGlossaries.svelte'

  let open = $state(false)
  let dialog: HTMLDialogElement
  const dismiss = async () => {
    await window.electronAPI.dismissOfficialGlossaryStartup()
    open = false
  }
  $effect(() => {
    if (open) dialog?.showModal()
    else dialog?.close()
  })
  onMount(() => {
    let active = true
    let receivedEvent = false
    const cleanup = window.electronAPI.onData((event: { type?: string; data?: unknown }) => {
      if (event.type === 'official-glossaries:startup-prompt') {
        receivedEvent = true
        open = event.data === true
      }
    })
    void window.electronAPI.getOfficialGlossaryStartupPending().then((pending) => {
      if (active && !receivedEvent) open = pending
    })
    return () => {
      active = false
      cleanup?.()
    }
  })
</script>

<dialog
  bind:this={dialog}
  class="m-auto w-[calc(100%-32px)] max-w-[520px] max-h-[calc(100dvh-48px)] rounded-lg border border-black/10 bg-white p-0 text-[#1d1d1f] shadow-xl backdrop:bg-black/45 dark:border-white/10 dark:bg-[#171719] dark:text-[#fafafa]"
  oncancel={(event) => {
    event.preventDefault()
    void dismiss()
  }}
  aria-labelledby="official-glossary-startup-title"
>
  {#if open}
    <header
      class="flex items-center justify-between gap-3 border-b border-black/10 px-5 py-4 dark:border-white/10"
    >
      <h2 id="official-glossary-startup-title" class="text-base font-semibold">
        {$i18n.t('settings.glossaries.package')}
      </h2>
      <button
        type="button"
        class="flex size-8 items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10"
        aria-label={$i18n.t('common.close')}
        title={$i18n.t('common.close')}
        onclick={() => void dismiss()}>×</button
      >
    </header>
    <div class="px-5 py-1"><OfficialGlossaries startup onInstalled={() => void dismiss()} /></div>
  {/if}
</dialog>
