import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import App from './App'
import { startNativeDownload } from './lib/download'
import type { BrowserPlan } from './types'

vi.mock('./lib/download', async importOriginal => ({
  ...await importOriginal<typeof import('./lib/download')>(), startNativeDownload: vi.fn(),
}))
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn() })
afterEach(() => { localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks(); vi.clearAllMocks() })

const media = { id: 'a'.repeat(32), title: 'A video', platform: 'YouTube', duration: 12,
  thumbnail: null, uploader: null, audio_available: true,
  formats: [{ id: '720', label: '720p', height: 720, extension: 'mp4', has_audio: true, filesize: null }] }
const ready = { id: 'b'.repeat(32), title: 'A video', status: 'ready', filename: 'video.mp4',
  expires_at: Date.now() / 1000 + 900, progress: 100, downloaded_bytes: 10, total_bytes: 10 }
const attachment = `https://backend.example/api/files/${ready.id}?ticket=opaque-ticket`

function setup(plan: BrowserPlan, options: { blocked?: boolean; large?: boolean } = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = String(input)
    if (url.includes('googlevideo.com')) {
      if (options.blocked) throw new TypeError('Failed to fetch')
      return new Response('x', { status: 206, headers: { 'Content-Disposition': 'attachment; filename="video.mp4"', 'Content-Type': 'video/mp4' } })
    }
    const path = new URL(url, 'http://localhost').searchParams.get('path')
    if (path === '/api/config') return Response.json({ max_file_mb: 150, max_duration_seconds: 1200 })
    if (path === '/api/media') return Response.json(options.large ? { ...media, duration: 9999,
      formats: [{ ...media.formats[0], filesize: 5 * 1024 ** 3 }] } : media)
    if (path === '/api/plan') return Response.json(plan)
    if (path === '/api/jobs') return Response.json({ ...ready, status: 'queued' })
    if (path?.endsWith('/ticket')) return Response.json({ url: attachment })
    if (path?.startsWith('/api/jobs/')) return Response.json(ready)
    throw new Error(`Unexpected request: ${url}`)
  })
}

async function inspect() {
  const user = userEvent.setup()
  render(<App />)
  await user.type(screen.getByLabelText('Video or post link'), 'https://youtu.be/test')
  await user.click(screen.getByRole('button', { name: 'Grab this link' }))
  await screen.findByRole('button', { name: 'Download' })
  return user
}

it('starts with the hosted backend and displays preparation limits', async () => {
  const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ max_file_mb: 150, max_duration_seconds: 1200 }))
  render(<App />)
  expect(await screen.findByText('Preparation limits: 20 min max · 150 MiB max')).toBeInTheDocument()
  expect(upstream.mock.calls[0][0]).toBe('/api/backend?path=%2Fapi%2Fconfig')
  expect(screen.queryByLabelText('Backend address')).not.toBeInTheDocument()
})

it('shows an uncapped personal backend without imposing hosted limits', async () => {
  localStorage.setItem('grabit.connection', JSON.stringify({ mode: 'custom', url: 'http://127.0.0.1:8000' }))
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ max_file_mb: 0, max_duration_seconds: 0 }))
  render(<App />)
  expect(await screen.findByText('Preparation limits: No size or duration cap')).toBeInTheDocument()
  expect(screen.queryByText(/150 MiB/)).not.toBeInTheDocument()
})

const direct: BrowserPlan = { route: 'direct', extension: 'mp4', reason: null, sources: [
  { url: 'https://rr1.googlevideo.com/video', extension: 'mp4', filesize: null },
] }

it('automatically falls back and starts the attachment download after one Download click', async () => {
  const upstream = setup(direct, { blocked: true })
  const user = await inspect()
  await user.click(screen.getByRole('button', { name: 'Download' }))
  await waitFor(() => expect(startNativeDownload).toHaveBeenCalledWith(attachment))
  expect(startNativeDownload).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('button', { name: /prepare|save file|fallback/i })).not.toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: 'Download' })).toHaveLength(1)
  const creations = () => upstream.mock.calls.filter(([url]) => String(url) === '/api/backend?path=%2Fapi%2Fjobs')
  expect(creations()).toHaveLength(1)
  // A retry uses the ready file, rather than processing a duplicate job.
  await waitFor(() => expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled())
  await user.click(screen.getByRole('button', { name: 'Download' }))
  await waitFor(() => expect(startNativeDownload).toHaveBeenCalledTimes(2))
  expect(creations()).toHaveLength(1)
})

it('downloads a large complete attachment directly without applying preparation limits', async () => {
  const upstream = setup(direct, { large: true })
  const user = await inspect()
  await user.click(screen.getByRole('button', { name: 'Download' }))
  await waitFor(() => expect(startNativeDownload).toHaveBeenCalledWith(direct.sources[0].url))
  expect(upstream.mock.calls.some(([url]) => String(url) === '/api/backend?path=%2Fapi%2Fjobs')).toBe(false)
})

it('sends merge/conversion requests to backend processing and automatically downloads the result', async () => {
  const upstream = setup({ ...direct, route: 'convert' })
  const user = await inspect()
  await user.click(screen.getByRole('button', { name: 'Audio only' }))
  await user.click(screen.getByRole('button', { name: 'Download' }))
  await waitFor(() => expect(startNativeDownload).toHaveBeenCalledWith(attachment))
  const creation = upstream.mock.calls.find(([url]) => String(url) === '/api/backend?path=%2Fapi%2Fjobs')
  expect(JSON.parse(String(creation?.[1]?.body))).toMatchObject({ mode: 'audio', audio_format: 'mp3' })
  expect(upstream.mock.calls.some(([url]) => String(url).includes('googlevideo.com'))).toBe(false)
})

it('enforces server limits when automatic fallback is needed', async () => {
  const upstream = setup(direct, { blocked: true, large: true })
  const user = await inspect()
  await user.click(screen.getByRole('button', { name: 'Download' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('too long for this server')
  expect(startNativeDownload).not.toHaveBeenCalled()
  expect(upstream.mock.calls.some(([url]) => String(url) === '/api/backend?path=%2Fapi%2Fjobs')).toBe(false)
})

it('restores a ready file without automatically downloading it on page load', async () => {
  sessionStorage.setItem('grabit.job:hosted:', ready.id)
  setup(direct)
  const user = userEvent.setup()
  render(<App />)
  const download = await screen.findByRole('button', { name: 'Download' })
  expect(startNativeDownload).not.toHaveBeenCalled()
  await user.click(download)
  await waitFor(() => expect(startNativeDownload).toHaveBeenCalledWith(attachment))
})
