import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../lib/api'
import type { GrabitApi } from '../lib/api'
import { directAttachment, startNativeDownload } from '../lib/download'
import { readableError } from '../lib/format'
import { serverLimitMessage } from '../lib/limits'
import type { Job, JobRequest, MediaInfo, ServerConfig } from '../types'

export function useDownloader(api: GrabitApi) {
  const [media, setMedia] = useState<MediaInfo | null>(null)
  const [job, setJob] = useState<Job | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [downloadStarted, setDownloadStarted] = useState(false)
  const action = useRef<AbortController | null>(null)
  const automaticJob = useRef<string | null>(null)
  const lastRequest = useRef<string | null>(null)
  const storageKey = `grabit.job:${api.connection.mode}:${api.connection.url}`
  const jobId = job?.id
  const terminal = job && ['ready', 'failed', 'cancelled'].includes(job.status)

  useEffect(() => {
    const controller = new AbortController()
    let savedId: string | null = null
    try { savedId = sessionStorage.getItem(storageKey) } catch { /* Optional session recovery. */ }
    if (savedId) {
      api.job(savedId, controller.signal).then(result => {
        if (!controller.signal.aborted) setJob(result)
      }).catch(error => {
        if (!controller.signal.aborted && error instanceof ApiError && error.status === 410) {
          try { sessionStorage.removeItem(storageKey) } catch { /* Optional. */ }
        }
      })
    }
    // Refreshing a page restores progress, but never initiates an unsolicited download.
    return () => controller.abort()
  }, [api, storageKey])

  useEffect(() => () => action.current?.abort(), [api])

  const handoff = useCallback(async (id: string, controller: AbortController) => {
    setBusy(true)
    setError('')
    try {
      const url = await api.downloadUrl(id, controller.signal)
      if (controller.signal.aborted) return
      startNativeDownload(url)
      setDownloadStarted(true)
    } catch (error) {
      if (!controller.signal.aborted) setError(readableError(error))
    } finally {
      if (!controller.signal.aborted && action.current === controller) setBusy(false)
    }
  }, [api])

  useEffect(() => {
    if (job?.status !== 'ready' || automaticJob.current !== job.id) return
    automaticJob.current = null
    const controller = action.current
    if (controller && !controller.signal.aborted) void handoff(job.id, controller)
  }, [job, handoff])

  useEffect(() => {
    if (!jobId || terminal) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    let failures = 0
    async function poll() {
      try {
        const next = await api.job(jobId!, controller.signal)
        if (controller.signal.aborted) return
        failures = 0
        setError('')
        setJob(next)
        if (next.status === 'failed') setError(next.error || 'This download failed. Try another quality.')
        if (['ready', 'failed', 'cancelled'].includes(next.status)) return
      } catch (error) {
        if (controller.signal.aborted) return
        failures++
        if (error instanceof ApiError && [401, 403, 410].includes(error.status)) {
          automaticJob.current = null
          setError(readableError(error))
          setJob(previous => previous ? { ...previous, status: 'failed', error: readableError(error) } : null)
          return
        }
        if (failures >= 3) setError('Connection interrupted. Reconnecting to your download…')
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, Math.min(10_000, 1500 * (failures + 1)))
    }
    void poll()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [api, jobId, terminal])

  const inspect = useCallback(async (url: string) => {
    action.current?.abort()
    automaticJob.current = null
    lastRequest.current = null
    const controller = new AbortController()
    action.current = controller
    setBusy(true)
    setError('')
    setNotice('')
    setDownloadStarted(false)
    setMedia(null)
    setJob(null)
    try { sessionStorage.removeItem(storageKey) } catch { /* Optional. */ }
    try {
      const result = await api.inspect(url.trim(), controller.signal)
      if (!controller.signal.aborted) setMedia(result)
    } catch (error) {
      if (!controller.signal.aborted) setError(readableError(error))
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }, [api, storageKey])

  async function download(request: JobRequest, config: ServerConfig | null) {
    if (!media) return
    action.current?.abort()
    const controller = new AbortController()
    action.current = controller
    automaticJob.current = null
    setError('')
    setNotice('')
    setDownloadStarted(false)
    const requestKey = JSON.stringify(request)
    if (job?.status === 'ready' && lastRequest.current === requestKey &&
      (!job.expires_at || job.expires_at * 1000 > Date.now())) {
      await handoff(job.id, controller)
      return
    }
    setJob(null)
    setBusy(true)
    setNotice('Getting your download ready…')
    try {
      const plan = await api.plan(request, controller.signal)
      const direct = await directAttachment(plan, controller.signal)
      controller.signal.throwIfAborted()
      if (direct) {
        startNativeDownload(direct)
        setDownloadStarted(true)
        setNotice('Download started. Check your browser’s downloads.')
        return
      }
      const limits = config || await api.config(controller.signal)
      const blocked = serverLimitMessage(media, request, limits)
      if (blocked) throw new Error(blocked)
      controller.signal.throwIfAborted()
      const result = await api.createJob(request, controller.signal)
      if (controller.signal.aborted) return
      automaticJob.current = result.id
      lastRequest.current = requestKey
      setJob(result)
      setNotice('')
      try { sessionStorage.setItem(storageKey, result.id) } catch { /* Optional. */ }
    } catch (error) {
      if (!controller.signal.aborted) { setError(readableError(error)); setNotice('') }
    } finally {
      if (!controller.signal.aborted && action.current === controller) setBusy(false)
    }
  }

  async function cancel() {
    automaticJob.current = null
    action.current?.abort()
    setNotice('Download cancelled.')
    setBusy(false)
    if (!job || !['queued', 'downloading', 'processing'].includes(job.status)) return
    setBusy(true)
    try { setJob(await api.cancelJob(job.id)); setError('') }
    catch (error) { setError(readableError(error)) }
    finally { setBusy(false) }
  }

  async function retry() {
    if (!job) return
    action.current?.abort()
    const controller = new AbortController()
    action.current = controller
    await handoff(job.id, controller)
  }

  return { media, job, busy, error, notice, downloadStarted, inspect, download, cancel, retry }
}
