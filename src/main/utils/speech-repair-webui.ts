export type SpeechRepairErrorCode =
  | 'openLocal'
  | 'signIn'
  | 'adminRequired'
  | 'accountChanged'
  | 'busy'
  | 'invalidSelection'
  | 'sherpaFailed'
  | 'webuiFailed'

export class SpeechRepairError extends Error {
  readonly code: SpeechRepairErrorCode

  constructor(code: SpeechRepairErrorCode, message?: string) {
    super(message ?? code)
    this.code = code
  }
}

type JsonObject = Record<string, unknown>

export const isRecord = (value: unknown): value is JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export const localSpeechOrigin = (server: string | null, guest: string): string | null => {
  try {
    const expected = new URL(server ?? '')
    const current = new URL(guest)
    if (
      !['https:', 'http:'].includes(expected.protocol) ||
      !['127.0.0.1', '[::1]'].includes(expected.hostname) ||
      current.origin !== expected.origin ||
      current.username ||
      current.password ||
      expected.username ||
      expected.password
    )
      return null
    return current.origin
  } catch {
    return null
  }
}

type Route =
  | 'auths/'
  | 'audio/config'
  | 'audio/config/update'
  | 'users/user/settings'
  | 'users/user/settings/update'
type RequestJson = (route: Route, body?: JsonObject) => Promise<unknown>

export const readAdminAccount = async (request: RequestJson): Promise<string> => {
  const account = await request('auths/')
  if (!isRecord(account) || typeof account.id !== 'string' || !account.id)
    throw new SpeechRepairError('signIn')
  if (account.role !== 'admin') throw new SpeechRepairError('adminRequired')
  return account.id
}

export const configureWebUISpeech = async (
  request: RequestJson,
  sherpaUrl: string,
  accountId: string
): Promise<void> => {
  if ((await readAdminAccount(request)) !== accountId) throw new SpeechRepairError('accountChanged')

  const audio = await request('audio/config')
  if (!isRecord(audio) || !isRecord(audio.stt) || !isRecord(audio.tts))
    throw new SpeechRepairError('webuiFailed', 'Invalid WebUI audio configuration.')
  const personal = await request('users/user/settings')
  if (personal !== null && !isRecord(personal))
    throw new SpeechRepairError('webuiFailed', 'Invalid WebUI user settings.')

  const base = new URL(sherpaUrl)
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.username || base.password)
    throw new SpeechRepairError('webuiFailed', 'Invalid local Sherpa address.')
  const engine = {
    ENGINE: 'sherpa',
    OPENAI_API_BASE_URL: new URL('/v1', base).href,
    OPENAI_API_KEY: 'aurapro-local'
  }
  const updated = await request('audio/config/update', {
    tts: { ...audio.tts, ...engine, MODEL: 'sherpa-tts', VOICE: '0', OPENAI_PARAMS: {} },
    stt: { ...audio.stt, ...engine, MODEL: 'sherpa-asr', OPENAI_API_REQUEST_FORMAT: 'multipart' }
  })
  if (
    !isRecord(updated) ||
    !isRecord(updated.stt) ||
    !isRecord(updated.tts) ||
    updated.stt.ENGINE !== 'sherpa' ||
    updated.tts.ENGINE !== 'sherpa' ||
    updated.stt.OPENAI_API_BASE_URL !== engine.OPENAI_API_BASE_URL ||
    updated.tts.OPENAI_API_BASE_URL !== engine.OPENAI_API_BASE_URL
  )
    throw new SpeechRepairError('webuiFailed', 'WebUI did not save both Sherpa engines.')

  const ui = isRecord(personal?.ui) ? personal.ui : {}
  const voice = isRecord(ui.audio) ? ui.audio : {}
  const stt = isRecord(voice.stt) ? voice.stt : {}
  const tts = isRecord(voice.tts) ? voice.tts : {}
  const result = await request('users/user/settings/update', {
    ui: {
      ...ui,
      audio: {
        ...voice,
        stt: { ...stt, engine: '', language: '' },
        tts: { ...tts, engine: '', voice: '0', defaultVoice: '0' }
      }
    }
  })
  if (
    !isRecord(result) ||
    !isRecord(result.ui) ||
    !isRecord(result.ui.audio) ||
    !isRecord(result.ui.audio.stt) ||
    !isRecord(result.ui.audio.tts) ||
    result.ui.audio.stt.engine !== '' ||
    result.ui.audio.tts.engine !== ''
  )
    throw new SpeechRepairError('webuiFailed', 'WebUI did not save the current account’s defaults.')
}
