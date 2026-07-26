import { ElectronAPI } from '@electron-toolkit/preload'
import type { DesktopApi } from './index'
import type { SpotlightApi } from './spotlight-preload'
import type { VoiceInputApi } from './voice-input-preload'

declare global {
  interface Window {
    electron: ElectronAPI
    electronAPI: DesktopApi
    spotlightAPI: SpotlightApi
    voiceInputAPI: VoiceInputApi
  }
}
