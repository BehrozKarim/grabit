// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHostedHandler } from './hosted-backend'

const environment = { GRABIT_BACKEND_URL: 'https://personal-api.onrender.com', GRABIT_BACKEND_API_KEY: 'server-only-test-key' }
const handler = createHostedHandler(environment)
const jobId = 'a'.repeat(32)
const request = (path: string, init: RequestInit = {}) => new Request(`https://grabit.example/api/backend?path=${encodeURIComponent(path)}`, init)

afterEach(() => vi.restoreAllMocks())

describe('hosted API adapter', () => {
  it('adds the deployment key server-side and ignores browser-supplied authorization', async () => {
    const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ max_file_mb: 150 }))
    const result = await handler(request('/api/config', { headers: { Authorization: 'Bearer do-not-forward' } }))
    expect(result.status).toBe(200)
    expect(upstream.mock.calls[0][0].toString()).toBe('https://personal-api.onrender.com/api/config')
    expect(upstream.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer server-only-test-key' })
    expect(result.headers.get('cache-control')).toBe('no-store')
    expect(await result.text()).not.toContain(environment.GRABIT_BACKEND_API_KEY)
  })

  it('cannot proxy arbitrary URLs, file bodies, paths, or methods', async () => {
    const upstream = vi.spyOn(globalThis, 'fetch')
    for (const path of ['https://evil.example/api/config', '/api/config?secret=1', '/api/files/a', '/health', '/api/../health']) {
      expect((await handler(request(path))).status).toBe(404)
    }
    expect((await handler(request('/api/config', { method: 'DELETE' }))).status).toBe(404)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('rejects cross-origin browser requests and invalid deployment configuration', async () => {
    expect((await handler(request('/api/config', { headers: { Origin: 'https://other.example' } }))).status).toBe(403)
    expect((await createHostedHandler({})(request('/api/config'))).status).toBe(503)
    expect((await createHostedHandler({ ...environment, GRABIT_BACKEND_URL: 'http://127.0.0.1:8000' })(request('/api/config'))).status).toBe(503)
  })

  it('passes valid small JSON requests and bounds oversized bodies', async () => {
    const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ id: jobId }, { status: 202 }))
    const body = JSON.stringify({ media_id: jobId, format_id: '720' })
    expect((await handler(request('/api/jobs', { method: 'POST', body }))).status).toBe(202)
    expect(upstream.mock.calls[0][1]?.body).toBe(body)
    expect((await handler(request('/api/jobs', { method: 'POST', body: 'x'.repeat(8193) }))).status).toBe(400)
    expect((await handler(request('/api/jobs', { method: 'POST', body: 'invalid-json' }))).status).toBe(400)
    expect(upstream).toHaveBeenCalledTimes(1)
  })

  it('turns tickets into direct backend attachment URLs', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ url: `/api/files/${jobId}?ticket=short-lived`, expires_in: 60 }))
    const result = await handler(request(`/api/jobs/${jobId}/ticket`, { method: 'POST' }))
    expect(await result.json()).toMatchObject({ url: `https://personal-api.onrender.com/api/files/${jobId}?ticket=short-lived` })
  })

  it('rejects cross-origin ticket redirects and conceals backend authentication failures', async () => {
    const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ url: `https://evil.example/api/files/${jobId}?ticket=x` }))
    expect((await handler(request(`/api/jobs/${jobId}/ticket`, { method: 'POST' }))).status).toBe(502)
    upstream.mockResolvedValue(Response.json({ detail: 'raw private diagnostic' }, { status: 401 }))
    const result = await handler(request('/api/config'))
    expect(result.status).toBe(503)
    expect(await result.text()).not.toContain('raw private diagnostic')
  })

  it('does not follow redirects while holding the backend access key', async () => {
    const upstream = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('redirect refused'))
    expect((await handler(request('/api/config'))).status).toBe(502)
    expect(upstream.mock.calls[0][1]?.redirect).toBe('error')
  })
})
