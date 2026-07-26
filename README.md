# AuraPro Desktop

**English** | [Simplified Chinese](README.zh-CN.md)

[![Release](https://img.shields.io/github/v/release/AuraPro-Official/AuraPro-Desktop?display_name=tag&sort=semver&label=release)](https://github.com/AuraPro-Official/AuraPro-Desktop/releases)
[![Build](https://img.shields.io/github/actions/workflow/status/AuraPro-Official/AuraPro-Desktop/release.yml?branch=release&label=build)](https://github.com/AuraPro-Official/AuraPro-Desktop/actions/workflows/release.yml)
[![License](https://img.shields.io/badge/license-AGPL--3.0-2563eb)](LICENSE)
[![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-475569)](#supported-platforms)

AuraPro Desktop is the cross-platform desktop client for AuraPro. It provides a unified installation and management experience for local AI inference, translation, voice interaction, knowledge bases, and remote service connections.

![AuraPro Desktop](./demo.png)

## Overview

AuraPro Desktop installs, launches, and manages AuraPro local services and optional runtime components. Users can run models locally, connect to remote AuraPro services, and manage models, glossaries, voice capabilities, and runtime logs from one application.

The application uses a modular installation model. Large runtimes, models, and official glossaries are installed or updated on demand instead of being embedded in the base installer.

## Key Features

- Local inference: Run GGUF models with llama.cpp using CPU, Metal, or NVIDIA CUDA variants.
- Remote connections: Add and switch between multiple AuraPro service endpoints.
- Model management: Download, import, verify, and manage local models and related files.
- Translation tools: Use glossaries, translation modes, context settings, and multilingual workflows.
- Voice capabilities: Run local speech recognition and text-to-speech with Sherpa.
- Knowledge bases: Import, index, and retrieve information from documents.
- Desktop tools: Use Spotlight, global shortcuts, screenshots, and voice input.
- Runtime diagnostics: Inspect runtimes, models, GPUs, drivers, file integrity, and common installation problems.
- Independent component updates: Install and update inference runtimes, voice components, and official glossaries separately.

## Supported Platforms

| Operating system  | Architecture         | Release formats          |
| ----------------- | -------------------- | ------------------------ |
| Windows 10/11     | x64, ARM64           | NSIS `.exe`              |
| macOS 12 or later | Apple Silicon, Intel | `.dmg`, `.zip`           |
| Linux             | x64, ARM64           | AppImage, Debian package |
| Linux x64         | x64                  | Snap, Flatpak            |

Component availability may vary by platform and architecture. Refer to the [Releases](https://github.com/AuraPro-Official/AuraPro-Desktop/releases) page for the files included in each release.

## Installation and Use

1. Download the installer for your operating system and architecture from [Releases](https://github.com/AuraPro-Official/AuraPro-Desktop/releases).
2. Start AuraPro and choose whether to connect to an existing service or install a local service.
3. Select models, local inference, voice support, and other optional components in the setup wizard.
4. After setup, use Settings to manage runtimes, models, glossaries, connections, and updates.

An internet connection is required when installing local components and models for the first time. Once installed, local features can operate without a remote service.

### Windows Path Requirements

Some local components do not currently support paths containing Chinese characters or other non-ASCII characters. On Windows, select an installation path containing only Latin letters, numbers, spaces, hyphens, and underscores.

### Official Glossaries

Official Glossaries are available as a separate limited-beta component and are not included in the desktop installer. Beta participants can open **Settings > Glossaries**, enter a beta access code, and install, repair, or update the glossary package. The access code is used only for the current request and is not stored in local configuration.

When an Official Glossaries package is installed, each desktop update check also checks its public version metadata. If a newer package is available, AuraPro shows a notification and directs the user to **Settings > Glossaries**; downloading the beta package still requires an access code.

## Local Components

| Component             | Purpose                                           | Installation                        |
| --------------------- | ------------------------------------------------- | ----------------------------------- |
| AuraPro local service | Chat, translation, knowledge bases, and user data | Setup wizard                        |
| llama.cpp             | Local large language model inference              | Optional                            |
| CUDA Runtime          | Runtime libraries for NVIDIA GPU inference        | Installed with a CUDA variant       |
| Sherpa                | Local speech recognition and text-to-speech       | Optional                            |
| Open Terminal         | Local terminal service                            | Optional                            |
| Official glossaries   | Protected multilingual glossary package           | Authorized installation in Settings |

## Data and Security

- Local service data, models, and user configuration are stored in the selected local data directory by default.
- When using remote services or third-party model providers, data handling depends on the configuration and privacy policy of those services.
- Official glossary downloads use HTTPS, access authentication, and SHA-256 integrity verification.
- Runtime and model installers validate required files and provide diagnostics or recovery actions when installation fails.
- Code-signing status depends on the signature attached to each platform-specific release package.

## Development

### Requirements

- Node.js 22
- npm
- Git
- Native build tools for the target platform

Building native dependencies such as `node-pty` on Windows requires Visual Studio Build Tools with the **Desktop development with C++** workload.

### Local Development

```bash
npm ci
npm run dev
```

### Validation and Build

```bash
npm run typecheck
npm run build
```

Build platform-specific packages:

```bash
npm run build:win
npm run build:mac
npm run build:linux
```

### Available Scripts

| Command                | Description                                  |
| ---------------------- | -------------------------------------------- |
| `npm run dev`          | Start the desktop development environment    |
| `npm run typecheck`    | Run Node.js and Svelte type checks           |
| `npm run lint:ci`      | Enforce ESLint errors and the warning budget |
| `npm run build`        | Create a production build                    |
| `npm run build:unpack` | Create an unpacked desktop application       |
| `npm run build:win`    | Build Windows packages                       |
| `npm run build:mac`    | Build macOS packages                         |
| `npm run build:linux`  | Build Linux packages                         |
| `npm run format`       | Format the project with Prettier             |
| `npm run lint`         | Run ESLint                                   |

## Project Structure

```text
src/
  main/       Electron main process, component installation, and system integration
  preload/    Secure interfaces between the main and renderer processes
  renderer/   Desktop user interface
build/        Installer assets, permissions, and signing configuration
data/         Initial local data for new installations
resources/    Application icons and static assets
.github/      Automated build and release workflows
```

## Release Process

GitHub Actions builds Windows, macOS, and Linux packages. A push to the `release` branch runs type checks, packages all supported platforms, and creates a Pre-release. Installation, upgrade, signing, and core functionality should be verified before promoting a version to a production Release.

See [CHANGELOG.md](CHANGELOG.md) for version history.

## Reporting Issues

Before submitting an issue, confirm that you are using a supported version and include your operating system, architecture, AuraPro version, relevant logs, and reproducible steps.

- [Report an issue](https://github.com/AuraPro-Official/AuraPro-Desktop/issues)
- [View releases](https://github.com/AuraPro-Official/AuraPro-Desktop/releases)

## Project Policies

- [Contribution guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Support policy](SUPPORT.md)
- [Code of conduct](CODE_OF_CONDUCT.md)

## License

AuraPro Desktop is released under the [GNU Affero General Public License v3.0](LICENSE). Third-party components remain subject to their respective licenses. See [NOTICE](NOTICE) for copyright attribution and distribution information.
