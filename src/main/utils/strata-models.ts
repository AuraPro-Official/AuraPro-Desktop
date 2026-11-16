import nativeCatalog from './strata-model-catalog.json' with { type: 'json' }

export const STRATA_PORT = 18882
export const STRATA_MODEL_ID = 'aurapro-pro'
export const STRATA_SOURCE = 'c77572806996349b49995e4f98d41b5294d36a21'
export const STRATA_RELEASE = 'v0.2.15'

// Compatibility only: never replace a saved model ID with the new default.
export const LEGACY_STRATA_MODELS = [
  {
    id: 'qwen-q2_0',
    family: 'qwen',
    quant: 'Q2_0',
    name: 'Qwen3.8-Flash-Next GSQ-RCO Q2_0',
    gb: 66.4,
    ram: 48
  },
  {
    id: 'qwen-iq2_xs',
    family: 'qwen',
    quant: 'IQ2_XS',
    name: 'Qwen3.8-Flash-Next GSQ-RCO IQ2_XS',
    gb: 68,
    ram: 48
  },
  {
    id: 'qwen-iq3_xxs',
    family: 'qwen',
    quant: 'IQ3_XXS',
    name: 'Qwen3.8-Flash-Next GSQ-RCO IQ3_XXS',
    gb: 75.8,
    ram: 60
  },
  {
    id: 'qwen-iq3_s',
    family: 'qwen',
    quant: 'IQ3_S',
    name: 'Qwen3.8-Flash-Next GSQ-RCO IQ3_S',
    gb: 83.6,
    ram: 62
  },
  {
    id: 'swift-iq2_xs',
    family: 'swift',
    quant: 'IQ2_XS',
    name: 'Swift 1.5 Qwen3.8-Flash-Next GSQ-RCO IQ2_XS',
    gb: 68,
    ram: 48
  },
  {
    id: 'swift-iq3_xxs',
    family: 'swift',
    quant: 'IQ3_XXS',
    name: 'Swift 1.5 Qwen3.8-Flash-Next GSQ-RCO IQ3_XXS',
    gb: 75.8,
    ram: 60
  },
  {
    id: 'coder-iq1_m',
    family: 'coder',
    quant: 'IQ1_M',
    name: 'Qwen3.8-Flash-Next GSQ-RCO Coder IQ1_M',
    gb: 58.4,
    ram: 32
  },
  {
    id: 'unsloth-ud-q4_k_xl',
    family: 'unsloth',
    quant: 'UD-Q4_K_XL',
    name: 'Unsloth Qwen3.8-Flash-Next UD-Q4_K_XL',
    gb: 111.3,
    ram: 48
  }
] as const

export const STRATA_MODELS = [
  {
    id: 'unsloth-ud-iq1_m',
    family: 'unsloth',
    quant: 'UD-IQ1_M',
    name: 'Unsloth Qwen3.8-Flash-Next UD-IQ1_M',
    gb: 68,
    ram: 48
  },
  {
    id: 'unsloth-ud-q2_0',
    family: 'unsloth',
    quant: 'UD-Q2_0',
    name: 'Unsloth Qwen3.8-Flash-Next UD-Q2_0',
    gb: 70.5,
    ram: 48
  },
  {
    id: 'unsloth-ud-iq2_xs',
    family: 'unsloth',
    quant: 'UD-IQ2_XS',
    name: 'Unsloth Qwen3.8-Flash-Next UD-IQ2_XS',
    gb: 75.8,
    ram: 48
  },
  {
    id: 'unsloth-ud-q2_k_xl',
    family: 'unsloth',
    quant: 'UD-Q2_K_XL',
    name: 'Unsloth Qwen3.8-Flash-Next UD-Q2_K_XL',
    gb: 79.6,
    ram: 48
  },
  {
    id: 'unsloth-ud-iq3_xxs',
    family: 'unsloth',
    quant: 'UD-IQ3_XXS',
    name: 'Unsloth Qwen3.8-Flash-Next UD-IQ3_XXS',
    gb: 83.6,
    ram: 48
  },
  {
    id: 'unsloth-ud-q3_k_xl',
    family: 'unsloth',
    quant: 'UD-Q3_K_XL',
    name: 'Unsloth Qwen3.8-Flash-Next UD-Q3_K_XL',
    gb: 89.5,
    ram: 48
  },
  {
    id: 'unsloth-ud-iq4_xs-v31',
    family: 'unsloth',
    quant: 'UD-IQ4_XS-v31',
    name: 'Unsloth Qwen3.8-Flash-Next UD-IQ4_XS-v31',
    gb: 93.7,
    ram: 48
  },
  LEGACY_STRATA_MODELS[7],
  {
    id: 'qwen36-ud-q4_k_xl',
    family: 'qwen36',
    quant: 'UD-Q4_K_XL',
    name: 'Unsloth Qwen3.6-35B-A3B UD-Q4_K_XL',
    gb: 22.85,
    ram: 32
  },
  {
    id: 'qwen36-ud-q6_k_xl',
    family: 'qwen36',
    quant: 'UD-Q6_K_XL',
    name: 'Unsloth Qwen3.6-35B-A3B UD-Q6_K_XL',
    gb: 32.61,
    ram: 44
  },
  {
    id: 'qwen36-q8_0',
    family: 'qwen36',
    quant: 'Q8_0',
    name: 'Unsloth Qwen3.6-35B-A3B Q8_0',
    gb: 37.8,
    ram: 52
  }
] as const

export type StrataModel = (typeof STRATA_MODELS | typeof LEGACY_STRATA_MODELS)[number]

// Q4 is still selectable under its original ID and must occur only once in cleanup/lookups.
export const ALL_STRATA_MODELS: readonly StrataModel[] = [
  ...STRATA_MODELS,
  ...LEGACY_STRATA_MODELS.filter((legacy) => !STRATA_MODELS.some((model) => model.id === legacy.id))
]

export function getStrataModel(modelId: string): StrataModel | undefined {
  return ALL_STRATA_MODELS.find((model) => model.id === modelId)
}

export type StrataSettings = {
  model: string
  backend: 'auto' | 'cuda' | 'hip' | 'metal' | 'cpu'
  context: number
  kv: 'int8' | 'q4_0' | 'k8v4'
  vision: boolean
}

export function strataHardwareRecommendation(
  model: StrataModel,
  platform = process.platform
): string {
  // Recommend resident weights plus OS/cache headroom, not Strata's SSD-streaming minimum.
  // These are conservative single-session recommendations, not a fit guarantee at 256K context.
  const weightsGiB = (model.gb * 1e9) / 1024 ** 3
  const required = Math.max(model.ram, weightsGiB + Math.max(12, weightsGiB * 0.15))
  const ram =
    [32, 48, 64, 80, 96, 128, 192, 256].find((size) => size >= required) ??
    Math.ceil(required / 64) * 64
  if (platform === 'darwin') return `UMA ${ram}GB`
  return `RAM+VRAM ${ram}GB+12GB`
}

export function useProDiagnostics(
  active: 'standard' | 'pro' | null,
  preferred: 'standard' | 'pro' | undefined,
  standardInstalled: boolean,
  proInstalled: boolean
): boolean {
  if (active) return active === 'pro'
  return preferred === 'pro' || (!standardInstalled && proInstalled)
}

export const DEFAULT_STRATA_SETTINGS: StrataSettings = {
  model: 'qwen36-ud-q4_k_xl',
  backend: 'auto',
  context: 32768,
  kv: 'int8',
  vision: false
}

export function validateStrataSettings(input: StrataSettings): StrataSettings {
  if (!input || !getStrataModel(input.model)) {
    throw new Error('Unknown Pro model')
  }
  if (!['auto', 'cuda', 'hip', 'metal', 'cpu'].includes(input.backend))
    throw new Error('Invalid Pro backend')
  if (!Number.isInteger(input.context) || input.context < 2048 || input.context > 262144) {
    throw new Error('Pro context must be an integer between 2048 and 262144')
  }
  if (!['int8', 'q4_0', 'k8v4'].includes(input.kv)) throw new Error('Invalid Pro KV precision')
  if (typeof input.vision !== 'boolean') throw new Error('Invalid Pro vision setting')
  return {
    model: input.model,
    backend: input.backend,
    context: input.context,
    kv: input.kv,
    vision: input.vision
  }
}

export function strataSetupArgs(settings: StrataSettings, dataDir: string): string[] {
  const valid = validateStrataSettings(settings)
  if (valid.backend === 'metal' || valid.backend === 'cpu')
    throw new Error('Strata requires CUDA or HIP')
  const model = getStrataModel(valid.model)!
  return [
    '--setup',
    '--no-start',
    '--yes',
    '--family',
    model.family,
    '--model',
    model.quant,
    '--context',
    String(valid.context),
    ...(model.family === 'qwen36' ? [] : ['--kv', valid.kv]),
    '--vision',
    valid.vision ? 'yes' : 'no',
    '--host',
    '127.0.0.1',
    '--port',
    String(STRATA_PORT),
    '--data-dir',
    dataDir,
    '--models-dir',
    `${dataDir}/models`,
    ...(valid.backend === 'auto' ? [] : ['--backend', valid.backend])
  ]
}

export type NativeProFileMetadata = { size: number; sha256: string }
export type NativeProProjector = NativeProFileMetadata & {
  repo: string
  revision: string
  file: string
}
export type NativeProManifest = {
  repo: string
  revision: string
  files: string[]
  fileMetadata: Record<string, NativeProFileMetadata>
  projector: string | null
  projectorSource: NativeProProjector | null
}

type NativeCatalogFamily = {
  repo: string
  revision: string
  projector: NativeProProjector
  models: Record<
    string,
    {
      revision?: string
      files: (NativeProFileMetadata & { path: string })[]
    }
  >
}

const nativeFamilies: Record<StrataModel['family'], NativeCatalogFamily> = nativeCatalog.families

export function nativeProFiles(modelId: string): NativeProManifest {
  const model = getStrataModel(modelId)
  if (!model) throw new Error('Unknown Pro model')
  const family = nativeFamilies[model.family]
  const entry = family.models[model.quant]
  return {
    repo: family.repo,
    revision: entry.revision ?? family.revision,
    files: entry.files.map((file) => file.path),
    fileMetadata: Object.fromEntries(
      entry.files.map(({ path, size, sha256 }) => [path, { size, sha256 }])
    ),
    projector: family.projector.file,
    // Unsloth Flash-Next uses ISTA's encoder, not the weights' repository/revision.
    projectorSource: { ...family.projector }
  }
}

export function nativeProArgs(
  settings: StrataSettings,
  model: string,
  projector?: string
): string[] {
  const valid = validateStrataSettings(settings)
  if (!['auto', 'metal', 'cpu'].includes(valid.backend))
    throw new Error('macOS Pro requires Metal or CPU')
  if (valid.vision && !projector) throw new Error('Prepare the Pro image projector first')
  return [
    '--model',
    model,
    '--alias',
    STRATA_MODEL_ID,
    '--host',
    '127.0.0.1',
    '--port',
    String(STRATA_PORT),
    '--ctx-size',
    String(valid.context),
    '--parallel',
    '1',
    '--jinja',
    '--chat-template-kwargs',
    '{"enable_thinking":false}',
    '--n-gpu-layers',
    valid.backend === 'cpu' ? '0' : '99',
    '--flash-attn',
    'auto',
    '--cache-type-k',
    valid.kv === 'q4_0' ? 'q4_0' : 'q8_0',
    '--cache-type-v',
    valid.kv === 'int8' ? 'q8_0' : 'q4_0',
    ...(valid.vision ? ['--mmproj', projector!] : [])
  ]
}

export function strataConfigName(modelId: string): string {
  const model = getStrataModel(modelId)
  if (!model) throw new Error('Unknown Pro model')
  return `strata-${model.family === 'qwen' ? '' : `${model.family}-`}${model.quant.toLowerCase()}.json`
}
