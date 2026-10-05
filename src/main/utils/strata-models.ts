export const STRATA_PORT = 18882
export const STRATA_MODEL_ID = 'aurapro-pro'
export const STRATA_SOURCE = '99f3dbd0b21d1401b3769e0c0d963913607f380b'

export const STRATA_MODELS = [
  {
    id: 'qwen-q2_0',
    family: 'qwen',
    quant: 'Q2_0',
    name: 'Q2',
    gb: 66.4,
    ram: 48
  },
  {
    id: 'qwen-iq2_xs',
    family: 'qwen',
    quant: 'IQ2_XS',
    name: 'IQ2_XS',
    gb: 68,
    ram: 48
  },
  {
    id: 'qwen-iq3_xxs',
    family: 'qwen',
    quant: 'IQ3_XXS',
    name: 'IQ3_XXS',
    gb: 75.8,
    ram: 60
  },
  {
    id: 'qwen-iq3_s',
    family: 'qwen',
    quant: 'IQ3_S',
    name: 'IQ3_S',
    gb: 83.6,
    ram: 62
  },
  {
    id: 'swift-iq2_xs',
    family: 'swift',
    quant: 'IQ2_XS',
    name: 'Swift IQ2_XS',
    gb: 68,
    ram: 48
  },
  {
    id: 'swift-iq3_xxs',
    family: 'swift',
    quant: 'IQ3_XXS',
    name: 'Swift IQ3_XXS',
    gb: 75.8,
    ram: 60
  },
  {
    id: 'coder-iq1_m',
    family: 'coder',
    quant: 'IQ1_M',
    name: 'Coder IQ1_M',
    gb: 58.4,
    ram: 32
  },
  {
    id: 'unsloth-ud-q4_k_xl',
    family: 'unsloth',
    quant: 'UD-Q4_K_XL',
    name: 'Q4',
    gb: 111.3,
    ram: 48
  }
] as const

export type StrataSettings = {
  model: string
  backend: 'auto' | 'cuda' | 'hip' | 'metal' | 'cpu'
  context: number
  kv: 'int8' | 'q4_0' | 'k8v4'
  vision: boolean
}

export function strataHardwareRecommendation(
  model: (typeof STRATA_MODELS)[number],
  platform = process.platform
): string {
  if (platform === 'darwin') return `UMA ${model.gb > 90 ? 128 : model.gb > 70 ? 96 : 80}GB`
  if (model.family === 'unsloth') return 'RAM+VRAM 64GB+16GB'
  if (model.family === 'coder') return 'RAM+VRAM 48GB+8GB / 32GB+12GB'
  if (model.quant === 'Q2_0' || model.quant === 'IQ2_XS') return 'RAM+VRAM 64GB+8GB / 48GB+12GB'
  const ram = model.ram > 48 ? 64 : model.ram
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
  if (!['auto', 'cuda', 'hip', 'metal', 'cpu'].includes(input.backend))
    throw new Error('Invalid Pro backend')
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
  if (valid.backend === 'metal' || valid.backend === 'cpu')
    throw new Error('Strata requires CUDA or HIP')
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

export function nativeProFiles(modelId: string) {
  const model = STRATA_MODELS.find((item) => item.id === modelId)
  if (!model) throw new Error('Unknown Pro model')
  const repos = {
    qwen: [
      'ISTA-DASLab/Qwen3.8-Flash-Next-GSQ-RCO-GGUF',
      'ed59f92082b1e93c0e96d60a8b11aab089b52f09'
    ],
    swift: [
      'ukisai/Swift-1.5-Qwen3.8-Flash-Next-GSQ-RCO-GGUF',
      'b22d729eae29b5796f76fb70f91aef549b9fc52c'
    ],
    coder: [
      'ISTA-DASLab/Qwen3.8-Flash-Next-GSQ-RCO-Coder-GGUF',
      '5348543e0147355ac9cbcb031184a3546350988e'
    ],
    unsloth: ['unsloth/Qwen3.8-Flash-Next-GGUF', '38bb39ee97821de2c9009abb7e93950eec396e66']
  }
  const [repo, revision] = repos[model.family]
  const prefix =
    model.family === 'swift'
      ? 'Swift-Qwen3.8-Flash-Next-GSQ-RCO'
      : model.family === 'unsloth'
        ? 'Qwen3.8-Flash-Next'
        : 'Qwen3.8-Flash-Next-GSQ-RCO'
  const count = model.family === 'unsloth' ? 4 : 2
  const files = Array.from(
    { length: count },
    (_, i) =>
      `${model.family === 'swift' ? '' : `${model.quant}/`}${prefix}-${model.quant}-0000${i + 1}-of-0000${count}.gguf`
  )
  return {
    repo,
    revision,
    files,
    projector:
      model.family === 'unsloth'
        ? null
        : `mmproj-${model.family === 'swift' ? 'Swift-' : ''}Qwen3.8-Flash-Next-BF16.gguf`
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
  const model = STRATA_MODELS.find((candidate) => candidate.id === modelId)
  if (!model) throw new Error('Unknown Pro model')
  return `strata-${model.family === 'qwen' ? '' : `${model.family}-`}${model.quant.toLowerCase()}.json`
}
