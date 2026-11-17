import { describe, expect, it } from 'vitest'
import { SseReader } from '../src/sse.js'

const encode = (value: string) => new TextEncoder().encode(value)
function reader(chunks: Uint8Array[]) {
  let cancelled = false
  const control = new AbortController()
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { const chunk = chunks.shift(); if (chunk) controller.enqueue(chunk); else controller.close() }, cancel() { cancelled = true } })
  return { parser: new SseReader(stream, control.signal), control, cancelled: () => cancelled }
}

describe('SSE 解析与有界读取', () => {
  it('跨字节 Unicode、CRLF/CR/LF、多行 data 和注释', async () => {
    const bytes = encode(': comment\r\ndata: {"text":\r\ndata: "你好"}\r\n\r\ndata: {"n":2}\n\n')
    const h = reader([...bytes].map(byte => new Uint8Array([byte])))
    expect(await h.parser.next()).toEqual({ text: '你好' })
    expect(await h.parser.next()).toEqual({ n: 2 })
    expect(await h.parser.next()).toBeUndefined()
  })

  it('帧截断与非法 UTF-8 不当作正常 EOF', async () => {
    const h = reader([encode('data: {"unfinished":')])
    await expect(h.parser.next()).rejects.toMatchObject({ code: 'SSE_TRUNCATED' }); await h.parser.close()
    const invalid = reader([new Uint8Array([0xff])])
    await expect(invalid.parser.next()).rejects.toBeDefined(); await invalid.parser.close()
  })

  it('关闭立即撤销正在等待的读取，不需要上游再来一帧', async () => {
    const control = new AbortController()
    let cancelled = false
    const parser = new SseReader(new ReadableStream({ cancel() { cancelled = true } }), control.signal)
    const reading = parser.next()
    const rejected = expect(reading).rejects.toBeDefined()
    control.abort(); await rejected
    expect(cancelled).toBe(true)
  })

  it('有效大帧不因长度重复计算提前拒绝；64 MiB 累计预算包含注释', async () => {
    const h = reader([encode(`data: ${JSON.stringify({ data: 'x'.repeat(700_000) })}\n\n`)])
    expect(await h.parser.next()).toMatchObject({ data: expect.any(String) }); await h.parser.close()
    let sent = 0
    const chunk = encode(':' + 'x'.repeat(64 * 1024 - 2) + '\n')
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { sent += 1; controller.enqueue(chunk) } })
    const parser = new SseReader(stream, new AbortController().signal)
    await expect(parser.next()).rejects.toMatchObject({ code: 'RESYNC_REQUIRED' })
    expect(sent).toBeLessThanOrEqual(1027)
    await parser.close()
  })
})
