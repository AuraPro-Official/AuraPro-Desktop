<script lang="ts">
  import i18n from '../../i18n'

  type Progress = NonNullable<
    Awaited<ReturnType<typeof window.electronAPI.getStrataInfo>>['progress']
  >
  let { progress }: { progress: Progress } = $props()
  const labels: Record<string, string> = {
    preparing: 'Preparing Pro',
    source: 'Downloading Pro source',
    extracting: 'Extracting Pro',
    environment: 'Creating Python environment',
    dependencies: 'Installing Python dependencies',
    runtime: 'Downloading and preparing runtime',
    cuda: 'Installing CUDA libraries',
    model: 'Downloading and preparing model',
    starting: 'Loading model',
    complete: 'Complete',
    cancelled: 'Cancelled',
    failed: 'Failed'
  }
  const percent = $derived(
    progress.totalBytes
      ? Math.min(100, ((progress.downloadedBytes ?? 0) / progress.totalBytes) * 100)
      : undefined
  )
  const megabytes = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(1)} MB`
</script>

<div role="status" class="w-full min-w-0 py-3 text-left">
  <div class="flex flex-wrap justify-between gap-2 text-[12px] opacity-60">
    <span
      >{$i18n.t(`settings.pro.progress.${progress.stage}`, {
        defaultValue: labels[progress.stage] ?? progress.stage
      })}</span
    >
    {#if progress.downloadedBytes !== undefined}
      <span class="font-mono text-[11px]">
        {megabytes(progress.downloadedBytes)}{progress.totalBytes
          ? ` / ${megabytes(progress.totalBytes)} (${percent!.toFixed(1)}%)`
          : ''}
      </span>
    {/if}
  </div>
  {#if !['complete', 'cancelled', 'failed'].includes(progress.stage)}
    <progress class="mt-2 h-1 w-full accent-emerald-500" max="100" value={percent}></progress>
  {/if}
  {#if progress.detail}
    <div
      class="mt-2 max-h-20 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] opacity-40"
    >
      {progress.detail}
    </div>
  {/if}
</div>
