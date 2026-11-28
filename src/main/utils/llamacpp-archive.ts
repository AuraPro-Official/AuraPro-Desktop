import { execFile } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const lockedMarker = 'AURAPRO_ARCHIVE_SHARING_VIOLATION'

const expandArchive = `
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
  Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Archive/Microsoft.PowerShell.Archive.psd1') -ErrorAction Stop
  Expand-Archive -LiteralPath $env:AURAPRO_ARCHIVE_SOURCE -DestinationPath ([WildcardPattern]::Escape($env:AURAPRO_ARCHIVE_TARGET)) -Force -ErrorAction Stop
} catch {
  for ($cause = $_.Exception; $null -ne $cause; $cause = $cause.InnerException) {
    if ($cause -is [System.IO.IOException] -and (($cause.HResult -band 65535) -in 32, 33)) {
      [Console]::Error.WriteLine('${lockedMarker}')
      break
    }
  }
  throw
}`

export class LlamaArchiveBusyError extends Error {
  constructor(archive: string, cause: unknown) {
    super(`llama.cpp ZIP is in use: ${archive}. Close any program using it and retry.`, { cause })
  }
}

const isSharingViolation = (error: unknown): boolean => {
  if (typeof error !== 'object' || !error) return false
  const { stderr } = error as { stderr?: unknown }
  return (
    typeof stderr === 'string' && stderr.split(/\r?\n/).some((line) => line.trim() === lockedMarker)
  )
}

export const retryLockedArchive = async (
  archive: string,
  extract: () => Promise<unknown>,
  options: {
    signal?: AbortSignal
    onRetry?: () => void
    waits?: readonly number[]
  } = {}
): Promise<void> => {
  const { signal, onRetry, waits = [250, 500, 1000, 2000] } = options
  for (let i = 0; ; i++) {
    signal?.throwIfAborted()
    try {
      await extract()
      return
    } catch (error) {
      signal?.throwIfAborted()
      if (!isSharingViolation(error)) throw error
      if (i >= waits.length) throw new LlamaArchiveBusyError(archive, error)
      onRetry?.()
      await delay(waits[i], undefined, { signal })
    }
  }
}

export const extractWindowsLlamaZip = (
  archive: string,
  destination: string,
  options?: { signal?: AbortSignal; onRetry?: () => void }
): Promise<void> =>
  retryLockedArchive(
    archive,
    () =>
      execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', expandArchive],
        {
          env: {
            ...process.env,
            AURAPRO_ARCHIVE_SOURCE: archive,
            AURAPRO_ARCHIVE_TARGET: destination
          },
          windowsHide: true,
          signal: options?.signal,
          timeout: 180_000
        }
      ),
    options
  )
