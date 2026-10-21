import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { Settings } from './Settings'
import { hostedConnection } from '../lib/connection'

afterEach(() => vi.restoreAllMocks())

it('offers hosted mode without asking for a backend address or access key', async () => {
  const user = userEvent.setup()
  const onSave = vi.fn()
  const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ max_file_mb: 150 }))
  render(<Settings connection={hostedConnection} onSave={onSave} onClose={vi.fn()} />)
  expect(screen.getByRole('radio', { name: /Grabit hosted/ })).toBeChecked()
  expect(screen.queryByLabelText('Backend address')).not.toBeInTheDocument()
  expect(screen.queryByLabelText(/Access key/)).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Use Grabit hosted' }))
  expect(upstream.mock.calls[0][0]).toBe('/api/backend?path=%2Fapi%2Fconfig')
  expect(onSave).toHaveBeenCalledWith(hostedConnection)
})

it('connects directly to a personal backend and can switch back to hosted mode', async () => {
  const user = userEvent.setup()
  const onSave = vi.fn()
  const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ max_file_mb: 0, max_duration_seconds: 0 }))
  render(<Settings connection={hostedConnection} onSave={onSave} onClose={vi.fn()} />)
  await user.click(screen.getByRole('radio', { name: /Your own backend/ }))
  expect(screen.getByLabelText('Backend address')).toHaveValue('http://127.0.0.1:8000')
  await user.click(screen.getByRole('button', { name: 'Test & save connection' }))
  expect(upstream.mock.calls[0][0]).toBe('http://127.0.0.1:8000/api/config')
  expect(onSave).toHaveBeenLastCalledWith({ mode: 'custom', url: 'http://127.0.0.1:8000', key: '' })
  await user.click(screen.getByRole('radio', { name: /Grabit hosted/ }))
  expect(screen.queryByLabelText('Backend address')).not.toBeInTheDocument()
})
