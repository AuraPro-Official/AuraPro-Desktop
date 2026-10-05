import assert from 'node:assert/strict'
import { test } from 'node:test'
import { InferenceCoordinator } from '../src/main/utils/inference-coordinator.ts'

const fixture = () => {
  const coordinator = new InferenceCoordinator()
  const events = []
  for (const runtime of ['standard', 'pro']) {
    coordinator.register(runtime, {
      start: async () => events.push(`start:${runtime}`),
      stop: async () => events.push(`stop:${runtime}`)
    })
  }
  return { coordinator, events }
}

test('switch waits for all requests, including a streaming response', async () => {
  const { coordinator, events } = fixture()
  const first = await coordinator.acquire('standard')
  const second = await coordinator.acquire('standard')
  const switching = coordinator.prepare('pro')
  await new Promise(setImmediate)
  assert.equal(coordinator.current, 'standard')
  first()
  first()
  await new Promise(setImmediate)
  assert.ok(!events.includes('stop:standard'))
  second()
  await switching
  assert.deepEqual(events.slice(-2), ['stop:standard', 'start:pro'])
})

test('requests queued after a switch cannot overtake it', async () => {
  const { coordinator, events } = fixture()
  const release = await coordinator.acquire('standard')
  const pro = coordinator.acquire('pro')
  const standard = coordinator.acquire('standard')
  release()
  const releasePro = await pro
  assert.equal(coordinator.current, 'pro')
  releasePro()
  const releaseStandard = await standard
  releaseStandard()
  assert.deepEqual(events.slice(-4), ['stop:standard', 'start:pro', 'stop:pro', 'start:standard'])
})

test('failed stop blocks the other engine without poisoning the queue', async () => {
  const { coordinator, events } = fixture()
  coordinator.register('standard', {
    start: async () => {},
    stop: async () => {
      throw new Error('process still alive')
    }
  })
  await coordinator.prepare('standard')
  await assert.rejects(coordinator.prepare('pro'), /process still alive/)
  assert.equal(coordinator.current, 'standard')
  assert.ok(!events.includes('start:pro'))
  await coordinator.prepare('standard')
})

test('failed start is retryable', async () => {
  const { coordinator } = fixture()
  let attempts = 0
  coordinator.register('pro', {
    start: async () => {
      if (++attempts === 1) throw new Error('not installed')
    },
    stop: async () => {}
  })
  await assert.rejects(coordinator.prepare('pro'), /not installed/)
  await coordinator.prepare('pro')
  assert.equal(coordinator.current, 'pro')
})

test('an unprepared Pro model never stops the usable standard runtime', async () => {
  const { coordinator, events } = fixture()
  await coordinator.prepare('standard')
  coordinator.register('pro', {
    validate: async () => {
      throw new Error('model not installed')
    },
    start: async () => events.push('start:pro'),
    stop: async () => {}
  })
  await assert.rejects(coordinator.prepare('pro'), /model not installed/)
  assert.equal(coordinator.current, 'standard')
  assert.ok(!events.includes('stop:standard'))
})

test('cancelled queued switch leaves the current engine running', async () => {
  const { coordinator, events } = fixture()
  const release = await coordinator.acquire('standard')
  const abort = new AbortController()
  const switching = coordinator.acquire('pro', abort.signal)
  await new Promise(setImmediate)
  abort.abort()
  release()
  await assert.rejects(switching)
  assert.equal(coordinator.current, 'standard')
  assert.ok(!events.includes('start:pro'))
})

test('shutdown releases blocked switches and prevents subsequent starts', async () => {
  const { coordinator } = fixture()
  const release = await coordinator.acquire('standard')
  const pending = coordinator.prepare('pro')
  const shuttingDown = coordinator.shutdown()
  await assert.rejects(pending, /shutting down/)
  await shuttingDown
  release()
  assert.equal(coordinator.current, null)
  await assert.rejects(coordinator.prepare('pro'), /shutting down/)
})

test('changing settings waits for the request and restarts only the active engine', async () => {
  const { coordinator, events } = fixture()
  const release = await coordinator.acquire('pro')
  const saving = coordinator.configure('pro', async () => events.push('saved'))
  await new Promise(setImmediate)
  assert.ok(!events.includes('saved'))
  release()
  await saving
  assert.deepEqual(events.slice(-3), ['stop:pro', 'saved', 'start:pro'])
  await coordinator.configure('standard', async () => events.push('standard-saved'))
  assert.equal(coordinator.current, 'pro')
  assert.equal(events.at(-1), 'standard-saved')
})
