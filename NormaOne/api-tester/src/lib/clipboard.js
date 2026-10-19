/**
 * Copying, and the one export format worth copying to: cURL.
 *
 * THE TOKEN IS NOT COPIED INTO THE COMMAND. A cURL line gets pasted into chats and tickets, and a
 * live bearer token in one is an account handed over. It is written as $TOKEN instead, so the
 * command still runs after `export TOKEN=…`.
 */

/** Resolves true when the text reached the clipboard. Never throws. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Older browsers, or a page not allowed the async clipboard: fall back to a hidden textarea.
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const done = document.execCommand('copy')
      area.remove()
      return done
    } catch {
      return false
    }
  }
}

const quote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`

/** The request as a cURL command, against the real backend address rather than the proxy. */
export function toCurl(request, backendOrigin) {
  if (!request) return ''
  const url = /^https?:\/\//i.test(request.url) ? request.url : `${backendOrigin}${request.url}`
  const lines = [`curl -X ${request.method} ${quote(url)}`]
  Object.entries(request.headers || {}).forEach(([key, value]) => {
    const shown = key.toLowerCase() === 'authorization' && /^Bearer\s/i.test(value) ? 'Bearer $TOKEN' : value
    lines.push(key.toLowerCase() === 'authorization' ? `-H "${key}: ${shown}"` : `-H ${quote(`${key}: ${shown}`)}`)
  })
  if (request.formParts) {
    // A multipart body: one -F per part, the file by name (its bytes were never kept).
    request.formParts.forEach((part) => lines.push(part.kind === 'file'
      ? `-F ${quote(`${part.name}=@${part.fileName}`)}`
      : `-F ${quote(`${part.name}=${part.text};type=application/json`)}`))
  } else if (request.body) lines.push(`--data-raw ${quote(request.body)}`)
  return lines.join(' \\\n  ')
}
