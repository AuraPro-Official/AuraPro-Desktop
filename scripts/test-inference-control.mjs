import assert from 'node:assert/strict'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'

const file = new URL('../src/main/utils/inference-control.ts', import.meta.url)
const source = ts.createSourceFile(
  file.pathname,
  readFileSync(file, 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const start = source.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'startControl'
)
assert.ok(start, 'Production runtime-control setup must exist')

const fixture = async (initial) => {
  let pro = initial
  let handler
  let runtimeCalls = 0
  const context = createContext({
    Buffer,
    AbortController,
    Date,
    randomBytes,
    randomUUID,
    timingSafeEqual,
    server: null,
    environment: null,
    cleanup: null,
    leases: new Map(),
    setInterval: () => ({ unref: () => {} }),
    inferenceCoordinator: {
      current: 'standard',
      acquire: async () => {
        runtimeCalls++
      }
    },
    require: (name) => {
      if (name === './llamacpp') return { getManagedLlamaModelIds: () => ['high_Q4'] }
      if (name === './strata') return { getStrataInfo: async () => pro }
      throw new Error(`Unexpected import: ${name}`)
    },
    createServer: (callback) => {
      handler = callback
      return {
        once: () => {},
        listen: (_port, host, ready) => {
          assert.equal(host, '127.0.0.1')
          ready()
        },
        address: () => ({ port: 12345 })
      }
    }
  })
  runInContext(
    ts.transpileModule(`${start.getText(source)}\nglobalThis.start = startControl`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText,
    context
  )
  const env = await context.start()
  return {
    update: (value) => (pro = value),
    models: async () => {
      let result
      const response = {
        on: () => {},
        writeHead: (status) => {
          assert.equal(status, 200)
          return response
        },
        end: (body) => (result = JSON.parse(body))
      }
      await handler(
        {
          method: 'GET',
          url: '/models',
          headers: { authorization: `Bearer ${env.AURAPRO_INFERENCE_CONTROL_TOKEN}` }
        },
        response
      )
      assert.equal(runtimeCalls, 0, 'Listing models must not start a runtime')
      return result
    }
  }
}

const info = (installed, extra = {}) => ({
  supported: true,
  installed,
  status: 'stopped',
  settings: { context: 32768 },
  ...extra
})

test('Pro model is hidden until its framework is installed, even on supported platforms', async () => {
  const control = await fixture(info(null))
  const result = await control.models()
  assert.equal(result.pro, false)
  assert.deepEqual(result.standard, ['high_Q4'])
})

test('installed Pro stays visible while stopped and does not require loaded model weights', async () => {
  const control = await fixture(info({ source: 'native' }, { models: [] }))
  const result = await control.models()
  assert.equal(result.pro, true)
  assert.equal(result.proContext, 32768)
  assert.equal(result.active, 'standard')
})

test('Pro visibility follows installation and removal without restarting WebUI', async () => {
  const control = await fixture(info(null))
  assert.equal((await control.models()).pro, false)
  control.update(info({ source: 'strata' }))
  assert.equal((await control.models()).pro, true)
  control.update(info(null))
  assert.equal((await control.models()).pro, false)
})

test('an unsupported platform never advertises Pro', async () => {
  const control = await fixture(info({ source: 'strata' }, { supported: false }))
  assert.equal((await control.models()).pro, false)
})
