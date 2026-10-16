import fs from 'node:fs'
import path from 'node:path'
import { findFiles } from './glob.mjs'
import { nextAppRouterItems } from './extractors/next-app-router.mjs'
import { regexItems } from './extractors/regex.mjs'
import { commandItems } from './extractors/command.mjs'

export function extractItems(projectRoot, sources, listName) {
  const items = []
  const warnings = []
  const seen = new Set()
  const push = (item) => {
    if (seen.has(item.id)) return
    seen.add(item.id)
    items.push(item)
  }

  sources.forEach((source, index) => {
    const label = `${listName}[${index}]`
    const rootRel = source.root ?? '.'
    const baseDir = path.resolve(projectRoot, rootRel)
    if (!fs.existsSync(baseDir)) {
      warnings.push(`${label}: root "${rootRel}" does not exist, source skipped`)
      return
    }
    if (source.extractor === 'command') {
      try {
        for (const item of commandItems(baseDir, source.command)) push({ ...item, kind: 'requirement', file: null })
      } catch (err) {
        warnings.push(`${label}: command failed: ${String(err.message).split('\n')[0]}`)
      }
      return
    }
    for (const rel of findFiles(baseDir, source.glob)) {
      const content = fs.readFileSync(path.join(baseDir, rel), 'utf8').replace(/\r\n/g, '\n')
      const file = rootRel === '.' ? rel : path.posix.join(rootRel, rel)
      const found = source.extractor === 'next-app-router' ? nextAppRouterItems(rel, content, source) : regexItems(content, source)
      for (const item of found) {
        const kind = listName === 'requirements' ? 'requirement' : item.kind ?? source.kind ?? 'entry'
        push({ ...item, kind, file })
      }
    }
  })
  return { items, warnings }
}
