import { useEffect, useRef, useState } from 'react'
import { ArrowSquareOutIcon, CheckCircleIcon, SpinnerGapIcon, XIcon } from '@phosphor-icons/react'
import { GrabitApi, normalizeApiUrl } from '../lib/api'
import { readableError } from '../lib/format'
import { hostedConnection } from '../lib/connection'
import type { Connection } from '../types'

interface Props {
  connection: Connection
  onSave: (connection: Connection) => void
  onClose: () => void
}

export function Settings({ connection, onSave, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [url, setUrl] = useState(connection.url)
  const [mode, setMode] = useState(connection.mode)
  const [key, setKey] = useState(connection.key)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setConnected(false)
    try {
      const next: Connection = mode === 'hosted' ? hostedConnection : { mode, url: normalizeApiUrl(url), key: key.trim() }
      await new GrabitApi(next).config()
      onSave(next)
      setConnected(true)
    } catch (error) { setError(readableError(error)) }
    finally { setBusy(false) }
  }

  return (
    <dialog ref={dialog} className="settings-dialog" onCancel={onClose} aria-labelledby="settings-title">
      <div className="dialog-heading">
        <div><p className="eyebrow">YOUR CONNECTION</p><h2 id="settings-title">Make yourself at home.</h2></div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close settings"><XIcon size={22} /></button>
      </div>
      <p className="muted">Use Grabit’s hosted server, or connect your own.</p>
      <form onSubmit={submit}>
        <fieldset className="connection-picker">
          <legend>Download server</legend>
          <label className="connection-choice"><input type="radio" name="backend-mode" value="hosted" checked={mode === 'hosted'} disabled={busy}
            onChange={() => { setMode('hosted'); setConnected(false); setError('') }} />
            <span><strong>Grabit hosted</strong><span>Ready to use. No connection details needed.</span></span>
          </label>
          <label className="connection-choice"><input type="radio" name="backend-mode" value="custom" checked={mode === 'custom'} disabled={busy}
            onChange={() => { setMode('custom'); setConnected(false); setError(''); if (!url) setUrl('http://127.0.0.1:8000') }} />
            <span><strong>Your own backend</strong><span>Use a local or self-hosted Grabit server.</span></span>
          </label>
        </fieldset>
        {mode === 'custom' && <>
        <label htmlFor="server-url">Backend address</label>
        <input id="server-url" type="url" placeholder="http://127.0.0.1:8000" value={url} required disabled={busy}
          onChange={e => { setUrl(e.target.value); setConnected(false) }} autoComplete="url" />
        <label htmlFor="access-key">Access key (if required)</label>
        <input id="access-key" type="password" placeholder="Your server’s access key" value={key} disabled={busy}
          onChange={e => { setKey(e.target.value); setConnected(false) }} autoComplete="current-password" aria-describedby="key-hint" />
        <p id="key-hint" className="field-hint">Leave empty for a local backend without authentication. Keys stay in this tab’s session.</p>
        <p className="field-hint">Limits come from your backend. A default local setup has no file-size or video-length cap.</p>
        </>}
        {error && <p className="inline-error" role="alert">{error}</p>}
        {connected && <p className="connection-success" role="status"><CheckCircleIcon size={20} /> Connected. You’re ready to grab a video.</p>}
        <button type="submit" className="button primary full" disabled={busy}>
          {busy ? <><SpinnerGapIcon className="spin" size={20} /> Connecting…</> : mode === 'hosted' ? 'Use Grabit hosted' : 'Test & save connection'}
        </button>
        {busy && <p className="field-hint" role="status">Checking your connection. A sleeping server can take about a minute to wake up.</p>}
      </form>
      <a className="text-link" href="https://github.com/BehrozKarim/grabit#deployment" target="_blank" rel="noreferrer">
        Need help connecting? <ArrowSquareOutIcon size={15} />
      </a>
    </dialog>
  )
}
