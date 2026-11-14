import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { GlossaryStartupReminder } from '../src/main/utils/glossary-startup-reminder.ts'

test('missing glossaries produce one reminder per app session, not per server restart', async () => {
  const reminder = new GlossaryStartupReminder()
  let checks = 0
  let prompts = 0
  const check = async () => {
    checks++
    return false
  }
  const notify = () => prompts++
  await Promise.all([reminder.check(check, notify), reminder.check(check, notify)])
  assert.equal(reminder.pending, true)
  await reminder.check(check, notify)
  assert.equal(checks, 1)
  assert.equal(prompts, 1)
  reminder.dismiss()
  reminder.dismiss()
  assert.equal(reminder.pending, false)
  await reminder.check(check, notify)
  assert.equal(prompts, 1)
})

test('installed glossaries never prompt', async () => {
  const reminder = new GlossaryStartupReminder()
  await reminder.check(async () => true, assert.fail)
  assert.equal(reminder.pending, false)
})

test('dismissing while the status check is pending prevents a late reminder', async () => {
  const reminder = new GlossaryStartupReminder()
  let resolve
  const check = reminder.check(() => new Promise((done) => (resolve = done)), assert.fail)
  reminder.dismiss()
  resolve(false)
  await check
  assert.equal(reminder.pending, false)
})

test('a fresh app session can remind again after skipping', async () => {
  const first = new GlossaryStartupReminder()
  first.dismiss()
  await first.check(async () => false, assert.fail)
  const next = new GlossaryStartupReminder()
  let shown = false
  await next.check(
    async () => false,
    () => (shown = true)
  )
  assert.equal(shown, true)
})

test('a failed status check does not repeatedly retry or leave a pending reminder', async () => {
  const reminder = new GlossaryStartupReminder()
  await assert.rejects(
    reminder.check(async () => {
      throw new Error('Status unavailable')
    }, assert.fail),
    /Status unavailable/
  )
  assert.equal(reminder.pending, false)
  await reminder.check(assert.fail, assert.fail)
})

const file = new URL('../src/main/index.ts', import.meta.url)
const source = ts.createSourceFile(
  file.pathname,
  readFileSync(file, 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const start = source.statements
  .filter(ts.isVariableStatement)
  .flatMap((statement) => [...statement.declarationList.declarations])
  .find((node) => node.name.getText(source) === 'startWebUIServer')
assert.ok(start, 'The production WebUI startup function must exist')

const startup = (getStatus, failNotify = false) => {
  let starts = 0
  const warnings = []
  const events = []
  const config = { connections: [], localServer: {} }
  const context = createContext({
    SERVER_STATUS: 'stopped',
    CONFIG: null,
    SERVER_URL: null,
    SERVER_PID: null,
    SERVER_REACHABLE: false,
    glossaryStartupReminder: new GlossaryStartupReminder(),
    getConfig: async () => config,
    setConfig: async () => {},
    getOfficialGlossaryStatus: getStatus,
    stopServerHandler: async () => {},
    updateWebUIStartupState: () => {},
    sendToRenderer: (type, data) => {
      if (failNotify && type === 'official-glossaries:startup-prompt') {
        throw new Error('Renderer unavailable')
      }
      events.push({ type, data })
    },
    startServer: async () => {
      starts++
      return { url: 'http://localhost:8081', pid: 12345 }
    },
    getServerPty: () => null,
    connectPtyPort: () => {},
    updateTray: () => {},
    checkUrlAndOpen: () => {},
    getErrorMessage: (error) => error.message,
    log: { info: () => {}, warn: (...args) => warnings.push(args), error: assert.fail }
  })
  runInContext(
    ts.transpileModule(`globalThis.start = ${start.initializer.getText(source)}`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText,
    context
  )
  return { context, events, warnings, starts: () => starts }
}

test(
  'WebUI starts without waiting for a stalled glossary status check',
  { timeout: 1000 },
  async () => {
    const fixture = startup(() => new Promise(() => {}))
    assert.equal(await fixture.context.start(), true)
    assert.equal(fixture.starts(), 1)
    assert.equal(fixture.context.SERVER_STATUS, 'started')
    assert.equal(
      fixture.events.some((event) => event.type.endsWith('startup-prompt')),
      false
    )
  }
)

test('WebUI starts without any user response to the optional reminder', async () => {
  const fixture = startup(async () => ({ installed: false }))
  assert.equal(await fixture.context.start(), true)
  assert.equal(fixture.context.glossaryStartupReminder.pending, true)
  assert.equal(fixture.starts(), 1)
  assert.equal(
    fixture.events.some((event) => event.type.endsWith('startup-prompt')),
    true
  )
})

test('WebUI starts when the optional glossary status check fails', async () => {
  const fixture = startup(async () => {
    throw new Error('Status unavailable')
  })
  assert.equal(await fixture.context.start(), true)
  await Promise.resolve()
  assert.equal(fixture.starts(), 1)
  assert.equal(fixture.warnings.length, 1)
})

test('WebUI starts when the reminder cannot be delivered to the renderer', async () => {
  const fixture = startup(async () => ({ installed: false }), true)
  assert.equal(await fixture.context.start(), true)
  await Promise.resolve()
  assert.equal(fixture.starts(), 1)
  assert.equal(fixture.warnings.length, 1)
})
