import crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { homedir } from 'os'
import { execFile, execFileSync } from 'child_process'
import { app } from 'electron'
import * as tar from 'tar'
import type * as pty from 'node-pty'
import {
  downloadFileWithProgress,
  getConfig,
  getInstallDir,
  getOpenCodeRuntimeFilePath
} from './index'

const VERSION = '1.0.3'
const NODE_VERSION = '24.15.0'
const root = () => path.join(getInstallDir(), 'pi')
const agentDir = () => path.join(root(), 'agent')
const binary = () => path.join(root(), 'bin', process.platform === 'win32' ? 'pi.exe' : 'pi')
const bridgeExtension = () => path.join(root(), 'aurapro.ts')
const nodeRoot = () =>
  path.join(
    root(),
    'node',
    `node-v${NODE_VERSION}-${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`
  )
const nodeBin = () => (process.platform === 'win32' ? nodeRoot() : path.join(nodeRoot(), 'bin'))
const nodeExecutable = () =>
  path.join(nodeBin(), process.platform === 'win32' ? 'node.exe' : 'node')
const sdkEntry = () =>
  path.join(
    root(),
    'sdk',
    'node_modules',
    '@earendil-works',
    'pi-coding-agent',
    'dist',
    'bundle',
    'cli.js'
  )
let active = false
let changing = false
let status: string | null = null
let handler: ((status: string) => void) | null = null
const logs: string[] = []
const listeners = new Set<(data: string) => void>()
function report(message: string) {
  const text = `${message}\r\n`
  logs.push(text)
  if (logs.length > 500) logs.shift()
  for (const listener of listeners) listener(text)
}
function env(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PI_CODING_AGENT_DIR: agentDir(),
    PI_OFFLINE: '1',
    PATH: `${nodeBin()}${path.delimiter}${process.env.PATH ?? ''}`
  }
}
function run(args: string[], timeout = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      binary(),
      args,
      { cwd: agentDir(), env: env(), windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) reject(new Error((stderr || stdout || error.message).slice(-4000)))
        else resolve(stdout)
      }
    )
  })
}
async function download(url: string, target: string, onStatus?: (message: string) => void) {
  await downloadFileWithProgress(url, target, (percent) =>
    onStatus?.(`Downloading PI runtime… ${percent.toFixed(0)}%`)
  )
}
async function extract(archive: string, destination: string) {
  fs.mkdirSync(destination, { recursive: true })
  if (archive.endsWith('.tar.gz')) await tar.x({ cwd: destination, file: archive })
  else
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Expand-Archive -LiteralPath '${archive.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}' -Force`
      ],
      { windowsHide: true }
    )
}
async function checksum(file: string, sumsUrl: string, name: string) {
  const response = await fetch(sumsUrl, { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error('Cannot fetch runtime checksums.')
  const line = (await response.text())
    .split('\n')
    .find((line) => line.trim().split(/\s+/).at(-1)?.replace(/^\*/, '') === name)
  const expected = line?.trim().split(/\s+/)[0]
  if (!expected || !/^[a-f0-9]{64}$/i.test(expected)) throw new Error('Missing runtime checksum.')
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  if (hash.digest('hex') !== expected.toLowerCase()) throw new Error('Runtime checksum mismatch.')
}
export async function setupPi(
  requestedVersion?: string,
  onStatus?: (message: string) => void,
  force = false
) {
  if (changing) throw new Error('PI installation is already in progress.')
  if (
    !['win32', 'darwin', 'linux'].includes(process.platform) ||
    !['x64', 'arm64'].includes(process.arch)
  )
    throw new Error('PI does not support this platform.')
  const version =
    requestedVersion && requestedVersion !== 'latest' ? requestedVersion.replace(/^v/, '') : VERSION
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Use a fixed PI release version.')
  if (fs.existsSync(binary()) && !force) return binary()
  changing = true
  const staging = path.join(root(), `staging-${crypto.randomUUID()}`)
  try {
    await stopPi()
    fs.mkdirSync(staging, { recursive: true })
    const platform = process.platform === 'win32' ? 'windows' : process.platform
    const name = `pi-${platform}-${process.arch}.${process.platform === 'win32' ? 'zip' : 'tar.gz'}`
    const base = `https://github.com/earendil-works/pi/releases/download/v${version}`
    const archive = path.join(staging, name)
    await download(`${base}/${name}`, archive, onStatus)
    await checksum(archive, `${base}/SHA256SUMS`, name)
    const unpacked = path.join(staging, 'bin')
    await extract(archive, unpacked)
    const exeName = process.platform === 'win32' ? 'pi.exe' : 'pi'
    if (!fs.existsSync(path.join(unpacked, exeName)))
      throw new Error('PI executable missing from release.')
    if (process.platform !== 'win32') fs.chmodSync(path.join(unpacked, exeName), 0o755)
    const actual = execFileSync(path.join(unpacked, exeName), ['--version'], {
      encoding: 'utf8',
      timeout: 15000,
      windowsHide: true
    }).trim()
    if (actual !== version) throw new Error('PI version verification failed.')
    fs.mkdirSync(agentDir(), { recursive: true })
    const destination = path.join(root(), 'bin')
    const previous = path.join(staging, 'previous')
    if (fs.existsSync(destination)) fs.renameSync(destination, previous)
    try {
      fs.renameSync(unpacked, destination)
    } catch (error) {
      if (fs.existsSync(previous)) fs.renameSync(previous, destination)
      throw error
    }
    fs.writeFileSync(
      path.join(root(), 'install.json'),
      JSON.stringify({ version, installedAt: new Date().toISOString() })
    )
    onStatus?.('PI runtime verified')
    report(`PI ${version} installed`)
    return binary()
  } finally {
    changing = false
    // staging is generated directly beneath the managed PI directory.
    fs.rmSync(staging, { recursive: true, force: true })
  }
}
function copyExtension() {
  const source = path.join(
    app.isPackaged ? process.resourcesPath : app.getAppPath(),
    app.isPackaged ? 'pi-aurapro.mjs' : 'resources/pi-aurapro.mjs'
  )
  const bridge = path.join(root(), 'aurapro.mjs')
  fs.copyFileSync(source, bridge)
  const states = extensionStates()
  const entries = [
    [
      'browser',
      path.join(agentDir(), 'git', 'github.com', 'larsderidder', 'pi-browser', 'index.ts')
    ],
    [
      'computer',
      path.join(
        agentDir(),
        'npm',
        'node_modules',
        '@injaneity',
        'pi-computer-use',
        'extensions',
        'computer-use.ts'
      )
    ]
  ].filter(([id]) => states[id]?.installed)
  // Static imports let PI's extension loader resolve its bundled host modules.
  const imports = entries
    .map(
      ([, file], index) =>
        `import extension${index} from ${JSON.stringify(file.replace(/\\/g, '/'))}`
    )
    .join('\n')
  const factories = entries
    .map(([id], index) => `[${JSON.stringify(id)}, extension${index}]`)
    .join(', ')
  fs.writeFileSync(
    bridgeExtension(),
    `import bridge from ${JSON.stringify(bridge.replace(/\\/g, '/'))}\n${imports}\nexport default (pi) => bridge(pi, [${factories}])\n`
  )
}
export async function startPi(_port: number | null = null, onStatus?: (message: string) => void) {
  if (!fs.existsSync(binary())) await setupPi(undefined, onStatus)
  const config = await getConfig()
  copyExtension()
  const version = await run(['--version'])
  const withExtensions = Object.values(extensionStates()).some((entry) => entry.installed)
  if (withExtensions) await ensureSdk(version.trim(), onStatus)
  const settingsPath = path.join(agentDir(), 'settings.json')
  let settings: Record<string, unknown> = {}
  if (fs.existsSync(settingsPath)) settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
  const extensions = Array.isArray(settings.extensions)
    ? settings.extensions.filter((entry) => entry !== path.join(root(), 'aurapro.mjs'))
    : []
  fs.writeFileSync(
    settingsPath,
    JSON.stringify(
      {
        ...settings,
        extensions: [...new Set([...extensions, bridgeExtension()])],
        ...(process.platform === 'win32' && !settings.defaultTools
          ? { defaultTools: ['read', 'write', 'edit', 'powershell', 'grep', 'find', 'ls'] }
          : {})
      },
      null,
      2
    )
  )
  const descriptor = {
    version: 2,
    engine: 'pi',
    executable: withExtensions ? nodeExecutable() : binary(),
    arguments: withExtensions ? [sdkEntry()] : [],
    agentDir: agentDir(),
    extension: bridgeExtension(),
    ownerPid: process.pid,
    piVersion: version.trim(),
    cwd: config.openCode?.cwd || homedir(),
    environment: {
      ...(config.envVars ?? {}),
      PI_CODING_AGENT_DIR: agentDir(),
      PI_OFFLINE: '1',
      PATH: env().PATH
    }
  }
  const file = getOpenCodeRuntimeFilePath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${crypto.randomUUID()}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(descriptor), { mode: 0o600 })
  fs.renameSync(temporary, file)
  active = true
  status = 'started'
  report('PI is available. WebUI starts isolated RPC sessions on demand.')
  return { url: 'pi://local:39484', pid: process.pid, version: version.trim(), username: 'aurapro' }
}
export async function stopPi() {
  active = false
  status = 'stopped'
  fs.rmSync(getOpenCodeRuntimeFilePath(), { force: true })
  handler?.(status)
  report('PI disabled; WebUI sessions will stop.')
}
export async function uninstallPi() {
  await stopPi()
  fs.rmSync(path.join(root(), 'bin'), { recursive: true, force: true })
  fs.rmSync(path.join(root(), 'install.json'), { force: true })
  return true
}
export function getPiInfo() {
  let version: string | null = null
  try {
    version = JSON.parse(fs.readFileSync(path.join(root(), 'install.json'), 'utf8')).version
  } catch {}
  return {
    url: active ? 'pi://local:39484' : null,
    status,
    pid: active ? process.pid : null,
    binaryPath: fs.existsSync(binary()) ? binary() : null,
    version,
    username: 'aurapro'
  }
}
export const PI_EXTENSIONS = [
  {
    id: 'browser',
    name: 'Browser · Playwright',
    source: 'git:github.com/larsderidder/pi-browser@32b5baaf7ca0d6258b1d0841cff9c6c88aafff2b',
    probe: 'browser_tabs',
    description: '需要 Git；连接开启远程调试的 Chrome / Edge，默认端口 9222，安装后在 WebUI 检查。'
  },
  {
    id: 'computer',
    name: 'Computer Use',
    source: 'npm:@injaneity/pi-computer-use@0.5.1',
    probe: 'find_roots',
    description: '控制桌面应用；需要交互桌面会话，macOS 需要系统授权。'
  }
] as const
type ExtensionState = { installed: boolean; state: 'installed' | 'failed'; detail: string }
function extensionStates(): Record<string, ExtensionState> {
  try {
    return JSON.parse(fs.readFileSync(path.join(root(), 'extensions.json'), 'utf8'))
  } catch {
    return {}
  }
}
export function getPiExtensions() {
  const states = extensionStates()
  return PI_EXTENSIONS.map((item) => ({
    ...item,
    ...(states[item.id] ?? { installed: false, state: 'not_installed', detail: '' })
  }))
}
async function ensureNode(onStatus?: (message: string) => void) {
  const executable = path.join(nodeBin(), process.platform === 'win32' ? 'node.exe' : 'node')
  if (fs.existsSync(executable)) return
  const platform = process.platform === 'win32' ? 'win' : process.platform
  const name = `node-v${NODE_VERSION}-${platform}-${process.arch}.${process.platform === 'win32' ? 'zip' : 'tar.gz'}`
  const file = path.join(root(), name)
  await download(`https://nodejs.org/dist/v${NODE_VERSION}/${name}`, file, onStatus)
  await checksum(file, `https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt`, name)
  await extract(file, path.join(root(), 'node'))
  fs.rmSync(file, { force: true })
}
async function ensureSdk(version: string, onStatus?: (message: string) => void) {
  await ensureNode(onStatus)
  const metadata = path.join(
    root(),
    'sdk',
    'node_modules',
    '@earendil-works',
    'pi-coding-agent',
    'package.json'
  )
  if (
    fs.existsSync(sdkEntry()) &&
    JSON.parse(fs.readFileSync(metadata, 'utf8')).version === version
  )
    return
  onStatus?.('Installing PI Node runtime for extension compatibility…')
  const npm = path.join(
    nodeRoot(),
    process.platform === 'win32' ? 'node_modules' : 'lib/node_modules',
    'npm',
    'bin',
    'npm-cli.js'
  )
  await new Promise<void>((resolve, reject) => {
    execFile(
      nodeExecutable(),
      [
        npm,
        'install',
        '--prefix',
        path.join(root(), 'sdk'),
        '--no-audit',
        '--no-fund',
        '--save-exact',
        `@earendil-works/pi-coding-agent@${version}`
      ],
      { env: env(), windowsHide: true, timeout: 300000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) reject(new Error((stderr || error.message).slice(-4000)))
        else {
          report(stdout)
          resolve()
        }
      }
    )
  })
}
export async function managePiExtension(
  id: string,
  operation: 'install' | 'remove',
  onStatus?: (message: string) => void
) {
  const item = PI_EXTENSIONS.find((item) => item.id === id)
  if (!item) throw new Error('Unknown PI extension.')
  if (changing) throw new Error('Another PI installation is in progress.')
  if (!fs.existsSync(binary())) await setupPi(undefined, onStatus)
  changing = true
  const states = extensionStates()
  try {
    await ensureSdk((await run(['--version'])).trim(), onStatus)
    onStatus?.(`${operation === 'install' ? 'Installing' : 'Removing'} ${item.name}…`)
    report(await run([operation, item.source], 300000))
    const file = path.join(agentDir(), 'settings.json')
    const settings = JSON.parse(fs.readFileSync(file, 'utf8'))
    settings.packages = (settings.packages ?? []).map((entry: string | { source: string }) => {
      const source = typeof entry === 'string' ? entry : entry.source
      return source === item.source
        ? { source, extensions: [], skills: [], prompts: [], themes: [] }
        : entry
    })
    fs.writeFileSync(file, JSON.stringify(settings, null, 2))
    states[id] = {
      installed: operation === 'install',
      state: 'installed',
      detail:
        operation === 'install'
          ? 'Installed. Run the functional check in WebUI before use.'
          : 'Removed'
    }
  } catch (error) {
    states[id] = {
      installed: states[id]?.installed ?? false,
      state: 'failed',
      detail: error instanceof Error ? error.message : String(error)
    }
    throw error
  } finally {
    changing = false
    fs.writeFileSync(path.join(root(), 'extensions.json'), JSON.stringify(states, null, 2))
  }
  if (active) await startPi()
  return getPiExtensions()
}

// Legacy names preserve saved configuration and IPC compatibility.
export const setupOpenCode = setupPi
export const startOpenCode = startPi
export const stopOpenCode = stopPi
export const uninstallOpenCode = uninstallPi
export const getOpenCodeInfo = getPiInfo
export const isOpenCodeInstalled = () => fs.existsSync(binary())
export const getInstalledOpenCodeVersion = async () => getPiInfo().version
export const getOpenCodeServiceState = () => ({ ...getPiInfo(), url: null })
export const validateOpenCodeProcess = () => active
export const getOpenCodeLog = () => logs
export const setOpenCodeRuntimeStatusHandler = (next: typeof handler) => {
  handler = next
}
export const getOpenCodePty = (): Pick<pty.IPty, 'onData'> => ({
  onData: (callback) => {
    listeners.add(callback)
    return {
      dispose: () => {
        listeners.delete(callback)
      }
    }
  }
})
