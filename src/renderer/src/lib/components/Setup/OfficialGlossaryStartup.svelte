<script lang="ts">
  import { onMount } from 'svelte'
  import i18n from '../../i18n'
  import OfficialGlossaries from '../Main/Settings/OfficialGlossaries.svelte'

  let open = $state(false)
  let expanded = $state(false)
  let panel = $state<HTMLElement>()
  let dismissed = false
  const dismiss = () => {
    dismissed = true
    open = false
    expanded = false
    void window.electronAPI.dismissOfficialGlossaryStartup().catch((error: unknown) => {
      console.warn('Failed to dismiss the optional glossary reminder:', error)
    })
  }
  onMount(() => {
    let active = true
    let receivedEvent = false
    const cleanup = window.electronAPI.onData((event: { type?: string; data?: unknown }) => {
      if (event.type === 'official-glossaries:startup-prompt') {
        receivedEvent = true
        if (event.data === false) {
          open = false
          expanded = false
        } else if (!dismissed) {
          open = event.data === true
        }
      }
    })
    void window.electronAPI
      .getOfficialGlossaryStartupPending()
      .then((pending) => {
        if (active && !receivedEvent && !dismissed) open = pending
      })
      .catch((error: unknown) => {
        console.warn('Failed to load the optional glossary reminder:', error)
      })
    return () => {
      active = false
      cleanup?.()
    }
  })
</script>

<svelte:window
  onkeydown={(event) => {
    if (
      event.key === 'Escape' &&
      !event.defaultPrevented &&
      panel?.contains(document.activeElement)
    ) {
      dismiss()
    }
  }}
/>

{#if open}
  <aside class="pointer-events-none fixed inset-x-4 bottom-4 z-[110] flex justify-end">
    <section
      bind:this={panel}
      aria-labelledby="official-glossary-startup-title"
      class="pointer-events-auto max-h-[calc(100dvh-32px)] w-full max-w-[440px] overflow-y-auto rounded-lg border border-black/10 bg-white text-[#1d1d1f] shadow-lg dark:border-white/10 dark:bg-[#171719] dark:text-[#fafafa]"
    >
      <header class="flex items-center justify-between gap-3 px-5 pt-4">
        <h2 id="official-glossary-startup-title" class="text-[14px] font-semibold leading-5">
          {$i18n.t('settings.glossaries.startupTitle')}
        </h2>
        <button
          type="button"
          class="flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10"
          aria-label={$i18n.t('common.close')}
          title={$i18n.t('common.close')}
          onclick={dismiss}>×</button
        >
      </header>
      <p class="px-5 pt-1 text-[13px] leading-6 text-black/65 dark:text-white/65" role="status">
        {$i18n.t('settings.glossaries.startupDescription')}
      </p>
      <div id="official-glossary-startup-form" class="px-5">
        {#if expanded}
          <OfficialGlossaries startup onInstalled={dismiss} />
        {/if}
      </div>
      <footer class="flex flex-wrap items-center justify-end gap-2 px-5 pb-4 pt-3">
        <button
          type="button"
          class="rounded-md px-3 py-2 text-[13px] text-black/60 hover:bg-black/5 dark:text-white/60 dark:hover:bg-white/10"
          onclick={dismiss}>{$i18n.t('settings.glossaries.startupLater')}</button
        >
        {#if !expanded}
          <button
            type="button"
            class="rounded-md bg-[#171719] px-3 py-2 text-[13px] font-medium text-white hover:opacity-80 dark:bg-[#fafafa] dark:text-[#171719]"
            aria-expanded={expanded}
            aria-controls="official-glossary-startup-form"
            onclick={() => (expanded = true)}
          >
            {$i18n.t('settings.glossaries.startupEnterCode')}
          </button>
        {/if}
      </footer>
    </section>
  </aside>
{/if}
