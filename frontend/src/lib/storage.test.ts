import { afterEach, expect, it, vi } from 'vitest'
import { createWorkspace } from './storage'

afterEach(() => vi.unstubAllGlobals())

function filesystem() {
  const writes: Uint8Array<ArrayBuffer>[] = []
  const close = vi.fn(async () => {})
  const abort = vi.fn(async () => {})
  const removeEntry = vi.fn(async () => {})
  let filename = ''
  const writer = { write: vi.fn(async (chunk: Uint8Array) => { writes.push(new Uint8Array(chunk)) }), close, abort }
  const directory = {
    getFileHandle: vi.fn(async (name: string) => {
      filename = name
      return { createWritable: async () => writer, getFile: async () => new File(writes, filename) }
    }), removeEntry,
  }
  const root = { getDirectoryHandle: async () => directory, removeEntry,
    async *[Symbol.asyncIterator]() { /* Empty initial workspace. */ } }
  vi.stubGlobal('navigator', { storage: { getDirectory: async () => ({ getDirectoryHandle: async () => root }) } })
  return { writes, writer, directory, removeEntry }
}

it('writes each source chunk to storage before reading the next, without collecting the full file', async () => {
  const fs = filesystem()
  const workspace = await createWorkspace()
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new Uint8Array([1, 2])); controller.enqueue(new Uint8Array([3])); controller.close()
  } })
  const progress = vi.fn()
  const file = await workspace.stage('input.mp4', stream, 100, new AbortController().signal, progress)
  expect(file.size).toBe(3)
  expect(fs.writer.write).toHaveBeenCalledTimes(2)
  expect(progress.mock.calls.map(([bytes]) => bytes)).toEqual([2, 3])
  expect(fs.writer.close).toHaveBeenCalled()
  await workspace.dispose()
  expect(fs.removeEntry).toHaveBeenCalledWith(expect.stringMatching(/^\d{13}-/), { recursive: true })
})

it('aborts the output file when an unknown-size stream exceeds its processing budget', async () => {
  const fs = filesystem()
  const workspace = await createWorkspace()
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new Uint8Array(12)); controller.close()
  } })
  await expect(workspace.stage('input.mp4', stream, 10, new AbortController().signal, vi.fn())).rejects.toThrow('processing budget')
  expect(fs.writer.write).not.toHaveBeenCalled()
  expect(fs.writer.abort).toHaveBeenCalled()
})

it('offers server preparation when temporary device storage is unavailable', async () => {
  vi.stubGlobal('navigator', {})
  await expect(createWorkspace()).rejects.toThrow('Use server preparation')
})
