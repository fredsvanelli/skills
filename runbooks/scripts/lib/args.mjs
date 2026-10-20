export function parseArgs(argv) {
  const options = {}
  const positionals = []
  let command
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) {
        options[key] = true
      } else {
        options[key] = next
        i++
      }
    } else if (command === undefined) {
      command = arg
    } else {
      positionals.push(arg)
    }
  }
  return { command, options, positionals }
}
