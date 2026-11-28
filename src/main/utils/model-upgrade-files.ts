import * as fs from 'node:fs'
import * as path from 'node:path'

export function modelFileSnapshot(filepath: string) {
  const stat = fs.lstatSync(filepath, { throwIfNoEntry: false })
  if (!stat) return null
  if (!stat.isFile()) throw new Error(`Not a regular model file: ${path.basename(filepath)}`)
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`
}

export function checkModelUpgradeDirectory(root: string, dir: string): void {
  const relative = path.relative(root, dir)
  if (relative && (relative.split(path.sep)[0] === '..' || path.isAbsolute(relative))) {
    throw new Error('Model upgrade directory is outside the local model store')
  }
  for (let parent = dir; ; parent = path.dirname(parent)) {
    const stat = fs.lstatSync(parent, { throwIfNoEntry: false })
    if (stat && !stat.isDirectory()) throw new Error('Model upgrade requires a local directory')
    if (parent === root) break
  }
}

export function verifyStagedGguf(filepath: string, expectedSize?: number): number {
  const stat = fs.lstatSync(filepath)
  if (!stat.isFile() || (expectedSize && stat.size !== expectedSize)) {
    throw new Error('The downloaded model has an unexpected size')
  }
  const fd = fs.openSync(filepath, 'r')
  try {
    const magic = Buffer.alloc(4)
    if (
      stat.size < 24 ||
      fs.readSync(fd, magic, 0, magic.length, 0) !== 4 ||
      magic.toString() !== 'GGUF'
    ) {
      throw new Error('The downloaded file is not a GGUF model')
    }
  } finally {
    fs.closeSync(fd)
  }
  return stat.size
}

export async function swapModelUpgradeFiles(
  staged: ReadonlyArray<{ partial: string; final: string }>,
  obsolete: readonly string[],
  activate: () => Promise<void>,
  beforeRollback: () => Promise<void>,
  reportCleanupFailure: (error: unknown) => void
): Promise<void> {
  const displaced: Array<{ original: string; backup: string }> = []
  const promoted: Array<{ partial: string; final: string }> = []
  const originals = new Set([...obsolete, ...staged.map((file) => file.final)])
  const backups = new Map<string, string>()
  let activating = false
  try {
    // Nothing reaches this point until every asset has passed download verification.
    for (const original of originals) {
      if (!modelFileSnapshot(original)) continue
      const parent = path.dirname(original)
      let dir = backups.get(parent)
      if (!dir) {
        dir = fs.mkdtempSync(path.join(parent, '.aurapro-model-backup-'))
        backups.set(parent, dir)
      }
      const backup = path.join(dir, `${path.basename(original)}.bak`)
      fs.renameSync(original, backup)
      displaced.push({ original, backup })
    }
    for (const file of staged) {
      fs.renameSync(file.partial, file.final)
      promoted.push(file)
    }
    activating = true
    await activate()
  } catch (error) {
    const restoreErrors: unknown[] = []
    if (activating) {
      try {
        await beforeRollback()
      } catch (e) {
        restoreErrors.push(e)
      }
    }
    for (const file of promoted.reverse()) {
      try {
        fs.renameSync(file.final, file.partial)
      } catch (e) {
        restoreErrors.push(e)
      }
    }
    for (const { original, backup } of displaced.reverse()) {
      try {
        fs.renameSync(backup, original)
      } catch (e) {
        restoreErrors.push(e)
      }
    }
    if (restoreErrors.length) {
      throw new AggregateError(
        [error, ...restoreErrors],
        'Could not restore the old model. The backup files were kept.'
      )
    }
    for (const dir of backups.values()) {
      try {
        fs.rmdirSync(dir)
      } catch (cleanupError) {
        reportCleanupFailure(cleanupError)
      }
    }
    throw error
  }
  for (const { backup } of displaced) {
    try {
      fs.unlinkSync(backup)
    } catch (error) {
      reportCleanupFailure(error)
    }
  }
  for (const dir of backups.values()) {
    try {
      fs.rmdirSync(dir)
    } catch (error) {
      reportCleanupFailure(error)
    }
  }
}
