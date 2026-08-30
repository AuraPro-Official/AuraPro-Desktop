import * as fs from 'fs'
import * as path from 'path'
import { execFile } from 'child_process'

import log from 'electron-log'

import { getInstallDir, getPythonPath } from './index'
import { getHfCacheDir } from './huggingface'
import { selectHistoricalLlamaBuilds } from './llamacpp-release'

export type CacheCleanupKind = 'python-packages' | 'huggingface' | 'llamacpp'

const CLEANUP_DELAY_MS = 15_000
const STALE_DOWNLOAD_AGE_MS = 60 * 60 * 1000
const pendingKinds = new Set<CacheCleanupKind>()
const pendingReasons = new Set<string>()
let cleanupTimer: NodeJS.Timeout | null = null
let cleanupPromise: Promise<void> | null = null
let pendingLlamaVersion: string | null = null

const runPython = (args: string[], label: string, timeout = 10 * 60 * 1000): Promise<void> =>
  new Promise((resolve) => {
    const pythonPath = getPythonPath()
    if (!fs.existsSync(pythonPath)) {
      log.info(`[cache-cleanup] Skipping ${label}; bundled Python is not installed`)
      resolve()
      return
    }

    execFile(
      pythonPath,
      args,
      {
        encoding: 'utf-8',
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8'
        },
        windowsHide: true,
        timeout
      },
      (error, stdout, stderr) => {
        const output = `${stdout ?? ''}\n${stderr ?? ''}`.trim()
        if (output) log.info(`[cache-cleanup:${label}] ${output}`)
        if (error) log.warn(`[cache-cleanup] ${label} failed; continuing:`, error)
        resolve()
      }
    )
  })

const cleanupPythonPackageCaches = async (): Promise<void> => {
  await runPython(['-m', 'uv', 'cache', 'clean'], 'uv')
  await runPython(['-m', 'pip', 'cache', 'purge'], 'pip')
}

const cleanupDesktopDownloadTemps = async (): Promise<void> => {
  const cacheRoot = getHfCacheDir()
  const cutoff = Date.now() - STALE_DOWNLOAD_AGE_MS
  let removed = 0

  const visit = async (directory: string): Promise<void> => {
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(entryPath)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.tmp') || entry.name === 'manifest.json.tmp') {
        continue
      }

      try {
        const stat = await fs.promises.stat(entryPath)
        if (stat.mtimeMs > cutoff) continue
        await fs.promises.rm(entryPath, { force: true, maxRetries: 3, retryDelay: 250 })
        removed += 1
      } catch (error) {
        log.warn(`[cache-cleanup] Could not remove ${entryPath}; continuing:`, error)
      }
    }
  }

  await visit(cacheRoot)
  if (removed > 0) {
    log.info(`[cache-cleanup:huggingface] Removed ${removed} stale desktop download(s)`)
  }
}

const HUGGING_FACE_CLEANUP_SCRIPT = [
  'from pathlib import Path',
  'import os, shutil, stat, time',
  'from huggingface_hub import constants, scan_cache_dir',
  '',
  'def warn(message):',
  '    print(f"warning: {message}")',
  '',
  'def remove_tree(target):',
  '    target = Path(target)',
  '    if not target.exists():',
  '        return',
  '    def onerror(func, filename, _exc):',
  '        try:',
  '            os.chmod(filename, stat.S_IWRITE)',
  '            func(filename)',
  '        except Exception as exc:',
  '            warn(f"could not remove {filename}: {exc}")',
  '    try:',
  '        shutil.rmtree(target, onerror=onerror)',
  '        print(f"removed transfer cache: {target}")',
  '    except Exception as exc:',
  '        warn(f"could not remove transfer cache {target}: {exc}")',
  '',
  'try:',
  '    cache = scan_cache_dir()',
  '    stale_revisions = []',
  '    for repo in cache.repos:',
  '        revisions = sorted(repo.revisions, key=lambda item: item.last_modified, reverse=True)',
  '        keep = {revisions[0].commit_hash} if revisions else set()',
  '        keep.update(item.commit_hash for item in revisions if item.refs)',
  '        stale_revisions.extend(item.commit_hash for item in revisions if item.commit_hash not in keep)',
  '    if stale_revisions:',
  '        cache.delete_revisions(*stale_revisions).execute()',
  '        print(f"removed historical revisions: {len(stale_revisions)}")',
  'except Exception as exc:',
  '    warn(f"could not prune historical revisions: {exc}")',
  '',
  'remove_tree(constants.HF_XET_CACHE)',
  '',
  'cutoff = time.time() - 3600',
  'hub_root = Path(constants.HF_HUB_CACHE)',
  'if hub_root.exists():',
  '    for pattern in ("*.incomplete", "*.lock"):',
  '        for candidate in hub_root.rglob(pattern):',
  '            try:',
  '                if candidate.is_file() and candidate.stat().st_mtime <= cutoff:',
  '                    candidate.unlink(missing_ok=True)',
  '            except Exception as exc:',
  '                warn(f"could not remove {candidate}: {exc}")'
].join('\n')

const cleanupHuggingFaceCaches = async (): Promise<void> => {
  await cleanupDesktopDownloadTemps()
  await runPython(['-c', HUGGING_FACE_CLEANUP_SCRIPT], 'huggingface')
}

const cleanupHistoricalLlamaCppVersions = async (activeVersion: string): Promise<void> => {
  const cacheRoot = path.join(getInstallDir(), 'llama.cpp')
  let entries: fs.Dirent[]
  try {
    entries = await fs.promises.readdir(cacheRoot, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn('[cache-cleanup] Could not inspect llama.cpp versions; continuing:', error)
    }
    return
  }

  const historicalTags = selectHistoricalLlamaBuilds(
    entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
    activeVersion
  )

  for (const tag of historicalTags) {
    const versionDir = path.join(cacheRoot, tag)
    const relative = path.relative(cacheRoot, versionDir)
    if (relative !== tag || relative.startsWith('..') || path.isAbsolute(relative)) {
      log.warn(`[cache-cleanup] Refusing to remove invalid llama.cpp path: ${versionDir}`)
      continue
    }

    try {
      await fs.promises.rm(versionDir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 300
      })
      log.info(`[cache-cleanup:llamacpp] Removed historical runtime: ${tag}`)
    } catch (error) {
      log.warn(
        `[cache-cleanup] Could not remove llama.cpp runtime ${versionDir}; continuing:`,
        error
      )
    }
  }
}

const queueTimer = (delayMs = CLEANUP_DELAY_MS): void => {
  if (cleanupTimer) clearTimeout(cleanupTimer)
  cleanupTimer = setTimeout(() => {
    cleanupTimer = null
    void runPendingCleanup()
  }, delayMs)
  cleanupTimer.unref()
}

const runPendingCleanup = async (): Promise<void> => {
  if (cleanupPromise) return
  if (pendingKinds.size === 0) return

  const kinds = new Set(pendingKinds)
  const reasons = [...pendingReasons]
  const llamaVersion = pendingLlamaVersion
  pendingKinds.clear()
  pendingReasons.clear()
  if (kinds.has('llamacpp')) pendingLlamaVersion = null

  cleanupPromise = (async () => {
    log.info(
      `[cache-cleanup] Starting background cleanup: ${[...kinds].join(', ')}; reason=${reasons.join(', ')}`
    )
    if (kinds.has('python-packages')) await cleanupPythonPackageCaches()
    if (kinds.has('huggingface')) await cleanupHuggingFaceCaches()
    if (kinds.has('llamacpp') && llamaVersion) {
      await cleanupHistoricalLlamaCppVersions(llamaVersion)
    }
    log.info('[cache-cleanup] Background cleanup finished')
  })()
    .catch((error) => {
      log.warn('[cache-cleanup] Unexpected cleanup failure; continuing:', error)
    })
    .finally(() => {
      cleanupPromise = null
      if (pendingKinds.size > 0) queueTimer()
    })

  await cleanupPromise
}

export const scheduleCacheCleanup = (
  kinds: CacheCleanupKind[],
  reason: string,
  delayMs = CLEANUP_DELAY_MS
): void => {
  for (const kind of kinds) pendingKinds.add(kind)
  pendingReasons.add(reason)
  queueTimer(delayMs)
}

export const scheduleLlamaCppVersionCleanup = (
  activeVersion: string,
  reason = 'llamacpp-update'
): void => {
  pendingLlamaVersion = activeVersion
  scheduleCacheCleanup(['llamacpp'], reason, 5_000)
}
