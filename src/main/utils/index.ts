import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import net from 'net'
import crypto from 'crypto'
import { createGunzip } from 'zlib'
import { pipeline } from 'stream/promises'

import * as tar from 'tar'

import { app, shell, net as electronNet, session } from 'electron'
import { execFileSync, spawn, execSync, execFile } from 'child_process'

import log from 'electron-log'
log.transports.file.resolvePathFn = () => getLogFilePath('main')

const serverLogger = log.create({ logId: 'server' })
serverLogger.transports.file.resolvePath = () => getLogFilePath('server')

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// ─── Paths ──────────────────────────────────────────────

export const getLogFilePath = (name: string = 'main'): string => {
  const logDir = path.join(getUserDataPath(), 'logs')
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true })
  }
  return path.join(logDir, `${name}.log`)
}

export const getAppPath = (): string => {
  let appPath = app.getAppPath()
  if (app.isPackaged) {
    appPath = path.dirname(appPath)
  }
  return path.normalize(appPath)
}

export const getUserHomePath = (): string => {
  return path.normalize(app.getPath('home'))
}

export const getUserDataPath = (): string => {
  const userDataDir = app.getPath('userData')
  if (!fs.existsSync(userDataDir)) {
    try {
      fs.mkdirSync(userDataDir, { recursive: true })
    } catch (error) {
      log.error(error)
    }
  }
  return path.normalize(userDataDir)
}

/**
 * Root directory for heavyweight data (Python, models, llama.cpp).
 * Reads `installDir` from config.json synchronously so it's available
 * before any async init. Falls back to `getUserDataPath()`.
 */
export const getInstallDir = (): string => {
  const configPath = path.join(getUserDataPath(), 'config.json')
  let customDir = ''
  try {
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      customDir = data.installDir || ''
    }
  } catch {}
  const installDir = customDir || getUserDataPath()
  if (!fs.existsSync(installDir)) {
    try {
      fs.mkdirSync(installDir, { recursive: true })
    } catch (error) {
      log.error(error)
    }
  }
  return path.normalize(installDir)
}

export const getOpenWebUIDataPath = (): string => {
  // Check config for custom data directory
  const configPath = path.join(getUserDataPath(), 'config.json')
  let customDir = ''
  try {
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      customDir = data.dataDir || ''
    }
  } catch {}
  const openWebUIDataDir = customDir || path.join(getInstallDir(), 'data')
  if (!fs.existsSync(openWebUIDataDir)) {
    try {
      fs.mkdirSync(openWebUIDataDir, { recursive: true })
    } catch (error) {
      log.error(error)
    }
  }
  return path.normalize(openWebUIDataDir)
}

/**
 * Desktop-owned handoff for local services which need the currently selected
 * llama.cpp endpoint.  The file contains no credentials and is kept beneath
 * the Desktop-managed install root so it follows an explicitly configured
 * installation location.
 */
export const getEpubConceptRuntimeFilePath = (): string =>
  path.join(getInstallDir(), 'epub-concept', 'desktop-llm-runtime.json')

export const getLocalOpenWebUISourcePath = (): string | null => {
  const candidates = [
    path.resolve(getAppPath(), '..', 'webui-main'),
    path.resolve(getAppPath(), '..', 'AuraPro-WebUI'),
    path.resolve(getAppPath(), '..', 'AuraPro-UI'),
    path.resolve(getAppPath(), '..', '..', 'webui-main'),
    path.resolve(getAppPath(), '..', '..', 'AuraPro-WebUI'),
    path.resolve(getAppPath(), '..', '..', 'AuraPro-UI'),
    path.resolve(process.cwd(), '..', 'webui-main'),
    path.resolve(process.cwd(), '..', 'AuraPro-WebUI'),
    path.resolve(process.cwd(), '..', 'AuraPro-UI'),
    path.resolve(process.cwd(), '..', '..', 'webui-main'),
    path.resolve(process.cwd(), '..', '..', 'AuraPro-WebUI'),
    path.resolve(process.cwd(), '..', '..', 'AuraPro-UI'),
    path.join(process.resourcesPath ?? '', 'webui-main'),
    path.join(process.resourcesPath ?? '', 'AuraPro-WebUI'),
    path.join(process.resourcesPath ?? '', 'AuraPro-UI')
  ]

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(path.join(candidate, 'pyproject.toml'))) {
      return path.normalize(candidate)
    }
  }

  return null
}

export const AURAPRO_UI_TARGET_VERSION = '3.9.18'
export const AURAPRO_UI_MIN_VERSION = '3.6.0'
export const AURAPRO_UI_LATEST_VERSION = 'latest'
export const AURAPRO_UI_LAST_VERSION = '3.9.3'
export const AURAPRO_WEBUI_FIRST_VERSION = '3.9.4'
const AURAPRO_UI_REPAIR_VERSIONS = new Set(['3.9.16', '3.9.17'])

const parseSemver = (version?: string | null): number[] | null => {
  const match = `${version ?? ''}`
    .trim()
    .replace(/^v/i, '')
    .match(/^(\d+)\.(\d+)\.(\d+)$/)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

const compareSemver = (left: string, right: string): number => {
  const a = parseSemver(left)
  const b = parseSemver(right)
  if (!a || !b) return Number.NaN

  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}

const isVersionAtOrBefore = (version: string, boundary: string): boolean => {
  const coreVersion = version
    .trim()
    .replace(/^v/i, '')
    .match(/^(\d+\.\d+\.\d+)/)?.[1]
  return Boolean(coreVersion && compareSemver(coreVersion, boundary) <= 0)
}

export const isSupportedOpenWebUIVersion = (version?: string | null): boolean => {
  const normalized = `${version ?? ''}`.trim().replace(/^v/i, '')
  return parseSemver(normalized) !== null && compareSemver(normalized, AURAPRO_UI_MIN_VERSION) >= 0
}

export const resolveOpenWebUITargetVersion = (version?: string | null): string => {
  const requested = `${version ?? ''}`.trim().replace(/^v/i, '')
  if (requested === '') return AURAPRO_UI_TARGET_VERSION
  if (requested.toLowerCase() === AURAPRO_UI_LATEST_VERSION) return AURAPRO_UI_LATEST_VERSION
  if (AURAPRO_UI_REPAIR_VERSIONS.has(requested)) return AURAPRO_UI_TARGET_VERSION

  const normalized = requested
  if (!isSupportedOpenWebUIVersion(normalized)) {
    throw new Error(
      `Open WebUI distribution version ${normalized} is not supported. Please use latest or version ` +
        `${AURAPRO_UI_MIN_VERSION} or newer.`
    )
  }
  return normalized
}

const isLatestOpenWebUITarget = (version: string): boolean =>
  version.toLowerCase() === AURAPRO_UI_LATEST_VERSION

export const getOpenWebUIPackageNameForVersion = (
  version?: string | null
): 'aurapro-webui' | 'aurapro-ui' => {
  const normalized = `${version ?? ''}`.trim().replace(/^v/i, '')
  if (!normalized || normalized.toLowerCase() === AURAPRO_UI_LATEST_VERSION) {
    return 'aurapro-webui'
  }
  return compareSemver(normalized, AURAPRO_WEBUI_FIRST_VERSION) >= 0
    ? 'aurapro-webui'
    : 'aurapro-ui'
}

const normalizeOpenWebUIPackageSource = (source: string, version?: string): string => {
  const trimmed = source.trim()
  if (!trimmed) return ''
  if (version && /^(aurapro-webui|aurapro-ui|open-webui)\s*([=<>!~]=?|$)/i.test(trimmed)) {
    return `${getOpenWebUIPackageNameForVersion(version)}==${version}`
  }
  return trimmed
}

export const getOpenWebUIPackageSource = (version?: string): string => {
  const configPath = path.join(getUserDataPath(), 'config.json')
  let configuredSource = ''
  try {
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      configuredSource = data.localServer?.packageSource || ''
    }
  } catch {}

  return (
    normalizeOpenWebUIPackageSource(process.env['AURAPRO_WEBUI_PACKAGE_SOURCE'] || '', version) ||
    normalizeOpenWebUIPackageSource(configuredSource, version) ||
    (version ? `${getOpenWebUIPackageNameForVersion(version)}==${version}` : 'aurapro-webui')
  )
}

export const getFfmpegDir = (): string => {
  const pythonDir = getPythonInstallationDir()
  if (process.platform === 'win32') {
    return path.join(pythonDir, 'Scripts')
  }
  return path.join(pythonDir, 'bin')
}

export const getFfmpegPath = (): string => {
  const ext = process.platform === 'win32' ? '.exe' : ''
  return path.join(getFfmpegDir(), `ffmpeg${ext}`)
}

export const getFfprobePath = (): string => {
  const ext = process.platform === 'win32' ? '.exe' : ''
  return path.join(getFfmpegDir(), `ffprobe${ext}`)
}

export const isFfmpegInstalled = (): boolean => {
  // 1. Check in our custom install directory first (preferred)
  if (fs.existsSync(getFfmpegPath()) && fs.existsSync(getFfprobePath())) {
    try {
      execSync(`"${getFfmpegPath()}" -version`, { stdio: 'ignore' })
      execSync(`"${getFfprobePath()}" -version`, { stdio: 'ignore' })
      return true
    } catch {}
  }

  // 2. Check in system PATH
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which'
    execSync(`${cmd} ffmpeg`, { stdio: 'ignore' })
    execSync(`${cmd} ffprobe`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export const installFfmpeg = async (onStatus?: (status: string) => void): Promise<boolean> => {
  const platform = process.platform
  const arch = process.arch

  let binaryName = ''
  if (platform === 'darwin') {
    binaryName = arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64'
  } else if (platform === 'linux') {
    binaryName = arch === 'arm64' ? 'linux-arm64' : 'linux-x64'
  } else if (platform === 'win32') {
    binaryName = 'win32-x64' // Windows ARM64 runs x64 via emulation if native not available
  } else {
    throw new Error(`Unsupported platform for ffmpeg auto-install: ${platform}`)
  }

  const releaseUrl = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1'
  const binaries = [
    {
      name: 'ffmpeg',
      url: `${releaseUrl}/ffmpeg-${binaryName}.gz`,
      downloadPath: path.join(os.tmpdir(), `ffmpeg-${binaryName}.gz`),
      targetPath: getFfmpegPath()
    },
    {
      name: 'ffprobe',
      url: `${releaseUrl}/ffprobe-${binaryName}.gz`,
      downloadPath: path.join(os.tmpdir(), `ffprobe-${binaryName}.gz`),
      targetPath: getFfprobePath()
    }
  ]

  try {
    const ffmpegDir = getFfmpegDir()
    if (!fs.existsSync(ffmpegDir)) {
      fs.mkdirSync(ffmpegDir, { recursive: true })
    }

    for (const binary of binaries) {
      onStatus?.(`Downloading ${binary.name}...`)
      log.info(`Downloading ${binary.name} from ${binary.url}`)
      await downloadFileWithProgress(
        binary.url,
        binary.downloadPath,
        (progress, downloaded, total, bytesPerSecond, etaSeconds) => {
          onStatus?.(
            `Downloading ${binary.name}... ${Math.floor(progress)}% ` +
              `(${formatDownloadBytes(downloaded)}/${formatDownloadBytes(total)} | ${formatDownloadSpeed(bytesPerSecond)} | ETA ${formatDownloadEta(etaSeconds)})`
          )
        }
      )

      onStatus?.(`Extracting ${binary.name}...`)
      log.info(`Extracting ${binary.name} to ${binary.targetPath}`)
      await pipeline(
        fs.createReadStream(binary.downloadPath),
        createGunzip(),
        fs.createWriteStream(binary.targetPath)
      )

      if (platform !== 'win32') {
        fs.chmodSync(binary.targetPath, 0o755)
      }
    }

    log.info('ffmpeg and ffprobe installed successfully')
    for (const binary of binaries) {
      try {
        fs.unlinkSync(binary.downloadPath)
      } catch {}
    }
    return true
  } catch (error: unknown) {
    log.error('ffmpeg/ffprobe installation failed:', error)
    for (const binary of binaries) {
      try {
        if (fs.existsSync(binary.downloadPath)) fs.unlinkSync(binary.downloadPath)
      } catch {}
    }
    throw new Error(`Failed to install ffmpeg/ffprobe: ${getErrorMessage(error)}`)
  }
}

export const ensureFfmpeg = async (onStatus?: (status: string) => void): Promise<void> => {
  if (!isFfmpegInstalled()) {
    log.info('ffmpeg not found, initiating install...')
    await installFfmpeg(onStatus)
  }
}

export const openUrl = (url: string) => {
  if (!url) {
    throw new Error('No URL provided to open in browser.')
  }
  log.info('Opening URL in browser:', url)
  if (/^https?:\/\/0\.0\.0\.0/.test(url)) {
    url = url.replace(/^https?:\/\/0\.0\.0\.0/, (match) => match.replace('0.0.0.0', 'localhost'))
  }
  shell.openExternal(url)
}

export const getLocalNetworkUrls = (port: number): string[] => {
  const candidates: { url: string; score: number }[] = []
  const interfaces = os.networkInterfaces()
  const vpnNamePattern =
    /(vpn|surfshark|wireguard|wintun|openvpn|tap|tun|tailscale|zerotier|hamachi|nord|clash|virtualbox|vmware|hyper-v|wsl)/i
  const physicalNamePattern = /(wi-?fi|wlan|wireless|ethernet|以太网|无线|本地连接)/i

  for (const [name, entries] of Object.entries(interfaces)) {
    const looksVirtual = vpnNamePattern.test(name)
    for (const entry of entries ?? []) {
      if (!entry || entry.family !== 'IPv4' || entry.internal) continue
      const address = entry.address
      const isPrivate =
        address.startsWith('10.') ||
        address.startsWith('192.168.') ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(address)
      if (!isPrivate) continue

      let score = 50
      if (address.startsWith('192.168.')) score = 0
      else if (address.startsWith('10.')) score = 20
      else score = 30
      if (physicalNamePattern.test(name)) score -= 10
      if (looksVirtual) score += 100

      candidates.push({ url: `http://${address}:${port}`, score })
    }
  }

  return Array.from(
    new Map(
      candidates.sort((a, b) => a.score - b.score).map((item) => [item.url, item.url])
    ).values()
  )
}

export const getLocalNetworkAddresses = (): string[] =>
  getLocalNetworkUrls(0)
    .map((url) => url.replace(/^http:\/\//, '').replace(/:0$/, ''))
    .filter(Boolean)

const isIntegratedGpuName = (name: string): boolean => {
  const value = name.toLowerCase()
  if (
    !value ||
    value.includes('microsoft basic') ||
    value.includes('virtualbox') ||
    value.includes('vmware')
  )
    return true
  if (value.includes('intel') && /(uhd|iris|hd graphics|graphics)/.test(value)) return true
  if (
    /(radeon\(tm\) graphics|radeon graphics|vega \d+)/.test(value) &&
    !/(rx|pro|wx|firepro)/.test(value)
  )
    return true
  return false
}

const parseDxdiagDedicatedVramGB = (): number => {
  if (process.platform !== 'win32') return 0

  const tmpPath = path.join(os.tmpdir(), `aurapro-dxdiag-${Date.now()}.txt`)
  try {
    execFileSync('dxdiag', ['/t', tmpPath], { timeout: 30000, windowsHide: true })
    if (!fs.existsSync(tmpPath)) return 0

    const bytes = fs.readFileSync(tmpPath)
    const text = bytes.includes(0) ? bytes.toString('utf16le') : bytes.toString('utf8')
    const devices: Array<{ name: string; dedicatedMb: number }> = []
    let current: { name: string; dedicatedMb: number } | null = null

    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim()
      const nameMatch = line.match(/^Card name:\s*(.+)$/i)
      if (nameMatch) {
        if (current) devices.push(current)
        current = { name: nameMatch[1].trim(), dedicatedMb: 0 }
        continue
      }

      const memoryMatch = line.match(/^Dedicated Memory:\s*([0-9]+)\s*MB/i)
      if (memoryMatch && current) {
        current.dedicatedMb = Number(memoryMatch[1]) || 0
      }
    }

    if (current) devices.push(current)

    const dedicatedGpuMemory = devices
      .filter((device) => !isIntegratedGpuName(device.name))
      .map((device) => device.dedicatedMb)
      .filter((mb) => mb > 0)

    const maxDedicatedMb = dedicatedGpuMemory.length > 0 ? Math.max(...dedicatedGpuMemory) : 0
    return Math.round(maxDedicatedMb / 1024)
  } catch (e) {
    log.warn('Failed to get dedicated GPU memory via dxdiag:', e)
    return 0
  } finally {
    fs.rmSync(tmpPath, { force: true })
  }
}

const getLinuxDedicatedVramGB = (): number => {
  if (process.platform !== 'linux') return 0

  try {
    const output = execFileSync(
      'nvidia-smi',
      ['--query-gpu=memory.total', '--format=csv,noheader,nounits'],
      {
        encoding: 'utf-8',
        timeout: 5000
      }
    )
    const values = output
      .split(/\r?\n/)
      .map((line) => Number(line.trim()))
      .filter((value) => Number.isFinite(value) && value > 0)
    if (values.length > 0) return Math.round(Math.max(...values) / 1024)
  } catch {
    // Non-NVIDIA Linux systems can still run; model recommendation will stay conservative.
  }

  return 0
}

export const getSystemInfo = async (options: { includeDedicatedVram?: boolean } = {}) => {
  const totalMem = os.totalmem()
  const totalMemGB = Math.round(totalMem / (1024 * 1024 * 1024))

  let gpuName = ''
  let dedicatedVramGB = 0
  try {
    if (process.platform === 'win32') {
      const output = execSync('wmic path win32_VideoController get name', {
        encoding: 'utf-8',
        windowsHide: true,
        timeout: 10000
      })
      const lines = output
        .split('\r\n')
        .map((l) => l.trim())
        .filter((l) => l && l !== 'Name')
      gpuName = lines.join(', ')
      dedicatedVramGB = options.includeDedicatedVram ? parseDxdiagDedicatedVramGB() : 0
    } else if (process.platform === 'darwin') {
      const output = execSync("system_profiler SPDisplaysDataType | grep 'Chipset Model'", {
        encoding: 'utf-8'
      })
      const lines = output
        .split('\n')
        .map((l) => l.split(':')[1]?.trim())
        .filter((l) => l)
      gpuName = lines.join(', ')
    } else if (process.platform === 'linux') {
      dedicatedVramGB = options.includeDedicatedVram ? getLinuxDedicatedVramGB() : 0
    }
  } catch (e) {
    log.warn('Failed to get GPU info via CLI:', e)
  }

  return {
    platform: os.platform(),
    architecture: os.arch(),
    totalMemGB,
    gpuName,
    dedicatedVramGB
  }
}

export const getSecretKey = (keyPath?: string, key?: string): string => {
  keyPath = keyPath || path.join(getOpenWebUIDataPath(), '.key')
  if (fs.existsSync(keyPath)) {
    return fs.readFileSync(keyPath, 'utf-8')
  }
  key = key || crypto.randomBytes(64).toString('hex')
  fs.writeFileSync(keyPath, key)
  return key
}

// ─── Port Utils ─────────────────────────────────────────

export const portInUse = async (port: number, host: string = '0.0.0.0'): Promise<boolean> => {
  return new Promise((resolve) => {
    const client = new net.Socket()
    client
      .setTimeout(1000)
      .once('connect', () => {
        client.destroy()
        resolve(true)
      })
      .once('timeout', () => {
        client.destroy()
        resolve(false)
      })
      .once('error', () => {
        resolve(false)
      })
      .connect(port, host)
  })
}

// ─── Python Download & Install ──────────────────────────

const getPlatformString = () => {
  const platformMap = {
    darwin: 'apple-darwin',
    win32: 'pc-windows-msvc',
    linux: 'unknown-linux-gnu'
  }
  return platformMap[os.platform()] || 'unknown-linux-gnu'
}

const getArchString = () => {
  const archMap = {
    x64: 'x86_64',
    arm64: 'aarch64',
    ia32: 'i686'
  }
  return archMap[os.arch()] || 'x86_64'
}

const generateDownloadUrl = () => {
  const baseUrl = 'https://github.com/astral-sh/python-build-standalone/releases/download'
  const releaseDate = '20260310'
  const pythonVersion = '3.12.13'
  const archString = getArchString()
  const platformString = getPlatformString()
  const filename = `cpython-${pythonVersion}+${releaseDate}-${archString}-${platformString}-install_only.tar.gz`
  return `${baseUrl}/${releaseDate}/${filename}`
}

const parseContentRangeTotal = (contentRange: string | null): number => {
  if (!contentRange) return 0
  const match = contentRange.match(/\/(\d+)$/)
  return match ? Number(match[1]) || 0 : 0
}

export type DownloadProgressCallback = (
  progress: number,
  downloaded: number,
  total: number,
  bytesPerSecond: number,
  etaSeconds?: number
) => void

export const downloadFileWithProgress = async (
  url: string,
  downloadPath: string,
  onProgress?: DownloadProgressCallback | null
): Promise<string> => {
  const tmpPath = `${downloadPath}.tmp`
  let resumeBytes = 0
  let writeStream: fs.WriteStream | null = null
  const startedAt = Date.now()

  try {
    if (fs.existsSync(downloadPath)) {
      log.info('File already downloaded:', downloadPath)
      return downloadPath
    }

    if (fs.existsSync(tmpPath)) {
      resumeBytes = fs.statSync(tmpPath).size
    }

    const headers: Record<string, string> = {}
    if (resumeBytes > 0) {
      headers.Range = `bytes=${resumeBytes}-`
      log.info(`Resuming download from byte ${resumeBytes}: ${url}`)
    }

    let response = await fetch(url, { headers })
    if (response?.status === 416 && resumeBytes > 0) {
      const totalFromRange = parseContentRangeTotal(response.headers.get('content-range'))
      if (totalFromRange > 0 && resumeBytes >= totalFromRange) {
        fs.renameSync(tmpPath, downloadPath)
        log.info('Resumed file was already complete:', downloadPath)
        return downloadPath
      }
      log.warn(`Partial download is not resumable for ${url}; restarting download`)
      try {
        fs.unlinkSync(tmpPath)
      } catch {}
      resumeBytes = 0
      response = await fetch(url)
    }

    if (!response || !response.ok) {
      throw new Error(`HTTP error! status: ${response?.status}`)
    }

    if (resumeBytes > 0 && response.status !== 206) {
      log.warn(`Server ignored Range request for ${url}; restarting download`)
      try {
        fs.unlinkSync(tmpPath)
      } catch {}
      resumeBytes = 0
    }

    const contentLength = parseInt(response.headers.get('content-length') ?? '0', 10)
    const totalFromRange = parseContentRangeTotal(response.headers.get('content-range'))
    const totalSize =
      totalFromRange || (response.status === 206 ? resumeBytes + contentLength : contentLength)
    let downloadedSize = resumeBytes
    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('Response body is not readable')
    }

    fs.mkdirSync(path.dirname(downloadPath), { recursive: true })
    writeStream = fs.createWriteStream(tmpPath, { flags: resumeBytes > 0 ? 'a' : 'w' })

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      writeStream.write(Buffer.from(value))
      downloadedSize += value.length
      if (onProgress && totalSize) {
        const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.1)
        const bytesPerSecond = Math.max((downloadedSize - resumeBytes) / elapsedSeconds, 0)
        const remainingBytes = Math.max(totalSize - downloadedSize, 0)
        onProgress(
          (downloadedSize / totalSize) * 100,
          downloadedSize,
          totalSize,
          bytesPerSecond,
          bytesPerSecond > 0 ? remainingBytes / bytesPerSecond : undefined
        )
      }
    }

    await new Promise<void>((resolve, reject) => {
      writeStream?.once('error', reject)
      writeStream?.end(resolve)
    })
    writeStream = null

    fs.renameSync(tmpPath, downloadPath)
    log.info('File downloaded successfully:', downloadPath)
    return downloadPath
  } catch (error) {
    try {
      writeStream?.end()
    } catch {}
    log.error('Download failed; partial file kept for retry:', error)
    throw error
  }
}

export const formatDownloadBytes = (bytes?: number): string => {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const digits = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(digits)} ${units[unitIndex]}`
}

export const formatDownloadSpeed = (bytesPerSecond?: number): string =>
  bytesPerSecond && Number.isFinite(bytesPerSecond) && bytesPerSecond > 0
    ? `${formatDownloadBytes(bytesPerSecond)}/s`
    : '--'

export const formatDownloadEta = (seconds?: number): string => {
  if (!seconds || !Number.isFinite(seconds) || seconds < 0) return '--'
  const rounded = Math.ceil(seconds)
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  const remainingSeconds = rounded % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`
  return `${remainingSeconds}s`
}

export const getPythonDownloadPath = (): string => {
  return path.join(getUserDataPath(), 'python.tar.gz')
}

export const getPythonInstallationDir = (): string => {
  const pythonDir = path.join(getInstallDir(), 'python')
  if (!fs.existsSync(pythonDir)) {
    try {
      fs.mkdirSync(pythonDir, { recursive: true })
    } catch (error) {
      log.error(error)
    }
  }
  return path.normalize(pythonDir)
}

const downloadPython = async (
  onProgress: DownloadProgressCallback | null = null
): Promise<string> => {
  const url = generateDownloadUrl()
  const downloadPath = getPythonDownloadPath()

  log.info(`Detected system: ${os.platform()} ${os.arch()}`)
  log.info(`Download path: ${downloadPath}`)
  log.info(`URL: ${url}`)

  if (fs.existsSync(downloadPath)) {
    log.info(`File already exists: ${downloadPath}`)
    return downloadPath
  }

  try {
    const result = await downloadFileWithProgress(url, downloadPath, onProgress)
    log.info(`Python downloaded successfully to: ${result}`)
    return result
  } catch (error) {
    log.error(`Download failed: ${getErrorMessage(error)}`)
    throw error
  }
}

const checkInternet = async () => {
  // Neutral connectivity probe (the Windows NCSI endpoint) so the app does not
  // depend on or phone home to any upstream project's infrastructure.
  try {
    await fetch('http://www.msftconnecttest.com/connecttest.txt', { method: 'GET' })
    return true
  } catch {
    return false
  }
}

export const installPython = async (
  installationDir?: string,
  onStatus?: (status: string) => void
): Promise<boolean> => {
  const pythonDownloadPath = getPythonDownloadPath()
  if (!fs.existsSync(pythonDownloadPath)) {
    if (!(await checkInternet())) {
      throw new Error(
        'An active internet connection is required. Please connect to the internet and try again.'
      )
    }
    let lastReportedPct = -1
    await downloadPython((progress, downloaded, total, bytesPerSecond, etaSeconds) => {
      const pct = Math.floor(progress)
      if (pct === lastReportedPct) return
      lastReportedPct = pct
      const detail = `${formatDownloadBytes(downloaded)}/${formatDownloadBytes(total)} · ${formatDownloadSpeed(bytesPerSecond)} · ETA ${formatDownloadEta(etaSeconds)}`
      log.info(`Downloading Python: ${pct}% (${detail})`)
      onStatus?.(`Downloading Python… ${pct}% (${detail})`)
    })
  }
  if (!fs.existsSync(pythonDownloadPath)) {
    log.error('Python download not found after download attempt')
    throw new Error(
      'Python download failed. The downloaded file was not found on disk. Please check your disk space and permissions.'
    )
  }

  installationDir = installationDir || getPythonInstallationDir()
  log.info('Installing Python to:', installationDir)

  try {
    // Ensure no servers are running that might lock files in the python dir
    await stopAllServers()

    // If the directory already exists, try to remove it for a clean install
    // (especially important on Windows if files are corrupted or partial)
    if (fs.existsSync(installationDir)) {
      log.info('Removing existing Python directory for clean installation')
      try {
        fs.rmSync(installationDir, { recursive: true, force: true })
      } catch (e) {
        log.warn('Failed to remove existing Python directory:', e)
        // Continue anyway, tar.x might still work or fail with a better error
      }
    }

    onStatus?.('Extracting Python…')
    const installBase = getInstallDir()
    await tar.x({ cwd: installBase, file: pythonDownloadPath })
  } catch (error: unknown) {
    log.error('Extraction failed:', error)
    // Remove possibly-corrupted download so next retry re-downloads
    try {
      fs.unlinkSync(pythonDownloadPath)
    } catch {}
    throw new Error(
      `Failed to extract Python: ${getErrorMessage(error) || 'unknown error'}. The download may be corrupted or files may be locked. Please restart the app and try again.`
    )
  }

  if (!isPythonInstalled(installationDir)) {
    log.error('Python installation failed or not found')
    throw new Error(
      'Python was not found after installation. Try restarting the app or freeing disk space.'
    )
  }

  try {
    onStatus?.('Installing uv package manager…')
    const pythonPath = getPythonPath(installationDir)

    // First, ensure pip is available (standalone builds might not have it initialized)
    log.info('Ensuring pip is available...')
    try {
      await new Promise<void>((resolve, reject) => {
        execFile(
          pythonPath,
          ['-m', 'ensurepip', '--upgrade'],
          { env: { ...process.env, PYTHONIOENCODING: 'utf-8' } },
          (error) => {
            if (error) reject(error)
            else resolve()
          }
        )
      })
      log.info('ensurepip completed')
    } catch (e) {
      log.warn('ensurepip failed (this is often okay if pip is already present):', e)
    }

    log.info('Installing uv via pip...')
    await new Promise<void>((resolve, reject) => {
      execFile(
        pythonPath,
        ['-m', 'pip', 'install', 'uv'],
        {
          encoding: 'utf-8',
          env: pythonEnv(),
          windowsHide: true,
          timeout: 60000
        },
        (error, _stdout, stderr) => {
          if (error) {
            log.error('pip install uv failed:', stderr)
            reject(new Error(stderr || error.message))
          } else {
            resolve()
          }
        }
      )
    })
    log.info('Successfully installed uv package')
    try {
      fs.unlinkSync(pythonDownloadPath)
    } catch {}
    return true
  } catch (error: unknown) {
    log.error('Failed to install uv:', error)
    throw new Error(
      `Failed to install the uv package manager: ${getErrorMessage(error) || 'unknown error'}. Please check your internet connection.`
    )
  }
}

export const getPythonExecutablePath = (envPath: string) => {
  if (process.platform === 'win32') {
    return path.normalize(path.join(envPath, 'python.exe'))
  }
  return path.normalize(path.join(envPath, 'bin', 'python'))
}

/**
 * Build a process environment suitable for running the bundled Python.
 *
 * On Windows the standalone Python distribution ships its own OpenSSL DLLs
 * (`libssl-3-x64.dll`, `libcrypto-3-x64.dll`) next to `python.exe`.  If a
 * different OpenSSL installation (Git for Windows, Anaconda, Strawberry Perl,
 * etc.) appears earlier on the system `PATH`, Python picks up those mismatched
 * DLLs at load-time, which causes the fatal error:
 *
 *     OPENSSL_Uplink(..., 08): no OPENSSL_Applink
 *
 * To prevent this we prepend the Python installation directory to `PATH` so
 * Windows finds the correct DLLs first.  We also prepend the bundled ffmpeg
 * directory so WebUI-side audio normalization can transcode browser recordings
 * before sending them to multimodal providers.
 *
 * Any additional env overrides (e.g. `configEnvVars`) can be spread after
 * calling this helper.
 */
const pythonEnv = (extra: Record<string, string> = {}): Record<string, string> => {
  const base = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => Boolean(entry[1]))
  )

  if (process.platform === 'win32') {
    // python.exe lives at the root of the installation directory on Windows
    const pythonDir = getPythonInstallationDir()
    const ffmpegDir = getFfmpegDir()
    const currentPath = process.env['PATH'] || process.env['Path'] || ''
    base['PATH'] = `${pythonDir};${ffmpegDir};${currentPath}`
    base['PYTHONIOENCODING'] = 'utf-8'
  } else {
    const ffmpegDir = getFfmpegDir()
    const currentPath = process.env['PATH'] || ''
    base['PATH'] = `${ffmpegDir}${path.delimiter}${currentPath}`
  }

  return { ...base, ...extra }
}

export const getPythonPath = (installationDir?: string) => {
  return path.normalize(getPythonExecutablePath(installationDir || getPythonInstallationDir()))
}

export const isPythonInstalled = (installationDir?: string) => {
  const pythonPath = getPythonPath(installationDir)
  if (!fs.existsSync(pythonPath)) {
    return false
  }
  try {
    const pythonVersion = execFileSync(pythonPath, ['--version'], {
      encoding: 'utf-8',
      env: pythonEnv(),
      windowsHide: true,
      timeout: 60000
    })
    log.info('Installed Python Version:', pythonVersion.trim())
    return true
  } catch {
    return false
  }
}

export const isUvInstalled = (installationDir?: string) => {
  const pythonPath = getPythonPath(installationDir)
  try {
    const result = execFileSync(pythonPath, ['-m', 'uv', '--version'], {
      encoding: 'utf-8',
      env: pythonEnv(),
      windowsHide: true,
      timeout: 60000
    })
    log.info('Installed uv Version:', result.trim())
    return true
  } catch {
    return false
  }
}

const isPackageFileLockedError = (error: unknown): boolean => {
  const message = getErrorMessage(error).toLowerCase()
  return (
    message.includes('os error 32') ||
    message.includes('failed to remove file') ||
    message.includes('being used by another process') ||
    message.includes('process cannot access the file') ||
    message.includes('另一个程序正在使用此文件') ||
    message.includes('进程无法访问')
  )
}

const killStaleOpenWebUIProcesses = async (onStatus?: (status: string) => void): Promise<void> => {
  const pythonDir = getPythonInstallationDir()

  if (process.platform === 'win32') {
    const pythonDirLiteral = JSON.stringify(path.normalize(pythonDir))
    const script = `
$pythonDir = [System.IO.Path]::GetFullPath(${pythonDirLiteral})
$targets = Get-CimInstance Win32_Process | Where-Object {
  $cmd = $_.CommandLine
  $exe = $_.ExecutablePath
  if (-not $cmd) { return $false }
  $isAuraProWebUI = ($cmd -like '*aurapro-webui*' -or $cmd -like '*aurapro-ui*' -or $cmd -like '*open_webui*' -or $cmd -like '*open-webui*')
  $isServerCommand = ($cmd -like '* serve*' -or $cmd -like '*uv run*' -or $_.Name -ieq 'aurapro-webui.exe' -or $_.Name -ieq 'aurapro-ui.exe')
  $isBundledPython = ($exe -and ([System.IO.Path]::GetFullPath($exe).StartsWith($pythonDir, [System.StringComparison]::OrdinalIgnoreCase)))
  return $isAuraProWebUI -and ($isServerCommand -or $isBundledPython)
}
foreach ($p in $targets) {
  try {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
    Write-Output $p.ProcessId
  } catch {}
}
`
    try {
      const killed = execFileSync('powershell', ['-NoProfile', '-Command', script], {
        encoding: 'utf-8',
        windowsHide: true,
        timeout: 10000
      }).trim()
      if (killed) {
        log.info(`Stopped stale Open WebUI processes: ${killed}`)
        onStatus?.('Stopped an old WebUI process...')
      }
    } catch (error) {
      log.warn('Failed to scan stale Open WebUI processes:', error)
    }
    return
  }

  try {
    const output = execFileSync('ps', ['-eo', 'pid=,command='], {
      encoding: 'utf-8',
      timeout: 10000
    })
    const killed: number[] = []
    for (const line of output.split(/\r?\n/)) {
      const match = line.trim().match(/^(\d+)\s+(.+)$/)
      if (!match) continue
      const pid = Number(match[1])
      const command = match[2]
      if (
        pid &&
        command.includes(pythonDir) &&
        (command.includes('aurapro-webui') ||
          command.includes('aurapro-ui') ||
          command.includes('open_webui') ||
          command.includes('open-webui')) &&
        (command.includes(' serve') || command.includes('uv run'))
      ) {
        try {
          process.kill(pid, 'SIGKILL')
          killed.push(pid)
        } catch {}
      }
    }
    if (killed.length) {
      log.info(`Stopped stale Open WebUI processes: ${killed.join(', ')}`)
      onStatus?.('Stopped an old WebUI process...')
    }
  } catch (error) {
    log.warn('Failed to scan stale Open WebUI processes:', error)
  }
}

const prepareOpenWebUIPackageMutation = async (
  onStatus?: (status: string) => void
): Promise<void> => {
  onStatus?.('Stopping Open WebUI before updating...')
  await stopAllServers()
  await killStaleOpenWebUIProcesses(onStatus)
  await sleep(1000)
}

export const uninstallPython = (installationDir?: string): boolean => {
  installationDir = installationDir || getPythonInstallationDir()
  if (!fs.existsSync(installationDir)) {
    log.error('Python installation not found')
    return false
  }
  try {
    fs.rmSync(installationDir, { recursive: true, force: true })
    log.info('Python installation removed:', installationDir)
  } catch (error) {
    log.error('Failed to remove Python installation', error)
    return false
  }
  try {
    const pythonDownloadPath = getPythonDownloadPath()
    fs.rmSync(pythonDownloadPath, { recursive: true, force: true })
  } catch (error) {
    log.error('Failed to remove Python download', error)
    return false
  }
  return true
}

// ─── Package Management ─────────────────────────────────

export const installPackage = (
  packageName: string,
  version?: string,
  onStatus?: (status: string) => void
): Promise<boolean> => {
  const runInstall = (): Promise<boolean> =>
    new Promise((resolve, reject) => {
      if (!isPythonInstalled()) {
        return reject(
          new Error('Python is not installed. Please reinstall the app or run setup again.')
        )
      }
      const pythonPath = getPythonPath()
      const isAuraProUiPackage = ['aurapro-webui', 'aurapro-ui', 'open-webui'].includes(packageName)
      const localOpenWebUISourcePath = isAuraProUiPackage ? getLocalOpenWebUISourcePath() : null
      const packageSpec = isAuraProUiPackage
        ? getOpenWebUIPackageSource(version)
        : version
          ? `${packageName}==${version}`
          : packageName

      if (localOpenWebUISourcePath) {
        log.info(`Installing local AuraPro source: ${localOpenWebUISourcePath}`)
        onStatus?.('Installing local Open WebUI...')
      }

      const commandProcess = execFile(
        pythonPath,
        [
          '-m',
          'uv',
          'pip',
          'install',
          ...(localOpenWebUISourcePath ? ['-e', localOpenWebUISourcePath] : [packageSpec]),
          ...(localOpenWebUISourcePath || version ? [] : ['-U']),
          ...(isAuraProUiPackage && !localOpenWebUISourcePath
            ? ['--refresh-package', packageName]
            : [])
        ],
        {
          env: pythonEnv(),
          windowsHide: true
        }
      )

      let lastLine = ''
      commandProcess.stdout?.on('data', (data) => {
        const line = data.toString().trim()
        log.info(line)
        if (line) {
          lastLine = line
          onStatus?.(line)
        }
      })
      commandProcess.stderr?.on('data', (data) => {
        const line = data.toString().trim()
        log.info(line)
        if (line) {
          lastLine = line
          onStatus?.(line)
        }
      })
      commandProcess.on('exit', (code) => {
        log.info(`Package install exited with code ${code}`)
        if (code === 0) {
          resolve(true)
        } else {
          reject(
            new Error(
              lastLine ||
                `Package installation failed (exit code ${code}). Please check your internet connection and try again.`
            )
          )
        }
      })
      commandProcess.on('error', (error) => {
        log.error(`Package install error: ${error.message}`)
        reject(new Error(`Failed to run package installer: ${error.message}`))
      })
    })

  const isAuraProUiPackage = ['aurapro-webui', 'aurapro-ui', 'open-webui'].includes(packageName)
  return runInstall().catch(async (error) => {
    if (!isAuraProUiPackage || !isPackageFileLockedError(error)) {
      throw error
    }
    log.warn('Open WebUI package install hit a locked file; stopping WebUI and retrying', error)
    await prepareOpenWebUIPackageMutation(onStatus)
    return runInstall()
  })
}

export const installPackages = async (packages: string[], version?: string): Promise<boolean> => {
  for (const pkg of packages) {
    const ok = await installPackage(pkg, version)
    if (!ok) return false
  }
  return true
}

export const isPackageInstalled = (packageName: string): boolean => {
  const pythonPath = getPythonPath()
  if (!fs.existsSync(pythonPath)) return false
  try {
    const info = execFileSync(pythonPath, ['-m', 'uv', 'pip', 'show', packageName], {
      encoding: 'utf-8',
      env: pythonEnv(),
      windowsHide: true,
      timeout: 60000
    })
    return info.includes(`Name: ${packageName}`)
  } catch {
    if (['aurapro-webui', 'aurapro-ui', 'open-webui'].includes(packageName)) {
      for (const candidate of ['aurapro-webui', 'aurapro-ui']) {
        try {
          const info = execFileSync(pythonPath, ['-m', 'uv', 'pip', 'show', candidate], {
            encoding: 'utf-8',
            env: pythonEnv(),
            windowsHide: true,
            timeout: 60000
          })
          if (info.includes(`Name: ${candidate}`)) return true
        } catch {}
      }
    }
    return false
  }
}

export const getExactPackageVersion = (packageName: string): string | null => {
  const pythonPath = getPythonPath()
  if (!fs.existsSync(pythonPath)) return null
  try {
    const info = execFileSync(pythonPath, ['-m', 'uv', 'pip', 'show', packageName], {
      encoding: 'utf-8',
      env: pythonEnv(),
      windowsHide: true,
      timeout: 60000
    })
    const nameMatch = info.match(/^Name:\s*(.+)$/m)
    if (!nameMatch || nameMatch[1].trim().toLowerCase() !== packageName.toLowerCase()) {
      return null
    }
    const versionMatch = info.match(/^Version:\s*(.+)$/m)
    return versionMatch ? versionMatch[1].trim() : null
  } catch {
    return null
  }
}

export const getPackageVersion = (packageName: string): string | null => {
  const pythonPath = getPythonPath()
  if (!fs.existsSync(pythonPath)) return null
  try {
    const info = execFileSync(pythonPath, ['-m', 'uv', 'pip', 'show', packageName], {
      encoding: 'utf-8',
      env: pythonEnv(),
      windowsHide: true,
      timeout: 60000
    })
    const match = info.match(/^Version:\s*(.+)$/m)
    return match ? match[1].trim() : null
  } catch {
    if (['aurapro-webui', 'aurapro-ui', 'open-webui'].includes(packageName)) {
      for (const candidate of ['aurapro-webui', 'aurapro-ui']) {
        try {
          const info = execFileSync(pythonPath, ['-m', 'uv', 'pip', 'show', candidate], {
            encoding: 'utf-8',
            env: pythonEnv(),
            windowsHide: true,
            timeout: 60000
          })
          const match = info.match(/^Version:\s*(.+)$/m)
          if (match) return match[1].trim()
        } catch {}
      }
    }
    return null
  }
}

type OpenWebUIPackageName = 'aurapro-webui' | 'aurapro-ui' | 'open-webui'

const hasOpenWebUICoreFiles = (packageName: OpenWebUIPackageName): boolean => {
  const pythonPath = getPythonPath()
  if (!fs.existsSync(pythonPath)) return false

  try {
    const output = execFileSync(
      pythonPath,
      [
        '-c',
        "import importlib.metadata as m, pathlib, sys; root = pathlib.Path(m.distribution(sys.argv[1]).locate_file('open_webui')); required = (root / 'env.py', root / 'migrations' / 'env.py'); print('healthy' if all(path.is_file() for path in required) else 'incomplete')",
        packageName
      ],
      {
        encoding: 'utf-8',
        env: pythonEnv(),
        windowsHide: true,
        timeout: 10000
      }
    )
    return output.trim() === 'healthy'
  } catch {
    return false
  }
}

const getInstalledOpenWebUIPackageName = (): OpenWebUIPackageName | null => {
  for (const packageName of [
    'aurapro-webui',
    'aurapro-ui',
    'open-webui'
  ] as OpenWebUIPackageName[]) {
    if (getExactPackageVersion(packageName) && hasOpenWebUICoreFiles(packageName))
      return packageName
  }
  return null
}

const getDistributionMigrationScriptPath = (): string => {
  const scriptName = 'migrate_python_distribution.py'
  const candidates = [
    path.join(process.resourcesPath ?? '', 'app.asar.unpacked', 'resources', scriptName),
    path.join(process.resourcesPath ?? '', 'resources', scriptName),
    path.join(getAppPath(), 'app.asar.unpacked', 'resources', scriptName),
    path.join(getAppPath(), 'resources', scriptName),
    path.join(process.cwd(), 'resources', scriptName)
  ]
  const scriptPath = candidates.find((candidate) => fs.existsSync(candidate))
  if (!scriptPath) {
    throw new Error(`Python distribution migration helper was not found: ${scriptName}`)
  }
  return scriptPath
}

const removeSupersededOpenWebUIDistribution = (
  packageName: OpenWebUIPackageName,
  replacementPackageName: OpenWebUIPackageName
): void => {
  const output = execFileSync(
    getPythonPath(),
    [getDistributionMigrationScriptPath(), packageName, replacementPackageName],
    {
      encoding: 'utf-8',
      env: pythonEnv(),
      windowsHide: true,
      timeout: 60000
    }
  )
  log.info(`Legacy WebUI package migration result: ${output.trim()}`)
}

export const ensureOpenWebUIPackage = async (
  targetVersion = AURAPRO_UI_TARGET_VERSION,
  onStatus?: (status: string) => void,
  options: { forceLatest?: boolean } = {}
): Promise<OpenWebUIPackageName> => {
  const desiredVersion = resolveOpenWebUITargetVersion(targetVersion)
  const useLatest = isLatestOpenWebUITarget(desiredVersion)
  const desiredPackageName = getOpenWebUIPackageNameForVersion(desiredVersion)
  const version = getExactPackageVersion(desiredPackageName)
  const newAuraProVersion = getExactPackageVersion('aurapro-webui')
  const legacyAuraProVersion = getExactPackageVersion('aurapro-ui')
  const legacyOpenWebUIVersion = getExactPackageVersion('open-webui')
  const migratableLegacyAuraProVersion =
    legacyAuraProVersion && isVersionAtOrBefore(legacyAuraProVersion, AURAPRO_UI_LAST_VERSION)
      ? legacyAuraProVersion
      : null
  const supersededPackages: [OpenWebUIPackageName, string | null][] =
    desiredPackageName === 'aurapro-webui'
      ? [
          ['aurapro-ui', migratableLegacyAuraProVersion],
          ['open-webui', legacyOpenWebUIVersion]
        ]
      : [
          ['aurapro-webui', newAuraProVersion],
          ['open-webui', legacyOpenWebUIVersion]
        ]
  const hasSupersededPackage = supersededPackages.some(([, packageVersion]) =>
    Boolean(packageVersion)
  )
  const runtimeHealthy = Boolean(version) && hasOpenWebUICoreFiles(desiredPackageName)
  const targetSatisfied =
    runtimeHealthy && (useLatest ? options.forceLatest !== true : version === desiredVersion)

  if (version && !runtimeHealthy) {
    log.warn(
      `Installed ${desiredPackageName} ${version} is missing required runtime files; reinstalling.`
    )
  }

  if (
    desiredPackageName === 'aurapro-webui' &&
    legacyAuraProVersion &&
    !migratableLegacyAuraProVersion
  ) {
    log.warn(
      `Found aurapro-ui ${legacyAuraProVersion}, which is outside the supported migration boundary ` +
        `(up to ${AURAPRO_UI_LAST_VERSION}); it will be preserved.`
    )
  }

  if (targetSatisfied && !hasSupersededPackage) {
    await installTorchPackage(version ?? desiredVersion, onStatus)
    await ensureEpubConceptRuntimePackage(onStatus)
    return desiredPackageName
  }

  await prepareOpenWebUIPackageMutation(onStatus)

  if (hasSupersededPackage) {
    const dataDir = getOpenWebUIDataPath()
    onStatus?.(
      `Migrating the previous WebUI package to Open WebUI ${
        useLatest ? 'latest' : desiredVersion
      }...`
    )
    log.info(
      `Migrating superseded WebUI packages to ${desiredPackageName} ${
        useLatest ? 'latest' : desiredVersion
      }. Data directory will be preserved: ${dataDir}`
    )
  }

  if (!targetSatisfied) {
    onStatus?.(
      useLatest ? 'Installing latest Open WebUI...' : `Installing Open WebUI ${desiredVersion}...`
    )
    log.info(
      useLatest
        ? `Open WebUI package version ${version ?? 'missing'} will be updated to latest`
        : `Open WebUI package version ${version ?? 'missing'} does not match ${desiredVersion}; installing in place`
    )
    await installPackage(desiredPackageName, useLatest ? undefined : desiredVersion, onStatus)
  }

  const installedVersion = getExactPackageVersion(desiredPackageName)
  if (useLatest) {
    if (!installedVersion) {
      throw new Error(
        'Open WebUI update failed: no package was installed. Please check the WebUI install log and retry.'
      )
    }
  } else if (installedVersion !== desiredVersion) {
    throw new Error(
      `Open WebUI update failed: expected ${desiredVersion}, but installed ${installedVersion ?? 'none'}. ` +
        'Please check the WebUI install log and retry.'
    )
  }

  if (!hasOpenWebUICoreFiles(desiredPackageName)) {
    throw new Error(
      'Open WebUI update produced an incomplete package: required runtime files are missing. Please retry the update.'
    )
  }
  for (const [packageName, packageVersion] of supersededPackages) {
    if (!packageVersion) continue
    onStatus?.(`Removing previous ${packageName} package...`)
    try {
      removeSupersededOpenWebUIDistribution(packageName, desiredPackageName)
      log.info(
        `Removed superseded ${packageName} package version ${packageVersion} without deleting shared ${desiredPackageName} files`
      )
    } catch (error) {
      log.warn(
        `Failed to remove superseded ${packageName}; ${desiredPackageName} remains usable and cleanup will be retried:`,
        error
      )
    }
  }

  await installTorchPackage(installedVersion ?? desiredVersion, onStatus)
  await ensureEpubConceptRuntimePackage(onStatus)
  return desiredPackageName
}

/**
 * The EPUB vector store loads sqlite-vec as a Python extension.  It is a
 * required part of the Desktop-managed local runtime, rather than a package
 * users must install manually after AuraPro starts.
 */
export const ensureEpubConceptRuntimePackage = async (
  onStatus?: (status: string) => void
): Promise<void> => {
  const packageName = 'sqlite-vec'
  const version = '0.1.9'
  if (getExactPackageVersion(packageName) === version) {
    log.info(`EPUB runtime dependency already installed: ${packageName}==${version}`)
    return
  }

  onStatus?.(`Installing EPUB search runtime (${packageName} ${version})...`)
  await installPackage(packageName, version, onStatus)
  const installedVersion = getExactPackageVersion(packageName)
  if (installedVersion !== version) {
    throw new Error(
      `EPUB runtime dependency install failed: expected ${packageName}==${version}, ` +
        `received ${installedVersion ?? 'none'}`
    )
  }
  log.info(`Installed EPUB runtime dependency: ${packageName}==${version}`)
}

export const installTorchPackage = async (
  version: string,
  onStatus?: (status: string) => void
): Promise<boolean> => {
  void version
  try {
    const config = await getConfig()
    const llamaVariant = config.llamaCpp?.variant ?? 'cpu'
    const supportsCudaWheels = process.platform === 'win32' || process.platform === 'linux'
    const useCuda =
      supportsCudaWheels &&
      llamaVariant.startsWith('cuda-') &&
      config.localServer?.ragHardwareAcceleration === true
    const suffix = process.platform === 'darwin' ? '' : useCuda ? '+cu128' : '+cpu'
    const expectedVersions = {
      torch: `2.8.0${suffix}`,
      torchaudio: `2.8.0${suffix}`,
      torchvision: `0.23.0${suffix}`
    }

    const alreadyInstalled = Object.entries(expectedVersions).every(
      ([packageName, expectedVersion]) => getExactPackageVersion(packageName) === expectedVersion
    )
    if (alreadyInstalled) {
      log.info(
        `PyTorch packages already match the selected RAG runtime (${useCuda ? 'CUDA cu128' : 'CPU'})`
      )
      return true
    }

    const packages = Object.entries(expectedVersions).map(
      ([packageName, expectedVersion]) => `${packageName}==${expectedVersion}`
    )
    const extraIndex = useCuda
      ? 'https://download.pytorch.org/whl/cu128'
      : 'https://download.pytorch.org/whl/cpu'
    const runtimeLabel = useCuda ? 'CUDA 版 PyTorch（cu128）' : 'CPU 版 PyTorch'
    const logRuntimeLabel = useCuda ? 'CUDA-enabled PyTorch (cu128)' : 'CPU PyTorch'

    onStatus?.(`正在安装 ${runtimeLabel} 依赖...`)
    log.info(`Installing ${logRuntimeLabel} for RAG; llama.cpp variant=${llamaVariant}`)
    execFileSync(
      getPythonPath(),
      ['-m', 'uv', 'pip', 'install', '-U', ...packages, '--extra-index-url', extraIndex],
      {
        encoding: 'utf-8',
        env: pythonEnv(),
        stdio: 'inherit',
        windowsHide: true
      }
    )
    onStatus?.(`${runtimeLabel} 安装完成`)
    return true
  } catch (error) {
    log.warn('Failed to install the selected PyTorch runtime:', error)
    onStatus?.('PyTorch 依赖安装失败，已继续安装')
    return false
  }
}

export const uninstallPackage = (packageName: string): boolean => {
  const pythonPath = getPythonPath()
  if (!fs.existsSync(pythonPath)) return false
  try {
    execFileSync(pythonPath, ['-m', 'uv', 'pip', 'uninstall', packageName], {
      encoding: 'utf-8',
      env: pythonEnv(),
      windowsHide: true,
      timeout: 60000
    })
    log.info(`Uninstalled package: ${packageName}`)
    return true
  } catch (error) {
    if (['aurapro-webui', 'aurapro-ui', 'open-webui'].includes(packageName)) {
      for (const candidate of ['aurapro-webui', 'aurapro-ui', 'open-webui']) {
        if (candidate === packageName) continue
        try {
          execFileSync(pythonPath, ['-m', 'uv', 'pip', 'uninstall', candidate], {
            encoding: 'utf-8',
            env: pythonEnv(),
            windowsHide: true,
            timeout: 60000
          })
          log.info(`Uninstalled package: ${candidate}`)
          return true
        } catch {}
      }
    }
    log.error(`Failed to uninstall ${packageName}:`, error)
    return false
  }
}

// ─── Server Management ──────────────────────────────────

const serverPIDs: Set<number> = new Set()
const serverLogs: Map<number, string[]> = new Map()
type ServerProcess = {
  pid: number
  kill: () => void
  onData: (callback: (data: string) => void) => { dispose: () => void }
  onExit: (callback: (event: { exitCode: number | null; signal?: string | null }) => void) => {
    dispose: () => void
  }
  write: (data: string) => void
  resize: (_cols: number, _rows: number) => void
}

const serverPtyProcesses: Map<number, ServerProcess> = new Map()

export const getServerPIDs = (): number[] => Array.from(serverPIDs)
export const getServerPty = (pid: number): ServerProcess | undefined => serverPtyProcesses.get(pid)

const spawnHiddenServerProcess = (
  command: string,
  args: string[],
  env: Record<string, string | undefined>
): ServerProcess => {
  const child = spawn(command, args, {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32'
  })

  if (!child.pid) {
    throw new Error('Failed to start server process')
  }

  return {
    pid: child.pid,
    kill: () => {
      child.kill()
    },
    onData: (callback) => {
      const listener = (data: Buffer | string) => callback(data.toString())
      child.stdout?.on('data', listener)
      child.stderr?.on('data', listener)
      return {
        dispose: () => {
          child.stdout?.off('data', listener)
          child.stderr?.off('data', listener)
        }
      }
    },
    onExit: (callback) => {
      const listener = (code: number | null, signal: NodeJS.Signals | null) => {
        callback({ exitCode: code, signal })
      }
      child.on('exit', listener)
      return {
        dispose: () => {
          child.off('exit', listener)
        }
      }
    },
    write: (data) => {
      child.stdin?.write(data)
    },
    resize: () => {}
  }
}

export type WebUIStartPhase = 'checking' | 'updating' | 'starting'

export const startServer = async (
  expose = false,
  port: number | null = null,
  onStatus?: (status: string, phase: WebUIStartPhase) => void
): Promise<{ url: string; pid: number }> => {
  await stopAllServers()
  await killStaleOpenWebUIProcesses((status) => onStatus?.(status, 'checking'))
  onStatus?.('Checking the installed WebUI version...', 'checking')
  const config = await getConfig()
  const configEnvVars = config.envVars ?? {}
  const ragHardwareAcceleration =
    config.localServer?.ragHardwareAcceleration === true &&
    (config.llamaCpp?.variant ?? '').startsWith('cuda-') &&
    (process.platform === 'win32' || process.platform === 'linux')
  const ragDevice = ragHardwareAcceleration ? 'cuda' : 'cpu'
  const sherpaConfig = config.sherpa ?? {}
  const sherpaAudioBaseUrl = sherpaConfig.enabled
    ? `http://127.0.0.1:${config.sherpa?.port || 39384}/v1`
    : ''
  const sherpaAsrReady = Boolean(
    sherpaAudioBaseUrl &&
    ((sherpaConfig.asrType === 'whisper' && sherpaConfig.asrEncoder && sherpaConfig.asrDecoder) ||
      (sherpaConfig.asrType === 'moonshine' &&
        sherpaConfig.asrEncoder &&
        (sherpaConfig.asrDecoder ||
          sherpaConfig.asrMergedDecoder ||
          sherpaConfig.asrCachedDecoder ||
          sherpaConfig.asrUncachedDecoder)) ||
      ((sherpaConfig.asrType === 'sense_voice' || sherpaConfig.asrType === 'nemo_ctc') &&
        sherpaConfig.asrModel) ||
      (sherpaConfig.asrTokens &&
        (sherpaConfig.asrModel ||
          (sherpaConfig.asrEncoder && sherpaConfig.asrDecoder && sherpaConfig.asrJoiner))))
  )
  const sherpaTtsReady = Boolean(
    sherpaAudioBaseUrl &&
    sherpaConfig.ttsModel &&
    sherpaConfig.ttsTokens &&
    (sherpaConfig.ttsType === 'kokoro' ||
      sherpaConfig.ttsType === 'vits' ||
      sherpaConfig.ttsType === undefined ||
      sherpaConfig.ttsVoices)
  )
  log.info(`Sherpa ASR ready: ${sherpaAsrReady}, Sherpa TTS ready: ${sherpaTtsReady}`)
  log.info('urls', {
    sherpaAudioBaseUrl,
    sherpaAsrReady,
    sherpaTtsReady
  })
  const host = expose ? '0.0.0.0' : '127.0.0.1'
  const useHttps = Boolean(expose && config.localServer?.httpsEnabled !== false)
  if (!isPythonInstalled()) throw new Error('Python is not installed')
  let webUIPackageName: OpenWebUIPackageName
  try {
    webUIPackageName = await ensureOpenWebUIPackage(
      resolveOpenWebUITargetVersion(config.localServer?.version),
      (status) => onStatus?.(status, 'updating')
    )
  } catch (error) {
    const fallbackPackage = getInstalledOpenWebUIPackageName()
    if (!fallbackPackage) throw error
    webUIPackageName = fallbackPackage
    log.warn(
      `Open WebUI package update failed; continuing with installed ${fallbackPackage}:`,
      error
    )
    onStatus?.(
      'WebUI update failed. Continuing with the previously installed version...',
      'updating'
    )
  }
  const localOpenWebUISourcePath = getLocalOpenWebUISourcePath()
  const localFrontendBuildDir = localOpenWebUISourcePath
    ? path.join(localOpenWebUISourcePath, 'build')
    : null

  // Ensure ffmpeg is available
  try {
    await ensureFfmpeg((status) => onStatus?.(status, 'updating'))
  } catch (err) {
    log.warn('Failed to ensure ffmpeg (non-fatal, but some features may not work):', err)
  }

  const pythonPath = getPythonPath()
  log.info(`Using Python at: ${pythonPath}`)

  if (!fs.existsSync(pythonPath)) {
    throw new Error(`Python executable not found at: ${pythonPath}`)
  }

  const commandArgs = ['-m', 'uv', 'run', webUIPackageName, 'serve', '--host', host]
  if (useHttps) {
    const certDir = path.join(getUserDataPath(), 'certs')
    const lanHosts = getLocalNetworkAddresses()
    commandArgs.push('--ssl-autogen-dir', certDir)
    commandArgs.push('--ssl-hosts', lanHosts.join(','))
  }
  const dataDir = getOpenWebUIDataPath()
  const secretKey = getSecretKey()
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }

  // Find available port
  const desiredPort = port || 8081
  let availablePort = desiredPort
  while (await portInUse(availablePort, host)) {
    availablePort++
    if (availablePort > desiredPort + 100) {
      throw new Error('No available ports found')
    }
  }
  commandArgs.push('--port', availablePort.toString())
  log.info('Starting AuraPro server...', pythonPath, commandArgs.join(' '))
  onStatus?.('Starting the WebUI service...', 'starting')

  let ptyProcess: ServerProcess
  try {
    ptyProcess = spawnHiddenServerProcess(
      pythonPath,
      commandArgs,
      pythonEnv({
        ...(configEnvVars ?? {}),
        DATA_DIR: dataDir,
        GLOSSARY_PATH: path.join(dataDir, 'glossaries', 'personal.json'),
        WEBUI_SECRET_KEY: secretKey,
        ...(localFrontendBuildDir && fs.existsSync(localFrontendBuildDir)
          ? { FRONTEND_BUILD_DIR: localFrontendBuildDir }
          : {}),
        PYTHONUNBUFFERED: '1',
        PYTHONWARNINGS: 'ignore::SyntaxWarning',
        ENABLE_LLAMA_CPP: 'False',
        ENABLE_OLLAMA: 'False',
        // The descriptor is atomically maintained by Desktop.  The WebUI
        // reads this server-owned path instead of asking users to edit static
        // EPUB_CONCEPT_LOCAL_LLM_* environment variables.
        AURAPRO_DESKTOP_LLM_RUNTIME_FILE: getEpubConceptRuntimeFilePath(),
        ...(sherpaAsrReady
          ? {
              AUDIO_STT_ENGINE: 'sherpa',
              AUDIO_STT_MODEL: 'sherpa-asr',
              AUDIO_STT_OPENAI_API_BASE_URL: sherpaAudioBaseUrl,
              AUDIO_STT_OPENAI_API_KEY: 'aurapro-local'
            }
          : {}),
        ...(sherpaTtsReady
          ? {
              AUDIO_TTS_ENGINE: 'sherpa',
              AUDIO_TTS_MODEL: 'sherpa-tts',
              AUDIO_TTS_VOICE: '0',
              AUDIO_TTS_OPENAI_API_BASE_URL: sherpaAudioBaseUrl,
              AUDIO_TTS_OPENAI_API_KEY: 'aurapro-local'
            }
          : {}),
        RAG_EMBEDDING_MODEL_DEVICE_TYPE: ragDevice,
        RAG_RERANKING_MODEL_DEVICE_TYPE: ragDevice,
        USER_AGENT: 'AuraPro Desktop' // Suppress langchain warning
      })
    )
  } catch (error) {
    throw new Error(`Failed to spawn server process with ${pythonPath}: ${getErrorMessage(error)}`)
  }

  const pid = ptyProcess.pid
  const rawBuffer: string[] = []
  serverPIDs.add(pid)
  serverLogs.set(pid, rawBuffer)
  serverPtyProcesses.set(pid, ptyProcess)

  ptyProcess.onData((data: string) => {
    rawBuffer.push(data)
    serverLogger.info(`[PID:${pid}] ${data.replace(/[\r\n]+/g, ' ').trim()}`)
  })

  ptyProcess.onExit(({ exitCode, signal }) => {
    const exitMsg = `\r\n[Process exited with code ${exitCode}${signal ? ` signal ${signal}` : ''}]\r\n`
    rawBuffer.push(exitMsg)
    serverLogger.info(`[PID:${pid}] Exited code=${exitCode} signal=${signal}`)
    serverPIDs.delete(pid)
    serverPtyProcesses.delete(pid)
  })

  let effectiveHost = host
  if (host === '0.0.0.0') effectiveHost = '127.0.0.1'
  const url = `${useHttps ? 'https' : 'http'}://${effectiveHost}:${availablePort}`
  log.info(`Server started with PID: ${pid}, URL: ${url}`)

  return { url, pid }
}

export async function stopAllServers(): Promise<void> {
  log.info('Stopping all servers...')
  const pidsToStop = Array.from(serverPIDs)
  if (pidsToStop.length === 0) return

  // The WebUI command may spawn a Python child through uv. Always terminate
  // the complete process tree so the child cannot keep the old port occupied.
  for (const pid of pidsToStop) {
    await terminateProcessTree(pid, false)
  }

  await sleep(2000)

  // Force kill anything still running
  for (const pid of pidsToStop) {
    if (isProcessRunning(pid)) {
      await terminateProcessTree(pid, true)
    }
  }

  for (const pid of pidsToStop) {
    if (!isProcessRunning(pid)) {
      serverPIDs.delete(pid)
      serverLogs.delete(pid)
      serverPtyProcesses.delete(pid)
    } else {
      log.warn(`Process ${pid} may still be running after termination attempts`)
    }
  }
}

export const clearServerLog = (pid: number): void => {
  const logs = serverLogs.get(pid)
  if (logs) logs.length = 0
}

export const clearAllServerLogs = (): void => {
  for (const logs of serverLogs.values()) {
    logs.length = 0
  }
}

async function terminateProcessTree(pid: number, forceKill: boolean = false): Promise<void> {
  const maxRetries = 3
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (process.platform === 'win32') {
        await terminateWindows(pid, forceKill)
      } else {
        await terminateUnix(pid, forceKill)
      }
      if (!isProcessRunning(pid)) {
        log.info(`Successfully terminated process tree (PID: ${pid})`)
        return
      }
    } catch (error) {
      log.warn(`Attempt ${attempt}/${maxRetries} failed for PID ${pid}:`, error)
    }
    if (attempt < maxRetries) await sleep(1000)
  }
  log.error(`Failed to terminate process tree (PID: ${pid}) after ${maxRetries} attempts`)
}

async function terminateWindows(pid: number, forceKill: boolean): Promise<void> {
  const commands = forceKill
    ? [`taskkill /PID ${pid} /T /F`]
    : [`taskkill /PID ${pid} /T`, `taskkill /PID ${pid} /T /F`]
  for (const cmd of commands) {
    try {
      execSync(cmd, { timeout: 5000, stdio: 'ignore' })
      await sleep(500)
    } catch {}
  }
}

async function terminateUnix(pid: number, forceKill: boolean): Promise<void> {
  const signals = forceKill ? ['SIGKILL'] : ['SIGTERM', 'SIGKILL']
  for (const signal of signals) {
    try {
      process.kill(-pid, signal)
      await sleep(500)
      if (isProcessRunning(pid)) {
        process.kill(pid, signal)
        await sleep(500)
      }
    } catch {}
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function getServerLog(pid: number): string[] {
  return serverLogs.get(pid) || []
}

// ─── URL Validation ─────────────────────────────────────

export const checkUrlAndOpen = async (
  url: string,
  callback: () => void | Promise<void> = async () => {}
) => {
  const maxAttempts = 1800
  const interval = 2000
  let attempts = 0

  const checkUrl = async (): Promise<boolean> => {
    try {
      const response = await electronNet.fetch(url, { method: 'HEAD' })
      return response.ok
    } catch {
      return false
    }
  }

  const pollUrl = async () => {
    while (attempts < maxAttempts) {
      attempts++
      const isAvailable = await checkUrl()
      if (isAvailable) {
        log.info('URL is now available')
        await callback()
        return
      }
      await new Promise((resolve) => setTimeout(resolve, interval))
    }
    log.info('URL check timed out')
  }

  pollUrl().catch((error) => {
    log.error('Error in URL polling:', error)
  })
}

export const validateRemoteUrl = async (url: string): Promise<boolean> => {
  try {
    const response = await electronNet.fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000)
    })
    return response.ok
  } catch {
    return false
  }
}

// ─── Config ─────────────────────────────────────────────

export interface Connection {
  id: string
  name: string
  type: 'local' | 'remote'
  url: string
}

export interface AppConfig {
  version: number
  dataVersion: number
  webuiDistributionMigrationVersion: number
  defaultConnectionId: string | null
  connections: Connection[]
  runInBackground: boolean
  globalShortcut: string
  spotlightShortcut: string
  installDir: string
  dataDir: string
  localServer: {
    port: number
    serveOnLocalNetwork: boolean
    httpsEnabled: boolean
    ragHardwareAcceleration: boolean
    version?: string
    packageSource?: string
  }
  openTerminal: {
    enabled: boolean
    port: number
    cwd: string
    apiKey: string
    version?: string
  }
  llamaCpp: {
    enabled: boolean
    port: number
    version: string
    fallbackVersion: string
    badVersions: string[]
    variant: string
    parallel?: number
    mtpEnabled?: boolean
    multimodalEnabled?: boolean
    ctxSize?: number
    extraArgs: string[]
  }
  sherpa: {
    enabled: boolean
    port: number
    language: string
    asrLanguage: string
    ttsLanguage: string
    asrAutoDetect: boolean
    asrLanguageDetectorModel: string
    asrLanguageDetectorDevice: string
    asrLanguageDetectorComputeType: string
    asrProfiles: Record<string, Record<string, string>>
    asrPreset: string
    ttsPreset: string
    asrRemoteRepo: string
    ttsRemoteRepo: string
    asrType: string
    asrModel: string
    asrTokens: string
    asrEncoder?: string
    asrDecoder?: string
    asrJoiner?: string
    asrPreprocessor?: string
    asrCachedDecoder?: string
    asrUncachedDecoder?: string
    asrMergedDecoder?: string
    ttsModel: string
    ttsTokens: string
    ttsType?: string
    ttsVoices?: string
    ttsLexicon: string
    ttsDataDir: string
    ttsDictDir: string
    ttsProfiles: Record<string, Record<string, string>>
  }
  envVars: Record<string, string>
  showSidebar: boolean
  spotlightPosition: { x: number; y: number } | null
  spotlightClipboardPaste: boolean
  voiceInputShortcut: string
  voiceInputEnabled: boolean
  audioInputDeviceId: string
  audioOutputDeviceId: string
  callShortcut: string
  callEnabled: boolean
  windowBounds: { x: number; y: number; width: number; height: number } | null
  windowMaximized: boolean
  shortcutActions: {
    spotlight: string | null
    voice: string | null
    call: string | null
  }
}

const DEFAULT_CONFIG: AppConfig = {
  version: 0,
  dataVersion: 0,
  webuiDistributionMigrationVersion: 0,
  defaultConnectionId: null,
  connections: [],
  runInBackground: true,
  globalShortcut: 'Alt+CommandOrControl+O',
  spotlightShortcut: 'Shift+CommandOrControl+I',
  installDir: '',
  dataDir: '',
  localServer: {
    port: 8081,
    serveOnLocalNetwork: true,
    httpsEnabled: true,
    ragHardwareAcceleration: false
  },
  openTerminal: {
    enabled: false,
    port: 39284,
    cwd: '',
    apiKey: ''
  },
  llamaCpp: {
    enabled: false,
    port: 18881,
    version: 'latest',
    fallbackVersion: 'b9637',
    badVersions: [],
    variant: 'auto',
    mtpEnabled: false,
    multimodalEnabled: true,
    extraArgs: []
  },
  sherpa: {
    enabled: false,
    port: 39384,
    language: 'zh-CN',
    asrLanguage: 'Chinese',
    asrAutoDetect: true,
    asrLanguageDetectorModel: 'large-v3-turbo',
    asrLanguageDetectorDevice: 'cpu',
    asrLanguageDetectorComputeType: 'int8',
    asrProfiles: {},
    ttsLanguage: 'Chinese (Mandarin, 普通话)',
    asrPreset: 'csukuangfj/sherpa-onnx-paraformer-zh-small-2024-03-09',
    ttsPreset: 'csukuangfj/vits-zh-aishell3|174 speakers',
    asrRemoteRepo: '',
    ttsRemoteRepo: '',
    asrType: 'paraformer',
    asrModel: '',
    asrTokens: '',
    ttsModel: '',
    ttsTokens: '',
    ttsLexicon: '',
    ttsDataDir: '',
    ttsDictDir: '',
    ttsProfiles: {}
  },
  envVars: {},
  showSidebar: false,
  spotlightPosition: null,
  spotlightClipboardPaste: true,
  voiceInputShortcut: 'Shift+CommandOrControl+Space',
  voiceInputEnabled: true,
  audioInputDeviceId: '',
  audioOutputDeviceId: '',
  callShortcut: 'Shift+CommandOrControl+C',
  callEnabled: true,
  windowBounds: null,
  windowMaximized: false,
  shortcutActions: {
    spotlight: null,
    voice: null,
    call: null
  }
}

const normalizeLocalConnectionUrl = (url: string, config: AppConfig): string => {
  if (!url) return url

  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.toLowerCase()
    const isLoopbackHost =
      hostname === '127.0.0.1' ||
      hostname === 'localhost' ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      hostname === '[::1]'

    let changed = false
    if (isLoopbackHost && parsed.port === '8080') {
      parsed.port = '8081'
      changed = true
    }
    if (
      config.localServer?.httpsEnabled !== false &&
      parsed.protocol === 'http:' &&
      isLoopbackHost
    ) {
      parsed.protocol = 'https:'
      changed = true
    }
    if (changed) return parsed.toString().replace(/\/$/, '')
  } catch {
    return url
  }

  return url
}

const isLoopbackConnectionUrl = (url: string): boolean => {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return (
      hostname === 'localhost' ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      hostname === '[::1]' ||
      hostname.startsWith('127.')
    )
  } catch {
    return false
  }
}

const normalizeConfig = (config: AppConfig): AppConfig => {
  const localServer = {
    ...DEFAULT_CONFIG.localServer,
    ...(config.localServer ?? {})
  } as AppConfig['localServer'] & { autoUpdate?: boolean }
  delete localServer.autoUpdate

  if (localServer.port === 8080) {
    localServer.port = 8081
  }

  const normalized: AppConfig = {
    ...config,
    localServer,
    openTerminal: {
      ...DEFAULT_CONFIG.openTerminal,
      ...(config.openTerminal ?? {})
    },
    llamaCpp: {
      ...DEFAULT_CONFIG.llamaCpp,
      ...(config.llamaCpp ?? {})
    },
    sherpa: {
      ...DEFAULT_CONFIG.sherpa,
      ...(config.sherpa ?? {})
    },
    shortcutActions: {
      ...DEFAULT_CONFIG.shortcutActions,
      ...(config.shortcutActions ?? {})
    },
    connections: []
  }

  const localConnectionIds = new Set<string>()
  let localConnection: Connection | null = null
  const remoteConnections: Connection[] = []

  for (const connection of config.connections ?? []) {
    const isLocal =
      connection.id === 'local' ||
      connection.type === 'local' ||
      isLoopbackConnectionUrl(connection.url)

    if (!isLocal) {
      remoteConnections.push(connection)
      continue
    }

    localConnectionIds.add(connection.id)
    const candidate: Connection = {
      ...connection,
      id: 'local',
      name: 'Local',
      type: 'local',
      url: normalizeLocalConnectionUrl(connection.url, normalized)
    }

    if (!localConnection || connection.id === 'local' || connection.type === 'local') {
      localConnection = candidate
    }
  }

  normalized.connections = localConnection
    ? [localConnection, ...remoteConnections]
    : remoteConnections
  if (config.defaultConnectionId && localConnectionIds.has(config.defaultConnectionId)) {
    normalized.defaultConnectionId = 'local'
  }

  return normalized
}

export const getConfig = async (): Promise<AppConfig> => {
  const configPath = path.join(getUserDataPath(), 'config.json')
  try {
    if (fs.existsSync(configPath)) {
      const data = await fs.promises.readFile(configPath, 'utf8')
      return normalizeConfig({ ...DEFAULT_CONFIG, ...JSON.parse(data) })
    }
    return normalizeConfig({ ...DEFAULT_CONFIG })
  } catch (error) {
    log.error('Error reading config, using defaults:', error)
    return normalizeConfig({ ...DEFAULT_CONFIG })
  }
}

let configWriteLock: Promise<void> = Promise.resolve()

type ConfigUpdate = Partial<
  Omit<AppConfig, 'localServer' | 'openTerminal' | 'llamaCpp' | 'sherpa' | 'shortcutActions'>
> & {
  localServer?: Partial<AppConfig['localServer']>
  openTerminal?: Partial<AppConfig['openTerminal']>
  llamaCpp?: Partial<AppConfig['llamaCpp']>
  sherpa?: Partial<AppConfig['sherpa']>
  shortcutActions?: Partial<AppConfig['shortcutActions']>
}

export const setConfig = async (config: ConfigUpdate): Promise<void> => {
  // Serialize writes so concurrent callers don't race on the tmp file
  const previous = configWriteLock
  let resolve: () => void
  configWriteLock = new Promise<void>((r) => {
    resolve = r
  })
  await previous

  const configPath = path.join(getUserDataPath(), 'config.json')
  const tmpPath = `${configPath}.${process.pid}.${Date.now()}.tmp`
  try {
    const existing = await getConfig()
    const merged: AppConfig = normalizeConfig({
      ...existing,
      ...config,
      localServer: { ...existing.localServer, ...(config.localServer ?? {}) },
      openTerminal: { ...existing.openTerminal, ...(config.openTerminal ?? {}) },
      llamaCpp: { ...existing.llamaCpp, ...(config.llamaCpp ?? {}) },
      sherpa: { ...existing.sherpa, ...(config.sherpa ?? {}) },
      shortcutActions: { ...existing.shortcutActions, ...(config.shortcutActions ?? {}) }
    })
    await fs.promises.writeFile(tmpPath, JSON.stringify(merged, null, 2))

    for (let attempt = 0; ; attempt++) {
      try {
        await fs.promises.rename(tmpPath, configPath)
        break
      } catch (error: unknown) {
        const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined
        const retryable = ['EACCES', 'EBUSY', 'EPERM'].includes(code ?? '')
        if (!retryable || attempt >= 5) throw error

        const delayMs = 50 * 2 ** attempt
        log.warn(`Config file is temporarily busy; retrying in ${delayMs}ms`)
        await sleep(delayMs)
      }
    }
  } catch (error) {
    log.error('Error writing config:', error)
    // Clean up temp file
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
    } catch {}
    throw error
  } finally {
    resolve!()
  }
}

export interface ResetAppFailure {
  label: string
  path: string
  error: string
}

export interface ResetAppResult {
  success: boolean
  removed: string[]
  failed: ResetAppFailure[]
  warnings: string[]
}

const stopRuntimeProcesses = async (runtimeDir: string, label: string): Promise<void> => {
  if (!fs.existsSync(runtimeDir)) return

  if (process.platform === 'win32') {
    const runtimeDirLiteral = JSON.stringify(path.resolve(runtimeDir))
    const script = `
$runtimeRoot = [System.IO.Path]::GetFullPath(${runtimeDirLiteral}).TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
$targets = Get-CimInstance Win32_Process | Where-Object {
  $exe = $_.ExecutablePath
  $exe -and ([System.IO.Path]::GetFullPath($exe).StartsWith($runtimeRoot, [System.StringComparison]::OrdinalIgnoreCase))
}
foreach ($process in $targets) {
  try {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
    Write-Output $process.ProcessId
  } catch {}
}
`
    try {
      const stopped = execFileSync('powershell', ['-NoProfile', '-Command', script], {
        encoding: 'utf-8',
        windowsHide: true,
        timeout: 15000
      }).trim()
      if (stopped) log.info(`Stopped stale ${label} processes during reset: ${stopped}`)
    } catch (error) {
      log.warn(`Failed to scan ${label} processes during reset:`, error)
    }
    await sleep(500)
    return
  }

  try {
    const output = execFileSync('ps', ['-eo', 'pid=,command='], {
      encoding: 'utf-8',
      timeout: 10000
    })
    const runtimeRoot = runtimeDir.endsWith(path.sep) ? runtimeDir : `${runtimeDir}${path.sep}`
    for (const line of output.split(/\r?\n/)) {
      const match = line.trim().match(/^(\d+)\s+(.+)$/)
      if (!match || !match[2].includes(runtimeRoot)) continue
      try {
        process.kill(Number(match[1]), 'SIGKILL')
      } catch {}
    }
    await sleep(500)
  } catch (error) {
    log.warn(`Failed to scan ${label} processes during reset:`, error)
  }
}

const removeResetTarget = async (
  label: string,
  targetPath: string,
  removed: string[],
  failed: ResetAppFailure[]
): Promise<void> => {
  if (!fs.existsSync(targetPath)) return

  let lastError: unknown = null
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await fs.promises.rm(targetPath, { recursive: true, force: true })
      if (!fs.existsSync(targetPath)) {
        removed.push(targetPath)
        log.info(`Factory reset removed ${label}:`, targetPath)
        return
      }
      lastError = new Error('The path still exists after deletion')
    } catch (error) {
      lastError = error
    }
    if (attempt < 5) await sleep(attempt * 500)
  }

  const message = lastError ? getErrorMessage(lastError) : 'Unknown deletion error'
  log.error(`Factory reset could not remove ${label} at ${targetPath}:`, lastError)
  failed.push({ label, path: targetPath, error: message })
}

export const resetApp = async (): Promise<ResetAppResult> => {
  const config = await getConfig()
  const userDataDir = path.resolve(getUserDataPath())
  const installDir = path.resolve(config.installDir || userDataDir)
  const dataDir = path.resolve(config.dataDir || path.join(installDir, 'data'))
  const pythonDir = path.join(installDir, 'python')
  const configPath = path.join(userDataDir, 'config.json')
  const removed: string[] = []
  const failed: ResetAppFailure[] = []
  const warnings: string[] = []

  // Services are stopped by the main-process reset coordinator. This catches
  // orphaned Python children left by an interrupted install or an earlier run.
  await stopRuntimeProcesses(pythonDir, 'bundled Python')
  await stopRuntimeProcesses(path.join(installDir, 'llama.cpp'), 'llama.cpp')

  const targets = [
    { label: 'Python runtime', path: pythonDir },
    { label: 'AuraPro data', path: dataDir },
    { label: 'llama.cpp runtime', path: path.join(installDir, 'llama.cpp') },
    { label: 'downloaded models', path: path.join(installDir, 'models') },
    { label: 'Sherpa runtime files', path: path.join(installDir, 'sherpa') },
    { label: 'service locks', path: path.join(userDataDir, 'locks') },
    { label: 'Python download', path: path.join(userDataDir, 'python.tar.gz') },
    { label: 'partial Python download', path: path.join(userDataDir, 'python.tar.gz.tmp') }
  ]
  const seen = new Set<string>()
  for (const target of targets) {
    const key = process.platform === 'win32' ? target.path.toLowerCase() : target.path
    if (seen.has(key)) continue
    seen.add(key)
    await removeResetTarget(target.label, target.path, removed, failed)
  }

  // Keep config.json until every configured custom path has been handled. If a
  // security product still holds a file, retaining the path lets the user retry.
  if (failed.length === 0) {
    await removeResetTarget('configuration', configPath, removed, failed)
    await removeResetTarget('temporary configuration', `${configPath}.tmp`, removed, failed)
  }

  try {
    await session.defaultSession.clearStorageData()
    await session.defaultSession.clearCache()
    log.info('Cleared Electron session data')
  } catch (error) {
    const message = getErrorMessage(error)
    warnings.push(`Electron session data: ${message}`)
    log.warn('Failed to clear Electron session data:', error)
  }

  return {
    success: failed.length === 0,
    removed,
    failed,
    warnings
  }
}
