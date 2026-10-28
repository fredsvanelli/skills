# Dispatching a command to a sub-agent

Read [runtime setup](runtime.md) first. A dispatch file resolves a model, runs the
instructions inline or in a child, relays questions and prints the result. The
procedure and report format are shared by Claude Code and Codex.

## Choosing the model

Run the resolver from the consumer project. Replace free-text arguments with one
placeholder word such as `text` when resolving (the resolver needs only presence,
flags and option values); give the child the original full arguments. Quote paths
and shell arguments. Resolve the variables in each fresh shell call:

```
node "${RUNBOOKS_PLUGIN_ROOT}/scripts/runbooks.mjs" model <command> <arguments> --runtime <claude|codex> --json
```

It returns `{ model, row, forced }`. Never infer the result by reading the table.

- `inline`: read the instructions file and execute in the main session. Launch
  no child. Where the file's child preamble says it cannot ask the user, the main
  session instead asks directly; handle calls/escalation in this same dispatcher.
- Claude values `haiku`, `sonnet`, `opus`, `fable`: use the host's Agent tool with
  that model, as before. A missing tool or unsupported model is a launch failure.
- Codex `inherit`: spawn a child inheriting this session's model, omitting a model
  override. If the available tool requires an explicit model, use the session's
  actual model only when it is known and accepted; otherwise explain the limit
  rather than inventing an ID. Use a clean child context when the tool supports it.
- Codex explicit model ID: check the actual spawn tool's supported models and
  override restrictions, then pass the ID. Structural validation by the CLI does
  not prove that the host can launch it. Do not substitute another model.
- With no native subagent tool, a default Codex `inherit` row runs inline after
  saying so. A forced `inherit` or explicit model cannot be silently downgraded;
  offer `--model inline` and wait for that choice. Do not launch a hidden nested
  Codex/Claude CLI process to simulate delegation.
- `forced: true` applies to every child and internal call of this invocation;
  escalation to a different model is disabled. An invalid option exits 2: show
  the error and stop.

## Dispatch steps

1. Parse invocation arguments, including `--model`, using the active host.
2. Resolve with the helper and the active runtime.
3. Ask the up-front questions listed in the dispatch file. Resolve again if an
   answer changes arguments such as run mode.
4. Execute inline or spawn using the rules above. Keep the child ID, its state,
   the resolved model, arguments and brief. Keep file ownership and locks explicit.
5. Process reports until `done`, `blocked` or `failed`. A `question` or `call`
   pauses the work, not the ownership of the unit. Use the Questions and Calls
   sections to resume it. `escalate` ends that child: resolve `to-test <id>` in the
   same runtime, run it without loosening assertions, then rerun the original
   runbook on its original model. Never escalate when a model was forced.
6. Print `summary:` before the command's commit step.

Wait using the host's wait/event tools and keep the user informed. Respect actual
slot limits; a child awaiting a question may still occupy a slot. Queue called
work or run an inline row in the main session instead of oversubscribing.

## The brief

Replace all placeholders with actual paths/values. The child need not inherit the
conversation. Include the Fixed decisions block only when supplied by the caller.

```
You execute one runbooks procedure. The main session coordinates user questions.
Runtime: <claude|codex>.
Project root: <absolute consumer root>. Plugin root: <absolute runbooks root>.
Execution: child. The main session owns commits and user approvals.
Read first: <plugin root>/skills/runbooks/SKILL.md, <plugin root>/CONTEXT.md,
<plugin root>/skills/runbooks/references/runtime.md,
<plugin root>/skills/runbooks/references/agents.md and the instructions file below.
Command: /runbooks:<command> <original full arguments>
Instructions file: <absolute instructions path>
Forced model: yes | no

Fixed decisions:
- <decisions supplied by the caller; none inferred from missing answers>

Commits: none. Do not run git add, git commit, git stash or git checkout.
Report all changed paths. Do not edit files owned by another stage.
You cannot ask the user. Where the procedure asks, report status: question and
wait for the coordinator's answer. Where it calls another command, report
status: call and wait for its report. If reporting ends your turn, the
coordinator resumes you with the answer/report; continue the same stage then.
Do not guess product behavior. Forced model: yes disables escalation: do the
to-test work yourself where the procedure would otherwise escalate.
Finish with the report shape below.
```

Put resource ownership, lock state, runbook ID and prior-stage handoff before
Commits when needed. A child never launches another command on its own; the main
session resolves that command's model and coordinates the call.

## The report

```
status: done | question | call | escalate | blocked | failed
files: <every path written or edited, one per line; none if no file>
summary: <the command's final output, or the progress before a question/call>
question: <question, evidence, options and recommended answer; or none>
call: </runbooks:<command> <arguments>; or none>
escalate: <runbook> <sync | script>; or none
blocked by: <missing dependency and exact error; or none>
next: <next action, one line>
handoff: <facts the next stage cannot read from the files; or none>
```

For `run`, summary includes result rows and failures. A command writing a report
names its path. `sync` means the script is missing or out of sync with steps;
`script` means a suspected test-script error. Escalation never weakens assertions.
A question can carry the proposed diff; no unapproved write happens first.

## Questions

A child reports `status: question`. The main session answers from a fixed decision
or file when unambiguous; otherwise asks with the available user-input tool or in
chat and waits. Preserve approval scope and the original question/diff.

On Claude, send the answer with `SendMessage` to the waiting agent (load it with
`ToolSearch` when available and needed). On Codex, send a message to a running
child; use the actual resume/followup tool for an idle or completed child, since a
plain message may not start another turn. Reuse the same child ID for the stage.
If the host cannot resume it, a replacement child receives the original brief,
all reports/changed paths, the exact answer and the next unfinished step; first
reconcile existing files so it does not repeat writes. Explain that resumption
limit. Never claim a message resumed a child without observing its next result.

## Calls to other commands

`status: call` names the called command. Resolve it with the active runtime and
carry any forced `--model`. The caller pauses and transfers its lock to the
called work. Neither can use the browser, server or database simultaneously.
Actual host slot accounting still applies; a paused child does not magically
free a slot. Queue until a slot is free. If no progress can free one, report the
capacity limit and offer inline execution; preserve any forced-model constraint.

After completion, deliver the report and resume the caller by Questions' lifecycle
rules. Collect both reports' changed paths. Called commands skip their commit
steps. The main session commits the whole call chain once, under the original
command's policy, after printing its summary.

## Commits

Only the main session commits, by the command's policy in `commits.md`. Stage
reported paths explicitly and respect the initial dirty-file list. Inline
execution follows the same outer command commit step, without a duplicate commit.

## When the model cannot launch

Show the actual tool error or capability limit and the selected row from the
resolver. Offer `--model inline` or another available model for this invocation,
and `/runbooks:settings models` to change the active runtime's table. Stop rather
than retrying on a different model. The only automatic inline fallback is the
non-forced Codex `inherit` row with no subagent tool, described above.
