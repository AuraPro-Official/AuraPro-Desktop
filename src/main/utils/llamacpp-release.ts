export interface LlamaReleaseAsset {
  name: string
  browser_download_url: string
}

export interface LlamaRelease {
  tag_name: string
  draft?: boolean
  prerelease?: boolean
  assets: LlamaReleaseAsset[]
}

export const parseLlamaBuildTag = (tag: string | undefined | null): number | null => {
  const match = String(tag ?? '').match(/^b(\d+)$/)
  if (!match) return null
  const build = Number.parseInt(match[1], 10)
  return Number.isFinite(build) ? build : null
}

export const sortLlamaBuildTagsNewestFirst = (tags: string[]): string[] =>
  [...tags].sort((left, right) => {
    const leftBuild = parseLlamaBuildTag(left)
    const rightBuild = parseLlamaBuildTag(right)
    if (leftBuild !== null && rightBuild !== null) return rightBuild - leftBuild
    if (leftBuild !== null) return -1
    if (rightBuild !== null) return 1
    return right.localeCompare(left)
  })

export const selectLatestCompatibleLlamaRelease = (
  releases: LlamaRelease[],
  isCompatible: (release: LlamaRelease) => boolean
): LlamaRelease | null => {
  return (
    releases
      .filter(
        (release) =>
          !release.draft && parseLlamaBuildTag(release.tag_name) !== null && isCompatible(release)
      )
      .sort(
        (left, right) =>
          (parseLlamaBuildTag(right.tag_name) ?? -1) - (parseLlamaBuildTag(left.tag_name) ?? -1)
      )[0] ?? null
  )
}

export const isNewerLlamaBuild = (
  currentTag: string | null | undefined,
  candidateTag: string | null | undefined
): boolean => {
  if (!candidateTag || currentTag === candidateTag) return false
  if (!currentTag) return true

  const currentBuild = parseLlamaBuildTag(currentTag)
  const candidateBuild = parseLlamaBuildTag(candidateTag)
  if (currentBuild !== null && candidateBuild !== null) return candidateBuild > currentBuild

  return currentTag !== candidateTag
}
