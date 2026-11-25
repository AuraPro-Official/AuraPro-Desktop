<script lang="ts">
  import i18n from '../../i18n'

  let { name, mtp = false }: { name: string; mtp?: boolean } = $props()
  const capabilities = $derived([
    'image',
    'video',
    ...(name === 'low_E4.gguf' ? ['audio'] : []),
    ...(mtp ? ['mtp'] : [])
  ])
</script>

<div class="mt-1 flex flex-wrap gap-1">
  {#each capabilities as capability (capability)}
    <span
      class="rounded border border-gray-200 px-1.5 py-px text-[9px] text-gray-600 dark:border-gray-700 dark:text-gray-400"
    >
      {capability === 'mtp' ? 'MTP' : $i18n.t('settings.models.capability.' + capability)}
    </span>
  {/each}
</div>
