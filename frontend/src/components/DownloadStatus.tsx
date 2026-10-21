import { useEffect, useState } from 'react'
import { ArrowDownIcon, CheckCircleIcon, SpinnerGapIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { filesize } from '../lib/format'
import type { Job } from '../types'

interface Props { job: Job; busy: boolean; onCancel: () => void; onSave: () => void }

export function DownloadStatus({ job, busy, onCancel, onSave }: Props) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const active = ['queued', 'downloading', 'processing'].includes(job.status)
  const expired = !!job.expires_at && now >= job.expires_at * 1000
  const minutes = job.expires_at ? Math.max(0, Math.ceil((job.expires_at * 1000 - now) / 60_000)) : 0
  const labels = {
    queued: 'You’re in the queue.', downloading: 'Grabbing your file…',
    processing: 'Putting it all together…', ready: expired ? 'This file has expired.' : 'All yours. Save it for later.',
    failed: 'This one didn’t come through.', cancelled: 'Download cancelled.',
  }

  return (
    <section className={`download-status ${job.status}`} aria-labelledby="download-status-title">
      <div className="status-heading">
        {active ? <SpinnerGapIcon className="spin" size={26} aria-hidden /> : job.status === 'ready' && !expired ? <CheckCircleIcon size={28} weight="fill" aria-hidden /> : <WarningCircleIcon size={26} aria-hidden />}
        <div><h2 id="download-status-title" role="status">{labels[job.status]}</h2><p className="muted status-filename">{job.filename || job.title}</p></div>
      </div>
      {active && <>
        <progress max={100} value={job.status === 'downloading' ? job.progress ?? undefined : undefined} aria-label="Download progress" />
        <div className="progress-detail"><span>{job.status === 'queued' ? 'One file at a time. Yours is up next.' : job.status === 'processing' ? 'Combining tracks or converting audio.' : `${filesize(job.downloaded_bytes)} downloaded${job.progress !== null ? ` · ${Math.floor(job.progress)}% of this track` : ''}`}</span>
          <button className="text-button" type="button" disabled={busy} onClick={onCancel}>Cancel</button>
        </div>
      </>}
      {job.status === 'ready' && !expired && <div className="save-row"><p>Ready for about {minutes} more {minutes === 1 ? 'minute' : 'minutes'}.<br /><span className="muted">Temporary files are automatically deleted.</span></p>
        <button className="button primary" type="button" onClick={onSave} disabled={busy}>
          {busy ? <SpinnerGapIcon className="spin" size={20} /> : <ArrowDownIcon size={20} />} Save file
        </button>
      </div>}
      {expired && <p className="muted">Fetch the video again to prepare a fresh file.</p>}
    </section>
  )
}
