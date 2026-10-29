# Changelog

## 1.17.1 — 2026-10-28

### Fixed

- Codex setup now inspects local model availability and selects explicit models by task complexity instead of silently copying inherited session defaults. Reconfiguration reviews legacy inheritance rows and shows the proposed routing.

## 1.17.0 — 2026-10-28

### Added

- OpenAI Codex support alongside Claude Code, with a Codex marketplace entry, plugin manifest and 26 command skills that reuse the existing procedures.
- Separate `codex.models` configuration, `--runtime codex` model resolution, inherited session models and explicit supported model IDs. Existing Claude model configuration keeps its behavior.
- Codex setup/settings for `.codex/config.toml` and `AGENTS.md`, native subagent dispatch/resumption, and host-specific upgrade instructions.
- Packaging, path portability and model-isolation tests, plus installation and invocation documentation for both hosts.

### Changed

- Resolve plugin resources from the loaded entry's location rather than requiring `CLAUDE_PLUGIN_ROOT`.
- Adapt questions and browser discovery to the tools available in the active host. Missing tools never imply a successful execution.
- Use exported design files when the Artifact integration is absent; inspect the active host's MCP configuration when recommending next steps.
- Apply the setup commit policy explicitly to Codex project configuration.

### Upgrade

Restart the host after updating the plugin, then run setup (`/runbooks:setup` on Claude or `$runbooks:runbooks-setup` on Codex) to refresh the project's generated UI and upstream server copies to 1.17.0. Existing runbook data and Claude model rows remain supported.

[Release comparison](https://github.com/fredsvanelli/skills/compare/runbooks-v1.15.0...runbooks-v1.17.0) includes the previously unreleased 1.16.x changes below.

## 1.16.2 — 2026-10-28

- Handle multiline, side-effect and double-quoted imports when generating the UI copy, skip paths in comments/strings, and reject dynamic imports.
- Report temporary-directory write failures clearly and handle UI-copy errors or a project-customized `runbooks:ui` script.
- Stop the npm-started UI server when its parent exits while preserving direct-node usage.

## 1.16.1 — 2026-10-28

- Stop the upstream server when its npm parent exits, preventing a leftover process from holding the port. Direct-node execution remains suitable for CI.

## 1.16.0 — 2026-10-28

- Generate a standalone UI server copy in the consumer project and start it through `npm run runbooks:ui`.
- Add `ui-copy` to write/check that copy and add the UI script alongside `runbooks:upstream`.
- Replace only the package script explicitly approved by the user through `package-script --only`.

Earlier release notes are available in [GitHub Releases](https://github.com/fredsvanelli/skills/releases).
