import { Readable } from 'node:stream'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { createHostedHandler } from './server/hosted-backend'
import type { Plugin } from 'vite'

function localHostedApi(environment: Record<string, string>): Plugin {
  return {
    name: 'grabit-local-hosted-api',
    configureServer(server) {
      const handler = createHostedHandler({
        GRABIT_BACKEND_URL: environment.GRABIT_BACKEND_URL || 'http://127.0.0.1:8000',
        GRABIT_BACKEND_API_KEY: environment.GRABIT_BACKEND_API_KEY,
      }, true)
      server.middlewares.use('/api/backend', async (incoming, outgoing) => {
        try {
          const headers = new Headers()
          for (const [key, value] of Object.entries(incoming.headers)) {
            if (Array.isArray(value)) value.forEach(item => headers.append(key, item))
            else if (value) headers.set(key, value)
          }
          const init: RequestInit & { duplex?: 'half' } = { method: incoming.method, headers }
          if (incoming.method !== 'GET' && incoming.method !== 'HEAD') {
            init.body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>
            init.duplex = 'half'
          }
          const request = new Request(`http://${incoming.headers.host}${incoming.url}`, init)
          const response = await handler(request)
          outgoing.writeHead(response.status, Object.fromEntries(response.headers))
          outgoing.end(await response.text())
        } catch {
          outgoing.writeHead(502, { 'Content-Type': 'application/json' })
          outgoing.end(JSON.stringify({ detail: 'The local server connection failed.' }))
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), localHostedApi({ ...process.env, ...loadEnv(mode, process.cwd(), '') } as Record<string, string>)],
  server: { port: 5173, strictPort: true },
}))
