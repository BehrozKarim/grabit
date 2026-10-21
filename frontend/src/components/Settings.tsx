import { useEffect, useRef, useState } from 'react'
import { ArrowSquareOutIcon, CheckCircleIcon, SpinnerGapIcon, XIcon } from '@phosphor-icons/react'
import { GrabitApi, normalizeApiUrl } from '../lib/api'
import { readableError } from '../lib/format'
import type { Connection } from '../types'

interface Props {
  connection: Connection
  onSave: (connection: Connection) => void
  onClose: () => void
}

export function Settings({ connection, onSave, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [url, setUrl] = useState(connection.url)
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
      const next = { url: normalizeApiUrl(url), key: key.trim() }
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
      <p className="muted">Connect Grabit to your personal download server.</p>
      <form onSubmit={submit}>
        <label htmlFor="server-url">Backend address</label>
        <input id="server-url" type="url" placeholder="https://grabit-api.onrender.com" value={url} required
          onChange={e => { setUrl(e.target.value); setConnected(false) }} autoComplete="url" />
        <label htmlFor="access-key">Personal access key</label>
        <input id="access-key" type="password" placeholder="Your Render access key" value={key}
          onChange={e => { setKey(e.target.value); setConnected(false) }} autoComplete="current-password" aria-describedby="key-hint" />
        <p id="key-hint" className="field-hint">Your key stays in this browser tab’s session. Leave it empty for local development.</p>
        {error && <p className="inline-error" role="alert">{error}</p>}
        {connected && <p className="connection-success" role="status"><CheckCircleIcon size={20} /> Connected. You’re ready to grab a video.</p>}
        <button type="submit" className="button primary full" disabled={busy}>
          {busy ? <><SpinnerGapIcon className="spin" size={20} /> Connecting…</> : 'Test & save connection'}
        </button>
        {busy && <p className="field-hint" role="status">A sleeping Render server can take about a minute to wake up.</p>}
      </form>
      <a className="text-link" href="https://github.com/BehrozKarim/grabit#deployment" target="_blank" rel="noreferrer">
        Need help connecting? <ArrowSquareOutIcon size={15} />
      </a>
    </dialog>
  )
}
