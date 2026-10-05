<script lang="ts">
  import { onMount } from 'svelte'
  import i18n from '../../../i18n'

  type Info = Awaited<ReturnType<typeof window.electronAPI.getStrataInfo>>
  let info = $state<Info | null>(null)
  let settings = $state<Info['settings']>({
    model: 'qwen-iq2_xs',
    backend: 'auto',
    context: 32768,
    kv: 'int8',
    vision: false
  })
  let busy = $state(false)
  let error = $state('')
  let latest = $state('')
  const t = (key: string) => $i18n.t(`settings.pro.${key}`)
  const refresh = async () => {
    info = await window.electronAPI.getStrataInfo()
  }
  const action = async (fn: () => Promise<unknown>) => {
    busy = true
    error = ''
    try {
      await fn()
      await refresh()
    } catch (err) {
      error = String(err)
    } finally {
      busy = false
    }
  }
  onMount(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async (initial = false) => {
      try {
        const next = await window.electronAPI.getStrataInfo()
        if (!alive) return
        info = next
        if (initial) settings = { ...next.settings }
      } catch (err) {
        if (alive) error = String(err)
      }
      if (alive) timer = setTimeout(() => void poll(), 1500)
    }
    void poll(true)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  })
  const working = $derived(busy || info?.status === 'installing' || info?.status === 'starting')
</script>

<div class="space-y-5 py-2 text-sm">
  <h2 class="font-medium">{t('title')}</h2>
  {#if info}
    <div
      class="flex flex-wrap items-center justify-between gap-3 border-b border-black/10 pb-4 dark:border-white/10"
    >
      <div class="space-y-1">
        <div>Strata {info.installed?.version ?? ''}</div>
        <div class="text-xs opacity-60">{t(info.status)} · 127.0.0.1:{info.port}</div>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          class="command"
          disabled={working || !info.supported}
          onclick={() =>
            action(() => window.electronAPI.installStrata(false, $state.snapshot(settings)))}
          >{t('install')}</button
        >
        <button
          class="command"
          disabled={working || !info.supported}
          onclick={() =>
            action(async () => {
              latest = (await window.electronAPI.checkStrataUpdate()).version
            })}>{t('check')}</button
        >
        {#if latest}<button
            class="command"
            disabled={working}
            onclick={() =>
              action(() => window.electronAPI.installStrata(true, $state.snapshot(settings)))}
            >{t('update')} {latest}</button
          >{/if}
        <button
          class="command"
          disabled={working || !info.installed}
          onclick={() =>
            action(() =>
              info?.status === 'started'
                ? window.electronAPI.stopStrata()
                : window.electronAPI.startStrata()
            )}>{t(info.status === 'started' ? 'stop' : 'start')}</button
        >
      </div>
    </div>
    {#if !info.supported}<p class="text-xs opacity-70">{t('unsupported')}</p>{/if}
    <fieldset disabled={working || !info.supported} class="space-y-4 disabled:opacity-60">
      <label class="field"
        ><span>{t('backend')}</span><select bind:value={settings.backend}
          ><option value="auto">{t('auto')}</option><option value="cuda">NVIDIA CUDA</option><option
            value="hip">AMD HIP</option
          ></select
        ></label
      >
      <label class="field"
        ><span>{t('model')}</span><select bind:value={settings.model}
          >{#each info.models as model (model.id)}<option value={model.id}
              >{model.name}{model.experimental ? ` (${t('experimental')})` : ''}</option
            >{/each}</select
        ></label
      >
      <label class="field"
        ><span>{t('context')}</span><input
          type="number"
          min="2048"
          max="262144"
          step="1"
          bind:value={settings.context}
        /></label
      >
      <label class="field"
        ><span>{t('cache')}</span><select bind:value={settings.kv}
          ><option value="int8">INT8</option><option value="q4_0">Q4_0</option><option value="k8v4"
            >K8V4</option
          ></select
        ></label
      >
      <label class="field"
        ><span>{t('vision')}</span><input
          type="checkbox"
          bind:checked={settings.vision}
          disabled={settings.model.startsWith('unsloth-')}
        /></label
      >
      <div class="field">
        <span>MTP</span><span class="text-xs opacity-60">{t('required')}</span>
      </div>
      <div class="flex flex-wrap justify-end gap-2">
        <button
          class="command"
          onclick={() =>
            action(() => window.electronAPI.saveStrataSettings($state.snapshot(settings)))}
          >{t('save')}</button
        >
        <button
          class="command"
          disabled={!info.installed}
          onclick={() =>
            action(() => window.electronAPI.prepareStrataModel($state.snapshot(settings)))}
          >{t('prepare')}</button
        >
      </div>
    </fieldset>
    <div class="border-t border-black/10 pt-4 dark:border-white/10">
      <h3 class="mb-3 font-medium">{t('models')}</h3>
      {#each info.models as model (model.id)}
        <div class="flex items-center justify-between gap-3 py-2">
          <div class="min-w-0">
            <div class="break-words">{model.name}</div>
            <div class="text-xs opacity-50">
              ~{model.gb} GB · {model.ramInfo}{model.experimental ? ` · ${t('experimental')}` : ''}
            </div>
          </div>
          <span class="shrink-0 text-xs opacity-60"
            >{t(model.installed ? 'ready' : 'notInstalled')}</span
          >
        </div>
      {/each}
    </div>
    {#if info.status === 'installing' || info.status === 'starting'}<button
        class="command"
        onclick={() => action(() => window.electronAPI.cancelStrataOperation())}
        >{t('cancel')}</button
      >{/if}
    {#if error || info.error}<p role="alert" class="break-words text-red-600">
        {error || info.error}
      </p>{/if}
    {#if info.logs}<details>
        <summary class="cursor-pointer opacity-60">{t('logs')}</summary>
        <pre
          class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{info.logs}</pre>
      </details>{/if}
  {/if}
</div>

<style>
  .field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }
  select,
  input[type='number'] {
    max-width: 100%;
    min-width: 120px;
    border: 1px solid #8884;
    border-radius: 6px;
    padding: 6px 8px;
    background: transparent;
  }
  select {
    max-width: min(100%, 340px);
  }
  .command {
    border: 1px solid #8884;
    border-radius: 6px;
    padding: 6px 10px;
  }
  .command:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .command:not(:disabled):hover {
    background: #8881;
  }
</style>
