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

const normalizeSpeechLabel = (value: string) =>
  value.normalize('NFKC').trim().toLowerCase().replaceAll('_', '-').replace(/\s+/g, ' ')

export const SPEECH_LANGUAGE_ALIASES: Readonly<Record<string, string>> = (() => {
  const aliases = new Map<string, string>()
  const locales = ['en', 'zh-CN', 'zh-TW', 'es'].map(
    (locale) => new Intl.DisplayNames([locale], { type: 'language', fallback: 'none' })
  )
  const codes = new Set([...SPEECH_ASR_LANGUAGES, ...Object.keys(SPEECH_TTS_REPOS)])
  for (const code of codes) {
    aliases.set(normalizeSpeechLabel(code), code)
    for (const displayNames of locales) {
      const label = displayNames.of(code)
      if (label) aliases.set(normalizeSpeechLabel(label), code)
    }
  }
  for (const [code, labels] of Object.entries({
    zh: ['中文', '普通话', '普通話', '汉语', '漢語', 'chinese', 'mandarin', 'cmn'],
    yue: ['粤语', '粵語', '廣東話', '广东话', 'cantonese', 'zh-yue'],
    nan: ['闽南语', '閩南語', 'min-nan', 'min nan', 'zh-min-nan'],
    es: ['西语', '西語', '西班牙語'],
    en: ['英语', '英語', '英文'],
    ne: ['尼泊尔语', '尼泊爾語'],
    hi: ['印地语', '印地語'],
    bn: ['孟加拉语', '孟加拉語', 'bengali'],
    tl: ['fil', 'tagalog', '菲律宾语', '菲律賓語', '他加禄语', '他加祿語', '塔加洛语', '塔加洛語']
  })) {
    for (const label of labels) aliases.set(normalizeSpeechLabel(label), code)
  }
  return Object.fromEntries(aliases)
})()

export function speechLanguageCode(value = ''): string | undefined {
  const name = normalizeSpeechLabel(value)
  const alias = (key: string) =>
    Object.hasOwn(SPEECH_LANGUAGE_ALIASES, key) ? SPEECH_LANGUAGE_ALIASES[key] : undefined
  const direct = alias(name) ?? alias(name.split('(')[0].trim())
  if (direct) return direct
  if (/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(name)) {
    try {
      const [canonical] = Intl.getCanonicalLocales(name)
      return canonical
        ? (alias(normalizeSpeechLabel(canonical)) ?? alias(canonical.split('-')[0]))
        : undefined
    } catch {
      return undefined
    }
  }
  return undefined
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

export function speechModelSupport(language: string): { asr: boolean; tts: boolean } {
  return {
    asr: speechAsrGroup(language) !== 'unsupported',
    tts: Object.hasOwn(SPEECH_TTS_REPOS, language === 'pt' ? 'pt-PT' : language)
  }
}

export function speechRepairLanguages(
  settings: Record<string, unknown>,
  installedGlossaries: unknown[]
): string[] {
  const customGlossaries = Array.isArray(settings.glossaries) ? settings.glossaries : []
  const values = [settings, ...customGlossaries, ...installedGlossaries].flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const pair = value as Record<string, unknown>
    return [
      pair.source_lang,
      pair.target_lang,
      pair.glossary_lang,
      pair.smart_source_lang,
      pair.smart_target_lang
    ]
  })
  const codes = values.flatMap((value) => {
    const code = typeof value === 'string' ? speechLanguageCode(value) : undefined
    return code ? [code] : []
  })
  return [...new Set(['zh', ...(codes.length > 0 ? codes : ['en'])])]
}

export function speechAsrGroup(language: string): string {
  const code = language.toLowerCase().split('-')[0]
  if (['zh', 'ru', 'tl', 'ar', 'ka', 'hy'].includes(code)) return code
  if (INDIC_ASR_LANGUAGES.includes(code)) return 'hindi'
  if (EUROPEAN_ASR_LANGUAGES.includes(code)) return 'eu'
  if (ASIAN_ASR_LANGUAGES.includes(code)) return 'asia'
  return SPEECH_ASR_LANGUAGES.includes(code) ? 'others' : 'unsupported'
}
