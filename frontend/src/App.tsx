import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownIcon, ArrowRightIcon, ArrowSquareOutIcon, CheckCircleIcon, ClipboardTextIcon,
  GearSixIcon, LinkSimpleIcon, SpinnerGapIcon, WarningCircleIcon,
} from '@phosphor-icons/react'
import { GrabitApi } from './lib/api'
import { useDownloader } from './hooks/useDownloader'
import { Settings } from './components/Settings'
import { MediaResult } from './components/MediaResult'
import { DownloadStatus } from './components/DownloadStatus'
import type { Connection, ServerConfig } from './types'

function initialConnection(): Connection {
  const defaultUrl = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://127.0.0.1:8000' : '')
  try {
    return { url: localStorage.getItem('grabit.server') || defaultUrl, key: sessionStorage.getItem('grabit.key') || '' }
  } catch { return { url: defaultUrl, key: '' } }
}

function Downloader({ connection, onSettings }: { connection: Connection; onSettings: () => void }) {
  const api = useMemo(() => new GrabitApi(connection), [connection])
  const { media, job, busy, error, inspect, createJob, cancel, save } = useDownloader(api)
  const [url, setUrl] = useState('')
  const [clipboardError, setClipboardError] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [config, setConfig] = useState<ServerConfig | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const results = useRef<HTMLDivElement>(null)
  const active = !!job && ['queued', 'downloading', 'processing'].includes(job.status)

  useEffect(() => {
    const controller = new AbortController()
    if (connection.url) api.config(controller.signal).then(setConfig).catch(() => {})
    return () => controller.abort()
  }, [api, connection.url])

  useEffect(() => {
    if (!busy) return
    const timer = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(timer)
  }, [busy])

  useEffect(() => {
    if (media) results.current?.scrollIntoView({ behavior: 'instant', block: 'nearest' })
  }, [media])

  function submit(event: React.FormEvent) {
    event.preventDefault()
    setClipboardError('')
    setElapsed(0)
    if (!connection.url) { onSettings(); return }
    void inspect(url)
  }

  async function paste() {
    try {
      if (!navigator.clipboard?.readText) throw new Error('Clipboard access is unavailable. Paste the link into the field manually.')
      setUrl(await navigator.clipboard.readText())
      setClipboardError('')
      input.current?.focus()
    } catch { setClipboardError('Clipboard access was blocked. Press and hold the link field to paste manually.') }
  }

  return <>
    <section className="grab-panel" aria-labelledby="grab-title">
      <div className="panel-heading"><h2 id="grab-title">What caught your eye?</h2><span>PASTE. PICK. KEEP.</span></div>
      <form onSubmit={submit} className="link-form">
        <label htmlFor="video-url">Video or post link</label>
        <div className="url-field"><LinkSimpleIcon size={23} aria-hidden /><input ref={input} id="video-url" name="url" type="url" inputMode="url" autoComplete="off" autoCapitalize="off" spellCheck={false}
          required placeholder="Paste your video link here" value={url} onChange={e => setUrl(e.target.value)} disabled={busy || active} aria-describedby="link-hint" />
          <button type="button" className="paste-button" onClick={paste} disabled={busy || active} aria-label="Paste link from clipboard"><ClipboardTextIcon size={19} /><span>Paste</span></button>
        </div>
        <button className="button primary fetch-button" type="submit" disabled={busy || active}>
          {busy && !media ? <><SpinnerGapIcon className="spin" size={21} /> Finding your video…</> : <>Grab this link <ArrowRightIcon size={21} /></>}
        </button>
        <p className="field-hint" id="link-hint">Public video links work best. Sign-in-only content isn’t supported.</p>
      </form>
      {busy && !media && <p className="loading-note" role="status">{elapsed >= 12 ? 'Still working. A sleeping server may need about a minute to wake up.' : 'Checking the source for available video and audio formats.'}</p>}
      {(error || clipboardError) && <div className="error-notice" role="alert"><WarningCircleIcon size={23} aria-hidden /><div><p>{error || clipboardError}</p>
        {(error.includes('key') || error.includes('Settings')) && <button className="text-button" type="button" onClick={onSettings}>Open Settings <ArrowRightIcon size={16} /></button>}
      </div></div>}
      <div ref={results}>
        {media && !active && job?.status !== 'ready' && <MediaResult key={media.id} media={media} busy={busy} onDownload={request => void createJob(request)} />}
        {job && <DownloadStatus job={job} busy={busy} onCancel={() => void cancel()} onSave={() => void save()} />}
      </div>
      <div className="panel-foot"><span><CheckCircleIcon size={17} aria-hidden /> Your links. Your downloads.</span><span>{config ? `${Math.floor(config.max_duration_seconds / 60)} min · ${config.max_file_mb} MB max` : 'Personal downloader'}</span></div>
    </section>
    <div className="supported"><span>BRING YOUR LINKS FROM</span><div>{['YouTube', 'Instagram', 'TikTok', 'Facebook', 'X'].map(name => <span key={name}>{name}</span>)}</div></div>
  </>
}

export default function App() {
  const [connection, setConnection] = useState(initialConnection)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [storageError, setStorageError] = useState('')

  function saveConnection(next: Connection) {
    setConnection(next)
    try {
      localStorage.setItem('grabit.server', next.url)
      sessionStorage.setItem('grabit.key', next.key)
      setStorageError('')
    } catch { setStorageError('Connected for now. This browser could not remember your settings.') }
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">Skip to downloader</a>
      <header className="site-header">
        <a className="brand" href="/" aria-label="Grabit home"><span className="brand-mark"><ArrowDownIcon size={24} weight="bold" aria-hidden /></span>grabit<span className="brand-period">.</span></a>
        <div className="header-actions"><a href="https://github.com/BehrozKarim/grabit" target="_blank" rel="noreferrer" className="source-link">View source <ArrowSquareOutIcon size={16} /></a>
          <button className="settings-button" type="button" onClick={() => setSettingsOpen(true)}><GearSixIcon size={20} /><span>Settings</span></button>
        </div>
      </header>
      <main id="main">
        <section className="intro" aria-labelledby="page-title"><div className="intro-kicker"><span className="small-rule" /> A LITTLE TOOL FOR YOUR INTERNET FINDS</div>
          <h1 id="page-title">Save the <span>good stuff.</span></h1><p>A video worth keeping. A sound on repeat.<br />Grab it in the format that fits.</p>
        </section>
        {storageError && <p className="storage-notice" role="status">{storageError}</p>}
        <Downloader key={connection.url + connection.key} connection={connection} onSettings={() => setSettingsOpen(true)} />
        <section className="how-it-works" aria-labelledby="how-title"><div className="how-heading"><h2 id="how-title">From your feed to your files.</h2><p>Three small steps. Something good to keep.</p></div>
          <ol><li><span className="step-number">01</span><div><h3>Copy the link</h3><p>Find a public video and copy its share link.</p></div></li>
            <li><span className="step-number">02</span><div><h3>Make it yours</h3><p>Pick a resolution, or keep just the audio.</p></div></li>
            <li><span className="step-number">03</span><div><h3>Take it with you</h3><p>Save the file to your phone or computer.</p></div></li></ol>
        </section>
      </main>
      <footer className="site-footer"><span>Made for your own little collection.</span><span>Download content you own or have permission to save.</span></footer>
      {settingsOpen && <Settings connection={connection} onSave={saveConnection} onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
