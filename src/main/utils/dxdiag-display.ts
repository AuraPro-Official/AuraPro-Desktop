export interface DxdiagDisplay {
  name: string
  dedicatedMb: number
  driverVersion: string | null
}

export const parseDxdiagDisplays = (report: string): DxdiagDisplay[] => {
  const displays: DxdiagDisplay[] = []
  let current: DxdiagDisplay | undefined

  for (const rawLine of report.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (/^-{3,}$/.test(line)) current = undefined
    const name = line.match(/^Card name:\s*(.+)$/i)?.[1]?.trim()
    if (name) {
      current = { name, dedicatedMb: 0, driverVersion: null }
      displays.push(current)
      continue
    }
    if (!current) continue
    const memory = line.match(/^Dedicated Memory:\s*(\d+)\s*MB/i)
    if (memory) current.dedicatedMb = Number(memory[1]) || 0
    const driver = line.match(/^Driver Version:\s*(\d+(?:\.\d+)+)\s*$/i)?.[1]
    if (driver && !/^0(?:\.0)+$/.test(driver)) current.driverVersion = driver
  }

  return displays
}

export const parseCimDisplays = (json: string): DxdiagDisplay[] => {
  const rows: unknown = JSON.parse(json.trim())
  return (Array.isArray(rows) ? rows : [rows]).flatMap((row: unknown) => {
    if (!row || typeof row !== 'object') return []
    const { Name, DriverVersion } = row as { Name?: unknown; DriverVersion?: unknown }
    if (typeof Name !== 'string' || !Name.trim()) return []
    const driver = typeof DriverVersion === 'string' ? DriverVersion.trim() : ''
    return [
      {
        name: Name.trim(),
        driverVersion:
          /^\d+(?:\.\d+)+$/.test(driver) && !/^0(?:\.0)+$/.test(driver) ? driver : null,
        dedicatedMb: 0 // Win32_VideoController.AdapterRAM is not a reliable VRAM source.
      }
    ]
  })
}

export const summarizeDxdiagDisplays = (displays: DxdiagDisplay[]) => ({
  gpuNames: [...new Set(displays.map(({ name }) => name))],
  driverVersion:
    [...new Set(displays.flatMap(({ driverVersion }) => driverVersion ?? []))].join(', ') || null,
  totalVramMb: Math.max(0, ...displays.map(({ dedicatedMb }) => dedicatedMb)) || null
})
