import { render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'

afterEach(() => { localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks() })

it('starts with the hosted backend and displays its actual limits', async () => {
  const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ max_file_mb: 150, max_duration_seconds: 1200 }))
  render(<App />)
  expect(await screen.findByText('20 min max · 150 MiB max')).toBeInTheDocument()
  expect(upstream.mock.calls[0][0]).toBe('/api/backend?path=%2Fapi%2Fconfig')
  expect(screen.queryByLabelText('Backend address')).not.toBeInTheDocument()
})

it('shows an uncapped personal backend without imposing hosted limits in the browser', async () => {
  localStorage.setItem('grabit.connection', JSON.stringify({ mode: 'custom', url: 'http://127.0.0.1:8000' }))
  const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ max_file_mb: 0, max_duration_seconds: 0 }))
  render(<App />)
  expect(await screen.findByText('No size or duration cap')).toBeInTheDocument()
  expect(upstream.mock.calls[0][0]).toBe('http://127.0.0.1:8000/api/config')
  expect(screen.queryByText(/150 MiB/)).not.toBeInTheDocument()
})
