import { randomUUID } from 'crypto'
import { mkdir, unlink, writeFile } from 'fs/promises'
import path from 'path'

const TRANSIENT_WRITE_ERROR_CODES = new Set(['EACCES', 'EBUSY', 'EPERM'])
const DEFAULT_RETRY_DELAYS_MS = [75, 150, 300, 600]

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

const errorCode = (error: unknown): string | null =>
  error instanceof Error ? ((error as NodeJS.ErrnoException).code ?? null) : null

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error ?? 'Unknown write error')

const isTransientWriteError = (error: unknown): boolean =>
  TRANSIENT_WRITE_ERROR_CODES.has(errorCode(error) ?? '')

const removeProbeFile = async (
  probeFile: string,
  retryDelaysMs: readonly number[]
): Promise<string | null> => {
  let lastError: unknown = null
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    try {
      await unlink(probeFile)
      return null
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return null
      lastError = error
      if (!isTransientWriteError(error) || attempt >= retryDelaysMs.length) break
      await wait(retryDelaysMs[attempt])
    }
  }
  return errorMessage(lastError)
}

const scheduleProbeCleanup = (probeFile: string): void => {
  const timer = setTimeout(() => {
    void unlink(probeFile).catch(() => undefined)
  }, 5000)
  timer.unref()
}

export interface InstallDirectoryWriteProbe {
  writable: boolean
  writeError: string | null
  writeErrorCode: string | null
  writeAttempts: number
  cleanupError: string | null
}

export const probeInstallDirectoryWritable = async (
  installPath: string,
  retryDelaysMs: readonly number[] = DEFAULT_RETRY_DELAYS_MS
): Promise<InstallDirectoryWriteProbe> => {
  let lastError: unknown = null
  let writeAttempts = 0

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    writeAttempts = attempt + 1
    let probeFile: string | null = null
    try {
      await mkdir(installPath, { recursive: true })
      probeFile = path.join(installPath, `.aurapro-install-check-${process.pid}-${randomUUID()}`)
      await writeFile(probeFile, 'ok', { encoding: 'utf8', flag: 'wx' })
    } catch (error) {
      lastError = error
      if (probeFile) {
        const cleanupError = await removeProbeFile(probeFile, [])
        if (cleanupError) scheduleProbeCleanup(probeFile)
      }
      if (!isTransientWriteError(error) || attempt >= retryDelaysMs.length) break
      await wait(retryDelaysMs[attempt])
      continue
    }

    const cleanupError = await removeProbeFile(probeFile, retryDelaysMs)
    if (cleanupError) scheduleProbeCleanup(probeFile)
    return {
      writable: true,
      writeError: null,
      writeErrorCode: null,
      writeAttempts,
      cleanupError
    }
  }

  return {
    writable: false,
    writeError: errorMessage(lastError),
    writeErrorCode: errorCode(lastError),
    writeAttempts,
    cleanupError: null
  }
}
