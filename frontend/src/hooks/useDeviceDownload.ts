import { useEffect, useRef, useState } from 'react'
import type { GrabitApi } from '../lib/api'
import { ApiError } from '../lib/api'
import { prepareOnDevice } from '../lib/device'
import type { DeviceDownload, JobRequest, MediaInfo } from '../types'

export function useDeviceDownload(api: GrabitApi) {
  const [device, setDevice] = useState<DeviceDownload | null>(null)
  const [fallback, setFallback] = useState<JobRequest | null>(null)
  const controller = useRef<AbortController | null>(null)
  const objectUrl = useRef<string | null>(null)

  function release() {
    controller.current?.abort()
    controller.current = null
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
    objectUrl.current = null
  }

  useEffect(() => () => {
    controller.current?.abort()
    controller.current = null
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
  }, [api])

  function reset() { release(); setDevice(null); setFallback(null) }

  async function download(media: MediaInfo, request: JobRequest) {
    release()
    const action = new AbortController()
    controller.current = action
    setFallback(null)
    setDevice({ status: 'working', message: 'Finding a device download route…', progress: null })
    const timeout = setTimeout(() => action.abort(), 15 * 60 * 1000)
    try {
      const plan = await api.plan(request, action.signal)
      const result = await prepareOnDevice(plan, media.title, media.duration, action.signal, state => {
        if (!action.signal.aborted) setDevice(state)
      })
      if (action.signal.aborted) {
        if (result.url?.startsWith('blob:')) URL.revokeObjectURL(result.url)
        return
      }
      if (!result.direct) objectUrl.current = result.url || null
      setDevice(result)
    } catch (error) {
      if (action.signal.aborted) return
      if (error instanceof ApiError) {
        setDevice({ status: 'cancelled', message: error.message, progress: null })
        return
      }
      const message = error instanceof TypeError ?
        'The platform blocked browser access, the source link expired, or the network was interrupted.' :
        error instanceof Error ? error.message : 'Device processing could not finish on this browser.'
      setDevice({ status: 'fallback', message, progress: null })
      setFallback(request)
    } finally {
      clearTimeout(timeout)
      if (action.signal.aborted && controller.current === action) {
        setDevice({ status: 'cancelled', message: 'Device preparation stopped. You can try again.', progress: null })
      }
    }
  }

  function cancel() {
    release()
    setDevice({ status: 'cancelled', message: 'Device preparation cancelled.', progress: null })
  }

  return { device, fallback, download, reset, cancel, working: device?.status === 'working' }
}
