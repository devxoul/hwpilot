type ErrorOptions = {
  context?: Record<string, unknown>
  hint?: string
}

export function handleError(error: unknown, options?: ErrorOptions): void {
  const message = error instanceof Error ? error.message : String(error)
  const output: Record<string, unknown> = { error: message }
  if (options?.context) output.context = options.context
  if (options?.hint) output.hint = options.hint
  console.error(JSON.stringify(output))
  process.exit(1)
}
