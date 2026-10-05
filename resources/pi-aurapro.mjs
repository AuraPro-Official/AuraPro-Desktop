import path from 'node:path'
import fs from 'node:fs'

// This extension runs in Pi; every dialog is forwarded over RPC to WebUI.
export default async function (pi, factories = []) {
  const tools = new Map()
  const commands = new Map()
  const startup = []
  let initialized = false
  const adapter = new Proxy(pi, {
    get(target, key) {
      if (key === 'registerTool')
        return (tool) => {
          tools.set(tool.name, tool)
          target.registerTool(tool)
        }
      if (key === 'registerCommand')
        return (name, command) => {
          commands.set(name, command)
          target.registerCommand(name, {
            ...command,
            handler: async (args, ctx) => {
              if (process.env.AURAPRO_PI_PLAN === '1') {
                ctx.ui.notify('Extension commands are unavailable in plan mode.', 'warning')
                return
              }
              await initialize(ctx)
              if (
                name === 'browser' &&
                !['status', ''].includes(args.trim()) &&
                !(await ctx.ui.confirm('PI · browser', args))
              )
                return
              return command.handler(args, ctx)
            }
          })
        }
      if (key === 'on')
        return (event, callback) => {
          if (event === 'session_start') {
            startup.push(callback)
            return () => {}
          }
          return target.on(event, callback)
        }
      return target[key]
    }
  })
  for (const [id, factory] of factories) {
    try {
      await factory(adapter)
    } catch (error) {
      pi.on('session_start', (_event, ctx) =>
        ctx.ui.notify(`Failed to load ${id}: ${error.message}`, 'error')
      )
    }
  }
  const initialize = async (ctx) => {
    if (initialized) return
    initialized = true
    for (const callback of startup) await callback({ type: 'session_start' }, ctx)
  }
  pi.on('before_agent_start', async (_event, ctx) => {
    if (!initialized) {
      await initialize(ctx)
      if (process.env.AURAPRO_PI_PLAN !== '1' && commands.has('browser'))
        await commands.get('browser').handler('connect 9222', ctx)
    }
  })
  pi.registerCommand('aurapro-check', {
    description: 'Run a read-only extension check without asking a model',
    handler: async (args, ctx) => {
      await initialize(ctx)
      const name = args.trim()
      const permitted = ['find_roots', 'browser_tabs']
      const tool = tools.get(name)
      let result
      if (!permitted.includes(name) || !tool) {
        result = { available: false, error: 'Extension tool is not loaded.' }
      } else {
        try {
          if (name === 'browser_tabs') await commands.get('browser')?.handler('connect 9222', ctx)
          const signal = AbortSignal.timeout(15000)
          const response = await tool.execute(
            'aurapro-probe',
            name === 'browser_tabs' ? { action: 'list' } : {},
            signal,
            undefined,
            ctx
          )
          result = {
            available: !response.isError,
            tool: name,
            detail: response.content
              ?.filter((item) => item.type === 'text')
              .map((item) => item.text)
              .join('\n')
              .slice(0, 2000)
          }
        } catch (error) {
          result = { available: false, tool: name, error: error.message }
        }
      }
      ctx.ui.notify(JSON.stringify({ auraproProbe: true, ...result }), 'info')
    }
  })
  pi.on('session_start', (_event, ctx) => {
    if (process.env.AURAPRO_PI_PLAN !== '1')
      pi.setActiveTools([...new Set([...pi.getActiveTools(), ...tools.keys()])])
    ctx.ui.notify(
      JSON.stringify({
        auraproDiagnostics: true,
        tools: pi.getAllTools().map((tool) => tool.name),
        commands: pi.getCommands().map((command) => command.name)
      }),
      'info'
    )
  })
  pi.on('tool_call', async (event, ctx) => {
    const tool = pi.getAllTools().find((item) => item.name === event.toolName)
    const readOnly = ['read', 'grep', 'find', 'ls'].includes(event.toolName)
    if (process.env.AURAPRO_PI_PLAN === '1' && !readOnly) {
      return { block: true, reason: 'Plan mode only permits reading the workspace.' }
    }
    if (
      ['read', 'write', 'edit', 'grep', 'find', 'ls'].includes(event.toolName) &&
      event.input?.path
    ) {
      const target = path.resolve(ctx.cwd, event.input.path)
      const nearest = (value) => {
        if (fs.existsSync(value)) return fs.realpathSync(value)
        const parent = path.dirname(value)
        return parent === value ? value : path.join(nearest(parent), path.basename(value))
      }
      const relative = path.relative(fs.realpathSync(ctx.cwd), nearest(target))
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        return { block: true, reason: 'File tools must stay inside the selected workspace.' }
      }
    }
    if (readOnly || tool?.annotations?.readOnlyHint === true) return
    const accepted = await ctx.ui.confirm(
      `PI · ${event.toolName}`,
      JSON.stringify(event.input ?? {}).slice(0, 6000)
    )
    if (!accepted) return { block: true, reason: 'The user declined this operation.' }
  })
}
