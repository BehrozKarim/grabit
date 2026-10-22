import type { JobRequest, MediaInfo, ServerConfig } from '../types'

export function serverLimitMessage(media: MediaInfo, request: JobRequest, config: ServerConfig | null): string | null {
  if (!config) return 'Checking server limits…'
  if (config.max_duration_seconds > 0 && media.duration !== null && media.duration > config.max_duration_seconds) {
    return 'This video is too long for this server. Connect your own backend in Settings to prepare it there.'
  }
  const option = media.formats.find(f => f.id === request.format_id)
  if (request.mode === 'video' && config.max_file_mb > 0 && (option?.filesize || 0) > config.max_file_mb * 1024 * 1024) {
    return 'This source exceeds the server’s file-size limit. Try a lower resolution or your own backend.'
  }
  return null
}
