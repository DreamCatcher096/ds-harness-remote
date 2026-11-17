import { PI_WEB_MAX_BYTES, PI_WEB_STREAM_TOTAL_BYTES } from '@dsh-remote/protocol'
import { PiWebHostError } from './errors.js'

/** 标准 data 多行及 LF/CRLF/CR；逐帧背压，字节/累计预算独立于客户端读取次数。 */
export class SseReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>
  private readonly decoder = new TextDecoder('utf-8', { fatal: true })
  private buffer = ''
  private data = ''
  private dropLf = false
  private total = 0
  private closed = false
  private readonly onAbort = () => { void this.close() }

  constructor(body: ReadableStream<Uint8Array>, private readonly signal: AbortSignal) {
    this.reader = body.getReader()
    signal.addEventListener('abort', this.onAbort, { once: true })
    if (signal.aborted) this.onAbort()
  }

  async next(): Promise<unknown | undefined> {
    while (!this.closed) {
      this.signal.throwIfAborted()
      if (this.dropLf && this.buffer.length) {
        if (this.buffer.startsWith('\n')) this.buffer = this.buffer.slice(1)
        this.dropLf = false
      }
      const end = this.buffer.search(/[\r\n]/)
      if (end < 0) {
        if (Buffer.byteLength(this.buffer + this.data) > PI_WEB_MAX_BYTES) throw new PiWebHostError('RESPONSE_TOO_LARGE')
        const chunk = await this.reader.read()
        this.signal.throwIfAborted()
        if (chunk.done) {
          this.decoder.decode()
          if (this.buffer.length || this.data.length) throw new PiWebHostError('SSE_TRUNCATED')
          await this.close()
          return undefined
        }
        this.total += chunk.value.byteLength
        if (this.total > PI_WEB_STREAM_TOTAL_BYTES) throw new PiWebHostError('RESYNC_REQUIRED')
        this.buffer += this.decoder.decode(chunk.value, { stream: true })
        continue
      }
      const line = this.buffer.slice(0, end)
      this.dropLf = this.buffer[end] === '\r'
      this.buffer = this.buffer.slice(end + 1)
      if (line === '') {
        if (this.data === '') continue
        const json = this.data.slice(0, -1)
        this.data = ''
        try { return JSON.parse(json) }
        catch { throw new PiWebHostError('INVALID_UPSTREAM') }
      }
      if (Buffer.byteLength(line) > PI_WEB_MAX_BYTES) throw new PiWebHostError('RESPONSE_TOO_LARGE')
      if (line.startsWith('data:')) this.data += line.slice(5).replace(/^ /, '') + '\n'
      if (Buffer.byteLength(this.data) > PI_WEB_MAX_BYTES) throw new PiWebHostError('RESPONSE_TOO_LARGE')
    }
    return undefined
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.signal.removeEventListener('abort', this.onAbort)
    await this.reader.cancel().catch(() => undefined)
  }
}
