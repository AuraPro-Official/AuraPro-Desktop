# Inference Runtime Pro

## Routing and lifecycle

- Standard llama.cpp keeps port 18881; Strata uses loopback port 18882. Neither moves to another port for this integration.
- WebUI exposes the stable `aurapro-pro` model ID with display name `Pro_V1`, independently of whether Strata is running.
- The actual Pro model is chosen in Desktop settings. Loading conversation history alone does not switch runtimes.
- Active WebUI requests hold a runtime lease, including the lifetime of streaming responses. Switching waits for leases to finish; a failed stop prevents starting the other engine.
- A private loopback control listener uses a random port and bearer token passed only to the managed WebUI process. This is a control channel, not an inference proxy. External API connections are not managed.
- A missing/unprepared Pro installation is rejected before stopping a working standard runtime.

## Installation and models

Pro keeps its own Python virtual environments, runtime directories and prepared model data under `<installDir>/strata`. It does not install packages into WebUI's Python environment.

The first-install model picker includes the managed Pro presets on supported platforms. Choosing one installs Pro instead of standard llama.cpp and persists `inferenceRuntime: pro` for subsequent launches. Shared Python, WebUI and optional speech components still use their normal installation paths. Hardware notes use the same RAM+VRAM format as standard models; they are recommendations, not guaranteed minimums or throughput claims. No UMA support is implied.

Diagnostics inspect the active runtime first, otherwise the preferred runtime (or Pro when it is the only installed engine). A Pro-only installation does not trigger standard llama.cpp repairs. Pro failures remain visible and direct users to Pro settings rather than installing the other engine.

The initial source revision is `99f3dbd0b21d1401b3769e0c0d963913607f380b` from [Strata](https://github.com/Niko1221/Strata). Explicit updates use the latest stable release. Install/repair builds a separate directory and replaces the active installation record only after successful preparation. Old directories are retained for recovery; no automatic destructive cleanup is performed.

The managed catalog covers the eight presets in that upstream setup script:

- Qwen3.8-Flash-Next: Q2_0, IQ2_XS, IQ3_XXS, IQ3_S.
- Swift 1.5: IQ2_XS, IQ3_XXS.
- Qwen3.8-Flash-Next Coder: IQ1_M.
- Unsloth Qwen3.8-Flash-Next: UD-Q4_K_XL (experimental, CUDA only, no image input).

Model preparation delegates to upstream setup, including resumable shards, auxiliary files and conversion. Cancellation terminates the whole preparation process tree. A prepared model is selected only after setup succeeds. Upstream download sizes exclude some auxiliary files and conversion storage.

Manual-conversion/community models outside the upstream setup catalog are not yet exposed as managed presets. Pro does not accept ordinary llama.cpp GGUF presets directly.

## Constraints

- Windows/Linux x64 and AVX2 are required. macOS and Arm are not supported by this integration.
- CUDA installation uses upstream GPU/driver checks. The pinned release uses CUDA 13 libraries and requires an appropriate NVIDIA driver.
- Windows HIP uses upstream prebuilt assets. Linux HIP source builds are not automated; a missing prebuilt runtime produces an error instead of silently installing a compiler/toolkit.
- The upstream serving engine requires its MTP draft layer. Pro cannot reuse the ordinary runtime's MTP-off setting.
- Context and KV precision are separate from the ordinary runtime settings. Changing active Pro settings waits for requests, then restarts Pro.
- Direct clients bypassing WebUI do not acquire Desktop leases. Do not switch Desktop runtimes while a separate client is using a runtime directly.

## Verification

- `npm run test:inference-pro`: coordinator and catalog/argument tests.
- `python -m unittest discover -s backend/tests -p test_inference_runtime.py -v` in WebUI: lease and stream cleanup tests.
- `node scripts/test-pro-ui.mjs`: isolated settings and first-install previews using mock IPC, Playwright and installed Chrome; asserts that Pro setup never calls standard model downloads or llama.cpp startup. Set `PRO_TEST_BROWSER` to another installed Playwright browser channel if needed.
- Real GPU model loading, large resumable downloads and platform-specific packaged installations still require hardware acceptance testing before release. Mock UI tests do not establish inference performance or GPU compatibility.
