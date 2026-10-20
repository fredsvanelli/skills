import { execSync } from 'node:child_process'

export function commandItems(cwd, command) {
  const output = execSync(command, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  let data
  try {
    data = JSON.parse(output)
  } catch {
    throw new Error('output is not a JSON array')
  }
  if (!Array.isArray(data)) throw new Error('output is not a JSON array')
  return data
    .filter((item) => item && typeof item.id === 'string')
    .map((item) => ({ id: item.id, title: typeof item.title === 'string' ? item.title : '' }))
}
