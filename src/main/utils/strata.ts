import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import * as tar from 'tar'
import adapterPath from '../../../resources/strata_adapter.py?asset&asarUnpack'
import { getInstallDir, getPythonPath, portInUse } from './index'
import { inferenceCoordinator } from './inference-coordinator'
import {
  DEFAULT_STRATA_SETTINGS,
  STRATA_MODELS,
  STRATA_PORT,
  STRATA_SOURCE,
  strataConfigName,
  strataHardwareRecommendation,
  strataSetupArgs,
  validateStrataSettings,
  type StrataSettings
} from './strata-models'

type Installation = { source: string; revision?: string; version: string; backend: string }
let server: ChildProcess | null = null
let worker: ChildProcess | null = null
let operation: AbortController | null = null
let startupAbort: AbortController | null = null
let status = 'stopped'
let error = ''
let output = ''
const stopping = new WeakMap<ChildProcess, Promise<void>>()

const root = () => path.join(getInstallDir(), 'strata')
const sourceDir = (source: string) => path.join(root(), 'versions', source)
const python = (source: string) =>
  path.join(
    sourceDir(source),
    '.venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
  )
const supported = () => ['win32', 'linux'].includes(process.platform) && process.arch === 'x64'

function readJson<T>(file: string, fallback: T): T {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2))
  fs.renameSync(`${file}.tmp`, file)
}

const installation = () => readJson<Installation | null>(path.join(root(), 'installed.json'), null)
export const getStrataSettings = (): StrataSettings =>
  validateStrataSettings(readJson(path.join(root(), 'settings.json'), DEFAULT_STRATA_SETTINGS))

function append(data: Buffer | string): void {
  output = (output + data.toString()).slice(-24000)
}

async function terminate(child: ChildProcess | null): Promise<void> {
  if (!child) return
  const pending = stopping.get(child)
  if (pending) return pending
  const task = terminateProcess(child)
  stopping.set(child, task)
  try {
    await task
  } finally {
    stopping.delete(child)
  }
}

async function terminateProcess(child: ChildProcess): Promise<void> {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    await promisify(execFile)('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true
    })
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ESRCH') throw err
    }
  }
  const deadline = Date.now() + 10000
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (child.exitCode === null && child.signalCode === null) {
    throw new Error('Pro process has not stopped; refusing to start another runtime')
  }
}

function run(exe: string, args: string[], cwd: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      cwd,
      windowsHide: true,
      detached: process.platform !== 'win32',
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONUTF8: '1', PYTHONNOUSERSITE: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    worker = child
    const abort = () => {
      void terminate(child).catch((err) => append(String(err)))
    }
    signal.addEventListener('abort', abort, { once: true })
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    child.once('error', reject)
    child.once('close', (code) => {
      signal.removeEventListener('abort', abort)
      if (worker === child) worker = null
      if (signal.aborted) reject(new Error('Pro operation cancelled'))
      else if (code !== 0)
        reject(new Error(`Pro command exited with code ${code}. ${output.slice(-1600)}`))
      else resolve()
    })
    if (signal.aborted) abort()
  })
}

export async function getStrataInfo() {
  const installed = installation()
  const settings = getStrataSettings()
  const dir = installed ? sourceDir(installed.source) : ''
  return {
    supported: supported(),
    status,
    error,
    logs: output,
    installed,
    port: STRATA_PORT,
    settings,
    models: STRATA_MODELS.map((model) => ({
      ...model,
      ramInfo: strataHardwareRecommendation(model),
      experimental: model.family === 'unsloth',
      installed: !!dir && fs.existsSync(path.join(dir, strataConfigName(model.id)))
    }))
  }
}

async function exclusiveOperation(action: (signal: AbortSignal) => Promise<void>): Promise<void> {
  if (!supported()) throw new Error('Pro currently supports Windows/Linux x64 only')
  if (operation) throw new Error('Another Pro operation is already running')
  const controller = new AbortController()
  operation = controller
  error = ''
  output = ''
  try {
    await stopStrata()
    controller.signal.throwIfAborted()
    status = 'installing'
    await action(controller.signal)
    controller.signal.throwIfAborted()
    status = 'stopped'
  } catch (err) {
    status = controller.signal.aborted ? 'stopped' : 'failed'
    error = controller.signal.aborted ? '' : String(err)
    throw err
  } finally {
    operation = null
  }
}

export async function cancelStrataOperation(): Promise<void> {
  operation?.abort()
  startupAbort?.abort()
  await terminate(worker)
}

export async function checkStrataHealth() {
  const info = await getStrataInfo().catch((err) => ({
    supported: supported(),
    status: 'failed',
    error: String(err),
    logs: output,
    installed: null,
    port: STRATA_PORT,
    settings: DEFAULT_STRATA_SETTINGS,
    models: [] as Awaited<ReturnType<typeof getStrataInfo>>['models']
  }))
  let detail = info.error
  let health: 'healthy' | 'starting' | 'stopped' | 'unresponsive' =
    info.status === 'starting' ? 'starting' : 'stopped'
  try {
    if (!info.installed) throw new Error('Install Pro in Desktop settings first')
    readPreparedConfig(info.installed, info.settings)
    if (info.status === 'started') {
      const response = await fetch(`http://127.0.0.1:${STRATA_PORT}/health`, {
        signal: AbortSignal.timeout(3000)
      })
      const body = (await response.json()) as { service?: string; loaded?: boolean }
      if (!response.ok || body.service !== 'strata' || body.loaded !== true)
        throw new Error('Pro health check failed')
      health = 'healthy'
      detail = ''
    }
  } catch (err) {
    detail = String(err)
    health = 'unresponsive'
  }
  return { ...info, health, detail }
}

export async function checkStrataUpdate(): Promise<{ version: string; source: string }> {
  const response = await fetch('https://api.github.com/repos/Niko1221/Strata/releases/latest', {
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(20000)
  })
  if (!response.ok) throw new Error(`Strata release lookup failed: ${response.status}`)
  const release = (await response.json()) as { tag_name: string }
  if (!/^v\d+\.\d+\.\d+$/.test(release.tag_name)) throw new Error('Unexpected Strata release tag')
  return { version: release.tag_name, source: release.tag_name }
}

export async function installStrata(update = false, requested?: StrataSettings): Promise<void> {
  const settings = validateStrataSettings(requested ?? getStrataSettings())
  await exclusiveOperation(async (signal) => {
    const previous = installation()
    const revision = update
      ? (await checkStrataUpdate()).source
      : previous?.revision || STRATA_SOURCE
    // Never repair/update the directory that installed.json currently points to.
    const source = `${revision}-${randomUUID()}`
    const dir = sourceDir(source)
    fs.mkdirSync(dir, { recursive: true })
    if (!fs.existsSync(path.join(dir, '.source-ready'))) {
      const archive = path.join(dir, 'source.tar.gz')
      const response = await fetch(
        `https://api.github.com/repos/Niko1221/Strata/tarball/${revision}`,
        { signal }
      )
      if (!response.ok || !response.body)
        throw new Error(`Strata download failed: ${response.status}`)
      await pipeline(Readable.fromWeb(response.body as never), fs.createWriteStream(archive), {
        signal
      })
      await tar.x({
        file: archive,
        cwd: dir,
        strip: 1,
        filter: (_name, entry) => 'type' in entry && ['File', 'Directory'].includes(entry.type)
      })
      fs.writeFileSync(path.join(dir, '.source-ready'), source)
      fs.unlinkSync(archive)
    }
    signal.throwIfAborted()
    if (!fs.existsSync(python(source))) {
      await run(getPythonPath(), ['-m', 'venv', path.join(dir, '.venv')], dir, signal)
    }
    await run(python(source), [adapterPath, dir, 'install', settings.backend], dir, signal)
    const meta = readJson<{ version: string; backend?: string }>(
      path.join(dir, 'engine', 'BUILD.json'),
      { version: '' }
    )
    if (!meta.version) throw new Error('Pro installation did not produce a valid runtime')
    // Preserve model data across engine upgrades; only rewrite paths inside the old source tree.
    if (previous && previous.source !== source && previous.backend === (meta.backend || 'cuda')) {
      const oldDir = sourceDir(previous.source)
      const relocate = (value: unknown): unknown => {
        if (
          typeof value === 'string' &&
          (value === oldDir || value.startsWith(oldDir + path.sep))
        ) {
          return dir + value.slice(oldDir.length)
        }
        if (Array.isArray(value)) return value.map(relocate)
        if (value && typeof value === 'object')
          return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [key, relocate(item)])
          )
        return value
      }
      for (const model of STRATA_MODELS) {
        const file = strataConfigName(model.id)
        const config = readJson(path.join(oldDir, file), null)
        if (config) writeJson(path.join(dir, file), relocate(config))
      }
    }
    signal.throwIfAborted()
    writeJson(path.join(root(), 'installed.json'), {
      source,
      revision,
      version: meta.version,
      backend: meta.backend || 'cuda'
    })
    writeJson(path.join(root(), 'settings.json'), settings)
  })
}

export async function prepareStrataModel(settings: StrataSettings): Promise<void> {
  const valid = validateStrataSettings(settings)
  await exclusiveOperation(async (signal) => {
    const installed = installation()
    if (!installed) throw new Error('Install Pro before downloading a model')
    const dir = sourceDir(installed.source)
    await run(
      python(installed.source),
      [adapterPath, dir, 'model', ...strataSetupArgs(valid, path.join(root(), 'data'))],
      dir,
      signal
    )
    signal.throwIfAborted()
    if (!fs.existsSync(path.join(dir, strataConfigName(valid.model))))
      throw new Error('Pro model preparation did not finish')
    const meta = readJson<{ backend?: string }>(path.join(dir, 'engine', 'BUILD.json'), {})
    writeJson(path.join(root(), 'installed.json'), {
      ...installed,
      backend: meta.backend || 'cuda'
    })
    writeJson(path.join(root(), 'settings.json'), valid)
  })
}

export async function saveStrataSettings(settings: StrataSettings): Promise<void> {
  const valid = validateStrataSettings(settings)
  if (operation) throw new Error('Wait for the current Pro operation to finish')
  const installed = installation()
  const old = getStrataSettings()
  if (installed && (old.backend !== valid.backend || old.vision !== valid.vision)) {
    throw new Error('Use Prepare model to apply backend or vision changes')
  }
  if (installed && inferenceCoordinator.current === 'pro') readPreparedConfig(installed, valid)
  await inferenceCoordinator.configure('pro', async () => {
    writeJson(path.join(root(), 'settings.json'), valid)
  })
}

function readPreparedConfig(
  installed: Installation,
  settings: StrataSettings
): Record<string, unknown> {
  const dir = sourceDir(installed.source)
  const config = readJson<Record<string, unknown> | null>(
    path.join(dir, strataConfigName(settings.model)),
    null
  )
  if (
    !config ||
    typeof config.exe !== 'string' ||
    !fs.existsSync(config.exe) ||
    !Array.isArray(config.args) ||
    !config.args.every((value) => typeof value === 'string') ||
    !fs.existsSync(python(installed.source))
  ) {
    throw new Error('Prepare the selected Pro model in Desktop settings first')
  }
  if (
    (config.backend || 'cuda') !== installed.backend ||
    (settings.backend !== 'auto' && settings.backend !== installed.backend)
  ) {
    throw new Error('Prepare this model again for the selected Pro backend')
  }
  if (settings.vision && !config.vision)
    throw new Error('Prepare this model with image input enabled first')
  return config
}

async function stopRaw(): Promise<void> {
  const child = server
  await terminate(child)
  server = null
  status = 'stopped'
}

export async function stopStrata(): Promise<void> {
  await inferenceCoordinator.stop('pro', stopRaw)
}

async function startRaw(): Promise<void> {
  if (operation) throw new Error('Pro installation or model preparation is still running')
  if (server && status === 'started') return
  const installed = installation()
  if (!installed) throw new Error('Install Pro and prepare a model in Desktop settings first')
  const settings = getStrataSettings()
  const dir = sourceDir(installed.source)
  const config = readPreparedConfig(installed, settings)
  if (await portInUse(STRATA_PORT))
    throw new Error('Pro port 18882 is occupied; no alternate port will be used')
  const args = [...(config.args as string[])]
  if (!settings.vision) {
    delete config.vision
    const vision = args.indexOf('--vision')
    if (vision >= 0) args.splice(vision, 1)
  }
  const setArg = (key: string, value: string) => {
    const index = args.indexOf(key)
    if (index >= 0) args[index + 1] = value
    else args.push(key, value)
  }
  setArg('--max-context', String(settings.context))
  setArg('--kv', settings.kv)
  // A smaller context or hybrid cache must not inherit a previous KV streaming setup.
  const resident = args.indexOf('--kv-resident')
  if (resident >= 0 && (settings.context < 65536 || settings.kv === 'k8v4'))
    args.splice(resident, 2)
  const runtimeConfig = path.join(dir, 'aurapro-active.json')
  writeJson(runtimeConfig, {
    ...config,
    args,
    aliases: ['aurapro-pro'],
    host: '127.0.0.1',
    port: STRATA_PORT
  })
  error = ''
  status = 'starting'
  const controller = new AbortController()
  startupAbort = controller
  const child = spawn(
    python(installed.source),
    [
      path.join(dir, 'serve', 'server.py'),
      '--engine',
      'strata',
      '--config',
      runtimeConfig,
      '--host',
      '127.0.0.1',
      '--port',
      String(STRATA_PORT)
    ],
    {
      cwd: dir,
      windowsHide: true,
      detached: process.platform !== 'win32',
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONUTF8: '1', PYTHONNOUSERSITE: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  server = child
  child.stdout?.on('data', append)
  child.stderr?.on('data', append)
  child.once('error', (err) => {
    error = err.message
    status = 'failed'
  })
  child.once('exit', (code) => {
    if (server === child) {
      server = null
      status = 'failed'
      error = `Pro exited (${code}). ${output.slice(-1200)}`
    }
  })
  try {
    const deadline = Date.now() + 300000
    while (Date.now() < deadline) {
      controller.signal.throwIfAborted()
      if (server !== child || status === 'failed') throw new Error(error)
      try {
        const response = await fetch(`http://127.0.0.1:${STRATA_PORT}/health`, {
          signal: AbortSignal.timeout(1500)
        })
        if (response.ok) {
          const health = (await response.json()) as { service?: string; loaded?: boolean }
          if (health.service === 'strata' && health.loaded === true) {
            status = 'started'
            return
          }
        }
      } catch {
        /* The model can take several minutes to load. */
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    throw new Error('Pro did not become ready within five minutes')
  } catch (err) {
    await stopRaw()
    status = 'failed'
    error = String(err)
    throw err
  } finally {
    if (startupAbort === controller) startupAbort = null
  }
}

export async function startStrata(): Promise<void> {
  await inferenceCoordinator.start('pro', startRaw)
}

inferenceCoordinator.register('pro', {
  validate: async () => {
    if (!supported()) throw new Error('Pro currently supports Windows/Linux x64 only')
    if (operation) throw new Error('Pro preparation is still running')
    const installed = installation()
    if (!installed) throw new Error('Install Pro in Desktop settings first')
    readPreparedConfig(installed, getStrataSettings())
    if (await portInUse(STRATA_PORT)) throw new Error('Pro port 18882 is occupied')
  },
  start: startRaw,
  stop: stopRaw
})
