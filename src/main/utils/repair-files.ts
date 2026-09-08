import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'

export class RepairFiles {
  private backups = new Map<string, string>()

  async preserve(filepath: string): Promise<void> {
    if (this.backups.has(filepath)) return
    const backup = `${filepath}.repair-${randomUUID()}`
    try {
      await fs.rename(filepath, backup)
      this.backups.set(filepath, backup)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  async rollback(): Promise<void> {
    const errors: unknown[] = []
    for (const [filepath, backup] of this.backups) {
      try {
        await fs.rm(filepath, { force: true })
        await fs.rename(backup, filepath)
        this.backups.delete(filepath)
      } catch (error) {
        errors.push(new Error(`Unable to restore ${filepath}; backup: ${backup}`, { cause: error }))
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Some repair backups could not be restored')
  }

  async commit(): Promise<void> {
    for (const [filepath, backup] of this.backups) {
      await fs.rm(backup, { force: true })
      this.backups.delete(filepath)
    }
  }
}
