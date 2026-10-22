import type { DeviceDownload, ServerConfig } from '../types'

interface Props {
  device: DeviceDownload
  config: ServerConfig | null
  fallbackBlocked: string | null
  busy: boolean
  onCancel: () => void
  onFallback: () => void
}

export function DeviceStatus({ device, config, fallbackBlocked, busy, onCancel, onFallback }: Props) {
  return <section className="device-status" aria-label="Device download">
    <p className="eyebrow">{device.status === 'fallback' ? 'DEVICE DOWNLOAD UNAVAILABLE' : 'ON YOUR DEVICE'}</p>
    <p role="status">{device.message}</p>
    {device.status === 'working' && <>
      <progress max={100} value={device.progress ?? undefined} aria-label="Device preparation progress" />
      <button className="text-button" type="button" onClick={onCancel}>Cancel device preparation</button>
      <p className="field-hint">Sources download to temporary device storage. FFmpeg still uses RAM while merging or converting. Keep this page open.</p>
    </>}
    {device.status === 'ready' && device.url && <>
      <a className="button primary" href={device.url} download={device.filename}
        target={device.direct ? '_blank' : undefined} rel="noreferrer">{device.direct ? 'Open direct file' : 'Save file'}</a>
      {device.direct && <p className="field-hint">Your browser may open the video or audio player. Use its Save or Download option. Source links expire; fetch the link again if needed. No Grabit file-size cap applies.</p>}
    </>}
    {device.status === 'fallback' && <>
      <p className="field-hint">Server fallback downloads and prepares the file on {config ? 'your connected backend' : 'the backend'}. It uses that server’s storage and bandwidth.</p>
      {config && <p className="field-hint">{config.max_file_mb ? `${config.max_file_mb} MiB maximum file. ` : 'No server file-size cap. '}
        {config.max_duration_seconds ? `${Math.floor(config.max_duration_seconds / 60)} minute maximum video.` : 'No server duration cap.'}</p>}
      {fallbackBlocked ? <p className="field-hint">{fallbackBlocked}</p> :
        <button className="button secondary" type="button" disabled={busy || !config} onClick={onFallback}>Use server fallback</button>}
    </>}
  </section>
}
