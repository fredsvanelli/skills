# fredsvanelli/skills

Skills and plugins for **Claude Code and OpenAI Codex**. `runbooks` and `utils`
share their procedures and helpers, with host-specific installation, tools and
configuration. Each plugin is installed independently.

| Plugin | Claude Code | Codex plugin skills | Does |
|---|---|---|---|
| [`runbooks`](runbooks/) | `/runbooks:*` | `$runbooks:runbooks`, `$runbooks:runbooks-*`, `$runbooks:scenarios` | UAT runbooks as a project's verified knowledge base |
| [`utils`](utils/) | `/utils:*` | `$utils:cleanup-branches`, `$utils:cleanup-dependabot`, `$utils:generate-pr-description` | repository housekeeping and PR descriptions |

[`pmkit`](https://github.com/fredsvanelli/pmkit) lives in a separate repository.
It remains listed in the Claude marketplace; this repository's Codex catalog
contains only `runbooks` and `utils`.

## Install in Codex

On a CLI with plugin marketplace support (validated with Codex CLI 0.165.0):

```bash
codex plugin marketplace add fredsvanelli/skills
codex plugin add runbooks@fredsvanelli
codex plugin add utils@fredsvanelli
```

Start a new session after installation. In clients offering a Plugins directory,
select the `fredsvanelli` marketplace and install the plugins there. If your CLI
lacks `plugin add`, use that interface or update the CLI; check `codex plugin --help`.

Select a skill from the host's skill picker or use its full namespaced name:

```text
$runbooks:runbooks-setup
$runbooks:runbooks-create --from diff develop
$runbooks:runbooks-roles-list
$utils:generate-pr-description --base main
```

Codex prefixes plugin skills with the plugin name. For example, the skill folder
`runbooks-create` appears as `runbooks:runbooks-create`. The general
`$runbooks:runbooks` skill also routes natural-language requests.

For project enablement, preserve the existing `.codex/config.toml` and add:

```toml
[plugins."runbooks@fredsvanelli"]
enabled = true

[plugins."utils@fredsvanelli"]
enabled = true
```

Project config requires a trusted project and an installed/discoverable plugin.
Runbooks setup configures project MCP servers in this TOML file and writes its
instructions block to `AGENTS.md`. It does not edit Claude settings in Codex.

## Install in Claude Code

```bash
claude plugin marketplace add fredsvanelli/skills
claude plugin install runbooks@fredsvanelli
claude plugin install utils@fredsvanelli
claude plugin install pmkit@fredsvanelli
```

For a team, merge this into the project's `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "fredsvanelli": { "source": { "source": "github", "repo": "fredsvanelli/skills" } }
  },
  "enabledPlugins": { "runbooks@fredsvanelli": true, "utils@fredsvanelli": true, "pmkit@fredsvanelli": true }
}
```

## Local development and validation

From this repository root:

```bash
codex plugin marketplace add .
codex plugin add runbooks@fredsvanelli
codex plugin add utils@fredsvanelli
```

Re-add the changed plugin to refresh its installed copy, then start a new session.
Claude development uses `claude --plugin-dir runbooks` or `claude --plugin-dir utils`.

Run `npm --prefix runbooks test` (Node 18+). The suite includes both runtime model
resolvers, package discovery, command routing and resource-path checks. Dependencies
for a particular workflow (for example `gh`, Python or a browser MCP server) are
listed in that plugin's documentation.

Packaging follows [OpenAI's plugin format](https://developers.openai.com/plugins/build/plugins).
Project MCP configuration follows [Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).
