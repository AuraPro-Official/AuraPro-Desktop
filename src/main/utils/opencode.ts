import crypto from 'crypto'
import * as fs from 'fs'
import { execFileSync, execSync } from 'child_process'
import { homedir } from 'os'
import * as path from 'path'

import log from 'electron-log'
import * as pty from 'node-pty'
import * as tar from 'tar'

import {
  downloadFileWithProgress,
  formatDownloadBytes,
  formatDownloadEta,
  formatDownloadSpeed,
  getConfig,
  getInstallDir,
  getOpenCodeRuntimeFilePath,
  portInUse,
  setConfig
} from './index'
import { isProcessAlive, ServiceLock } from './service-lock'

interface OpenCodeReleaseAsset {
  name: string
  browser_download_url: string
  digest?: string
}

interface OpenCodeRelease {
  tag_name: string
  assets: OpenCodeReleaseAsset[]
}

interface OpenCodeInstallMetadata {
  version: string
  asset: string
  installedAt: string
}

export interface OpenCodeInfo {
  url: string | null
  status: string | null
  pid: number | null
  binaryPath: string | null
  version: string | null
  username: string
}

type OpenCodeStartResult = {
  url: string
  pid: number
  version: string | null
  username: string
}

interface OpenCodeRuntimeDescriptor {
  version: 1
  url: string
  username: string
  password: string
  pid: number
  openCodeVersion: string | null
}

const OPEN_CODE_REPOSITORY = 'anomalyco/opencode'
const OPEN_CODE_DEFAULT_PORT = 39484
const OPEN_CODE_USERNAME = 'aurapro'
const OPEN_CODE_MAX_LOG_CHUNKS = 5000

let ptyProcess: pty.IPty | null = null
let pid: number | null = null
let url: string | null = null
let status: string | null = null
let binaryPath: string | null = null
let logBuffer: string[] = []
let intentionalStop = false
let runtimeStatusHandler: ((nextStatus: string) => void) | null = null

const lock = new ServiceLock('opencode')
const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const getOpenCodeRoot = (): string => path.join(getInstallDir(), 'opencode')
const getOpenCodeBinDir = (): string => path.join(getOpenCodeRoot(), 'bin')
const getOpenCodeDownloadDir = (): string => path.join(getOpenCodeRoot(), 'downloads')
const getOpenCodeMetadataPath = (): string => path.join(getOpenCodeRoot(), 'install.json')
const executableName = (): string => (process.platform === 'win32' ? 'opencode.exe' : 'opencode')

const readMetadata = (): OpenCodeInstallMetadata | null => {
  try {
    return JSON.parse(fs.readFileSync(getOpenCodeMetadataPath(), 'utf8'))
  } catch {
    return null
  }
}

const writeMetadata = (metadata: OpenCodeInstallMetadata): void => {
  fs.mkdirSync(getOpenCodeRoot(), { recursive: true })
  fs.writeFileSync(getOpenCodeMetadataPath(), JSON.stringify(metadata, null, 2), 'utf8')
}

const findBinary = (): string | null => {
  const preferred = path.join(getOpenCodeBinDir(), executableName())
  if (fs.existsSync(preferred)) return preferred

  const root = getOpenCodeRoot()
  if (!fs.existsSync(root)) return null
  const pending = [root]
  while (pending.length > 0) {
    const current = pending.shift()
    if (!current) break
    try {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const entryPath = path.join(current, entry.name)
        if (entry.isDirectory()) pending.push(entryPath)
        else if (entry.name === executableName()) return entryPath
      }
    } catch {}
  }
  return null
}

const installedVersion = (): string | null => {
  const metadataVersion = readMetadata()?.version
  if (metadataVersion) return metadataVersion
  const binary = binaryPath ?? findBinary()
  if (!binary) return null
  try {
    return execFileSync(binary, ['--version'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000
    })
      .trim()
      .replace(/^v/i, '')
  } catch {
    return null
  }
}

const removeRuntimeDescriptor = (): void => {
  const runtimeFile = getOpenCodeRuntimeFilePath()
  try {
    fs.unlinkSync(runtimeFile)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') {
      log.warn(`Failed to remove OpenCode runtime descriptor: ${runtimeFile}`, error)
    }
  }
}

const publishRuntimeDescriptor = (
  serverUrl: string,
  username: string,
  password: string,
  processId: number
): void => {
  const runtimeFile = getOpenCodeRuntimeFilePath()
  const runtimeDir = path.dirname(runtimeFile)
  const temporaryFile = `${runtimeFile}.${process.pid}.${Date.now()}.tmp`
  const descriptor: OpenCodeRuntimeDescriptor = {
    version: 1,
    url: serverUrl,
    username,
    password,
    pid: processId,
    openCodeVersion: installedVersion()
  }

  try {
    fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o700 })
    fs.writeFileSync(temporaryFile, JSON.stringify(descriptor), {
      encoding: 'utf8',
      mode: 0o600
    })
    fs.renameSync(temporaryFile, runtimeFile)
    try {
      fs.chmodSync(runtimeFile, 0o600)
    } catch {}
    log.info(`Published private OpenCode runtime descriptor: ${runtimeFile}`)
  } catch (error) {
    try {
      fs.unlinkSync(temporaryFile)
    } catch {}
    throw new Error(`Failed to publish OpenCode runtime descriptor: ${errorMessage(error)}`)
  }
}

const buildInlineConfig = (value: string | undefined): string => {
  let configured: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(value || '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) configured = parsed
  } catch {}
  const existingPermission =
    configured.permission &&
    typeof configured.permission === 'object' &&
    !Array.isArray(configured.permission)
      ? configured.permission
      : {}
  return JSON.stringify({
    ...configured,
    permission: {
      ...existingPermission,
      edit: 'ask',
      bash: 'ask',
      external_directory: 'deny',
      question: 'deny'
    }
  })
}

const githubHeaders = (): Record<string, string> => ({
  Accept: 'application/vnd.github+json',
  'User-Agent': 'AuraPro-Desktop',
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {})
})

const fetchRelease = async (version: string): Promise<OpenCodeRelease> => {
  const normalized = version.trim().replace(/^v/i, '') || 'latest'
  const endpoint =
    normalized === 'latest'
      ? `https://api.github.com/repos/${OPEN_CODE_REPOSITORY}/releases/latest`
      : `https://api.github.com/repos/${OPEN_CODE_REPOSITORY}/releases/tags/v${normalized}`
  const response = await fetch(endpoint, {
    headers: githubHeaders(),
    signal: AbortSignal.timeout(15000)
  })
  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status} while checking OpenCode releases.`)
  }
  return (await response.json()) as OpenCodeRelease
}

const isMuslLinux = (): boolean => {
  if (process.platform !== 'linux') return false
  if (fs.existsSync('/etc/alpine-release')) return true
  try {
    return /musl/i.test(execFileSync('ldd', ['--version'], { encoding: 'utf8' }))
  } catch {
    return false
  }
}

const needsBaselineBinary = (): boolean => {
  if (process.arch !== 'x64') return false
  try {
    if (process.platform === 'win32') {
      const result = execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '(Add-Type -MemberDefinition \'[DllImport("kernel32.dll")] public static extern bool IsProcessorFeaturePresent(int feature);\' -Name Kernel32 -Namespace Win32 -PassThru)::IsProcessorFeaturePresent(40)'
        ],
        { encoding: 'utf8', windowsHide: true, timeout: 5000 }
      )
      return !/true|1/i.test(result.trim())
    }
    if (process.platform === 'darwin') {
      return (
        execFileSync('sysctl', ['-n', 'hw.optional.avx2_0'], {
          encoding: 'utf8',
          timeout: 5000
        }).trim() !== '1'
      )
    }
    if (process.platform === 'linux') {
      return !/\bavx2\b/i.test(fs.readFileSync('/proc/cpuinfo', 'utf8'))
    }
  } catch {
    return true
  }
  return false
}

const releaseAssetName = (): string => {
  if (!['win32', 'darwin', 'linux'].includes(process.platform)) {
    throw new Error(`OpenCode does not support ${process.platform}.`)
  }
  const platform =
    process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux'
  if (!['x64', 'arm64'].includes(process.arch)) {
    throw new Error(`OpenCode does not support ${process.platform}/${process.arch}.`)
  }

  const suffixes: string[] = []
  if (needsBaselineBinary()) suffixes.push('baseline')
  if (platform === 'linux' && isMuslLinux()) suffixes.push('musl')
  const extension = platform === 'linux' ? 'tar.gz' : 'zip'
  return `opencode-${platform}-${process.arch}${suffixes.map((value) => `-${value}`).join('')}.${extension}`
}

const extractArchive = async (archive: string, destination: string): Promise<void> => {
  fs.mkdirSync(destination, { recursive: true })
  if (archive.endsWith('.tar.gz')) {
    await tar.x({ cwd: destination, file: archive })
    return
  }

  if (process.platform === 'win32') {
    execFileSync('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath '${archive.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}' -Force`
    ])
  } else {
    execFileSync('unzip', ['-o', archive, '-d', destination])
  }
}

const verifyArchiveDigest = async (archivePath: string, digest?: string): Promise<void> => {
  if (!digest) return
  const match = digest.match(/^sha256:([a-f0-9]{64})$/i)
  if (!match) return

  const actual = await new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const input = fs.createReadStream(archivePath)
    input.on('error', reject)
    input.on('data', (chunk) => hash.update(chunk))
    input.on('end', () => resolve(hash.digest('hex')))
  })
  if (actual.toLowerCase() !== match[1].toLowerCase()) {
    throw new Error('OpenCode archive checksum verification failed.')
  }
}

export const setupOpenCode = async (
  requestedVersion?: string,
  onStatus?: (message: string) => void,
  force = false
): Promise<string> => {
  const config = await getConfig()
  const version = requestedVersion || config.openCode?.version || 'latest'
  const existing = findBinary()
  if (existing && !force) {
    binaryPath = existing
    return existing
  }

  onStatus?.('Checking the latest OpenCode release...')
  const release = await fetchRelease(version)
  const resolvedVersion = release.tag_name.replace(/^v/i, '')
  const preferredName = releaseAssetName()
  const fallbackName = preferredName.replace('-baseline', '').replace('-musl', '')
  const asset =
    release.assets.find((item) => item.name === preferredName) ??
    release.assets.find((item) => item.name === fallbackName)
  if (!asset) {
    throw new Error(`OpenCode release ${release.tag_name} does not include ${preferredName}.`)
  }

  if (ptyProcess || pid) await stopOpenCode()
  const root = getOpenCodeRoot()
  const binDir = getOpenCodeBinDir()
  const downloadDir = getOpenCodeDownloadDir()
  const archivePath = path.join(downloadDir, asset.name)
  const extractDir = path.join(root, `extract-${process.pid}-${Date.now()}`)
  fs.mkdirSync(downloadDir, { recursive: true })

  try {
    if (force) {
      try {
        fs.rmSync(archivePath, { force: true })
      } catch {}
    } else if (fs.existsSync(archivePath) && asset.digest) {
      try {
        await verifyArchiveDigest(archivePath, asset.digest)
      } catch {
        onStatus?.('Discarding an outdated or damaged OpenCode download...')
        try {
          fs.rmSync(archivePath, { force: true })
        } catch {}
      }
    }
    await downloadFileWithProgress(
      asset.browser_download_url,
      archivePath,
      (progress, downloaded, total, speed, eta) => {
        onStatus?.(
          `Downloading OpenCode... ${progress.toFixed(0)}% ` +
            `(${formatDownloadBytes(downloaded)}/${formatDownloadBytes(total)} · ` +
            `${formatDownloadSpeed(speed)} · ETA ${formatDownloadEta(eta)})`
        )
      }
    )
    onStatus?.('Verifying OpenCode download...')
    await verifyArchiveDigest(archivePath, asset.digest)
    onStatus?.('Extracting OpenCode...')
    await extractArchive(archivePath, extractDir)
    const extractedBinary = (() => {
      const direct = path.join(extractDir, executableName())
      if (fs.existsSync(direct)) return direct
      const nested = path.join(extractDir, 'bin', executableName())
      if (fs.existsSync(nested)) return nested
      return null
    })()
    if (!extractedBinary) throw new Error('OpenCode binary was not found after extraction.')

    fs.rmSync(binDir, { recursive: true, force: true })
    fs.mkdirSync(binDir, { recursive: true })
    const targetBinary = path.join(binDir, executableName())
    fs.copyFileSync(extractedBinary, targetBinary)
    if (process.platform !== 'win32') fs.chmodSync(targetBinary, 0o755)
    writeMetadata({
      version: resolvedVersion,
      asset: asset.name,
      installedAt: new Date().toISOString()
    })
    binaryPath = targetBinary
    onStatus?.('OpenCode is ready')
    return targetBinary
  } catch (error) {
    try {
      fs.rmSync(archivePath, { force: true })
    } catch {}
    throw new Error(`OpenCode installation failed: ${errorMessage(error)}`)
  } finally {
    try {
      fs.rmSync(extractDir, { recursive: true, force: true })
    } catch {}
  }
}

const waitForHealth = async (
  serverUrl: string,
  username: string,
  password: string
): Promise<void> => {
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
  for (let attempt = 0; attempt < 60; attempt++) {
    if (!ptyProcess || !pid) throw new Error('OpenCode exited before it became ready.')
    try {
      const response = await fetch(`${serverUrl}/global/health`, {
        headers: { Authorization: authorization },
        signal: AbortSignal.timeout(1500)
      })
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('OpenCode did not become ready within 30 seconds.')
}

export const startOpenCode = async (
  requestedPort: number | null = null,
  onStatus?: (message: string) => void
): Promise<OpenCodeStartResult> => {
  if (!lock.acquire()) {
    const version = installedVersion()
    if (url && pid) return { url, pid, version, username: OPEN_CODE_USERNAME }
    throw new Error('OpenCode is already starting.')
  }

  try {
    removeRuntimeDescriptor()
    await stopOpenCode()
    lock.acquire()
    const config = await getConfig()
    const executable = findBinary() ?? (await setupOpenCode(config.openCode?.version, onStatus))
    const desiredPort = requestedPort || config.openCode?.port || OPEN_CODE_DEFAULT_PORT
    let availablePort = desiredPort
    while (await portInUse(availablePort, '127.0.0.1')) {
      availablePort++
      if (availablePort > desiredPort + 100)
        throw new Error('No available port found for OpenCode.')
    }

    let password = config.openCode?.password
    if (!password) {
      password = crypto.randomBytes(32).toString('base64url')
      await setConfig({ openCode: { ...config.openCode, password } })
    }

    const configuredCwd = config.openCode?.cwd?.trim()
    const cwd =
      configuredCwd && fs.existsSync(configuredCwd) && fs.statSync(configuredCwd).isDirectory()
        ? configuredCwd
        : homedir()
    const args = ['serve', '--hostname', '127.0.0.1', '--port', String(availablePort)]
    const spawned = pty.spawn(executable, args, {
      name: 'xterm-256color',
      cols: 200,
      rows: 50,
      cwd,
      env: {
        ...process.env,
        ...(config.envVars ?? {}),
        OPENCODE_SERVER_USERNAME: OPEN_CODE_USERNAME,
        OPENCODE_SERVER_PASSWORD: password,
        OPENCODE_CONFIG_CONTENT: buildInlineConfig(
          config.envVars?.OPENCODE_CONFIG_CONTENT ?? process.env.OPENCODE_CONFIG_CONTENT
        ),
        NO_COLOR: '1'
      }
    })

    intentionalStop = false
    ptyProcess = spawned
    pid = spawned.pid
    status = 'starting'
    url = `http://127.0.0.1:${availablePort}`
    binaryPath = executable
    logBuffer = []

    spawned.onData((data) => {
      logBuffer.push(data)
      if (logBuffer.length > OPEN_CODE_MAX_LOG_CHUNKS) logBuffer.shift()
      log.info(`[OpenCode:${spawned.pid}] ${data.replace(/[\r\n]+/g, ' ').trim()}`)
    })
    spawned.onExit(({ exitCode, signal }) => {
      log.info(`[OpenCode:${spawned.pid}] Exited code=${exitCode} signal=${signal}`)
      ptyProcess = null
      pid = null
      url = null
      status = intentionalStop ? 'stopped' : 'failed'
      removeRuntimeDescriptor()
      runtimeStatusHandler?.(status)
      lock.release()
    })

    onStatus?.('Waiting for OpenCode to start...')
    await waitForHealth(url, OPEN_CODE_USERNAME, password)
    status = 'started'
    publishRuntimeDescriptor(url, OPEN_CODE_USERNAME, password, spawned.pid)
    return {
      url,
      pid: spawned.pid,
      version: installedVersion(),
      username: OPEN_CODE_USERNAME
    }
  } catch (error) {
    await stopOpenCode()
    status = 'failed'
    throw error
  } finally {
    lock.release()
  }
}

export const stopOpenCode = async (): Promise<void> => {
  intentionalStop = true
  removeRuntimeDescriptor()
  const targetPid = pid
  if (ptyProcess) {
    try {
      ptyProcess.kill()
    } catch {}
  }
  if (targetPid) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    if (isProcessAlive(targetPid)) {
      try {
        if (process.platform === 'win32') {
          execSync(`taskkill /PID ${targetPid} /T /F`, { windowsHide: true, stdio: 'ignore' })
        } else {
          process.kill(targetPid, 'SIGKILL')
        }
      } catch {}
    }
  }
  ptyProcess = null
  pid = null
  url = null
  status = null
  lock.release()
}

export const uninstallOpenCode = async (): Promise<boolean> => {
  await stopOpenCode()
  try {
    fs.rmSync(getOpenCodeRoot(), { recursive: true, force: true })
    binaryPath = null
    logBuffer = []
    return true
  } catch (error) {
    throw new Error(`Failed to uninstall OpenCode: ${errorMessage(error)}`)
  }
}

export const isOpenCodeInstalled = (): boolean => Boolean(findBinary())

export const getOpenCodeInfo = (): OpenCodeInfo => {
  binaryPath = binaryPath ?? findBinary()
  return {
    url,
    status,
    pid,
    binaryPath,
    version: installedVersion(),
    username: OPEN_CODE_USERNAME
  }
}

export const getOpenCodePty = (): pty.IPty | null => ptyProcess
export const getOpenCodeLog = (): string[] => logBuffer

export const setOpenCodeRuntimeStatusHandler = (
  handler: ((nextStatus: string) => void) | null
): void => {
  runtimeStatusHandler = handler
}

export const validateOpenCodeProcess = (): boolean => {
  if (!pid) return false
  if (isProcessAlive(pid)) return true
  ptyProcess = null
  pid = null
  url = null
  status = null
  lock.release()
  return false
}
