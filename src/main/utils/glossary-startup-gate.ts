export class GlossaryStartupGate {
  private completion: (() => void) | null = null
  private waiting: Promise<void> | null = null

  get pending(): boolean {
    return this.completion !== null
  }

  wait(): Promise<void> {
    if (!this.waiting) {
      this.waiting = new Promise<void>((resolve) => {
        this.completion = resolve
      })
    }
    return this.waiting
  }

  finish(): void {
    const complete = this.completion
    this.completion = null
    this.waiting = null
    complete?.()
  }
}
