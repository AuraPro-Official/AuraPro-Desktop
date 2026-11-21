<script lang="ts">
  import { onMount } from 'svelte'
  import i18n from '../../../i18n'

  interface Language {
    code: string
    asr: boolean
    tts: boolean
  }
  interface Props {
    getSpeechRepairGuestId: () => number
    running?: boolean
    onClose: () => void
    onComplete: () => void
  }

  let { getSpeechRepairGuestId, running = $bindable(false), onClose, onComplete }: Props = $props()
  let dialog: HTMLDialogElement
  let languages = $state<Language[]>([])
  let selected = $state<string[]>([])
  let defaults = $state<string[]>([])
  let otherLanguages = $state(false)
  let loaded = $state(false)
  let done = $state(false)
  let errorKey = $state('')
  let detail = $state('')
  let runtimeReady = $state(false)
  let step = $state('checking')
  let activity = $state('')
  let limited = $state<string[]>([])

  const languageName = (code: string): string => {
    try {
      return new Intl.DisplayNames([$i18n.language || 'en'], { type: 'language' }).of(code) || code
    } catch {
      return code
    }
  }
  const visibleLanguages = $derived(
    languages.filter(
      ({ code }) => otherLanguages || defaults.includes(code) || selected.includes(code)
    )
  )

  onMount(() => {
    dialog.showModal()
    let mounted = true
    const detach = window.electronAPI.onData(({ type, data }) => {
      if (type === 'speech:repair-progress' && running && data && typeof data === 'object') {
        const update = data as { step?: string; detail?: string }
        if (update.step) step = update.step
        activity = update.detail || ''
      }
    })
    void window.electronAPI
      .getSpeechRepairOptions()
      .then((options) => {
        if (!mounted) return
        defaults = options.defaults
        languages = options.languages.sort(
          (a: Language, b: Language) =>
            Number(defaults.includes(b.code)) - Number(defaults.includes(a.code)) ||
            languageName(a.code).localeCompare(languageName(b.code))
        )
        selected = defaults.filter((code) =>
          languages.some((item) => item.code === code && (item.asr || item.tts))
        )
        loaded = true
      })
      .catch(() => {
        if (mounted) errorKey = 'optionsFailed'
      })
    return () => {
      mounted = false
      detach?.()
    }
  })

  const repair = async () => {
    const guestId = getSpeechRepairGuestId()
    detail = ''
    errorKey = ''
    runtimeReady = false
    if (!guestId) {
      errorKey = 'openLocal'
      return
    }
    running = true
    step = 'checking'
    activity = ''
    try {
      const result = await window.electronAPI.repairSpeech(guestId, $state.snapshot(selected))
      if (result.ok) {
        limited = result.limitedAsrLanguages
        done = true
        onComplete()
      } else {
        errorKey = result.code
        detail = result.detail || ''
        runtimeReady = result.runtimeReady ?? false
      }
    } catch {
      errorKey = 'sherpaFailed'
    } finally {
      running = false
    }
  }
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="speech-repair-title"
  oncancel={(event) => {
    event.preventDefault()
    if (!running) onClose()
  }}
  class="fixed inset-0 m-auto w-[min(520px,calc(100%-2rem))] max-w-none max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-lg border border-black/10 bg-white text-[#1d1d1f] shadow-xl backdrop:bg-black/35 dark:border-white/10 dark:bg-[#171719] dark:text-[#fafafa]"
>
  <header class="px-5 pt-4">
    <h2 id="speech-repair-title" class="text-sm font-semibold">{$i18n.t('speechRepair.title')}</h2>
  </header>
  <div class="space-y-3 px-5 py-3 text-xs">
    {#if done}
      <p class="text-emerald-700 dark:text-emerald-400" role="status">
        {$i18n.t('speechRepair.success')}
      </p>
      {#if limited.length}
        <p class="text-amber-700 dark:text-amber-300">
          {$i18n.t('speechRepair.limited', { languages: limited.map(languageName).join(', ') })}
        </p>
      {/if}
    {:else}
      <p class="leading-relaxed opacity-70">{$i18n.t('speechRepair.description')}</p>
      {#if loaded}
        <fieldset disabled={running}>
          <legend class="font-medium">{$i18n.t('speechRepair.languages')}</legend>
          <div
            class="mt-2 grid max-h-[min(38dvh,280px)] grid-cols-1 gap-x-4 overflow-y-auto sm:grid-cols-2"
          >
            {#each visibleLanguages as language (language.code)}
              <label
                class="flex min-w-0 items-start gap-2 border-b border-black/5 py-1.5 dark:border-white/5"
              >
                <input
                  type="checkbox"
                  value={language.code}
                  bind:group={selected}
                  disabled={language.code === 'zh' || !(language.asr || language.tts)}
                  class="mt-0.5 shrink-0"
                />
                <span class="min-w-0 break-words">
                  {languageName(language.code)}
                  <span class="block text-[11px] opacity-55">
                    {language.code === 'zh'
                      ? $i18n.t('speechRepair.required')
                      : [
                          language.asr && $i18n.t('speechRepair.stt'),
                          language.tts && $i18n.t('speechRepair.tts')
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                  </span>
                </span>
              </label>
            {/each}
          </div>
          <button
            type="button"
            class="mt-1 rounded px-1.5 py-1 underline underline-offset-2 opacity-75 hover:opacity-100"
            aria-expanded={otherLanguages}
            onclick={() => (otherLanguages = !otherLanguages)}
          >
            {$i18n.t(otherLanguages ? 'speechRepair.showSelected' : 'speechRepair.moreLanguages')}
          </button>
        </fieldset>
      {:else if !errorKey}
        <p class="opacity-65" role="status">{$i18n.t('speechRepair.loading')}</p>
      {/if}

      {#if running}
        <div class="min-h-9 break-words rounded-md bg-black/5 p-2 dark:bg-white/5" role="status">
          <div class="font-medium">{$i18n.t(`speechRepair.steps.${step}`)}</div>
          {#if activity}<div class="mt-0.5 line-clamp-2 opacity-65">{activity}</div>{/if}
        </div>
      {/if}
      {#if errorKey}
        <div
          class="break-words rounded-md bg-red-500/10 p-2 text-red-800 dark:text-red-300"
          role="alert"
        >
          <div>{$i18n.t(`speechRepair.errors.${errorKey}`)}</div>
          {#if runtimeReady}<div>{$i18n.t('speechRepair.runtimeReady')}</div>{/if}
          {#if detail}<div class="mt-1 opacity-75">{detail}</div>{/if}
        </div>
      {/if}
    {/if}
  </div>
  <footer
    class="flex flex-wrap justify-end gap-2 border-t border-black/10 px-5 py-3 text-xs dark:border-white/10"
  >
    <button
      type="button"
      disabled={running}
      onclick={onClose}
      class="rounded-md px-3 py-2 hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10"
    >
      {$i18n.t(done ? 'common.close' : 'common.cancel')}
    </button>
    {#if !done}
      <button
        type="button"
        disabled={running || !loaded}
        onclick={repair}
        class="rounded-md bg-[#1d1d1f] px-3 py-2 font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
      >
        {$i18n.t('speechRepair.start')}
      </button>
    {/if}
  </footer>
</dialog>
