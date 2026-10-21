import { render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import App from './App'

afterEach(() => { localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks() })

it('starts with the hosted backend and displays its actual limits', async () => {
  const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ max_file_mb: 150, max_duration_seconds: 1200 }))
  render(<App />)
  expect(await screen.findByText('Server fallback: 20 min max · 150 MiB max')).toBeInTheDocument()
  expect(upstream.mock.calls[0][0]).toBe('/api/backend?path=%2Fapi%2Fconfig')
  expect(screen.queryByLabelText('Backend address')).not.toBeInTheDocument()
})

it('shows an uncapped personal backend without imposing hosted limits in the browser', async () => {
  localStorage.setItem('grabit.connection', JSON.stringify({ mode: 'custom', url: 'http://127.0.0.1:8000' }))
  const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ max_file_mb: 0, max_duration_seconds: 0 }))
  render(<App />)
  expect(await screen.findByText('Server fallback: No size or duration cap')).toBeInTheDocument()
  expect(upstream.mock.calls[0][0]).toBe('http://127.0.0.1:8000/api/config')
  expect(screen.queryByText(/150 MiB/)).not.toBeInTheDocument()
})

it('requires an explicit click before a blocked browser download uses the server', async () => {
  const user = userEvent.setup()
  Element.prototype.scrollIntoView = vi.fn()
  const upstream = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = String(input)
    if (url.includes('googlevideo.com')) throw new TypeError('Failed to fetch')
    const path = new URL(url, 'http://localhost').searchParams.get('path')
    if (path === '/api/config') return Response.json({ max_file_mb: 150, max_duration_seconds: 1200 })
    if (path === '/api/media') return Response.json({ id: 'a'.repeat(32), title: 'A video', platform: 'YouTube',
      duration: 12, thumbnail: null, uploader: null, audio_available: true,
      formats: [{ id: '720', label: '720p', height: 720, extension: 'mp4', has_audio: true, filesize: null }] })
    if (path === '/api/plan') return Response.json({ route: 'direct', extension: 'mp4', sources: [
      { url: 'https://rr1.googlevideo.com/video', extension: 'mp4', filesize: null },
    ] })
    return Response.json({ id: 'b'.repeat(32), title: 'A video', status: 'failed', error: 'Fixture stopped' })
  })
  render(<App />)
  await user.type(screen.getByLabelText('Video or post link'), 'https://youtu.be/test')
  await user.click(screen.getByRole('button', { name: 'Grab this link' }))
  await user.click(await screen.findByRole('button', { name: 'Prepare video on device' }))
  const fallback = await screen.findByRole('button', { name: 'Use server fallback' })
  const jobCalls = () => upstream.mock.calls.filter(([url]) => String(url).includes('path=%2Fapi%2Fjobs'))
  expect(jobCalls()).toHaveLength(0)
  expect(screen.getByText(/platform blocked browser access/)).toBeInTheDocument()
  await user.click(fallback)
  expect(jobCalls()).toHaveLength(1)
})
