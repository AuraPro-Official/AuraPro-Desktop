interface ModelFile {
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
