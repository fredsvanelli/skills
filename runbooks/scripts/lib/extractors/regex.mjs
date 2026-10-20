export function regexItems(content, source) {
  const flags = source.flags ?? 'm'
  const pattern = new RegExp(source.pattern, flags.includes('g') ? flags : `${flags}g`)
  const items = []
  for (const match of content.matchAll(pattern)) {
    const id = match.groups?.id
    if (!id) continue
    const method = match.groups?.method
    items.push({ id: method ? `${method.toUpperCase()} ${id}` : id, title: match.groups?.title ?? '' })
  }
  return items
}
