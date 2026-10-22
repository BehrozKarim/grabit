import { afterEach, expect, it, vi } from 'vitest'
import { directAttachment, sourceUrl } from './download'
import type { BrowserPlan } from '../types'

const direct: BrowserPlan = { route: 'direct', extension: 'mp4', reason: null,
  sources: [{ url: 'https://rr1.googlevideo.com/video', extension: 'mp4', filesize: 5 * 1024 ** 3 }] }
afterEach(() => vi.restoreAllMocks())

it('hands off an attachment URL after cancelling its range probe, without reading the media body', async () => {
  const response = new Response('x', { status: 206, headers: {
    'Content-Disposition': 'attachment; filename="video.mp4"', 'Content-Type': 'video/mp4',
  } })
  const cancel = vi.spyOn(response.body!, 'cancel')
  const arrayBuffer = vi.spyOn(response, 'arrayBuffer')
  const blob = vi.spyOn(response, 'blob')
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response)
  expect(await directAttachment(direct, new AbortController().signal)).toBe(direct.sources[0].url)
  expect(fetch).toHaveBeenCalledWith(direct.sources[0].url, expect.objectContaining({
    credentials: 'omit', redirect: 'error', headers: { Range: 'bytes=0-0' },
  }))
  expect(cancel).toHaveBeenCalled()
  expect(arrayBuffer).not.toHaveBeenCalled()
  expect(blob).not.toHaveBeenCalled()
})

it.each(['inline; filename="video.mp4"', ''])('automatically chooses preparation when the source is not an attachment: %s', async disposition => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('x', { headers: {
    'Content-Disposition': disposition, 'Content-Type': 'video/mp4',
  } }))
  expect(await directAttachment(direct, new AbortController().signal)).toBeNull()
})

it('chooses preparation when a platform blocks browser access', async () => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
  expect(await directAttachment(direct, new AbortController().signal)).toBeNull()
})

it('leaves conversion and merging to the backend without fetching their source bodies', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
  expect(await directAttachment({ ...direct, route: 'merge' }, new AbortController().signal)).toBeNull()
  expect(await directAttachment({ ...direct, route: 'convert' }, new AbortController().signal)).toBeNull()
  expect(fetch).not.toHaveBeenCalled()
})

it.each(['https://localhost/file', 'https://googlevideo.com.evil.test/file',
  'http://video.twimg.com/file', 'https://user:pass@video.twimg.com/file'])('rejects unsafe sources: %s', value => {
  expect(() => sourceUrl(value)).toThrow()
})
