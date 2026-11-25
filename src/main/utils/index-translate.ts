import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  INDEX_TRANSLATE_MODELS,
  type IndexTranslateModel
} from '../../shared/index-translate-models'

export const getIndexTranslateModel = (filepath: string): IndexTranslateModel | undefined => {
  const name = path.basename(filepath).toLowerCase()
  return Object.values(INDEX_TRANSLATE_MODELS).find((model) => model.name.toLowerCase() === name)
}

export const getIndexTranslateProjector = (filepath: string) => {
  const model = getIndexTranslateModel(filepath)
  if (!model) return undefined
  try {
    const size = fs.statSync(filepath).size
    if (size === model.current.expectedSize) return model.projector
    if (size === model.previous?.expectedSize) return model.previous.projector
  } catch {
    // No complete main model to pair with yet.
  }
  return undefined
}

export const getIndexTranslateUpgrade = (filepath: string, repo: string, filename: string) => {
  const model = getIndexTranslateModel(filepath)
  return model?.current.repo === repo && model.current.filename === filename ? model : undefined
}

// A legacy partial for the same local alias must not be resumed as Omni.
export const indexTranslatePartialPath = (filepath: string): string =>
  `${filepath}${getIndexTranslateModel(filepath)?.partialSuffix ?? '.tmp'}`

export const indexTranslatePartialDestination = (partialPath: string): string | undefined => {
  const suffixStart = partialPath.lastIndexOf('.omni-')
  if (suffixStart < 0) return undefined
  const filepath = partialPath.slice(0, suffixStart)
  const model = getIndexTranslateModel(filepath)
  return model && partialPath === `${filepath}${model.partialSuffix}` ? filepath : undefined
}
