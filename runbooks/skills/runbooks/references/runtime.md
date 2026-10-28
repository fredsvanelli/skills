# Runtime setup

Runbooks supports Claude Code and OpenAI Codex with shared procedures. Read this
before any direct command or skill. The host is the active session, not whichever
configuration file happens to exist in the consumer project.

## Paths and arguments

- Set `RUNBOOKS_RUNTIME` to `claude` or `codex` from the session. Keep it in every
  subagent brief and every model-helper call.
- Resolve `RUNBOOKS_PLUGIN_ROOT` from the real loaded entry path: the package
  containing `commands/`, `skills/` and `scripts/runbooks.mjs`. Resolve symlinks
  first. For `skills/<name>/SKILL.md` and `codex-skills/<name>/SKILL.md`, the root
  is two levels above the containing directory; for `commands/<name>.md` one,
  and for `commands/roles/<name>.md` two. Claude's supplied
  `CLAUDE_PLUGIN_ROOT` may be used after checking it is this package.
- Replace `${RUNBOOKS_PLUGIN_ROOT}` with the resolved absolute path when reading
  files. For shell examples, either use the absolute quoted path or explicitly
  assign the variable in that same shell call. Neither root nor runtime shell
  variables are assumed to persist across calls.
- Keep the working directory at the consumer project. Do not `cd` into the plugin
  to run its helper: that changes which project's runbooks/config it reads.
- On Claude, arguments come from `$ARGUMENTS`; on Codex, from the user's invocation
  message. Parse the actual arguments, not a literal `$ARGUMENTS` placeholder.
- `/runbooks:roles:create` and `$runbooks:runbooks-roles-create` name the same procedure.
  Other command names map by replacing colons with hyphens after `runbooks-`, with the `runbooks:` plugin namespace shown by Codex.
  Internal command calls mean read/dispatch that procedure, not execute slash
  syntax in a shell. The general `$runbooks:runbooks` skill can route natural-language
  requests too. `runbooks:scenarios` means the shared scenarios skill; when no
  skill-invocation tool exists, read its `SKILL.md` directly.

## Tools and questions

| Procedure notation | Claude Code | Codex |
|---|---|---|
| `Read`, `Glob`, `Grep` | native tools | available file tools or shell reads/`rg` |
| `Edit`, `Write`, `Bash` | native tools | available edit/patch and shell execution |
| `AskUserQuestion` | native question tool | available user-input tool; otherwise chat and wait |
| `Agent`, `SendMessage`, `Task*` | native agent tools | actual spawn, message, resume/followup and wait tools |

Tool names in procedures are capabilities, not a requirement to invent unavailable
tools. Obey the session's permissions. Split question rounds to fit the available
tool's limits. If multi-select is unsupported, ask for names in text. Required
approvals stay pending until answered; neither a timeout nor an empty response
is approval. Subagent lifecycle and model selection are in [agents.md](agents.md).

For browsers, discover the session's MCP tools by server identity/capability;
prefixes vary by host. Use the configured Playwright server only if its tools are
available. Claude in Chrome is an option only when that integration is present.
No browser means offer guided execution, a prompt, or an existing automated test
when suitable; let the user choose. Never report an unexecuted run as passed.

## Host configuration

Shared runbooks data/config remain in the consumer project. Host files differ:

| Purpose | Claude Code | Codex |
|---|---|---|
| Project MCP | `.mcp.json`, `mcpServers` | `.codex/config.toml`, `[mcp_servers.<name>]` |
| Project instructions | existing `AGENTS.md`/`CLAUDE.md` convention | `AGENTS.md` |
| Model rows | `models` | `codex.models` |
| Plugin registration | `.claude/settings.json` | installed plugin; optionally `[plugins."runbooks@<marketplace>"]` in project TOML |

In setup/settings, references to MCP configuration mean the active host's file.
On Codex read existing project TOML and the session's configured MCP servers;
do not read `.mcp.json` as Codex's active configuration or write Claude settings.
Merge only selected server tables and preserve unrelated keys, servers, comments
and plugin entries. Show the diff before changes that require approval. Project
Codex config is effective only in a trusted project; explain trust/restart when
needed rather than bypassing it.

Translate the JSON templates, not their syntax: `command` and `args` become keys
in `[mcp_servers.<name>]`. Keep the pinned package and all arguments. Resolve
`--secrets` and `--output-dir` paths against the consumer project so execution
from another directory cannot redirect them. For a stdio server, environment
variable names to forward go in `env_vars`; nonsecret fixed values can go in
`[mcp_servers.<name>.env]`. A remote server uses `url`; a bearer secret uses
`bearer_token_env_var`, not `${TOKEN}` interpolation. Do not assume TOML expands
shell variables. Never put secret values in versioned files. Check the secrets
file is ignored before configuring a server that reads it.

For a design server whose authentication template cannot be represented with the
host's supported options, use its documented OAuth/setup flow or exported design
files with the user's choice; do not write a nonfunctional server declaration.

On Codex, create `AGENTS.md` if absent, even when `CLAUDE.md` exists. If either is a
symlink to the other, update the real file once, so `AGENTS.md` still resolves.
If `AGENTS.md` is a dangling symlink to `CLAUDE.md`, create its target. Preserve
existing content and runbooks markers. Do not copy unrelated Claude instructions
into AGENTS.md automatically. On Claude retain the existing selection convention.

## Model configuration

Every `model`/`models` helper invocation passes `--runtime <active host>` explicitly.
A helper without that flag retains Claude compatibility. Setup writes/updates only
the active host's model block, using `models --defaults` and `models --diff` with
that flag. Preserve the other block. A legacy project with no `codex.models` uses
Codex defaults in memory; it does not reinterpret its Claude aliases.

Codex defaults use `inline` for main-session work and `inherit` for delegation.
Explicit model IDs must be available in the session. Codex row ties select the
first equally specific matching row; they do not guess capability from model
names. Settings shows only supported choices, while allowing an explicit ID to
be checked before use. Never translate a Claude alias to a guessed OpenAI model.
