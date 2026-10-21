import fs from 'node:fs'
import path from 'node:path'

import { ROLE_NAME } from './roles.mjs'

const MODES = ['mocked', 'live', 'record']

// Turns the config's upstream block and the CLI flags into the options of createUpstreamServer, plus the port.
export function upstreamOptions(root, config, options) {
  const { upstream } = config
  if (!upstream) throw new Error('the config has no upstream block. Run /runbooks:setup')
  let port = upstream.port
  if (options.port !== undefined) {
    port = Number(options.port)
    if (typeof options.port !== 'string' || !/^\d+$/.test(options.port) || port > 65535) {
      throw new Error('--port must be an integer from 0 to 65535')
    }
  }
  const mode = options.mode ?? upstream.mode
  if (!MODES.includes(mode)) throw new Error(`--mode must be one of ${MODES.join(', ')}`)
  if (options.role !== undefined && !(typeof options.role === 'string' && ROLE_NAME.test(options.role))) {
    throw new Error('--role must be a role name like editor')
  }
  return {
    fixturesRoot: path.resolve(root, upstream.fixtures),
    target: upstream.baseUrl,
    redactHeaders: upstream.redactHeaders,
    port,
    mode,
    runbook: typeof options.runbook === 'string' ? options.runbook : null,
    role: options.role ?? null,
    step: typeof options.step === 'string' ? options.step : null,
  }
}

// Compares the copied server's VERSION with the plugin's. Reads the file as text and never imports it.
export function copiedServerWarning(root, config, version) {
  const file = config.upstream?.serverFile
  if (!file) return null
  const full = path.resolve(root, file)
  if (!fs.existsSync(full)) return `upstream.serverFile ${file} is missing: run /runbooks:setup to copy it`
  const found = /export const VERSION = '([^']*)'/.exec(fs.readFileSync(full, 'utf8'))?.[1] ?? 'unknown'
  if (found === version) return null
  return `upstream.serverFile ${file} is from runbooks ${found}, the plugin is ${version}: run /runbooks:setup to refresh it`
}
