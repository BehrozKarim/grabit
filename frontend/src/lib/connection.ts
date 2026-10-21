import type { Connection } from '../types'

export const hostedConnection: Connection = { mode: 'hosted', url: '', key: '' }

export function initialConnection(): Connection {
  try {
    const stored = JSON.parse(localStorage.getItem('grabit.connection') || 'null')
    if (stored?.mode === 'custom' && typeof stored.url === 'string') {
      return { mode: 'custom', url: stored.url, key: sessionStorage.getItem('grabit.custom-key') || '' }
    }
  } catch { /* Storage is optional; use the deployment's hosted backend by default. */ }
  return hostedConnection
}
