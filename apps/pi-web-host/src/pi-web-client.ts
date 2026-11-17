import {
  PI_WEB_ATTACH_CAPABILITY, PI_WEB_MAX_BYTES, piWebCatalogSchema, piWebHistorySchema, piWebChatOperationSchema, piWebConnectedSchema, piWebFrameSchema, piWebOperationSchema, piWebSnapshotSchema,
  type PiWebFrame, type PiWebSessionRef, type PiWebSnapshot,
} from '@dsh-remote/protocol'
import { PiWebHostError } from './errors.js'
import { loopbackFetch, PI_WEB_ORIGIN, readJson, type PiWebFetch } from './http.js'
import { SseReader } from './sse.js'

function matching(ref: PiWebSessionRef, value: PiWebSessionRef): void {
  if (value.sessionId !== ref.sessionId || value.agentInstanceId !== ref.agentInstanceId) throw new PiWebHostError('STALE_INSTANCE')
}

export class PiWebStream {
  private epoch?: string
  private sequence = 0
  private ended = false
  constructor(private readonly reader: SseReader, private readonly controller: AbortController, private readonly ref: PiWebSessionRef) {}

  async next(): Promise<PiWebFrame | undefined> {
    if (this.ended) return undefined
    const value = await this.reader.next()
    if (value === undefined) { await this.close(); return undefined }
    const parsed = piWebFrameSchema.safeParse(value)
    if (!parsed.success) throw new PiWebHostError('INVALID_UPSTREAM')
    const frame = parsed.data
    matching(this.ref, frame)
    if ((this.epoch !== undefined && this.epoch !== frame.epoch) || frame.seq !== this.sequence + 1) throw new PiWebHostError('RESYNC_REQUIRED')
    this.epoch = frame.epoch
    this.sequence = frame.seq
    if (frame.type === 'attachment_ended' || frame.type === 'attachment_error') await this.close()
    return frame
  }

  async close(): Promise<void> {
    this.ended = true
    this.controller.abort()
    await this.reader.close()
  }
}

export class PiWebClient {
  constructor(private readonly fetchImplementation: PiWebFetch = loopbackFetch, private readonly authorization?: string) {}

  private async request(sessionId: string, init: RequestInit, suffix = ''): Promise<Response> {
    try {
      return await this.fetchImplementation(`${PI_WEB_ORIGIN}/api/remote/${encodeURIComponent(sessionId)}${suffix}`, {
        ...init,
        headers: { Accept: suffix.startsWith('/events') ? 'text/event-stream' : 'application/json',
          ...(init.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
          ...(this.authorization ? { Authorization: this.authorization } : {}),
        },
        redirect: 'error',
      })
    } catch { throw new PiWebHostError(init.method === 'POST' ? 'OPERATION_UNKNOWN' : 'UPSTREAM_UNAVAILABLE', init.method === 'POST') }
  }

  async snapshot(sessionId: string, signal: AbortSignal): Promise<PiWebSnapshot> {
    const response = await this.request(sessionId, { signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) })
    if (!response.ok) { await response.body?.cancel(); throw new PiWebHostError(response.status === 409 ? 'NOT_ATTACHABLE' : 'UPSTREAM_UNAVAILABLE') }
    const parsed = piWebSnapshotSchema.safeParse(await readJson(response))
    if (!parsed.success || parsed.data.sessionId !== sessionId || !parsed.data.capabilities.includes(PI_WEB_ATTACH_CAPABILITY)) throw new PiWebHostError('INVALID_UPSTREAM')
    return parsed.data
  }

  async catalog(signal: AbortSignal) {
    const response = await this.request('catalog', { signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) })
    if (!response.ok) { await response.body?.cancel(); throw new PiWebHostError('UPSTREAM_UNAVAILABLE') }
    const result = piWebCatalogSchema.safeParse(await readJson(response))
    if (!result.success) throw new PiWebHostError('INVALID_UPSTREAM')
    return result.data
  }

  async history(params: { sessionId: string; agentInstanceId?: string; before?: string }, signal: AbortSignal) {
    const query = new URLSearchParams()
    if (params.agentInstanceId) query.set('agentInstanceId', params.agentInstanceId)
    if (params.before) query.set('before', params.before)
    const response = await this.request(params.sessionId, { signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) }, `/history?${query}`)
    if (!response.ok) { await response.body?.cancel(); throw new PiWebHostError(response.status === 409 ? 'RESYNC_REQUIRED' : 'UPSTREAM_UNAVAILABLE') }
    const raw = await readJson(response) as { sessionId?: unknown; agentInstanceId?: unknown }
    const result = piWebHistorySchema.safeParse(raw)
    if (!result.success || raw.sessionId !== params.sessionId || (params.agentInstanceId && raw.agentInstanceId !== params.agentInstanceId)) throw new PiWebHostError('INVALID_UPSTREAM')
    return { ...result.data, sessionId: raw.sessionId, agentInstanceId: raw.agentInstanceId }
  }

  async command(method: string, params: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    const types: Record<string, string> = {
      'pi-web.session.prompt': 'chat.prompt', 'pi-web.session.abort': 'chat.abort', 'pi-web.session.operation.get': 'chat.operation.get',
      'pi-web.ui.respond': 'ui.respond', 'pi-web.questionnaire.operation.get': 'operation.get',
      'pi-web.questionnaire.cancel': 'questionnaire.cancel', 'pi-web.questionnaire.submit': 'questionnaire.submit',
    }
    const type = types[method]
    if (!Object.hasOwn(types, method)) throw new PiWebHostError('INVALID_PARAMS')
    const body = JSON.stringify({ ...params, type })
    if (Buffer.byteLength(body) > PI_WEB_MAX_BYTES) throw new PiWebHostError('REQUEST_TOO_LARGE')
    const response = await this.request(params.sessionId as string, { method: 'POST', body, signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) })
    if (!response.ok) {
      await response.body?.cancel()
      throw new PiWebHostError(response.status === 409 ? 'STALE_INSTANCE' : response.status === 400 || response.status === 413 ? 'INVALID_PARAMS' : 'OPERATION_UNKNOWN', response.status !== 409 && response.status !== 400 && response.status !== 413)
    }
    let result: unknown
    try { result = await readJson(response) }
    catch { throw new PiWebHostError('OPERATION_UNKNOWN', true) }
    if (type === 'ui.respond') {
      const receipt = result as { id?: unknown; verdict?: unknown } | null
      if (receipt?.id !== params.id || !['accepted', 'already-closed'].includes(String(receipt?.verdict))) throw new PiWebHostError('OPERATION_UNKNOWN', true)
      return { ...receipt, sessionId: params.sessionId, agentInstanceId: params.agentInstanceId }
    }
    if (type.startsWith('chat.')) {
      const parsed = piWebChatOperationSchema.safeParse(result)
      if (!parsed.success || parsed.data.sessionId !== params.sessionId || parsed.data.agentInstanceId !== params.agentInstanceId || parsed.data.operationId !== params.operationId) throw new PiWebHostError('OPERATION_UNKNOWN', true)
      return parsed.data
    }
    const parsed = piWebOperationSchema.safeParse(result)
    if (!parsed.success) throw new PiWebHostError('OPERATION_UNKNOWN', true)
    const receipt = parsed.data
    if (receipt.sessionId !== params.sessionId || receipt.agentInstanceId !== params.agentInstanceId) throw new PiWebHostError('OPERATION_UNKNOWN', true)
    if (receipt.toolCallId !== params.toolCallId || receipt.revision !== params.revision || receipt.operationId !== params.operationId) throw new PiWebHostError('OPERATION_UNKNOWN', true)
    return receipt
  }

  async subscribe(ref: PiWebSessionRef, lifetime: AbortSignal): Promise<{ stream: PiWebStream; snapshot: PiWebSnapshot; epoch: string; seq: number; pendingExtensionUiIds: string[] }> {
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, lifetime])
    const deadline = setTimeout(() => controller.abort(), 10_000)
    let stream: PiWebStream | undefined
    try {
      const response = await this.request(ref.sessionId, { signal }, `/events?agentInstanceId=${encodeURIComponent(ref.agentInstanceId)}`)
      if (!response.ok || !response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) {
        await response.body?.cancel()
        throw new PiWebHostError('NOT_ATTACHABLE')
      }
      stream = new PiWebStream(new SseReader(response.body, signal), controller, ref)
      const first = await stream.next()
      if (first?.type !== 'connected') throw new PiWebHostError('NOT_ATTACHABLE')
      const parsed = piWebConnectedSchema.safeParse(first)
      if (!parsed.success || !parsed.data.remoteSnapshot.capabilities.includes(PI_WEB_ATTACH_CAPABILITY)) throw new PiWebHostError('INVALID_UPSTREAM')
      matching(ref, parsed.data.remoteSnapshot)
      return { stream, snapshot: parsed.data.remoteSnapshot, epoch: parsed.data.epoch, seq: parsed.data.seq, pendingExtensionUiIds: parsed.data.pendingExtensionUiIds }
    } catch (error) {
      controller.abort()
      await stream?.close()
      throw error instanceof PiWebHostError ? error : new PiWebHostError('UPSTREAM_UNAVAILABLE')
    } finally { clearTimeout(deadline) }
  }
}
