import fs from 'node:fs'
import path from 'node:path'

const SKIP_DIRS = new Set(['node_modules', '.git', '.next'])

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function globToRegExp(glob) {
  const segments = glob.split('/')
  let source = '^'
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1
    if (segment === '**') {
      source += last ? '.*' : '(?:[^/]+/)*'
      return
    }
    source += segment.split('*').map(escapeRegExp).join('[^/]*')
    if (!last) source += '/'
  })
  return new RegExp(`${source}$`)
}

export function matchesGlob(file, glob) {
  return globToRegExp(glob).test(file)
}

function literalPrefix(glob) {
  const prefix = []
  for (const segment of glob.split('/').slice(0, -1)) {
    if (segment.includes('*')) break
    prefix.push(segment)
  }
  return prefix.join('/')
}

function walk(dir, rel, out) {
  let dirents
  try {
    dirents = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const dirent of dirents) {
    const childRel = rel ? `${rel}/${dirent.name}` : dirent.name
    if (dirent.isDirectory()) {
      if (!SKIP_DIRS.has(dirent.name)) walk(path.join(dir, dirent.name), childRel, out)
    } else if (dirent.isFile()) {
      out.push(childRel)
    }
  }
}

export function findFiles(baseDir, glob) {
  const prefix = literalPrefix(glob)
  const files = []
  walk(path.join(baseDir, prefix), prefix, files)
  const pattern = globToRegExp(glob)
  return files.filter((file) => pattern.test(file)).sort()
}
