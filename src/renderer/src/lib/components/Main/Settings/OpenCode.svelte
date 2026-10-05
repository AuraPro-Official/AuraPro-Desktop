<script lang="ts">
  import { onMount } from 'svelte'
  import i18n from '../../../i18n'
  import { config } from '../../../stores'
  import Switch from '../../common/Switch.svelte'

  type OpenCodeInfo = {
    url: string | null
    status: string | null
    pid: number | null
    binaryPath: string | null
    version: string | null
    username: string
  }

  let info = $state<OpenCodeInfo | null>(null)
  let installed = $state(false)
  let loaded = $state(false)
  let action = $state<'install' | 'start' | 'stop' | 'restart' | 'update' | 'uninstall' | null>(
    null
  )
  let progress = $state('')
  let error = $state('')
  type PiExtension = {
    id: string
    name: string
    description: string
    installed: boolean
    state: string
    detail: string
  }
  let extensions = $state<PiExtension[]>([])
  let extensionBusy = $state(false)

  const isRunning = $derived(info?.status === 'started')

  const refresh = async () => {
    ;[installed, info] = await Promise.all([
      window.electronAPI.getOpenCodeStatus(),
      window.electronAPI.getOpenCodeInfo()
    ])
    extensions = await window.electronAPI.getPiExtensions()
  }

  onMount(() => {
    const unsubscribe = window.electronAPI.onData<{ type?: string; data?: unknown }>((event) => {
      if (event.type === 'status:opencode') {
        if (info) info = { ...info, status: String(event.data ?? '') || null }
        else void refresh()
      } else if (event.type === 'status:opencode-setup') {
        progress = String(event.data ?? '')
      } else if (event.type === 'opencode:ready' || event.type === 'opencode:installed') {
        void refresh()
      }
    })
    void refresh().finally(() => {
      loaded = true
    })
    return unsubscribe
  })

  const updateConfig = async (key: string, value: unknown) => {
    const openCode = { ...($config?.openCode ?? {}), [key]: value }
    await window.electronAPI.setConfig({ openCode })
    config.set(await window.electronAPI.getConfig())
  }

  const runAction = async (name: NonNullable<typeof action>, operation: () => Promise<unknown>) => {
    action = name
    error = ''
    try {
      await operation()
      await refresh()
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      action = null
    }
  }

  const install = () =>
    runAction('install', async () => {
      await window.electronAPI.installOpenCode()
      installed = true
      await window.electronAPI.startOpenCode()
    })

  const restart = () =>
    runAction('restart', async () => {
      await window.electronAPI.stopOpenCode()
      await window.electronAPI.startOpenCode()
    })
</script>

{#if !loaded}
  <div class="py-6 text-center text-[12px] opacity-30">{$i18n.t('common.loading')}</div>
{:else}
  <div class="flex flex-col divide-y divide-black/[0.05] dark:divide-white/[0.05]">
    <section class="py-4">
      <div class="flex items-start justify-between gap-4">
        <div>
          <div class="text-[13px] font-medium opacity-80">PI Agent</div>
          <div class="mt-1 text-[11px] leading-5 opacity-35">
            PI 执行核心与扩展在本机运行。任务、模型配置、确认和结果都在 WebUI 中操作。
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          <span
            class="h-1.5 w-1.5 rounded-full {isRunning
              ? 'bg-emerald-500'
              : info?.status === 'failed'
                ? 'bg-red-500'
                : 'bg-black/20 dark:bg-white/25'}"
          ></span>
          <span class="text-[11px] opacity-45">
            {isRunning
              ? $i18n.t('common.running')
              : info?.status === 'failed'
                ? $i18n.t('common.failed')
                : $i18n.t('common.stopped')}
          </span>
        </div>
      </div>

      {#if progress}
        <div
          class="mt-3 rounded-md bg-black/[0.035] px-3 py-2 text-[11px] opacity-55 dark:bg-white/[0.05]"
        >
          {progress}
        </div>
      {/if}
      {#if error}
        <div
          class="mt-3 rounded-md bg-red-500/10 px-3 py-2 text-[11px] text-red-600 dark:text-red-300"
        >
          {error}
        </div>
      {/if}

      <div class="mt-3 flex flex-wrap gap-2">
        {#if !installed}
          <button
            class="rounded-md border-0 bg-black px-3 py-1.5 text-[12px] text-white disabled:opacity-35 dark:bg-white dark:text-black"
            disabled={action !== null}
            onclick={install}
          >
            {action === 'install' ? $i18n.t('common.installing') : $i18n.t('common.install')}
          </button>
        {:else}
          {#if isRunning}
            <button
              class="rounded-md border-0 bg-black/[0.05] px-3 py-1.5 text-[12px] opacity-60 hover:opacity-90 dark:bg-white/[0.08]"
              disabled={action !== null}
              onclick={() => runAction('stop', () => window.electronAPI.stopOpenCode())}
            >
              {action === 'stop' ? $i18n.t('common.stopping') : $i18n.t('common.stop')}
            </button>
            <button
              class="rounded-md border-0 bg-black/[0.05] px-3 py-1.5 text-[12px] opacity-60 hover:opacity-90 dark:bg-white/[0.08]"
              disabled={action !== null}
              onclick={restart}
            >
              {action === 'restart' ? $i18n.t('common.restarting') : $i18n.t('common.restart')}
            </button>
          {:else}
            <button
              class="rounded-md border-0 bg-black px-3 py-1.5 text-[12px] text-white disabled:opacity-35 dark:bg-white dark:text-black"
              disabled={action !== null}
              onclick={() => runAction('start', () => window.electronAPI.startOpenCode())}
            >
              {action === 'start' ? $i18n.t('common.starting') : $i18n.t('common.start')}
            </button>
          {/if}
          <button
            class="rounded-md border-0 bg-black/[0.05] px-3 py-1.5 text-[12px] opacity-60 hover:opacity-90 dark:bg-white/[0.08]"
            disabled={action !== null}
            onclick={() => runAction('update', () => window.electronAPI.updateOpenCode())}
          >
            {action === 'update' ? $i18n.t('common.updating') : $i18n.t('common.update')}
          </button>
        {/if}
      </div>
    </section>

    {#if installed}
      <section class="py-4">
        <div class="flex items-center justify-between gap-4">
          <div>
            <div class="text-[13px] opacity-70">启动时启用</div>
            <div class="mt-0.5 text-[11px] opacity-30">
              打开 AuraPro 后允许 WebUI 启动 PI 任务。
            </div>
          </div>
          <Switch
            checked={$config?.openCode?.enabled ?? false}
            label="启动时启用 PI"
            onchange={(value) => updateConfig('enabled', value)}
          />
        </div>
      </section>

      <section class="space-y-4 py-4">
        <label class="flex items-center justify-between gap-4">
          <span>
            <span class="block text-[13px] opacity-70">{$i18n.t('settings.opencode.version')}</span>
            <span class="mt-0.5 block text-[11px] opacity-30">
              使用经过验证的固定发行版本，默认 1.0.3。
            </span>
          </span>
          <input
            class="w-28 rounded-md border-0 bg-black/[0.04] px-3 py-1.5 text-right font-mono text-[12px] outline-none dark:bg-white/[0.06]"
            value={$config?.openCode?.version ?? '1.0.3'}
            placeholder="1.0.3"
            onchange={(event) =>
              updateConfig('version', event.currentTarget.value.trim() || '1.0.3')}
          />
        </label>

        <div class="flex items-center justify-between gap-4">
          <div class="min-w-0">
            <div class="text-[13px] opacity-70">
              {$i18n.t('settings.opencode.workingDirectory')}
            </div>
            <div class="mt-0.5 truncate text-[11px] opacity-30">
              {$config?.openCode?.cwd || $i18n.t('settings.opencode.homeDirectory')}
            </div>
          </div>
          <button
            class="shrink-0 rounded-md border-0 bg-black/[0.05] px-3 py-1.5 text-[12px] opacity-60 hover:opacity-90 dark:bg-white/[0.08]"
            onclick={async () => {
              const folder = await window.electronAPI.selectFolder()
              if (folder) await updateConfig('cwd', folder)
            }}
          >
            {$i18n.t('common.browse')}
          </button>
        </div>
      </section>

      <section class="py-4 text-[11px] opacity-45">
        <div class="flex justify-between">
          <span>{$i18n.t('common.version')}</span><span>{info?.version ?? '-'}</span>
        </div>
        {#if info?.pid}
          <div class="mt-2 flex justify-between">
            <span>PID</span><span class="font-mono">{info.pid}</span>
          </div>
        {/if}
      </section>

      <section class="flex items-center justify-between gap-4 py-4">
        <div>
          <div class="text-[13px] opacity-70">卸载 PI 运行时</div>
          <div class="mt-0.5 text-[11px] opacity-30">保留模型配置、扩展和会话记录。</div>
        </div>
        <button
          class="rounded-md border-0 bg-red-500/10 px-3 py-1.5 text-[12px] text-red-600 disabled:opacity-35 dark:text-red-300"
          disabled={action !== null}
          onclick={() => {
            if (confirm('卸载 AuraPro 管理的 PI 运行时？')) {
              void runAction('uninstall', () => window.electronAPI.uninstallOpenCode())
            }
          }}
        >
          {action === 'uninstall' ? $i18n.t('common.uninstalling') : $i18n.t('common.uninstall')}
        </button>
      </section>
      <section class="space-y-3 py-4">
        <div class="text-[13px] opacity-80">PI 扩展</div>
        <div class="text-[11px] opacity-45">
          安装成功后，在 WebUI 的 PI Agent
          设置中执行功能检查。检查通过后再使用。已有会话需要重置后加载新扩展。
        </div>
        {#each extensions as extension (extension.id)}
          <div class="rounded-lg border border-black/10 p-3 dark:border-white/10">
            <div class="flex items-center justify-between gap-3">
              <span class="text-[12px] font-medium">{extension.name}</span>
              <button
                class="rounded border px-2 py-1 text-[11px] disabled:opacity-40"
                disabled={extensionBusy || action !== null}
                onclick={async () => {
                  extensionBusy = true
                  error = ''
                  try {
                    extensions = await window.electronAPI.managePiExtension(
                      extension.id,
                      extension.installed ? 'remove' : 'install'
                    )
                  } catch (cause) {
                    error = String(cause)
                    extensions = await window.electronAPI.getPiExtensions()
                  } finally {
                    extensionBusy = false
                    progress = ''
                  }
                }}>{extension.installed ? '移除' : '安装'}</button
              >
            </div>
            <div class="mt-1 text-[11px] opacity-50">{extension.description}</div>
            <div class="mt-1 break-all text-[11px] opacity-50">
              {extension.state === 'not_installed' ? '未安装' : extension.detail}
            </div>
          </div>
        {/each}
      </section>
    {/if}
  </div>
{/if}
