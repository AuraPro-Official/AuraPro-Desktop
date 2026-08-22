<script lang="ts">
  import { fade } from 'svelte/transition'
  import i18n from '../../../i18n'
  import { tooltip } from '../../../actions/tooltip'
  import { appInfo } from '../../../stores'
  import appIcon from '../../../../../../../resources/icon.png'

  interface Props {
    serverStatus: string | undefined
    serverReachable: boolean | undefined
    openTerminalStatus: string | null
    openCodeStatus: string | null
    llamaCppStatus: string | null
    sherpaStatus: string | null
    openWebuiInstalled: boolean
    openTerminalInstalled: boolean
    openCodeInstalled: boolean
    llamaCppInstalled: boolean
    sherpaInstalled: boolean
    activeLog: string | null
    onSelectLog: (log: string) => void
    onStartServer: () => void
    onToggleOpenTerminal: () => void
    onToggleOpenCode: () => void
    onToggleLlamaCpp: () => void
    onToggleSherpa: () => void
    onOpenSettings: (tab?: string) => void
    onPrepareDiagnostics: () => Promise<unknown>
  }

  let {
    serverStatus,
    serverReachable,
    openTerminalStatus,
    openCodeStatus,
    llamaCppStatus,
    sherpaStatus,
    openWebuiInstalled,
    openTerminalInstalled,
    openCodeInstalled,
    llamaCppInstalled,
    sherpaInstalled,
    activeLog,
    onSelectLog,
    onStartServer,
    onToggleOpenTerminal,
    onToggleOpenCode,
    onToggleLlamaCpp,
    onToggleSherpa,
    onOpenSettings,
    onPrepareDiagnostics
  }: Props = $props()

  // Derived server state
  const serverRunning = $derived(serverStatus === 'started' && serverReachable)
  const serverStarting = $derived(
    serverStatus === 'starting' || (serverStatus === 'started' && !serverReachable)
  )

  const otRunning = $derived(openTerminalStatus === 'started')
  const otStarting = $derived(
    openTerminalStatus === 'starting' || openTerminalStatus === 'stopping'
  )
  const otFailed = $derived(openTerminalStatus === 'failed')

  const openCodeRunning = $derived(openCodeStatus === 'started')
  const openCodeStarting = $derived(
    openCodeStatus === 'starting' ||
      openCodeStatus === 'installing' ||
      openCodeStatus === 'stopping'
  )
  const openCodeFailed = $derived(openCodeStatus === 'failed')

  const lsRunning = $derived(llamaCppStatus === 'started')
  const lsStarting = $derived(
    llamaCppStatus === 'starting' ||
      llamaCppStatus === 'setting-up' ||
      llamaCppStatus === 'stopping'
  )
  const lsFailed = $derived(llamaCppStatus === 'failed')

  const sherpaRunning = $derived(sherpaStatus === 'started')
  const sherpaStarting = $derived(sherpaStatus === 'starting' || sherpaStatus === 'stopping')
  const sherpaFailed = $derived(sherpaStatus === 'failed')

  // Derived visibility — show each section only when installed or active
  const statusShouldShow = (status: string | null) => Boolean(status && status !== 'stopped')
  const showServer = $derived(openWebuiInstalled || !!serverStatus)
  const showTerminal = $derived(openTerminalInstalled || statusShouldShow(openTerminalStatus))
  const showOpenCode = $derived(openCodeInstalled || statusShouldShow(openCodeStatus))
  const showLlama = $derived(llamaCppInstalled || !!llamaCppStatus)
  const showSherpa = $derived(sherpaInstalled || statusShouldShow(sherpaStatus))
  const isChinese = $derived(($i18n.language ?? '').toLowerCase().startsWith('zh'))
  let diagnosing = $state(false)

  const runDiagnostics = async (): Promise<void> => {
    if (diagnosing) return
    diagnosing = true
    try {
      await onPrepareDiagnostics()
      await window.electronAPI.diagnoseLlamaCpp()
    } catch (error) {
      console.error('Failed to run local inference diagnostics:', error)
    } finally {
      diagnosing = false
    }
  }
</script>

<div
  class="shrink-0 flex items-center gap-1 px-3 h-7 border-t border-black/[0.08] dark:border-white/[0.08] bg-[#ebebed] dark:bg-[#111111]"
  in:fade={{ duration: 150 }}
>
  <button
    type="button"
    class="flex h-6 w-6 shrink-0 items-center justify-center border-none bg-transparent p-0 opacity-70 transition hover:opacity-100"
    onclick={() => onOpenSettings()}
    use:tooltip={$i18n.t('sidebar.settings')}
    aria-label={$i18n.t('sidebar.settings')}
  >
    <img src={appIcon} alt="" class="h-5 w-5 rounded-[4px] object-cover" />
  </button>

  {#if showServer}
    <!-- AuraPro status -->
    <button
      class="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] transition-all bg-transparent border-none cursor-pointer text-[#1d1d1f] dark:text-[#fafafa] {activeLog ===
      'server'
        ? 'bg-black/[0.08] dark:bg-white/[0.1] opacity-90'
        : 'opacity-50 hover:opacity-80 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'}"
      onclick={() => {
        if (!serverRunning && !serverStarting) {
          onStartServer()
        }
        onSelectLog('server')
      }}
      use:tooltip={serverRunning
        ? $i18n.t('statusBar.serverRunning')
        : serverStarting
          ? $i18n.t('common.starting')
          : $i18n.t('statusBar.serverStopped')}
    >
      <div
        class="w-[7px] h-[7px] shrink-0 rounded-full {serverRunning
          ? 'bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.6)]'
          : serverStarting
            ? 'bg-amber-400 animate-pulse'
            : 'bg-black/15 dark:bg-white/20'}"
      ></div>
      <span>{$i18n.t('statusBar.server')}</span>
    </button>
  {/if}

  {#if showTerminal}
    {#if showServer}
      <div class="w-px h-3 bg-black/[0.08] dark:bg-white/[0.08] mx-0.5"></div>
    {/if}

    <!-- Open Terminal status -->
    <button
      class="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] transition-all bg-transparent border-none cursor-pointer text-[#1d1d1f] dark:text-[#fafafa] {activeLog ===
      'open-terminal'
        ? 'bg-black/[0.08] dark:bg-white/[0.1] opacity-90'
        : 'opacity-50 hover:opacity-80 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'}"
      onclick={() => {
        if (!otRunning && !otStarting) {
          onToggleOpenTerminal()
        }
        onSelectLog('open-terminal')
      }}
      oncontextmenu={(e) => {
        e.preventDefault()
        if (otRunning) onToggleOpenTerminal()
      }}
      use:tooltip={otRunning
        ? activeLog === 'open-terminal'
          ? $i18n.t('sidebar.tooltip.hideLogs')
          : $i18n.t('sidebar.tooltip.viewLogs')
        : otStarting
          ? $i18n.t('common.starting')
          : otFailed
            ? $i18n.t('sidebar.tooltip.clickToRetry')
            : $i18n.t('sidebar.tooltip.startTerminalServer')}
    >
      <div
        class="w-[7px] h-[7px] shrink-0 rounded-full {otRunning
          ? 'bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.6)]'
          : otStarting
            ? 'bg-amber-400 animate-pulse'
            : otFailed
              ? 'bg-red-400'
              : 'bg-black/15 dark:bg-white/20'}"
      ></div>
      <span>{$i18n.t('sidebar.openTerminal')}</span>
    </button>
  {/if}

  {#if showOpenCode}
    {#if showServer || showTerminal}
      <div class="mx-0.5 h-3 w-px bg-black/[0.08] dark:bg-white/[0.08]"></div>
    {/if}

    <button
      class="flex cursor-pointer items-center gap-1.5 rounded-md border-none bg-transparent px-2 py-0.5 text-[11px] text-[#1d1d1f] transition-all dark:text-[#fafafa] {activeLog ===
      'opencode'
        ? 'bg-black/[0.08] opacity-90 dark:bg-white/[0.1]'
        : 'opacity-50 hover:bg-black/[0.04] hover:opacity-80 dark:hover:bg-white/[0.06]'}"
      onclick={() => {
        if (!openCodeRunning && !openCodeStarting) {
          onToggleOpenCode()
        }
        onSelectLog('opencode')
      }}
      oncontextmenu={(event) => {
        event.preventDefault()
        if (openCodeRunning) onToggleOpenCode()
      }}
      use:tooltip={openCodeRunning
        ? activeLog === 'opencode'
          ? $i18n.t('sidebar.tooltip.hideLogs')
          : $i18n.t('sidebar.tooltip.viewLogs')
        : openCodeStarting
          ? $i18n.t('common.starting')
          : openCodeFailed
            ? $i18n.t('sidebar.tooltip.clickToRetry')
            : $i18n.t('sidebar.tooltip.startOpenCode')}
    >
      <div
        class="h-[7px] w-[7px] shrink-0 rounded-full {openCodeRunning
          ? 'bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.6)]'
          : openCodeStarting
            ? 'animate-pulse bg-amber-400'
            : openCodeFailed
              ? 'bg-red-400'
              : 'bg-black/15 dark:bg-white/20'}"
      ></div>
      <span>OpenCode</span>
    </button>
  {/if}

  {#if showLlama}
    {#if showServer || showTerminal || showOpenCode}
      <div class="w-px h-3 bg-black/[0.08] dark:bg-white/[0.08] mx-0.5"></div>
    {/if}

    <!-- llama.cpp status -->
    <button
      class="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] transition-all bg-transparent border-none cursor-pointer text-[#1d1d1f] dark:text-[#fafafa] {activeLog ===
      'llama-server'
        ? 'bg-black/[0.08] dark:bg-white/[0.1] opacity-90'
        : 'opacity-50 hover:opacity-80 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'}"
      onclick={() => {
        if (!lsRunning && !lsStarting) {
          onToggleLlamaCpp()
        }
        onSelectLog('llama-server')
      }}
      oncontextmenu={(e) => {
        e.preventDefault()
        if (lsRunning) onToggleLlamaCpp()
      }}
      use:tooltip={lsRunning
        ? activeLog === 'llama-server'
          ? $i18n.t('sidebar.tooltip.hideLogs')
          : $i18n.t('sidebar.tooltip.viewLogs')
        : lsStarting
          ? $i18n.t('common.starting')
          : lsFailed
            ? $i18n.t('sidebar.tooltip.clickToRetry')
            : $i18n.t('sidebar.tooltip.startLlamaServer')}
    >
      <div
        class="w-[7px] h-[7px] shrink-0 rounded-full {lsRunning
          ? 'bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.6)]'
          : lsStarting
            ? 'bg-amber-400 animate-pulse'
            : lsFailed
              ? 'bg-red-400'
              : 'bg-black/15 dark:bg-white/20'}"
      ></div>
      <span>{$i18n.t('sidebar.llamaCpp')}</span>
    </button>
  {/if}

  {#if showSherpa}
    {#if showServer || showTerminal || showOpenCode || showLlama}
      <div class="w-px h-3 bg-black/[0.08] dark:bg-white/[0.08] mx-0.5"></div>
    {/if}

    <!-- sherpa status -->
    <button
      class="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] transition-all bg-transparent border-none cursor-pointer text-[#1d1d1f] dark:text-[#fafafa] {activeLog ===
      'sherpa'
        ? 'bg-black/[0.08] dark:bg-white/[0.1] opacity-90'
        : 'opacity-50 hover:opacity-80 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'}"
      onclick={() => {
        if (!sherpaRunning && !sherpaStarting) {
          onToggleSherpa()
        }
        onSelectLog('sherpa')
      }}
      oncontextmenu={(e) => {
        e.preventDefault()
        if (sherpaRunning) onToggleSherpa()
      }}
      use:tooltip={sherpaRunning
        ? activeLog === 'sherpa'
          ? $i18n.t('sidebar.tooltip.hideLogs')
          : $i18n.t('sidebar.tooltip.viewLogs')
        : sherpaStarting
          ? $i18n.t('common.starting')
          : sherpaFailed
            ? $i18n.t('sidebar.tooltip.clickToRetry')
            : 'Start sherpa'}
    >
      <div
        class="w-[7px] h-[7px] shrink-0 rounded-full {sherpaRunning
          ? 'bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.6)]'
          : sherpaStarting
            ? 'bg-amber-400 animate-pulse'
            : sherpaFailed
              ? 'bg-red-400'
              : 'bg-black/15 dark:bg-white/20'}"
      ></div>
      <span>sherpa</span>
    </button>
  {/if}

  <button
    type="button"
    class="ml-auto shrink-0 whitespace-nowrap border-none bg-transparent px-1.5 py-0.5 text-[10px] text-[#1d1d1f] opacity-35 transition hover:opacity-75 dark:text-[#fafafa]"
    onclick={runDiagnostics}
    disabled={diagnosing}
    use:tooltip={isChinese
      ? '检查本地推理运行环境和模型'
      : 'Check the local inference runtime and models'}
  >
    <span class="hidden min-[680px]:inline">
      {diagnosing
        ? isChinese
          ? '正在诊断...'
          : 'Diagnosing...'
        : isChinese
          ? '运行遇到问题？点击诊断'
          : 'Having problems? Run diagnostics'}
    </span>
    <span class="min-[680px]:hidden">{isChinese ? '诊断' : 'Diagnose'}</span>
  </button>

  <button
    type="button"
    class="shrink-0 whitespace-nowrap border-none bg-transparent px-1.5 py-0.5 text-[10px] text-[#1d1d1f] opacity-35 transition hover:opacity-75 dark:text-[#fafafa]"
    onclick={() => onOpenSettings('help')}
    use:tooltip={$i18n.t('statusBar.helpTooltip')}
  >
    <span class="hidden min-[760px]:inline">{$i18n.t('statusBar.help')}</span>
    <span class="min-[760px]:hidden">{$i18n.t('statusBar.helpShort')}</span>
  </button>

  <!-- Version (right-aligned) -->
  <span class="shrink-0 text-[10px] opacity-25 select-none">v{$appInfo?.version ?? ''}</span>
</div>
