// TODO:
// 后续可以添加
// csukuangfj2/sherpa-onnx-supertonic-tts-int8-2026-03-06
// csukuangfj/vits-coqui-bg-cv
//

export const DEFAULT_TTS_PRESETS = [
  {
    id: 'csukuangfj/kokoro-en-v0_19',
    repo: 'csukuangfj/kokoro-en-v0_19',
    language: 'en',
    ttsType: 'kokoro',
    profileKeys: ['en'],
    files: [
      { filename: 'model.onnx', saveAs: 'sherpa-tts-kokoro-en-model.onnx', field: 'ttsModel' },
      { filename: 'voices.bin', saveAs: 'sherpa-tts-kokoro-en-voices.bin', field: 'ttsVoices' },
      { filename: 'tokens.txt', saveAs: 'sherpa-tts-kokoro-en-tokens.txt', field: 'ttsTokens' }
    ]
  },
  {
    id: 'csukuangfj/vits-zh-hf-fanchen-wnj',
    repo: 'csukuangfj/vits-zh-hf-fanchen-wnj',
    language: 'zh',
    ttsType: 'vits',
    profileKeys: ['zh'],
    files: [
      {
        filename: 'vits-zh-hf-fanchen-wnj.onnx',
        saveAs: 'sherpa-tts-vits-zh-fanchen-model.onnx',
        field: 'ttsModel'
      },
      {
        filename: 'tokens.txt',
        saveAs: 'sherpa-tts-vits-zh-fanchen-tokens.txt',
        field: 'ttsTokens'
      },
      {
        filename: 'lexicon.txt',
        saveAs: 'sherpa-tts-vits-zh-fanchen-lexicon.txt',
        field: 'ttsLexicon'
      }
    ]
  },
  {
    id: 'csukuangfj/vits-piper-fr_FR-siwis-medium',
    repo: 'csukuangfj/vits-piper-fr_FR-siwis-medium',
    language: 'fr',
    ttsType: 'vits',
    profileKeys: ['fr'],
    files: [
      {
        filename: 'fr_FR-siwis-medium.onnx',
        saveAs: 'sherpa-tts-vits-fr-siwis-model.onnx',
        field: 'ttsModel'
      },
      { filename: 'tokens.txt', saveAs: 'sherpa-tts-vits-fr-siwis-tokens.txt', field: 'ttsTokens' }
    ]
  },
  {
    id: 'csukuangfj/vits-piper-pl_PL-justyna_wg_glos-medium',
    repo: 'csukuangfj/vits-piper-pl_PL-justyna_wg_glos-medium',
    language: 'pl',
    ttsType: 'vits',
    profileKeys: ['pl'],
    files: [
      {
        filename: 'pl_PL-justyna_wg_glos-medium.onnx',
        saveAs: 'sherpa-tts-vits-pl_PL-justyna_wg_glos-medium.onnx',
        field: 'ttsModel'
      },
      {
        filename: 'tokens.txt',
        saveAs: 'sherpa-tts-vits-pl_PL-justyna_wg_glos-medium-tokens.txt',
        field: 'ttsTokens'
      }
    ]
  },
  {
    id: 'csukuangfj/vits-piper-de_DE-thorsten-high',
    repo: 'csukuangfj/vits-piper-de_DE-thorsten-high',
    language: 'de',
    ttsType: 'vits',
    profileKeys: ['de'],
    files: [
      {
        filename: 'de_DE-thorsten-high.onnx',
        saveAs: 'sherpa-tts-vits-de-thorsten-model.onnx',
        field: 'ttsModel'
      },
      {
        filename: 'tokens.txt',
        saveAs: 'sherpa-tts-vits-de-thorsten-tokens.txt',
        field: 'ttsTokens'
      }
    ]
  },
  {
    id: 'csukuangfj/vits-piper-es_ES-miro-high',
    repo: 'csukuangfj/vits-piper-es_ES-miro-high',
    language: 'es',
    ttsType: 'vits',
    profileKeys: ['es'],
    files: [
      {
        filename: 'es_ES-miro-high.onnx',
        saveAs: 'sherpa-tts-vits-es-miro-model.onnx',
        field: 'ttsModel'
      },
      { filename: 'tokens.txt', saveAs: 'sherpa-tts-vits-es-miro-tokens.txt', field: 'ttsTokens' }
    ]
  },
  {
    id: 'csukuangfj/vits-piper-pt_PT-miro-high',
    repo: 'csukuangfj/vits-piper-pt_PT-miro-high',
    language: 'pt',
    ttsType: 'vits',
    profileKeys: ['pt'],
    files: [
      {
        filename: 'pt_PT-miro-high.onnx',
        saveAs: 'sherpa-tts-vits-pt-miro-model.onnx',
        field: 'ttsModel'
      },
      { filename: 'tokens.txt', saveAs: 'sherpa-tts-vits-pt-miro-tokens.txt', field: 'ttsTokens' }
    ]
  },
  {
    id: 'csukuangfj/vits-piper-ru_RU-irina-medium',
    repo: 'csukuangfj/vits-piper-ru_RU-irina-medium',
    language: 'ru',
    ttsType: 'vits',
    profileKeys: ['ru'],
    files: [
      {
        filename: 'ru_RU-irina-medium.onnx',
        saveAs: 'sherpa-tts-vits-ru-irina-model.onnx',
        field: 'ttsModel'
      },
      { filename: 'tokens.txt', saveAs: 'sherpa-tts-vits-ru-irina-tokens.txt', field: 'ttsTokens' }
    ]
  },
  {
    id: 'csukuangfj/vits-mimic3-ko_KO-kss_low',
    repo: 'csukuangfj/vits-mimic3-ko_KO-kss_low',
    language: 'ko',
    ttsType: 'vits',
    profileKeys: ['ko'],
    files: [
      {
        filename: 'ko_KO-kss_low.onnx',
        saveAs: 'sherpa-tts-vits-ko-kss-model.onnx',
        field: 'ttsModel'
      },
      { filename: 'tokens.txt', saveAs: 'sherpa-tts-vits-ko-kss-tokens.txt', field: 'ttsTokens' }
    ]
  },
  {
    id: 'csukuangfj2/vits-piper-sv_SE-alma-medium',
    repo: 'csukuangfj2/vits-piper-sv_SE-alma-medium',
    language: 'sv',
    ttsType: 'vits',
    profileKeys: ['sv'],
    files: [
      {
        filename: 'sv_SE-alma-medium.onnx',
        saveAs: 'sherpa-tts-vits-sv_SE-alma-medium-model.onnx',
        field: 'ttsModel'
      },
      {
        filename: 'tokens.txt',
        saveAs: 'sherpa-tts-vits-sv_SE-alma-medium-tokens.txt',
        field: 'ttsTokens'
      }
    ]
  },
  {
    id: 'csukuangfj2/vits-piper-nl_NL-alex-medium',
    repo: 'csukuangfj2/vits-piper-nl_NL-alex-medium',
    language: 'nl',
    ttsType: 'vits',
    profileKeys: ['nl'],
    files: [
      {
        filename: 'nl_NL-alex-medium.onnx',
        saveAs: 'sherpa-tts-vits-nl_NL-alex-medium-model.onnx',
        field: 'ttsModel'
      },
      {
        filename: 'tokens.txt',
        saveAs: 'sherpa-tts-vits-nl_NL-alex-medium-tokens.txt',
        field: 'ttsTokens'
      }
    ]
  },
  {
    id: 'csukuangfj/vits-piper-hi_IN-rohan-medium',
    repo: 'csukuangfj/vits-piper-hi_IN-rohan-medium',
    language: 'hi',
    ttsType: 'vits',
    profileKeys: ['hi'],
    files: [
      {
        filename: 'hi_IN-rohan-medium.onnx',
        saveAs: 'sherpa-tts-vits-hi_IN-rohan-medium-model.onnx',
        field: 'ttsModel'
      },
      {
        filename: 'tokens.txt',
        saveAs: 'sherpa-tts-vits-hi_IN-rohan-medium-tokens.txt',
        field: 'ttsTokens'
      }
    ]
  },
  {
    id: 'csukuangfj/vits-piper-sr_RS-serbski_institut-medium',
    repo: 'csukuangfj/vits-piper-sr_RS-serbski_institut-medium',
    language: 'sr',
    ttsType: 'vits',
    profileKeys: ['sr'],
    files: [
      {
        filename: 'sr_RS-serbski_institut-medium.onnx',
        saveAs: 'sherpa-tts-vits-sr_RS-serbski_institut-medium-model.onnx',
        field: 'ttsModel'
      },
      {
        filename: 'tokens.txt',
        saveAs: 'sherpa-tts-vits-sr_RS-serbski_institut-medium-tokens.txt',
        field: 'ttsTokens'
      }
    ]
  },
  {
    id: 'csukuangfj/vits-piper-it_IT-paola-medium',
    repo: 'csukuangfj/vits-piper-it_IT-paola-medium',
    language: 'it',
    ttsType: 'vits',
    profileKeys: ['it'],
    files: [
      {
        filename: 'it_IT-paola-medium.onnx',
        saveAs: 'sherpa-tts-vits-it_IT-paola-medium-model.onnx',
        field: 'ttsModel'
      },
      {
        filename: 'tokens.txt',
        saveAs: 'sherpa-tts-vits-it_IT-paola-medium-tokens.txt',
        field: 'ttsTokens'
      }
    ]
  },
  {
    id: 'csukuangfj/vits-coqui-bg-cv',
    repo: 'csukuangfj/vits-coqui-bg-cv',
    language: 'bg',
    ttsType: 'vits',
    profileKeys: ['bg'],
    files: [
      {
        filename: 'model.onnx',
        saveAs: 'sherpa-tts-vits-coqui-bg-cv-model.onnx',
        field: 'ttsModel'
      },
      {
        filename: 'tokens.txt',
        saveAs: 'sherpa-tts-vits-coqui-bg-cv-tokens.txt',
        field: 'ttsTokens'
      }
    ]
  },
  {
    id: 'csukuangfj/vits-coqui-hr-cv',
    repo: 'csukuangfj/vits-coqui-hr-cv',
    language: 'hr',
    ttsType: 'vits',
    profileKeys: ['hr'],
    files: [
      {
        filename: 'model.onnx',
        saveAs: 'sherpa-tts-vits-coqui-hr-cv-model.onnx',
        field: 'ttsModel'
      },
      {
        filename: 'tokens.txt',
        saveAs: 'sherpa-tts-vits-coqui-hr-cv-tokens.txt',
        field: 'ttsTokens'
      }
    ]
  },
  {
    id: 'csukuangfj/vits-piper-ka_GE-natia-medium',
    repo: 'csukuangfj/vits-piper-ka_GE-natia-medium',
    language: 'ka',
    ttsType: 'vits',
    profileKeys: ['ka'],
    files: [
      {
        filename: 'ka_GE-natia-medium.onnx',
        saveAs: 'sherpa-tts-vits--ka_GE-natia-medium-model.onnx',
        field: 'ttsModel'
      },
      {
        filename: 'tokens.txt',
        saveAs: 'sherpa-tts-vits--ka_GE-natia-medium-tokens.txt',
        field: 'ttsTokens'
      }
    ]
  }
]

export const DEFAULT_ASR_PRESETS = [
  {
    id: 'csukuangfj/sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30',
    repo: 'csukuangfj/sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30',
    asrType: 'online_transducer',
    profileKeys: ['zh'],
    language: 'zh-CN',
    files: [
      {
        filename: 'encoder.int8.onnx',
        saveAs: 'sherpa-asr-streaming-zipformer-zh-encoder.onnx',
        field: 'asrEncoder'
      },
      {
        filename: 'decoder.onnx',
        saveAs: 'sherpa-asr-streaming-zipformer-zh-decoder.onnx',
        field: 'asrDecoder'
      },
      {
        filename: 'joiner.int8.onnx',
        saveAs: 'sherpa-asr-streaming-zipformer-zh-joiner.onnx',
        field: 'asrJoiner'
      },
      {
        filename: 'tokens.txt',
        saveAs: 'sherpa-asr-streaming-zipformer-zh-tokens.txt',
        field: 'asrTokens'
      }
    ]
  },
  {
    id: 'csukuangfj/sherpa-onnx-streaming-zipformer-en-kroko-2025-08-06',
    repo: 'csukuangfj/sherpa-onnx-streaming-zipformer-en-kroko-2025-08-06',
    asrType: 'online_transducer',
    profileKeys: ['en'],
    language: 'en',
    files: [
      {
        filename: 'encoder.onnx',
        saveAs: 'sherpa-asr-streaming-zipformer-en-kroko-encoder.onnx',
        field: 'asrEncoder'
      },
      {
        filename: 'decoder.onnx',
        saveAs: 'sherpa-asr-streaming-zipformer-en-kroko-decoder.onnx',
        field: 'asrDecoder'
      },
      {
        filename: 'joiner.onnx',
        saveAs: 'sherpa-asr-streaming-zipformer-en-kroko-joiner.onnx',
        field: 'asrJoiner'
      },
      {
        filename: 'tokens.txt',
        saveAs: 'sherpa-asr-streaming-zipformer-en-kroko-tokens.txt',
        field: 'asrTokens'
      }
    ]
  },
  {
    id: 'csukuangfj/sherpa-onnx-streaming-zipformer-es-kroko-2025-08-06',
    repo: 'csukuangfj/sherpa-onnx-streaming-zipformer-es-kroko-2025-08-06',
    asrType: 'online_transducer',
    profileKeys: ['es'],
    language: 'es',
    files: [
      {
        filename: 'encoder.onnx',
        saveAs: 'sherpa-asr-streaming-zipformer-es-kroko-encoder.onnx',
        field: 'asrEncoder'
      },
      {
        filename: 'decoder.onnx',
        saveAs: 'sherpa-asr-streaming-zipformer-es-kroko-decoder.onnx',
        field: 'asrDecoder'
      },
      {
        filename: 'joiner.onnx',
        saveAs: 'sherpa-asr-streaming-zipformer-es-kroko-joiner.onnx',
        field: 'asrJoiner'
      },
      {
        filename: 'tokens.txt',
        saveAs: 'sherpa-asr-streaming-zipformer-es-kroko-tokens.txt',
        field: 'asrTokens'
      }
    ]
  },
  {
    id: 'csukuangfj/sherpa-onnx-streaming-zipformer-fr-kroko-2025-08-06',
    repo: 'csukuangfj/sherpa-onnx-streaming-zipformer-fr-kroko-2025-08-06',
    asrType: 'online_transducer',
    profileKeys: ['fr'],
    language: 'fr',
    files: [
      {
        filename: 'encoder.onnx',
        saveAs: 'sherpa-asr-streaming-zipformer-fr-kroko-encoder.onnx',
        field: 'asrEncoder'
      },
      {
        filename: 'decoder.onnx',
        saveAs: 'sherpa-asr-streaming-zipformer-fr-kroko-decoder.onnx',
        field: 'asrDecoder'
      },
      {
        filename: 'joiner.onnx',
        saveAs: 'sherpa-asr-streaming-zipformer-fr-kroko-joiner.onnx',
        field: 'asrJoiner'
      },
      {
        filename: 'tokens.txt',
        saveAs: 'sherpa-asr-streaming-zipformer-fr-kroko-tokens.txt',
        field: 'asrTokens'
      }
    ]
  },
  {
    id: 'csukuangfj/sherpa-onnx-streaming-zipformer-de-kroko-2025-08-06',
    repo: 'csukuangfj/sherpa-onnx-streaming-zipformer-de-kroko-2025-08-06',
    asrType: 'online_transducer',
    profileKeys: ['de'],
    language: 'de',
    files: [
      {
        filename: 'encoder.onnx',
        saveAs: 'sherpa-asr-streaming-zipformer-de-kroko-encoder.onnx',
        field: 'asrEncoder'
      },
      {
        filename: 'decoder.onnx',
        saveAs: 'sherpa-asr-streaming-zipformer-de-kroko-decoder.onnx',
        field: 'asrDecoder'
      },
      {
        filename: 'joiner.onnx',
        saveAs: 'sherpa-asr-streaming-zipformer-de-kroko-joiner.onnx',
        field: 'asrJoiner'
      },
      {
        filename: 'tokens.txt',
        saveAs: 'sherpa-asr-streaming-zipformer-de-kroko-tokens.txt',
        field: 'asrTokens'
      }
    ]
  },
  {
    id: 'csukuangfj/sherpa-onnx-nemo-stt_pt_fastconformer_hybrid_large_pc-int8',
    repo: 'csukuangfj/sherpa-onnx-nemo-stt_pt_fastconformer_hybrid_large_pc-int8',
    asrType: 'nemo_ctc',
    profileKeys: ['pt'],
    language: 'pt',
    files: [
      {
        filename: 'model.int8.onnx',
        saveAs: 'sherpa-asr-portuguese-fastconformer-model.int8.onnx',
        field: 'asrModel'
      },
      {
        filename: 'tokens.txt',
        saveAs: 'sherpa-asr-portuguese-fastconformer-tokens.txt',
        field: 'asrTokens'
      }
    ]
  },
  {
    id: 'csukuangfj/sherpa-onnx-nemo-ctc-giga-am-v3-russian-2025-12-16',
    repo: 'csukuangfj/sherpa-onnx-nemo-ctc-giga-am-v3-russian-2025-12-16',
    asrType: 'nemo_ctc',
    profileKeys: ['ru'],
    language: 'ru',
    files: [
      {
        filename: 'model.int8.onnx',
        saveAs: 'sherpa-asr-russian-giga-am-v3-model.int8.onnx',
        field: 'asrModel'
      },
      {
        filename: 'tokens.txt',
        saveAs: 'sherpa-asr-russian-giga-am-v3-tokens.txt',
        field: 'asrTokens'
      }
    ]
  },
  {
    id: 'csukuangfj/sherpa-onnx-zipformer-vi-int8-2025-04-20',
    repo: 'csukuangfj/sherpa-onnx-zipformer-vi-int8-2025-04-20',
    asrType: 'transducer',
    profileKeys: ['vi'],
    language: 'vi',
    files: [
      {
        filename: 'encoder-epoch-12-avg-8.int8.onnx',
        saveAs: 'sherpa-asr-vietnamese-encoder.int8.onnx',
        field: 'asrEncoder'
      },
      {
        filename: 'decoder-epoch-12-avg-8.onnx',
        saveAs: 'sherpa-asr-vietnamese-decoder.onnx',
        field: 'asrDecoder'
      },
      {
        filename: 'joiner-epoch-12-avg-8.int8.onnx',
        saveAs: 'sherpa-asr-vietnamese-joiner.int8.onnx',
        field: 'asrJoiner'
      },
      { filename: 'tokens.txt', saveAs: 'sherpa-asr-vietnamese-tokens.txt', field: 'asrTokens' }
    ]
  },
  {
    id: 'reazon-research/reazonspeech-k2-v2',
    repo: 'reazon-research/reazonspeech-k2-v2',
    asrType: 'transducer',
    profileKeys: ['ja'],
    language: 'ja',
    files: [
      {
        filename: 'encoder-epoch-99-avg-1.int8.onnx',
        saveAs: 'sherpa-asr-japanese-reazon-encoder.int8.onnx',
        field: 'asrEncoder'
      },
      {
        filename: 'decoder-epoch-99-avg-1.onnx',
        saveAs: 'sherpa-asr-japanese-reazon-decoder.onnx',
        field: 'asrDecoder'
      },
      {
        filename: 'joiner-epoch-99-avg-1.onnx',
        saveAs: 'sherpa-asr-japanese-reazon-joiner.onnx',
        field: 'asrJoiner'
      },
      {
        filename: 'tokens.txt',
        saveAs: 'sherpa-asr-japanese-reazon-tokens.txt',
        field: 'asrTokens'
      }
    ]
  },
  {
    id: 'k2-fsa/sherpa-onnx-zipformer-korean-2024-06-24',
    repo: 'k2-fsa/sherpa-onnx-zipformer-korean-2024-06-24',
    asrType: 'transducer',
    profileKeys: ['ko'],
    language: 'ko',
    files: [
      {
        filename: 'encoder-epoch-99-avg-1.int8.onnx',
        saveAs: 'sherpa-asr-korean-encoder.int8.onnx',
        field: 'asrEncoder'
      },
      {
        filename: 'decoder-epoch-99-avg-1.onnx',
        saveAs: 'sherpa-asr-korean-decoder.onnx',
        field: 'asrDecoder'
      },
      {
        filename: 'joiner-epoch-99-avg-1.onnx',
        saveAs: 'sherpa-asr-korean-joiner.onnx',
        field: 'asrJoiner'
      },
      { filename: 'tokens.txt', saveAs: 'sherpa-asr-korean-tokens.txt', field: 'asrTokens' }
    ]
  },
  {
    id: 'yfyeung/icefall-asr-gigaspeech2-th-zipformer-2024-06-20',
    repo: 'yfyeung/icefall-asr-gigaspeech2-th-zipformer-2024-06-20',
    asrType: 'transducer',
    profileKeys: ['th'],
    language: 'th',
    files: [
      {
        filename: 'exp/encoder-epoch-12-avg-5.int8.onnx',
        saveAs: 'sherpa-asr-thai-encoder.int8.onnx',
        field: 'asrEncoder'
      },
      {
        filename: 'exp/decoder-epoch-12-avg-5.onnx',
        saveAs: 'sherpa-asr-thai-decoder.onnx',
        field: 'asrDecoder'
      },
      {
        filename: 'exp/joiner-epoch-12-avg-5.int8.onnx',
        saveAs: 'sherpa-asr-thai-joiner.int8.onnx',
        field: 'asrJoiner'
      },
      {
        filename: 'data/lang_bpe_2000/tokens.txt',
        saveAs: 'sherpa-asr-thai-tokens.txt',
        field: 'asrTokens'
      }
    ]
  },
  {
    id: 'LukeJacob2023/sherpa-onnx-stt_tl_fastconformer_hybrid_large',
    repo: 'LukeJacob2023/sherpa-onnx-stt_tl_fastconformer_hybrid_large',
    asrType: 'nemo_transducer',
    profileKeys: ['tl'],
    language: 'tl',
    files: [
      {
        filename: 'encoder.onnx',
        saveAs: 'sherpa-asr-tagalog-fastconformer-encoder.onnx',
        field: 'asrEncoder'
      },
      {
        filename: 'decoder.onnx',
        saveAs: 'sherpa-asr-tagalog-fastconformer-decoder.onnx',
        field: 'asrDecoder'
      },
      {
        filename: 'joiner.onnx',
        saveAs: 'sherpa-asr-tagalog-fastconformer-joiner.onnx',
        field: 'asrJoiner'
      },
      {
        filename: 'tokens.txt',
        saveAs: 'sherpa-asr-tagalog-fastconformer-tokens.txt',
        field: 'asrTokens'
      }
    ]
  },
  {
    id: 'LukeJacob2023/sherpa-onnx-stt_ar_fastconformer_hybrid_large_pc',
    repo: 'LukeJacob2023/sherpa-onnx-stt_ar_fastconformer_hybrid_large_pc',
    asrType: 'nemo_transducer',
    profileKeys: ['ar'],
    language: 'ar',
    files: [
      {
        filename: 'encoder.onnx',
        saveAs: 'sherpa-asr-arabic-fastconformer-encoder.onnx',
        field: 'asrEncoder'
      },
      {
        filename: 'decoder.onnx',
        saveAs: 'sherpa-asr-arabic-fastconformer-decoder.onnx',
        field: 'asrDecoder'
      },
      {
        filename: 'joiner.onnx',
        saveAs: 'sherpa-asr-arabic-fastconformer-joiner.onnx',
        field: 'asrJoiner'
      },
      {
        filename: 'tokens.txt',
        saveAs: 'sherpa-asr-arabic-fastconformer-tokens.txt',
        field: 'asrTokens'
      }
    ]
  },
  {
    id: 'csukuangfj/sherpa-onnx-sense-voice-funasr-nano-int8-2025-12-17',
    repo: 'csukuangfj/sherpa-onnx-sense-voice-funasr-nano-int8-2025-12-17',
    asrType: 'sense_voice',
    profileKeys: ['hindi'],
    language: 'auto',
    files: [
      {
        filename: 'model.int8.onnx',
        saveAs: 'sherpa-asr-funasr-nano-model.int8.onnx',
        field: 'asrModel'
      },
      { filename: 'tokens.txt', saveAs: 'sherpa-asr-funasr-nano-tokens.txt', field: 'asrTokens' }
    ]
  },
  {
    id: 'csukuangfj/sherpa-onnx-dolphin-small-ctc-multi-lang-int8-2025-04-02',
    repo: 'csukuangfj/sherpa-onnx-dolphin-small-ctc-multi-lang-int8-2025-04-02',
    asrType: 'dolphin_ctc',
    profileKeys: ['default', 'asia', 'others'],
    language: 'auto',
    files: [
      {
        filename: 'model.int8.onnx',
        saveAs: 'sherpa-asr-dolphin-small-multilang-model.int8.onnx',
        field: 'asrModel'
      },
      {
        filename: 'tokens.txt',
        saveAs: 'sherpa-asr-dolphin-small-multilang-tokens.txt',
        field: 'asrTokens'
      }
    ]
  },

  // ── 欧洲语言（NeMo Parakeet TDT 0.6b v3，支持25种EU语言）
  {
    id: 'csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8',
    repo: 'csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8',
    asrType: 'nemo_transducer',
    profileKeys: [
      'cs',
      'da',
      'nl',
      'et',
      'fi',
      'el',
      'hu',
      'it',
      'lv',
      'lt',
      'mt',
      'pl',
      'ro',
      'sk',
      'sl',
      'sv',
      'uk',
      'eu'
    ],
    language: 'auto',
    files: [
      {
        filename: 'encoder.int8.onnx',
        saveAs: 'sherpa-asr-parakeet-tdt-encoder.int8.onnx',
        field: 'asrEncoder'
      },
      {
        filename: 'decoder.int8.onnx',
        saveAs: 'sherpa-asr-parakeet-tdt-decoder.int8.onnx',
        field: 'asrDecoder'
      },
      {
        filename: 'joiner.int8.onnx',
        saveAs: 'sherpa-asr-parakeet-tdt-joiner.int8.onnx',
        field: 'asrJoiner'
      },
      { filename: 'tokens.txt', saveAs: 'sherpa-asr-parakeet-tdt-tokens.txt', field: 'asrTokens' }
    ]
  },
  {
    id: 'csukuangfj/sherpa-onnx-whisper-small',
    repo: 'csukuangfj/sherpa-onnx-whisper-small',
    asrType: 'whisper',
    profileKeys: ['hr'],
    language: 'hr',
    files: [
      {
        filename: 'small-encoder.int8.onnx',
        saveAs: 'sherpa-asr-whisper-small-encoder.int8.onnx',
        field: 'asrEncoder'
      },
      {
        filename: 'small-decoder.int8.onnx',
        saveAs: 'sherpa-asr-whisper-small-decoder.int8.onnx',
        field: 'asrDecoder'
      },
      {
        filename: 'small-tokens.txt',
        saveAs: 'sherpa-asr-whisper-small-tokens.txt',
        field: 'asrTokens'
      }
    ]
  },
  {
    id: 'csukuangfj/sherpa-onnx-whisper-small',
    repo: 'csukuangfj/sherpa-onnx-whisper-small',
    asrType: 'whisper',
    profileKeys: ['sr'],
    language: 'sr',
    files: [
      {
        filename: 'small-encoder.int8.onnx',
        saveAs: 'sherpa-asr-whisper-small-encoder.int8.onnx',
        field: 'asrEncoder'
      },
      {
        filename: 'small-decoder.int8.onnx',
        saveAs: 'sherpa-asr-whisper-small-decoder.int8.onnx',
        field: 'asrDecoder'
      },
      {
        filename: 'small-tokens.txt',
        saveAs: 'sherpa-asr-whisper-small-tokens.txt',
        field: 'asrTokens'
      }
    ]
  },
  {
    id: 'csukuangfj/sherpa-onnx-whisper-small',
    repo: 'csukuangfj/sherpa-onnx-whisper-small',
    asrType: 'whisper',
    profileKeys: ['bg'],
    language: 'bg',
    files: [
      {
        filename: 'small-encoder.int8.onnx',
        saveAs: 'sherpa-asr-whisper-small-encoder.int8.onnx',
        field: 'asrEncoder'
      },
      {
        filename: 'small-decoder.int8.onnx',
        saveAs: 'sherpa-asr-whisper-small-decoder.int8.onnx',
        field: 'asrDecoder'
      },
      {
        filename: 'small-tokens.txt',
        saveAs: 'sherpa-asr-whisper-small-tokens.txt',
        field: 'asrTokens'
      }
    ]
  }
]

export const SERVER_SOURCE = String.raw`import argparse
import io
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import time
import av

from functools import lru_cache, wraps
from fast_langdetect import detect_language as fast_detect_language
from faster_whisper import WhisperModel
from collections import OrderedDict
from pathlib import Path


os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("HF_HUB_VERBOSITY", "error")
logging.getLogger("huggingface_hub").setLevel(logging.ERROR)

import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response

app = FastAPI(title="AuraPro Sherpa Service")
ASR_STREAM_STATE = {}
ASR_STREAM_MAX_AGE_SECONDS = 15 * 60


def _truthy(value):
    return str(value or "").lower() in {"1", "true", "yes", "on"}


def _env_int(name, default):
    try:
        return int(os.getenv(name, str(default)))
    except Exception:
        return default


def _require(path, label):
    if not path:
        raise HTTPException(status_code=503, detail=f"{label} is not configured")
    if not os.path.exists(path):
        raise HTTPException(status_code=503, detail=f"{label} does not exist: {path}")
    return path


def _find_first_file(root, names):
    if not root or not os.path.isdir(root):
        return ""
    lowered = {name.lower() for name in names}
    for current, _dirs, files in os.walk(root):
        for filename in files:
            if filename.lower() in lowered:
                return os.path.join(current, filename)
    return ""


def _find_lexicon_file(root):
    exact = _find_first_file(root, ["lexicon.txt", "lexicon-us-en.txt", "lexicon-zh.txt", "lexicon-zh-en.txt"])
    if exact:
        return exact
    if not root or not os.path.isdir(root):
        return ""
    for current, _dirs, files in os.walk(root):
        for filename in files:
            lower = filename.lower()
            if lower.startswith("lexicon") and lower.endswith(".txt"):
                return os.path.join(current, filename)
    return ""



def _timed(label):
    """Decorador que imprime el tiempo de ejecución de una función."""
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            t0 = time.perf_counter()
            result = fn(*args, **kwargs)
            elapsed = (time.perf_counter() - t0) * 1000
            print(f"[TIMING] {label}: {elapsed:.1f}ms")
            return result
        return wrapper
    return decorator


@_timed("lid/_read_audio")
def _read_audio(path):
    try:
        return sf.read(path, dtype="float32", always_2d=False)
    except Exception as first_error:
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            raise HTTPException(
                status_code=503,
                detail=(
                    "Audio format is not supported by soundfile and ffmpeg is not available. "
                    f"Original error: {first_error}"
                ),
            )

        wav_path = ""
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as wav_tmp:
                wav_path = wav_tmp.name

            result = subprocess.run(
                [
                    ffmpeg,
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-i",
                    path,
                    "-ac",
                    "1",
                    "-ar",
                    "16000",
                    "-f",
                    "wav",
                    wav_path,
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=60,
            )
            if result.returncode != 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"Failed to decode audio with ffmpeg: {result.stderr.strip() or first_error}",
                )
            return sf.read(wav_path, dtype="float32", always_2d=False)
        finally:
            if wav_path:
                try:
                    os.unlink(wav_path)
                except Exception:
                    pass


@app.get("/health")
def health():
    profiles = _load_asr_profiles()
    return {
        "ok": True,
        "asr_configured": bool(profiles) or bool(os.getenv("SHERPA_ASR_MODEL") or os.getenv("SHERPA_ASR_ENCODER")),
        "asr_auto_detect": _truthy(os.getenv("SHERPA_ASR_AUTO_DETECT", "true")),
        "tts_configured": bool(os.getenv("SHERPA_TTS_MODEL")),
    }


@app.get("/v1/models")
def models():
    return {
        "object": "list",
        "data": [
            {"id": os.getenv("SHERPA_ASR_NAME", "sherpa-asr"), "object": "model", "owned_by": "aurapro"},
            {"id": os.getenv("SHERPA_TTS_NAME", "sherpa-tts"), "object": "model", "owned_by": "aurapro"},
        ],
    }

@lru_cache(maxsize=1)
def _load_asr_profiles():
    raw = os.getenv("SHERPA_ASR_PROFILES", "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return {str(key): value for key, value in parsed.items() if isinstance(value, dict)}
    except Exception:
        return {}
    return {}


def _fallback_asr_profile():
    keys = [
        "SHERPA_ASR_NAME",
        "SHERPA_ASR_TYPE",
        "SHERPA_ASR_MODEL",
        "SHERPA_ASR_ENCODER",
        "SHERPA_ASR_DECODER",
        "SHERPA_ASR_JOINER",
        "SHERPA_ASR_PREPROCESSOR",
        "SHERPA_ASR_CACHED_DECODER",
        "SHERPA_ASR_UNCACHED_DECODER",
        "SHERPA_ASR_MERGED_DECODER",
        "SHERPA_ASR_TOKENS",
        "SHERPA_ASR_NUM_THREADS",
        "SHERPA_ASR_PROVIDER",
        "SHERPA_ASR_TASK",
        "SHERPA_ASR_USE_ITN",
        "SHERPA_LANGUAGE",
    ]
    return {key: os.getenv(key, "") for key in keys if os.getenv(key, "")}


def _profile_value(profile, name, default=""):
    return str(profile.get(name) or os.getenv(name, default) or "")


def _profile_configured(profile):
    return bool(
        profile.get("SHERPA_ASR_MODEL")
        or profile.get("SHERPA_ASR_ENCODER")
        or os.getenv("SHERPA_ASR_MODEL")
        or os.getenv("SHERPA_ASR_ENCODER")
    )


HINDI_LANGS = {"hi", "ur", "bn", "ta", "te", "mr", "gu", "kn", "ml", "pa", "ne", "si"}
EU_LANGS = {
    "en", "es", "fr", "de", "it", "pt", "nl", "pl", "tr", "sv", "da", "no", "fi",
    "el", "ro", "hu", "cs", "sk", "uk", "bg", "ca", "hr", "sr", "sl", "lt", "lv", "et",
}
ASIA_LANGS = {"ja", "ko", "vi", "th", "id", "ms", "my", "km", "lo", "fil", "fa", "he"}
LANGUAGE_ALIASES = {
    "\u4e2d\u6587": "zh",
    "\u6c49\u8bed": "zh",
    "\u666e\u901a\u8bdd": "zh",
    "chinese": "zh",
    "mandarin": "zh",
    "zh-cn": "zh",
    "zh-hans": "zh",
    "zh": "zh",
    "\u7ca4\u8bed": "yue",
    "cantonese": "yue",
    "\u897f\u73ed\u7259\u8bed": "es",
    "\u897f\u8bed": "es",
    "spanish": "es",
    "es": "es",
    "\u82f1\u8bed": "en",
    "\u82f1\u6587": "en",
    "english": "en",
    "en": "en",
    "\u65e5\u8bed": "ja",
    "\u65e5\u6587": "ja",
    "japanese": "ja",
    "ja": "ja",
    "\u97e9\u8bed": "ko",
    "\u97e9\u6587": "ko",
    "korean": "ko",
    "ko": "ko",
    "\u6cd5\u8bed": "fr",
    "french": "fr",
    "fr": "fr",
    "\u5fb7\u8bed": "de",
    "german": "de",
    "de": "de",
    "\u4fc4\u8bed": "ru",
    "russian": "ru",
    "ru": "ru",
    "\u963f\u62c9\u4f2f\u8bed": "ar",
    "arabic": "ar",
    "ar": "ar",
    "\u4ed6\u52a0\u7984\u8bed": "tl",
    "\u83f2\u5f8b\u5bbe\u8bed": "tl",
    "tagalog": "tl",
    "tl": "tl",
    "\u5370\u5730\u8bed": "hi",
    "hindi": "hi",
    "hi": "hi",
    "\u8461\u8404\u7259\u8bed": "pt",
    "portuguese": "pt",
    "pt": "pt",
    "\u8d8a\u5357\u8bed": "vi",
    "vietnamese": "vi",
    "vi": "vi",
    "\u6cf0\u8bed": "th",
    "thai": "th",
    "th": "th",
    "\u610f\u5927\u5229\u8bed": "it",
    "italian": "it",
    "it": "it",
    "\u8377\u5170\u8bed": "nl",
    "dutch": "nl",
    "nl": "nl",
    "\u6ce2\u5170\u8bed": "pl",
    "polish": "pl",
    "pl": "pl",
    "\u745e\u5178\u8bed": "sv",
    "swedish": "sv",
    "sv": "sv",
    "\u585e\u5c14\u7ef4\u4e9a\u8bed": "sr",
    "serbian": "sr",
    "sr": "sr",
    "\u514b\u7f57\u5730\u4e9a\u8bed": "hr",
    "croatian": "hr",
    "hr": "hr",
    "\u4fdd\u52a0\u5229\u4e9a\u8bed": "bg",
    "bulgarian": "bg",
    "bg": "bg",
    "\u683c\u9c81\u5409\u4e9a\u8bed": "ka",
    "georgian": "ka",
    "ka": "ka",
    "\u571f\u8033\u5176\u8bed": "tr",
    "turkish": "tr",
    "tr": "tr",
    "\u4e4c\u514b\u5170\u8bed": "uk",
    "ukrainian": "uk",
    "uk": "uk",
    "\u4e39\u9ea6\u8bed": "da",
    "danish": "da",
    "da": "da",
    "\u632a\u5a01\u8bed": "no",
    "norwegian": "no",
    "no": "no",
    "\u82ac\u5170\u8bed": "fi",
    "finnish": "fi",
    "fi": "fi",
    "\u5e0c\u814a\u8bed": "el",
    "greek": "el",
    "el": "el",
    "\u7f57\u9a6c\u5c3c\u4e9a\u8bed": "ro",
    "romanian": "ro",
    "ro": "ro",
    "\u5308\u7259\u5229\u8bed": "hu",
    "hungarian": "hu",
    "hu": "hu",
    "\u6377\u514b\u8bed": "cs",
    "czech": "cs",
    "cs": "cs",
    "\u65af\u6d1b\u4f10\u514b\u8bed": "sk",
    "slovak": "sk",
    "sk": "sk",
    "\u65af\u6d1b\u6587\u5c3c\u4e9a\u8bed": "sl",
    "slovenian": "sl",
    "sl": "sl",
    "\u7acb\u9676\u5b9b\u8bed": "lt",
    "lithuanian": "lt",
    "lt": "lt",
    "\u62c9\u8131\u7ef4\u4e9a\u8bed": "lv",
    "latvian": "lv",
    "lv": "lv",
    "\u7231\u6c99\u5c3c\u4e9a\u8bed": "et",
    "estonian": "et",
    "et": "et",
}


def _normalize_language_code(language):
    value = str(language or "").strip().lower()
    if not value:
        return ""
    value = value.replace("_", "-")
    if value in LANGUAGE_ALIASES:
        return LANGUAGE_ALIASES[value]
    base = value.split("-", 1)[0]
    return LANGUAGE_ALIASES.get(base, base)


def _parse_language_candidates(value):
    if not value:
        return []
    if isinstance(value, (list, tuple, set)):
        raw_items = value
    else:
        raw = str(value).strip()
        if raw.startswith("["):
            try:
                parsed = json.loads(raw)
                raw_items = parsed if isinstance(parsed, list) else [raw]
            except Exception:
                raw_items = re.split(r"[,;\s]+", raw)
        else:
            raw_items = re.split(r"[,;\s]+", raw)

    candidates = []
    for item in raw_items:
        code = _normalize_language_code(item)
        if code and code not in candidates:
            candidates.append(code)
    return candidates


def _profile_key_for_language(language):
    lang = _normalize_language_code(language)
    profiles = _load_asr_profiles()
    if lang and lang in profiles:
        return lang
    if lang in {"zh", "en", "es", "fr", "de", "pt", "vi", "ja", "ko", "th", "tl", "ar", "ru"}:
        return lang
    if lang in HINDI_LANGS:
        return "hindi"
    if lang in EU_LANGS:
        return "eu"
    if lang in ASIA_LANGS:
        return "asia"
    return "others"


def _cleanup_asr_stream_state(now=None):
    now = now or time.time()
    expired = [
        key
        for key, value in ASR_STREAM_STATE.items()
        if now - float(value.get("updated_at", 0)) > ASR_STREAM_MAX_AGE_SECONDS
    ]
    for key in expired:
        ASR_STREAM_STATE.pop(key, None)


def _get_asr_stream_key(request, stream_id=""):
    if stream_id:
        return f"stream:{stream_id}"
    client = getattr(request, "client", None)
    host = getattr(client, "host", "") if client else ""
    return f"client:{host or 'local'}"


def _resolve_asr_profile_for_request(
        request,
        samples,
        language=None,
        language_candidates=None,
        stream_id="",
        reset_stream=False,
):
    now = time.time()
    _cleanup_asr_stream_state(now)
    # Only cache when a real streaming session id is provided. The final
    # full-recording transcription has no stream_id and is always detected fresh
    # on the complete audio (most accurate).
    stream_key = _get_asr_stream_key(request, stream_id) if stream_id else ""

    if stream_key:
        if reset_stream:
            ASR_STREAM_STATE.pop(stream_key, None)
        state = ASR_STREAM_STATE.get(stream_key)
        if state and state.get("profile_key"):
            # Reuse the language detected on the first chunk for every later
            # chunk of the same utterance. This prevents per-chunk language
            # flipping on short segments (which produced mixed-language garbage).
            state["updated_at"] = now
            print(f"Reusing stream language: {state.get('language', '')} profile={state['profile_key']}")
            return state.get("language", ""), state["profile_key"], False

    if _truthy(os.getenv("SHERPA_ASR_AUTO_DETECT", "true")):
        candidates = _parse_language_candidates(language_candidates)
        detected_language = detect_language_task(samples, candidates)
        print(f"Auto-detected language: {detected_language}")
    else:
        detected_language = _normalize_language_code(language)

    profile_key = _profile_key_for_language(detected_language)
    if stream_key:
        ASR_STREAM_STATE[stream_key] = {
            "language": detected_language,
            "profile_key": profile_key,
            "updated_at": now,
        }
    print(f"detected_language: {detected_language}, profile_key: {profile_key}")
    return detected_language, profile_key, True


@lru_cache(maxsize=1)
def get_whisper_small_model():
    model_name = "small"
    print("model_name", model_name)
    device = os.getenv("SHERPA_LANG_DETECT_DEVICE", "cpu")
    compute_type = os.getenv("SHERPA_LANG_DETECT_COMPUTE_TYPE", "int8")
    cpu_threads = _env_int("SHERPA_LANG_DETECT_THREADS", max(1, min(4, os.cpu_count() or 4)))
    return WhisperModel(model_name, device=device, compute_type=compute_type, cpu_threads=cpu_threads)

@lru_cache(maxsize=1)
def get_whisper_large_model():
    model_name = "large-v3-turbo" # os.getenv("SHERPA_LANG_DETECT_MODEL", "tiny")  "large-v3-turbo"
    print("model_name", model_name)
    device = os.getenv("SHERPA_LANG_DETECT_DEVICE", "cpu")
    compute_type = os.getenv("SHERPA_LANG_DETECT_COMPUTE_TYPE", "int8")
    cpu_threads = _env_int("SHERPA_LANG_DETECT_THREADS", max(1, min(4, os.cpu_count() or 4)))
    return WhisperModel(model_name, device=device, compute_type=compute_type, cpu_threads=cpu_threads)

def load_with_pyav(audio_path: str) -> tuple[np.ndarray, int]:
    samples = []

    with av.open(audio_path) as container:
        audio_stream = next(
            (s for s in container.streams if s.type == "audio"), None
        )
        if audio_stream is None:
            raise ValueError(f"No audio stream found in {audio_path}")

        resampler = av.AudioResampler(
            format="s16",
            layout="mono",
            rate=16000
        )

        for frame in container.decode(audio_stream):
            for resampled_frame in resampler.resample(frame):
                samples.append(resampled_frame.to_ndarray().reshape(-1))

        # Flush del buffer interno del resampler
        try:
            for resampled_frame in resampler.resample(None):
                samples.append(resampled_frame.to_ndarray().reshape(-1))
        except Exception as e:
            print(f"[LID] resampler flush warning: {e}")

    if not samples:
        raise ValueError(f"No audio samples could be decoded from {audio_path}")

    audio_array = np.concatenate(samples).astype(np.float32) / 32768.0
    if audio_array.ndim > 1:
        audio_array = np.mean(audio_array, axis=1)

    print(f"[LID] PyAV decoded successfully: {len(audio_array) / 16000:.2f}s @ 16kHz")
    return audio_array, 16000


def load_audio(audio_path):
    samples, sample_rate = sf.read(audio_path, dtype="float32", always_2d=False)
    if samples.ndim > 1:
        samples = np.mean(samples, axis=1)

    # 重采样到 16kHz
    if sample_rate != 16000:
        target_len = int(len(samples) * 16000 / sample_rate)
        samples = np.interp(
            np.linspace(0, len(samples), target_len),
            np.arange(len(samples)),
            samples,
        ).astype(np.float32)

    # 音频太短跳过
    duration = len(samples) / 16000
    if duration < 0.8:
        print(f"[LID] audio too short ({duration:.2f}s), using default")
    return samples, 16000

def load_audio_robust(audio_path: Path):
    """健壮的音频加载（可后续替换为 PyAV 版本）"""
    if audio_path.suffix.lower() in {'.webm', '.mkv', '.opus', '.ogg', '.m4a', '.mp4'}:
        return load_with_pyav(str(audio_path))

    try:
        return load_audio(str(audio_path))
    except Exception as e:
        print(f"[LID] Error loading audio: {e}")
        return load_with_pyav(str(audio_path))


def _normalize_probability_items(all_probs):
    """Flatten whisper's all_language_probs into a list of (code, prob)."""
    items = []
    if isinstance(all_probs, dict):
        raw = all_probs.items()
    elif isinstance(all_probs, (list, tuple)):
        raw = all_probs
    else:
        raw = []
    for item in raw:
        if isinstance(item, (list, tuple)) and len(item) >= 2:
            code = _normalize_language_code(item[0])
            if code in {"yue", "cmn"}:
                code = "zh"
            try:
                prob = float(item[1] or 0)
            except Exception:
                prob = 0.0
            if code:
                items.append((code, prob))
    return items


def _best_candidate_from_probs(candidate_set, prob_items):
    """Pick the highest-probability language that is in candidate_set."""
    best_code, best_prob = "", -1.0
    for code, prob in prob_items:
        if code in candidate_set and prob > best_prob:
            best_code, best_prob = code, prob
    return best_code

@_timed("lid/detect_language_task")
def detect_language_task(samples, candidates=None):
    candidates = _parse_language_candidates(candidates)
    # Two or more candidates => translation/interpretation mode: constrain to them.
    # A single candidate carries no real disambiguation, so fall back to free detect.
    candidate_set = set(candidates) if len(candidates) >= 2 else set()
    default_language = _normalize_language_code(os.getenv("SHERPA_ASR_DEFAULT_LANGUAGE", "zh")) or "zh"

    def run(get_model):
        model = get_model()
        language, language_probability, all_language_probs = model.detect_language(samples, vad_filter=True)
        detected = _normalize_language_code(language or "")
        if detected in {"yue", "cmn"}:
            detected = "zh"
        return detected, float(language_probability or 0), _normalize_probability_items(all_language_probs)

    try:
        detected, probability, prob_items = run(get_whisper_small_model)
    except Exception as exc:
        print(f"[LID] small model unavailable ({exc})")
        detected, probability, prob_items = "", 0.0, []

    # Candidate-constrained (translation/interpretation): use the accurate large
    # model and pick the most probable language *among the candidates* from the
    # full probability distribution. This is the key fix: previously a small-model
    # guess of "zh" was locked in immediately whenever zh was a candidate, so any
    # short non-Chinese clip (Spanish, etc.) was mis-recognized as Chinese.
    if candidate_set:
        picked = _best_candidate_from_probs(candidate_set, prob_items)
        if picked:
            print(f"[LID] candidates={candidates} top={detected}({probability:.2f}) -> picked {picked}")
            return picked
        if detected in candidate_set:
            return detected
        print(f"[LID] detected {detected or 'unknown'} outside candidates {candidates}; using {candidates[0]}")
        return candidates[0]

    # Free detection: try the fast small model first; escalate to the large model
    # when it is not confident, instead of trusting a low-confidence guess that
    # routes short audio to the wrong (e.g. Asian multilingual) model.
    if detected and probability >= 0.7:
        print(f"[LID] free detect (small) -> {detected} ({probability:.2f})")
        return detected

    try:
        large_detected, large_probability, _ = run(get_whisper_large_model)
        if large_detected:
            print(f"[LID] free detect (large) -> {large_detected} ({large_probability:.2f})")
            return large_detected
    except Exception as exc:
        print(f"[LID] large model unavailable ({exc})")
    return detected or default_language


_recognizer_cache: OrderedDict = OrderedDict()
MAX_RECOGNIZERS = 4   # 根据服务器内存调整
_recognizer_lock = None

def _get_lock():
    global _recognizer_lock
    if _recognizer_lock is None:
        import threading
        _recognizer_lock = threading.Lock()
    return _recognizer_lock


def get_recognizer(profile_key="default", detect_language=""):
    import sherpa_onnx

    cache_key = profile_key
    if cache_key in _recognizer_cache:
        _recognizer_cache.move_to_end(cache_key)
        return _recognizer_cache[cache_key]


    with _get_lock():
        if cache_key in _recognizer_cache:
            return _recognizer_cache[cache_key]

        recognizer = _create_recognizer(profile_key, detect_language)

        # 弹出最早的
        if len(_recognizer_cache) >= MAX_RECOGNIZERS:
            _recognizer_cache.popitem(last=False)

        _recognizer_cache[cache_key] = recognizer
        return recognizer


def _create_recognizer(profile_key, detect_language):
    import sherpa_onnx

    profiles = _load_asr_profiles()
    profile = profiles.get(profile_key) or profiles.get("others") or profiles.get("default") or _fallback_asr_profile()
    if not _profile_configured(profile):
        raise HTTPException(status_code=503, detail="No Sherpa ASR model is configured")

    model_type = _profile_value(profile, "SHERPA_ASR_TYPE", "paraformer").lower()
    num_threads = int(_profile_value(profile, "SHERPA_ASR_NUM_THREADS", "4") or "4")
    provider = _profile_value(profile, "SHERPA_ASR_PROVIDER", "cpu")
    language = _profile_value(profile, "SHERPA_LANGUAGE", "")

    if model_type == "transducer":
        return sherpa_onnx.OfflineRecognizer.from_transducer(
            encoder=_require(_profile_value(profile, "SHERPA_ASR_ENCODER"), "SHERPA_ASR_ENCODER"),
            decoder=_require(_profile_value(profile, "SHERPA_ASR_DECODER"), "SHERPA_ASR_DECODER"),
            joiner=_require(_profile_value(profile, "SHERPA_ASR_JOINER"), "SHERPA_ASR_JOINER"),
            tokens=_require(_profile_value(profile, "SHERPA_ASR_TOKENS"), "SHERPA_ASR_TOKENS"),
            num_threads=num_threads,
            provider=provider,
        )
    elif model_type == "nemo_transducer":
        return sherpa_onnx.OfflineRecognizer.from_transducer(
            encoder=_require(_profile_value(profile, "SHERPA_ASR_ENCODER"), "SHERPA_ASR_ENCODER"),
            decoder=_require(_profile_value(profile, "SHERPA_ASR_DECODER"), "SHERPA_ASR_DECODER"),
            joiner=_require(_profile_value(profile, "SHERPA_ASR_JOINER"), "SHERPA_ASR_JOINER"),
            tokens=_require(_profile_value(profile, "SHERPA_ASR_TOKENS"), "SHERPA_ASR_TOKENS"),
            num_threads=num_threads,
            provider=provider,
            model_type="nemo_transducer",
        )
    elif model_type in {"online_transducer", "streaming_transducer"}:
        return sherpa_onnx.OnlineRecognizer.from_transducer(
            encoder=_require(_profile_value(profile, "SHERPA_ASR_ENCODER"), "SHERPA_ASR_ENCODER"),
            decoder=_require(_profile_value(profile, "SHERPA_ASR_DECODER"), "SHERPA_ASR_DECODER"),
            joiner=_require(_profile_value(profile, "SHERPA_ASR_JOINER"), "SHERPA_ASR_JOINER"),
            tokens=_require(_profile_value(profile, "SHERPA_ASR_TOKENS"), "SHERPA_ASR_TOKENS"),
            num_threads=num_threads,
            sample_rate=16000,
            feature_dim=80,
        )
    elif model_type == "zipformer_ctc":
        return sherpa_onnx.OfflineRecognizer.from_zipformer_ctc(
            model=_require(_profile_value(profile, "SHERPA_ASR_MODEL"), "SHERPA_ASR_MODEL"),
            tokens=_require(_profile_value(profile, "SHERPA_ASR_TOKENS"), "SHERPA_ASR_TOKENS"),
            num_threads=num_threads,
            provider=provider,
        )
    elif model_type == "wenet_ctc":
        return sherpa_onnx.OfflineRecognizer.from_wenet_ctc(
            model=_require(_profile_value(profile, "SHERPA_ASR_MODEL"), "SHERPA_ASR_MODEL"),
            tokens=_require(_profile_value(profile, "SHERPA_ASR_TOKENS"), "SHERPA_ASR_TOKENS"),
            num_threads=num_threads,
            provider=provider,
        )
    elif model_type == "nemo_ctc":
        return sherpa_onnx.OfflineRecognizer.from_nemo_ctc(
            model=_require(_profile_value(profile, "SHERPA_ASR_MODEL"), "SHERPA_ASR_MODEL"),
            tokens=_require(_profile_value(profile, "SHERPA_ASR_TOKENS"), "SHERPA_ASR_TOKENS"),
            num_threads=num_threads,
            provider=provider,
        )
    elif model_type == "dolphin_ctc":
        return sherpa_onnx.OfflineRecognizer.from_dolphin_ctc(
            model=_require(_profile_value(profile, "SHERPA_ASR_MODEL"), "SHERPA_ASR_MODEL"),
            tokens=_require(_profile_value(profile, "SHERPA_ASR_TOKENS"), "SHERPA_ASR_TOKENS"),
            num_threads=num_threads,
            provider=provider,
        )
    elif model_type == "sense_voice":
        return sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=_require(_profile_value(profile, "SHERPA_ASR_MODEL"), "SHERPA_ASR_MODEL"),
            tokens=_profile_value(profile, "SHERPA_ASR_TOKENS", ""),
            num_threads=num_threads,
            provider=provider,
            language=language or "auto",
            use_itn=_truthy(_profile_value(profile, "SHERPA_ASR_USE_ITN", "true")),
        )
    elif model_type == "whisper":
        return sherpa_onnx.OfflineRecognizer.from_whisper(
            encoder=_require(_profile_value(profile, "SHERPA_ASR_ENCODER"), "SHERPA_ASR_ENCODER"),
            decoder=_require(_profile_value(profile, "SHERPA_ASR_DECODER"), "SHERPA_ASR_DECODER"),
            tokens=_require(_profile_value(profile, "SHERPA_ASR_TOKENS"), "SHERPA_ASR_TOKENS"),
            language=detect_language or language or "en",
            task=_profile_value(profile, "SHERPA_ASR_TASK", "transcribe"),
            num_threads=num_threads,
            provider=provider,
        )
    elif model_type == "moonshine":
        return sherpa_onnx.OfflineRecognizer.from_moonshine(
            preprocessor=_require(_profile_value(profile, "SHERPA_ASR_PREPROCESSOR"), "SHERPA_ASR_PREPROCESSOR"),
            encoder=_require(_profile_value(profile, "SHERPA_ASR_ENCODER"), "SHERPA_ASR_ENCODER"),
            uncached_decoder=_require(_profile_value(profile, "SHERPA_ASR_UNCACHED_DECODER"),
                                      "SHERPA_ASR_UNCACHED_DECODER"),
            cached_decoder=_require(_profile_value(profile, "SHERPA_ASR_CACHED_DECODER"), "SHERPA_ASR_CACHED_DECODER"),
            tokens=_require(_profile_value(profile, "SHERPA_ASR_TOKENS"), "SHERPA_ASR_TOKENS"),
            num_threads=num_threads,
            provider=provider,
        )
    elif model_type == "omnilingual_asr_ctc":
        return sherpa_onnx.OfflineRecognizer.from_omnilingual_asr_ctc(
            model=_require(_profile_value(profile, "SHERPA_ASR_MODEL"), "SHERPA_ASR_MODEL"),
            tokens=_require(_profile_value(profile, "SHERPA_ASR_TOKENS"), "SHERPA_ASR_TOKENS"),
            num_threads=num_threads,
            provider=provider,
        )
    else:
        return sherpa_onnx.OfflineRecognizer.from_paraformer(
            paraformer=_require(_profile_value(profile, "SHERPA_ASR_MODEL"), "SHERPA_ASR_MODEL"),
            tokens=_require(_profile_value(profile, "SHERPA_ASR_TOKENS"), "SHERPA_ASR_TOKENS"),
            num_threads=num_threads,
            provider=provider,
        )


def _load_tts_profiles():
    raw = os.getenv("SHERPA_TTS_PROFILES", "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return {str(k): v for k, v in parsed.items() if isinstance(v, dict)}
    except Exception:
        return {}
    return {}


def _fallback_tts_profile():
    keys = [
        "SHERPA_TTS_NAME", "SHERPA_TTS_TYPE", "SHERPA_TTS_MODEL",
        "SHERPA_TTS_TOKENS", "SHERPA_TTS_VOICES", "SHERPA_TTS_LEXICON",
        "SHERPA_TTS_DATA_DIR", "SHERPA_TTS_DICT_DIR", "SHERPA_TTS_LANG",
        "SHERPA_TTS_NUM_THREADS", "SHERPA_TTS_PROVIDER", "SHERPA_TTS_MAX_SENTENCES",
    ]
    return {k: os.getenv(k, "") for k in keys if os.getenv(k, "")}


def _profile_key_for_tts_language(language: str) -> str:
    lang = _normalize_language_code(language)
    profiles = _load_tts_profiles()
    # 精确匹配
    if lang and lang in profiles:
        return lang
    # 常见语言直接映射
    direct = {"zh", "en", "es", "fr", "de", "pt", "ru", "ja", "ko", "vi", "th", "ar", "hi"}
    if lang in direct:
        return lang
    # 印地系兜底
    if lang in HINDI_LANGS:
        return "default"
    return "default"


_tts_cache: OrderedDict = OrderedDict()
MAX_TTS = 4   # 根据服务器内存调整
_tts_lock = None

def _get_tts_lock():
    global _tts_lock
    if _tts_lock is None:
        import threading
        _tts_lock = threading.Lock()
    return _tts_lock

def get_tts(profile_key="default"):
    import sherpa_onnx
    print(f"Getting TTS for profile_key: {profile_key}")

    cache_key = profile_key
    if cache_key in _tts_cache:
        _tts_cache.move_to_end(cache_key)
        return _tts_cache[cache_key]

    with _get_tts_lock():
        if cache_key in _tts_cache:
            return _tts_cache[cache_key]

        tts = _create_tts(profile_key)

        # 弹出最早的
        if len(_tts_cache) >= MAX_TTS:
            _tts_cache.popitem(last=False)

        _tts_cache[cache_key] = tts
        return tts



def _create_tts(profile_key: str = "default"):
    import sherpa_onnx

    profiles = _load_tts_profiles()
    profile = (
        profiles.get(profile_key)
        or profiles.get("default")
        or profiles.get("others")
        or _fallback_tts_profile()
    )
    if not profile or not profile.get("SHERPA_TTS_MODEL"):
        raise HTTPException(status_code=503, detail="No Sherpa TTS model is configured")

    tts_type = profile.get("SHERPA_TTS_TYPE", "vits").lower()
    model    = _require(profile.get("SHERPA_TTS_MODEL", ""), "SHERPA_TTS_MODEL")
    tokens   = _require(profile.get("SHERPA_TTS_TOKENS", ""), "SHERPA_TTS_TOKENS")
    num_threads = int(profile.get("SHERPA_TTS_NUM_THREADS") or 4)
    provider    = profile.get("SHERPA_TTS_PROVIDER", "cpu")
    print("tts_type:", tts_type, "  ", "model:", model)
    print("data:", profile.get("SHERPA_TTS_DICT_DIR", ""),
          "dict:", profile.get("SHERPA_TTS_DICT_DIR", ""))

    if tts_type == "kokoro":
        voices = _require(profile.get("SHERPA_TTS_VOICES", ""), "SHERPA_TTS_VOICES")
        model_config = sherpa_onnx.OfflineTtsModelConfig(
            kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
                model=model,
                voices=voices,
                tokens=tokens,
                lexicon=profile.get("SHERPA_TTS_LEXICON", ""),
                data_dir=profile.get("SHERPA_TTS_DATA_DIR", ""),
                dict_dir=profile.get("SHERPA_TTS_DICT_DIR", ""),
                lang=profile.get("SHERPA_TTS_LANG", ""),
            ),
            num_threads=num_threads,
            provider=provider,
        )
    elif tts_type == "kitten":
        voices = _require(profile.get("SHERPA_TTS_VOICES", ""), "SHERPA_TTS_VOICES")
        model_config = sherpa_onnx.OfflineTtsModelConfig(
            kitten=sherpa_onnx.OfflineTtsKittenModelConfig(
                model=model,
                voices=voices,
                tokens=tokens,
                data_dir=profile.get("SHERPA_TTS_DATA_DIR", ""),
            ),
            num_threads=num_threads,
            provider=provider,
        )
    else:
        lexicon  = profile.get("SHERPA_TTS_LEXICON", "")
        data_dir = profile.get("SHERPA_TTS_DATA_DIR", "")
        dict_dir = profile.get("SHERPA_TTS_DICT_DIR", "")
        if not lexicon and not data_dir:
            inferred_lexicon = _find_lexicon_file(os.path.dirname(model))
            if inferred_lexicon:
                lexicon = inferred_lexicon
        if not lexicon and not data_dir:
            raise HTTPException(
                status_code=503,
                detail=(
                    "Selected VITS TTS model requires a lexicon or data_dir. "
                    "Please download/select a complete Sherpa TTS preset."
                ),
            )
        model_config = sherpa_onnx.OfflineTtsModelConfig(
            vits=sherpa_onnx.OfflineTtsVitsModelConfig(
                model=model,
                tokens=tokens,
                lexicon=lexicon,
                data_dir=data_dir,
                dict_dir=dict_dir,
            ),
            num_threads=num_threads,
            provider=provider,
        )

    config = sherpa_onnx.OfflineTtsConfig(
        model=model_config,
        max_num_sentences=int(profile.get("SHERPA_TTS_MAX_SENTENCES") or os.getenv("SHERPA_TTS_MAX_SENTENCES", "1") or 1),
    )
    return sherpa_onnx.OfflineTts(config)


@app.post("/audio/transcriptions")
@app.post("/v1/audio/transcriptions")
async def transcriptions(
        request: Request,
        file: UploadFile = File(...),
        model: str = Form(default="sherpa-asr"),
        language: str | None = Form(default=None),
        language_candidates: str | None = Form(default=None),
        stream_id: str | None = Form(default=None),
        chunk_index: int | None = Form(default=None),
        reset_stream: bool = Form(default=False),
):
    suffix = os.path.splitext(file.filename or "audio.wav")[1] or ".wav"
    data = await file.read()
    is_stream_chunk = bool(stream_id or chunk_index is not None)
    if is_stream_chunk and len(data) < 2048:
        return {
            "text": "",
            "language": "",
            "profile": "default",
            "language_detected": False,
            "skipped": True,
            "reason": "audio chunk too small",
        }

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(data)
        tmp_path = tmp.name

    try:
        samples, sample_rate = load_audio_robust(Path(tmp_path))

        detected_language = ""
        profile_key = "default"
        try:
            detected_language, profile_key, detected_now = _resolve_asr_profile_for_request(
                request,
                samples,
                language=language,
                language_candidates=language_candidates,
                stream_id=stream_id or "",
                reset_stream=reset_stream or chunk_index == 0,
            )
        except Exception as e:
            print(f"Error resolving ASR profile: {e}")
            detected_now = False
            profile_key = "default"

        print(f"Using ASR profile: {detected_language}")
        recognizer = get_recognizer(profile_key, detected_language)

        if is_stream_chunk and samples.size < int(sample_rate * 0.12):
            return {
                "text": "",
                "language": detected_language,
                "profile": profile_key,
                "language_detected": detected_now,
                "skipped": True,
                "reason": "audio chunk too short",
            }

        stream = recognizer.create_stream()
        stream.accept_waveform(int(sample_rate), samples)
        if hasattr(recognizer, "is_ready"):
            tail_paddings = np.zeros(int(0.6 * sample_rate), dtype=np.float32)
            stream.accept_waveform(int(sample_rate), tail_paddings)
            if hasattr(stream, "input_finished"):
                stream.input_finished()
            while recognizer.is_ready(stream):
                recognizer.decode_stream(stream)
            result = recognizer.get_result(stream)
            text = (getattr(result, "text", result) or "").strip()
        else:
            if hasattr(stream, "input_finished"):
                stream.input_finished()
            recognizer.decode_stream(stream)
            text = stream.result.text.strip()
        return {
            "text": text,
            "language": detected_language,
            "profile": profile_key,
            "language_detected": detected_now,
        }
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


@app.post("/audio/speech")
@app.post("/v1/audio/speech")
async def speech(payload: dict):
    text = payload.get("input") or payload.get("text") or ""
    if not text.strip():
        raise HTTPException(status_code=400, detail="input is required")

    language = payload.get("language") or ""
    if not language:
        try:
            language = fast_detect_language(text).lower()
        except Exception:
            language = os.getenv("SHERPA_TTS_DEFAULT_LANG", "en")

    profile_key = _profile_key_for_tts_language(language)
    tts = get_tts(profile_key)

    sid = int(payload.get("voice") or os.getenv("SHERPA_TTS_SID", "0") or 0) if str(
        payload.get("voice") or os.getenv("SHERPA_TTS_SID", "0")).isdigit() else 0
    speed = float(payload.get("speed") or os.getenv("SHERPA_TTS_SPEED", "1.0") or 1.0)

    try:
        audio = tts.generate(text, sid=sid, speed=speed)
    except RuntimeError:
        audio = tts.generate(text, sid=0, speed=speed)

    with io.BytesIO() as buf:
        sf.write(buf, audio.samples, audio.sample_rate, format="WAV")
        return Response(content=buf.getvalue(), media_type="audio/wav")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=39384)
    args = parser.parse_args()

    import uvicorn
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
`
