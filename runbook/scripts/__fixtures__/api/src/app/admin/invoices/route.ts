export const GET = () => new Response('[]')

export async function POST() {
  return new Response('{}', { status: 201 })
}
