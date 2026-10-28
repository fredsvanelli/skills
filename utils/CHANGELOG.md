# Changelog

## 0.4.0 — 2026-10-28

### Added

- OpenAI Codex support alongside Claude Code for `cleanup-branches`, `cleanup-dependabot` and `generate-pr-description`.
- Codex plugin packaging and marketplace registration, with installation and namespaced invocation examples.
- Shared runtime guidance for resource paths, file/shell tools and user questions on both hosts.

### Changed

- Resolve helpers from the loaded skill's location without requiring `CLAUDE_PLUGIN_ROOT`.
- Document `DEPENDABOT_REQUIRED_CHECKS` as a process environment variable, with Claude settings remaining an optional source; update the missing-variable diagnostic accordingly.
- Recognize `AGENTS.md` alongside `CLAUDE.md` for project conventions.

### Compatibility

Existing Claude commands and workflow boundaries remain unchanged: remote branch deletion needs `--origin`, PR-body updates need `--apply`, and major Dependabot updates retain their approval requirement. `cleanup-branches` still rejects unsupported `--dry-run`.

Restart the host after updating the plugin. No project data migration is required.
