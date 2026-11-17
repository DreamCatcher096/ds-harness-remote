import { describe, expect, it, afterEach, vi } from 'vitest'
import { createRpcRequest, decodeMessage, encodeMessage, PI_WEB_ATTACH_CAPABILITY, type RpcMethod } from '@dsh-remote/protocol'
import { PiWebClient } from '../src/pi-web-client.js'
import { PiWebRouter } from '../src/router.js'
import { loopbackFetch, PI_WEB_ORIGIN, type PiWebFetch } from '../src/http.js'

const ref = { sessionId: 'session-1', agentInstanceId: 'instance-1' }
const snapshot = { ...ref, capabilities: [PI_WEB_ATTACH_CAPABILITY, 'pi-web.questionnaire.v1'], running: true, isStreaming: false, awaitingInput: true, questionnaires: [] }
const scope = { connectionId: 'conn-a', peerDeviceId: 'peer-a' }
const pending: PiWebRouter[] = []
afterEach(async () => { await Promise.all(pending.splice(0).map(router => router.closePeerStreams())); vi.useRealTimers() })

function harness(peerDeviceId = scope.peerDeviceId) {
  const streams: Array<{ push: (value: Record<string, unknown>) => void; finish: () => void; cancelled: boolean }> = []
  const fetch = vi.fn<PiWebFetch>(async (url, init) => {
    if (url.includes('/events?')) {
      let control!: ReadableStreamDefaultController<Uint8Array>
      let seq = 0
      const stream = {
        cancelled: false,
        push: (value: Record<string, unknown>) => control.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ ...ref, epoch: 'epoch-1', seq: ++seq, ...value })}\n\n`)),
        finish: () => control.close(),
      }
      const body = new ReadableStream<Uint8Array>({ start(controller) { control = controller }, cancel() { stream.cancelled = true } })
      streams.push(stream)
      stream.push({ type: 'connected', remoteSnapshot: snapshot, pendingExtensionUiIds: [] })
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
    }
    if (init.method === 'POST') {
      const command = JSON.parse(init.body as string) as Record<string, unknown>
      return Response.json(command.type === 'ui.respond' ? { id: command.id, verdict: 'accepted' } : { ...command, verdict: 'accepted', state: 'answered' })
    }
    return Response.json(snapshot)
  })
  const router = new PiWebRouter({ ...scope, peerDeviceId }, new PiWebClient(fetch))
  pending.push(router)
  const call = (method: RpcMethod, params: unknown) => router.handle(createRpcRequest(method, params))
  const subscribe = async () => {
    const result = await call('pi-web.session.subscribe', ref)
    return (result.payload as { result: { streamId: string } }).result.streamId
  }
  return { router, fetch, streams, call, subscribe }
}

const answer = { ...ref, toolCallId: 'call-1', revision: 'revision-1', operationId: 'operation-1', answers: [{ questionIndex: 0, optionIndexes: [1] }] }

describe('Pi Web Host 有限业务与同实例接线', () => {
  it('新增方法通过原编解码；describe 不伪装 Harness/ACP，不读取上游', async () => {
    const h = harness()
    const request = decodeMessage(encodeMessage(createRpcRequest('pi-web.describe', {})))
    const result = await h.router.handle(request)
    expect(result).toMatchObject({ type: 'rpc.response', payload: { result: { kind: 'pi-web', capabilities: [PI_WEB_ATTACH_CAPABILITY, 'pi-web.chat.v1'], upstream: 'unverified' } } })
    expect(h.fetch).not.toHaveBeenCalled()
    expect(await h.call('harness.transport.describe', {})).toMatchObject({ type: 'rpc.error', payload: { code: 'METHOD_NOT_FOUND' } })
    expect(await h.call('pi-web.session.snapshot', { sessionId: ref.sessionId, target: 'http://evil' })).toMatchObject({ payload: { code: 'INVALID_PARAMS' } })
  })

  it('snapshot 固定 URL；错误 session/capability 的 HTTP 200 不被采纳', async () => {
    const h = harness()
    expect(await h.call('pi-web.session.snapshot', { sessionId: ref.sessionId })).toMatchObject({ payload: { result: snapshot } })
    expect(h.fetch.mock.calls[0][0]).toBe(`${PI_WEB_ORIGIN}/api/remote/${ref.sessionId}`)
    h.fetch.mockResolvedValueOnce(Response.json({ ...snapshot, sessionId: 'other' }))
    expect(await h.call('pi-web.session.snapshot', { sessionId: ref.sessionId })).toMatchObject({ payload: { code: 'INVALID_UPSTREAM' } })
    h.fetch.mockResolvedValueOnce(Response.json({ ...snapshot, capabilities: ['agent.acp.v1'] }))
    expect(await h.call('pi-web.session.snapshot', { sessionId: ref.sessionId })).toMatchObject({ payload: { code: 'INVALID_UPSTREAM' } })
    await expect(loopbackFetch('http://example.com/api/remote/a', {})).rejects.toMatchObject({ code: 'INVALID_TARGET' })
  })

  it('operationId 按认证设备隔离、跨连接稳定；不信客户端自报 peer', async () => {
    const a = harness('a'), b = harness('b'), again = harness('a')
    for (const h of [a, b, again]) {
      expect(await h.call('pi-web.questionnaire.submit', answer)).toMatchObject({ payload: { result: { verdict: 'accepted', operationId: answer.operationId } } })
    }
    const sent = [a, b, again].map(h => JSON.parse(h.fetch.mock.calls[0][1].body as string).operationId)
    expect(sent[0]).not.toBe(sent[1]); expect(sent[0]).toBe(sent[2]); expect(sent[0]).not.toBe(answer.operationId)
    expect(await a.call('pi-web.questionnaire.submit', { ...answer, peerDeviceId: 'b' })).toMatchObject({ payload: { code: 'INVALID_PARAMS' } })
  })

  it('写入超时/错误 receipt 为 unknown，单次执行且错误不泄漏正文', async () => {
    const h = harness()
    h.fetch.mockRejectedValueOnce(new Error('sensitive tool output'))
    const result = await h.call('pi-web.questionnaire.submit', answer)
    expect(result).toMatchObject({ payload: { code: 'OPERATION_UNKNOWN', details: { outcome: 'unknown' }, retryable: false } })
    expect(JSON.stringify(result)).not.toContain('sensitive')
    expect(h.fetch).toHaveBeenCalledTimes(1)
    h.fetch.mockResolvedValueOnce(Response.json({ success: true }))
    expect(await h.call('pi-web.ui.respond', { ...ref, id: 'ui-1', value: 'A' })).toMatchObject({ payload: { code: 'OPERATION_UNKNOWN' } })
    h.fetch.mockResolvedValueOnce(Response.json({ ...answer, agentInstanceId: 'other', verdict: 'accepted' }))
    expect(await h.call('pi-web.questionnaire.submit', answer)).toMatchObject({ payload: { code: 'OPERATION_UNKNOWN' } })
  })

  it('订阅先返回 connected 快照，再按句柄拉取；句柄不能跨 peer', async () => {
    const a = harness('a'), b = harness('b')
    const id = await a.subscribe()
    a.streams[0].push({ type: 'questionnaire_state', questionnaire: { toolCallId: 'original-call', state: 'answered' } })
    expect(await a.call('pi-web.session.read', { streamId: id })).toMatchObject({ payload: { result: { events: [{ type: 'questionnaire_state', seq: 2 }], done: false } } })
    expect(await b.call('pi-web.session.read', { streamId: id })).toMatchObject({ payload: { code: 'STREAM_NOT_FOUND' } })
    await a.call('pi-web.session.unsubscribe', { streamId: id })
    expect(a.streams[0].cancelled).toBe(true)
    expect(a.fetch).toHaveBeenCalledTimes(1)
  })

  it('空等返回 done=false；迟到帧不因超时丢失，同时 read 被拒绝', async () => {
    vi.useFakeTimers()
    const h = harness(), id = await h.subscribe()
    const reading = h.call('pi-web.session.read', { streamId: id })
    expect(await h.call('pi-web.session.read', { streamId: id })).toMatchObject({ payload: { code: 'READ_IN_PROGRESS' } })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await reading).toMatchObject({ payload: { result: { events: [], done: false } } })
    h.streams[0].push({ type: 'heartbeat' })
    expect(await h.call('pi-web.session.read', { streamId: id })).toMatchObject({ payload: { result: { events: [{ type: 'heartbeat', seq: 2 }], done: false } } })
  })

  it('关闭/换代不继续投递旧流；只释放本连接，不调用 Agent Stop', async () => {
    const a = harness('a'), b = harness('b'), id = await a.subscribe()
    await b.subscribe()
    const reading = a.call('pi-web.session.read', { streamId: id })
    await a.router.closePeerStreams()
    expect(await reading).toMatchObject({ payload: { code: 'CONNECTION_CLOSED' } })
    expect(a.streams[0].cancelled).toBe(true)
    expect(b.streams[0].cancelled).toBe(false)
    expect(a.fetch.mock.calls.every(([, init]) => init.method !== 'POST')).toBe(true)
  })

  it('EOF、截断、epoch/seq 缺口、错误 instance 和超限均不伪造连续历史', async () => {
    for (const mutation of [{ seq: 9 }, { epoch: 'other' }, { agentInstanceId: 'other' }]) {
      const h = harness(), id = await h.subscribe()
      h.streams[0].push({ type: 'heartbeat', ...mutation })
      expect(await h.call('pi-web.session.read', { streamId: id })).toMatchObject({ type: 'rpc.error' })
      expect(h.streams[0].cancelled).toBe(true)
    }
    const h = harness(), id = await h.subscribe()
    h.streams[0].finish()
    expect(await h.call('pi-web.session.read', { streamId: id })).toMatchObject({ payload: { result: { events: [], done: true } } })
    const large = harness(), largeId = await large.subscribe()
    large.streams[0].push({ type: 'message_end', value: 'x'.repeat(1024 * 1024) })
    expect(await large.call('pi-web.session.read', { streamId: largeId })).toMatchObject({ payload: { code: 'RESPONSE_TOO_LARGE' } })
  })

  it('16 句柄上限与 60 秒空闲回收；回收后旧句柄不能复活', async () => {
    vi.useFakeTimers()
    const h = harness()
    const ids = []
    for (let i = 0; i < 16; i++) ids.push(await h.subscribe())
    expect(await h.call('pi-web.session.subscribe', ref)).toMatchObject({ payload: { code: 'RATE_LIMITED' } })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(h.streams.every(stream => stream.cancelled)).toBe(true)
    expect(await h.call('pi-web.session.read', { streamId: ids[0] })).toMatchObject({ payload: { code: 'STREAM_NOT_FOUND' } })
  })
})
