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
  <div class="settings-sections">
    <section class="py-4">
      <div class="flex items-start justify-between gap-4">
        <div>
          <div class="settings-label">Agent</div>
          <div class="mt-0.5 settings-detail">
            Agent 执行核心与扩展在本机运行。任务、模型配置、确认和结果都在 WebUI 中操作。
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
          <span class="settings-detail">
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
          class="mt-3 rounded-md bg-black/[0.035] px-3 py-2 settings-detail dark:bg-white/[0.05]"
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
          <button class="settings-button" disabled={action !== null} onclick={install}>
            {action === 'install' ? $i18n.t('common.installing') : $i18n.t('common.install')}
          </button>
        {:else}
          {#if isRunning}
            <button
              class="settings-button"
              disabled={action !== null}
              onclick={() => runAction('stop', () => window.electronAPI.stopOpenCode())}
            >
              {action === 'stop' ? $i18n.t('common.stopping') : $i18n.t('common.stop')}
            </button>
            <button class="settings-button" disabled={action !== null} onclick={restart}>
              {action === 'restart' ? $i18n.t('common.restarting') : $i18n.t('common.restart')}
            </button>
          {:else}
            <button
              class="settings-button"
              disabled={action !== null}
              onclick={() => runAction('start', () => window.electronAPI.startOpenCode())}
            >
              {action === 'start' ? $i18n.t('common.starting') : $i18n.t('common.start')}
            </button>
          {/if}
          <button
            class="settings-button"
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
            <div class="settings-label">启动时启用</div>
            <div class="mt-0.5 settings-detail">打开 AuraPro 后允许 WebUI 启动 Agent 任务。</div>
          </div>
          <Switch
            checked={$config?.openCode?.enabled ?? false}
            label="启动时启用 Agent"
            onchange={(value) => updateConfig('enabled', value)}
          />
        </div>
      </section>

      <section class="space-y-4 py-4">
        <label class="flex items-center justify-between gap-4">
          <span>
            <span class="block settings-label">{$i18n.t('settings.opencode.version')}</span>
            <span class="mt-0.5 block settings-detail">
              使用经过验证的固定发行版本，默认 1.0.3。
            </span>
          </span>
          <input
            class="settings-field w-28 text-right font-mono"
            value={$config?.openCode?.version ?? '1.0.3'}
            placeholder="1.0.3"
            onchange={(event) =>
              updateConfig('version', event.currentTarget.value.trim() || '1.0.3')}
          />
        </label>

        <div class="flex items-center justify-between gap-4">
          <div class="min-w-0">
            <div class="settings-label">
              {$i18n.t('settings.opencode.workingDirectory')}
            </div>
            <div class="mt-0.5 truncate settings-detail">
              {$config?.openCode?.cwd || $i18n.t('settings.opencode.homeDirectory')}
            </div>
          </div>
          <button
            class="shrink-0 settings-button"
            onclick={async () => {
              const folder = await window.electronAPI.selectFolder()
              if (folder) await updateConfig('cwd', folder)
            }}
          >
            {$i18n.t('common.browse')}
          </button>
        </div>
      </section>

      <section class="py-4 settings-detail">
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
          <div class="settings-label">卸载 Agent 运行时</div>
          <div class="mt-0.5 settings-detail">保留模型配置、扩展和会话记录。</div>
        </div>
        <button
          class="settings-button bg-red-500/10 text-red-600 dark:text-red-300"
          disabled={action !== null}
          onclick={() => {
            if (confirm('卸载 AuraPro 管理的 Agent 运行时？')) {
              void runAction('uninstall', () => window.electronAPI.uninstallOpenCode())
            }
          }}
        >
          {action === 'uninstall' ? $i18n.t('common.uninstalling') : $i18n.t('common.uninstall')}
        </button>
      </section>
      <section class="space-y-3 py-4">
        <div class="settings-label">Agent 扩展</div>
        <div class="settings-detail">
          安装成功后，在 WebUI 的 Agent
          设置中执行功能检查。检查通过后再使用。已有会话需要重置后加载新扩展。
        </div>
        {#each extensions as extension (extension.id)}
          <div class="settings-divider border-t py-3">
            <div class="flex items-center justify-between gap-3">
              <span class="settings-label">{extension.name}</span>
              <button
                class="settings-button"
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
            <div class="mt-1 settings-detail">{extension.description}</div>
            <div class="mt-1 break-all settings-detail">
              {extension.state === 'not_installed' ? '未安装' : extension.detail}
            </div>
          </div>
        {/each}
      </section>
    {/if}
  </div>
{/if}
