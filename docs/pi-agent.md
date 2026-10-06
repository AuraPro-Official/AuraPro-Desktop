# PI Agent integration

Desktop manages PI 1.0.3 and its extensions; WebUI owns model settings, conversations, tool confirmations, streamed answers, tool results, screenshots and workspace diffs. PI uses the model selected in the normal WebUI model selector. Requests pass through WebUI's existing model dispatcher; no separate PI API URL, key or model settings exist. PI and Node are downloaded separately and are not included in the Python wheel.

## Use

1. Install and start **PI Agent** in Desktop settings.
2. In WebUI, select your model as usual, enable PI Agent and select a workspace. Connections and API keys are managed in the normal WebUI model settings.
3. Install the supported extensions from Desktop settings. Browser uses a fixed commit of `larsderidder/pi-browser` (Git required); Computer Use uses `@injaneity/pi-computer-use@0.5.1`.
4. Browser requires Chrome/Edge running with remote debugging on port 9222 and a separate browser profile. The internal extension check endpoint executes `browser_tabs` and `find_roots` directly, without a model; a failed check means the extension still needs configuration.
5. Runtime changes restart existing PI processes on their next request and load the new extensions. `/browser connect 9222`, `/browser status` and `/computer-use` are available through WebUI chat. Browser tools connect when first used, so file tasks do not produce browser connection errors.

For desktop tasks, enter a normal instruction such as `帮我打开 D 盘文件夹`. `/computer-use 帮我打开 D 盘文件夹` and the same input without a separating space are also accepted as model tasks. `/computer-use` by itself shows extension configuration. Task submission returns before extension preflight completes so confirmation requests can be answered in WebUI; startup failures and timeouts are reported as visible errors.

The native PI release is used without extensions. With extensions, Desktop installs the same official PI version under a managed Node runtime because Playwright CDP connections timed out under the native runtime in Windows testing. Both paths use the same PI RPC protocol. Extension UI confirmation/select/input/editor requests are forwarded into WebUI. Extensions requiring a custom terminal UI need an explicit WebUI adapter before adding them to the supported catalog.

## File changes and permissions

Enabling Agent mode shows the working folder and approval selector at the lower left of the message input. Desktop opens its native folder picker; browser-only use accepts a folder path validated by the backend. The selectors are disabled during an active task. Automatic approval does not prompt at task startup or for read-only tools. It asks when the first operation requires approval; acceptance approves all subsequent operation confirmations in that task, including extension confirmations, until the task ends. Full control skips even this first confirmation. Input/select/editor requests remain interactive. Workspace scope and plan-mode restrictions still apply. The selected mode is saved with the conversation and applies to subsequent tasks.

WebUI passes its current interface language with each task. PI is instructed to use it for user-facing progress, operation explanations, visible reasoning summaries, questions and final answers (Simplified Chinese for zh-CN, Traditional Chinese for zh-TW). Explicit user requests for another output language take precedence. Common tool labels and connection statuses use WebUI translations. Literal commands, paths, source text and raw extension logs remain unchanged; model compliance with the language instruction depends on the selected model.

File tools are restricted to the selected workspace, including resolved symlinks. Plan mode exposes only read/grep/find/ls. WebUI's PI menu offers task approval (default) or confirmation for each action. Task approval asks once at the beginning and expires when that task ends. Observed routine navigation, including recognized folder clicks and right clicks, may then proceed automatically. Deletion, sending, submission, file writes, shell commands and unrecognized actions still require separate confirmation. This policy uses a conservative allowlist; it does not guarantee detection of every dangerous UI action. This is a tool permission layer, not an operating system sandbox: a confirmed shell or computer action can affect resources outside the workspace.

Only one task per workspace runs at a time. File snapshots exclude dependency directories, symlinks, files over 2 MiB, and files beyond the 64 MiB / 10,000 file budget. Revert/restore checks current contents before writing and refuses conflicting user changes. It restores displayed workspace files only; it does not undo browser/desktop actions or rewind PI conversation history.

The supported extension checks verify browser connectivity and desktop access. They do not guarantee every application, website or model can complete every task. Desktop control requires an interactive desktop and, on macOS, the required system permissions.

## Compatibility and verification

PI automatic context compaction is enabled for Agent tasks. Summary and recent-history budgets scale with the WebUI-selected model's context window. WebUI shows compaction start/end progress and keeps the task active while PI resumes after an overflow. Recoverable model errors are reported as failures only after PI settles without recovery. Task approval survives intermediate runs and expires on full settlement. Context compaction does not remove a model's per-response output limit: oversized file writes still need bounded chunks.

Legacy `opencode` IPC, API paths and chat metadata keys remain for saved-data compatibility. They dispatch to PI; the old desktop OpenCode installer has been removed. Old OpenCode conversations are given a new PI session on the next task. Existing OpenCode files on disk are not deleted automatically.

Verified on Windows with the actual PI 1.0.3 runtime: Unicode file writes, approval/decline, select/input/editor/cancel, diffs, revert/restore, conflict protection and session recovery. Installed WebUI chat passed a real model write task with a visible approval dialog and file diff line numbers. Browser extension navigation/form actions and desktop extension input/button actions passed isolated fixture tests. See [installed test report](pi-installed-test-report.md) for exact coverage and limitations. Both desktop and WebUI production builds succeeded. The repository-wide WebUI type check still has existing errors outside the new PI components.

Upstream sources: https://github.com/earendil-works/pi (MIT), https://github.com/larsderidder/pi-browser (MIT), https://www.npmjs.com/package/@injaneity/pi-computer-use. Runtime downloads preserve their upstream license files; extension packages retain their own license files.
