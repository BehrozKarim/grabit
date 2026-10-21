import { FFmpeg } from '@ffmpeg/ffmpeg'
import coreURL from '@ffmpeg/core?url'
import wasmURL from '@ffmpeg/core/wasm?url'

// Single-thread core runs without SharedArrayBuffer or cross-origin isolation.
// Vite emits versioned same-origin assets; no runtime CDN dependency.
export function createProcessor() {
  const ffmpeg = new FFmpeg()
  return Object.assign(ffmpeg, { loadEngine: () => ffmpeg.load({ coreURL, wasmURL }) })
}
