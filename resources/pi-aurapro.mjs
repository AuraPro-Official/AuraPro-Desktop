import path from 'node:path'
import fs from 'node:fs'

export function routineAction(name, input, targets = new Map()) {
  if (name === 'browser_navigate') {
    try {
      const url = new URL(input.url)
      return (
        ['http:', 'https:'].includes(url.protocol) &&
        !url.search &&
        !/delete|remove|send|submit|pay|purchase|upload|install|logout|confirm/i.test(url.pathname)
      )
    } catch {
      return false
    }
  }
  if (name !== 'act_ui') return false
  const dangerous =
    /delete|remove|send|submit|pay|purchase|upload|install|format|reset|confirm|删除|移除|发送|提交|付款|支付|上传|安装|格式化|清空|确认/i
  return (
    Array.isArray(input.actions) &&
    input.actions.length > 0 &&
    input.actions.every((action) => {
      const node = targets.get(action.ref)
      const label = node ? `${node.title || ''} ${node.value || ''} ${node.description || ''}` : ''
      if (dangerous.test(label)) return false
      if (action.action === 'scroll' || action.action === 'moveMouse') return true
      if (action.action === 'click' && action.button === 'right') return !!node
      if (action.action === 'keypress') {
        const keys = (action.keys || []).map((key) => key.toUpperCase()).join('+')
        return /^(WIN\+E|CTRL\+L|SHIFT\+F10|ESCAPE|ESC|TAB|ARROW(LEFT|RIGHT|UP|DOWN)|PAGEUP|PAGEDOWN)$/.test(
          keys
        )
      }
      if (action.action === 'typeText' || action.action === 'setText')
        return (
          !!node && /address|地址/i.test(label) && /^[a-z]:[\\/][^\r\n]*$/i.test(action.text || '')
        )
      if (action.action === 'click' || action.action === 'press')
        return (
          !!node &&
          /folder|file explorer|inbox|邮件|收件箱|文件夹|文件资源管理器|本地磁盘|此电脑|主文件夹|返回|前进|[a-z]:\\/i.test(
            label
          )
        )
      return false
    })
  )
}

// This extension runs in Pi; every dialog is forwarded over RPC to WebUI.
export default async function (pi, factories = []) {
  const locale = process.env.AURAPRO_PI_LANGUAGE || 'zh-CN'
  const chinese = /^zh\b/i.test(locale)
  const text = (zh, en) => (chinese ? zh : en)
  if (process.env.AURAPRO_WEBUI_MODEL) {
    const model = JSON.parse(process.env.AURAPRO_WEBUI_MODEL)
    pi.registerProvider('aurapro-webui', {
      baseUrl: model.baseUrl,
      apiKey: model.apiKey,
      api: 'openai-completions',
      models: [
        {
          id: model.id,
          name: model.id,
          reasoning: false,
          input: ['text', 'image'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: model.contextWindow ?? 32768,
          maxTokens: model.maxTokens ?? 8192
        }
      ]
    })
  }
  const tools = new Map()
  const commands = new Map()
  const startup = []
  let initialized = false
  let browserAttempted = false
  let desktopTask = false
  let desktopObservation = null
  let taskApproved = false
  const approvalTargets = new Map()
  const adapter = new Proxy(pi, {
    get(target, key) {
      if (key === 'registerTool')
        return (tool) => {
          tools.set(tool.name, tool)
          target.registerTool({
            ...tool,
            execute: async (...args) => {
              const ctx = args[4]
              await initialize(ctx)
              if (
                tool.name === 'act_ui' &&
                desktopObservation &&
                args[1].stateId === desktopObservation.stateId
              ) {
                args[1] = {
                  ...args[1],
                  actions: args[1].actions.map((action) =>
                    action.action === 'keypress' && !action.ref
                      ? { ...action, ref: desktopObservation.ref }
                      : action
                  )
                }
              }
              if (tool.name.startsWith('browser_') && !browserAttempted) {
                browserAttempted = true
                await commands.get('browser')?.handler('connect 9222', ctx)
              }
              const result = await tool.execute(...args)
              if (
                tool.name === 'act_ui' &&
                result.isError &&
                result.content?.some(
                  (block) =>
                    block.type === 'text' && block.text.includes('Windows refused to foreground')
                )
              ) {
                result.content.push({
                  type: 'text',
                  text: 'Windows 未允许目标窗口切到前台，鼠标/键盘操作没有执行。请告知用户先点击目标资源管理器窗口，或检查是否有管理员权限窗口阻挡。不要宣称操作成功，也不要反复重试同一动作。'
                })
                ctx.ui.notify(
                  '电脑操作受阻：Windows 未允许目标窗口切到前台，操作没有执行。',
                  'warning'
                )
              }
              if (['observe_ui', 'act_ui'].includes(tool.name) && !result.isError) {
                approvalTargets.clear()
                const stateId = result.details?.capture?.stateId || result.details?.stateId
                const root = result.details?.target?.windowRef
                if (stateId && result.details?.outline?.root?.ref)
                  desktopObservation = { stateId, ref: result.details.outline.root.ref }
                const menus = []
                const collect = (node) => {
                  if (!node) return
                  approvalTargets.set(node.ref, node)
                  if (node.subrole === '#32768' || /menuitem/i.test(node.role || ''))
                    menus.push(`${node.ref} ${node.title || node.value || node.description || ''}`)
                  for (const child of node.children || []) collect(child)
                }
                collect(result.details?.outline?.root)
                result.content.push({
                  type: 'text',
                  text:
                    `Next act_ui must use stateId=${stateId} (a UUID, never an @r or @e ref). Current root=${root}. Refresh observation after each action before using refs again.` +
                    (menus.length
                      ? '\nMenu items are visible in this window:\n' + menus.slice(0, 40).join('\n')
                      : '')
                })
              }
              if (tool.name === 'act_ui' && !result.isError && tools.has('find_roots')) {
                // Windows root-delta refs may be native refs with the same @r prefix.
                // Publish a new, scoped root inventory before the model observes a menu.
                const pid = result.details?.target?.pid
                const fresh = await tools
                  .get('find_roots')
                  .execute(args[0] + '-roots', pid ? { pid } : {}, args[2], undefined, ctx)
                result.content = result.content.map((block) =>
                  block.type === 'text'
                    ? {
                        ...block,
                        text: block.text.replace(/^(New root:|Root focused:|Root closed:).*$/gm, '')
                      }
                    : block
                )
                result.content.push({
                  type: 'text',
                  text:
                    'Use only the fresh root refs below for the next observe_ui. Previous @e refs require the returned stateId.\n' +
                    fresh.content
                      .filter((block) => block.type === 'text')
                      .map((block) => block.text)
                      .join('\n')
                })
              }
              return result
            }
          })
        }
      if (key === 'registerCommand')
        return (name, command) => {
          commands.set(name, command)
          target.registerCommand(name, {
            ...command,
            handler: async (args, ctx) => {
              try {
                if (process.env.AURAPRO_PI_PLAN === '1') {
                  ctx.ui.notify(
                    text(
                      '计划模式不可运行扩展命令。',
                      'Extension commands are unavailable in plan mode.'
                    ),
                    'warning'
                  )
                  return
                }
                await initialize(ctx)
                if (
                  name === 'browser' &&
                  !['status', ''].includes(args.trim()) &&
                  process.env.AURAPRO_PI_APPROVAL_MODE !== 'full' &&
                  !(await ctx.ui.confirm('PI · browser', args))
                )
                  return
                return await command.handler(args, ctx)
              } catch (error) {
                ctx.ui.notify(
                  `PI · /${name}: ${error.message || 'Extension command failed.'}`,
                  'error'
                )
                throw error
              }
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
        ctx.ui.notify(
          `${text('扩展加载失败', 'Failed to load extension')} ${id}: ${error.message}`,
          'error'
        )
      )
    }
  }
  const initialize = async (ctx) => {
    if (initialized) return
    initialized = true
    for (const callback of startup) await callback({ type: 'session_start' }, ctx)
  }
  pi.registerTool({
    name: 'enable_extension_tools',
    label: 'Enable extension tools',
    description:
      'Enable browser or computer tools when the task needs web browsing or desktop control.',
    parameters: {
      type: 'object',
      properties: { extension: { type: 'string', enum: ['browser', 'computer'] } },
      required: ['extension']
    },
    execute: async (_id, input) => {
      const selected = [...tools.keys()].filter((name) =>
        input.extension === 'browser' ? name.startsWith('browser_') : !name.startsWith('browser_')
      )
      if (input.extension === 'computer') desktopTask = true
      pi.setActiveTools(
        [...new Set([...pi.getActiveTools(), ...selected])].filter(
          (name) => !desktopTask || name !== 'powershell'
        )
      )
      return {
        content: [
          {
            type: 'text',
            text: selected.length
              ? `${text('已启用工具', 'Enabled tools')}: ${selected.join(', ')}`
              : text('尚未安装此扩展。', 'This extension is not installed.')
          }
        ]
      }
    }
  })
  pi.on('before_agent_start', async (event, ctx) => {
    taskApproved = false
    approvalTargets.clear()
    if (!initialized) {
      await initialize(ctx)
    }
    if (process.env.AURAPRO_PI_PLAN !== '1') {
      const prompt = event.prompt || ''
      const browser = /browser|browse|website|网页|浏览器|上网|https?:\/\//i.test(prompt)
      const computer = /desktop|computer|电脑|桌面|右键|鼠标|打开.*盘|操作.*窗口/i.test(prompt)
      desktopTask = computer
      const extension = [...tools.keys()].filter((name) =>
        name.startsWith('browser_') ? browser : computer
      )
      const names = [
        'read',
        'write',
        'edit',
        ...(!computer ? ['powershell'] : []),
        'grep',
        'find',
        'ls',
        'enable_extension_tools',
        ...extension
      ]
      pi.setActiveTools(
        [...new Set(names)].filter((name) => pi.getAllTools().some((tool) => tool.name === name))
      )
      if (event.systemPromptOptions) event.systemPromptOptions.selectedTools = pi.getActiveTools()
    }
    const desktopInstructions = desktopTask
      ? '\nThis is a desktop UI task. Use find_roots to locate the intended window, observe_ui to read it, search_ui/inspect_ui to identify targets, and act_ui with stateId from the latest observation. Use keypress with keys ["WIN", "E"] to open File Explorer if needed, then focus its address bar with ["CTRL", "L"], type the path and press ["ENTER"]. For a context menu, use click with button:"right" on an observed target, or ["SHIFT", "F10"] on a focused target. Re-observe the resulting window/menu to verify success. Menus can appear as #32768 nodes inside the Explorer outline instead of separate roots. Expand those nodes to read menu items. A taskbar menu or an unverified generic menu is not success. stateId must be the UUID returned by observation, never an @r window ref or @e element ref. Do not use shell commands, PowerShell, scripts or fabricated element refs for GUI actions. Do not merely describe steps; perform and verify the authorized actions.'
      : ''
    return {
      systemPrompt:
        event.systemPrompt +
        desktopInstructions +
        `\nWebUI interface language: ${locale}. Use this language for all user-facing progress updates, operation explanations, visible reasoning summaries, questions and final answers. For zh-CN use Simplified Chinese; for zh-TW use Traditional Chinese. Summarize English tool errors and outcomes in the interface language. Preserve literal file paths, commands, identifiers and quoted source text. Follow an explicit user request for another output language when applicable.` +
        '\nComplete the authorized task in this turn, including implementation and verification. Do not pause after writing a scaffold or ask whether to continue routine implementation. For large generated files, write a small initial file and extend it with bounded edit calls. Keep each file tool call under roughly 120 lines. If a tool call is truncated, retry with smaller chunks. Never claim completion unless the requested tool operations succeeded.'
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
      pi.setActiveTools([...new Set([...pi.getActiveTools(), 'enable_extension_tools'])])
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
    if (desktopTask && event.toolName === 'powershell')
      return {
        block: true,
        reason:
          'Use the installed computer tools for this desktop task: find_roots, observe_ui, act_ui.'
      }
    const tool = pi.getAllTools().find((item) => item.name === event.toolName)
    const workspaceRead = ['read', 'grep', 'find', 'ls'].includes(event.toolName)
    const readOnly =
      workspaceRead ||
      [
        'enable_extension_tools',
        'find_roots',
        'observe_ui',
        'search_ui',
        'expand_ui',
        'inspect_ui',
        'read_text',
        'wait_for',
        'browser_snapshot',
        'browser_take_screenshot'
      ].includes(event.toolName)
    if (process.env.AURAPRO_PI_PLAN === '1' && !workspaceRead) {
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
    if (process.env.AURAPRO_PI_APPROVAL_MODE === 'full') return
    if (readOnly || tool?.annotations?.readOnlyHint === true) return
    if (process.env.AURAPRO_PI_APPROVAL_MODE === 'task' && taskApproved) return
    const accepted = await ctx.ui.confirm(
      `PI · ${text({ read: '读取文件', write: '写入文件', edit: '编辑文件', powershell: '运行命令', act_ui: '操作电脑', browser_navigate: '打开网页', browser_click: '点击网页', browser_type: '输入网页内容' }[event.toolName] || event.toolName, event.toolName)}`,
      JSON.stringify(event.input ?? {}).slice(0, 6000)
    )
    if (!accepted) return { block: true, reason: 'The user declined this operation.' }
    if (process.env.AURAPRO_PI_APPROVAL_MODE === 'task') taskApproved = true
  })
  pi.on('agent_settled', () => {
    taskApproved = false
    approvalTargets.clear()
  })
}
