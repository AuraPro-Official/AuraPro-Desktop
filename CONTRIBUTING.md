# Contributing to AuraPro Desktop

Thank you for contributing to AuraPro Desktop. This guide describes the
minimum quality, security, and review requirements for changes to the project.

## Before You Start

- Search existing issues and pull requests before opening a duplicate.
- Use an issue to discuss changes that affect architecture, compatibility,
  security, data migration, packaging, or user-facing behavior.
- Report security vulnerabilities through the process in [SECURITY.md](SECURITY.md),
  not through a public issue.
- Keep pull requests focused. Unrelated refactoring should be submitted
  separately.

## Development Setup

Requirements:

- Node.js 24 LTS
- npm 12
- Git
- Native build tools for the target platform

Install dependencies and start the development environment:

```bash
npm ci
npm run dev
```

On Windows, native dependencies require Visual Studio Build Tools with the
**Desktop development with C++** workload.

## Branches and Commits

Create branches from the current development branch and use descriptive names:

```text
feature/glossary-management
fix/windows-installer-progress
docs/security-policy
```

Write concise, imperative commit subjects. Conventional Commit prefixes are
recommended:

```text
feat: add glossary package verification
fix: preserve runtime settings during migration
docs: clarify Windows build requirements
```

Do not commit credentials, signing certificates, user databases, downloaded
models, build outputs, dependency directories, or personal configuration.

## Required Validation

Run the checks relevant to your change:

```bash
npm run typecheck
npm run lint
npm run lint:ci
npm run build
```

The CI lint command enforces the current legacy warning budget. Changes must
not increase that budget, and warnings in modified code should be resolved
where practical.

Packaging changes should also be tested with the applicable platform command:

```bash
npm run build:win
npm run build:mac
npm run build:linux
```

Document any check that could not be completed and explain why.

## Pull Requests

A pull request should include:

- A clear problem statement and implementation summary.
- Links to related issues.
- Automated and manual validation results.
- Screenshots for visible interface changes.
- Migration and rollback considerations for persistent data changes.
- Documentation and changelog updates for user-visible changes.

Maintainers may request changes for correctness, security, accessibility,
compatibility, maintainability, or release readiness.

## Licensing

By contributing, you confirm that you have the right to submit the work and
agree that your contribution will be distributed under the license of this
repository. Third-party code must retain all required copyright and license
notices.
