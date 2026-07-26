<script lang="ts">
  import i18n from '../../i18n'
  import type { InstallationFailureReport } from '../../utils/install-diagnostics'

  interface Props {
    report: InstallationFailureReport
    repairing?: boolean
    onRetry: () => void
    onBack: () => void
    onChooseFolder?: () => void
  }

  let { report, repairing = false, onRetry, onBack, onChooseFolder }: Props = $props()

  const isChinese = $derived(($i18n.language ?? '').toLowerCase().startsWith('zh'))
  const text = (zh: string, en: string): string => (isChinese ? zh : en)

  const titles: Record<string, string> = {
    'disk-space': '磁盘空间不足',
    'unsupported-path': '安装路径包含不支持的字符',
    permission: '安装目录没有写入权限',
    'file-locked': '安装文件被占用或被安全软件拦截',
    network: '安装下载网络异常',
    authentication: '下载请求被服务器拒绝',
    'corrupt-download': '下载文件不完整或已损坏',
    'missing-files': '安装所需文件缺失',
    'python-runtime': 'Python 运行环境安装失败',
    'package-install': 'AuraPro 软件包安装失败',
    'model-download': '模型或附加模型下载失败',
    'runtime-start': '安装后的本地服务无法启动',
    memory: '内存不足',
    'port-conflict': '本地服务端口被占用',
    'unsupported-system': '当前系统或架构不受支持',
    'optional-component': '可选组件安装失败',
    unknown: '安装过程出现未知故障'
  }

  const details: Record<string, string> = {
    'disk-space': '当前安装位置没有足够空间完成下载、解压和模型安装。',
    'unsupported-path':
      '当前 Windows 安装路径包含中文或其他非 ASCII 字符，部分本地运行库无法正确读取。',
    permission: 'AuraPro 无法在所选目录创建或替换文件。',
    'file-locked': '其他进程、Bitdefender、Windows 安全中心或杀毒软件正在占用或隔离安装文件。',
    network: '连接安装源时中断或超时，支持断点续传的文件会在重试时继续下载。',
    authentication: '代理、VPN、网络策略或下载服务限流拒绝了请求。',
    'corrupt-download': '运行库、软件包或模型没有通过文件大小验证，或者无法解压。',
    'missing-files':
      '运行程序、DLL、软件包或模型文件在安装目录中缺失，可能未下载完整或被安全软件移除。',
    'python-runtime': '内置 Python 或 uv 包管理器没有正确安装。',
    'package-install': 'Python 包管理器无法安装或验证 AuraPro 所需软件包。',
    'model-download': '主模型、MTP 草稿模型或多模态视觉模型没有下载完整。',
    'runtime-start': '组件已经安装，但对应的本地服务没有正常进入可用状态。',
    memory: '加载模型时系统内存、统一内存或显存耗尽。',
    'port-conflict': '没有为本地服务找到可用端口。',
    'unsupported-system': '下载的组件与当前操作系统或 CPU 架构不匹配。',
    'optional-component': '主安装可以继续，但此可选组件暂时不可用。',
    unknown: '安装器遇到了尚未归类的错误。'
  }

  const localizedSteps = (): string[] => {
    if (!isChinese) return report.manualSteps
    const steps: Record<string, string[]> = {
      'disk-space': [
        '清理当前磁盘或选择其他安装位置。',
        '为下载临时文件和解压过程预留额外空间。',
        '返回安装器重新检测。'
      ],
      'unsupported-path': [
        '返回安装设置并更改安装位置。',
        '使用类似 D:\\AuraProData 的纯英文路径。',
        '选择新目录后重新开始安装。'
      ],
      permission: [
        '选择当前用户拥有的文件夹。',
        '在 Bitdefender、Windows 安全中心或其他杀毒软件中允许 AuraPro。',
        '确认目录不是只读后重试。'
      ],
      'file-locked': [
        '关闭 AuraPro、Python、llama.cpp、Open Terminal 和 Sherpa 进程。',
        '检查杀毒软件隔离区，并允许 AuraPro 安装目录。',
        '重启 AuraPro 后重新安装。'
      ],
      network: [
        '检查网络连接，并暂时关闭代理或 VPN。',
        '允许 AuraPro 通过防火墙和杀毒软件网络控制。',
        '确认 GitHub、PyPI 和 Hugging Face 可以访问。'
      ],
      authentication: [
        '检查代理、VPN 和公司网络策略。',
        '在浏览器中确认 GitHub、PyPI 和 Hugging Face 可以访问。',
        '如果触发限流，请稍后重试。'
      ],
      'corrupt-download': [
        '确认安装磁盘连接正常且可写。',
        '重试仍失败时，暂时关闭网络拦截或杀毒扫描。',
        '重新安装前释放更多磁盘空间。'
      ],
      'missing-files': [
        '检查杀毒软件隔离区中是否有 AuraPro、DLL 或运行库文件。',
        '将 AuraPro 安装目录加入安全软件允许列表。',
        '重新检测并安装缺失组件。'
      ],
      'python-runtime': [
        '重启 AuraPro 以释放 Python 文件。',
        '在杀毒软件中允许内置 Python 目录。',
        '持续失败时选择其他可写安装位置。'
      ],
      'package-install': [
        '确认可以访问 PyPI 或配置的软件包源。',
        '关闭正在运行的 AuraPro WebUI 进程。',
        '在杀毒软件中允许内置 Python 目录。'
      ],
      'model-download': [
        '确认可以访问 Hugging Face。',
        '为主模型和附加模型保留足够磁盘空间。',
        '磁盘空间有限时选择更小的模型。'
      ],
      'runtime-start': [
        '查看对应服务日志中的第一条错误。',
        '允许运行程序通过杀毒软件和防火墙。',
        '旧进程占用文件或端口时重启电脑。'
      ],
      memory: [
        '关闭占用大量内存或显存的程序。',
        '选择更小的本地模型。',
        '安装后降低上下文长度或并发数。'
      ],
      'port-conflict': [
        '关闭其他本地 AI 服务或旧的 AuraPro 进程。',
        '无法找到占用进程时重启电脑。',
        '在设置中修改对应服务端口。'
      ],
      'unsupported-system': [
        '确认当前系统是 x64 还是 ARM64。',
        '安装与系统架构匹配的 AuraPro。',
        '运行库要求更高版本时升级操作系统。'
      ],
      'optional-component': [
        '稍后在设置中重新安装此组件。',
        '检查网络和磁盘空间。',
        '如果下载文件消失，请检查杀毒软件隔离区。'
      ],
      unknown: [
        '查看下方技术错误。',
        '重启 AuraPro 后重试。',
        '相同错误持续出现时选择其他安装位置。'
      ]
    }
    return steps[report.kind] ?? report.manualSteps
  }
</script>

<div
  class="w-full max-w-[440px] overflow-hidden rounded-lg border border-red-500/15 bg-red-500/[0.05] text-left"
>
  <div class="border-b border-red-500/10 px-4 py-3.5">
    <div class="flex items-start justify-between gap-3">
      <div>
        <div class="text-[10px] font-medium uppercase text-red-500/70">
          {text('安装向导故障诊断', 'Installation diagnostics')}
        </div>
        <div class="mt-1 text-[13px] font-medium">
          {isChinese ? (titles[report.kind] ?? report.title) : report.title}
        </div>
      </div>
      <span
        class="shrink-0 text-[10px] {report.autoRepairable ? 'text-emerald-500' : 'text-amber-500'}"
      >
        {report.autoRepairable
          ? text('可自动修复', 'Auto-repair')
          : text('需要手动处理', 'Manual action')}
      </span>
    </div>
    <div class="mt-2 text-[11px] leading-relaxed opacity-55">
      {isChinese ? (details[report.kind] ?? report.detail) : report.detail}
    </div>
  </div>

  <div class="px-4 py-3">
    <div class="text-[10px] font-medium opacity-40">{text('建议处理', 'Recommended actions')}</div>
    <div class="mt-2 grid gap-1.5">
      {#each localizedSteps() as step, index (`${index}:${step}`)}
        <div class="flex gap-2 text-[11px] leading-relaxed opacity-55">
          <span class="shrink-0 opacity-45">{index + 1}.</span>
          <span>{step}</span>
        </div>
      {/each}
    </div>

    <details class="mt-3">
      <summary class="cursor-pointer text-[10px] opacity-35"
        >{text('技术错误详情', 'Technical details')}</summary
      >
      <pre
        class="mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/[0.06] p-2 text-[9px] leading-relaxed opacity-55 dark:bg-black/25">{report.technicalDetail}</pre>
    </details>
  </div>

  <div
    class="flex flex-wrap items-center justify-between gap-2 border-t border-red-500/10 px-4 py-3"
  >
    <button
      type="button"
      class="rounded-md border border-black/10 bg-transparent px-3 py-2 text-[11px] opacity-55 transition hover:opacity-80 dark:border-white/10"
      onclick={onBack}
      disabled={repairing}
    >
      {text('返回安装设置', 'Back to setup')}
    </button>
    <div class="flex items-center gap-2">
      {#if onChooseFolder && (report.kind === 'disk-space' || report.kind === 'unsupported-path' || report.kind === 'permission')}
        <button
          type="button"
          class="rounded-md border border-black/10 bg-transparent px-3 py-2 text-[11px] opacity-65 transition hover:opacity-90 dark:border-white/10"
          onclick={onChooseFolder}
          disabled={repairing}
        >
          {text('更改安装位置', 'Change folder')}
        </button>
      {/if}
      <button
        type="button"
        class="rounded-md border-none bg-[#1d1d1f] px-3.5 py-2 text-[11px] font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
        onclick={onRetry}
        disabled={repairing}
      >
        {repairing
          ? text('正在自动修复...', 'Repairing...')
          : report.autoRepairable
            ? text('重新检测并修复', 'Retry repair')
            : text('重试安装', 'Retry installation')}
      </button>
    </div>
  </div>
</div>
