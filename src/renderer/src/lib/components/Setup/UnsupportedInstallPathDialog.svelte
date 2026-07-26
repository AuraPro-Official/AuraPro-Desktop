<script lang="ts">
  import { fade, scale } from 'svelte/transition'
  import i18n from '../../i18n'

  interface Props {
    path: string
    onChange: () => void | Promise<void>
    onCancel: () => void
  }

  let { path, onChange, onCancel }: Props = $props()
</script>

<div
  class="fixed inset-0 z-[220] flex items-center justify-center p-4"
  role="dialog"
  aria-modal="true"
  aria-labelledby="unsupported-install-path-title"
  transition:fade={{ duration: 120 }}
>
  <button
    type="button"
    class="absolute inset-0 border-none bg-black/55"
    aria-label={$i18n.t('common.cancel')}
    onclick={onCancel}
  ></button>

  <div
    class="relative w-full max-w-[440px] overflow-hidden rounded-lg bg-white text-[#1d1d1f] shadow-2xl dark:bg-[#171719] dark:text-[#fafafa]"
    transition:scale={{ start: 0.98, duration: 150 }}
  >
    <div class="flex items-start gap-3 px-5 py-5">
      <div
        class="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-sm font-semibold text-amber-600 dark:text-amber-400"
      >
        !
      </div>
      <div class="min-w-0">
        <h2 id="unsupported-install-path-title" class="text-[14px] font-medium">
          {$i18n.t('setup.install.unsupportedPathTitle')}
        </h2>
        <p class="mt-2 text-[11px] leading-relaxed opacity-55">
          {$i18n.t('setup.install.unsupportedPathMessage')}
        </p>
      </div>
    </div>

    <div class="border-y border-black/[0.06] px-5 py-3 dark:border-white/[0.08]">
      <div class="text-[10px] opacity-35">{$i18n.t('setup.install.currentPath')}</div>
      <div class="mt-1 break-all font-mono text-[11px] opacity-65">{path}</div>
      <div class="mt-2 font-mono text-[10px] opacity-35">D:\AuraProData</div>
    </div>

    <div class="flex items-center justify-end gap-2 px-5 py-4">
      <button
        type="button"
        class="rounded-md border border-black/10 bg-transparent px-3.5 py-2 text-[11px] opacity-60 transition hover:opacity-90 dark:border-white/10"
        onclick={onCancel}
      >
        {$i18n.t('common.cancel')}
      </button>
      <button
        type="button"
        class="rounded-md border-none bg-[#1d1d1f] px-3.5 py-2 text-[11px] font-medium text-white transition hover:bg-black dark:bg-white dark:text-black dark:hover:bg-gray-100"
        onclick={onChange}
      >
        {$i18n.t('setup.install.chooseCompatiblePath')}
      </button>
    </div>
  </div>
</div>
