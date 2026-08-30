import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync, execSync } from 'child_process'

import * as tar from 'tar'
import * as pty from 'node-pty'
import log from 'electron-log'

import {
  getConfig,
  setConfig,
  getInstallDir,
  getEpubConceptRuntimeFilePath,
  portInUse,
  downloadFileWithProgress,
  formatDownloadBytes,
  formatDownloadSpeed,
  formatDownloadEta
} from './index'

import { downloadModel } from './huggingface'
import { ServiceLock, isProcessAlive } from './service-lock'
import { hasLlamaCppRuntimeAnomaly } from './llamacpp-log-diagnostics'
import { scheduleLlamaCppVersionCleanup } from './cache-cleanup'
import {
  isNewerLlamaBuild,
  parseLlamaBuildTag,
  selectLatestCompatibleLlamaRelease,
  sortLlamaBuildTagsNewestFirst,
  type LlamaRelease,
  type LlamaReleaseAsset
} from './llamacpp-release'
import {
  getLlamaAssetPatterns,
  matchesAssetPattern,
  normalizeLlamaVariantForPlatform
} from './platform-support'

// State

let ptyProcess: pty.IPty | null = null
let pid: number | null = null
let url: string | null = null
let status: string | null = null // null | setting-up | starting | started | stopped | failed
let logBuffer: string[] = []
let intentionalStop = false
type LlamaStartResult = { url: string; pid: number }
let startPromise: Promise<LlamaStartResult> | null = null

const lock = new ServiceLock('llamacpp')
let binaryPath: string | null = null
let runtimeAnomalyHandler: ((message: string) => void) | null = null

// The EPUB concept resolver uses this compact model because it fits the
// supported 16 GB unified-memory baseline while still following the
// llama.cpp OpenAI-compatible chat-completions contract.
export const EPUB_CONCEPT_MODEL_REPOSITORY = 'Qwen/Qwen2.5-3B-Instruct-GGUF'
export const EPUB_CONCEPT_MODEL_FILENAME = 'qwen2.5-3b-instruct-q4_k_m.gguf'
export const EPUB_CONCEPT_MODEL_ID = 'qwen2.5-3b-instruct-q4_k_m'
const EPUB_CONCEPT_MODEL_SIZE_BYTES = Math.round(2.1 * 1024 * 1024 * 1024)

type EpubConceptRuntimeDescriptor = {
  version: 1
  llama_cpp: {
    endpoint: string
    model: string
  }
}

export const setLlamaCppRuntimeAnomalyHandler = (
  handler: ((message: string) => void) | null
): void => {
  runtimeAnomalyHandler = handler
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const isPidRunning = (targetPid: number): boolean => {
  try {
    process.kill(targetPid, 0)
    return true
  } catch {
    return false
  }
}

const terminateProcessTree = async (targetPid: number, force = false): Promise<void> => {
  if (!targetPid) return

  if (process.platform === 'win32') {
    const commands = force
      ? [`taskkill /PID ${targetPid} /T /F`]
      : [`taskkill /PID ${targetPid} /T`, `taskkill /PID ${targetPid} /T /F`]

    for (const command of commands) {
      try {
        execSync(command, { timeout: 5000, stdio: 'ignore', windowsHide: true })
      } catch {}
      await sleep(500)
      if (!isPidRunning(targetPid)) return
    }
    return
  }

  const signals = force ? ['SIGKILL'] : ['SIGTERM', 'SIGKILL']
  for (const signal of signals) {
    try {
      process.kill(-targetPid, signal)
    } catch {
      try {
        process.kill(targetPid, signal)
      } catch {}
    }
    await sleep(500)
    if (!isPidRunning(targetPid)) return
  }
}

const findStaleInstalledLlamaServerPids = (port: number): number[] => {
  const runtimeRoot = path.resolve(getInstallDir(), 'llama.cpp')
  if (!fs.existsSync(runtimeRoot)) return []

  try {
    if (process.platform === 'win32') {
      const runtimeRootLiteral = JSON.stringify(`${runtimeRoot.replace(/[\\/]+$/, '')}${path.sep}`)
      const script = `
$runtimeRoot = [System.IO.Path]::GetFullPath(${runtimeRootLiteral})
$ownerPids = @(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
Get-CimInstance Win32_Process | Where-Object {
  $exe = $_.ExecutablePath
  $ownerPids -contains $_.ProcessId -and $exe -and $_.Name -ieq 'llama-server.exe' -and
    [System.IO.Path]::GetFullPath($exe).StartsWith($runtimeRoot, [System.StringComparison]::OrdinalIgnoreCase)
} | Select-Object -ExpandProperty ProcessId
`
      const output = execFileSync('powershell', ['-NoProfile', '-Command', script], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 10000
      })
      return [
        ...new Set(
          output
            .split(/\r?\n/)
            .map(Number)
            .filter((value) => value > 0)
        )
      ]
    }

    const output = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
      encoding: 'utf8',
      timeout: 10000
    })
    const ownerPids = [
      ...new Set(
        output
          .split(/\r?\n/)
          .map(Number)
          .filter((value) => value > 0)
      )
    ]
    return ownerPids.filter((ownerPid) => {
      try {
        const command = execFileSync('ps', ['-p', String(ownerPid), '-o', 'command='], {
          encoding: 'utf8',
          timeout: 5000
        })
        return command.includes(runtimeRoot) && /llama-server(?:\s|$)/.test(command)
      } catch {
        return false
      }
    })
  } catch (error) {
    log.warn('Failed to inspect stale installed llama-server processes:', error)
    return []
  }
}

const releaseStaleInstalledLlamaServerPort = async (
  port: number,
  host: string
): Promise<boolean> => {
  if (!(await portInUse(port, host))) return true

  const stalePids = findStaleInstalledLlamaServerPids(port).filter(
    (targetPid) => targetPid !== process.pid && targetPid !== pid
  )
  if (stalePids.length === 0) return false

  log.warn(
    `Port ${port} is held by stale AuraPro llama-server process(es): ${stalePids.join(', ')}`
  )
  for (const targetPid of stalePids) {
    await terminateProcessTree(targetPid, false)
    if (isPidRunning(targetPid)) await terminateProcessTree(targetPid, true)
  }

  for (let attempt = 0; attempt < 10; attempt++) {
    if (!(await portInUse(port, host))) {
      log.info(`Released stale AuraPro llama-server port ${port}`)
      return true
    }
    await sleep(200)
  }
  return false
}

// Public Getters

export const getLlamaCppInfo = () => {
  // Lazily discover a cached binary on cold boot so the UI never falsely
  // reports "not installed" when the files are actually on disk.
  if (!binaryPath) {
    const cacheBase = path.join(getInstallDir(), 'llama.cpp')
    try {
      if (fs.existsSync(cacheBase)) {
        const cachedTags = sortLlamaBuildTagsNewestFirst(
          fs
            .readdirSync(cacheBase, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
        )
        for (const tag of cachedTags) {
          const found = findBinary(path.join(cacheBase, tag))
          if (found) {
            binaryPath = found
            break
          }
        }
      }
    } catch {
      // Ignore  - best-effort discovery
    }
  }

  // Extract version tag from binaryPath  - the tag is the directory name
  // directly under the llama.cpp cache dir, e.g.  - llama.cpp/<tag>/bin/llama-server
  let version: string | null = null
  if (binaryPath) {
    const cacheBase = path.join(getInstallDir(), 'llama.cpp')
    const relative = path.relative(cacheBase, binaryPath)
    const tag = relative.split(path.sep)[0]
    if (tag) version = tag
  }
  return { url, status, pid, binaryPath, version }
}

export const getLlamaCppPty = (): pty.IPty | null => ptyProcess
export const getLlamaCppLog = (): string[] => logBuffer

const writeEpubConceptRuntimeDescriptor = (endpoint: string): void => {
  const runtimeFile = getEpubConceptRuntimeFilePath()
  const runtimeDir = path.dirname(runtimeFile)
  const descriptor: EpubConceptRuntimeDescriptor = {
    version: 1,
    llama_cpp: {
      endpoint,
      model: EPUB_CONCEPT_MODEL_ID
    }
  }
  const temporaryFile = `${runtimeFile}.${process.pid}.${Date.now()}.tmp`

  try {
    fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o700 })
    fs.writeFileSync(temporaryFile, JSON.stringify(descriptor), {
      encoding: 'utf8',
      mode: 0o600
    })
    fs.renameSync(temporaryFile, runtimeFile)
    // chmod is best-effort on Windows, but keeps the descriptor private on
    // POSIX installations even when an existing directory had broader bits.
    try {
      fs.chmodSync(runtimeFile, 0o600)
    } catch {}
    log.info(`Published Desktop EPUB llama.cpp runtime descriptor: ${runtimeFile}`)
  } catch (error) {
    try {
      fs.unlinkSync(temporaryFile)
    } catch {}
    throw new Error(
      `Failed to publish EPUB llama.cpp runtime descriptor: ${getErrorMessage(error)}`
    )
  }
}

const removeEpubConceptRuntimeDescriptor = (): void => {
  const runtimeFile = getEpubConceptRuntimeFilePath()
  try {
    fs.unlinkSync(runtimeFile)
    log.info(`Removed Desktop EPUB llama.cpp runtime descriptor: ${runtimeFile}`)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') {
      log.warn(`Failed to remove Desktop EPUB llama.cpp runtime descriptor: ${runtimeFile}`, error)
    }
  }
}

/** Ensure the Desktop-managed concept resolver model is present before start. */
export const ensureEpubConceptModel = async (
  onStatus?: (status: string) => void
): Promise<string> => {
  const modelPath = path.join(
    getInstallDir(),
    'models',
    EPUB_CONCEPT_MODEL_REPOSITORY.replace(/\//g, '--'),
    EPUB_CONCEPT_MODEL_FILENAME
  )
  if (fs.existsSync(modelPath) && fs.statSync(modelPath).size > 0) {
    return modelPath
  }

  onStatus?.('Downloading local EPUB concept model...')
  const downloaded = await downloadModel(
    EPUB_CONCEPT_MODEL_REPOSITORY,
    EPUB_CONCEPT_MODEL_FILENAME,
    (progress) => {
      const percentage = progress.totalBytes > 0 ? ` ${progress.percent.toFixed(0)}%` : ''
      onStatus?.(`Downloading local EPUB concept model${percentage}`)
    },
    undefined,
    EPUB_CONCEPT_MODEL_SIZE_BYTES
  )
  log.info(`Downloaded Desktop EPUB concept model: ${downloaded}`)
  return downloaded
}

// Asset Resolution

interface LlamaConfig {
  [key: string]: unknown
  ctxSize?: number
  extraArgs?: string[]
  mtpEnabled?: boolean
  multimodalEnabled?: boolean
  parallel?: number
  port?: number
  variant?: string
  version?: string
}

const DEFAULT_LLAMA_CPP_FALLBACK_VERSION = 'b9637'
const LLAMA_CPP_RELEASE_FALLBACK_ATTEMPTS = 12
const LLAMA_CPP_RELEASE_DISCOVERY_LIMIT = 30
const LLAMA_CPP_RELEASE_CACHE_TTL_MS = 60_000
let recentLlamaReleasesCache: { expiresAt: number; releases: LlamaRelease[] } | null = null

const githubHeaders = (): Record<string, string> => ({
  Accept: 'application/vnd.github.v3+json',
  'User-Agent': 'AuraPro-Desktop',
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {})
})

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const describeGithubError = (error: unknown): string => {
  const message = getErrorMessage(error)
  if (/403|rate limit/i.test(message)) {
    return (
      'GitHub API rate limit exceeded while fetching llama.cpp. ' +
      'Please wait a while and retry, or set GITHUB_TOKEN for the installer. ' +
      'If llama.cpp was already installed, AuraPro will use the cached binary.'
    )
  }
  return message
}

const previousBuildTag = (tag: string, offset: number): string | null => {
  const build = parseLlamaBuildTag(tag)
  if (build === null || build <= offset) return null
  return `b${build - offset}`
}

const fetchGithubJson = async <T>(apiUrl: string, timeout = 10000): Promise<T> => {
  const response = await fetch(apiUrl, {
    headers: githubHeaders(),
    signal: AbortSignal.timeout(timeout)
  })
  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status}: ${response.statusText}`)
  }
  return (await response.json()) as T
}

const fetchLlamaReleaseByTag = async (version: string): Promise<LlamaRelease> =>
  fetchGithubJson<LlamaRelease>(
    `https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/${encodeURIComponent(version)}`
  )

const fetchRecentLlamaReleases = async (force = false): Promise<LlamaRelease[]> => {
  if (
    !force &&
    recentLlamaReleasesCache?.expiresAt &&
    recentLlamaReleasesCache.expiresAt > Date.now()
  ) {
    return recentLlamaReleasesCache.releases
  }

  const releases = await fetchGithubJson<LlamaRelease[]>(
    `https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=${LLAMA_CPP_RELEASE_DISCOVERY_LIMIT}`,
    15000
  )
  recentLlamaReleasesCache = {
    expiresAt: Date.now() + LLAMA_CPP_RELEASE_CACHE_TTL_MS,
    releases
  }
  return releases
}

const llamaReleaseCandidates = (
  initialTag: string,
  fallbackVersion: string,
  badVersions: string[]
): string[] => {
  const bad = new Set(badVersions)
  const candidates: string[] = []
  const add = (tag: string | null) => {
    if (!tag || bad.has(tag) || candidates.includes(tag)) return
    candidates.push(tag)
  }

  add(initialTag)
  for (let i = 1; i <= LLAMA_CPP_RELEASE_FALLBACK_ATTEMPTS; i++) {
    add(previousBuildTag(initialTag, i))
  }
  add(fallbackVersion)

  return candidates
}

/**
 * Detect the best GPU variant for the current platform.
 * Returns the variant string (e.g. 'cuda-12.4', 'vulkan', 'rocm', 'cpu').
 */
const detectBestVariant = (): string => {
  const platform = process.platform

  // macOS: Metal is baked into the macOS binary; no variant choice needed.
  if (platform === 'darwin') return 'cpu'

  // 1. Check for NVIDIA GPU (CUDA)
  let windowsGpuOutput = ''
  if (platform === 'win32') {
    const selectNvidiaCudaVariant = (gpuNames: string): string | null => {
      const names = gpuNames.toLowerCase()
      if (!names.includes('nvidia') && !names.includes('geforce') && !names.includes('rtx')) {
        return null
      }
      return /\brtx\s+50[5-9]0\b/i.test(gpuNames) ? 'cuda-13.3' : 'cuda-12.4'
    }

    // Inspect the full adapter list: NVIDIA/AMD/Intel discrete GPUs win over Intel integrated adapters.
    // Try wmic first as it's very reliable for identifying the hardware
    try {
      windowsGpuOutput = execSync('wmic path win32_VideoController get name', { encoding: 'utf-8' })
      const cudaVariant = selectNvidiaCudaVariant(windowsGpuOutput)
      if (cudaVariant) {
        log.info(`NVIDIA GPU detected via wmic; selected ${cudaVariant}`)
        return cudaVariant
      }
    } catch {
      // fallback to nvidia-smi
    }

    const nvidiaSmiPaths = [
      'nvidia-smi',
      path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe'),
      path.join(
        process.env.ProgramFiles || 'C:\\Program Files',
        'NVIDIA Corporation',
        'NVSMI',
        'nvidia-smi.exe'
      )
    ]

    for (const smiPath of nvidiaSmiPaths) {
      try {
        const gpuNames = execFileSync(smiPath, ['--query-gpu=name', '--format=csv,noheader'], {
          timeout: 2000,
          stdio: 'pipe',
          encoding: 'utf8'
        })
        const cudaVariant = selectNvidiaCudaVariant(gpuNames)
        if (cudaVariant) {
          log.info(`NVIDIA GPU detected using ${smiPath}; selected ${cudaVariant}`)
          return cudaVariant
        }
      } catch {
        // Continue to next path
      }
    }
  } else if (platform === 'linux') {
    try {
      execFileSync('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], {
        timeout: 2000,
        stdio: 'pipe'
      })
      // Linux: no CUDA asset currently available, fall through
    } catch {
      // no NVIDIA
    }
  }

  // 2. Check for Vulkan support
  if (platform === 'win32') {
    const gpuOutput = windowsGpuOutput.toLowerCase()
    const hasAmdGpu = gpuOutput.includes('amd') || gpuOutput.includes('radeon')
    const hasIntelDiscreteGpu =
      gpuOutput.includes('intel') &&
      (gpuOutput.includes('arc') ||
        gpuOutput.includes('iris xe max') ||
        gpuOutput.includes('data center gpu') ||
        gpuOutput.includes('flex'))
    if (!hasAmdGpu && !hasIntelDiscreteGpu) {
      log.info(
        'No NVIDIA/AMD/Intel discrete GPU detected on Windows, falling back to CPU instead of Vulkan'
      )
      return 'cpu'
    }

    // On Windows, checking for the presence of the Vulkan loader DLL is very reliable
    const system32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32')
    if (fs.existsSync(path.join(system32, 'vulkan-1.dll'))) {
      log.info('Vulkan loader (vulkan-1.dll) detected in System32')
      return 'vulkan'
    }
  }

  try {
    const vulkanCmd = platform === 'win32' ? 'vulkaninfo' : 'vulkaninfo'
    execFileSync(vulkanCmd, ['--summary'], { timeout: 2000, stdio: 'pipe' })
    log.info('Vulkan support detected via vulkaninfo')
    return 'vulkan'
  } catch {
    // Vulkan not available
  }

  // 3. Linux: check for ROCm (AMD GPU)
  if (platform === 'linux') {
    try {
      if (fs.existsSync('/opt/rocm') || fs.existsSync('/usr/lib/rocm')) {
        return 'rocm'
      }
    } catch {
      // ROCm not available
    }
  }

  log.info('No discrete GPU detected, falling back to CPU')
  return 'cpu'
}

/**
 * Resolve the variant  - if 'auto' or empty, detect the best one.
 */
const resolveVariant = (variant: string | undefined): string => {
  const requested = !variant || variant === 'auto' ? detectBestVariant() : variant
  const resolved = normalizeLlamaVariantForPlatform(requested, process.platform, process.arch)
  if (!variant || variant === 'auto') log.info(`Auto-detected variant: ${requested}`)
  if (requested !== resolved) {
    log.warn(
      `llama.cpp variant ${requested} is unavailable on ${process.platform}/${process.arch}; using ${resolved}`
    )
  }
  return resolved
}

const findReleaseAsset = (release: LlamaRelease, variant: string): LlamaReleaseAsset | null => {
  const { patterns } = getLlamaAssetPatterns(
    release.tag_name,
    variant,
    process.platform,
    process.arch
  )
  return (
    release.assets.find((asset) =>
      patterns.some((pattern) => matchesAssetPattern(asset.name, pattern))
    ) ?? null
  )
}

const hasCompleteReleaseAssets = (release: LlamaRelease, variant: string): boolean => {
  const mainAsset = findReleaseAsset(release, variant)
  if (!mainAsset) return false
  if (process.platform !== 'win32' || !variant.startsWith('cuda-')) return true

  const cudaVersion = mainAsset.name.match(/-cuda-(\d+\.\d+)-x64\.zip$/i)?.[1]
  return Boolean(
    cudaVersion &&
    release.assets.some(
      (asset) => asset.name === `cudart-llama-bin-win-cuda-${cudaVersion}-x64.zip`
    )
  )
}

const fetchLatestLlamaRelease = async (variant: string, force = false): Promise<LlamaRelease> => {
  const releases = await fetchRecentLlamaReleases(force)
  const release = selectLatestCompatibleLlamaRelease(releases, (candidate) =>
    hasCompleteReleaseAssets(candidate, variant)
  )
  if (!release) {
    throw new Error(
      `No complete llama.cpp nightly release was found for ${process.platform}/${process.arch}/${variant}.`
    )
  }
  return release
}

const resolveLlamaRelease = async (version: string, variant: string): Promise<LlamaRelease> =>
  version === 'latest' ? fetchLatestLlamaRelease(variant) : fetchLlamaReleaseByTag(version)

/**
 * Find the llama-server binary inside the extracted directory.
 */
const findBinary = (dir: string): string | null => {
  const exeName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'

  const candidates = [
    path.join(dir, exeName),
    path.join(dir, 'bin', exeName),
    path.join(dir, 'build', 'bin', exeName)
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const nested = path.join(dir, entry.name, exeName)
        if (fs.existsSync(nested)) return nested
        const nestedBin = path.join(dir, entry.name, 'bin', exeName)
        if (fs.existsSync(nestedBin)) return nestedBin
      }
    }
  } catch {}

  return null
}

const VARIANT_MARKER_FILENAME = '.aurapro-variant'

const readInstalledVariant = (versionDir: string): string | null => {
  try {
    const value = fs.readFileSync(path.join(versionDir, VARIANT_MARKER_FILENAME), 'utf8').trim()
    return normalizeLlamaVariantForPlatform(value, process.platform, process.arch)
  } catch {
    return null
  }
}

const writeInstalledVariant = (versionDir: string, variant: string): void => {
  fs.writeFileSync(path.join(versionDir, VARIANT_MARKER_FILENAME), variant, 'utf8')
}

const hasBackendLibrary = (versionDir: string, filename: string): boolean => {
  const candidates = [
    path.join(versionDir, filename),
    path.join(versionDir, 'bin', filename),
    path.join(versionDir, 'build', 'bin', filename)
  ]
  return candidates.some((candidate) => fs.existsSync(candidate))
}

const isCachedVariantCompatible = (versionDir: string, variant: string): boolean => {
  const installedVariant = readInstalledVariant(versionDir)
  if (installedVariant) return installedVariant === variant

  // Older AuraPro installs did not write a variant marker. Infer their backend
  // from the dynamic backend DLLs so switching variants cannot reuse the wrong build.
  if (variant.startsWith('cuda')) {
    return variant === 'cuda-13.3' && hasBackendLibrary(versionDir, 'ggml-cuda.dll')
  }
  if (variant === 'vulkan') return hasBackendLibrary(versionDir, 'ggml-vulkan.dll')
  if (variant === 'cpu' && process.platform === 'win32') {
    return (
      !hasBackendLibrary(versionDir, 'ggml-cuda.dll') &&
      !hasBackendLibrary(versionDir, 'ggml-vulkan.dll')
    )
  }
  return true
}

const getCudaVersionFromAssetName = (assetName: string): string | null => {
  return assetName.match(/-cuda-(\d+\.\d+)-x64\.zip$/i)?.[1] ?? null
}

const hasBundledCudaRuntime = (binary: string, cudaVersion: string): boolean => {
  const major = cudaVersion.split('.')[0]
  try {
    const files = fs.readdirSync(path.dirname(binary)).map((filename) => filename.toLowerCase())
    return [`cudart64_${major}`, `cublas64_${major}`, `cublaslt64_${major}`].every((prefix) =>
      files.some((filename) => filename.startsWith(prefix) && filename.endsWith('.dll'))
    )
  } catch {
    return false
  }
}

const isCachedInstallReady = (versionDir: string, binary: string, variant: string): boolean => {
  if (!isCachedVariantCompatible(versionDir, variant)) return false
  if (process.platform !== 'win32' || !variant.startsWith('cuda-')) return true
  return hasBundledCudaRuntime(binary, variant.slice('cuda-'.length))
}

const downloadAndExtractReleaseAsset = async (
  asset: LlamaReleaseAsset,
  downloadDir: string,
  extractDir: string,
  isZip: boolean,
  onStatus?: (status: string) => void,
  keepArchive = false
): Promise<void> => {
  fs.mkdirSync(downloadDir, { recursive: true })
  fs.mkdirSync(extractDir, { recursive: true })

  const downloadPath = path.join(downloadDir, asset.name)
  log.info(`Downloading asset: ${asset.name}`)
  onStatus?.(`Downloading ${asset.name}...`)

  if (!fs.existsSync(downloadPath)) {
    await downloadFileWithProgress(
      asset.browser_download_url,
      downloadPath,
      (progress, downloaded, total, bytesPerSecond, etaSeconds) => {
        onStatus?.(
          `Downloading... ${progress.toFixed(0)}% ` +
            `(${formatDownloadBytes(downloaded)}/${formatDownloadBytes(total)} · ${formatDownloadSpeed(bytesPerSecond)} · ETA ${formatDownloadEta(etaSeconds)})`
        )
      }
    )
  }

  onStatus?.(`Extracting ${asset.name}...`)
  log.info(`Extracting ${downloadPath} to ${extractDir}`)

  try {
    if (isZip) {
      if (process.platform === 'win32') {
        execFileSync('powershell', [
          '-Command',
          `Expand-Archive -Path "${downloadPath}" -DestinationPath "${extractDir}" -Force`
        ])
      } else {
        execFileSync('unzip', ['-o', downloadPath, '-d', extractDir])
      }
    } else {
      await tar.x({ cwd: extractDir, file: downloadPath })
    }
  } catch (error) {
    try {
      fs.unlinkSync(downloadPath)
    } catch {}
    throw new Error(`Failed to extract ${asset.name}: ${getErrorMessage(error)}`)
  }

  if (!keepArchive) {
    try {
      fs.unlinkSync(downloadPath)
    } catch {}
  }
}

const ensureBundledCudaRuntime = async (
  assets: LlamaReleaseAsset[],
  mainAsset: LlamaReleaseAsset,
  versionDir: string,
  binary: string,
  onStatus?: (status: string) => void
): Promise<void> => {
  const cudaVersion = getCudaVersionFromAssetName(mainAsset.name)
  if (!cudaVersion) {
    throw new Error(`Cannot determine CUDA version from llama.cpp asset "${mainAsset.name}"`)
  }

  if (hasBundledCudaRuntime(binary, cudaVersion)) {
    log.info(`Bundled CUDA ${cudaVersion} runtime already installed beside llama-server`)
    return
  }

  const runtimeAssetName = `cudart-llama-bin-win-cuda-${cudaVersion}-x64.zip`
  const runtimeAsset = assets.find((asset) => asset.name === runtimeAssetName)
  if (!runtimeAsset) {
    throw new Error(`Required llama.cpp CUDA runtime asset "${runtimeAssetName}" was not found`)
  }

  await downloadAndExtractReleaseAsset(
    runtimeAsset,
    path.join(path.dirname(versionDir), 'runtime-cache'),
    path.dirname(binary),
    true,
    onStatus,
    true
  )

  if (!hasBundledCudaRuntime(binary, cudaVersion)) {
    throw new Error(
      `CUDA ${cudaVersion} runtime DLLs were not found after extracting ${runtimeAssetName}`
    )
  }

  log.info(`Bundled CUDA ${cudaVersion} runtime installed beside llama-server`)
}

// Setup (Download & Extract)

const getMmprojPrefixForModel = (modelName: string): string => {
  const base = path.basename(modelName, '.gguf').toLowerCase()
  if (base.startsWith('high-code')) return 'high-code'
  if (base.startsWith('lowest')) return 'lowest'
  if (base.startsWith('low')) return 'low'
  if (base.startsWith('medium_q4')) return 'medium-12b'
  if (base.startsWith('medium_iq2')) return 'medium-26b'
  if (base.startsWith('high')) return 'high'
  return base
}

const getMmprojRepoForPrefix = (prefix: string): string | null => {
  if (prefix === 'high-code') return 'unsloth/Qwen3.8-27B-GGUF'
  if (prefix === 'lowest') return 'unsloth/gemma-4-E2B-it-qat-GGUF'
  if (prefix === 'low') return 'unsloth/gemma-4-E4B-it-qat-GGUF'
  if (prefix === 'medium-12b') return 'unsloth/gemma-4-12B-it-qat-GGUF'
  if (prefix === 'medium-26b') return 'unsloth/gemma-4-26B-A4B-it-GGUF'
  if (prefix === 'high') return 'unsloth/gemma-4-26B-A4B-it-qat-GGUF'
  return null
}

const getMtpRepoForPrefix = (prefix: string): string | null => {
  if (prefix === 'high-code') return 'unsloth/Qwen3.8-27B-GGUF'
  if (prefix === 'lowest') return 'unsloth/gemma-4-E2B-it-qat-GGUF'
  if (prefix === 'low') return 'unsloth/gemma-4-E4B-it-qat-GGUF'
  if (prefix === 'medium-12b') return 'unsloth/gemma-4-12B-it-qat-GGUF'
  if (prefix === 'medium-26b') return 'unsloth/gemma-4-26B-A4B-it-GGUF'
  if (prefix === 'high') return 'unsloth/gemma-4-26B-A4B-it-qat-GGUF'
  return null
}

const getMtpFilenameForPrefix = (prefix: string): string | null => {
  if (prefix === 'high-code') return 'MTP/mtp-Qwen3.8-27B-Q4_0.gguf'
  if (prefix === 'lowest') return 'mtp-gemma-4-E2B-it.gguf'
  if (prefix === 'low') return 'mtp-gemma-4-E4B-it.gguf'
  if (prefix === 'medium-12b') return 'mtp-gemma-4-12B-it.gguf'
  if (prefix === 'medium-26b' || prefix === 'high') return 'mtp-gemma-4-26B-A4B-it.gguf'
  return null
}

const AURA_MODEL_FILENAMES = [
  'lowest.gguf',
  'low_E4.gguf',
  'medium_IQ2.gguf',
  'medium_Q4.gguf',
  'high_Q4.gguf',
  'high-code_IQ4.gguf',
  'high-code_Q4.gguf'
]

const migrateOfficialRootModels = (modelsDir: string): void => {
  try {
    if (!fs.existsSync(modelsDir)) return

    for (const filename of AURA_MODEL_FILENAMES) {
      const source = path.join(modelsDir, filename)
      if (!fs.existsSync(source) || !fs.statSync(source).isFile()) continue

      const folderName = path.basename(filename, '.gguf')
      const targetDir = path.join(modelsDir, folderName)
      const target = path.join(targetDir, filename)

      if (fs.existsSync(target)) {
        log.info(`Official model already migrated, leaving root copy untouched: ${source}`)
        continue
      }

      fs.mkdirSync(targetDir, { recursive: true })
      fs.renameSync(source, target)
      log.info(`Migrated official model into multimodal folder: ${source} -> ${target}`)
    }
  } catch (error) {
    log.warn('Failed to migrate official root models:', error)
  }
}

const listLocalLlmModels = (modelsDir: string): Array<{ filepath: string; mtimeMs: number }> => {
  const modelFiles: Array<{ filepath: string; mtimeMs: number }> = []
  const scan = (dir: string) => {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          scan(fullPath)
          continue
        }
        const lower = entry.name.toLowerCase()
        if (!lower.endsWith('.gguf') || lower.includes('mmproj') || lower.startsWith('mtp-'))
          continue
        modelFiles.push({ filepath: fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs })
      }
    } catch {}
  }

  scan(modelsDir)
  modelFiles.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return modelFiles
}

const toIniPath = (filepath: string, baseDir?: string): string => {
  const resolved = path.resolve(filepath)
  const relative = baseDir ? path.relative(baseDir, resolved) : ''
  const normalized =
    relative && !relative.startsWith('..\\..') && !path.isAbsolute(relative) ? relative : resolved
  return normalized.replace(/\\/g, '/')
}

const escapeIniSection = (section: string): string => section.replace(/]/g, '\\]')

const hasExplicitArg = (args: string[], name: string): boolean => {
  return args.some((arg) => arg === name || arg.startsWith(`${name}=`))
}

const stripArgsWithValue = (args: string[], names: string[]): string[] => {
  const stripped: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (names.some((name) => arg === name)) {
      i++
      continue
    }
    if (names.some((name) => arg.startsWith(`${name}=`))) {
      continue
    }
    stripped.push(arg)
  }
  return stripped
}

const getPresetModelId = (
  model: { filepath: string },
  modelsDir: string,
  usedIds: Set<string>
): string => {
  const filename = path.basename(model.filepath, '.gguf')
  let id = filename

  if (usedIds.has(id)) {
    const relative = path
      .relative(modelsDir, model.filepath)
      .replace(/\\/g, '/')
      .replace(/\.gguf$/i, '')
    id = relative || filename
  }

  let uniqueId = id
  let suffix = 2
  while (usedIds.has(uniqueId)) {
    uniqueId = `${id} (${suffix})`
    suffix++
  }

  usedIds.add(uniqueId)
  return uniqueId
}

const findModelMmproj = (modelPath: string): string | null => {
  const dir = path.dirname(modelPath)
  const preferred = [path.join(dir, 'mmproj-F16.gguf'), path.join(dir, 'mmproj.gguf')]

  for (const candidate of preferred) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }

  try {
    const fallback = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .find(
        (name) => name.toLowerCase().startsWith('mmproj') && name.toLowerCase().endsWith('.gguf')
      )

    return fallback ? path.join(dir, fallback) : null
  } catch {
    return null
  }
}

const findModelDraft = (modelPath: string): string | null => {
  const dir = path.dirname(modelPath)
  const mtpPrefix = getMmprojPrefixForModel(path.basename(modelPath))
  const mtpFilename = getMtpFilenameForPrefix(mtpPrefix)
  const preferred = mtpFilename ? [path.join(dir, path.basename(mtpFilename))] : []

  for (const candidate of preferred) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }

  try {
    const fallback = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .find((name) => name.toLowerCase().startsWith('mtp-') && name.toLowerCase().endsWith('.gguf'))

    return fallback ? path.join(dir, fallback) : null
  } catch {
    return null
  }
}

const getPresetModelOverrides = (modelPath: string): Record<string, string> => {
  const filename = path.basename(modelPath)
  if (filename.startsWith('high-code')) {
    return {
      temp: '0.7',
      'top-p': '0.80',
      'top-k': '20',
      'min-p': '0.0',
      'presence-penalty': '1.5',
      'repeat-penalty': '1.0'
    }
  }

  const totalMemGB = Math.round(os.totalmem() / (1024 * 1024 * 1024))
  const lowMemoryAppleSilicon =
    process.platform === 'darwin' && process.arch === 'arm64' && totalMemGB <= 8
  if (filename === 'low_EQ4_MAC_8G.gguf' || (filename === 'low_E4.gguf' && lowMemoryAppleSilicon)) {
    return {
      'ctx-size': '8192',
      b: '512',
      'ubatch-size': '256'
    }
  }

  return {}
}

const LEGACY_HIGH_CODE_INTERNAL_MTP_SIZE = 18_536_192_288

const hasInternalMtpSupport = (modelPath: string): boolean => {
  if (path.basename(modelPath).toLowerCase() !== 'high-code_iq4.gguf') return false
  try {
    return fs.statSync(modelPath).size === LEGACY_HIGH_CODE_INTERNAL_MTP_SIZE
  } catch {
    return false
  }
}

const normalizePositiveInteger = (value: unknown): number | null => {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  return Math.max(1, Math.floor(numeric))
}

const getDefaultParallel = (): number => {
  const totalMemGB = Math.round(os.totalmem() / (1024 * 1024 * 1024))
  if (process.platform === 'darwin') return totalMemGB <= 16 ? 1 : 2
  return totalMemGB <= 32 ? 1 : 2
}

const sortModelsForPreset = (
  models: Array<{ filepath: string; mtimeMs: number }>
): Array<{ filepath: string; mtimeMs: number }> => {
  const officialOrder = new Map(AURA_MODEL_FILENAMES.map((filename, index) => [filename, index]))

  return [...models].sort((a, b) => {
    const aName = path.basename(a.filepath)
    const bName = path.basename(b.filepath)
    const aOfficial = officialOrder.get(aName)
    const bOfficial = officialOrder.get(bName)

    if (aOfficial !== undefined && bOfficial !== undefined) return aOfficial - bOfficial
    if (aOfficial !== undefined) return -1
    if (bOfficial !== undefined) return 1

    return aName.localeCompare(bName, undefined, { sensitivity: 'base', numeric: true })
  })
}

const writeModelsPreset = async (
  modelsDir: string,
  llamaConfig: LlamaConfig,
  extraArgs: string[] = [],
  onStatus?: (status: string) => void
): Promise<string> => {
  migrateOfficialRootModels(modelsDir)
  await ensureAutoMmproj(modelsDir, extraArgs, onStatus)
  await ensureAutoMtp(modelsDir, extraArgs, onStatus)
  const mtpEnabled = llamaConfig.mtpEnabled === true
  const multimodalEnabled = llamaConfig.multimodalEnabled !== false

  const ctxSize = llamaConfig.ctxSize || 16384
  const parallel = normalizePositiveInteger(llamaConfig.parallel) ?? getDefaultParallel()
  const models = sortModelsForPreset(listLocalLlmModels(modelsDir))
  const usedIds = new Set<string>()
  const presetPath = path.join(getInstallDir(), 'llama.cpp', 'models-preset.ini')
  const presetDir = path.dirname(presetPath)
  const lines: string[] = [
    '[*]',
    `ctx-size = ${ctxSize}`,
    `parallel = ${parallel}`,
    'cache-ram = 4096',
    'flash-attn = auto',
    'temp = 1.0',
    'top-p = 0.95',
    'top-k = 64',
    'min-p = 0.05',
    'jinja = true',
    'chat-template-kwargs = {"enable_thinking":false}',
    'reasoning-budget = 0',
    'load-on-startup = false',
    'stop-timeout = 10'
  ]

  for (const model of models) {
    const modelId = getPresetModelId(model, modelsDir, usedIds)
    const mmproj = multimodalEnabled ? findModelMmproj(model.filepath) : null
    const draftModel = mtpEnabled ? findModelDraft(model.filepath) : null
    const mtpActive = mtpEnabled && (Boolean(draftModel) || hasInternalMtpSupport(model.filepath))
    const overrides = getPresetModelOverrides(model.filepath)

    lines.push('', `[${escapeIniSection(modelId)}]`)
    lines.push(`model = ${toIniPath(model.filepath, presetDir)}`)
    if (mmproj && !hasExplicitArg(extraArgs, '--mmproj')) {
      lines.push(`mmproj = ${toIniPath(mmproj, presetDir)}`)
    }
    if (mtpActive) {
      if (
        draftModel &&
        !hasExplicitArg(extraArgs, '--spec-draft-model') &&
        !hasExplicitArg(extraArgs, '--model-draft')
      ) {
        lines.push(`model-draft = ${toIniPath(draftModel, presetDir)}`)
      }
      lines.push('spec-type = draft-mtp')
      lines.push('spec-draft-n-max = 2')
    }
    for (const [key, value] of Object.entries(overrides)) {
      lines.push(`${key} = ${value}`)
    }
  }

  fs.mkdirSync(presetDir, { recursive: true })
  fs.writeFileSync(presetPath, `${lines.join('\n')}\n`, 'utf8')
  log.info(`Generated llama.cpp models preset at ${presetPath} with ${models.length} models`)
  return presetPath
}

const ensureAutoMmproj = async (
  modelsDir: string,
  extraArgs: string[] = [],
  onStatus?: (status: string) => void
): Promise<void> => {
  if (extraArgs.some((arg) => arg === '--mmproj' || arg.startsWith('--mmproj='))) return

  migrateOfficialRootModels(modelsDir)
  const modelFiles = listLocalLlmModels(modelsDir)
  for (const model of modelFiles) {
    const dir = path.dirname(model.filepath)
    const candidates = [path.join(dir, 'mmproj-F16.gguf'), path.join(dir, 'mmproj.gguf')]
    if (candidates.some((candidate) => fs.existsSync(candidate))) continue

    const mmprojPrefix = getMmprojPrefixForModel(path.basename(model.filepath))
    const repo = hasInternalMtpSupport(model.filepath)
      ? 'unsloth/Qwen3.6-35B-A3B-GGUF'
      : getMmprojRepoForPrefix(mmprojPrefix)
    if (!repo) continue

    const saveAs = 'mmproj-F16.gguf'
    const relativeDir = path.relative(modelsDir, dir)
    const subDir =
      relativeDir && relativeDir !== '.' && !relativeDir.startsWith('..') ? relativeDir : undefined

    try {
      const modelName = path.basename(model.filepath)
      onStatus?.(`Downloading vision projector for ${modelName}...`)
      const downloaded = await downloadModel(
        repo,
        'mmproj-F16.gguf',
        (progress) => {
          if (progress.totalBytes > 0) {
            onStatus?.(
              `Downloading vision projector for ${modelName} ${progress.percent.toFixed(0)}%`
            )
          }
        },
        undefined,
        undefined,
        saveAs,
        subDir ? path.basename(subDir) : mmprojPrefix,
        subDir
      )
      log.info(`Auto-downloaded multimodal projector: ${downloaded}`)
    } catch (error) {
      log.warn(`Failed to auto-download multimodal projector for ${model.filepath}:`, error)
      onStatus?.('Vision projector download failed; continuing setup')
    }
  }
}

const ensureAutoMtp = async (
  modelsDir: string,
  extraArgs: string[] = [],
  onStatus?: (status: string) => void
): Promise<void> => {
  if (
    extraArgs.some(
      (arg) =>
        arg === '--spec-draft-model' ||
        arg === '--model-draft' ||
        arg.startsWith('--spec-draft-model=') ||
        arg.startsWith('--model-draft=')
    )
  )
    return

  migrateOfficialRootModels(modelsDir)
  const modelFiles = listLocalLlmModels(modelsDir)
  for (const model of modelFiles) {
    const dir = path.dirname(model.filepath)
    if (hasInternalMtpSupport(model.filepath) || findModelDraft(model.filepath)) continue

    const mtpPrefix = getMmprojPrefixForModel(path.basename(model.filepath))
    const repo = getMtpRepoForPrefix(mtpPrefix)
    const filename = getMtpFilenameForPrefix(mtpPrefix)
    if (!repo || !filename) continue

    const relativeDir = path.relative(modelsDir, dir)
    const subDir =
      relativeDir && relativeDir !== '.' && !relativeDir.startsWith('..') ? relativeDir : undefined

    try {
      const modelName = path.basename(model.filepath)
      onStatus?.(`Downloading MTP draft model for ${modelName}...`)
      const downloaded = await downloadModel(
        repo,
        filename,
        (progress) => {
          if (progress.totalBytes > 0) {
            onStatus?.(
              `Downloading MTP draft model for ${modelName} ${progress.percent.toFixed(0)}%`
            )
          }
        },
        undefined,
        undefined,
        path.basename(filename),
        subDir ? path.basename(subDir) : mtpPrefix,
        subDir
      )
      log.info(`Auto-downloaded MTP draft model: ${downloaded}`)
    } catch (error) {
      log.warn(`Failed to auto-download MTP draft model for ${model.filepath}:`, error)
      onStatus?.('MTP draft model download failed; continuing setup')
    }
  }
}

export const setupLlamaCpp = async (onStatus?: (status: string) => void): Promise<string> => {
  const config = await getConfig()
  const llamaConfig = config.llamaCpp ?? {}
  const version = llamaConfig.version || 'latest'
  const configuredVariant = llamaConfig.variant
  const variant = resolveVariant(configuredVariant)

  if (!configuredVariant || configuredVariant === 'auto' || configuredVariant !== variant) {
    log.info(`Persisting detected variant to config: ${variant}`)
    await setConfig({ llamaCpp: { ...llamaConfig, variant } })
  }

  const cacheBase = path.join(getInstallDir(), 'llama.cpp')
  if (!fs.existsSync(cacheBase)) {
    fs.mkdirSync(cacheBase, { recursive: true })
  }

  // Check for existing cached binary before any network request
  // This allows llama.cpp to start offline when previously installed.
  if (version !== 'latest') {
    // Pinned version  - check its specific directory
    const pinnedDir = path.join(cacheBase, version)
    const pinnedBinary = fs.existsSync(pinnedDir) ? findBinary(pinnedDir) : null
    if (pinnedBinary && isCachedInstallReady(pinnedDir, pinnedBinary, variant)) {
      log.info(`Using cached llama-server binary (pinned ${version}): ${pinnedBinary}`)
      binaryPath = pinnedBinary
      onStatus?.('Ready')
      return pinnedBinary
    }
  } else {
    // 'latest'  - scan all cached version directories for a usable binary
    try {
      const cachedVersions = sortLlamaBuildTagsNewestFirst(
        fs
          .readdirSync(cacheBase, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
      )

      for (const cachedTag of cachedVersions) {
        const cachedDir = path.join(cacheBase, cachedTag)
        const cachedBinary = findBinary(cachedDir)
        if (cachedBinary && isCachedInstallReady(cachedDir, cachedBinary, variant)) {
          log.info(`Found cached llama-server binary (${cachedTag}): ${cachedBinary}`)
          // Still try to fetch release info to see if there's a newer version,
          // but if the network is unavailable, use the cached binary.
          binaryPath = cachedBinary
          break
        }
      }
    } catch {
      // Cache directory scan failed  - proceed to network fetch
    }
  }

  onStatus?.('Fetching release info...')
  const installReleaseWithFallback = async (): Promise<string> => {
    const badVersions: string[] = config.llamaCpp?.badVersions ?? []
    const fallbackVersion = config.llamaCpp?.fallbackVersion ?? DEFAULT_LLAMA_CPP_FALLBACK_VERSION
    let initialReleaseData: LlamaRelease | null = null
    try {
      initialReleaseData = await resolveLlamaRelease(version, variant)
    } catch (error) {
      if (version === 'latest') {
        try {
          log.warn(
            `Unable to discover the latest compatible llama.cpp nightly; trying ${fallbackVersion}:`,
            error
          )
          initialReleaseData = await fetchLlamaReleaseByTag(fallbackVersion)
        } catch (fallbackError) {
          if (binaryPath) {
            log.info('Network unavailable, using cached llama-server binary:', binaryPath)
            onStatus?.('Ready (offline)')
            return binaryPath
          }
          throw new Error(
            `Failed to fetch llama.cpp release info and no cached llama.cpp binary was found. ` +
              `Please connect to the internet for the initial llama.cpp installation. ` +
              `Latest error: ${describeGithubError(error)}. ` +
              `Fallback error: ${describeGithubError(fallbackError)}`
          )
        }
      } else {
        if (binaryPath) {
          log.info('Network unavailable, using cached llama-server binary:', binaryPath)
          onStatus?.('Ready (offline)')
          return binaryPath
        }
        throw new Error(
          `Failed to fetch llama.cpp release info and no cached llama.cpp binary was found. ` +
            `Please connect to the internet for the initial llama.cpp installation. ` +
            `Original error: ${describeGithubError(error)}`
        )
      }
    }

    if (!initialReleaseData) {
      throw new Error('Failed to resolve a llama.cpp release.')
    }

    const initialTag = initialReleaseData.tag_name
    const candidates = llamaReleaseCandidates(initialTag, fallbackVersion, badVersions)
    const failures: string[] = []

    const installRelease = async (releaseData: LlamaRelease): Promise<string> => {
      const tag = releaseData.tag_name
      log.info(`llama.cpp release tag: ${tag}`)

      const versionDir = path.join(cacheBase, tag)
      if (!fs.existsSync(versionDir)) {
        fs.mkdirSync(versionDir, { recursive: true })
      }

      const { patterns, isZip } = getLlamaAssetPatterns(
        tag,
        variant,
        process.platform,
        process.arch
      )
      const assets = releaseData.assets
      const asset = assets.find((candidate) =>
        patterns.some((pattern) => matchesAssetPattern(candidate.name, pattern))
      )
      if (!asset) {
        const available = assets.map((candidate) => candidate.name).join(', ')
        throw new Error(
          `No matching asset found for patterns "${patterns.join('", "')}". Available: ${available}`
        )
      }

      const existingBinary = findBinary(versionDir)
      if (existingBinary && !isCachedVariantCompatible(versionDir, variant)) {
        const installedVariant = readInstalledVariant(versionDir) ?? 'legacy/unknown'
        log.info(`Replacing cached llama.cpp ${installedVariant} build with ${variant}`)
        if (ptyProcess || pid) await stopLlamaCpp()
        fs.rmSync(versionDir, { recursive: true, force: true })
        fs.mkdirSync(versionDir, { recursive: true })
        if (binaryPath === existingBinary) binaryPath = null
      }

      let resultBinary = findBinary(versionDir)
      if (!resultBinary) {
        await downloadAndExtractReleaseAsset(asset, versionDir, versionDir, isZip, onStatus)
        resultBinary = findBinary(versionDir)
      }

      if (process.platform !== 'win32') {
        if (resultBinary) {
          try {
            fs.chmodSync(resultBinary, 0o755)
          } catch {}
        }
      }

      if (!resultBinary) {
        throw new Error(`llama-server binary not found after extraction in ${versionDir}`)
      }

      if (process.platform === 'win32' && variant.startsWith('cuda-')) {
        await ensureBundledCudaRuntime(assets, asset, versionDir, resultBinary, onStatus)
      }

      writeInstalledVariant(versionDir, variant)
      log.info(`llama-server binary ready: ${resultBinary}`)
      binaryPath = resultBinary
      onStatus?.('Ready')
      return resultBinary
    }

    for (const candidateTag of candidates) {
      try {
        const releaseData =
          candidateTag === initialTag
            ? initialReleaseData
            : await fetchLlamaReleaseByTag(candidateTag)

        if (candidateTag !== initialTag) {
          onStatus?.(`Latest llama.cpp is unavailable, trying ${candidateTag}...`)
        }

        const resultBinary = await installRelease(releaseData)
        if (version !== 'latest' && candidateTag !== version) {
          await setConfig({
            llamaCpp: {
              ...llamaConfig,
              version: candidateTag,
              fallbackVersion
            }
          })
        } else if (version === 'latest' && fallbackVersion !== config.llamaCpp?.fallbackVersion) {
          await setConfig({
            llamaCpp: {
              ...llamaConfig,
              version: 'latest',
              fallbackVersion
            }
          })
        }
        return resultBinary
      } catch (error) {
        const message = describeGithubError(error)
        failures.push(`${candidateTag}: ${message}`)
        log.warn(`Failed to install llama.cpp ${candidateTag}, trying previous release:`, error)
        try {
          const versionDir = path.join(cacheBase, candidateTag)
          const hasBinary = fs.existsSync(versionDir) ? Boolean(findBinary(versionDir)) : false
          if (!hasBinary && fs.existsSync(versionDir)) {
            fs.rmSync(versionDir, { recursive: true, force: true })
          }
        } catch {}
      }
    }

    throw new Error(
      `Unable to install a compatible llama.cpp release for this platform/variant. ` +
        `Tried: ${failures.join(' | ')}`
    )
  }

  return await installReleaseWithFallback()
}

export const startLlamaCppWithFallback = async (onStatus?: (status: string) => void) => {
  // write fallback version to config
  const config = await getConfig()
  const originalVersion = config.llamaCpp?.version || 'latest'
  const fallbackVersion = config.llamaCpp?.fallbackVersion ?? DEFAULT_LLAMA_CPP_FALLBACK_VERSION
  if (config.llamaCpp?.fallbackVersion !== fallbackVersion) {
    await setConfig({
      llamaCpp: { ...config.llamaCpp, fallbackVersion }
    })
  }

  try {
    return await startLlamaCpp(onStatus)
  } catch (err) {
    if (!(err instanceof LlamaStartError) || !err.canFallback) throw err
    const { version: currentInstalledTag } = getLlamaCppInfo()
    if (currentInstalledTag) {
      await markVersionBad(currentInstalledTag)
    }

    const config = await getConfig()
    await setConfig({
      llamaCpp: { ...config.llamaCpp, version: fallbackVersion }
    })

    onStatus?.(`Latest version failed, falling back to ${fallbackVersion}...`)
    log.warn(`Falling back to pinned fallback build: ${fallbackVersion}`)

    try {
      return await startLlamaCpp(onStatus)
    } finally {
      if (originalVersion === 'latest') {
        const latestConfig = await getConfig()
        await setConfig({
          llamaCpp: { ...latestConfig.llamaCpp, version: 'latest', fallbackVersion }
        })
      }
    }
  }
}

const markVersionBad = async (tag: string) => {
  const config = await getConfig()
  const fallbackVersion = config.llamaCpp?.fallbackVersion
  if (tag === fallbackVersion) {
    log.warn(`Fallback version ${tag} also failed, not marking as bad`)
    return
  }

  const bad = new Set(config.llamaCpp?.badVersions ?? [])
  bad.add(tag)
  await setConfig({ llamaCpp: { ...config.llamaCpp, badVersions: [...bad] } })
}

export const checkLlamaCppUpdate = async (): Promise<{
  currentVersion: string | null
  latestVersion: string | null
  updateAvailable: boolean
}> => {
  const currentInfo = getLlamaCppInfo()

  try {
    const config = await getConfig()
    const variant = resolveVariant(config.llamaCpp?.variant)
    const releaseData = await fetchLatestLlamaRelease(variant)
    const latestVersion = releaseData.tag_name
    const currentVersion = currentInfo.version

    if (!currentVersion) {
      return { currentVersion: null, latestVersion, updateAvailable: true }
    }

    return {
      currentVersion,
      latestVersion,
      updateAvailable: isNewerLlamaBuild(currentVersion, latestVersion)
    }
  } catch (error) {
    log.error('Failed to check for llama.cpp updates:', error)
    return {
      currentVersion: currentInfo.version,
      latestVersion: null,
      updateAvailable: false
    }
  }
}

export const updateLlamaCpp = async (
  onStatus?: (status: string) => void
): Promise<ReturnType<typeof getLlamaCppInfo>> => {
  onStatus?.('Checking for updates...')
  const config = await getConfig()
  const originalVersion = config.llamaCpp?.version || 'latest'
  const variant = resolveVariant(config.llamaCpp?.variant)
  let latestRelease: LlamaRelease
  try {
    latestRelease = await fetchLatestLlamaRelease(variant, true)
  } catch (error) {
    throw new Error(
      `Cannot update llama.cpp: unable to find a complete nightly release for this system. ` +
        `Please check your internet connection. (${describeGithubError(error)})`
    )
  }

  const currentInfo = getLlamaCppInfo()
  if (currentInfo.version && !isNewerLlamaBuild(currentInfo.version, latestRelease.tag_name)) {
    onStatus?.('Already up to date')
    scheduleLlamaCppVersionCleanup(currentInfo.version)
    return currentInfo
  }

  // Keep the old runtime until the replacement has downloaded and started.
  // An interrupted or incompatible update can therefore restart the working build.
  await stopLlamaCpp()
  await setConfig({ llamaCpp: { ...config.llamaCpp, version: 'latest', badVersions: [] } })

  try {
    onStatus?.(`Downloading llama.cpp ${latestRelease.tag_name}...`)
    await startLlamaCppWithFallback(onStatus)
  } catch (error) {
    if (currentInfo.version) {
      onStatus?.(`Update failed; restoring llama.cpp ${currentInfo.version}...`)
      const recoveryConfig = await getConfig()
      await setConfig({
        llamaCpp: { ...recoveryConfig.llamaCpp, version: currentInfo.version }
      })
      try {
        await startLlamaCpp(onStatus)
      } catch (recoveryError) {
        log.error(`Failed to restart previous llama.cpp ${currentInfo.version}:`, recoveryError)
      } finally {
        const restoredConfig = await getConfig()
        await setConfig({
          llamaCpp: { ...restoredConfig.llamaCpp, version: originalVersion }
        })
      }
    }
    throw error
  }

  const updatedInfo = getLlamaCppInfo()
  if (updatedInfo.version) {
    scheduleLlamaCppVersionCleanup(updatedInfo.version)
  }

  return updatedInfo
}

export const reinstallLlamaCpp = async (onStatus?: (status: string) => void): Promise<string> => {
  const currentInfo = getLlamaCppInfo()
  await stopLlamaCpp()

  if (currentInfo.version) {
    const cacheBase = path.join(getInstallDir(), 'llama.cpp')
    const versionDir = path.join(cacheBase, currentInfo.version)
    const relative = path.relative(cacheBase, versionDir)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Refusing to remove invalid llama.cpp cache path: ${versionDir}`)
    }
    if (fs.existsSync(versionDir)) {
      onStatus?.('Removing damaged llama.cpp runtime...')
      await deleteWithRetry(versionDir)
    }
  }

  binaryPath = null
  onStatus?.('Reinstalling llama.cpp runtime...')
  return await setupLlamaCpp(onStatus)
}

// -----------------------------------------------------------------------------
class LlamaStartError extends Error {
  constructor(
    msg: string,
    public readonly canFallback: boolean
  ) {
    super(msg)
  }
}

const startLlamaCppAttempt = async (
  onStatus?: (status: string) => void
): Promise<LlamaStartResult> => {
  await stopLlamaCpp({ preserveLock: true })

  status = 'setting-up'
  onStatus?.('Setting up llama.cpp...')

  const binary = await setupLlamaCpp(onStatus)

  status = 'starting'
  onStatus?.('Starting llama-server...')

  const config = await getConfig()
  const llamaConfig = config.llamaCpp ?? {}
  const host = '127.0.0.1'

  const variant = resolveVariant(llamaConfig.variant)
  log.info(`startLlamaCpp: using variant=${variant}`)

  const availablePort = llamaConfig.port || 18881
  if (await portInUse(availablePort, host)) {
    await releaseStaleInstalledLlamaServerPort(availablePort, host)
  }
  if (await portInUse(availablePort, host)) {
    status = 'failed'
    throw new LlamaStartError(
      `llama.cpp cannot start because port ${availablePort} is already in use. Close the program using this port, then restart llama.cpp.`,
      false
    )
  }

  const extraArgs = stripArgsWithValue(llamaConfig.extraArgs ?? [], [
    '--parallel',
    '-np',
    '--spec-type',
    '--spec-draft-n-max',
    '--spec-draft-model',
    '--model-draft'
  ])
  const modelsDir = path.join(getInstallDir(), 'models')
  const explicitModelsPreset = hasExplicitArg(extraArgs, '--models-preset')
  const explicitModel = hasExplicitArg(extraArgs, '--model') || extraArgs.includes('-m')
  const desktopOwnsEpubConceptModel = !explicitModelsPreset && !explicitModel
  if (desktopOwnsEpubConceptModel) {
    await ensureEpubConceptModel(onStatus)
  } else {
    log.info(
      'EPUB runtime descriptor disabled because llama.cpp uses an explicit model configuration'
    )
  }
  const modelsPreset = explicitModelsPreset
    ? null
    : await writeModelsPreset(modelsDir, llamaConfig, extraArgs, onStatus)
  const commandArgs = [
    '--host',
    host,
    '--port',
    availablePort.toString(),
    ...(modelsPreset ? ['--models-preset', modelsPreset] : []),
    '--models-max',
    '1',
    ...extraArgs
  ]

  log.info('Starting llama-server:', binary, commandArgs.join(' '))

  const spawnEnv = { ...process.env, ...(config.envVars ?? {}) }

  let spawned: pty.IPty
  try {
    spawned = pty.spawn(binary, commandArgs, {
      name: 'xterm-256color',
      cols: 200,
      rows: 50,
      cwd: modelsPreset ? path.dirname(modelsPreset) : undefined,
      env: spawnEnv
    })
  } catch (error) {
    status = 'failed'
    throw new Error(`Failed to spawn llama-server: ${getErrorMessage(error)}`)
  }

  let earlyExitReject: (err: LlamaStartError) => void
  const earlyExitPromise = new Promise<never>((_, reject) => {
    earlyExitReject = reject
  })

  const spawnedPid = spawned.pid
  logBuffer = []
  ptyProcess = spawned
  pid = spawnedPid
  let runtimeAnomalyReported = false
  let runtimeAnomalyTail = ''

  spawned.onData((data: string) => {
    logBuffer.push(data)
    log.info(`[llamacpp:${spawnedPid}] ${data.replace(/[\r\n]+/g, ' ').trim()}`)
    runtimeAnomalyTail = `${runtimeAnomalyTail}${data}`.slice(-8000)

    if (!runtimeAnomalyReported && hasLlamaCppRuntimeAnomaly(runtimeAnomalyTail)) {
      runtimeAnomalyReported = true
      const message = runtimeAnomalyTail
        .replace(/[\r\n]+/g, ' ')
        .trim()
        .slice(-500)
      setTimeout(() => runtimeAnomalyHandler?.(message), 0)
    }
  })

  spawned.onExit(({ exitCode, signal }) => {
    log.info(`[llamacpp:${spawnedPid}] Exited code=${exitCode} signal=${signal}`)
    const isCurrentProcess = pid === spawnedPid && ptyProcess === spawned
    if (!isCurrentProcess) {
      log.info(
        `[llamacpp:${spawnedPid}] Ignoring stale exit event; another llama-server instance is active`
      )
      return
    }

    const exitMsg = `\r\n[Process exited with code ${exitCode}${signal ? ` signal ${signal}` : ''}]\r\n`
    logBuffer.push(exitMsg)
    ptyProcess = null
    pid = null
    url = null
    status = 'stopped'
    removeEpubConceptRuntimeDescriptor()
    if (!startPromise) lock.release()

    if (!intentionalStop) {
      const error = `llama-server exited early (code=${exitCode}${signal ? ` signal=${signal}` : ''})`
      log.info(error)
      if (!runtimeAnomalyReported) {
        runtimeAnomalyReported = true
        setTimeout(() => runtimeAnomalyHandler?.(error), 0)
      }
      earlyExitReject(new LlamaStartError(error, true))
    }
  })

  const serverUrl = `http://${host}:${availablePort}`
  const startupTimeoutMs = llamaConfig.mtpEnabled === true ? 180000 : 60000

  const healthCheckPromise = (async (): Promise<boolean> => {
    const deadline = Date.now() + startupTimeoutMs
    let lastStatusUpdate = 0
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000))
      try {
        const resp = await fetch(`${serverUrl}/health`, { signal: AbortSignal.timeout(2000) })
        if (resp.ok) {
          const body = await resp.json()
          if (body.status === 'ok' || body.status === 'no slot available') {
            return true
          }
        }
      } catch {
        // Not ready yet
      }
      const elapsed = Date.now() - (deadline - startupTimeoutMs)
      if (elapsed - lastStatusUpdate >= 15000) {
        const seconds = Math.round(elapsed / 1000)
        onStatus?.(
          llamaConfig.mtpEnabled === true
            ? `Waiting for llama-server and MTP model support... ${seconds}s`
            : `Waiting for llama-server... ${seconds}s`
        )
        lastStatusUpdate = elapsed
      }
    }
    return false
  })()

  let ready: boolean
  try {
    ready = await Promise.race([healthCheckPromise, earlyExitPromise])
  } catch (err) {
    status = 'failed'
    try {
      spawned.kill()
    } catch {}
    throw err
  }

  if (!ready) {
    status = 'failed'
    try {
      spawned.kill()
    } catch {}
    throw new LlamaStartError(
      `llama-server did not report healthy within ${Math.round(startupTimeoutMs / 1000)}s`,
      true
    )
  }

  url = serverUrl
  status = 'started'
  if (desktopOwnsEpubConceptModel) {
    try {
      writeEpubConceptRuntimeDescriptor(serverUrl)
    } catch (error) {
      await stopLlamaCpp()
      throw error
    }
  }
  log.info(`llama-server started  - PID: ${spawnedPid}, URL: ${serverUrl}`)

  return { url: serverUrl, pid: spawnedPid }
}

export const startLlamaCpp = async (
  onStatus?: (status: string) => void
): Promise<LlamaStartResult> => {
  if (startPromise) {
    log.info('llama.cpp startup already in progress; reusing the active startup task')
    return await startPromise
  }

  if (status === 'started' && url && pid && isPidRunning(pid)) return { url, pid }

  if (lock.isLocked() && (!pid || !isPidRunning(pid))) lock.release()
  if (!lock.acquire()) {
    if (url && pid && isPidRunning(pid)) return { url, pid }
    throw new Error('llama.cpp is already starting')
  }

  const attempt = startLlamaCppAttempt(onStatus)
  startPromise = attempt
  try {
    return await attempt
  } finally {
    if (startPromise === attempt) startPromise = null
    if (status !== 'started') lock.release()
  }
}

type StopLlamaCppOptions = {
  preserveLock?: boolean
}

export const stopLlamaCpp = async (options: StopLlamaCppOptions = {}): Promise<void> => {
  removeEpubConceptRuntimeDescriptor()
  const currentPid = pid
  if (ptyProcess) {
    intentionalStop = true
    try {
      ptyProcess.kill()
    } catch (e) {
      log.warn('Failed to kill llama-server PTY:', e)
    }
  }

  if (currentPid) {
    await sleep(1500)
    if (isPidRunning(currentPid)) {
      log.warn(
        `llama-server PID ${currentPid} still running after PTY kill; terminating process tree`
      )
      await terminateProcessTree(currentPid, false)
    }
    if (isPidRunning(currentPid)) {
      log.warn(
        `llama-server PID ${currentPid} still running after graceful termination; force killing`
      )
      await terminateProcessTree(currentPid, true)
    }
    if (isPidRunning(currentPid)) {
      log.error(`Failed to terminate llama-server PID ${currentPid}`)
    }
  }

  ptyProcess = null
  pid = null
  url = null
  status = null
  logBuffer = []
  if (!options.preserveLock) lock.release()
  intentionalStop = false
}

/**
 * Validate whether the tracked llama.cpp process is still alive.
 * Used for crash recovery on app startup.
 */
export const validateLlamaCppProcess = (): boolean => {
  if (pid && isProcessAlive(pid)) return true

  // Desktop state is in-memory, so a cold start has no PID even if a prior
  // process left its handoff descriptor behind.  Treat both a missing and a
  // dead PID as stale state.  This deliberately does not signal any PID: the
  // descriptor is only valid while this process is actively tracking it.
  pid = null
  status = null
  removeEpubConceptRuntimeDescriptor()
  lock.release()
  return false
}

/**
 * Uninstall llama.cpp  - stop the server and remove all downloaded binaries.
 */
export const uninstallLlamaCpp = async (): Promise<void> => {
  await stopLlamaCpp()
  await new Promise((r) => setTimeout(r, 1000))

  const cacheBase = path.join(getInstallDir(), 'llama.cpp')
  if (fs.existsSync(cacheBase)) {
    await deleteWithRetry(cacheBase)
    log.info('Removed llama.cpp directory:', cacheBase)
  }

  binaryPath = null
}

const deleteWithRetry = async (dirPath: string, maxRetries = 5, delayMs = 1000): Promise<void> => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true })
      return
    } catch (err: unknown) {
      const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined
      if (code === 'EPERM' || code === 'EBUSY') {
        if (i < maxRetries - 1) {
          log.warn(
            `Failed to delete ${dirPath}, retrying in ${delayMs}ms... (${i + 1}/${maxRetries})`
          )
          await new Promise((r) => setTimeout(r, delayMs))
        }
      } else {
        throw err
      }
    }
  }
  throw new Error(`Failed to delete ${dirPath} after ${maxRetries} retries (files still in use)`)
}
