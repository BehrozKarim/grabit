import type { BrowserPlan, BrowserSource, DeviceDownload } from '../types'

const extensions = ['mp4', 'webm', 'mov', 'mkv', 'm4a', 'mp3']
const domains = ['googlevideo.com', 'fbcdn.net', 'cdninstagram.com', 'twimg.com', 'tiktokcdn.com',
  'tiktokcdn-us.com', 'tiktokcdn-eu.com', 'byteoversea.com', 'ibytedtos.com', 'muscdn.com',
  'tiktok.com', 'akamaized.net', 'instagram.com', 'facebook.com']

export function sourceUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port ||
    [...value].some(c => c.charCodeAt(0) < 32 || c === '\\') || !domains.some(d => url.hostname === d || url.hostname.endsWith(`.${d}`))) {
    throw new Error('The platform returned an unsupported source address.')
  }
  return url.href
}

export function deviceMemoryBudget(): number {
  // Inputs, JS buffers, WASM memory and output coexist. Reserve most RAM for the browser/OS.
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  return Math.min(1024, Math.max(128, (memory || 4) * 1024 / 8)) * 1024 * 1024
}

async function sourceResponse(source: BrowserSource, signal: AbortSignal, probe = false) {
  const response = await fetch(sourceUrl(source.url), {
    signal, mode: 'cors', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
    ...(probe ? { headers: { Range: 'bytes=0-0' } } : {}),
  })
  if (!response.ok || response.type === 'opaque' ||
    /text\/|json|mpegurl|dash\+xml/i.test(response.headers.get('Content-Type') || '')) {
    await response.body?.cancel()
    throw new Error('The source refused access from this device or the link expired.')
  }
  return response
}

export async function readSource(source: BrowserSource, remaining: number, signal: AbortSignal,
  progress: (bytes: number) => void): Promise<Uint8Array> {
  const response = await sourceResponse(source, signal)
  const length = Number(response.headers.get('Content-Length'))
  if ((length > remaining) || (source.filesize || 0) > remaining) {
    await response.body?.cancel()
    throw new Error('This file is too large for the browser processing memory budget. Try a lower resolution.')
  }
  if (!response.body) throw new Error('This browser could not read the source stream.')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > remaining) throw new Error('This file exceeds the browser processing memory budget. Try a lower resolution.')
      chunks.push(value)
      progress(size)
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  if (!size) throw new Error('The platform returned an empty source file.')
  const data = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length }
  return data
}

export function processingArguments(route: 'merge' | 'convert', inputs: string[], extension: string): string[] {
  const args = ['-nostdin', ...inputs.flatMap(input => ['-i', input])]
  if (route === 'merge') args.push('-map', '0:v:0', '-map', '1:a:0', '-c', 'copy')
  else args.push('-map', '0:a:0', '-vn', '-c:a', extension === 'mp3' ? 'libmp3lame' : 'aac', '-b:a', '192k')
  return [...args, '-y', `output.${extension}`]
}

export async function prepareOnDevice(plan: BrowserPlan, title: string, duration: number,
  signal: AbortSignal, update: (state: DeviceDownload) => void): Promise<DeviceDownload> {
  signal.throwIfAborted()
  if (plan.route === 'server') throw new Error(plan.reason || 'This format needs server processing.')
  if (!plan.extension || !extensions.includes(plan.extension) ||
    plan.sources.length !== (plan.route === 'merge' ? 2 : 1) ||
    plan.sources.some(s => !extensions.includes(s.extension))) throw new Error('The download plan is invalid.')
  plan.sources.forEach(s => sourceUrl(s.url))
  const cleanTitle = [...title].filter(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127 && !'<>:"/\\|?*'.includes(c)).join('')
  const filename = `${cleanTitle.trim().slice(0, 100) || 'grabit-video'}.${plan.extension}`
  const working = (message: string, progress: number | null = null) => update({ status: 'working', message, progress })
  if (plan.route === 'direct') {
    working('Checking the direct source on this device…')
    const response = await sourceResponse(plan.sources[0], signal, true)
    await response.body?.cancel()
    signal.throwIfAborted()
    return { status: 'ready', message: 'Direct source ready. The file goes from the platform to your device.',
      progress: 100, url: sourceUrl(plan.sources[0].url), filename, direct: true }
  }
  if (typeof WebAssembly === 'undefined' || typeof Worker === 'undefined') {
    throw new Error('This browser does not support device-side media processing.')
  }
  let remaining = deviceMemoryBudget()
  if (plan.sources.reduce((n, s) => n + (s.filesize || 0), 0) > remaining) {
    throw new Error(`Browser processing on this device allows about ${Math.round(remaining / 1024 / 1024)} MiB of source data. Try a lower resolution.`)
  }
  working(`Loading the device media engine (about 31 MB on first use). Source memory budget: ${Math.round(remaining / 1024 / 1024)} MiB.`)
  const { createProcessor } = await import('./processor')
  signal.throwIfAborted()
  const ffmpeg = createProcessor()
  const stop = () => ffmpeg.terminate()
  signal.addEventListener('abort', stop, { once: true })
  const engineAbort = new AbortController()
  const engineSignal = AbortSignal.any([signal, engineAbort.signal])
  let timedOut = false
  const timeout = setTimeout(() => { timedOut = true; engineAbort.abort(); stop() }, 10 * 60 * 1000)
  try {
    let loadTimeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([ffmpeg.loadEngine(), new Promise<never>((_, reject) => {
        loadTimeout = setTimeout(() => reject(new Error('The browser media engine could not start. Try again or use server fallback.')), 60_000)
      })])
    } finally { clearTimeout(loadTimeout) }
    const inputs = []
    for (const [index, source] of plan.sources.entries()) {
      const data = await readSource(source, remaining, engineSignal, bytes => working(
        `Downloading source ${index + 1} of ${plan.sources.length} to this device…`,
        source.filesize ? Math.min(100, bytes / source.filesize * 100) : null,
      ))
      remaining -= data.byteLength
      const input = `input${index}.${source.extension}`
      await ffmpeg.writeFile(input, data)
      inputs.push(input)
    }
    working(plan.route === 'merge' ? 'Combining video and audio on this device…' : 'Converting audio on this device…')
    ffmpeg.on('progress', ({ time }) => working('Processing on this device…', duration ? Math.min(99, time / 1_000_000 / duration * 100) : null))
    const exitCode = await ffmpeg.exec(processingArguments(plan.route, inputs, plan.extension))
    if (exitCode !== 0) throw new Error('The browser media engine could not process this format.')
    const data = await ffmpeg.readFile(`output.${plan.extension}`)
    if (typeof data === 'string' || !data.byteLength) throw new Error('Device processing produced an empty file.')
    signal.throwIfAborted()
    const mime = { mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska' }[plan.extension]
    const blob = new Blob([new Uint8Array(data)], { type: mime })
    return { status: 'ready', message: 'Prepared on your device. Save the file before closing this page.',
      progress: 100, url: URL.createObjectURL(blob), filename, direct: false }
  } catch (error) {
    if (timedOut) throw new Error('Device preparation exceeded ten minutes. Try a smaller file or server fallback.', { cause: error })
    throw error
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', stop)
    ffmpeg.terminate()
  }
}
