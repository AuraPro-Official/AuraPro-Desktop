import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import * as tar from 'tar'
import adapterPath from '../../../resources/strata_adapter.py?asset&asarUnpack'
import { getInstallDir, portInUse } from './index'
import { inferenceCoordinator } from './inference-coordinator'
import { setupIsolatedLlamaCpp, latestLlamaCppVersion } from './llamacpp'
import {
  DEFAULT_STRATA_SETTINGS,
  STRATA_MODELS,
  ALL_STRATA_MODELS,
  STRATA_PORT,
  STRATA_SOURCE,
  STRATA_RELEASE,
  strataConfigName,
  strataHardwareRecommendation,
  strataSetupArgs,
  nativeProFiles,
  nativeProArgs,
  validateStrataSettings,
  type StrataSettings
} from './strata-models'

type Installation = {
  source: string
  revision?: string
  version: string
  backend: string
  exe?: string
  managed?: 'control'
  controlVersion?: string
  productVersion?: string
}
let server: ChildProcess | null = null
let worker: ChildProcess | null = null
let operation: AbortController | null = null
let startupAbort: AbortController | null = null
let status = 'stopped'
let error = ''
let output = ''
const logListeners = new Set<(data: string) => void>()

export function subscribeStrataLogs(callback: (data: string) => void): () => void {
  logListeners.add(callback)
  callback(output)
  return () => {
    logListeners.delete(callback)
  }
}
let progress: {
  stage: string
  detail: string
  downloadedBytes?: number
  totalBytes?: number
} | null = null
const stopping = new WeakMap<ChildProcess, Promise<void>>()

const root = () => path.join(getInstallDir(), 'strata')
const sourceDir = (source: string) => path.join(root(), 'versions', source)
const python = (source: string) => {
  const bundled = path.join(
    sourceDir(source),
    'python',
    process.platform === 'win32' ? 'python.exe' : 'bin/python3'
  )
  return fs.existsSync(bundled)
    ? bundled
    : path.join(
        sourceDir(source),
        '.venv',
        process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
      )
}
const native = () => process.platform === 'darwin'
const supported = () =>
  (native() && ['arm64', 'x64'].includes(process.arch)) ||
  (['win32', 'linux'].includes(process.platform) && process.arch === 'x64')

function readJson<T>(file: string, fallback: T): T {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2))
  fs.renameSync(`${file}.tmp`, file)
}

const installation = () => readJson<Installation | null>(path.join(root(), 'installed.json'), null)

function proHealthReady(body: { service?: string; loaded?: boolean; status?: string }): boolean {
  return native() ? body.status === 'ok' : body.service === 'strata' && body.loaded === true
}

function nativeModelReady(model: string, vision = false): boolean {
  const dir = path.join(root(), 'native-models', model)
  const manifest = nativeProFiles(model)
  const sizes = readJson<Record<string, number>>(path.join(dir, 'prepared.json'), {})
  const files = [...manifest.files, ...(vision && manifest.projector ? [manifest.projector] : [])]
  return (
    (!vision || !!manifest.projector) &&
    files.every(
      (file) =>
        sizes[file] > 0 &&
        fs.existsSync(path.join(dir, file)) &&
        fs.statSync(path.join(dir, file)).size === sizes[file]
    )
  )
}

async function prepareNativeModel(settings: StrataSettings, signal: AbortSignal): Promise<void> {
  nativeProArgs(settings, 'validation.gguf', settings.vision ? 'projector.gguf' : undefined)
  const manifest = nativeProFiles(settings.model)
  if (settings.vision && !manifest.projector)
    throw new Error('Image input is unavailable for this Pro preset')
  const dir = path.join(root(), 'native-models', settings.model)
  const preparedFile = path.join(dir, 'prepared.json')
  const sizes = readJson<Record<string, number>>(preparedFile, {})
  for (const item of [
    ...manifest.files.map((file) => ({
      file,
      repo: manifest.repo,
      revision: manifest.revision,
      ...manifest.fileMetadata[file]
    })),
    ...(settings.vision && manifest.projectorSource ? [manifest.projectorSource] : [])
  ]) {
    signal.throwIfAborted()
    const { file, size: expected, sha256 } = item
    if (!expected || expected < 4 || !/^[a-f0-9]{64}$/.test(sha256))
      throw new Error(`Missing Pro GGUF metadata: ${file}`)
    const target = path.join(dir, file)
    if (sizes[file] === expected && fs.existsSync(target) && fs.statSync(target).size === expected)
      continue
    fs.mkdirSync(path.dirname(target), { recursive: true })
    setProgress('model')
    progress!.detail = file
    progress!.downloadedBytes = 0
    progress!.totalBytes = expected
    const response = await fetch(
      `https://huggingface.co/${item.repo}/resolve/${item.revision}/${file}`,
      { signal }
    )
    if (!response.ok || !response.body)
      throw new Error(`Pro model download failed: ${response.status}`)
    const current = progress!
    const hash = createHash('sha256')
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        current.downloadedBytes! += chunk.length
        if (current.downloadedBytes! > expected)
          return callback(new Error(`Oversized Pro download: ${file}`))
        hash.update(chunk)
        callback(null, chunk)
      }
    })
    const partial = `${target}.part`
    try {
      await pipeline(
        Readable.fromWeb(response.body as never),
        meter,
        fs.createWriteStream(partial),
        { signal }
      )
      if (fs.statSync(partial).size !== expected)
        throw new Error(`Incomplete Pro download: ${file}`)
      if (hash.digest('hex') !== sha256)
        throw new Error(`Pro model checksum verification failed: ${file}`)
      const fd = fs.openSync(partial, 'r')
      const magic = Buffer.alloc(4)
      try {
        fs.readSync(fd, magic, 0, 4, 0)
      } finally {
        fs.closeSync(fd)
      }
      if (magic.toString() !== 'GGUF') throw new Error(`Invalid Pro GGUF: ${file}`)
      fs.renameSync(partial, target)
      sizes[file] = expected
      writeJson(preparedFile, sizes)
    } finally {
      fs.rmSync(partial, { force: true })
    }
  }
}

export const getStrataSettings = (): StrataSettings =>
  validateStrataSettings(readJson(path.join(root(), 'settings.json'), DEFAULT_STRATA_SETTINGS))

function append(data: Buffer | string): void {
  output = (output + data.toString()).slice(-24000)
  for (const listener of logListeners) listener(data.toString())
  if ((operation || startupAbort) && progress) {
    const lines = output.split(/[\r\n]/).filter((line) => line.trim())
    const marker = [...lines].reverse().find((line) => line.startsWith('AURAPRO_STAGE:'))
    if (marker) progress.stage = marker.slice('AURAPRO_STAGE:'.length).trim()
    const detail = [...lines].reverse().find((line) => !line.startsWith('AURAPRO_STAGE:'))
    if (detail) progress.detail = detail.slice(-500)
  }
}

function setProgress(stage: string): void {
  progress = { stage, detail: '' }
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

function controlEnv(dir: string, offline = false): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    PYTHONUTF8: '1',
    PYTHONNOUSERSITE: '1',
    PYTHONHOME: undefined,
    PYTHONPATH: undefined,
    VIRTUAL_ENV: undefined,
    STRATA_COMPONENTS_DIR: path.join(root(), 'components'),
    STRATA_INSTALL_DIR: dir,
    STRATA_DATA_DIR: path.join(root(), 'data'),
    STRATA_RUNTIME_DIR: path.join(root(), 'runtime'),
    STRATA_PROFILE_DIR: path.join(root(), 'profiles'),
    STRATA_SETTINGS_FILE: path.join(root(), 'control-settings.json'),
    STRATA_CONTROL_INSTALL: '',
    STRATA_NO_HANDOVER: '1',
    STRATA_NO_ACQUIRE: offline ? '1' : '',
    STRATA_REQUIRE_SIGNED_COMPONENTS: '1'
  }
}

function run(exe: string, args: string[], cwd: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      cwd,
      windowsHide: true,
      detached: process.platform !== 'win32',
      env: controlEnv(cwd),
      stdio: ['ignore', 'pipe', 'pipe']
    })
    worker = child
    const abort = () => {
      void terminate(child).catch((err) => append(String(err)))
    }
    signal.addEventListener('abort', abort, { once: true })
    let captured = ''
    child.stdout?.on('data', (data: Buffer) => {
      captured = (captured + data.toString()).slice(-128000)
      append(data)
    })
    child.stderr?.on('data', append)
    child.once('error', reject)
    child.once('close', (code) => {
      signal.removeEventListener('abort', abort)
      if (worker === child) worker = null
      if (signal.aborted) reject(new Error('Pro operation cancelled'))
      else if (code !== 0)
        reject(new Error(`Pro command exited with code ${code}. ${output.slice(-1600)}`))
      else resolve(captured)
    })
    if (signal.aborted) abort()
  })
}

function adapterResult<T>(text: string): T {
  const line = text.split(/[\r\n]/).findLast((item) => item.startsWith('AURAPRO_RESULT:'))
  if (!line) throw new Error('Pro operation did not report a verified result')
  return JSON.parse(line.slice('AURAPRO_RESULT:'.length)) as T
}

type ControlRelease = {
  tag_name: string
  draft: boolean
  prerelease: boolean
  assets: { name: string; size: number; digest?: string; browser_download_url: string }[]
}

async function controlRelease(tag = 'latest', signal?: AbortSignal): Promise<ControlRelease> {
  const endpoint = tag === 'latest' ? 'latest' : `tags/${encodeURIComponent(tag)}`
  const response = await fetch(
    `https://api.github.com/repos/Niko1221/Strata/releases/${endpoint}`,
    {
      headers: { Accept: 'application/vnd.github+json' },
      signal: signal ?? AbortSignal.timeout(20000)
    }
  )
  if (!response.ok) throw new Error(`Strata release lookup failed: ${response.status}`)
  const release = (await response.json()) as ControlRelease
  if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+(?:\.\d+)?$/.test(release.tag_name))
    throw new Error('Unexpected Strata release tag')
  return release
}

async function installControl(
  dir: string,
  release: ControlRelease,
  signal: AbortSignal
): Promise<void> {
  const platform = process.platform === 'win32' ? 'windows-x86_64' : 'linux-x86_64'
  const extension = process.platform === 'win32' ? '.zip' : '.tar.gz'
  const suffix = `-${platform}${extension}`
  const asset = release.assets.find(
    (item) =>
      item.name.startsWith('strata-control-') &&
      item.name.endsWith(suffix) &&
      /^\d+(?:\.\d+)+$/.test(item.name.slice('strata-control-'.length, -suffix.length))
  )
  if (
    !asset ||
    !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? '') ||
    asset.size <= 0 ||
    asset.size > 512 * 1024 ** 2
  )
    throw new Error('The Strata release has no verified Control package for this platform')
  if (
    !asset.browser_download_url.startsWith(
      `https://github.com/Niko1221/Strata/releases/download/${release.tag_name}/`
    )
  )
    throw new Error('Unexpected Strata Control download source')
  setProgress('source')
  const response = await fetch(asset.browser_download_url, { signal })
  if (!response.ok || !response.body)
    throw new Error(`Strata Control download failed: ${response.status}`)
  fs.mkdirSync(dir, { recursive: true })
  const archive = path.join(dir, `control${extension}`)
  const hash = createHash('sha256')
  let bytes = 0
  const current = progress!
  current.totalBytes = asset.size
  await pipeline(
    Readable.fromWeb(response.body as never),
    new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length
        if (bytes > asset.size) return callback(new Error('Oversized Strata Control download'))
        hash.update(chunk)
        current.downloadedBytes = bytes
        callback(null, chunk)
      }
    }),
    fs.createWriteStream(archive),
    { signal }
  )
  if (bytes !== asset.size || `sha256:${hash.digest('hex')}` !== asset.digest)
    throw new Error('Strata Control checksum verification failed')
  setProgress('extracting')
  // Only extract the archive after verifying its official release digest.
  if (process.platform === 'win32') {
    await promisify(execFile)('tar', ['-xf', archive, '-C', dir], { windowsHide: true, signal })
  } else {
    await tar.x({ file: archive, cwd: dir })
  }
  fs.unlinkSync(archive)
  if (!fs.existsSync(path.join(dir, 'setup.py')) || !fs.existsSync(path.join(dir, 'strata.py')))
    throw new Error('Unexpected Strata Control archive layout')
}

export async function getStrataInfo() {
  const installed = installation()
  const settings = getStrataSettings()
  const dir = installed ? sourceDir(installed.source) : ''
  return {
    supported: supported(),
    runtime: native() ? 'llama.cpp' : 'Strata',
    platformLabel: native() ? 'macOS' : 'Windows/Linux x64',
    status,
    error,
    logs: output,
    progress,
    installed,
    upgradeRequired: !!installed && !native() && installed.managed !== 'control',
    recommendedVersion: STRATA_RELEASE,
    port: STRATA_PORT,
    settings,
    models: STRATA_MODELS.map((model) => ({
      ...model,
      ramInfo: strataHardwareRecommendation(model),
      experimental: false,
      removable:
        fs.existsSync(path.join(root(), 'native-models', model.id)) ||
        fs.existsSync(path.join(root(), 'data', 'models', modelTag(model.id))),
      installed: native()
        ? nativeModelReady(model.id, model.id === settings.model && settings.vision)
        : !!dir && fs.existsSync(path.join(dir, strataConfigName(model.id)))
    })),
    legacyModels: ALL_STRATA_MODELS.filter(
      (model) => !STRATA_MODELS.some((current) => current.id === model.id)
    )
      .filter((model) =>
        native()
          ? nativeModelReady(model.id)
          : !!dir && fs.existsSync(path.join(dir, strataConfigName(model.id)))
      )
      .map((model) => ({ ...model, installed: true }))
  }
}

async function exclusiveOperation(action: (signal: AbortSignal) => Promise<void>): Promise<void> {
  if (!supported()) throw new Error('Pro supports macOS and Windows/Linux x64')
  if (operation) throw new Error('Another Pro operation is already running')
  const controller = new AbortController()
  operation = controller
  error = ''
  output = ''
  setProgress('preparing')
  try {
    await stopStrata()
    controller.signal.throwIfAborted()
    status = 'installing'
    await action(controller.signal)
    controller.signal.throwIfAborted()
    status = 'stopped'
    setProgress('complete')
  } catch (err) {
    status = controller.signal.aborted ? 'stopped' : 'failed'
    error = controller.signal.aborted ? '' : String(err)
    setProgress(controller.signal.aborted ? 'cancelled' : 'failed')
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
      const body = (await response.json()) as {
        service?: string
        loaded?: boolean
        status?: string
      }
      if (!response.ok || !proHealthReady(body)) throw new Error('Pro health check failed')
      health = 'healthy'
      detail = ''
    }
  } catch (err) {
    detail = String(err)
    health = 'unresponsive'
  }
  return { ...info, health, detail }
}

export async function checkStrataUpdate(): Promise<{
  version: string
  source: string
  available: boolean
}> {
  if (native()) {
    const version = await latestLlamaCppVersion('auto')
    return { version, source: version, available: installation()?.version !== version }
  }
  const release = await controlRelease()
  const installed = installation()
  let available = installed?.productVersion !== release.tag_name
  if (!available && installed?.managed === 'control') {
    const dir = sourceDir(installed.source)
    const { stdout } = await promisify(execFile)(
      python(installed.source),
      [adapterPath, dir, 'check', getStrataSettings().backend, release.tag_name],
      { cwd: dir, env: controlEnv(dir), windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 }
    )
    available = adapterResult<{ available: boolean }>(stdout).available
  }
  return { version: release.tag_name, source: release.tag_name, available }
}

export async function installStrata(update = false, requested?: StrataSettings): Promise<void> {
  const settings = validateStrataSettings(requested ?? getStrataSettings())
  await exclusiveOperation(async (signal) => {
    if (native()) {
      nativeProArgs(settings, 'validation.gguf', settings.vision ? 'projector.gguf' : undefined)
      setProgress('runtime')
      const previous = installation()
      const version = update ? (await checkStrataUpdate()).version : previous?.version || 'latest'
      const exe = await setupIsolatedLlamaCpp(
        (detail) => {
          if (progress) progress.detail = detail
        },
        { version, variant: 'auto', cacheDir: path.join(root(), 'llama.cpp'), signal }
      )
      signal.throwIfAborted()
      writeJson(path.join(root(), 'installed.json'), {
        source: 'native',
        version: path.relative(path.join(root(), 'llama.cpp'), exe).split(path.sep)[0],
        backend: 'metal',
        exe
      })
      writeJson(path.join(root(), 'settings.json'), settings)
      return
    }
    const previous = installation()
    const release = await controlRelease(
      update ? 'latest' : previous?.productVersion || STRATA_RELEASE,
      signal
    )
    // Stage a whole private Control; keep the old environment and model files for recovery.
    const source = `control-${release.tag_name.slice(1)}-${randomUUID()}`
    const dir = sourceDir(source)
    let activated = false
    try {
      await installControl(dir, release, signal)
      signal.throwIfAborted()
      const bundle = readJson<{ version?: string }>(path.join(dir, 'BUNDLE.json'), {})
      if (!bundle.version || !fs.existsSync(python(source)))
        throw new Error('Strata Control has no valid bundled Python environment')
      setProgress('runtime')
      const result = await run(
        python(source),
        [adapterPath, dir, 'install', settings.backend, release.tag_name],
        dir,
        signal
      )
      const meta = adapterResult<{ version: string; backend: string; control: string }>(result)
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
        for (const model of ALL_STRATA_MODELS) {
          const file = strataConfigName(model.id)
          const config = readJson(path.join(oldDir, file), null)
          if (config) {
            const migrated = relocate(config) as Record<string, unknown>
            migrated.exe = 'component:strata-engine'
            delete migrated.lib_dirs
            writeJson(path.join(dir, file), migrated)
          }
        }
      }
      signal.throwIfAborted()
      writeJson(path.join(root(), 'installed.json'), {
        source,
        revision: release.tag_name === STRATA_RELEASE ? STRATA_SOURCE : release.tag_name,
        version: meta.version,
        backend: meta.backend,
        managed: 'control',
        controlVersion: meta.control,
        productVersion: release.tag_name
      })
      activated = true
      writeJson(path.join(root(), 'settings.json'), settings)
    } finally {
      if (!activated)
        await removeProPath(dir).catch((err) => append(`Pro staging cleanup: ${String(err)}\n`))
    }
  })
}

export async function prepareStrataModel(settings: StrataSettings): Promise<void> {
  const valid = validateStrataSettings(settings)
  await exclusiveOperation(async (signal) => {
    const installed = installation()
    if (!installed) throw new Error('Install Pro before downloading a model')
    if (
      !native() &&
      installed.managed !== 'control' &&
      STRATA_MODELS.some((model) => model.id === valid.model)
    )
      throw new Error('Update Pro in Desktop settings before preparing a new model')
    if (native()) {
      await prepareNativeModel(valid, signal)
      writeJson(path.join(root(), 'settings.json'), valid)
      return
    }
    const dir = sourceDir(installed.source)
    setProgress('model')
    await run(
      python(installed.source),
      [adapterPath, dir, 'model', ...strataSetupArgs(valid, path.join(root(), 'data'))],
      dir,
      signal
    )
    signal.throwIfAborted()
    if (!fs.existsSync(path.join(dir, strataConfigName(valid.model))))
      throw new Error('Pro model preparation did not finish')
    writeJson(path.join(root(), 'installed.json'), {
      ...installed,
      backend:
        readJson<{ backend?: string }>(path.join(dir, strataConfigName(valid.model)), {}).backend ||
        installed.backend
    })
    writeJson(path.join(root(), 'settings.json'), valid)
  })
}

export async function saveStrataSettings(settings: StrataSettings): Promise<void> {
  const valid = validateStrataSettings(settings)
  if (native()) nativeProArgs(valid, 'validation.gguf', valid.vision ? 'projector.gguf' : undefined)
  else strataSetupArgs(valid, root())
  if (operation) throw new Error('Wait for the current Pro operation to finish')
  const installed = installation()
  const old = getStrataSettings()
  if (!native() && installed && (old.backend !== valid.backend || old.vision !== valid.vision)) {
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
  if (native()) {
    if (
      !installed.exe ||
      !fs.existsSync(installed.exe) ||
      !nativeModelReady(settings.model, settings.vision)
    )
      throw new Error('Prepare the selected Pro model in Desktop settings first')
    const manifest = nativeProFiles(settings.model)
    const dir = path.join(root(), 'native-models', settings.model)
    return {
      exe: installed.exe,
      args: nativeProArgs(
        settings,
        path.join(dir, manifest.files[0]),
        manifest.projector ? path.join(dir, manifest.projector) : undefined
      )
    }
  }
  const dir = sourceDir(installed.source)
  const config = readJson<Record<string, unknown> | null>(
    path.join(dir, strataConfigName(settings.model)),
    null
  )
  if (
    !config ||
    typeof config.exe !== 'string' ||
    (!(installed.managed === 'control' && config.exe.startsWith('component:')) &&
      !fs.existsSync(config.exe)) ||
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

export async function uninstallStrata(): Promise<void> {
  await exclusiveOperation(async (signal) => {
    const base = path.resolve(root())
    if (fs.existsSync(base) && fs.lstatSync(base).isSymbolicLink())
      throw new Error('Refusing to uninstall Pro through a linked installation directory')
    signal.throwIfAborted()
    await removeProPath(base)
  })
  progress = null
}

function modelTag(modelId: string): string {
  const model = ALL_STRATA_MODELS.find((item) => item.id === modelId)
  if (!model) throw new Error('Unknown Pro model')
  return `${model.family === 'qwen' ? '' : `${model.family}-`}${model.quant}`
}

async function removeProPath(target: string): Promise<void> {
  const base = path.resolve(root())
  const resolved = path.resolve(target)
  const relative = path.relative(base, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('Invalid Pro deletion path')
  // Reject linked parents so cleanup cannot reach a directory outside Pro.
  let parent = path.dirname(resolved)
  while (parent.startsWith(base + path.sep) || parent === base) {
    if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink())
      throw new Error('Refusing to delete Pro files through a linked directory')
    if (parent === base) break
    parent = path.dirname(parent)
  }
  await fs.promises.rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 })
}

export async function deleteStrataModel(modelId: string): Promise<void> {
  const tag = modelTag(modelId)
  const config = strataConfigName(modelId)
  await exclusiveOperation(async (signal) => {
    const targets = [
      path.join(root(), 'native-models', modelId),
      path.join(root(), 'data', 'models', tag),
      path.join(root(), 'data', 'packs', tag.toLowerCase())
    ]
    const versions = path.join(root(), 'versions')
    if (fs.existsSync(versions)) {
      if (fs.lstatSync(versions).isSymbolicLink()) throw new Error('Invalid Pro versions directory')
      for (const entry of fs.readdirSync(versions, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        targets.push(path.join(versions, entry.name, config))
        targets.push(path.join(versions, entry.name, `${config}.tmp`))
        targets.push(path.join(versions, entry.name, 'aurapro-active.json'))
      }
    }
    for (const target of targets) {
      signal.throwIfAborted()
      await removeProPath(target)
    }
    const modelsDir = path.join(root(), 'data', 'models')
    const remaining = ALL_STRATA_MODELS.filter((model) =>
      fs.existsSync(path.join(modelsDir, modelTag(model.id)))
    )
    if (!remaining.length) await removeProPath(path.join(root(), 'data', 'mtp'))
    const projector = nativeProFiles(modelId).projector
    if (projector && !remaining.some((model) => nativeProFiles(model.id).projector === projector))
      await removeProPath(path.join(modelsDir, projector))
  })
  progress = null
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
  if (!native()) {
    setArg('--max-context', String(settings.context))
    if (!settings.model.startsWith('qwen36-')) setArg('--kv', settings.kv)
  }
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
  setProgress('starting')
  const controller = new AbortController()
  startupAbort = controller
  const child = spawn(
    native() ? (config.exe as string) : python(installed.source),
    native()
      ? args
      : [
          path.join(dir, 'serve', 'server.py'),
          '--engine',
          'strata',
          '--config',
          runtimeConfig,
          '--host',
          '127.0.0.1',
          '--port',
          String(STRATA_PORT),
          ...(installed.managed === 'control' ? ['--offline'] : [])
        ],
    {
      cwd: native() ? path.dirname(config.exe as string) : dir,
      windowsHide: true,
      detached: process.platform !== 'win32',
      env: controlEnv(dir, true),
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
    const startedAt = Date.now()
    let lastHeartbeat = startedAt
    const deadline = Date.now() + 300000
    while (Date.now() < deadline) {
      controller.signal.throwIfAborted()
      if (server !== child || status === 'failed') throw new Error(error)
      if (Date.now() - lastHeartbeat >= 15000) {
        const seconds = Math.floor((Date.now() - startedAt) / 1000)
        append(
          `[Pro] Waiting for the model to become ready (${seconds}s).${seconds >= 120 ? ' Model loading is taking longer than the usual two-minute target.' : ''}\n`
        )
        lastHeartbeat = Date.now()
      }
      try {
        const response = await fetch(`http://127.0.0.1:${STRATA_PORT}/health`, {
          signal: AbortSignal.timeout(1500)
        })
        if (response.ok) {
          const health = (await response.json()) as {
            service?: string
            loaded?: boolean
            status?: string
          }
          if (proHealthReady(health)) {
            status = 'started'
            setProgress('complete')
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
    setProgress(controller.signal.aborted ? 'cancelled' : 'failed')
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
    if (!supported()) throw new Error('Pro supports macOS and Windows/Linux x64')
    if (operation) throw new Error('Pro preparation is still running')
    const installed = installation()
    if (!installed) throw new Error('Install Pro in Desktop settings first')
    readPreparedConfig(installed, getStrataSettings())
    if (await portInUse(STRATA_PORT)) throw new Error('Pro port 18882 is occupied')
  },
  start: startRaw,
  stop: stopRaw
})
