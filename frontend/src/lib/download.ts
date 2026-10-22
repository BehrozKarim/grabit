import type { BrowserPlan } from '../types'

const domains = ['googlevideo.com', 'fbcdn.net', 'cdninstagram.com', 'twimg.com', 'tiktokcdn.com',
  'tiktokcdn-us.com', 'tiktokcdn-eu.com', 'byteoversea.com', 'ibytedtos.com', 'muscdn.com',
  'tiktok.com', 'akamaized.net', 'instagram.com', 'facebook.com']

export function sourceUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port ||
    [...value].some(c => c.charCodeAt(0) < 32 || c === '\\') ||
    !domains.some(d => url.hostname === d || url.hostname.endsWith(`.${d}`))) {
    throw new Error('The platform returned an unsupported source address.')
  }
  return url.href
}

export function startNativeDownload(url: string): void {
  // A normal attachment navigation: no fetch-to-Blob, arrayBuffer, or media in React state.
  window.location.assign(url)
}

/** Request a small range and cancel the body. Only bypass the backend for an actual downloadable attachment. */
export async function directAttachment(plan: BrowserPlan, signal: AbortSignal): Promise<string | null> {
  if (plan.route !== 'direct' || plan.sources.length !== 1) return null
  try {
    const url = sourceUrl(plan.sources[0].url)
    const response = await fetch(url, {
      method: 'GET', headers: { Range: 'bytes=0-0' }, credentials: 'omit', redirect: 'error',
      referrerPolicy: 'no-referrer', mode: 'cors',
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    })
    const attachment = response.ok && response.type !== 'opaque' &&
      /^attachment(?:;|$)/i.test(response.headers.get('Content-Disposition') || '') &&
      !/text\/|json|mpegurl|dash\+xml/i.test(response.headers.get('Content-Type') || '')
    await response.body?.cancel()
    signal.throwIfAborted()
    return attachment ? url : null
  } catch (error) {
    if (signal.aborted) throw error
    return null
  }
}
