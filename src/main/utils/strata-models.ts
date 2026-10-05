export const STRATA_PORT = 18882
export const STRATA_MODEL_ID = 'aurapro-pro'
export const STRATA_SOURCE = '99f3dbd0b21d1401b3769e0c0d963913607f380b'

export const STRATA_MODELS = [
  {
    id: 'qwen-q2_0',
    family: 'qwen',
    quant: 'Q2_0',
    name: 'Qwen3.8-Flash-Next Q2_0',
    gb: 66.4,
    ram: 48
  },
  {
    id: 'qwen-iq2_xs',
    family: 'qwen',
    quant: 'IQ2_XS',
    name: 'Qwen3.8-Flash-Next IQ2_XS',
    gb: 68,
    ram: 48
  },
  {
    id: 'qwen-iq3_xxs',
    family: 'qwen',
    quant: 'IQ3_XXS',
    name: 'Qwen3.8-Flash-Next IQ3_XXS',
    gb: 75.8,
    ram: 60
  },
  {
    id: 'qwen-iq3_s',
    family: 'qwen',
    quant: 'IQ3_S',
    name: 'Qwen3.8-Flash-Next IQ3_S',
    gb: 83.6,
    ram: 62
  },
  {
    id: 'swift-iq2_xs',
    family: 'swift',
    quant: 'IQ2_XS',
    name: 'Swift 1.5 IQ2_XS',
    gb: 68,
    ram: 48
  },
  {
    id: 'swift-iq3_xxs',
    family: 'swift',
    quant: 'IQ3_XXS',
    name: 'Swift 1.5 IQ3_XXS',
    gb: 75.8,
    ram: 60
  },
  {
    id: 'coder-iq1_m',
    family: 'coder',
    quant: 'IQ1_M',
    name: 'Qwen3.8-Flash-Next Coder IQ1_M',
    gb: 58.4,
    ram: 32
  },
  {
    id: 'unsloth-ud-q4_k_xl',
    family: 'unsloth',
    quant: 'UD-Q4_K_XL',
    name: 'Qwen3.8-Flash-Next UD-Q4_K_XL',
    gb: 111.3,
    ram: 48
  }
] as const

export type StrataSettings = {
  model: string
  backend: 'auto' | 'cuda' | 'hip'
  context: number
  kv: 'int8' | 'q4_0' | 'k8v4'
  vision: boolean
}

export function strataHardwareRecommendation(model: (typeof STRATA_MODELS)[number]): string {
  const ram = model.family === 'unsloth' || model.ram > 48 ? 64 : model.ram
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
  model: 'qwen-iq2_xs',
  backend: 'auto',
  context: 32768,
  kv: 'int8',
  vision: false
}

export function validateStrataSettings(input: StrataSettings): StrataSettings {
  if (!input || !STRATA_MODELS.some((model) => model.id === input.model)) {
    throw new Error('Unknown Pro model')
  }
  if (!['auto', 'cuda', 'hip'].includes(input.backend)) throw new Error('Invalid Pro backend')
  if (!Number.isInteger(input.context) || input.context < 2048 || input.context > 262144) {
    throw new Error('Pro context must be an integer between 2048 and 262144')
  }
  if (!['int8', 'q4_0', 'k8v4'].includes(input.kv)) throw new Error('Invalid Pro KV precision')
  if (typeof input.vision !== 'boolean') throw new Error('Invalid Pro vision setting')
  if (input.model.startsWith('unsloth-') && (input.vision || input.backend === 'hip')) {
    throw new Error('Experimental Unsloth Q4 requires CUDA with vision disabled')
  }
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
  const model = STRATA_MODELS.find((candidate) => candidate.id === valid.model)!
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
    '--kv',
    valid.kv,
    '--vision',
    valid.vision ? 'gpu' : 'no',
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

export function strataConfigName(modelId: string): string {
  const model = STRATA_MODELS.find((candidate) => candidate.id === modelId)
  if (!model) throw new Error('Unknown Pro model')
  return `strata-${model.family === 'qwen' ? '' : `${model.family}-`}${model.quant.toLowerCase()}.json`
}
