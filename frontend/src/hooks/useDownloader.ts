import { useCallback, useEffect, useRef, useState } from 'react'
import type { GrabitApi } from '../lib/api'
import { ApiError } from '../lib/api'
import { readableError } from '../lib/format'
import type { Job, JobRequest, MediaInfo } from '../types'

export function useDownloader(api: GrabitApi) {
  const [media, setMedia] = useState<MediaInfo | null>(null)
  const [job, setJob] = useState<Job | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [polling, setPolling] = useState(false)
  const action = useRef<AbortController | null>(null)
  const jobId = job?.id
  const terminal = job && ['ready', 'failed', 'cancelled'].includes(job.status)

  useEffect(() => {
    const controller = new AbortController()
    const storageKey = `grabit.job:${api.connection.mode}:${api.connection.url}`
    let savedId: string | null = null
    try { savedId = sessionStorage.getItem(storageKey) } catch { /* Session storage is optional. */ }
    if (savedId) {
      api.job(savedId, controller.signal).then(result => {
        if (!controller.signal.aborted) setJob(result)
      }).catch(error => {
        if (!controller.signal.aborted && error instanceof ApiError && error.status === 410) {
          try { sessionStorage.removeItem(storageKey) } catch { /* Session storage is optional. */ }
        }
      })
    }
    return () => controller.abort()
  }, [api])

  useEffect(() => () => action.current?.abort(), [api])

  useEffect(() => {
    if (!jobId || terminal) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    let failures = 0
    async function poll() {
      setPolling(true)
      try {
        const next = await api.job(jobId!, controller.signal)
        if (controller.signal.aborted) return
        failures = 0
        setError('')
        setJob(next)
        if (next.status === 'failed') setError(next.error || 'This download failed. Try another format.')
        if (['ready', 'failed', 'cancelled'].includes(next.status)) return
      } catch (error) {
        if (controller.signal.aborted) return
        failures++
        if (error instanceof ApiError && [401, 403, 410].includes(error.status)) {
          setError(readableError(error))
          setJob(previous => previous ? { ...previous, status: 'failed', error: readableError(error) } : null)
          setPolling(false)
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
    const controller = new AbortController()
    action.current = controller
    setBusy(true)
    setError('')
    setMedia(null)
    setJob(null)
    try { sessionStorage.removeItem(`grabit.job:${api.connection.mode}:${api.connection.url}`) } catch { /* Optional. */ }
    try {
      const result = await api.inspect(url.trim(), controller.signal)
      if (!controller.signal.aborted) setMedia(result)
    } catch (error) {
      if (!controller.signal.aborted) setError(readableError(error))
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }, [api])

  async function createJob(request: JobRequest) {
    action.current?.abort()
    const controller = new AbortController()
    action.current = controller
    setBusy(true)
    setError('')
    try {
      const result = await api.createJob(request, controller.signal)
      if (!controller.signal.aborted) {
        setJob(result)
        try { sessionStorage.setItem(`grabit.job:${api.connection.mode}:${api.connection.url}`, result.id) } catch { /* Optional. */ }
      }
    } catch (error) {
      if (!controller.signal.aborted) setError(readableError(error))
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  async function cancel() {
    if (!job) return
    setBusy(true)
    try {
      setJob(await api.cancelJob(job.id))
      setError('')
    } catch (error) { setError(readableError(error)) }
    finally { setBusy(false) }
  }

  async function save() {
    if (!job) return
    setBusy(true)
    setError('')
    try {
      // Navigate to a short-lived attachment URL; do not buffer the video in phone memory.
      window.location.assign(await api.downloadUrl(job.id))
    } catch (error) { setError(readableError(error)) }
    finally { setBusy(false) }
  }

  return { media, job, busy, error, polling, inspect, createJob, cancel, save }
}
