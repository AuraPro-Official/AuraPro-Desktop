export class GlossaryStartupReminder {
  private checked = false
  private dismissed = false
  private visible = false

  get pending(): boolean {
    return this.visible
  }

  async check(isInstalled: () => Promise<boolean>, notify: () => void): Promise<void> {
    if (this.checked || this.dismissed) return
    this.checked = true
    if (!(await isInstalled()) && !this.dismissed) {
      this.visible = true
      notify()
    }
  }

  dismiss(): void {
    this.dismissed = true
    this.visible = false
  }
}
