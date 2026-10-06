// Default model mapping adapted from speech-translate-local (MIT, Copyright 2022 Sahar).
// Model loading code remains subject to each upstream model's license.
export const SPEECH_TTS_REPOS: Record<string, string> = {
  // The reference's v0_19 repository no longer contains model files.
  en: 'csukuangfj/kokoro-multi-lang-v1_1',
  zh: 'csukuangfj/matcha-icefall-zh-baker',
  ar: 'csukuangfj/vits-piper-ar_JO-kareem-low',
  af: 'csukuangfj/vits-mimic3-af_ZA-google-nwu_low',
  bn: 'csukuangfj/vits-coqui-bn-custom_female',
  bg: 'csukuangfj/vits-coqui-bg-cv',
  ca: 'csukuangfj/vits-piper-ca_ES-upc_ona-x_low',
  hr: 'csukuangfj/vits-coqui-hr-cv',
  ga: 'csukuangfj/vits-coqui-ga-cv',
  cs: 'csukuangfj/vits-piper-cs_CZ-jirka-low',
  da: 'csukuangfj/vits-coqui-da-cv',
  nl: 'csukuangfj/vits-coqui-nl-css10',
  et: 'csukuangfj/vits-coqui-et-cv',
  fi: 'csukuangfj/vits-coqui-fi-css10',
  fr: 'csukuangfj/vits-coqui-fr-css10',
  ka: 'csukuangfj/vits-piper-ka_GE-natia-medium',
  de: 'csukuangfj/vits-piper-de_DE-glados-low',
  el: 'csukuangfj/vits-piper-el_GR-rapunzelina-low',
  gu: 'csukuangfj/vits-mimic3-gu_IN-cmu-indic_low',
  hi: 'csukuangfj/vits-piper-hi_IN-pratham-medium',
  hu: 'csukuangfj/vits-piper-hu_HU-anna-medium',
  is: 'csukuangfj/vits-piper-is_IS-bui-medium',
  id: 'csukuangfj/vits-piper-id_ID-news_tts-medium',
  it: 'csukuangfj/vits-piper-it_IT-riccardo-x_low',
  kk: 'csukuangfj/vits-piper-kk_KZ-iseke-x_low',
  ko: 'csukuangfj/vits-mimic3-ko_KO-kss_low',
  lv: 'csukuangfj/vits-piper-lv_LV-aivars-medium',
  lt: 'csukuangfj/vits-coqui-lt-cv',
  lb: 'csukuangfj/vits-piper-lb_LU-marylux-medium',
  mt: 'csukuangfj/vits-coqui-mt-cv',
  ne: 'csukuangfj/vits-piper-ne_NP-google-medium',
  no: 'csukuangfj/vits-piper-no_NO-talesyntese-medium',
  fa: 'csukuangfj/vits-piper-fa_IR-amir-medium',
  pl: 'csukuangfj/vits-coqui-pl-mai_female',
  ro: 'csukuangfj/vits-coqui-ro-cv',
  ru: 'csukuangfj/vits-piper-ru_RU-denis-medium',
  sr: 'csukuangfj/vits-piper-sr_RS-serbski_institut-medium',
  sk: 'csukuangfj/vits-coqui-sk-cv',
  sl: 'csukuangfj/vits-piper-sl_SI-artur-medium',
  es: 'csukuangfj/vits-piper-es_MX-claude-high',
  sw: 'csukuangfj/vits-piper-sw_CD-lanfrica-medium',
  sv: 'csukuangfj/vits-coqui-sv-cv',
  th: 'csukuangfj/vits-mms-tha',
  tn: 'csukuangfj/vits-mimic3-tn_ZA-google-nwu_low',
  yue: 'csukuangfj/vits-cantonese-hf-xiaomaiiwn',
  nan: 'csukuangfj/vits-mms-nan',
  tr: 'csukuangfj/vits-piper-tr_TR-dfki-medium',
  uk: 'csukuangfj/vits-piper-uk_UA-lada-x_low',
  vi: 'csukuangfj/vits-piper-vi_VN-25hours_single-low',
  cy: 'csukuangfj/vits-piper-cy_GB-gwryw_gogleddol-medium',
  'pt-BR': 'csukuangfj/vits-piper-pt_BR-faber-medium',
  'pt-PT': 'csukuangfj/vits-piper-pt_PT-tugao-medium'
}

export const EUROPEAN_ASR_LANGUAGES =
  'bg hr cs da nl en et fi fr de el hu it lv lt mt pl pt ro sk sl es sv uk'.split(' ')
export const ASIAN_ASR_LANGUAGES = 'ja ko mn vi th my km lo id ms jv su fa ps ku si'.split(' ')
export const INDIC_ASR_LANGUAGES =
  'as bn brx doi gu hi kn kok ks mai ml mni mr ne or pa sa sat sd ta te ur'.split(' ')
export const SPEECH_ASR_LANGUAGES = [
  ...new Set([
    'zh',
    'ru',
    'tl',
    'ar',
    ...EUROPEAN_ASR_LANGUAGES,
    ...ASIAN_ASR_LANGUAGES,
    ...INDIC_ASR_LANGUAGES,
    ...Object.keys(SPEECH_TTS_REPOS)
      .map((code) => code.split('-')[0])
      .filter((code) => !['yue', 'nan'].includes(code)),
    'hy',
    'he',
    'bs',
    'mk',
    'be',
    'az',
    'am',
    'gl',
    'ha',
    'ht',
    'uz',
    'so',
    'zu'
  ])
]

export function speechLanguageCode(value = ''): string | undefined {
  const name = value.split('(')[0].trim().toLowerCase().replace('_', '-')
  if (['中文', '普通话', 'chinese', 'mandarin'].includes(name)) return 'zh'
  if (['粤语', '廣東話', '广东话', 'cantonese', 'zh-yue'].includes(name)) return 'yue'
  if (['闽南语', '閩南語', 'min-nan', 'min nan', 'zh-min-nan'].includes(name)) return 'nan'
  if (name === 'fil' || name === 'tagalog') return 'tl'
  const codes = [...SPEECH_ASR_LANGUAGES, ...Object.keys(SPEECH_TTS_REPOS)]
  const direct = codes.find((code) => code.toLowerCase() === name)
  if (direct) return direct
  if (name.startsWith('zh-')) return 'zh'
  return codes.find((code) =>
    ['en', 'zh-CN', 'zh-TW', 'es'].some(
      (locale) =>
        new Intl.DisplayNames([locale], { type: 'language' }).of(code)?.toLowerCase() === name
    )
  )
}

export function selectedSpeechLanguages(config: {
  enabledLanguages?: string[]
  asrProfiles?: Record<string, unknown>
  ttsProfiles?: Record<string, unknown>
  asrLanguage?: string
  ttsLanguage?: string
  asrModel?: string
  asrEncoder?: string
  ttsModel?: string
}): string[] {
  if (Array.isArray(config.enabledLanguages))
    return [...new Set(['zh', ...config.enabledLanguages.filter(Boolean)])]
  const existing = [
    ...Object.keys(config.asrProfiles ?? {}),
    ...Object.keys(config.ttsProfiles ?? {})
  ].filter((key) => key !== 'eu' && /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(key))
  const legacy = [
    config.asrModel || config.asrEncoder ? speechLanguageCode(config.asrLanguage) : undefined,
    config.ttsModel ? speechLanguageCode(config.ttsLanguage) : undefined
  ].filter((code): code is string => Boolean(code))
  return [...new Set(['zh', ...existing, ...legacy])]
}

export function glossarySpeechLanguages(settings: Record<string, unknown>): string[] {
  const glossaries = Array.isArray(settings.glossaries) ? settings.glossaries : []
  const active = glossaries.find(
    (item) => item && typeof item === 'object' && item.id === settings.active_glossary_id
  )
  const pair = settings.glossary_mode === 'smart' ? settings : (active ?? settings)
  const values =
    settings.glossary_mode === 'smart'
      ? [pair.smart_source_lang, pair.smart_target_lang]
      : [pair.source_lang, pair.target_lang || pair.glossary_lang]
  return [
    ...new Set(
      values
        .filter((value): value is string => typeof value === 'string')
        .map(speechLanguageCode)
        .filter((code): code is string => Boolean(code))
    )
  ]
}

export function speechAsrGroup(language: string): string {
  const code = language.toLowerCase().split('-')[0]
  if (['zh', 'ru', 'tl', 'ar', 'ka', 'hy'].includes(code)) return code
  if (INDIC_ASR_LANGUAGES.includes(code)) return 'hindi'
  if (EUROPEAN_ASR_LANGUAGES.includes(code)) return 'eu'
  if (ASIAN_ASR_LANGUAGES.includes(code)) return 'asia'
  return SPEECH_ASR_LANGUAGES.includes(code) ? 'others' : 'unsupported'
}
