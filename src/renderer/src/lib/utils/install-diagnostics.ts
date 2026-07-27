export type InstallationStage =
  | 'preflight'
  | 'python'
  | 'packages'
  | 'model-download'
  | 'llama-runtime'
  | 'speech'
  | 'terminal'
  | 'webui-start'
  | 'connection'
  | 'unknown'

export type InstallationIssueKind =
  | 'disk-space'
  | 'unsupported-path'
  | 'permission'
  | 'file-locked'
  | 'network'
  | 'authentication'
  | 'corrupt-download'
  | 'missing-files'
  | 'python-runtime'
  | 'package-install'
  | 'model-download'
  | 'runtime-start'
  | 'memory'
  | 'port-conflict'
  | 'unsupported-system'
  | 'optional-component'
  | 'unknown'

export interface InstallationFailureReport {
  id: string
  stage: InstallationStage
  kind: InstallationIssueKind
  severity: 'error' | 'warning'
  title: string
  detail: string
  technicalDetail: string
  autoRepairable: boolean
  repairDescription: string
  manualSteps: string[]
}

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message ?? error)
  }
  return String(error ?? 'Unknown installation error')
}

const makeReport = (
  stage: InstallationStage,
  kind: InstallationIssueKind,
  message: string,
  options: {
    title: string
    detail: string
    autoRepairable: boolean
    repairDescription: string
    manualSteps: string[]
    severity?: 'error' | 'warning'
  }
): InstallationFailureReport => ({
  id: `${stage}:${kind}`,
  stage,
  kind,
  severity: options.severity ?? 'error',
  title: options.title,
  detail: options.detail,
  technicalDetail: message.trim().slice(-1000),
  autoRepairable: options.autoRepairable,
  repairDescription: options.repairDescription,
  manualSteps: options.manualSteps
})

export const diagnoseInstallationFailure = (
  stage: InstallationStage,
  error: unknown,
  platform: string,
  lastStatus = ''
): InstallationFailureReport => {
  const message = [errorMessage(error), lastStatus].filter(Boolean).join('\n')
  const lower = message.toLowerCase()

  if (
    /install_path_unsupported|unsupported installation path|安装路径.*(?:不支持|中文|特殊字符)/.test(
      lower
    )
  ) {
    return makeReport(stage, 'unsupported-path', message, {
      title: 'Installation path is not supported',
      detail:
        'The selected Windows path contains Chinese or other non-ASCII characters that some local runtimes cannot read.',
      autoRepairable: false,
      repairDescription:
        'Choose an installation folder that uses only English letters, numbers, spaces, hyphens, and underscores.',
      manualSteps: [
        'Return to the installation settings and change the installation folder.',
        'Use a path such as D:\\AuraProData.',
        'Run the installation again after selecting the new folder.'
      ]
    })
  }

  if (
    /enospc|no space left|not enough (?:disk )?space|disk space.*(?:low|insufficient)|磁盘空间不足/.test(
      lower
    )
  ) {
    return makeReport(stage, 'disk-space', message, {
      title: 'Not enough disk space',
      detail:
        'The selected installation drive does not have enough free space for the current installation stage.',
      autoRepairable: false,
      repairDescription: 'Choose another installation location or free disk space, then retry.',
      manualSteps: [
        'Free space on the selected drive or choose a different installation folder.',
        'Keep additional free space for model temporary files and extraction.',
        'Return to the installer and run the check again.'
      ]
    })
  }

  if (
    /out of memory|std::bad_alloc|cannot allocate memory|failed to allocate|内存不足|显存不足/.test(
      lower
    )
  ) {
    return makeReport(stage, 'memory', message, {
      title: 'Not enough memory',
      detail:
        'The runtime ran out of system memory, unified memory, or GPU memory while preparing the model.',
      autoRepairable: false,
      repairDescription: 'Close memory-heavy applications or install a smaller model.',
      manualSteps: [
        'Close applications using large amounts of RAM or GPU memory.',
        'Select a smaller local model.',
        'Reduce context size or parallel requests after installation.'
      ]
    })
  }

  if (
    /eacces|eperm|permission denied|access is denied|operation not permitted|install_permission_denied|拒绝访问|没有权限/.test(
      lower
    )
  ) {
    return makeReport(stage, 'permission', message, {
      title: 'Installation folder is not writable',
      detail: 'AuraPro could not create or replace files in the selected installation directory.',
      autoRepairable: false,
      repairDescription:
        'Choose a user-writable folder or allow AuraPro through security software.',
      manualSteps: [
        'Choose a folder owned by the current Windows or macOS user.',
        platform === 'win32'
          ? 'Allow AuraPro in Windows Security or third-party antivirus protection.'
          : 'Grant AuraPro permission to write to the selected folder.',
        'Make sure the folder is not read-only, then retry.'
      ]
    })
  }

  if (
    /ebusy|resource busy|being used by another process|files still in use|failed to remove file|os error 32|quarantin|antivirus|virus detected|另一个程序正在使用|文件被占用/.test(
      lower
    )
  ) {
    return makeReport(stage, 'file-locked', message, {
      title: 'Installation files are locked or blocked',
      detail:
        'Another process or security product is preventing AuraPro from replacing installation files.',
      autoRepairable: false,
      repairDescription:
        'Close related processes and allow the installation folder in antivirus software.',
      manualSteps: [
        'Close running AuraPro, Python, llama.cpp, Open Terminal, and Sherpa processes.',
        platform === 'win32'
          ? 'Check Bitdefender or Windows Security quarantine and add the AuraPro installation folder to allowed locations.'
          : 'Check security and privacy software for blocked files.',
        'Restart AuraPro and retry installation.'
      ]
    })
  }

  if (
    /\b(?:401|403)\b|unauthorized|forbidden|rate limit|authentication required|access denied.*(?:github|hugging ?face)/.test(
      lower
    )
  ) {
    return makeReport(stage, 'authentication', message, {
      title: 'Download access was rejected',
      detail: 'A download server, proxy, or network policy rejected the installation request.',
      autoRepairable: false,
      repairDescription: 'Check proxy, VPN, firewall, and download-service access.',
      manualSteps: [
        'Disable or reconfigure the proxy or VPN temporarily.',
        'Confirm that GitHub, PyPI, and Hugging Face can be opened in a browser.',
        'Wait and retry later if the service rate limit was reached.'
      ]
    })
  }

  if (
    /failed to extract|invalid archive|unexpected end|download.*incomplete|size mismatch|failed verification|corrupt|truncated|文件不完整|解压失败/.test(
      lower
    )
  ) {
    return makeReport(stage, 'corrupt-download', message, {
      title: 'Downloaded file is incomplete or damaged',
      detail: 'A runtime, package, or model file failed size verification or extraction.',
      autoRepairable: true,
      repairDescription:
        'AuraPro will discard invalid completed files and resume or download them again.',
      manualSteps: [
        'Check that the installation drive remains connected and writable.',
        'Temporarily disable network interception or antivirus scanning if the retry fails.',
        'Free additional disk space before retrying.'
      ]
    })
  }

  if (
    /\benoent\b|no such file or directory|module not found|cannot find (?:the )?(?:file|module)|missing (?:file|dll|library|executable)|dll load failed|找不到(?:指定的)?(?:文件|模块)|缺少.*(?:文件|运行库)/.test(
      lower
    )
  ) {
    return makeReport(stage, 'missing-files', message, {
      title: 'Required installation files are missing',
      detail:
        'A runtime executable, library, package, or model file is missing from the installation directory.',
      autoRepairable: true,
      repairDescription: 'AuraPro will reinstall the affected stage and verify its required files.',
      manualSteps: [
        'Check antivirus quarantine for removed executables or DLL files.',
        'Allow the AuraPro installation folder in security software.',
        'Retry installation so the missing component can be downloaded again.'
      ]
    })
  }

  if (
    /no available ports?|address already in use|eaddrinuse|port.*(?:occupied|unavailable)|端口.*(?:占用|不可用)/.test(
      lower
    )
  ) {
    return makeReport(stage, 'port-conflict', message, {
      title: 'No service port is available',
      detail: 'AuraPro could not find a free local port for one of its services.',
      autoRepairable: false,
      repairDescription:
        'Close the process using the configured port or choose another port in settings.',
      manualSteps: [
        'Close other local AI servers or old AuraPro processes.',
        'Restart the computer if the owning process cannot be identified.',
        'Change the affected service port in settings and retry.'
      ]
    })
  }

  if (
    /unsupported platform|unsupported architecture|not a valid win32 application|bad cpu type|exec format|不支持.*(?:系统|架构)/.test(
      lower
    )
  ) {
    return makeReport(stage, 'unsupported-system', message, {
      title: 'This runtime does not support the current system',
      detail: 'The downloaded component does not match the operating system or CPU architecture.',
      autoRepairable: false,
      repairDescription:
        'Install an AuraPro build that matches this operating system and architecture.',
      manualSteps: [
        'Confirm whether the system is x64 or ARM64.',
        'Download the matching AuraPro installer.',
        'Update the operating system if the runtime requires a newer release.'
      ]
    })
  }

  if (
    /fetch failed|network|enotfound|eai_again|econnreset|econnrefused|etimedout|timed out|timeout|socket|tls|certificate|http error|github api|failed to download|internet connection|response body is not readable|无法连接|网络/.test(
      lower
    )
  ) {
    return makeReport(stage, 'network', message, {
      title: 'Network download failed',
      detail: 'The connection to an installation source was interrupted or timed out.',
      autoRepairable: true,
      repairDescription:
        'AuraPro will wait briefly and retry; partial downloads will resume when supported.',
      manualSteps: [
        'Check the internet connection and retry without a proxy or VPN.',
        'Allow AuraPro through the firewall and antivirus network controls.',
        'Confirm that GitHub, PyPI, and Hugging Face are reachable.'
      ]
    })
  }

  if (stage === 'python') {
    return makeReport(stage, 'python-runtime', message, {
      title: 'Python runtime installation failed',
      detail: 'The bundled Python runtime or uv package manager was not installed correctly.',
      autoRepairable: true,
      repairDescription:
        'AuraPro will perform the Python installation again and verify Python and uv.',
      manualSteps: [
        'Restart AuraPro to release Python files.',
        'Allow the installation directory in antivirus software.',
        'Choose another writable installation folder if the problem persists.'
      ]
    })
  }

  if (stage === 'packages') {
    return makeReport(stage, 'package-install', message, {
      title: 'AuraPro package installation failed',
      detail:
        'The Python package installer could not install or verify the required AuraPro packages.',
      autoRepairable: true,
      repairDescription:
        'AuraPro will rerun the idempotent package installation and verify the installed version.',
      manualSteps: [
        'Check access to PyPI and the configured package source.',
        'Close running Open WebUI processes.',
        'Allow the bundled Python directory in antivirus software.'
      ]
    })
  }

  if (stage === 'model-download') {
    return makeReport(stage, 'model-download', message, {
      title: 'Model download failed',
      detail: 'The main model, MTP draft model, or vision projector did not download completely.',
      autoRepairable: true,
      repairDescription: 'AuraPro will resume partial downloads and verify their final size.',
      manualSteps: [
        'Check access to Hugging Face.',
        'Keep enough free disk space for all selected model files.',
        'Choose a smaller model if storage is limited.'
      ]
    })
  }

  if (
    stage === 'llama-runtime' ||
    stage === 'speech' ||
    stage === 'terminal' ||
    stage === 'webui-start'
  ) {
    return makeReport(stage, 'runtime-start', message, {
      title: 'Installed service failed to start',
      detail: 'A local service was installed but did not become ready.',
      autoRepairable: true,
      repairDescription:
        'AuraPro will stop the incomplete process, regenerate its configuration, and start it again.',
      manualSteps: [
        'Check the corresponding service log for the first error.',
        'Allow the runtime executable through antivirus and firewall controls.',
        'Restart the computer if an old process is holding files or ports.'
      ]
    })
  }

  return makeReport(stage, 'unknown', message, {
    title: 'Unexpected installation failure',
    detail: 'The installer encountered an error that does not match a known failure category.',
    autoRepairable: true,
    repairDescription: 'AuraPro will retry the current installation operation once.',
    manualSteps: [
      'Review the technical error below.',
      'Restart AuraPro and retry.',
      'Choose another installation location if the same error returns.'
    ]
  })
}

export const createOptionalInstallWarning = (
  component: string,
  error: unknown
): InstallationFailureReport => {
  const message = errorMessage(error)
  const report = makeReport('unknown', 'optional-component', message, {
    title: `${component} was not installed`,
    detail: `The main AuraPro installation can continue, but ${component} will be unavailable until repaired.`,
    autoRepairable: false,
    repairDescription: `Install ${component} later from Settings.`,
    manualSteps: [
      `Open Settings and retry the ${component} installation.`,
      'Check the internet connection and available disk space.',
      'Review antivirus quarantine if downloaded files disappear.'
    ],
    severity: 'warning'
  })
  return {
    ...report,
    id: `optional:${component.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  }
}
