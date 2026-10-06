<script lang="ts">
  import { onMount } from 'svelte'
  import i18n from '../../../i18n'
  import Switch from '../../common/Switch.svelte'
  import ProProgress from '../../common/ProProgress.svelte'

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
  let uninstalling = $state(false)
  let error = $state('')
  let latest = $state('')
  const contextPresets = [32768, 65536, 131072, 262144]
  let workflow: AbortController | null = null
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
  const startSelected = async (install = false, update = false) => {
    const selected = $state.snapshot(settings)
    const controller = new AbortController()
    workflow = controller
    try {
      if (install || !info?.installed) {
        await window.electronAPI.installStrata(update, selected)
        controller.signal.throwIfAborted()
      }
      await window.electronAPI.prepareStrataModel(selected)
      controller.signal.throwIfAborted()
      await window.electronAPI.startStrata()
      controller.signal.throwIfAborted()
    } finally {
      if (workflow === controller) workflow = null
    }
  }
  const cancel = async () => {
    workflow?.abort()
    try {
      await window.electronAPI.cancelStrataOperation()
    } catch (err) {
      error = String(err)
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
  const commandClass =
    'text-[12px] opacity-40 hover:opacity-70 px-3 py-1.5 bg-black/[0.04] dark:bg-white/[0.06] transition border-none text-[#1d1d1f] dark:text-[#fafafa] rounded-xl disabled:opacity-20 disabled:cursor-not-allowed'
  const controlClass =
    'max-w-full bg-black/[0.04] dark:bg-white/[0.06] text-[12px] text-[#1d1d1f] dark:text-[#fafafa] px-3 py-1.5 border-none outline-none rounded-xl opacity-60'
</script>

{#if !info}
  <div class="py-6 text-[12px] opacity-20 text-center">{$i18n.t('common.loading')}</div>
{:else}
  <div class="flex flex-col divide-y divide-white/[0.04]">
    <div class="py-4">
      <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <div class="text-[13px] opacity-70 flex flex-wrap items-center gap-1.5">
            {info.runtime}
            {info.installed?.version ?? ''}
            <span class="text-[9px] opacity-30 uppercase tracking-wide">
              {$i18n.t('common.experimental')}
            </span>
          </div>
          <div class="text-[11px] opacity-25 mt-0.5 font-mono">127.0.0.1:{info.port}</div>
        </div>
        <div class="flex items-center gap-1.5">
          <div
            class="w-1.5 h-1.5 rounded-full shrink-0 {info.status === 'started'
              ? 'bg-emerald-400'
              : info.status === 'starting' || info.status === 'installing'
                ? 'bg-amber-400/60 animate-pulse'
                : info.status === 'failed'
                  ? 'bg-red-400/70'
                  : 'bg-black/15 dark:bg-white/20'}"
          ></div>
          <span class="text-[12px] opacity-30">{t(info.status)}</span>
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          class={commandClass}
          disabled={working || !info.supported}
          onclick={() =>
            action(() =>
              info?.status === 'started' ? window.electronAPI.stopStrata() : startSelected()
            )}>{t(info.status === 'started' ? 'stop' : 'start')}</button
        >
        <button
          class={commandClass}
          disabled={working || !info.supported}
          onclick={() => action(() => startSelected(true))}>{t('install')}</button
        >
      </div>
      {#if !uninstalling && (working || (info.progress && info.status === 'failed'))}
        <ProProgress progress={info.progress ?? { stage: 'preparing', detail: '' }} />
      {/if}
      {#if error || info.error}<p role="alert" class="mt-3 break-words text-[11px] text-red-400/60">
          {error || info.error}
        </p>{/if}
    </div>
    {#if !info.supported}<p class="py-4 text-[11px] opacity-25">{t('unsupported')}</p>{/if}
    <div class="py-4 flex flex-wrap items-center justify-between gap-3">
      <div class="text-[13px] opacity-70">{$i18n.t('settings.about.softwareUpdate')}</div>
      <div class="flex flex-wrap gap-2">
        <button
          class={commandClass}
          disabled={working || !info.supported}
          onclick={() =>
            action(async () => {
              latest = (await window.electronAPI.checkStrataUpdate()).version
            })}>{t('check')}</button
        >
        {#if latest}
          <button
            class={commandClass}
            disabled={working}
            onclick={() => action(() => startSelected(true, true))}
          >
            {t('update')}
            {latest}
          </button>
        {/if}
      </div>
    </div>
    <fieldset
      disabled={working || !info.supported}
      class="min-w-0 border-none p-0 m-0 disabled:opacity-60"
    >
      <label class="py-4 flex flex-wrap items-center justify-between gap-3"
        ><span class="text-[13px] opacity-70">{t('backend')}</span><select
          class={controlClass}
          bind:value={settings.backend}
          ><option value="auto">{t('auto')}</option>
          {#if info.runtime === 'llama.cpp'}
            <option value="metal">Apple Metal</option><option value="cpu">CPU</option>
          {:else}
            <option value="cuda">NVIDIA CUDA</option><option value="hip">AMD HIP</option>
          {/if}</select
        ></label
      >
      <label class="py-4 flex flex-wrap items-center justify-between gap-3"
        ><span class="text-[13px] opacity-70">{t('model')}</span><select
          class="{controlClass} w-[280px] min-w-0"
          bind:value={settings.model}
          >{#each info.models as model (model.id)}<option value={model.id}>{model.name}</option
            >{/each}</select
        ></label
      >
      <div class="py-4 flex flex-wrap items-center justify-between gap-3">
        <span class="text-[13px] opacity-70">{t('context')}</span>
        <div class="flex flex-wrap items-center gap-2">
          <select
            class={controlClass}
            aria-label={t('context')}
            value={contextPresets.includes(settings.context) ? String(settings.context) : 'custom'}
            onchange={(event) => {
              if (event.currentTarget.value !== 'custom')
                settings.context = Number(event.currentTarget.value)
            }}
          >
            {#each contextPresets as size (size)}<option value={String(size)}>{size / 1024}K</option
              >{/each}
            <option value="custom" disabled>{t('customContext')}</option>
          </select>
          <input
            class="{controlClass} w-24 text-right"
            aria-label={t('customContext')}
            type="number"
            min="2048"
            max="262144"
            step="1"
            bind:value={settings.context}
          />
        </div>
      </div>
      <label class="py-4 flex flex-wrap items-center justify-between gap-3"
        ><span class="text-[13px] opacity-70">{t('cache')}</span><select
          class={controlClass}
          bind:value={settings.kv}
          ><option value="int8">INT8</option><option value="q4_0">Q4_0</option><option value="k8v4"
            >K8V4</option
          ></select
        ></label
      >
      <div class="py-4 flex items-center justify-between gap-4">
        <span class="text-[13px] opacity-70">{t('vision')}</span>
        <fieldset
          disabled={settings.model.startsWith('unsloth-')}
          class="shrink-0 border-none p-0 m-0 disabled:opacity-40"
        >
          <Switch
            checked={settings.vision}
            label={t('vision')}
            onchange={(value) => (settings.vision = value)}
          />
        </fieldset>
      </div>
      {#if info.runtime !== 'llama.cpp'}<div
          class="py-4 flex flex-wrap items-center justify-between gap-3"
        >
          <span class="text-[13px] opacity-70">MTP</span><span class="text-[11px] opacity-25"
            >{t('required')}</span
          >
        </div>{/if}
      <div class="py-4 flex flex-wrap justify-end gap-2">
        <button
          class={commandClass}
          onclick={() =>
            action(() => window.electronAPI.saveStrataSettings($state.snapshot(settings)))}
          >{t('save')}</button
        >
        <button
          class={commandClass}
          disabled={!info.installed}
          onclick={() =>
            action(() => window.electronAPI.prepareStrataModel($state.snapshot(settings)))}
          >{t('prepare')}</button
        >
      </div>
    </fieldset>
    <div class="py-4">
      <h3 class="mb-3 text-[13px] opacity-70">{t('models')}</h3>
      {#each info.models as model (model.id)}
        <div class="flex items-center justify-between gap-3 py-3">
          <div class="min-w-0">
            <div class="break-words text-[13px] opacity-70">{model.name}</div>
            <div class="text-[11px] opacity-25 mt-0.5">
              ~{model.gb} GB · {model.ramInfo}
            </div>
          </div>
          <span class="shrink-0 text-[11px] opacity-30"
            >{t(model.installed ? 'ready' : 'notInstalled')}</span
          >
          {#if model.removable || model.installed}
            <button
              class={commandClass}
              disabled={working}
              onclick={() => {
                if (confirm(t('deleteModelConfirm').replace('{{model}}', model.name)))
                  void action(() => window.electronAPI.deleteStrataModel(model.id))
              }}>{t('deleteModel')}</button
            >
          {/if}
        </div>
      {/each}
    </div>
    {#if info.installed}
      <div class="py-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div class="text-[13px] opacity-70">{t('uninstall')}</div>
          <div class="text-[11px] opacity-25 mt-0.5">{t('uninstallDesc')}</div>
        </div>
        <button
          class={commandClass}
          disabled={working}
          onclick={async () => {
            if (!confirm(t('uninstallConfirm'))) return
            uninstalling = true
            try {
              await action(() => window.electronAPI.uninstallStrata())
              if (info && !info.installed) {
                settings = { ...info.settings }
                latest = ''
              }
            } finally {
              uninstalling = false
            }
          }}>{$i18n.t(uninstalling ? 'common.uninstalling' : 'common.uninstall')}</button
        >
      </div>
    {/if}
    {#if working && !uninstalling}<button class="{commandClass} self-start my-4" onclick={cancel}
        >{t('cancel')}</button
      >{/if}
    {#if info.logs}<details class="py-4">
        <summary class="cursor-pointer text-[12px] opacity-40 hover:opacity-70">{t('logs')}</summary
        >
        <pre
          class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-[11px] opacity-30">{info.logs}</pre>
      </details>{/if}
  </div>
{/if}
