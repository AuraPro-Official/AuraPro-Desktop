import { readFileSync, statSync } from 'node:fs'

export type PiAgentHealth = 'disabled' | 'stopped' | 'ready-on-demand' | 'runtime-invalid'

const isFile = (value: unknown): boolean =>
  typeof value === 'string' && statSync(value, { throwIfNoEntry: false })?.isFile() === true

export const checkPiAgentHealth = (
  enabled: boolean,
  active: boolean,
  descriptorPath: string
): PiAgentHealth => {
  if (!enabled) return 'disabled'
  if (!active) return 'stopped'

  // Verify the handoff used by WebUI without starting an Agent session.
  try {
    const runtime = JSON.parse(readFileSync(descriptorPath, 'utf8'))
    if (
      runtime?.engine !== 'pi' ||
      runtime.version !== 2 ||
      runtime.ownerPid !== process.pid ||
      typeof runtime.piVersion !== 'string' ||
      !runtime.piVersion.trim() ||
      !isFile(runtime.executable) ||
      !isFile(runtime.extension) ||
      typeof runtime.agentDir !== 'string' ||
      !statSync(runtime.agentDir, { throwIfNoEntry: false })?.isDirectory() ||
      !Array.isArray(runtime.arguments) ||
      runtime.arguments.length > 1 ||
      (runtime.arguments.length === 1 && !isFile(runtime.arguments[0]))
    ) {
      return 'runtime-invalid'
    }
    return 'ready-on-demand'
  } catch {
    return 'runtime-invalid'
  }
}
