import { access, cp, mkdir, readdir, rename, rm } from 'fs/promises'
import path from 'path'

/**
 * Seeding of the Open WebUI data directory from the bundled `data/` resources.
 *
 * The bundled directory is a **seed**, not a snapshot of a healthy install: it
 * ships a single pre-built `webui.db` that carries the stock administrator
 * account and the shipped WebUI config row, which is how a fresh install gets
 * its only account. Everything else that lives under the data directory at
 * runtime — the live `webui.db`, `uploads/`, `vector_db/`, `cache/`, the `.key`
 * secret, downloaded glossaries — is user-owned and is created by the backend
 * or by the user, never by the bundle.
 *
 * Seeding is therefore **additive**: a top-level bundled entry is copied only
 * when the target does not already have it (an entry that exists is left alone
 * as a whole — directories are never merged into). Nothing is removed.
 * Schema evolution of an existing `webui.db` is not the desktop shell's job —
 * the Python backend runs `alembic upgrade head` on every server start
 * (`open_webui/config.py: run_migrations`), so a stale user database is
 * upgraded in place rather than thrown away.
 *
 * If a future seed change genuinely cannot be applied in place, add the bundled
 * file name to that step's `replace` list in `DATA_SEED_MIGRATIONS`. Only the
 * files named there are overwritten, and each one is moved into a timestamped
 * backup directory first, so the operation stays recoverable.
 */

export interface DataSeedMigration {
  /** The `dataVersion` this step raises the install to. */
  version: number
  /**
   * Bundled entries that must overwrite an existing local copy at this step.
   * Leave empty unless a seed change truly cannot be applied in place — every
   * name listed here is user-visible data loss (mitigated only by the backup).
   */
  replace?: string[]
}

export const REQUIRED_DATA_VERSION = 3

/**
 * Steps 1–3 predate this repository's history (the initial commit already
 * required version 3). They are applied as pure seeding: no bundled file has
 * ever needed to overwrite a file the user owns.
 */
export const DATA_SEED_MIGRATIONS: readonly DataSeedMigration[] = [{ version: 3 }]

/** Backups live inside the data directory so the move stays on one filesystem. */
export const DATA_BACKUP_DIR_NAME = '.aurapro-data-backups'

/** Keep the operation bounded: only the most recent backups are retained. */
export const MAX_DATA_BACKUPS = 3

/**
 * Applying a stale write-ahead log to a freshly seeded database corrupts it, so
 * these travel with their database whenever one is moved aside or replaced.
 */
const SQLITE_SIDECAR_SUFFIXES = ['-wal', '-shm', '-journal']

export type SeedStatus = 'backing-up' | 'copying'

export interface SeedDataDirectoryOptions {
  /** The bundled `data/` directory inside the app resources. */
  packagedDataDir: string
  /** The live Open WebUI data directory. */
  targetDataDir: string
  /** The install's current `dataVersion`. */
  fromVersion: number
  /** The `dataVersion` this run migrates to. */
  toVersion?: number
  /** Migration table; injectable so it can be exercised in isolation. */
  migrations?: readonly DataSeedMigration[]
  onStatus?: (status: SeedStatus) => void
}

export interface SeedDataDirectoryResult {
  /** Bundled entries copied in because the target did not have them. */
  seeded: string[]
  /** Bundled entries that overwrote an existing local copy. */
  replaced: string[]
  /** Entries moved into the backup directory, if any. */
  backedUp: string[]
  /** The backup directory, or `null` when nothing needed backing up. */
  backupDir: string | null
}

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

/**
 * Move one entry into the backup directory. Uses `rename` (atomic, same
 * filesystem) and falls back to copy-then-remove if the platform refuses.
 * Returns `false` when there was nothing to move.
 */
const moveIntoBackup = async (
  source: string,
  backupDir: string,
  name: string
): Promise<boolean> => {
  if (!(await pathExists(source))) return false
  await mkdir(backupDir, { recursive: true })
  const destination = path.join(backupDir, name)
  try {
    await rename(source, destination)
  } catch {
    await cp(source, destination, { recursive: true, force: true })
    await rm(source, { recursive: true, force: true })
  }
  return true
}

const stashSqliteSidecars = async (
  dataDir: string,
  backupDir: string,
  name: string
): Promise<string[]> => {
  const moved: string[] = []
  for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
    const sidecar = `${name}${suffix}`
    if (await moveIntoBackup(path.join(dataDir, sidecar), backupDir, sidecar)) {
      moved.push(sidecar)
    }
  }
  return moved
}

/** Drop all but the {@link MAX_DATA_BACKUPS} most recent backup directories. */
export const pruneDataBackups = async (
  backupRoot: string,
  keep: number = MAX_DATA_BACKUPS
): Promise<string[]> => {
  if (!(await pathExists(backupRoot))) return []
  const entries = (await readdir(backupRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  const removed = entries.slice(0, Math.max(0, entries.length - Math.max(0, keep)))
  for (const name of removed) {
    await rm(path.join(backupRoot, name), { recursive: true, force: true })
  }
  return removed
}

/** The bundled entries a migration run is allowed to overwrite. */
export const resolveReplacements = (
  fromVersion: number,
  toVersion: number,
  migrations: readonly DataSeedMigration[] = DATA_SEED_MIGRATIONS
): string[] => [
  ...new Set(
    migrations
      .filter((migration) => migration.version > fromVersion && migration.version <= toVersion)
      .flatMap((migration) => migration.replace ?? [])
  )
]

/**
 * Copy the bundled seed into the data directory without destroying user data.
 *
 * Existing entries are left alone unless a migration step between
 * `fromVersion` and `toVersion` explicitly names them, in which case the local
 * copy (plus any SQLite sidecars) is moved into a timestamped backup first.
 */
export const seedDataDirectory = async ({
  packagedDataDir,
  targetDataDir,
  fromVersion,
  toVersion = REQUIRED_DATA_VERSION,
  migrations = DATA_SEED_MIGRATIONS,
  onStatus
}: SeedDataDirectoryOptions): Promise<SeedDataDirectoryResult> => {
  if (!(await pathExists(packagedDataDir))) {
    throw new Error(`Bundled data directory not found: ${packagedDataDir}`)
  }
  await mkdir(targetDataDir, { recursive: true })

  const replacements = resolveReplacements(fromVersion, toVersion, migrations)
  const backupRoot = path.join(targetDataDir, DATA_BACKUP_DIR_NAME)
  const backupDir = path.join(backupRoot, new Date().toISOString().replace(/[:.]/g, '-'))
  const result: SeedDataDirectoryResult = {
    seeded: [],
    replaced: [],
    backedUp: [],
    backupDir: null
  }

  for (const entry of await readdir(packagedDataDir, { withFileTypes: true })) {
    const name = entry.name
    const source = path.join(packagedDataDir, name)
    const destination = path.join(targetDataDir, name)
    const alreadyPresent = await pathExists(destination)

    // The common case: the user already owns this entry, so leave it untouched.
    if (alreadyPresent && !replacements.includes(name)) continue

    if (alreadyPresent) {
      onStatus?.('backing-up')
      if (await moveIntoBackup(destination, backupDir, name)) {
        result.backedUp.push(name)
      }
      result.backedUp.push(...(await stashSqliteSidecars(targetDataDir, backupDir, name)))
      result.replaced.push(name)
    } else {
      // A sidecar left behind without its database would be replayed into the
      // seeded copy, so move it aside rather than seeding on top of it.
      result.backedUp.push(...(await stashSqliteSidecars(targetDataDir, backupDir, name)))
      result.seeded.push(name)
    }

    onStatus?.('copying')
    await cp(source, destination, { recursive: true, force: true })
  }

  if (result.backedUp.length > 0) {
    result.backupDir = backupDir
    await pruneDataBackups(backupRoot)
  }

  return result
}
