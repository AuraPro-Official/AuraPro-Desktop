export const detectWindowsLlamaVariant = (gpuName = ''): string => {
  const name = gpuName.toLowerCase()

  if (name.includes('nvidia') || name.includes('geforce') || name.includes('rtx')) {
    return /\brtx\s+50[5-9]0\b/i.test(gpuName) ? 'cuda-13.3' : 'cuda-12.4'
  }

  if (name.includes('amd') || name.includes('radeon')) {
    return 'vulkan'
  }

  if (
    name.includes('intel') &&
    (name.includes('arc') ||
      name.includes('iris xe max') ||
      name.includes('data center gpu') ||
      name.includes('flex'))
  ) {
    return 'vulkan'
  }

  return 'cpu'
}
