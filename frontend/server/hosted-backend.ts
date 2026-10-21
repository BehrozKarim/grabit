/** Server-only adapter. Never import this module into browser code. */
export interface HostedEnvironment {
  GRABIT_BACKEND_URL?: string
  GRABIT_BACKEND_API_KEY?: string
}

const jsonHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
const jobPath = /^\/api\/jobs\/[a-f0-9]{32}$/
const ticketPath = /^\/api\/jobs\/[a-f0-9]{32}\/ticket$/

function error(message: string, status: number): Response {
  return Response.json({ detail: message }, { status, headers: jsonHeaders })
}

async function boundedText(message: Request | Response, maximum: number): Promise<string> {
  if (!message.body) return ''
  const reader = message.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maximum) {
        await reader.cancel()
        throw new Error('Body exceeds limit')
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return new TextDecoder().decode(bytes)
}

/** Forward small JSON operations only. Prepared media goes directly from Render to the browser. */
export function createHostedHandler(environment: HostedEnvironment, allowLocal = false) {
  return async function hostedBackend(request: Request): Promise<Response> {
    const incoming = new URL(request.url)
    const origin = request.headers.get('origin')
    if ((origin && origin !== incoming.origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
      return error('Use the downloader from this Grabit website.', 403)
    }
    const path = incoming.searchParams.get('path') || ''
    const method = request.method
    const allowed = (method === 'GET' && (path === '/api/config' || jobPath.test(path))) ||
      (method === 'POST' && (path === '/api/media' || path === '/api/jobs' || ticketPath.test(path))) ||
      (method === 'DELETE' && jobPath.test(path))
    if (!allowed) return error('This API operation is not available.', 404)

    let backend: URL
    try {
      backend = new URL(environment.GRABIT_BACKEND_URL || '')
      const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(backend.hostname)
      if ((backend.protocol !== 'https:' && !(allowLocal && loopback && backend.protocol === 'http:')) ||
        backend.username || backend.password || backend.search || backend.hash || backend.pathname !== '/' ||
        (!allowLocal && !environment.GRABIT_BACKEND_API_KEY)) throw new Error('Invalid configuration')
    } catch {
      return error('The hosted server is not configured yet. Try your own backend in Settings.', 503)
    }

    let body: string | undefined
    if (method === 'POST') {
      try {
        body = await boundedText(request, 8192)
        if (body) JSON.parse(body)
      } catch { return error('Send a small, valid JSON request.', 400) }
    }

    try {
      const response = await fetch(new URL(path, backend), {
        method,
        body,
        headers: {
          Accept: 'application/json', 'Content-Type': 'application/json',
          ...(environment.GRABIT_BACKEND_API_KEY ? { Authorization: `Bearer ${environment.GRABIT_BACKEND_API_KEY}` } : {}),
        },
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(165_000)]),
      })
      if (response.status === 401 || response.status === 403) {
        return error('The hosted server connection needs attention. Try your own backend in Settings.', 503)
      }
      const result = JSON.parse(await boundedText(response, 1024 * 1024))
      if (response.ok && ticketPath.test(path)) {
        const jobId = path.split('/')[3]
        const download = new URL(result.url, backend)
        if (download.origin !== backend.origin || download.pathname !== `/api/files/${jobId}` ||
          !download.searchParams.get('ticket') || download.username || download.password || download.hash) {
          throw new Error('Invalid ticket')
        }
        result.url = download.href
      }
      return Response.json(result, { status: response.status, headers: jsonHeaders })
    } catch {
      return error('The hosted server did not respond. It may be waking up. Try again shortly.', 502)
    }
  }
}
