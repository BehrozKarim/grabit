import { useState } from 'react'
import { ArrowDownIcon, FilmStripIcon, HeadphonesIcon, SpinnerGapIcon } from '@phosphor-icons/react'
import { duration, filesize } from '../lib/format'
import type { AudioFormat, DownloadMode, JobRequest, MediaInfo } from '../types'

interface Props {
  media: MediaInfo
  busy: boolean
  onDownload: (request: JobRequest) => void
}

export function MediaResult({ media, busy, onDownload }: Props) {
  const [mode, setMode] = useState<DownloadMode>(media.formats.length ? 'video' : 'audio')
  const [formatId, setFormatId] = useState(media.formats.find(f => (f.height || 0) <= 1080)?.id || media.formats[0]?.id || '')
  const [audioFormat, setAudioFormat] = useState<AudioFormat>('mp3')
  const [imageFailed, setImageFailed] = useState(false)
  const current = media.formats.find(f => f.id === formatId)

  return (
    <section className="result-panel" aria-labelledby="video-title">
      <div className="media-summary">
        <div className="thumbnail">
          {media.thumbnail && !imageFailed ? <img src={media.thumbnail} alt="" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} /> : <FilmStripIcon size={34} aria-hidden />}
          <span className="duration">{duration(media.duration)}</span>
        </div>
        <div className="media-details"><p className="eyebrow">{media.platform}</p><h2 id="video-title">{media.title}</h2>
          {media.uploader && <p className="muted">{media.uploader}</p>}
        </div>
      </div>
      <fieldset className="mode-picker">
        <legend className="sr-only">Download type</legend>
        <button type="button" aria-pressed={mode === 'video'} disabled={!media.formats.length || busy} onClick={() => setMode('video')}>
          <FilmStripIcon size={21} aria-hidden /> Video
        </button>
        <button type="button" aria-pressed={mode === 'audio'} disabled={!media.audio_available || busy} onClick={() => setMode('audio')}>
          <HeadphonesIcon size={21} aria-hidden /> Audio only
        </button>
      </fieldset>
      <div className="download-options">
        <div className="format-field">
          <label htmlFor="download-format">{mode === 'video' ? 'Video quality' : 'Audio format'}</label>
          {mode === 'video' ? <select id="download-format" value={formatId} onChange={e => setFormatId(e.target.value)} disabled={busy}>
            {media.formats.map(f => <option key={f.id} value={f.id}>{f.label} · {f.extension.toUpperCase()}</option>)}
          </select> : <select id="download-format" value={audioFormat} onChange={e => setAudioFormat(e.target.value as AudioFormat)} disabled={busy}>
            <option value="mp3">MP3 · 192 kbps target</option><option value="m4a">M4A · AAC audio</option>
          </select>}
        </div>
        <button className="button primary prepare-button" type="button" disabled={busy}
          onClick={() => onDownload({ media_id: media.id, mode, format_id: mode === 'video' ? formatId : undefined, audio_format: audioFormat })}>
          {busy ? <SpinnerGapIcon className="spin" size={20} /> : <ArrowDownIcon size={20} />}
          Prepare {mode === 'video' ? 'video' : audioFormat.toUpperCase()}
        </button>
      </div>
      <p className="field-hint">{mode === 'video' && current?.filesize ? `About ${filesize(current.filesize)} before combining audio. ` : ''}
        Available quality depends on the original. Files are prepared on your server.
      </p>
    </section>
  )
}
