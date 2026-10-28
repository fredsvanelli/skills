# Each command runs on the model its row names

Every command used to run in the main session, on the model the user opened it with. A `run --mode test` on a simple runbook ran on Opus, which executed the test command and compared the JUnit output with the runbook. That work is mechanical, and each tool call re-reads the whole context, with `format.md` and `run-modes.md` already loaded. The config now holds a `models` table with one row per command and parameter, such as `run --mode test` or `audit --fix`. A row names `inline`, `haiku`, `sonnet`, `opus` or `fable`. The plugin keeps the default rows in code, and the loader fills any row the config lacks. A command file is now a short dispatch file: it resolves the model with `runbooks.mjs model`, launches a sub-agent on that model with a brief, relays the sub-agent's questions and prints its summary. The procedure lives in an instructions file that the sub-agent reads, or the main session reads when the row is `inline`. Every command accepts `--model` to force the model of every sub-agent for one invocation. The default rows give `haiku` only work that writes no Expected text, no test and no fix to a script. `--model` and a row changed in `settings` win over that rule.

## Considered Options

- A `model:` key in each command file's frontmatter. Rejected: it is fixed per file, cannot vary by parameter, and `settings` cannot change it.
- A sub-agent for every command. Rejected for commands that run one script and for commands that are mostly questions: the main session would make the same calls to dispatch, relay and print, and the sub-agent would add its own cost. Those rows are `inline`.
- A table that `setup` builds for each project. Rejected: the user dropped it, and one default table is easier to explain and to update.

## Consequences

- A sub-agent cannot ask the user. It reports `status: question`, and the main session asks with `AskUserQuestion` and answers with `SendMessage`.
- Each command text splits into a dispatch file under `commands/` and an instructions file under `skills/runbooks/instructions/`. Paths that pointed at a command file now point at the instructions file.
- A default that changes in a later plugin version reaches an existing project only through the `setup` question, which shows the rows that differ and asks which to update.
- `--model` and rows changed in `settings` beat the guarantees of the default rows. A `haiku` sub-agent chosen that way may write Expected text, with no warning. `--model` also turns off escalation.
- `ui` always runs in the main session, because its server must outlive the command. `--model` is accepted there and changes nothing.
- In a `run` prompt group and in `--import`, the main session owns the upstream server.
- A command reached through `status: call` never commits. The main session commits once for the chain.
- A sub-agent that needs a script written or fixed in `run --mode test` reports `escalate`. The main session hands off to `to-test` and runs again. A second `escalate` for the same runbook ends `blocked`.
