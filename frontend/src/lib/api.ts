import type { BrowserPlan, Connection, Job, JobRequest, MediaInfo, ServerConfig } from '../types'

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message)
    this.name = 'ApiError'
  }
}

export function normalizeApiUrl(value: string): string {
  const url = new URL(value.trim())
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
    url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('Use the HTTPS address of your backend, without a path or query.')
  }
  return url.origin
}

export class GrabitApi {
  constructor(readonly connection: Connection) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const hosted = this.connection.mode === 'hosted'
    if (!hosted && !this.connection.url) {
      throw new ApiError('Add your backend address in Settings to get started.', 0)
    }
    const controller = new AbortController()
    const abort = () => controller.abort()
    const originalSignal = init.signal
    originalSignal?.addEventListener('abort', abort, { once: true })
    if (originalSignal?.aborted) controller.abort()
    const timer = setTimeout(abort, 180_000)
    try {
      const endpoint = hosted ? `/api/backend?path=${encodeURIComponent(path)}` : `${this.connection.url}${path}`
      const response = await fetch(endpoint, {
        ...init,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(!hosted && this.connection.key ? { Authorization: `Bearer ${this.connection.key}` } : {}),
          ...init.headers,
        },
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        throw new ApiError(
          typeof body?.detail === 'string' ? body.detail :
            'The server could not complete this request. It may still be waking up. Try again.',
          response.status,
        )
      }
      return body as T
    } catch (error) {
      if (originalSignal?.aborted) throw error
      if (error instanceof ApiError) throw error
      if (controller.signal.aborted) {
        throw new ApiError('The server took too long to respond. Try again in a moment.', 0)
      }
      throw new ApiError('Cannot reach the server. Check your connection and backend address in Settings.', 0)
    } finally {
      clearTimeout(timer)
      originalSignal?.removeEventListener('abort', abort)
    }
  }

  config(signal?: AbortSignal) {
    return this.request<ServerConfig>('/api/config', { signal })
  }

  inspect(url: string, signal?: AbortSignal) {
    return this.request<MediaInfo>('/api/media', { method: 'POST', body: JSON.stringify({ url }), signal })
  }

  createJob(request: JobRequest, signal?: AbortSignal) {
    return this.request<Job>('/api/jobs', { method: 'POST', body: JSON.stringify(request), signal })
  }

  plan(request: JobRequest, signal?: AbortSignal) {
    return this.request<BrowserPlan>('/api/plan', { method: 'POST', body: JSON.stringify(request), signal })
  }

  job(id: string, signal?: AbortSignal) {
    return this.request<Job>(`/api/jobs/${encodeURIComponent(id)}`, { signal })
  }

  cancelJob(id: string) {
    return this.request<Job>(`/api/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  async downloadUrl(id: string, signal?: AbortSignal) {
    const ticket = await this.request<{ url: string }>(`/api/jobs/${encodeURIComponent(id)}/ticket`, { method: 'POST', signal })
    const url = this.connection.mode === 'hosted' ? new URL(ticket.url) : new URL(ticket.url, this.connection.url)
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if ((url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) || url.username || url.password ||
      (this.connection.mode === 'custom' && url.origin !== this.connection.url) ||
      url.pathname !== `/api/files/${encodeURIComponent(id)}` || !url.searchParams.get('ticket')) {
      throw new ApiError('The server returned an invalid download link.', 0)
    }
    return url.href
  }
}
