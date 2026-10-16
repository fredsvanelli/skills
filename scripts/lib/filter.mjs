import { matchesGlob } from './glob.mjs'

export function filterRunbooks(runbooks, filters = {}, entryFiles = new Map()) {
  const { capability, feature, tag, status, path: pathGlob } = filters
  return runbooks.filter((rb) =>
    (!capability || rb.capability === capability) &&
    (!feature || rb.feature === feature) &&
    (!tag || rb.tags.includes(tag)) &&
    (!status || rb.status === status) &&
    (!pathGlob || rb.covers.entries.some((id) => {
      const file = entryFiles.get(id)
      return Boolean(file) && matchesGlob(file, pathGlob)
    })),
  )
}
