import { AsyncLocalStorage } from 'node:async_hooks'

export type InferenceRuntime = 'standard' | 'pro'

type RuntimeAdapter = {
  validate?: () => Promise<void>
  start: () => Promise<void>
  stop: () => Promise<void>
}

/** Serialize switches, and retain the current engine until its requests finish. */
export class InferenceCoordinator {
  private adapters = new Map<InferenceRuntime, RuntimeAdapter>()
  private queue: Promise<unknown> = Promise.resolve()
  private transition = new AsyncLocalStorage<{ active: boolean }>()
  private leases = new Set<symbol>()
  private idleWaiters = new Set<() => void>()
  private active: InferenceRuntime | null = null
  private closing = false

  register(runtime: InferenceRuntime, adapter: RuntimeAdapter): void {
    this.adapters.set(runtime, adapter)
  }

  get current(): InferenceRuntime | null {
    return this.active
  }

  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    if (this.transition.getStore()?.active) return action()
    const task = this.queue.then(() => {
      const scope = { active: true }
      return this.transition.run(scope, async () => {
        try {
          return await action()
        } finally {
          scope.active = false
        }
      })
    })
    this.queue = task.catch(() => undefined)
    return task
  }

  private async idle(): Promise<void> {
    if (this.leases.size) {
      await new Promise<void>((resolve) => this.idleWaiters.add(resolve))
    }
  }

  private adapter(runtime: InferenceRuntime): RuntimeAdapter {
    const adapter = this.adapters.get(runtime)
    if (!adapter) throw new Error(`Inference runtime is unavailable: ${runtime}`)
    return adapter
  }

  async start<T>(
    runtime: InferenceRuntime,
    action: () => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> {
    return this.enqueue(async () => {
      if (this.closing) throw new Error('Inference runtimes are shutting down')
      if (this.active !== runtime) {
        await this.adapters.get(runtime)?.validate?.()
        await this.idle()
        signal?.throwIfAborted()
        if (this.closing) throw new Error('Inference runtimes are shutting down')
        if (this.active) {
          // A failed stop must never permit a second engine to start.
          await this.adapter(this.active).stop()
          this.active = null
        }
      }
      const result = await action()
      this.active = runtime
      return result
    })
  }

  async stop(runtime: InferenceRuntime, action: () => Promise<void>): Promise<void> {
    return this.enqueue(async () => {
      if (this.active === runtime) await this.idle()
      await action()
      if (this.active === runtime) this.active = null
    })
  }

  async acquire(runtime: InferenceRuntime, signal?: AbortSignal): Promise<() => void> {
    return this.enqueue(async () => {
      signal?.throwIfAborted()
      await this.start(runtime, () => this.adapter(runtime).start(), signal)
      signal?.throwIfAborted()
      const lease = Symbol(runtime)
      this.leases.add(lease)
      return () => {
        if (!this.leases.delete(lease)) return
        if (!this.leases.size) {
          for (const resolve of this.idleWaiters) resolve()
          this.idleWaiters.clear()
        }
      }
    })
  }

  async prepare(runtime: InferenceRuntime): Promise<void> {
    const release = await this.acquire(runtime)
    release()
  }

  async configure(runtime: InferenceRuntime, action: () => Promise<void>): Promise<void> {
    return this.enqueue(async () => {
      if (this.closing) throw new Error('Inference runtimes are shutting down')
      const restart = this.active === runtime
      if (restart) {
        await this.idle()
        await this.adapter(runtime).stop()
        this.active = null
      }
      await action()
      if (restart) await this.start(runtime, () => this.adapter(runtime).start())
    })
  }

  async shutdown(): Promise<void> {
    this.closing = true
    this.leases.clear()
    for (const resolve of this.idleWaiters) resolve()
    this.idleWaiters.clear()
    await this.enqueue(async () => {
      const results = await Promise.allSettled(
        [...this.adapters.values()].map((adapter) => adapter.stop())
      )
      this.active = null
      const failures = results.filter((result) => result.status === 'rejected')
      if (failures.length)
        throw new AggregateError(
          failures.map((result) => result.reason),
          'Could not stop all inference runtimes'
        )
    })
  }
}

export const inferenceCoordinator = new InferenceCoordinator()
