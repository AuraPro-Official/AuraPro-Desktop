export type LlamaServiceHealth = 'healthy' | 'loading' | 'starting' | 'unresponsive' | 'stopped'

export const checkLlamaServiceHealth = async (
  info: { status: string | null; pid: number | null; url: string | null },
  request: typeof fetch = fetch,
  checkProcess: (pid: number) => void = (pid) => {
    process.kill(pid, 0)
  }
): Promise<{ health: LlamaServiceHealth; processAlive: boolean }> => {
  let processAlive = false
  if (info.pid) {
    try {
      checkProcess(info.pid)
      processAlive = true
    } catch (error) {
      processAlive = (error as NodeJS.ErrnoException).code === 'EPERM'
    }
  }
  if (['setting-up', 'starting'].includes(info.status ?? '')) {
    return { health: 'starting', processAlive }
  }
  if (info.status !== 'started') return { health: 'stopped', processAlive }
  for (let attempt = 0; processAlive && info.url && attempt < 2; attempt++) {
    try {
      const response = await request(new URL('/health', info.url), {
        signal: AbortSignal.timeout(3000)
      })
      const body = (await response.json()) as { status?: string; error?: { message?: string } }
      if (response.ok && body.status === 'ok') return { health: 'healthy', processAlive }
      if (
        response.status === 503 &&
        /loading model/i.test(body.status ?? body.error?.message ?? '')
      ) {
        return { health: 'loading', processAlive }
      }
    } catch {
      // Confirm transient failures before recommending a restart.
    }
  }
  return { health: 'unresponsive', processAlive }
}
