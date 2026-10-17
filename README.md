# fredsvanelli/skills

Claude Code plugin marketplace. Each folder is one plugin, installed on its own.

| Plugin | Commands | Does |
|---|---|---|
| [`runbook`](runbook/) | `/runbook:*` | UAT runbooks kept as a project's verified knowledge base |
| [`utils`](utils/) | `/utils:*` | repo housekeeping: merged branches, Dependabot PR queue |

## Install

    claude plugin marketplace add fredsvanelli/skills
    claude plugin install runbook@fredsvanelli
    claude plugin install utils@fredsvanelli

For a whole team, commit this to the project's `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "fredsvanelli": { "source": { "source": "github", "repo": "fredsvanelli/skills" } }
  },
  "enabledPlugins": { "runbook@fredsvanelli": true, "utils@fredsvanelli": true }
}
```

## Adding a plugin

1. `mkdir -p <name>/.claude-plugin <name>/skills` and write `<name>/.claude-plugin/plugin.json` with `"name": "<name>"`.
2. Each skill goes in `<name>/skills/<skill>/SKILL.md`; it is invoked as `/<name>:<skill>`.
3. Add the plugin to `.claude-plugin/marketplace.json`.
4. Bump `version` in a plugin's `plugin.json` when you change it, so installs pick up the update.
