import fs from 'node:fs'
import path from 'node:path'

import { isOutside } from './config.mjs'
import { upstreamServerOptions } from '../upstream-server.mjs'

// Turns the config's upstream block and the CLI flags into the options of createUpstreamServer, plus the port.
export function upstreamOptions(root, config, options) {
  if (!config.upstream) throw new Error('the config has no upstream block. Run /runbooks:setup')
  return upstreamServerOptions(root, config.upstream, options)
}

// Compares the copied server's VERSION with the plugin's. Reads the file as text and never imports it.
export function copiedServerWarning(root, config, version) {
  const file = config.upstream?.serverFile
  if (!file) return null
  const full = path.resolve(root, file)
  // A copy in a UI tests repository that is not cloned here is not missing; see docs/adr/0007.
  const testsRoot = config.tests?.ui?.root
  if (testsRoot && isOutside(root, testsRoot) && !fs.existsSync(path.resolve(root, testsRoot))) return null
  if (!fs.existsSync(full)) return `upstream.serverFile ${file} is missing: run /runbooks:setup to copy it`
  const found = /export const VERSION = '([^']*)'/.exec(fs.readFileSync(full, 'utf8'))?.[1] ?? 'unknown'
  if (found === version) return null
  return `upstream.serverFile ${file} is from runbooks ${found}, the plugin is ${version}: run /runbooks:setup to refresh it`
}
