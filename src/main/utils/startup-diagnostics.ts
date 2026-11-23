import { stripVTControlCharacters } from 'node:util'

export type StartupService = 'webui' | 'sherpa' | 'agent' | 'pro'
export type StartupRepair =
  | 'dependencies'
  | 'retry-sherpa-dependencies'
  | 'metadata'
  | 'environment'
  | 'python'
  | 'installer'
  | 'package'
  | 'restart'

export const isMissingPythonPackageMetadata = (evidence: string): boolean => {
  const value = stripVTControlCharacters(evidence)
  return (
    /[\\/][^\\/\r\n]+\.dist-info[\\/]METADATA\b[^\r\n]*(?:os error 2\b|no such file|file not found|找不到)/i.test(
      value
    ) || /(?:error:|cannot uninstall)[^\r\n]*(?:missing|no) [`'"]?RECORD\b/i.test(value)
  )
}

const dependencies = {
  tokenizers: ['tokenizers', '0.22.2'],
  charset_normalizer: ['charset-normalizer', '3.4.7'],
  faster_whisper: ['faster-whisper', '1.2.1'],
  ctranslate2: ['ctranslate2', '4.8.0'],
  fast_langdetect: ['fast-langdetect', '1.2.0'],
  sherpa_onnx_core: ['sherpa-onnx-core', '1.13.8'],
  sherpa_onnx: ['sherpa-onnx', '1.13.8'],
  fastapi: ['fastapi', '0.136.3'],
  uvicorn: ['uvicorn', '0.41.0'],
  pydantic: ['pydantic', '2.13.4'],
  pydantic_core: ['pydantic-core', '2.46.4'],
  python_multipart: ['python-multipart', '0.0.32'],
  soundfile: ['soundfile', '0.13.1'],
  numpy: ['numpy', process.platform === 'darwin' ? '2.2.6' : '2.4.6'],
  av: ['av', '17.1.0'],
  sqlalchemy: ['sqlalchemy', '2.0.50'],
  aiosqlite: ['aiosqlite', '0.22.1'],
  alembic: ['alembic', '1.18.4'],
  aiohttp: ['aiohttp', '3.14.4'],
  httpx: ['httpx', '0.28.1'],
  brotlicffi: ['brotlicffi', '1.2.1.0'],
  brotli: ['Brotli', '1.2.1'],
  urllib3: ['urllib3', '2.8.0'],
  onnxruntime: ['onnxruntime', process.platform === 'darwin' ? '1.23.2' : '1.26.0'],
  cffi: ['cffi', '2.0.0'],
  requests: ['requests', '2.34.2']
} as const

export type StartupDependency = keyof typeof dependencies

export const dependencyName = (value: string): StartupDependency | undefined => {
  const name = value.toLowerCase().split('.')[0].replaceAll('-', '_')
  if (name === '_cffi_backend') return 'cffi'
  if (name === '_brotlicffi') return 'brotlicffi'
  if (name === '_brotli') return 'brotli'
  if (name === '_sherpa_onnx') return 'sherpa_onnx_core'
  if (name === '_pydantic_core') return 'pydantic_core'
  if (name === 'multipart') return 'python_multipart'
  return Object.hasOwn(dependencies, name) ? (name as StartupDependency) : undefined
}

export const startupPackage = (key: StartupDependency) => dependencies[key][0]

export const dependencySpec = (key: StartupDependency, installedVersion?: string): string => {
  const [name, fallback] = dependencies[key]
  const pinned = ['sherpa_onnx', 'sherpa_onnx_core'].includes(key)
  const version =
    !pinned && installedVersion && /^\d+\.\d+(?:\.\d+){0,2}(?:\.post\d+)?$/.test(installedVersion)
      ? installedVersion
      : fallback
  return `${name}==${version}`
}

const startupEvidenceLines = (evidence: string): string[] =>
  stripVTControlCharacters(evidence)
    .split(/\r?\n/)
    // Rich tracebacks include source code, which is context rather than an error.
    .filter((line) => !/^\s*\u2502\s*>?\s*\d+\s*\u2502/.test(line))
    .map((line) => line.replace(/^\s*\u2502|\u2502\s*$/g, '').trim())
    .filter(Boolean)

export const lastStartupEvidence = (value: string): string => {
  const lines = startupEvidenceLines(value)
    .join('\n')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[URL]')
    .replace(
      /\b(api[_ -]?key|password|access[_ -]?token|authorization)\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/gi,
      '$1=[redacted]'
    )
    .split('\n')
  const errors = lines.filter((line) =>
    /error|exception|failed|cannot|no module|拒绝|失败|找不到/i.test(line)
  )
  return (errors.length ? errors : lines).slice(-4).join('\n').slice(0, 850)
}

export const classifyStartupFailure = (evidence: string) => {
  const lines = startupEvidenceLines(evidence)
  const value = lines.join('\n')
  const issue = (kind: string, repair?: StartupRepair, dependency?: StartupDependency) => ({
    kind,
    repair,
    dependency
  })
  // Recognize environmental failures before considering import traces.
  if (
    /no space left|ENOSPC|disk full|not enough space|磁盘空间不足|磁盘已满|os error 112/i.test(
      value
    )
  )
    return issue('disk')
  if (
    /windows application control|smart app control|blocked by (?:group policy|your administrator)|(?:WinError|error code)\s+4551\b/i.test(
      value
    )
  )
    return issue('security')
  if (
    /database (?:disk image is malformed|is locked|is read.only|not ready)|readiness check db ping failed|sqlite3\.(?:DatabaseError|OperationalError)|alembic\.util\.exc|unable to open database|readonly database/i.test(
      value
    )
  )
    return issue('database')
  if (
    /address already in use|EADDRINUSE|no available ports?|port \d+ is occupied|\b10048\b/i.test(
      value
    )
  )
    return issue('port')
  if (
    /used by another process|sharing violation|resource busy|os error (?:5|32)\b|WinError (?:5|32)\b|failed to rename file.+(?:\.pyd|\.dll)|Python files (?:are still in use|still in use)|still using Python files/i.test(
      value
    )
  ) {
    const relatedLines = lines.filter((line) =>
      /failed to (?:rename|remove|replace|write|uninstall)|sharing violation|used by another process|os error (?:5|32)\b|WinError (?:5|32)\b/i.test(
        line
      )
    )
    const modules = Array.from(
      relatedLines.join('\n').matchAll(/site-packages[\\/]([\w-]+)(?:[-.][\d]|[\\/])/gi)
    )
    const dependency = modules
      .reverse()
      .map((match) => dependencyName(match[1]))
      .find(Boolean)
    const packageFile = relatedLines.some((line) => /[\\/]site-packages[\\/]/i.test(line))
    return issue(
      'locked',
      dependency ? 'dependencies' : packageFile ? 'retry-sherpa-dependencies' : undefined,
      dependency
    )
  }
  if (/permission denied|access is denied|EPERM|EACCES|permissionerror|拒绝访问/i.test(value))
    return issue('permission')
  if (/bundled Python package directory is missing or empty/i.test(value))
    return issue('environment', 'environment')
  if (isMissingPythonPackageMetadata(value)) return issue('metadata', 'metadata')
  if (
    /certificate[_ ]verify[_ ]failed|self[- ]signed certificate|unable to get (?:local )?issuer certificate|\b(?:ERR_CERT_\w+|ERR_SSL_\w+|SSLCertVerificationError|ssl\.SSLError)\b|(?:failed|unable|could not|cannot) to (?:load|read|generate|verify).*\b(?:certificate|private key)\b|\b(?:certificate|private key)\b.*(?:expired|not yet valid|does not match)/i.test(
      value
    )
  )
    return issue('certificate')
  if (
    /\b429\b|too many requests|rate limit|temporary failure in name resolution|getaddrinfo|network is unreachable|failed to connect|connection (?:reset|timed out)|(?:download|fetch).*(?:failed|timed out)|\b503\b.*(?:registry|download)/i.test(
      value
    )
  )
    return issue('network')
  if (/out of memory|memoryerror|cannot allocate memory|std::bad_alloc|\b0xc0000017\b/i.test(value))
    return issue('memory')
  if (
    /no compatible wheel|no matching distribution|no solution found|version .*not supported|unsupported (?:platform|architecture)|bad cpu type|not a valid win32 application/i.test(
      value
    )
  )
    return issue('platform')
  if (/vcruntime140|msvcp140|\b0xc0000135\b/i.test(value)) return issue('native')
  const missing = Array.from(value.matchAll(/\bNo module named ['"]([\w.]+)['"]/gi)).at(-1)?.[1]
  const attr = Array.from(value.matchAll(/module ['"]([\w.]+)['"] has no attribute/gi)).at(-1)?.[1]
  const importFrom = Array.from(
    value.matchAll(/cannot import name ['"][\w.]+['"] from ['"]([\w.]+)['"]/gi)
  ).at(-1)?.[1]
  const binaryModule = Array.from(value.matchAll(/DLL load failed while importing (\w+)/gi)).at(
    -1
  )?.[1]
  if (missing === 'uv' || missing === 'pip' || /no module named (?:uv|pip)\b/i.test(value))
    return issue('installer', 'installer')
  if (
    missing === 'open_webui' ||
    missing?.startsWith('open_webui.') ||
    /No package metadata was found for (?:aurapro-webui|aurapro-ui|open-webui)\b|Open WebUI.*incomplete package|failed to spawn:?\s+.*aurapro-webui|failed to spawn:?\s+.*aurapro-ui|Agent executable is missing/i.test(
      value
    )
  )
    return issue('package', 'package')
  if (
    /python (?:executable not found|is not installed|is missing or incomplete|was not found after installation)|No module named ['"](?:encodings|ensurepip|_ssl|_ctypes|_sqlite3)['"]/i.test(
      value
    )
  )
    return issue('python', 'python')
  if (/form data requires .?python.multipart/i.test(value))
    return issue('dependency', 'dependencies', 'python_multipart')
  const name = missing ?? attr ?? importFrom ?? binaryModule
  const dependency = name ? dependencyName(name) : undefined
  if (dependency) return issue('dependency', 'dependencies', dependency)
  if (
    name ||
    /dll load failed|undefined symbol|image not found|cannot open shared object/i.test(value)
  )
    return issue('dependency-unknown')
  if (
    /install Pro (?:and prepare a model )?in Desktop settings|no valid bundled Python environment|prepare this model (?:again )?(?:for|with)/i.test(
      value
    )
  )
    return issue('setup')
  if (
    /JSONDecodeError|invalid (?:json|configuration)|invalid port|configuration error/i.test(value)
  )
    return issue('config')
  if (
    /missing .*model|(?:download|prepare|preparing|configure) (?:the |a )?(?:selected |sherpa )?(?:pro |asr |tts )?model|model (?:files? (?:missing|not found)|is not configured)|SHERPA_[A-Z_]+ (?:does not exist|is not configured)/i.test(
      value
    )
  )
    return issue('model')
  if (
    /did not become ready|did not report ready|startup.*timed out|startup.*timeout|health check failed/i.test(
      value
    )
  )
    return issue('timeout', 'restart')
  return issue('unknown', 'restart')
}

export const repairFailingPythonImports = async (
  check: () => Promise<void>,
  repair: (dependency: StartupDependency) => Promise<boolean>
): Promise<void> => {
  for (;;) {
    try {
      await check()
      return
    } catch (error) {
      const failure = classifyStartupFailure(error instanceof Error ? error.message : String(error))
      if (
        failure.repair !== 'dependencies' ||
        !failure.dependency ||
        !(await repair(failure.dependency))
      )
        throw error
    }
  }
}

export const makeStartupIssue = (
  service: StartupService,
  failure: ReturnType<typeof classifyStartupFailure>,
  evidence: string
) => {
  const repair =
    service === 'webui'
      ? failure.repair === 'retry-sherpa-dependencies'
        ? undefined
        : failure.repair
      : service === 'sherpa'
        ? failure.repair === 'package'
          ? undefined
          : failure.repair
        : failure.repair === 'restart' || (service === 'agent' && failure.repair === 'package')
          ? failure.repair
          : undefined
  return {
    id: `service-startup:${service}:${failure.kind}`,
    severity: 'error' as const,
    title: `${service} startup failed`,
    detail: '',
    repairable: Boolean(repair),
    data: {
      service,
      kind: failure.kind,
      repair,
      dependency: failure.dependency,
      packageName: failure.dependency ? startupPackage(failure.dependency) : undefined,
      evidence: lastStartupEvidence(evidence)
    }
  }
}
