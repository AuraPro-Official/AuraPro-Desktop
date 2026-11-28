import type { WriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'

export const writeDownloadBody = async (
  body: ReadableStream<Uint8Array>,
  destination: WriteStream,
  onChunk: (size: number) => void,
  signal?: AbortSignal
): Promise<void> => {
  // `finish` does not guarantee that Windows can open the file from another process.
  const closed = new Promise<void>((resolve) => destination.once('close', resolve))
  try {
    await pipeline(
      Readable.fromWeb(body as unknown as NodeReadableStream<Uint8Array>),
      async function* (source: AsyncIterable<Buffer>) {
        for await (const chunk of source) {
          onChunk(chunk.length)
          yield chunk
        }
      },
      destination,
      { signal }
    )
  } finally {
    if (!destination.destroyed) destination.destroy()
    await closed
  }
}
