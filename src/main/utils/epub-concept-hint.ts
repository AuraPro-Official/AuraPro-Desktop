/**
 * Model-hint resolution for the EPUB concept runtime descriptor.
 *
 * The concept resolver borrows whatever model llama.cpp is already serving, so
 * the descriptor's model field is a hint rather than a selection: the consumer
 * confirms the real id against the server's own model listing.
 *
 * This module imports nothing so a plain node:test suite can load it through
 * Node's type stripping, the same way llamacpp-release.ts is tested.  Reading
 * files and logging therefore stay with the caller: the preset parser takes
 * text that has already been read, and the resolver takes a reader function.
 */

/** Reads a models preset, returning null when it cannot be read. */
export type ModelsPresetReader = (presetPath: string) => string | null

/**
 * Value of the last occurrence of any of `names`, accepting both the
 * `--name value` and `--name=value` spellings.  llama.cpp honours the last
 * occurrence, so the scan runs backwards.
 */
export const readArgValue = (args: string[], names: string[]): string | null => {
  for (let i = args.length - 1; i >= 0; i--) {
    const arg = args[i]
    for (const name of names) {
      if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1) || null
      if (arg !== name) continue
      const value = args[i + 1]
      return value !== undefined && !value.startsWith('-') ? value : null
    }
  }
  return null
}

/**
 * First model id declared by a models preset, ignoring the `[*]` defaults.
 * `]` inside a section name is backslash-escaped, matching how the generated
 * preset writes it.
 */
export const parseFirstPresetModelId = (presetContents: string): string | null => {
  for (const rawLine of presetContents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line.startsWith('[') || !line.endsWith(']')) continue
    const section = line.slice(1, -1).replace(/\\]/g, ']')
    if (!section || section === '*') continue
    return section
  }
  return null
}

/**
 * Model id a `--model` path would be served under: its basename without the
 * `.gguf` suffix, matching how the generated preset names its sections.
 * Separators are normalised first so a Windows path is split on any host.
 */
const modelIdFromPath = (modelPath: string): string | null => {
  const basename = modelPath.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() ?? ''
  return basename.replace(/\.gguf$/i, '') || null
}

/**
 * Best-effort model id for the EPUB concept runtime descriptor.
 *
 * A model the deployer named themselves is a better hint than anything Desktop
 * derives, so explicit configuration wins; `--alias` outranks the rest because
 * it is literally the id llama-server then reports.  Returns null when nothing
 * resolvable is configured, which the caller treats as "write no descriptor"
 * rather than writing an empty model field.
 */
export const resolveEpubConceptModelHint = (
  extraArgs: string[],
  generatedPresetModelIds: string[],
  readModelsPreset: ModelsPresetReader
): string | null => {
  const alias = readArgValue(extraArgs, ['--alias', '-a'])
  if (alias) return alias

  const explicitModelPath = readArgValue(extraArgs, ['--model', '-m'])
  if (explicitModelPath) return modelIdFromPath(explicitModelPath)

  const explicitPresetPath = readArgValue(extraArgs, ['--models-preset'])
  if (explicitPresetPath) {
    const contents = readModelsPreset(explicitPresetPath)
    return contents === null ? null : parseFirstPresetModelId(contents)
  }

  return generatedPresetModelIds[0] ?? null
}
