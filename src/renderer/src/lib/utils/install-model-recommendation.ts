import {
  recommendStandardModel,
  recommendProInstallModel,
  type InstallHardware
} from '../../../../shared/model-hardware.ts'

export {
  proGuide,
  proRequirementLabel,
  standardGuide,
  standardRequirementLabel,
  type ModelPreference
} from '../../../../shared/model-hardware.ts'

export const recommendInstallModel = (hardware: InstallHardware): string =>
  `${recommendStandardModel(hardware)}.gguf`

export function recommendWizardModel<T extends { name: string; proPreset?: string }>(
  hardware: InstallHardware,
  standard: readonly T[],
  pro: readonly T[],
  usePro: boolean
): T | null {
  if (usePro) {
    const name = recommendProInstallModel(
      hardware,
      pro.flatMap((m) => m.proPreset ?? [])
    )
    return pro.find((m) => m.proPreset === name) ?? null
  }
  return standard.find((m) => m.name === recommendInstallModel(hardware)) ?? null
}
