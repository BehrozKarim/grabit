import { describe, expect, it, vi } from 'vitest'
import { ApiError, GrabitApi, normalizeApiUrl } from './api'

describe('backend connections', () => {
  it('allows HTTPS and local development while rejecting credential-bearing or insecure URLs', () => {
    expect(normalizeApiUrl('https://grabit-api.onrender.com/')).toBe('https://grabit-api.onrender.com')
    expect(normalizeApiUrl('http://127.0.0.1:8000')).toBe('http://127.0.0.1:8000')
    for (const value of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com?key=secret']) {
      expect(() => normalizeApiUrl(value)).toThrow()
    }
  })

  it('sends the access key in a header rather than the request URL', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ platforms: [] })))
    const api = new GrabitApi({ mode: 'custom', url: 'https://api.example.com', key: 'personal-key' })
    await api.config()
    expect(fetch.mock.calls[0][0]).toBe('https://api.example.com/api/config')
    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer personal-key' })
    fetch.mockRestore()
  })

  it('preserves actionable server errors and handles non-JSON wake-up responses', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ detail: 'Formats expired.' }), { status: 410 }))
    const api = new GrabitApi({ mode: 'custom', url: 'https://api.example.com', key: '' })
    await expect(api.job('id')).rejects.toMatchObject({ message: 'Formats expired.', status: 410 })
    fetch.mockResolvedValue(new Response('<html>Waking up</html>', { status: 503 }))
    await expect(api.job('id')).rejects.toBeInstanceOf(ApiError)
    fetch.mockRestore()
  })

  it('rejects download tickets pointing at a different server', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ url: 'https://other.example.com/api/files/id' })))
    const api = new GrabitApi({ mode: 'custom', url: 'https://api.example.com', key: '' })
    await expect(api.downloadUrl('id')).rejects.toThrow('invalid download link')
    fetch.mockRestore()
  })

  it('uses the same-origin adapter by default without a browser-side access key', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ platforms: [] })))
    const api = new GrabitApi({ mode: 'hosted', url: '', key: '' })
    await api.config()
    expect(fetch.mock.calls[0][0]).toBe('/api/backend?path=%2Fapi%2Fconfig')
    expect(fetch.mock.calls[0][1]?.headers).not.toHaveProperty('Authorization')
    fetch.mockRestore()
  })

  it('downloads hosted files directly from the backend rather than through Vercel', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ url: 'https://api.example.com/api/files/id?ticket=temporary' })))
    const api = new GrabitApi({ mode: 'hosted', url: '', key: '' })
    await expect(api.downloadUrl('id')).resolves.toBe('https://api.example.com/api/files/id?ticket=temporary')
    fetch.mockRestore()
  })
})
