export type ModelPreference = 'quality' | 'balanced'

export interface InstallHardware {
  platform: string
  architecture: string
  memoryGiB: number
  vramGiB: number
  preference: ModelPreference
}

type PcMinimum = readonly [ramGiB: number, vramGiB: number]
type ProGuide = {
  sizeGiB: number
  mac: Partial<Record<ModelPreference, number>>
  pc: Partial<Record<ModelPreference, readonly PcMinimum[]>>
  // Existing resident-memory estimate for manual selection when no tier supplies a number.
  macEstimateGiB?: number
}

// Highest model first when more than one Pro row matches the selected preference.
export const PRO_MODEL_GUIDE = {
  Q4_K_XL: { sizeGiB: 104, mac: { quality: 128 }, pc: {} },
  IQ4_XS: { sizeGiB: 88, mac: { quality: 96, balanced: 128 }, pc: { quality: [[96, 16]] } },
  Q3_K_XL: { sizeGiB: 84, mac: { balanced: 96 }, pc: { quality: [[96, 12]] } },
  IQ3_XXS: {
    sizeGiB: 79,
    mac: {},
    pc: { quality: [[64, 16]], balanced: [[96, 16]] },
    macEstimateGiB: 96
  },
  Q2_K_XL: {
    sizeGiB: 75,
    mac: {},
    pc: {
      quality: [[64, 12]],
      balanced: [
        [64, 16],
        [96, 12]
      ]
    },
    macEstimateGiB: 96
  },
  IQ2_XS: {
    sizeGiB: 72,
    mac: {},
    pc: { quality: [[64, 8]], balanced: [[64, 12]] },
    macEstimateGiB: 96
  },
  Q2_0: {
    sizeGiB: 66,
    mac: {},
    pc: {
      quality: [[48, 12]],
      balanced: [
        [64, 8],
        [48, 12]
      ]
    },
    macEstimateGiB: 80
  }
} as const satisfies Record<string, ProGuide>

export function proGuide(name: string): ProGuide | undefined {
  return Object.hasOwn(PRO_MODEL_GUIDE, name)
    ? PRO_MODEL_GUIDE[name as keyof typeof PRO_MODEL_GUIDE]
    : undefined
}

export function recommendProInstallModel(hardware: InstallHardware, available: readonly string[]) {
  const { platform, architecture, memoryGiB, vramGiB, preference } = hardware
  const mac = platform === 'darwin' && architecture === 'arm64'
  const pc = (platform === 'win32' || platform === 'linux') && architecture === 'x64'
  if (!mac && !pc) return null

  return (
    Object.keys(PRO_MODEL_GUIDE).find((name) => {
      if (!available.includes(name)) return false
      const guide = proGuide(name)!
      if (mac) return memoryGiB >= (guide.mac[preference] ?? Infinity)
      return guide.pc[preference]?.some(([ram, vram]) => memoryGiB >= ram && vramGiB >= vram)
    }) ?? null
  )
}

export const STANDARD_MODEL_GUIDE = {
  lowest_V2: { sizeGiB: 2 },
  low_E4: { sizeGiB: 4.5 },
  medium_Q3_V2: { sizeGiB: 5 },
  medium_Q4_V2: { sizeGiB: 6 },
  medium_IQ2: { sizeGiB: 11 },
  high_Q4: { sizeGiB: 15 },
  high_Q4_2: { sizeGiB: 21 }
} as const

export type StandardModel = keyof typeof STANDARD_MODEL_GUIDE

export function standardGuide(name: string) {
  return STANDARD_MODEL_GUIDE[name.replace(/\.gguf$/, '') as StandardModel]
}

const standardRequirements: Record<StandardModel, readonly [pc: string, mac: string]> = {
  lowest_V2: ['RAM 8G', 'UMA 8G'],
  low_E4: ['RAM 16G', 'UMA 8G'],
  medium_Q3_V2: ['VRAM 6G', 'UMA 8G'],
  medium_Q4_V2: ['VRAM 8G', 'UMA 16G'],
  medium_IQ2: ['RAM+VRAM 24G+4G', 'UMA 18G'],
  high_Q4: ['RAM 48G or RAM+VRAM 32G+4G', 'UMA 24G'],
  high_Q4_2: ['RAM 64G or RAM+VRAM 48G+4G', 'UMA 32G']
}

export function standardRequirementLabel(name: string) {
  return standardRequirements[name.replace(/\.gguf$/, '') as StandardModel].join(' / ')
}

export function proHardwareLabel(name: string, platform: string, preference?: ModelPreference) {
  const guide = proGuide(name)
  if (!guide) return undefined
  const label = (mode: ModelPreference) => {
    if (platform === 'darwin') {
      const minimum = guide.mac[mode]
      if (!minimum) return '—'
      const next = Math.min(
        ...Object.keys(PRO_MODEL_GUIDE)
          .map((model) => proGuide(model)?.mac[mode] ?? Infinity)
          .filter((limit) => limit > minimum)
      )
      return Number.isFinite(next) ? `UMA ${minimum}–<${next}G` : `UMA ≥${minimum}G`
    }
    return guide.pc[mode]?.map(([ram, vram]) => `RAM ≥${ram}G + VRAM ≥${vram}G`).join(' / ') ?? '—'
  }
  return preference
    ? label(preference)
    : `Quality: ${label('quality')} · Balanced: ${label('balanced')}`
}

// Display requirements may borrow from a lower model; they are not setup eligibility rules.
export function proRequirementLabel(name: string, platform?: string) {
  const guide = proGuide(name)
  if (!guide) return undefined
  const names = Object.keys(PRO_MODEL_GUIDE)
  const tier = names.slice(names.indexOf(name)).map((model) => proGuide(model)!)
  const macMinimum =
    tier.find(({ mac }) => mac.quality !== undefined)?.mac.quality ?? guide.mac.balanced
  const macLabel =
    macMinimum !== undefined
      ? `UMA ${macMinimum}G`
      : guide.macEstimateGiB !== undefined
        ? `UMA ~${guide.macEstimateGiB}G`
        : undefined
  const pcLabel = tier
    .find(({ pc }) => pc.quality?.length)
    ?.pc.quality?.map(([ram, vram]) => `RAM+VRAM ${ram}G+${vram}G`)
    .join(' or ')
  if (platform) return platform === 'darwin' ? macLabel : pcLabel
  return [pcLabel, macLabel].filter(Boolean).join(' / ')
}

export const PC_MODEL_PRIORITY: readonly StandardModel[] = [
  'high_Q4_2',
  'medium_Q4_V2',
  'high_Q4',
  'medium_Q3_V2',
  'medium_IQ2',
  'low_E4',
  'lowest_V2'
]

export function recommendStandardModel(hardware: InstallHardware): StandardModel {
  const { platform, architecture, memoryGiB: ram, vramGiB: vram, preference } = hardware
  const quality = preference === 'quality'
  if (platform === 'darwin') {
    const lowerTier = quality ? 'medium_Q3_V2' : 'low_E4'
    if (architecture !== 'arm64') return ram < 16 ? 'lowest_V2' : lowerTier
    if (ram >= 32) return 'high_Q4_2'
    if (ram >= 24) return 'high_Q4'
    if (ram >= 16) return 'medium_Q4_V2'
    return ram >= 8 ? lowerTier : 'lowest_V2'
  }

  const matches: Record<StandardModel, boolean> = {
    high_Q4_2: ram >= 64 || (ram >= 48 && vram >= 4),
    medium_Q4_V2: vram >= 8 && (quality || vram < 12),
    high_Q4: (quality ? ram >= 48 : vram >= 12) || (ram >= 32 && vram >= 4),
    medium_Q3_V2: quality && vram >= 6,
    medium_IQ2: ram >= 24 && vram >= 4,
    low_E4: ram >= 16 || (!quality && vram >= 6),
    lowest_V2: true
  }
  return PC_MODEL_PRIORITY.find((name) => matches[name]) ?? 'lowest_V2'
}
