import { connect } from 'node:net'

export type OptionalServiceHealth =
  | 'disabled'
  | 'stopped'
  | 'starting'
  | 'running'
  | 'responding'
  | 'listening'
  | 'unverified'
  | 'auth-required'
  | 'failed'
  | 'exited'

export interface ServiceSnapshot {
  status: string | null
  pid: number | null
  url: string | null
}

interface ServiceCheck {
  enabled: boolean
  activeProbe: boolean
  snapshot: () => ServiceSnapshot
  endpoint?: string
  headers?: Record<string, string>
  validBody?: (body: unknown) => boolean
}

const portResponds = (url: URL): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = connect(Number(url.port || (url.protocol === 'https:' ? 443 : 80)), url.hostname)
    const finish = (result: boolean): void => {
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(1500, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })

// Only probe a managed loopback service; never follow redirects with credentials.
export const checkOptionalService = async (
  options: ServiceCheck,
  dependencies = {
    request: fetch,
    checkProcess: (pid: number): void => {
      process.kill(pid, 0)
    },
    portResponds
  }
): Promise<OptionalServiceHealth> => {
  if (!options.enabled) return 'disabled'
  const state = options.snapshot()
  if (state.status === 'failed') return 'failed'
  if (['starting', 'setting-up'].includes(state.status ?? '')) return 'starting'
  if (state.status !== 'started') return 'stopped'
  if (!state.pid) return 'unverified'
  try {
    dependencies.checkProcess(state.pid)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return 'exited'
    if ((error as NodeJS.ErrnoException).code !== 'EPERM') return 'unverified'
  }
  if (!options.activeProbe) return 'running'
  let url: URL
  try {
    url = new URL(state.url ?? '')
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !['127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username ||
      url.password
    )
      return 'unverified'
  } catch {
    return 'unverified'
  }
  const unchanged = (): boolean => {
    const current = options.snapshot()
    return current.pid === state.pid && current.url === state.url && current.status === state.status
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    let result: OptionalServiceHealth = 'unverified'
    try {
      if (options.endpoint) {
        const response = await dependencies.request(new URL(options.endpoint, url), {
          headers: options.headers,
          signal: AbortSignal.timeout(1500),
          redirect: 'error'
        })
        try {
          if (response.status === 401 || response.status === 403) result = 'auth-required'
          else if (
            response.ok &&
            (!options.validBody || options.validBody(await response.json()))
          ) {
            result = 'responding'
          }
        } finally {
          await response.body?.cancel().catch(() => {})
        }
      } else if (await dependencies.portResponds(url)) {
        result = 'listening'
      }
    } catch {
      // A busy or warming-up service is not evidence of a broken installation.
    }
    if (!unchanged()) return 'unverified'
    if (result !== 'unverified') return result
  }
  return 'unverified'
}
