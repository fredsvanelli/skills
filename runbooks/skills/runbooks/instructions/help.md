# Runbooks help: instructions

When you run this file in the main session (model `inline`), the arguments and answers of the dispatch file stand in for the brief.

You answer the question of your brief about the runbooks plugin, or explain the area it names. The parameters are in `${CLAUDE_PLUGIN_ROOT}/commands/help.md`.

Read-only. It runs no runbook, writes no file and commits nothing. It answers from the plugin's files, not from memory: every claim comes from a file this command read.

## 1. Choose the area

The areas table is in `${CLAUDE_PLUGIN_ROOT}/commands/help.md`, under "Areas". Every path in it is under `${CLAUDE_PLUGIN_ROOT}`.

1. With `--about`, take its area. A name that is a command (`run`, `coverage`) or a term from `CONTEXT.md` (`case`, `outcome`, `surface`) maps to the area that holds it. An unknown name gets the list of areas, with the closest ones first, and the command stops.
2. Without `--about`, pick the area from the question: the terms of `CONTEXT.md` it uses and the commands it names. When two areas fit, read both. When nothing fits, use `overview`.
3. Without `--about` and without a question, print the areas with one line each on what they explain, then the example `/runbooks:help --about roles "How roles work?"`, and stop.

Done when you hold the area, or the command stopped with the list of areas.

## 2. Read

1. Read `${CLAUDE_PLUGIN_ROOT}/CONTEXT.md` and the files of the area. In a long reference, read the sections the table names, then the other sections the question reaches.
2. Follow a link or a file name in those files when the question needs it, for example an ADR a reference cites or a command a reference names.
3. When `docs/runbooks/runbooks.config.json` exists in the project, read it. It tells which parts apply here: the `stack`, whether `roles.enabled` is on, the default `upstream.mode`. Read the project's `roles.json` or a runbook only when the question is about this project ("Which roles do I have?", "Why is `billing.issue-invoice` stale?"), and prefer the script for it: `node "${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs" roles`, `... list`, `... check <id>`.

Done when you hold the passages that answer the question.

## 3. Answer

Write in the language of the question. Without a question, use the config `language`, else English. Terms of `CONTEXT.md`, frontmatter keys, command names and file names stay as they are.

- Answer the question first, in a few sentences, with the terms of `CONTEXT.md`.
- Then add what the user needs to act on it: an example in the runbook or config format, copied or adapted from the references, and the commands that do the work, with their parameters.
- When the project config changes the answer, say how. For example, with `roles.enabled` off, say that the roles behavior does not apply until `/runbooks:settings roles` turns tracking on.
- Without a question, explain the area: what it is for, its terms, how its pieces relate, and its commands.
- End with the files the answer came from, each with its section, so the user can read further.

When the files do not answer the question, say so and say what they cover instead. Do not fill the gap with a guess. When the answer depends on the script's behavior and no reference describes it, read `${CLAUDE_PLUGIN_ROOT}/scripts/runbooks.mjs` or its `lib/` and say the answer came from the code.

## 4. Report

Your report follows "The report" in `${CLAUDE_PLUGIN_ROOT}/skills/runbooks/references/agents.md`. It lists no file. Put the answer in `summary:`, with the files it came from.

Done when `summary:` holds the answer, or says that the plugin's files do not have one, and lists the files to read further.
