import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { RepairFiles } from '../src/main/utils/repair-files.ts'
import { checkLlamaServiceHealth } from '../src/main/utils/llamacpp-health.ts'
import {
  classifyLlamaCppLog,
  inspectLlamaCppGpuLog
} from '../src/main/utils/llamacpp-log-diagnostics.ts'

test('failed repair restores original files even after replacement was written', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'aurapro-repair-test-'))
  try {
    const file = path.join(dir, 'model.gguf')
    await writeFile(file, 'original')
    const files = new RepairFiles()
    await files.preserve(file)
    await files.preserve(file)
    await writeFile(file, 'failed replacement')
    await files.rollback()
    assert.equal(await readFile(file, 'utf8'), 'original')
    assert.deepEqual(await readdir(dir), ['model.gguf'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('successful repair retains replacement and removes backup', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'aurapro-repair-test-'))
  try {
    const file = path.join(dir, 'model.gguf')
    await writeFile(file, 'old')
    const files = new RepairFiles()
    await files.preserve(file)
    await writeFile(file, 'new')
    await files.commit()
    assert.equal(await readFile(file, 'utf8'), 'new')
    assert.deepEqual(await readdir(dir), ['model.gguf'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a later successful inference clears earlier allocation failure', () => {
  assert.equal(classifyLlamaCppLog('out of memory\neval time = 50 ms').outOfMemory, false)
  assert.equal(classifyLlamaCppLog('eval time = 50 ms\nout of memory').outOfMemory, true)
})

test('new model load does not inherit old model failures or GPU evidence', () => {
  const logs =
    'out of memory\noffloaded 40 layers to GPU\nsrv load_model: loading model\noffloaded 0 layers to GPU'
  assert.equal(classifyLlamaCppLog(logs).outOfMemory, false)
  assert.equal(classifyLlamaCppLog(logs).gpuOffloadMissing, true)
  assert.equal(inspectLlamaCppGpuLog(logs).offloadedLayers, 0)
})

test('backend failures clear only after later GPU recovery', () => {
  assert.equal(
    classifyLlamaCppLog('failed to initialize Metal\noffloaded 40 layers to GPU')
      .backendInitializationFailed,
    false
  )
  assert.equal(
    classifyLlamaCppLog('offloaded 40 layers to GPU\nfailed to initialize Metal')
      .backendInitializationFailed,
    true
  )
  assert.equal(
    classifyLlamaCppLog('failed to initialize Metal\neval time = 50 ms')
      .backendInitializationFailed,
    true
  )
})

const running = { status: 'started', pid: 123, url: 'http://127.0.0.1:18881' }
const alive = () => {}

test('healthy service and model loading have distinct non-error states', async () => {
  const healthy = await checkLlamaServiceHealth(
    running,
    async () => Response.json({ status: 'ok' }),
    alive
  )
  assert.equal(healthy.health, 'healthy')
  for (const body of [{ status: 'loading model' }, { error: { message: 'Loading model' } }]) {
    const loading = await checkLlamaServiceHealth(
      running,
      async () => Response.json(body, { status: 503 }),
      alive
    )
    assert.equal(loading.health, 'loading')
  }
})

test('a transient request failure recovers without reporting unresponsive', async () => {
  let requests = 0
  const result = await checkLlamaServiceHealth(
    running,
    async () => {
      if (++requests === 1) throw new Error('temporary network error')
      return Response.json({ status: 'ok' })
    },
    alive
  )
  assert.equal(result.health, 'healthy')
  assert.equal(requests, 2)
})

test('repeated request failures and exited processes cannot appear healthy', async () => {
  let requests = 0
  const request = async () => {
    requests++
    throw new Error('timeout')
  }
  assert.equal((await checkLlamaServiceHealth(running, request, alive)).health, 'unresponsive')
  assert.equal(requests, 2)
  const exited = () => {
    throw Object.assign(new Error('exited'), { code: 'ESRCH' })
  }
  assert.equal((await checkLlamaServiceHealth(running, request, exited)).health, 'unresponsive')
  assert.equal(requests, 2)
})

test('setup and stopped services are not mistaken for a failed health check', async () => {
  const request = async () => {
    throw new Error('Should not make a health request')
  }
  assert.equal(
    (await checkLlamaServiceHealth({ ...running, status: 'starting' }, request, alive)).health,
    'starting'
  )
  assert.equal(
    (await checkLlamaServiceHealth({ status: 'stopped', pid: null, url: null }, request, alive))
      .health,
    'stopped'
  )
})
