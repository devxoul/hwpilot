export function handleError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  console.error(JSON.stringify({ error: message }))
  process.exit(1)
}
