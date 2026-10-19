/**
 * Checking a JSON body before it is sent.
 *
 * The backend answers a broken body with 400 "Malformed JSON request body." and no position. That
 * is a round trip to learn something the browser already knows, and it says nothing about where
 * the mistake is — so the console refuses to send, and says which line and column, instead.
 */

/** Line and column (both 1-based) of a character offset. */
export function positionOf(text, offset) {
  const before = text.slice(0, Math.max(0, offset))
  const lines = before.split('\n')
  return { line: lines.length, column: lines[lines.length - 1].length + 1 }
}

/**
 * `{ ok: true, value }` or `{ ok: false, error: { message, line, column } }`.
 *
 * Empty text is valid and means "no body". The engines word their errors differently, but every
 * current one names the offset as "position N", which is what the line and column come from.
 */
export function checkJson(text) {
  if (text == null || String(text).trim() === '') return { ok: true, value: undefined, empty: true }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    const match = /position (\d+)/.exec(error.message)
    const where = match ? positionOf(text, Number(match[1])) : null
    return {
      ok: false,
      error: {
        // Drop the engine's own "(line x column y)" suffix where it adds one, to avoid saying it twice.
        message: error.message.replace(/\s*\(line \d+ column \d+\)/, ''),
        line: where?.line ?? null,
        column: where?.column ?? null,
      },
    }
  }
}

/** Pretty-printed with two spaces, or exactly as given when it is not JSON. */
export function pretty(text) {
  if (text == null || text === '') return ''
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

/**
 * A multipart body as text, for the request view: each part's name, and its JSON or its file's
 * name, type and size. The file's bytes are never shown.
 */
export function describeParts(parts) {
  return (parts || []).map((part) => (part.kind === 'file'
    ? `--- part "${part.name}": file ${part.fileName} (${part.type || 'no type'}, ${part.size} bytes)`
    : `--- part "${part.name}": application/json\n${part.text}`)).join('\n\n')
}
