import { ipcRenderer, contextBridge } from 'electron'

interface VoiceInputConfig {
  audioInputDeviceId?: string
}

interface TranscriptionResult {
  text?: string
}

const api = {
  // Main process tells us to start/stop recording
  onRecordingState: (callback: (data: { recording: boolean }) => void): void => {
    ipcRenderer.on('voiceInput:state', (_event, data) => {
      callback(data)
    })
  },

  // Request microphone permission (macOS system-level)
  checkMicPermission: (): Promise<string> => {
    return ipcRenderer.invoke('voiceInput:micPermission')
  },

  getConfig: (): Promise<VoiceInputConfig> => {
    return ipcRenderer.invoke('config:get')
  },

  // Send recorded audio to main process for transcription
  transcribe: (
    audioBuffer: ArrayBuffer,
    token?: string,
    mimeType?: string,
    options?: {
      streamId?: string
      chunkIndex?: number
      resetStream?: boolean
      languageCandidates?: string[] | string
    }
  ): Promise<TranscriptionResult> => {
    return ipcRenderer.invoke('voiceInput:transcribe', audioBuffer, token, mimeType, options)
  },

  // Notify main process that transcription completed
  done: (text: string): void => {
    ipcRenderer.invoke('voiceInput:done', text)
  },

  // Close/hide the voice input window
  close: (): void => {
    ipcRenderer.invoke('voiceInput:close')
  },

  // Report an error
  error: (message: string): void => {
    ipcRenderer.invoke('voiceInput:error', message)
  }
}

export type VoiceInputApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('voiceInputAPI', api)
  } catch (error) {
    console.error(error)
  }
} else {
  Object.assign(window, { voiceInputAPI: api })
}
