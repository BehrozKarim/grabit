import { afterEach, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { deviceMemoryBudget, prepareOnDevice, processingArguments, readSource, sourceUrl } from './device'
import type { BrowserPlan } from '../types'

const source = { url: 'https://rr1.googlevideo.com/video', extension: 'mp4', filesize: null }
const direct: BrowserPlan = { route: 'direct', sources: [source], extension: 'mp4', reason: null }
const processor = vi.hoisted(() => ({
  loadEngine: vi.fn(), writeFile: vi.fn(), exec: vi.fn(), readFile: vi.fn(), on: vi.fn(), terminate: vi.fn(),
}))
vi.mock('./processor', () => ({ createProcessor: () => processor }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetAllMocks() })

it('checks a direct source without buffering a large file or imposing server limits', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('x', { status: 206, headers: { 'Content-Type': 'video/mp4' } }))
  const result = await prepareOnDevice({ ...direct, sources: [{ ...source, filesize: 5 * 1024 ** 3 }] },
    'Video', 9999, new AbortController().signal, vi.fn())
  expect(result).toMatchObject({ status: 'ready', direct: true, url: source.url, filename: 'Video.mp4' })
  expect(fetch).toHaveBeenCalledWith(source.url, expect.objectContaining({ credentials: 'omit', headers: { Range: 'bytes=0-0' }, redirect: 'error' }))
})

it('reports CORS failure instead of claiming that a source is ready', async () => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
  await expect(prepareOnDevice(direct, 'Video', 12, new AbortController().signal, vi.fn())).rejects.toThrow('Failed to fetch')
})

it.each(['https://localhost/file', 'https://googlevideo.com.evil.test/file',
  'http://video.twimg.com/file', 'https://a:b@video.twimg.com/file', 'https://video.twimg.com/file#x'])('rejects unsafe source %s', value => {
  expect(() => sourceUrl(value)).toThrow()
})

it('stops unknown-size streams at the memory budget', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Uint8Array(12)))
  await expect(readSource(source, 10, new AbortController().signal, vi.fn())).rejects.toThrow('memory budget')
  expect(deviceMemoryBudget()).toBeLessThanOrEqual(1024 ** 3)
})

it('rejects HTML errors even when the source returns HTTP 200', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>Denied</html>', { headers: { 'Content-Type': 'text/html' } }))
  await expect(prepareOnDevice(direct, 'Video', 12, new AbortController().signal, vi.fn())).rejects.toThrow('refused access')
})

it('maps selected tracks and copies video when merging, and actually encodes MP3', () => {
  expect(processingArguments('merge', ['video.mp4', 'audio.m4a'], 'mp4')).toEqual([
    '-nostdin', '-i', 'video.mp4', '-i', 'audio.m4a', '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-y', 'output.mp4',
  ])
  expect(processingArguments('convert', ['audio.m4a'], 'mp3')).toContain('libmp3lame')
  expect(processingArguments('convert', ['audio.webm'], 'm4a')).toContain('aac')
})

it('does not fetch when the backend only offers server processing', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
  await expect(prepareOnDevice({ ...direct, route: 'server', sources: [], reason: 'Needs server' },
    'Video', 12, new AbortController().signal, vi.fn())).rejects.toThrow('Needs server')
  expect(fetch).not.toHaveBeenCalled()
})

it('fetches both tracks directly, merges on the device and releases the worker', async () => {
  vi.stubGlobal('Worker', class {})
  const createUrl = vi.fn((blob: Blob) => { expect(blob.size).toBeGreaterThan(0); return 'blob:device-result' })
  vi.stubGlobal('URL', class extends URL { static createObjectURL = createUrl })
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(new Uint8Array([1, 2])))
    .mockResolvedValueOnce(new Response(new Uint8Array([3])))
  processor.loadEngine.mockResolvedValue(true)
  processor.exec.mockResolvedValue(0)
  processor.readFile.mockResolvedValue(new Uint8Array([4, 5, 6]))
  const result = await prepareOnDevice({ ...direct, route: 'merge', sources: [source,
    { ...source, url: 'https://rr1.googlevideo.com/audio', extension: 'm4a' }] },
  'A video', 12, new AbortController().signal, vi.fn())
  expect(result).toMatchObject({ status: 'ready', direct: false, url: 'blob:device-result' })
  expect(processor.writeFile).toHaveBeenCalledWith('input0.mp4', new Uint8Array([1, 2]))
  expect(processor.writeFile).toHaveBeenCalledWith('input1.m4a', new Uint8Array([3]))
  expect(createUrl.mock.calls[0][0]).toMatchObject({ size: 3, type: 'video/mp4' })
  expect(processor.terminate).toHaveBeenCalled()
})

it('terminates a loading worker when the user cancels', async () => {
  vi.stubGlobal('Worker', class {})
  let rejectLoad: (error: Error) => void = () => {}
  processor.loadEngine.mockImplementation(() => new Promise((_, reject) => { rejectLoad = reject }))
  processor.terminate.mockImplementation(() => rejectLoad(new Error('Terminated')))
  const controller = new AbortController()
  const operation = prepareOnDevice({ ...direct, route: 'convert', extension: 'mp3' },
    'Audio', 12, controller.signal, vi.fn())
  const rejected = expect(operation).rejects.toThrow('Terminated')
  await waitFor(() => expect(processor.loadEngine).toHaveBeenCalled())
  controller.abort()
  await rejected
  expect(processor.terminate).toHaveBeenCalled()
})
