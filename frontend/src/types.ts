export interface Connection {
  url: string
  key: string
}

export interface FormatOption {
  id: string
  label: string
  extension: string
  height: number | null
  filesize: number | null
  has_audio: boolean
}

export interface MediaInfo {
  id: string
  title: string
  platform: string
  uploader: string | null
  thumbnail: string | null
  duration: number
  formats: FormatOption[]
  audio_available: boolean
}

export type DownloadMode = 'video' | 'audio'
export type AudioFormat = 'mp3' | 'm4a'

export interface Job {
  id: string
  title: string
  status: 'queued' | 'downloading' | 'processing' | 'ready' | 'failed' | 'cancelled'
  progress: number | null
  downloaded_bytes: number
  total_bytes: number | null
  filename: string | null
  error: string | null
  expires_at: number | null
}

export interface JobRequest {
  media_id: string
  mode: DownloadMode
  format_id?: string
  audio_format: AudioFormat
}

export interface ServerConfig {
  max_duration_seconds: number
  max_file_mb: number
  file_ttl_seconds: number
  platforms: string[]
}
