/** App-private temporary files. Streams are written chunk by chunk, never collected in an array. */
export interface DeviceWorkspace {
  stage(name: string, stream: ReadableStream<Uint8Array>, maximum: number, signal: AbortSignal,
    progress: (bytes: number) => void): Promise<File>
  output(name: string, data: Uint8Array): Promise<File>
  remove(name: string): Promise<void>
  dispose(): Promise<void>
}

export async function createWorkspace(): Promise<DeviceWorkspace> {
  if (!navigator.storage?.getDirectory) {
    throw new Error('This browser cannot use temporary device storage for processing. Use server preparation instead.')
  }
  let root: FileSystemDirectoryHandle
  let directory: FileSystemDirectoryHandle
  const name = `${Date.now()}-${crypto.randomUUID()}`
  try {
    root = await (await navigator.storage.getDirectory()).getDirectoryHandle('grabit-temp', { create: true })
    // Only remove old, app-generated workspaces left by a tab closing unexpectedly.
    for await (const [entry] of root as FileSystemDirectoryHandle & AsyncIterable<[string, FileSystemHandle]>) {
      if (/^\d{13}-[a-f0-9-]{36}$/.test(entry) && Date.now() - Number(entry.slice(0, 13)) > 24 * 60 * 60 * 1000) {
        await root.removeEntry(entry, { recursive: true }).catch(() => {})
      }
    }
    directory = await root.getDirectoryHandle(name, { create: true })
  } catch (error) {
    throw new Error('Temporary device storage is unavailable or full. Use server preparation instead.', { cause: error })
  }
  return {
    async stage(filename, stream, maximum, signal, progress) {
      const file = await directory.getFileHandle(filename, { create: true })
      const writer = await file.createWritable()
      const reader = stream.getReader()
      let size = 0
      try {
        signal.throwIfAborted()
        while (true) {
          const { done, value } = await reader.read()
          signal.throwIfAborted()
          if (done) break
          size += value.byteLength
          if (size > maximum) throw new Error('This file exceeds the device processing budget. Try a lower resolution or server preparation.')
          // Awaiting each write applies backpressure instead of retaining the whole download in RAM.
          await writer.write(value as Uint8Array<ArrayBuffer>)
          progress(size)
        }
        if (!size) throw new Error('The platform returned an empty source file.')
        await writer.close()
        return await file.getFile()
      } catch (error) {
        await writer.abort().catch(() => {})
        throw error
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
    },
    async output(filename, data) {
      const file = await directory.getFileHandle(filename, { create: true })
      const writer = await file.createWritable()
      try {
        await writer.write(data as Uint8Array<ArrayBuffer>)
        await writer.close()
        return await file.getFile()
      } catch (error) { await writer.abort().catch(() => {}); throw error }
    },
    remove: filename => directory.removeEntry(filename),
    dispose: () => root.removeEntry(name, { recursive: true }).catch(() => {}),
  }
}
