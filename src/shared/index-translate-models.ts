export interface ModelFile {
  repo: string
  filename: string
  expectedSize: number
}

export interface IndexTranslateModel {
  name: string
  sizeStr: string
  partialSuffix: string
  current: ModelFile
  projector: ModelFile
  previous?: { expectedSize: number; projector: ModelFile }
}

const file = (family: string, variant: string, expectedSize: number): ModelFile => ({
  repo: `IndexTeam/${family}-GGUF`,
  filename: `${family}${variant}.gguf`,
  expectedSize
})

const omni9bProjector = file('Index-Translate-omni-9B', '.mmproj-Q8_0', 620_690_272)

export const INDEX_TRANSLATE_MODELS = {
  lowest: {
    name: 'lowest_V2.gguf',
    sizeStr: '~1.97GB',
    partialSuffix: '.omni-2b.tmp',
    current: file('Index-Translate-omni-2B', '.Q6_K', 1_973_568_256),
    projector: file('Index-Translate-omni-2B', '.mmproj-Q8_0', 361_518_144),
    previous: {
      expectedSize: 2_076_674_560,
      projector: file('Index-Translate-2B', '.mmproj-Q8_0', 361_518_144)
    }
  },
  mediumQ3: {
    name: 'medium_Q3_V2.gguf',
    sizeStr: '~4.62GB',
    partialSuffix: '.omni-9b-q3.tmp',
    current: file('Index-Translate-omni-9B', '.Q3_K_M', 4_623_524_512),
    projector: omni9bProjector
  },
  medium: {
    name: 'medium_Q4_V2.gguf',
    sizeStr: '~5.35GB',
    partialSuffix: '.omni-9b.tmp',
    current: file('Index-Translate-omni-9B', '.Q4_K_S', 5_351_629_472),
    projector: omni9bProjector,
    previous: {
      expectedSize: 5_780_090_304,
      projector: file('Index-Translate-9B', '.mmproj-Q8_0', 620_690_272)
    }
  },
  mediumQ6: {
    name: 'medium_Q6_V2.gguf',
    sizeStr: '~8G',
    partialSuffix: '.omni-9b-q6.tmp',
    current: file('Index-Translate-omni-9B', '.Q6_K', 7_359_259_296),
    projector: omni9bProjector
  },
  high: {
    name: 'high_Q4_2.gguf',
    sizeStr: '~21.17GB',
    partialSuffix: '.omni-35b.tmp',
    current: file('Index-Translate-omni-35B', '.Q4_K_M', 21_166_757_824),
    projector: file('Index-Translate-omni-35B', '.mmproj-Q8_0', 610_655_072),
    previous: {
      expectedSize: 21_713_462_400,
      projector: file('Index-Translate-35B-A3B-preview', '.mmproj-Q8_0', 610_655_072)
    }
  }
} satisfies Record<string, IndexTranslateModel>

export const indexTranslateCatalogEntry = (model: IndexTranslateModel) => ({
  name: model.name,
  repo: 'AuraPro',
  sizeStr: model.sizeStr,
  hfRepo: model.current.repo,
  filename: model.current.filename,
  sizeBytes: model.current.expectedSize,
  mmprojRepo: model.projector.repo,
  mmprojFilename: model.projector.filename
})

export const LOW_E4_DOWNLOAD = {
  name: 'low_E4.gguf',
  sizeStr: '~5GB',
  repo: 'AuraPro',
  hfRepo: 'unsloth/gemma-4-E4B-it-qat-GGUF',
  filename: 'gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf',
  mmprojRepo: 'unsloth/gemma-4-E4B-it-qat-GGUF',
  mmprojFilename: 'mmproj-F16.gguf',
  mtpRepo: 'unsloth/gemma-4-E4B-it-qat-GGUF',
  mtpFilename: 'mtp-gemma-4-E4B-it.gguf',
  sizeBytes: 5 * 1024 ** 3
}

export const HIGH_Q4_DOWNLOAD = {
  name: 'high_Q4.gguf',
  sizeStr: '~15GB',
  repo: 'AuraPro',
  hfRepo: 'unsloth/gemma-4-26B-A4B-it-qat-GGUF',
  filename: 'gemma-4-26B-A4B-it-qat-UD-Q4_K_XL.gguf',
  mmprojRepo: 'unsloth/gemma-4-26B-A4B-it-qat-GGUF',
  mmprojFilename: 'mmproj-F16.gguf',
  mtpRepo: 'unsloth/gemma-4-26B-A4B-it-qat-GGUF',
  mtpFilename: 'mtp-gemma-4-26B-A4B-it.gguf',
  sizeBytes: 15 * 1024 ** 3
}

export type UpgradeAsset = { repo: string; filename: string; expectedSize?: number }
export type UpgradeTarget = {
  name: string
  current: UpgradeAsset
  projector: UpgradeAsset
  draft?: UpgradeAsset
}

const standardUpgradeTarget = (model: typeof HIGH_Q4_DOWNLOAD): UpgradeTarget => ({
  name: model.name,
  current: { repo: model.hfRepo, filename: model.filename },
  projector: { repo: model.mmprojRepo, filename: model.mmprojFilename },
  draft: { repo: model.mtpRepo, filename: model.mtpFilename }
})

type InstalledModel = {
  repo: string
  filename: string
  size: number
  sourceRepo?: string
  sourceFilename?: string
}

const knownGemmaRevisions = [LOW_E4_DOWNLOAD, HIGH_Q4_DOWNLOAD].map(standardUpgradeTarget)

const retiredModels: Record<string, 'lowest' | 'medium' | 'high' | 'pro' | 'low_E4'> = {
  'lowest.gguf': 'lowest',
  'medium_q4.gguf': 'medium',
  'low_eq4_mac_8g.gguf': 'low_E4',
  'high_iq4.gguf': 'high',
  'high_q5.gguf': 'high',
  'high-code_iq4.gguf': 'pro',
  'high-code_q4.gguf': 'pro'
}

export function localModelUpgradeNotice(
  models: InstalledModel[],
  hasProReplacement = false
):
  | (
      | { from: string; to: string; kind: 'pro' }
      | {
          from: string
          fromRepo: string
          to: string
          kind: 'replacement' | 'revision'
          target: UpgradeTarget
        }
    )
  | null {
  for (const { name, current, previous, projector } of Object.values(
    INDEX_TRANSLATE_MODELS
  ) as IndexTranslateModel[]) {
    if (!previous) continue
    if (models.some((model) => model.filename === name && model.size === current.expectedSize))
      continue
    const existing = models.find(
      (model) => model.filename === name && model.size === previous.expectedSize
    )
    if (!existing) continue
    return {
      from: name,
      fromRepo: existing.repo,
      to: name,
      kind: 'revision',
      target: { name, current, projector }
    }
  }

  for (const target of knownGemmaRevisions) {
    const previousRepo = target.current.repo.replace('-qat-GGUF', '-GGUF')
    const previousName = target.current.filename.replace('-qat-', '-')
    const existing = models.find(
      (model) => model.filename === target.name && model.repo === target.name.slice(0, -5)
    )
    if (existing?.sourceRepo === previousRepo && existing.sourceFilename === previousName) {
      return {
        from: target.name,
        fromRepo: existing.repo,
        to: target.name,
        kind: 'revision',
        target
      }
    }
  }

  for (const model of models) {
    const key = retiredModels[model.filename.toLowerCase()]
    if (!key) continue
    if (key === 'pro') {
      if (!hasProReplacement) return { from: model.filename, to: 'Pro', kind: 'pro' } as const
      continue
    }
    if (key === 'low_E4' || key === 'high') {
      const target = standardUpgradeTarget(key === 'high' ? HIGH_Q4_DOWNLOAD : LOW_E4_DOWNLOAD)
      if (!models.some(({ filename }) => filename.toLowerCase() === target.name.toLowerCase())) {
        return {
          from: model.filename,
          fromRepo: model.repo,
          to: target.name,
          kind: 'replacement',
          target
        }
      }
      continue
    }
    const target = INDEX_TRANSLATE_MODELS[key]
    if (
      !models.some(
        ({ filename, size }) => filename === target.name && size === target.current.expectedSize
      )
    ) {
      return {
        from: model.filename,
        fromRepo: model.repo,
        to: target.name,
        kind: 'replacement',
        target
      }
    }
  }
  return null
}
