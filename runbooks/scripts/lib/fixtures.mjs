// Fixtures of runbook <capability>.<flow> live in <fixtures>/<capability>/<flow>, relative to the project root.
export function fixturesDir(config, runbook) {
  const base = config.upstream?.fixtures ?? `${config.paths.runbooks}/_fixtures`
  const flow = runbook.id.slice(runbook.capability.length + 1)
  return `${base.replace(/\/+$/, '')}/${runbook.capability}/${flow}`
}
