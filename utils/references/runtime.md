# Runtime setup

These skills run in Claude Code and OpenAI Codex. Determine the host from the
session, not from files in the consumer repository (both configurations can exist).

Resolve `UTILS_PLUGIN_ROOT` from the real loaded `skills/<name>/SKILL.md`: two
levels above its directory. Resolve symlinks before taking parents. Claude's
`CLAUDE_PLUGIN_ROOT`, when supplied, must refer to this same utils package.
Replace `${UTILS_PLUGIN_ROOT}` in paths with that absolute directory. Shell tool
calls may start fresh: use absolute quoted paths or explicitly assign the variable
in each call, never assume an earlier shell assignment persists. Execute helpers
from the consumer repository, not the plugin checkout.

| Procedure notation | Claude Code | Codex |
|---|---|---|
| `/utils:<name> <arguments>` | existing skill command | `$utils:<name> <arguments>` (the plugin skill selector) |
| `Read`, `Glob`, `Grep` | native tools | available file tools or shell `rg`/file reads |
| `Edit`, `Bash` | native tools | available edit/patch and shell execution tools |
| `AskUserQuestion` | native question tool | available user-input tool, otherwise ask in chat and wait |

Take arguments from the invocation message. `allowed-tools` and `argument-hint`
frontmatter describe Claude capabilities; they do not create tools or permissions
in Codex. Follow the actual session's permissions. A required approval stays
pending until the user answers. Group questions to fit the tool's real limits;
use text for unsupported multi-select. Do not turn elapsed time into consent.

Read `AGENTS.md` or `CLAUDE.md` as applicable for project conventions. Existing
workflow boundaries still apply: `--origin` opts into remote branch deletion,
`--apply` opts into PR-body replacement and majors require their stated approval.
`cleanup-branches` has no `--dry-run`; reject unsupported flags as its skill says.

`DEPENDABOT_REQUIRED_CHECKS` comes from the helper process environment. In Codex,
export it in the shell running the helper, for example:

```bash
DEPENDABOT_REQUIRED_CHECKS='Lint,Build' python3 '<resolved utils root>/skills/cleanup-dependabot/scripts/dependabot.py' list
```

Use the project's actual required checks. Claude users may also supply the same
variable through `.claude/settings.json`'s `env`. Never invent a green CI result
when a helper, `gh`, authentication or a required check is unavailable.
