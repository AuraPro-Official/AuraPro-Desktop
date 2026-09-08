<script lang="ts">
  import i18n from '../../i18n'

  let { detecting, failed }: { detecting: boolean; failed: boolean } = $props()
  let showSuccess = $state(false)

  $effect(() => {
    if (detecting || failed) {
      showSuccess = false
      return
    }

    showSuccess = true
    const timeout = setTimeout(() => {
      showSuccess = false
    }, 2000)
    return () => clearTimeout(timeout)
  })
</script>

<div
  class="pointer-events-none fixed inset-0 z-[120] flex items-center justify-center p-4"
  role="status"
  aria-live="polite"
  aria-atomic="true"
>
  {#if detecting || showSuccess}
    <div
      class="flex w-full max-w-sm items-center gap-3 rounded-lg border border-gray-200 bg-white px-5 py-4 text-base font-medium leading-relaxed text-gray-900 shadow-xl dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
    >
      {#if detecting}
        <span
          aria-hidden="true"
          class="size-5 shrink-0 animate-spin rounded-full border-2 border-gray-300 border-t-emerald-600 motion-reduce:animate-none"
        ></span>
      {:else}
        <span aria-hidden="true" class="text-xl text-emerald-600">&#10003;</span>
      {/if}
      <span>
        {$i18n.t(
          detecting ? 'main.getStarted.detectingHardware' : 'main.getStarted.hardwareDetected'
        )}
      </span>
    </div>
  {/if}
</div>
