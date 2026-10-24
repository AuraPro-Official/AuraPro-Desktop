import assert from 'node:assert/strict'
import test from 'node:test'
import bridge from '../resources/pi-aurapro.mjs'

const harness = async (environment = {}) => {
  const previous = { ...process.env }
  Object.assign(process.env, {
    AURAPRO_PI_PLAN: '0',
    AURAPRO_PI_APPROVAL_MODE: 'step',
    ...environment
  })
  const tools = new Map()
  const handlers = new Map()
  let active = []
  const pi = {
    registerTool: (tool) => tools.set(tool.name, tool),
    registerCommand: () => undefined,
    on: (name, handler) => handlers.set(name, handler),
    getActiveTools: () => active,
    setActiveTools: (value) => (active = value),
    getAllTools: () => [...tools.values()],
    getCommands: () => []
  }
  await bridge(pi)
  return {
    tools,
    handlers,
    active: () => active,
    restore: () => {
      process.env = previous
    }
  }
}

test('Agent asks a real select/input question without interpreting cancellation as approval', async () => {
  const h = await harness()
  try {
    const tool = h.tools.get('ask_user')
    const ctx = {
      ui: { select: async (_question, choices) => choices[1], input: async () => undefined }
    }
    const selected = await tool.execute(
      '',
      { question: 'Format?', options: ['JSON', 'CSV'] },
      null,
      null,
      ctx
    )
    assert.equal(selected.content[0].text, 'CSV')
    const cancelled = await tool.execute('', { question: 'Name?' }, null, null, ctx)
    assert.match(cancelled.content[0].text, /cancelled.*Do not assume approval/)
  } finally {
    h.restore()
  }
})

test('Agent publishes a task plan and validates a single active step', async () => {
  const h = await harness()
  try {
    const notices = []
    const ctx = { ui: { notify: (value) => notices.push(JSON.parse(value)) } }
    const steps = [
      { content: 'Implement', status: 'in_progress' },
      { content: 'Verify', status: 'pending' }
    ]
    await h.tools.get('update_plan').execute('', { steps }, null, null, ctx)
    assert.equal(notices[0].auraproPlan, true)
    assert.deepEqual(
      notices[0].steps.map((step) => step.status),
      ['in_progress', 'pending']
    )
    await assert.rejects(
      h.tools
        .get('update_plan')
        .execute(
          '',
          { steps: steps.map((step) => ({ ...step, status: 'in_progress' })) },
          null,
          null,
          ctx
        ),
      /Only one/
    )
  } finally {
    h.restore()
  }
})

test('Plan mode permits questions/planning but continues to block modifications', async () => {
  const h = await harness({ AURAPRO_PI_PLAN: '1' })
  try {
    const ctx = {
      cwd: process.cwd(),
      ui: {
        notify: () => undefined,
        confirm: () => {
          throw new Error('Unexpected permission dialog')
        }
      }
    }
    for (const toolName of ['ask_user', 'update_plan']) {
      assert.equal(await h.handlers.get('tool_call')({ toolName, input: {} }, ctx), undefined)
    }
    for (const toolName of ['write', 'edit', 'bash', 'powershell', 'act_ui']) {
      assert.equal((await h.handlers.get('tool_call')({ toolName, input: {} }, ctx)).block, true)
    }
    await h.handlers.get('session_start')({}, ctx)
    assert.ok(h.active().includes('ask_user'))
    assert.ok(h.active().includes('update_plan'))
  } finally {
    h.restore()
  }
})
