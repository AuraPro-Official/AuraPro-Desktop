import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { checkOptionalService } from '../src/main/utils/optional-service-health.ts'

const snapshot = () => ({ status: 'started', pid: 123, url: 'http://127.0.0.1:39384' })
const options = { enabled: true, activeProbe: true, snapshot, endpoint: '/health' }

const localServer = async (handler, run) => {
  const server = createServer(handler)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    await run({
      ...options,
      snapshot: () => ({
        status: 'started',
        pid: process.pid,
        url: 'http://127.0.0.1:' + server.address().port
      })
    })
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}

test('real local health and terminal socket probes do not send task requests', async () => {
  let requests = 0
  await localServer(
    (req, res) => {
      requests++
      assert.equal(req.method, 'GET')
      assert.equal(req.url, '/health')
      res.setHeader('Content-Type', 'application/json')
      res.end('{"ok":true}')
    },
    async (config) => {
      assert.equal(
        await checkOptionalService({ ...config, validBody: (body) => body.ok === true }),
        'responding'
      )
      assert.equal(await checkOptionalService({ ...config, endpoint: undefined }), 'listening')
      assert.equal(requests, 1)
    }
  )
})

test(
  'a stalled response body is aborted instead of hanging diagnostics',
  { timeout: 10000 },
  async () => {
    let requests = 0
    await localServer(
      (_req, res) => {
        requests++
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.write('{"ok":')
      },
      async (config) => {
        assert.equal(
          await checkOptionalService({ ...config, validBody: (body) => body.ok === true }),
          'unverified'
        )
        assert.equal(requests, 2)
      }
    )
  }
)
const dependencies = (request = async () => new Response('{"ok":true}')) => ({
  request,
  checkProcess: () => {},
  portResponds: async () => true
})

test('disabled, stopped and starting services do not probe or check processes', async () => {
  const deps = {
    request: () => assert.fail('must not request'),
    checkProcess: () => assert.fail('must not check process'),
    portResponds: () => assert.fail('must not connect')
  }
  assert.equal(
    await checkOptionalService(
      { ...options, enabled: false, snapshot: () => assert.fail('must not read state') },
      deps
    ),
    'disabled'
  )
  for (const [status, expected] of [
    [null, 'stopped'],
    ['stopped', 'stopped'],
    ['starting', 'starting'],
    ['setting-up', 'starting'],
    ['failed', 'failed']
  ]) {
    assert.equal(
      await checkOptionalService({ ...options, snapshot: () => ({ ...snapshot(), status }) }, deps),
      expected
    )
  }
})

test('automatic checks inspect process only', async () => {
  assert.equal(
    await checkOptionalService(
      { ...options, activeProbe: false },
      dependencies(() => assert.fail('must not request'))
    ),
    'running'
  )
})

test('known process exit is distinct from permission denial', async () => {
  for (const [code, expected] of [
    ['ESRCH', 'exited'],
    ['EPERM', 'running'],
    ['EACCES', 'unverified']
  ]) {
    const deps = dependencies()
    deps.checkProcess = () => {
      throw Object.assign(new Error('test'), { code })
    }
    assert.equal(await checkOptionalService({ ...options, activeProbe: false }, deps), expected)
  }
})

test('manual HTTP probe is local, bounded, read-only and never follows redirects', async () => {
  let calls = 0
  const deps = dependencies(async (url, init) => {
    calls++
    assert.equal(url.href, 'http://127.0.0.1:39384/health')
    assert.equal(init.redirect, 'error')
    assert.equal(init.method, undefined)
    assert.ok(init.signal instanceof AbortSignal)
    return new Response('{"ok":true}')
  })
  assert.equal(
    await checkOptionalService({ ...options, validBody: (body) => body.ok === true }, deps),
    'responding'
  )
  assert.equal(calls, 1)
})

test('busy, malformed or unresponsive service stays unconfirmed after two attempts', async () => {
  for (const reply of [
    () => new Response('{}'),
    () => new Response('bad'),
    () => new Response('', { status: 503 }),
    () => {
      throw new Error('timeout')
    }
  ]) {
    let calls = 0
    const deps = dependencies(async () => {
      calls++
      return reply()
    })
    assert.equal(
      await checkOptionalService({ ...options, validBody: (body) => body.ok === true }, deps),
      'unverified'
    )
    assert.equal(calls, 2)
  }
})

test('transient failure recovers and authentication errors are distinguished', async () => {
  let calls = 0
  assert.equal(
    await checkOptionalService(
      options,
      dependencies(async () => {
        if (++calls === 1) throw new Error('temporarily unavailable')
        return new Response('{}')
      })
    ),
    'responding'
  )
  for (const status of [401, 403]) {
    assert.equal(
      await checkOptionalService(
        options,
        dependencies(async () => new Response('', { status }))
      ),
      'auth-required'
    )
  }
})

test('service stop or restart during a request discards stale success', async () => {
  let current = snapshot()
  const result = await checkOptionalService(
    { ...options, snapshot: () => current },
    dependencies(async () => {
      current = { status: 'stopped', pid: null, url: null }
      return new Response('{}')
    })
  )
  assert.equal(result, 'unverified')
})

test('nonlocal or credential-bearing URLs are never contacted', async () => {
  for (const url of [
    'https://example.com',
    'http://127.0.0.1.example.com',
    'file:///tmp/test',
    'http://user:password@127.0.0.1',
    'invalid'
  ]) {
    assert.equal(
      await checkOptionalService(
        { ...options, snapshot: () => ({ ...snapshot(), url }) },
        dependencies(() => assert.fail('must not request'))
      ),
      'unverified'
    )
  }
})

test('terminal check only opens a socket and does not claim functional health', async () => {
  const deps = dependencies(() => assert.fail('must not execute terminal API'))
  assert.equal(await checkOptionalService({ ...options, endpoint: undefined }, deps), 'listening')
  deps.portResponds = async () => false
  assert.equal(await checkOptionalService({ ...options, endpoint: undefined }, deps), 'unverified')
})
