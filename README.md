# fredsvanelli/skills

Claude Code plugin marketplace. Each folder is one plugin, installed on its own.

| Plugin | Commands | Does |
|---|---|---|
| [`runbooks`](runbooks/) | `/runbooks:*` | UAT runbooks kept as a project's verified knowledge base |
| [`utils`](utils/) | `/utils:*` | repo housekeeping: merged branches, Dependabot PR queue, PR descriptions |
| [`pmkit`](https://github.com/fredsvanelli/pmkit) | `/pmkit:*` | project management for development agents: issues, sprints and epics across trackers |

## Install

    claude plugin marketplace add fredsvanelli/skills
    claude plugin install runbooks@fredsvanelli
    claude plugin install utils@fredsvanelli
    claude plugin install pmkit@fredsvanelli

For a whole team, commit this to the project's `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "fredsvanelli": { "source": { "source": "github", "repo": "fredsvanelli/skills" } }
  },
  "enabledPlugins": { "runbooks@fredsvanelli": true, "utils@fredsvanelli": true, "pmkit@fredsvanelli": true }
}
```
