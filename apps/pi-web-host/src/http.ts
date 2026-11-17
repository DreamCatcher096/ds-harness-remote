import { request } from 'node:http'
import { Readable } from 'node:stream'
import { PI_WEB_MAX_BYTES } from '@dsh-remote/protocol'
import { PiWebHostError } from './errors.js'

export const PI_WEB_ORIGIN = 'http://127.0.0.1:30141'
export type PiWebFetch = (url: string, init: RequestInit) => Promise<Response>

/** 固定回环直连；不读取代理环境，不接收 Remote 客户端的 headers/URL。 */
export const loopbackFetch: PiWebFetch = (input, init) => new Promise((resolve, reject) => {
  const url = new URL(input)
  if (url.origin !== PI_WEB_ORIGIN || !url.pathname.startsWith('/api/remote/') || url.username || url.password) {
    reject(new PiWebHostError('INVALID_TARGET'))
    return
  }
  const requestHeaders: Record<string, string> = {}
  new Headers(init.headers).forEach((value, name) => { requestHeaders[name] = value })
  const req = request({ hostname: '127.0.0.1', port: 30141, method: init.method ?? 'GET', path: url.pathname + url.search,
    headers: requestHeaders, signal: init.signal ?? undefined,
  }, response => {
    clearTimeout(headerTimer)
    const headers = new Headers()
    for (const [key, value] of Object.entries(response.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value)
    }
    const status = response.statusCode ?? 502
    if ([204, 205, 304].includes(status)) { response.resume(); resolve(new Response(null, { status, headers })); return }
    const body = Readable.toWeb(response, { strategy: { highWaterMark: 64 * 1024, size: chunk => chunk.byteLength } })
    resolve(new Response(body as ReadableStream<Uint8Array>, { status, headers }))
  })
  const headerTimer = setTimeout(() => req.destroy(new PiWebHostError('UPSTREAM_TIMEOUT')), 20_000)
  req.on('error', error => { clearTimeout(headerTimer); reject(error) })
  req.end(typeof init.body === 'string' ? init.body : undefined)
})

export async function readJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader()
  if (!reader) throw new PiWebHostError('INVALID_UPSTREAM')
  let bytes = 0
  const chunks: Uint8Array[] = []
  try {
    for (;;) {
      const result = await reader.read()
      if (result.done) break
      bytes += result.value.byteLength
      if (bytes > PI_WEB_MAX_BYTES) throw new PiWebHostError('RESPONSE_TOO_LARGE')
      chunks.push(result.value)
    }
    const body = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) }
    catch { throw new PiWebHostError('INVALID_UPSTREAM') }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
