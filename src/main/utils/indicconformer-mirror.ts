import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, rename, rm } from 'node:fs/promises'
import path from 'node:path'

const BASE_URL = 'https://aurapro.xmray.de/speech-models/indicconformer/'
const MAX_MANIFEST_BYTES = 256 * 1024
const MAX_MODEL_BYTES = 8 * 1024 ** 3
const ASSET_PATH = /^assets\/[a-z0-9_][a-z0-9_.-]{0,198}[a-z0-9_-]$/i
const WINDOWS_DEVICE = /^assets\/(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i

export interface IndicMirrorFile {
  path: string
  size: number
  sha256: string
}

export function parseIndicMirrorManifest(
  value: unknown,
  required: readonly string[]
): { revision: string; files: IndicMirrorFile[] } {
  const invalid = () => new Error('Invalid IndicConformer mirror manifest')
  if (!value || typeof value !== 'object') throw invalid()
  const { schemaVersion, revision, files } = value as Record<string, unknown>
  if (
    schemaVersion !== 1 ||
    typeof revision !== 'string' ||
    !/^[a-f0-9]{40}$/.test(revision) ||
    !Array.isArray(files) ||
    files.length <= required.length ||
    files.length > 1024
  )
    throw invalid()

  const seen = new Set<string>()
  const requiredLeft = new Set(required)
  let size = 0
  for (const file of files) {
    if (
      !file ||
      typeof file.path !== 'string' ||
      !ASSET_PATH.test(file.path) ||
      WINDOWS_DEVICE.test(file.path) ||
      seen.has(file.path.toLowerCase()) ||
      (!requiredLeft.has(file.path) && /\.(onnx|json|ts|tmp|unverified)$/i.test(file.path)) ||
      !Number.isSafeInteger(file.size) ||
      file.size <= 0 ||
      typeof file.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    )
      throw invalid()
    requiredLeft.delete(file.path)
    seen.add(file.path.toLowerCase())
    size += file.size
  }
  if (requiredLeft.size > 0 || size > MAX_MODEL_BYTES) throw invalid()
  return { revision, files }
}

export async function fetchIndicMirrorManifest(
  required: readonly string[],
  request: typeof fetch = fetch
): Promise<ReturnType<typeof parseIndicMirrorManifest>> {
  const response = await request(new URL('manifest.json', BASE_URL), {
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(8000)
  })
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(`IndicConformer mirror unavailable (HTTP ${response.status})`)
  }

  const decoder = new TextDecoder()
  const reader = response.body.getReader()
  let total = 0
  let json = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_MANIFEST_BYTES) throw new Error('IndicConformer mirror manifest is too large')
      json += decoder.decode(value, { stream: true })
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  return parseIndicMirrorManifest(JSON.parse(json + decoder.decode()), required)
}

async function matches(file: IndicMirrorFile, filepath: string): Promise<boolean> {
  const info = await lstat(filepath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
    return null
  })
  if (!info?.isFile() || info.size !== file.size) return false
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filepath)) hash.update(chunk)
  return hash.digest('hex') === file.sha256
}

export async function downloadIndicMirrorFile(
  directory: string,
  revision: string,
  file: IndicMirrorFile,
  download: (url: string, stagingFile: string) => Promise<unknown>
): Promise<string> {
  const relative = `versions/${revision}/${file.path}`
  const filepath = path.join(directory, revision, file.path)
  if (await matches(file, filepath)) return filepath
  // Keep resumable transfers separate from files the recognizer can load.
  const stagingFile = `${filepath}.${file.sha256.slice(0, 16)}.unverified`
  await download(new URL(relative, BASE_URL).href, stagingFile)
  if (!(await matches(file, stagingFile))) {
    await rm(stagingFile, { force: true })
    throw new Error(`IndicConformer mirror integrity check failed: ${file.path}`)
  }
  await rename(stagingFile, filepath)
  return filepath
}
