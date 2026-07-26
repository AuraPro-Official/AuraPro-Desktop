<script lang="ts">
  import { onMount } from 'svelte'
  import { fade, fly } from 'svelte/transition'
  import i18n from '../../../i18n'

  interface DiagnosticIssue {
    id: string
    severity: 'error' | 'warning' | 'info'
    title: string
    detail: string
    repairable: boolean
    data?: Record<string, unknown>
  }

  interface DiagnosticReport {
    checkedAt: string
    trigger: string
    healthy: boolean
    fingerprint: string
    variant: string
    recommendedVariant: string
    hardware: {
      nvidiaDetected: boolean
      gpuNames: string[]
      driverVersion: string | null
      processOnGpu: boolean | null
      totalRamBytes: number
      freeRamBytes: number
      totalVramMb: number | null
      freeVramMb: number | null
    }
    runtime: {
      status: string | null
      version: string | null
      binaryPresent: boolean
      acceleratorBackendPresent: boolean
      cudaBackendPresent: boolean
      cudaRuntimePresent: boolean
      cudaDeviceCount: number | null
      offloadedLayers: number | null
    }
    models: {
      total: number
      invalid: number
      partial: number
      mtpEnabled: boolean
      mtpMissing: number
      visionProjectorMissing: number
    }
    issues: DiagnosticIssue[]
    evidence: string[]
  }

  interface RepairResult {
    actions?: string[]
    restartError?: string | null
    report?: DiagnosticReport
  }

  interface RendererMessage {
    type: string
    data?: unknown
  }

  const IGNORE_KEY = 'aurapro:llamacpp-diagnostic-ignore'

  let report = $state<DiagnosticReport | null>(null)
  let toastVisible = $state(false)
  let panelOpen = $state(false)
  let diagnosing = $state(false)
  let repairing = $state(false)
  let repairProgress = $state('')
  let repairError = $state('')
  let repairedActions = $state<string[]>([])
  let selectedIssueIds = $state<string[]>([])

  const isChinese = $derived(($i18n.language ?? '').toLowerCase().startsWith('zh'))
  const text = (zh: string, en: string): string => (isChinese ? zh : en)
  const repairableIssues = $derived(report?.issues.filter((issue) => issue.repairable) ?? [])
  const errorCount = $derived(
    report?.issues.filter((issue) => issue.severity === 'error').length ?? 0
  )
  const formatMemory = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)} GB`

  const baseIssueId = (id: string): string => id.split(':')[0]

  const localizedIssueTitle = (issue: DiagnosticIssue): string => {
    if (!isChinese) return issue.title
    const titles: Record<string, string> = {
      'nvidia-not-found': '未检测到 NVIDIA 显卡',
      'driver-incompatible': 'NVIDIA 驱动版本不兼容',
      'driver-update-recommended': '建议升级 NVIDIA 驱动',
      'driver-version-unknown': '无法读取 NVIDIA 驱动版本',
      'nvidia-cpu-variant': '检测到 NVIDIA 显卡，建议启用 CUDA',
      'cuda-variant-mismatch': 'CUDA 版本与显卡不匹配',
      'llamacpp-missing': 'llama.cpp 运行库缺失',
      'cuda-backend-missing': 'CUDA 后端文件不完整',
      'accelerator-backend-missing': '硬件加速后端文件不完整',
      'cuda-runtime-missing': 'CUDA Runtime DLL 不完整',
      'llamacpp-probe-failed': 'llama.cpp 运行库无法启动',
      'cuda-initialization-failed': 'CUDA 初始化失败',
      'accelerator-initialization-failed': '硬件加速初始化失败',
      'gpu-offload-missing': '模型未使用 GPU 加速',
      'memory-insufficient': '内存不足，模型无法加载',
      'model-incomplete': '模型文件不完整',
      'model-partial': '模型下载尚未完成',
      'model-load-failed': '主模型加载失败',
      'mmproj-incomplete': '多模态视觉模型不完整',
      'multimodal-load-failed': '多模态模型加载失败',
      'mtp-incomplete': 'MTP 草稿模型不完整',
      'mtp-runtime-error': 'MTP 运行异常',
      'startup-failed': 'llama.cpp 启动失败'
    }
    return titles[baseIssueId(issue.id)] ?? issue.title
  }

  const localizedIssueDetail = (issue: DiagnosticIssue): string => {
    if (!isChinese) return issue.detail
    const details: Record<string, string> = {
      'nvidia-not-found': `当前选择了 CUDA，但系统没有检测到 NVIDIA 显卡。可切换到 ${report?.recommendedVariant ?? 'CPU'}。`,
      'driver-incompatible': '当前显卡驱动低于所选 CUDA 运行库的最低要求。',
      'driver-update-recommended': '当前驱动可能依赖兼容模式，升级驱动可提高稳定性。',
      'driver-version-unknown': 'nvidia-smi 不可用，无法确认驱动是否满足 CUDA 要求。',
      'nvidia-cpu-variant': `当前使用 CPU 变体，但检测到 NVIDIA 显卡。建议切换到 ${report?.recommendedVariant ?? 'CUDA'} 以提升推理性能。`,
      'cuda-variant-mismatch': `建议此显卡使用 ${report?.recommendedVariant ?? '自动检测'}。`,
      'llamacpp-missing': '安装目录中没有找到 llama-server。',
      'cuda-backend-missing': 'llama-server 旁缺少 ggml-cuda.dll。',
      'accelerator-backend-missing': 'llama-server 旁缺少当前 Vulkan 或 ROCm 变体需要的后端文件。',
      'cuda-runtime-missing': 'llama-server 旁缺少 cudart、cuBLAS 或 cuBLASLt DLL。',
      'llamacpp-probe-failed': 'llama-server 自检失败，运行库可能损坏或依赖缺失。',
      'cuda-initialization-failed': 'llama.cpp 日志显示 CUDA 设备或驱动初始化失败。',
      'accelerator-initialization-failed':
        '当前加速后端无法初始化。Vulkan 或 ROCm 可以自动切换到 CPU 兼容模式。',
      'gpu-offload-missing': '模型已经加载，但日志显示没有任何层被卸载到 GPU。',
      'memory-insufficient':
        '日志确认系统内存、统一内存或显存耗尽。请关闭占用内存的程序、降低上下文长度或并发数，或者换用更小的模型。',
      'model-incomplete': '模型没有通过 GGUF 文件头或文件大小检查。',
      'model-partial': '检测到可以继续下载的模型临时文件。',
      'model-load-failed':
        'llama.cpp 无法读取当前主模型。可能是文件损坏、GGUF 特性不兼容，或者运行库版本过旧。',
      'mmproj-incomplete':
        '视觉投影模型缺失、损坏或仍在下载中。文本推理不受影响，但图片输入可能失败。',
      'multimodal-load-failed': '视觉投影模型与主模型不匹配、文件损坏，或加载时内存不足。',
      'mtp-incomplete': 'MTP 草稿模型缺失、损坏或仍在下载中。',
      'mtp-runtime-error':
        'MTP 草稿模型加载失败、版本不支持或内存不足。可以关闭 MTP，主模型仍可正常使用。',
      'startup-failed': 'llama.cpp 未能正常启动，请查看下方检测结果。'
    }
    return details[baseIssueId(issue.id)] ?? issue.detail
  }

  const isIgnored = (fingerprint: string): boolean => {
    try {
      return localStorage.getItem(IGNORE_KEY) === fingerprint
    } catch {
      return false
    }
  }

  const setReport = (nextReport: DiagnosticReport | null): void => {
    report = nextReport
    selectedIssueIds =
      nextReport?.issues.filter((issue) => issue.repairable).map((issue) => issue.id) ?? []
  }

  const isIssueSelected = (issueId: string): boolean => selectedIssueIds.includes(issueId)

  const toggleIssue = (issueId: string, selected: boolean): void => {
    selectedIssueIds = selected
      ? Array.from(new Set([...selectedIssueIds, issueId]))
      : selectedIssueIds.filter((id) => id !== issueId)
  }

  const toggleAllRepairable = (selected: boolean): void => {
    selectedIssueIds = selected ? repairableIssues.map((issue) => issue.id) : []
  }

  const selectedRepairIssueIds = (): string[] =>
    Array.from(selectedIssueIds).filter(
      (id): id is string => typeof id === 'string' && id.length > 0
    )

  const acceptAutomaticReport = (nextReport: DiagnosticReport): void => {
    setReport(nextReport)
    repairError = ''
    repairedActions = []
    if (!nextReport.healthy && !isIgnored(nextReport.fingerprint)) {
      toastVisible = true
    }
  }

  onMount(() => {
    return window.electronAPI.onData((message: RendererMessage) => {
      if (message.type === 'llamacpp:diagnostic-alert') {
        acceptAutomaticReport(message.data as DiagnosticReport)
        return
      }
      if (message.type === 'llamacpp:diagnostic-report') {
        const nextReport = message.data as DiagnosticReport
        setReport(nextReport)
        if (nextReport?.trigger === 'manual') {
          toastVisible = false
          panelOpen = true
        }
        return
      }
      if (message.type === 'llamacpp:repair-progress') {
        repairProgress = typeof message.data === 'string' ? message.data : ''
        return
      }
      if (message.type === 'llamacpp:repair-complete') {
        const result = message.data as RepairResult
        if (result?.report) setReport(result.report)
        repairedActions = result?.actions ?? []
        repairError = result?.restartError ?? ''
        repairProgress = ''
        repairing = false
        return
      }
      if (message.type === 'llamacpp:repair-failed') {
        const failure = message.data as { message?: string } | undefined
        repairError = failure?.message ?? text('修复失败', 'Repair failed')
        repairProgress = ''
        repairing = false
      }
    })
  })

  const errorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error)

  const runDiagnosis = async (): Promise<void> => {
    toastVisible = false
    panelOpen = true
    diagnosing = true
    repairError = ''
    repairedActions = []
    try {
      setReport(await window.electronAPI.diagnoseLlamaCpp())
    } catch (error: unknown) {
      repairError = errorMessage(error)
    } finally {
      diagnosing = false
    }
  }

  const runRepair = async (): Promise<void> => {
    const issueIds = selectedRepairIssueIds()
    if (repairing || issueIds.length === 0) return
    repairing = true
    repairProgress = text('准备修复...', 'Preparing repair...')
    repairError = ''
    repairedActions = []
    try {
      const result = await window.electronAPI.repairLlamaCpp(issueIds)
      if (result?.report) setReport(result.report)
      repairedActions = result?.actions ?? []
      repairError = result?.restartError ?? ''
    } catch (error: unknown) {
      repairError = errorMessage(error)
    } finally {
      repairing = false
      repairProgress = ''
    }
  }

  const ignoreReport = (): void => {
    if (report?.fingerprint) {
      try {
        localStorage.setItem(IGNORE_KEY, report.fingerprint)
      } catch {
        // Ignore storage failures; dismissing still works for this session.
      }
    }
    toastVisible = false
    panelOpen = false
  }

  const openDriverPage = (): void => {
    window.electronAPI.openInBrowser('https://www.nvidia.com/Download/index.aspx')
  }
</script>

{#if toastVisible && report}
  <aside
    class="fixed bottom-10 right-4 z-[90] w-[min(340px,calc(100vw-32px))] overflow-hidden rounded-lg border border-black/10 bg-white shadow-xl dark:border-white/10 dark:bg-[#171717]"
    in:fly={{ x: 18, duration: 180 }}
    out:fade={{ duration: 120 }}
    aria-live="polite"
  >
    <div class="h-1 bg-red-500"></div>
    <div class="px-4 py-3.5">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#fafafa]">
            {text('本地推理运行异常', 'Local inference needs attention')}
          </div>
          <div class="mt-1 text-[12px] leading-5 text-black/50 dark:text-white/50">
            {text(
              `检测到 ${errorCount} 个可能导致本地模型无法加载或推理失败的问题。`,
              `${errorCount} issue${errorCount === 1 ? '' : 's'} may prevent local models from loading or running.`
            )}
          </div>
        </div>
        <button
          type="button"
          class="h-6 w-6 shrink-0 border-none bg-transparent text-lg leading-none text-black/30 hover:text-black/70 dark:text-white/30 dark:hover:text-white/70"
          onclick={() => {
            toastVisible = false
          }}
          title={text('关闭', 'Close')}
          aria-label={text('关闭', 'Close')}
        >
          ×
        </button>
      </div>
      <div class="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          class="rounded-md border border-black/10 bg-transparent px-3 py-1.5 text-[12px] text-black/45 hover:bg-black/[0.04] dark:border-white/10 dark:text-white/45 dark:hover:bg-white/[0.06]"
          onclick={ignoreReport}
        >
          {text('忽略', 'Ignore')}
        </button>
        <button
          type="button"
          class="rounded-md border-none bg-[#1d1d1f] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-black dark:bg-white dark:text-black dark:hover:bg-white/90"
          onclick={runDiagnosis}
        >
          {text('检测并修复', 'Diagnose and repair')}
        </button>
      </div>
    </div>
  </aside>
{/if}

{#if panelOpen}
  <aside
    class="fixed bottom-7 right-0 top-0 z-[95] flex w-[min(430px,100vw)] flex-col border-l border-black/10 bg-[#f7f7f8] shadow-2xl dark:border-white/10 dark:bg-[#111]"
    in:fly={{ x: 32, duration: 200 }}
    out:fly={{ x: 32, duration: 150 }}
    aria-label={text('本地推理诊断', 'Local inference diagnostics')}
  >
    <header
      class="flex h-14 shrink-0 items-center justify-between border-b border-black/[0.07] px-4 dark:border-white/[0.08]"
    >
      <div>
        <div class="text-[14px] font-semibold">
          {text('本地推理检测与修复', 'Local inference diagnostics')}
        </div>
        <div class="mt-0.5 text-[10px] text-black/35 dark:text-white/35">
          {text('所有检测均在本机完成', 'All checks run locally')}
        </div>
      </div>
      <button
        type="button"
        class="h-7 w-7 border-none bg-transparent text-xl leading-none text-black/35 hover:text-black/75 dark:text-white/35 dark:hover:text-white/75"
        onclick={() => {
          panelOpen = false
        }}
        title={text('关闭', 'Close')}
        aria-label={text('关闭', 'Close')}
      >
        ×
      </button>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto">
      {#if diagnosing}
        <div
          class="flex h-40 items-center justify-center text-[12px] text-black/40 dark:text-white/40"
        >
          {text('正在检测运行环境...', 'Checking the runtime environment...')}
        </div>
      {:else if report}
        <section class="border-b border-black/[0.07] px-4 py-4 dark:border-white/[0.08]">
          <div class="flex items-center justify-between gap-3">
            <div class="text-[13px] font-medium">
              {report.healthy
                ? text('未检测到阻塞问题', 'No blocking issues found')
                : text(
                    `检测到 ${report.issues.length} 个问题`,
                    `${report.issues.length} issues found`
                  )}
            </div>
            <span
              class="text-[11px] font-medium {report.healthy
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-red-600 dark:text-red-400'}"
            >
              {report.healthy ? text('正常', 'Healthy') : text('需要处理', 'Needs attention')}
            </span>
          </div>

          <dl class="mt-3 grid grid-cols-[108px_1fr] gap-x-3 gap-y-2 text-[11px]">
            <dt class="text-black/35 dark:text-white/35">{text('运行变体', 'Runtime variant')}</dt>
            <dd class="m-0 text-right font-mono text-black/65 dark:text-white/65">
              {report.variant}
            </dd>
            <dt class="text-black/35 dark:text-white/35">{text('显卡', 'GPU')}</dt>
            <dd class="m-0 truncate text-right text-black/65 dark:text-white/65">
              {report.hardware.gpuNames.join(', ') || text('未检测到', 'Not detected')}
            </dd>
            <dt class="text-black/35 dark:text-white/35">{text('驱动版本', 'Driver')}</dt>
            <dd class="m-0 text-right font-mono text-black/65 dark:text-white/65">
              {report.hardware.driverVersion ?? text('未知', 'Unknown')}
            </dd>
            <dt class="text-black/35 dark:text-white/35">{text('可用内存', 'Available memory')}</dt>
            <dd class="m-0 text-right font-mono text-black/65 dark:text-white/65">
              {formatMemory(report.hardware.freeRamBytes)} / {formatMemory(
                report.hardware.totalRamBytes
              )}
            </dd>
            {#if report.hardware.totalVramMb}
              <dt class="text-black/35 dark:text-white/35">{text('可用显存', 'Available VRAM')}</dt>
              <dd class="m-0 text-right font-mono text-black/65 dark:text-white/65">
                {((report.hardware.freeVramMb ?? 0) / 1024).toFixed(1)} /
                {(report.hardware.totalVramMb / 1024).toFixed(1)} GB
              </dd>
            {/if}
            <dt class="text-black/35 dark:text-white/35">{text('llama.cpp', 'llama.cpp')}</dt>
            <dd class="m-0 text-right font-mono text-black/65 dark:text-white/65">
              {report.runtime.version ?? text('未安装', 'Not installed')}
            </dd>
            <dt class="text-black/35 dark:text-white/35">{text('本地模型', 'Local models')}</dt>
            <dd class="m-0 text-right text-black/65 dark:text-white/65">
              {report.models.total}
              {#if report.models.invalid + report.models.partial > 0}
                · {text(
                  `${report.models.invalid + report.models.partial} 个异常`,
                  `${report.models.invalid + report.models.partial} invalid`
                )}
              {/if}
            </dd>
            <dt class="text-black/35 dark:text-white/35">{text('附加模型', 'Companion models')}</dt>
            <dd class="m-0 text-right text-black/65 dark:text-white/65">
              {report.models.visionProjectorMissing + report.models.mtpMissing > 0
                ? text(
                    `${report.models.visionProjectorMissing + report.models.mtpMissing} 个异常`,
                    `${report.models.visionProjectorMissing + report.models.mtpMissing} invalid`
                  )
                : text('正常', 'Ready')}
            </dd>
          </dl>
        </section>

        <section>
          {#if report.issues.length === 0}
            <div class="px-4 py-8 text-center text-[12px] text-black/35 dark:text-white/35">
              {text(
                '运行库、加速后端、模型及附加模型检查均已通过。',
                'Runtime, accelerator, model, and companion-model checks passed.'
              )}
            </div>
          {:else}
            {#if repairableIssues.length > 1}
              <label
                class="flex cursor-pointer items-center gap-2 border-b border-black/[0.06] px-4 py-2.5 text-[11px] text-black/45 dark:border-white/[0.07] dark:text-white/45"
              >
                <input
                  type="checkbox"
                  class="h-3.5 w-3.5 accent-[#1d1d1f] dark:accent-white"
                  checked={selectedIssueIds.length === repairableIssues.length}
                  onchange={(event) =>
                    toggleAllRepairable((event.currentTarget as HTMLInputElement).checked)}
                  disabled={repairing}
                />
                <span>{text('选择全部可自动修复的问题', 'Select all auto-fix issues')}</span>
              </label>
            {/if}
            {#each report.issues as issue (issue.id)}
              <div class="border-b border-black/[0.06] px-4 py-3.5 dark:border-white/[0.07]">
                <div class="flex items-start gap-2.5">
                  {#if issue.repairable}
                    <input
                      type="checkbox"
                      class="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[#1d1d1f] dark:accent-white"
                      checked={isIssueSelected(issue.id)}
                      onchange={(event) =>
                        toggleIssue(issue.id, (event.currentTarget as HTMLInputElement).checked)}
                      disabled={repairing}
                      aria-label={text(
                        `选择修复：${localizedIssueTitle(issue)}`,
                        `Select repair: ${localizedIssueTitle(issue)}`
                      )}
                    />
                  {:else}
                    <span
                      class="mt-1.5 h-2 w-2 shrink-0 rounded-sm {issue.severity === 'error'
                        ? 'bg-red-500'
                        : issue.severity === 'warning'
                          ? 'bg-amber-500'
                          : 'bg-sky-500'}"
                    ></span>
                  {/if}
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center justify-between gap-2">
                      <div class="text-[12px] font-medium">{localizedIssueTitle(issue)}</div>
                      <span
                        class="shrink-0 text-[10px] {issue.repairable
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-black/30 dark:text-white/30'}"
                      >
                        {issue.repairable
                          ? text('可自动修复', 'Auto-fix')
                          : text('需要手动处理', 'Manual')}
                      </span>
                    </div>
                    <div class="mt-1 text-[11px] leading-[1.55] text-black/45 dark:text-white/45">
                      {localizedIssueDetail(issue)}
                    </div>
                    {#if issue.data?.manualDriverUpdate}
                      <button
                        type="button"
                        class="mt-2 border-none bg-transparent p-0 text-[11px] text-blue-600 hover:underline dark:text-blue-400"
                        onclick={openDriverPage}
                      >
                        {text('打开 NVIDIA 驱动下载页', 'Open NVIDIA driver downloads')}
                      </button>
                    {/if}
                  </div>
                </div>
              </div>
            {/each}
          {/if}
        </section>

        {#if repairedActions.length > 0}
          <section class="border-b border-black/[0.07] px-4 py-4 dark:border-white/[0.08]">
            <div class="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
              {text('已执行的修复', 'Completed repairs')}
            </div>
            {#each repairedActions as action (action)}
              <div class="mt-1.5 text-[11px] text-black/45 dark:text-white/45">· {action}</div>
            {/each}
          </section>
        {/if}

        {#if repairError}
          <div
            class="border-b border-red-500/15 bg-red-500/[0.06] px-4 py-3 text-[11px] leading-5 text-red-700 dark:text-red-300"
          >
            {repairError}
          </div>
        {/if}
      {/if}
    </div>

    <footer
      class="shrink-0 border-t border-black/[0.07] bg-white/80 px-4 py-3 backdrop-blur dark:border-white/[0.08] dark:bg-[#171717]/90"
    >
      {#if repairing}
        <div class="mb-2.5 text-[11px] text-black/45 dark:text-white/45">
          {repairProgress || text('正在修复...', 'Repairing...')}
        </div>
      {/if}
      <div class="flex items-center justify-between gap-2">
        <button
          type="button"
          class="rounded-md border border-black/10 bg-transparent px-3 py-2 text-[12px] text-black/45 hover:bg-black/[0.04] dark:border-white/10 dark:text-white/45 dark:hover:bg-white/[0.06]"
          onclick={ignoreReport}
          disabled={repairing}
        >
          {text('忽略', 'Ignore')}
        </button>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="rounded-md border border-black/10 bg-transparent px-3 py-2 text-[12px] text-black/55 hover:bg-black/[0.04] disabled:opacity-35 dark:border-white/10 dark:text-white/55 dark:hover:bg-white/[0.06]"
            onclick={runDiagnosis}
            disabled={diagnosing || repairing}
          >
            {text('重新检测', 'Check again')}
          </button>
          <button
            type="button"
            class="rounded-md border-none bg-[#1d1d1f] px-3.5 py-2 text-[12px] font-medium text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-35 dark:bg-white dark:text-black dark:hover:bg-white/90"
            onclick={runRepair}
            disabled={repairing || diagnosing || selectedIssueIds.length === 0}
          >
            {repairing
              ? text('修复中...', 'Repairing...')
              : text(
                  `立即修复${selectedIssueIds.length ? ` (${selectedIssueIds.length})` : ''}`,
                  `Repair now${selectedIssueIds.length ? ` (${selectedIssueIds.length})` : ''}`
                )}
          </button>
        </div>
      </div>
    </footer>
  </aside>
{/if}
