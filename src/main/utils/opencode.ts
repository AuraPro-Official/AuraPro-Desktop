// Compatibility exports for existing saved settings and IPC consumers.
export {
  setupOpenCode,
  startOpenCode,
  stopOpenCode,
  uninstallOpenCode,
  getOpenCodeInfo,
  isOpenCodeInstalled,
  getInstalledOpenCodeVersion,
  getOpenCodeServiceState,
  validateOpenCodeProcess,
  getOpenCodeLog,
  setOpenCodeRuntimeStatusHandler,
  getOpenCodePty
} from './pi-agent'
