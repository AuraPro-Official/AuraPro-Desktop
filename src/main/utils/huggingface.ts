/**
 * Reusable Hugging Face utility module.
 * Downloads files from HF repos, manages a local model cache,
 * and provides listing/deletion of cached models.
 *
 * Cache dir: <userData>/models/<repo-slug>/<filename>
 */

import * as fs from 'fs'
import * as path from 'path'
import log from 'electron-log'

import { getInstallDir } from './index'

// ─── Types ──────────────────────────────────────────────

export interface HfModel {
  repo: string
  filename: string
  filepath: string
  size: number // bytes
  downloadedAt: string // ISO date
  sourceRepo?: string
  sourceFilename?: string
  category?: 'llm' | 'vision-projector' | 'mtp-draft' | 'sherpa-asr' | 'sherpa-tts' | 'other'
}

export interface HfDownloadProgress {
  percent: number
  downloadedBytes: number
  totalBytes: number
  bytesPerSecond?: number
  etaSeconds?: number
}

// ─── Paths ──────────────────────────────────────────────

export const getHfCacheDir = (): string => {
  const dir = path.join(getInstallDir(), 'models')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const legacyDir = path.join(dir, 'huggingface')
  if (fs.existsSync(legacyDir)) {
    try {
      const entries = fs.readdirSync(legacyDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const source = path.join(legacyDir, entry.name)
        const target = path.join(dir, entry.name)
        if (!fs.existsSync(target)) {
          fs.renameSync(source, target)
          log.info(`[huggingface] Migrated ${entry.name} from legacy cache`)
        }
      }

      if (fs.readdirSync(legacyDir).length === 0) {
        fs.rmdirSync(legacyDir)
      }
    } catch (error) {
      log.warn('[huggingface] Failed to migrate legacy cache:', error)
    }
  }

  return dir
}

const repoSlug = (repo: string): string => repo.replace(/\//g, '--')

const getManifestPath = (): string => path.join(getHfCacheDir(), 'manifest.json')
const isVisionProjector = (filename: string): boolean => filename.toLowerCase().includes('mmproj')
const isMtpDraftModel = (filename: string): boolean => filename.toLowerCase().startsWith('mtp-')
const isGgufModel = (model: HfModel): boolean =>
  model.filename.toLowerCase().endsWith('.gguf') &&
  !isVisionProjector(model.filename) &&
  !isMtpDraftModel(model.filename)
const normalizeModelPath = (model: HfModel, installDir = getInstallDir()): string =>
  path.normalize(
    path.isAbsolute(model.filepath) ? model.filepath : path.join(installDir, model.filepath)
  )

// ─── Manifest ───────────────────────────────────────────

const readManifest = (): HfModel[] => {
  const p = getManifestPath()
  if (!fs.existsSync(p)) return []
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch {
    return []
  }
}

const writeManifest = (models: HfModel[]): void => {
  const p = getManifestPath()
  const tmp = p + '.tmp'
  try {
    fs.writeFileSync(tmp, JSON.stringify(models, null, 2))
    fs.renameSync(tmp, p)
  } catch (e) {
    log.error('[huggingface] Failed to write manifest:', e)
  }
}

// ─── Public API ─────────────────────────────────────────

interface ActiveDownload {
  controller: AbortController
  repo: string
  filename: string
  destPath: string
}

const activeDownloads = new Map<string, ActiveDownload>()
const activeDownloadPromises = new Map<string, Promise<string>>()

const downloadKey = (repo: string, filename: string): string => `${repo}/${filename}`
const activeDownloadKey = (repo: string, filename: string, destPath: string): string =>
  `${downloadKey(repo, filename)}::${path.normalize(destPath).toLowerCase()}`
const parseContentRangeTotal = (contentRange: string | null): number => {
  if (!contentRange) return 0
  const match = contentRange.match(/\/(\d+)$/)
  return match ? Number(match[1]) || 0 : 0
}

const parseContentLength = (value: string | null): number => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

const fetchRemoteFileSize = async (
  downloadUrl: string,
  headers: Record<string, string>,
  signal: AbortSignal
): Promise<number> => {
  const baseHeaders = { ...headers }
  delete baseHeaders.Range

  try {
    const head = await fetch(downloadUrl, {
      method: 'HEAD',
      headers: baseHeaders,
      redirect: 'follow',
      signal
    })
    if (head.ok) {
      const size = parseContentLength(head.headers.get('content-length'))
      if (size > 0) return size
    }
  } catch (error) {
    log.warn('[huggingface] HEAD size probe failed; falling back to range probe:', error)
  }

  const rangeResponse = await fetch(downloadUrl, {
    headers: { ...baseHeaders, Range: 'bytes=0-0' },
    redirect: 'follow',
    signal
  })
  try {
    if (!rangeResponse.ok) return 0

    const rangedTotal = parseContentRangeTotal(rangeResponse.headers.get('content-range'))
    if (rangedTotal > 0) return rangedTotal

    const contentLength = parseContentLength(rangeResponse.headers.get('content-length'))
    return rangeResponse.status === 200 ? contentLength : 0
  } finally {
    try {
      await rangeResponse.body?.cancel()
    } catch {}
  }
}

/**
 * Cancel a specific download in progress.
 * If no repo/filename given, cancels ALL active downloads.
 */
export const cancelDownload = (repo?: string, filename?: string): void => {
  if (repo && filename) {
    for (const [key, active] of activeDownloads.entries()) {
      if (active.repo === repo && active.filename === filename) {
        active.controller.abort()
        activeDownloads.delete(key)
        activeDownloadPromises.delete(key)
      }
    }
  } else {
    // Cancel all
    for (const active of activeDownloads.values()) {
      active.controller.abort()
    }
    activeDownloads.clear()
    activeDownloadPromises.clear()
  }
}

/**
 * List all downloaded models.
 * Combines manifest data with a real directory scan to ensure nothing is missed.
 */
export const listModels = (): HfModel[] => {
  const manifest = readManifest()
  const installDir = getInstallDir()
  const cacheDir = getHfCacheDir()

  // 1. Start with manifest entries that actually exist and are LLM GGUF files.
  const existingInManifest = manifest.filter((m) => {
    return isGgufModel(m) && fs.existsSync(normalizeModelPath(m, installDir))
  })

  // 2. Scan the directory for any .gguf files not in manifest
  // This handles models downloaded via other means or manifest corruption.
  const foundModels: HfModel[] = [...existingInManifest]
  const manifestFiles = new Set(existingInManifest.map((m) => normalizeModelPath(m, installDir)))

  try {
    if (fs.existsSync(cacheDir)) {
      const scanDir = (dir: string, currentRepo: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            const nextRepo = currentRepo ? `${currentRepo}/${entry.name}` : entry.name
            scanDir(fullPath, nextRepo)
          } else if (
            entry.name.endsWith('.gguf') &&
            !isVisionProjector(entry.name) &&
            !isMtpDraftModel(entry.name)
          ) {
            const normalizedPath = path.normalize(fullPath)
            if (!manifestFiles.has(normalizedPath)) {
              // Not in manifest, add it
              const repoName = currentRepo.replace(/--/g, '/') || 'Local'
              foundModels.push({
                repo: repoName,
                filename: entry.name,
                filepath: path.relative(installDir, fullPath),
                size: fs.statSync(fullPath).size,
                downloadedAt: new Date(fs.statSync(fullPath).mtime).toISOString(),
                category: 'llm'
              })
              manifestFiles.add(normalizedPath)
            }
          }
        }
      }
      scanDir(cacheDir, '')
    }
  } catch (e) {
    log.error('[huggingface] Error scanning models directory:', e)
  }

  const nonLlmEntries = manifest.filter((m) => !isGgufModel(m))
  const previousLlmEntries = manifest.filter(isGgufModel)
  if (foundModels.length !== previousLlmEntries.length) {
    writeManifest([...nonLlmEntries, ...foundModels])
  }

  return foundModels
}

export const listSherpaModels = (kind?: 'asr' | 'tts'): HfModel[] => {
  const installDir = getInstallDir()
  return readManifest()
    .filter((model) => {
      const category = model.category ?? 'other'
      const filepath = normalizeModelPath(model, installDir)
      const name = `${model.repo}/${model.filename}`.toLowerCase()
      if (!fs.existsSync(filepath)) return false
      if (kind === 'asr')
        return (
          category === 'sherpa-asr' ||
          filepath.includes(`${path.sep}sherpa${path.sep}asr${path.sep}`) ||
          name.includes('sherpa-asr')
        )
      if (kind === 'tts')
        return (
          category === 'sherpa-tts' ||
          filepath.includes(`${path.sep}sherpa${path.sep}tts${path.sep}`) ||
          name.includes('sherpa-tts')
        )
      return (
        category.startsWith('sherpa-') ||
        filepath.includes(`${path.sep}sherpa${path.sep}`) ||
        name.includes('sherpa-')
      )
    })
    .map((model) => ({ ...model, filepath: normalizeModelPath(model, installDir) }))
}

/**
 * Get the cache directory path (so runtimes can reference it).
 */
export const getModelsDir = (): string => {
  const dir = getHfCacheDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * Download a file from a Hugging Face repository.
 *
 * @param repo     - HF repo, e.g. "ggml-org/gemma-3-1b-it-GGUF"
 * @param filename - File to download, e.g. "gemma-3-1b-it-Q4_K_M.gguf"
 * @param onProgress - Progress callback
 * @param token    - Optional HF access token for private repos
 * @returns Absolute path to the downloaded file
 */
export const downloadModel = async (
  repo: string,
  filename: string,
  onProgress?: (progress: HfDownloadProgress) => void,
  token?: string,
  expectedSize?: number,
  saveAs?: string,
  saveRepoAs?: string,
  subDir?: string
): Promise<string> => {
  const storageRepo = saveRepoAs || repo
  const slug = repoSlug(storageRepo)
  const safeSubDir = subDir
    ? subDir
        .split(/[\\/]+/)
        .filter(Boolean)
        .join(path.sep)
    : ''
  const baseCacheDir = safeSubDir ? path.join(getHfCacheDir(), safeSubDir) : getHfCacheDir()

  // If saveRepoAs is provided, we use the cache dir directly to avoid deep nesting
  // unless the user specifically wants a subfolder.
  const repoDir = saveRepoAs ? baseCacheDir : path.join(baseCacheDir, slug)

  if (!fs.existsSync(repoDir)) {
    fs.mkdirSync(repoDir, { recursive: true })
  }

  const destPath = path.join(repoDir, saveAs || filename)
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  const activeKey = activeDownloadKey(repo, filename, destPath)

  // Already downloaded?
  if (fs.existsSync(destPath)) {
    const stat = fs.statSync(destPath)
    if (stat.size === 0) {
      log.warn(`[huggingface] Found invalid cached file, deleting: ${destPath}`)
      try {
        fs.unlinkSync(destPath)
      } catch {}
    } else {
      log.info(`[huggingface] Found cached file; verifying remote size before reuse: ${destPath}`)
    }
  }

  const existingDownload = activeDownloadPromises.get(activeKey)
  if (existingDownload) {
    log.info(`[huggingface] Reusing active download: ${destPath}`)
    return existingDownload
  }

  const downloadPromise = downloadModelInner(
    repo,
    filename,
    destPath,
    storageRepo,
    safeSubDir,
    activeKey,
    onProgress,
    token,
    expectedSize,
    saveAs
  )
  activeDownloadPromises.set(activeKey, downloadPromise)
  try {
    return await downloadPromise
  } finally {
    activeDownloadPromises.delete(activeKey)
  }
}

const downloadModelInner = async (
  repo: string,
  filename: string,
  destPath: string,
  storageRepo: string,
  safeSubDir: string,
  activeKey: string,
  onProgress?: (progress: HfDownloadProgress) => void,
  token?: string,
  expectedSize?: number,
  saveAs?: string
): Promise<string> => {
  const recordDownloadedModel = (): string => {
    const manifest = readManifest()
    const storageRepoName = storageRepo.endsWith('.gguf') ? storageRepo.slice(0, -5) : storageRepo
    const existing = manifest.findIndex(
      (m) => m.repo === storageRepoName && m.filename === (saveAs || filename)
    )
    const relativePath = path.relative(getInstallDir(), destPath)
    const entry: HfModel = {
      repo: storageRepoName,
      filename: saveAs || filename,
      filepath: relativePath,
      size: fs.statSync(destPath).size,
      downloadedAt: new Date().toISOString(),
      sourceRepo: repo,
      sourceFilename: filename,
      category: safeSubDir.startsWith(`sherpa${path.sep}asr`)
        ? 'sherpa-asr'
        : safeSubDir.startsWith(`sherpa${path.sep}tts`)
          ? 'sherpa-tts'
          : (saveAs || filename).toLowerCase().endsWith('.gguf')
            ? isVisionProjector(saveAs || filename)
              ? 'vision-projector'
              : isMtpDraftModel(saveAs || filename)
                ? 'mtp-draft'
                : 'llm'
            : 'other'
    }

    if (existing >= 0) {
      manifest[existing] = entry
    } else {
      manifest.push(entry)
    }
    writeManifest(manifest)
    log.info(`[huggingface] Downloaded: ${destPath} (${entry.size} bytes)`)
    return destPath
  }

  const tmpPath = destPath + '.tmp'
  let resumeBytes = 0
  if (fs.existsSync(tmpPath)) {
    resumeBytes = fs.statSync(tmpPath).size
  }

  // Build download URL
  const encodedFilename = filename
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
  const downloadUrl = `https://huggingface.co/${repo}/resolve/main/${encodedFilename}`

  log.info(`[huggingface] Downloading ${repo}/${filename}`)
  log.info(`[huggingface] URL: ${downloadUrl}`)

  // Download with progress
  const headers: Record<string, string> = {}
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const abortController = new AbortController()
  activeDownloads.set(activeKey, { controller: abortController, repo, filename, destPath })
  const { signal } = abortController

  let remoteSize = 0
  try {
    remoteSize = await fetchRemoteFileSize(downloadUrl, headers, signal)
    if (remoteSize > 0) {
      log.info(`[huggingface] Remote size for ${repo}/${filename}: ${remoteSize} bytes`)
    } else {
      log.warn(
        `[huggingface] Could not determine remote size for ${repo}/${filename}; falling back to response headers`
      )
    }
  } catch (error) {
    if (signal.aborted) {
      activeDownloads.delete(activeKey)
      throw error
    }
    log.warn(
      `[huggingface] Remote size check failed for ${repo}/${filename}; falling back to response headers`,
      error
    )
  }

  if (fs.existsSync(destPath)) {
    const stat = fs.statSync(destPath)
    if (remoteSize > 0) {
      if (stat.size === remoteSize) {
        activeDownloads.delete(activeKey)
        log.info(`[huggingface] Verified cached file: ${destPath}`)
        return recordDownloadedModel()
      }

      log.warn(
        `[huggingface] Cached file size mismatch for ${repo}/${filename}: local=${stat.size}, remote=${remoteSize}; deleting cached file`
      )
      try {
        fs.unlinkSync(destPath)
      } catch {}
    } else if (stat.size > 0 && (!expectedSize || stat.size === expectedSize)) {
      activeDownloads.delete(activeKey)
      log.info(`[huggingface] Reusing cached file without remote size: ${destPath}`)
      return recordDownloadedModel()
    }
  }

  if (remoteSize > 0 && resumeBytes >= remoteSize) {
    if (resumeBytes === remoteSize) {
      fs.renameSync(tmpPath, destPath)
      activeDownloads.delete(activeKey)
      log.info(`[huggingface] Resumed file was already complete: ${destPath}`)
      return recordDownloadedModel()
    }
    log.warn(
      `[huggingface] Partial file is larger than remote file for ${repo}/${filename}; restarting download`
    )
    try {
      fs.unlinkSync(tmpPath)
    } catch {}
    resumeBytes = 0
  }

  if (resumeBytes > 0) {
    headers.Range = `bytes=${resumeBytes}-`
    log.info(`[huggingface] Resuming ${repo}/${filename} from byte ${resumeBytes}`)
  }

  // Use fetch for streaming download with progress
  let response
  try {
    response = await fetch(downloadUrl, {
      headers,
      redirect: 'follow',
      signal
    })
  } catch (error) {
    activeDownloads.delete(activeKey)
    throw error
  }

  if (response.status === 416 && resumeBytes > 0) {
    const totalFromRange = parseContentRangeTotal(response.headers.get('content-range'))
    if (totalFromRange > 0 && resumeBytes >= totalFromRange) {
      fs.renameSync(tmpPath, destPath)
      activeDownloads.delete(activeKey)
      log.info(`[huggingface] Resumed file was already complete: ${destPath}`)
      return recordDownloadedModel()
    } else {
      log.warn(
        `[huggingface] Partial download is not resumable for ${repo}/${filename}; restarting download`
      )
      try {
        fs.unlinkSync(tmpPath)
      } catch {}
      resumeBytes = 0
      const restartHeaders = { ...headers }
      delete restartHeaders.Range
      try {
        response = await fetch(downloadUrl, {
          headers: restartHeaders,
          redirect: 'follow',
          signal
        })
      } catch (error) {
        activeDownloads.delete(activeKey)
        throw error
      }
    }
  }

  if (!response.ok) {
    activeDownloads.delete(activeKey)
    throw new Error(
      `Failed to download ${repo}/${filename}: ${response.status} ${response.statusText}`
    )
  }

  if (resumeBytes > 0 && response.status !== 206) {
    log.warn(
      `[huggingface] Server ignored Range request for ${repo}/${filename}; restarting download`
    )
    try {
      fs.unlinkSync(tmpPath)
    } catch {}
    resumeBytes = 0
  }

  const contentLength = parseContentLength(response.headers.get('content-length'))
  const totalFromRange = parseContentRangeTotal(response.headers.get('content-range'))
  const totalBytes =
    remoteSize ||
    totalFromRange ||
    (response.status === 206 ? resumeBytes + contentLength : contentLength) ||
    expectedSize ||
    0
  const reader = response.body?.getReader()
  if (!reader) {
    activeDownloads.delete(activeKey)
    throw new Error('Response body is not readable')
  }

  const writeStream = fs.createWriteStream(tmpPath, { flags: resumeBytes > 0 ? 'a' : 'w' })
  let downloadedBytes = resumeBytes
  const startedAt = Date.now()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      writeStream.write(Buffer.from(value))
      downloadedBytes += value.byteLength

      if (onProgress && totalBytes > 0) {
        const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.1)
        const bytesPerSecond = Math.max((downloadedBytes - resumeBytes) / elapsedSeconds, 0)
        const remainingBytes = Math.max(totalBytes - downloadedBytes, 0)
        onProgress({
          percent: (downloadedBytes / totalBytes) * 100,
          downloadedBytes,
          totalBytes,
          bytesPerSecond,
          etaSeconds: bytesPerSecond > 0 ? remainingBytes / bytesPerSecond : undefined
        })
      }
    }
  } catch (err) {
    writeStream.end()
    activeDownloads.delete(activeKey)
    log.error(
      `[huggingface] Download failed; partial file kept for retry: ${repo}/${filename}`,
      err
    )
    throw err
  } finally {
    writeStream.end()
    await new Promise<void>((resolve) => writeStream.on('finish', () => resolve()))
  }

  if (remoteSize > 0 && downloadedBytes !== remoteSize) {
    activeDownloads.delete(activeKey)
    log.error(
      `[huggingface] Download size mismatch for ${repo}/${filename}: downloaded=${downloadedBytes}, remote=${remoteSize}`
    )
    throw new Error(
      `Downloaded file is incomplete for ${repo}/${filename}: expected ${remoteSize} bytes, got ${downloadedBytes} bytes`
    )
  }

  // Rename tmp to final
  fs.renameSync(tmpPath, destPath)
  activeDownloads.delete(activeKey)

  if (remoteSize > 0) {
    const finalSize = fs.statSync(destPath).size
    if (finalSize !== remoteSize) {
      try {
        fs.unlinkSync(destPath)
      } catch {}
      log.error(
        `[huggingface] Final file size mismatch for ${repo}/${filename}: final=${finalSize}, remote=${remoteSize}`
      )
      throw new Error(
        `Downloaded file failed verification for ${repo}/${filename}: expected ${remoteSize} bytes, got ${finalSize} bytes`
      )
    }
  }

  return recordDownloadedModel()
}

/**
 * Delete a downloaded model.
 */
export const deleteModel = (repo: string, filename: string): boolean => {
  const manifest = readManifest()
  const model = manifest.find((m) => m.repo === repo && m.filename === filename)
  if (!model) return false

  const installDir = getInstallDir()
  const filepath = path.isAbsolute(model.filepath)
    ? model.filepath
    : path.join(installDir, model.filepath)

  try {
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath)
    }
  } catch (e) {
    log.error(`[huggingface] Failed to delete ${filepath}:`, e)
    return false
  }

  // Remove from manifest
  const updated = manifest.filter((m) => !(m.repo === repo && m.filename === filename))
  writeManifest(updated)

  // Clean up empty repo dir if it was in a subfolder
  const repoDir = path.dirname(filepath)
  try {
    const remaining = fs.readdirSync(repoDir)
    if (remaining.length === 0 && repoDir !== getHfCacheDir()) {
      fs.rmdirSync(repoDir)
    }
  } catch {}

  log.info(`[huggingface] Deleted: ${repo}/${filename}`)
  return true
}

/**
 * Get info about a specific model.
 */
export const getModelInfo = (repo: string, filename: string): HfModel | null => {
  const manifest = readManifest()
  const model = manifest.find((m) => m.repo === repo && m.filename === filename) ?? null
  if (model) {
    const installDir = getInstallDir()
    return {
      ...model,
      filepath: path.isAbsolute(model.filepath)
        ? model.filepath
        : path.join(installDir, model.filepath)
    }
  }
  return null
}

// ─── HF API Integration ────────────────────────────────

export interface HfRepoResult {
  id: string // e.g. "ggml-org/gemma-3-1b-it-GGUF"
  author: string
  modelId: string
  downloads: number
  likes: number
  tags: string[]
  lastModified: string
}

export interface HfFileInfo {
  filename: string
  size: number // bytes
  lfs?: { size: number }
}

interface HfRepoApiItem {
  id?: string
  author?: string
  modelId?: string
  downloads?: number
  likes?: number
  tags?: string[]
  lastModified?: string
}

interface HfRepoFileApiItem {
  rfilename?: string
  size?: number
  lfs?: { size?: number }
}

/**
 * Search HF for GGUF model repos.
 */
export const searchModels = async (query: string, token?: string): Promise<HfRepoResult[]> => {
  const params = new URLSearchParams({
    search: query,
    filter: 'gguf',
    sort: 'downloads',
    direction: '-1',
    limit: '20'
  })

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const response = await fetch(`https://huggingface.co/api/models?${params}`, { headers })
  if (!response.ok) {
    throw new Error(`HF search failed: ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as HfRepoApiItem[]
  return data
    .filter((item) => Boolean(item.id || item.modelId))
    .map((item) => {
      const id = item.id ?? item.modelId ?? ''
      return {
        id,
        author: item.author ?? id.split('/')[0] ?? '',
        modelId: item.modelId ?? id,
        downloads: item.downloads ?? 0,
        likes: item.likes ?? 0,
        tags: item.tags ?? [],
        lastModified: item.lastModified ?? ''
      }
    })
}

export const getRepoFiles = async (repo: string, token?: string): Promise<HfFileInfo[]> => {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const response = await fetch(`https://huggingface.co/api/models/${repo}`, { headers })
  if (!response.ok) {
    throw new Error(`Failed to fetch repo info: ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as { siblings?: HfRepoFileApiItem[] }
  const siblings = data.siblings ?? []

  return siblings
    .filter((file): file is HfRepoFileApiItem & { rfilename: string } =>
      Boolean(file.rfilename && !file.rfilename.endsWith('/'))
    )
    .map((file) => ({
      filename: file.rfilename,
      size: file.lfs?.size ?? file.size ?? 0
    }))
    .sort((a: HfFileInfo, b: HfFileInfo) => a.size - b.size)
}

/**
 * 使用 fetch 下载任意 URL 文件（支持进度）
 */
export const downloadFromUrl = async (
  url: string,
  savePath: string,
  onProgress?: (progress: { percent: number; loaded: number; total: number }) => void
): Promise<string> => {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`)
  }

  const total = parseInt(response.headers.get('content-length') || '0', 10)
  let loaded = 0

  const reader = response.body?.getReader()
  if (!reader) throw new Error('Failed to get response body')

  const fileStream = fs.createWriteStream(savePath)

  try {
    await new Promise<void>((resolve, reject) => {
      fileStream.on('error', reject)
      fileStream.on('finish', resolve) // ← 等文件真正写完再继续

      const pump = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) {
              fileStream.end() // ← 通知写完，触发finish事件
              break
            }

            loaded += value.length

            // 背压处理：如果缓冲区满了，等drain再继续写
            const canContinue = fileStream.write(value)
            if (!canContinue) {
              await new Promise<void>((r) => fileStream.once('drain', r))
            }

            if (total > 0 && onProgress) {
              const percent = Math.round((loaded / total) * 100)
              onProgress({ percent, loaded, total })
            }
          }
        } catch (err) {
          fileStream.destroy()
          reject(err)
        }
      }

      pump()
    })

    // 验证文件大小
    const fileSize = fs.statSync(savePath).size
    log.info(`Downloaded: ${(fileSize / 1024 / 1024).toFixed(2)} MB`)
    if (total > 0 && fileSize < total * 0.99) {
      fs.unlinkSync(savePath)
      throw new Error(`文件不完整: ${fileSize} bytes，期望 ${total} bytes`)
    }

    return savePath
  } catch (err) {
    if (fs.existsSync(savePath)) fs.unlinkSync(savePath) // 清理残留
    log.error(`Failed to download from URL: ${url}`, err)
    throw err
  }
}
