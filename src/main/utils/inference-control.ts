import { createServer, type Server } from 'node:http'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { inferenceCoordinator, type InferenceRuntime } from './inference-coordinator'

let server: Server | null = null
let starting: Promise<Record<string, string>> | null = null
let environment: Record<string, string> | null = null
const leases = new Map<string, { release: () => void; renewed: number }>()
let cleanup: NodeJS.Timeout | null = null

export async function getInferenceControlEnv(): Promise<Record<string, string>> {
  if (environment) return environment
  if (starting) return starting
  starting = startControl()
  try {
    return await starting
  } finally {
    starting = null
  }
}

async function startControl(): Promise<Record<string, string>> {
  const { getManagedLlamaModelIds } = await import('./llamacpp')
  const { getStrataInfo } = await import('./strata')
  const token = randomBytes(32).toString('hex')
  const expected = Buffer.from(`Bearer ${token}`)
  server = createServer(async (req, res) => {
    const auth = Buffer.from(req.headers.authorization || '')
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) {
      res.writeHead(401).end()
      return
    }
    const abort = new AbortController()
    res.on('close', () => {
      if (!res.writableEnded) abort.abort()
    })
    const json = (code: number, value: unknown) => {
      if (!res.destroyed)
        res.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify(value))
    }
    try {
      if (req.method === 'GET' && req.url === '/models') {
        const pro = await getStrataInfo()
        json(200, {
          standard: getManagedLlamaModelIds(),
          pro: pro.supported,
          proContext: pro.settings.context,
          active: inferenceCoordinator.current
        })
        return
      }
      if (req.method !== 'POST') {
        json(404, { error: 'Not found' })
        return
      }
      let body = ''
      for await (const chunk of req) {
        body += chunk.toString()
        if (body.length > 2048) {
          json(413, { error: 'Request too large' })
          return
        }
      }
      const data = JSON.parse(body || '{}')
      if (req.url === '/acquire' || req.url === '/prepare') {
        if (!['standard', 'pro'].includes(data.runtime)) throw new Error('Invalid runtime')
        const release = await inferenceCoordinator.acquire(
          data.runtime as InferenceRuntime,
          abort.signal
        )
        if (abort.signal.aborted || req.url === '/prepare') {
          release()
          json(200, { ready: true })
          return
        }
        const id = randomUUID()
        leases.set(id, { release, renewed: Date.now() })
        json(200, { lease: id })
      } else if (req.url === '/renew' || req.url === '/release') {
        const lease = leases.get(data.lease)
        if (lease) {
          if (req.url === '/release') {
            lease.release()
            leases.delete(data.lease)
          } else lease.renewed = Date.now()
        }
        json(lease || req.url === '/release' ? 200 : 410, { ok: true })
      } else json(404, { error: 'Not found' })
    } catch (err) {
      json(503, { error: String(err) })
    }
  })
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject)
    server!.listen(0, '127.0.0.1', resolve)
  })
  cleanup = setInterval(() => {
    for (const [id, lease] of leases) {
      if (Date.now() - lease.renewed > 120000) {
        lease.release()
        leases.delete(id)
      }
    }
  }, 15000)
  cleanup.unref()
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not bind inference control')
  environment = {
    AURAPRO_INFERENCE_CONTROL_URL: `http://127.0.0.1:${address.port}`,
    AURAPRO_INFERENCE_CONTROL_TOKEN: token
  }
  return environment
}

export async function closeInferenceControl(): Promise<void> {
  if (cleanup) clearInterval(cleanup)
  for (const lease of leases.values()) lease.release()
  leases.clear()
  server?.closeAllConnections()
  server?.close()
  environment = null
  await inferenceCoordinator.shutdown()
}
