import { describe, expect, it, vi } from 'vitest'
import { createRpcRequest, piWebParams, type RpcMethod } from '@dsh-remote/protocol'
import { PiWebClient } from '../src/pi-web-client.js'
import { PiWebRouter } from '../src/router.js'
import type { PiWebFetch } from '../src/http.js'
const ref = { sessionId: 's', agentInstanceId: 'i' }
const context = { connectionId: 'connection', peerDeviceId: 'peer' }
describe('Pi Web Host 聊天契约', () => {
  it('严格参数不接任意路径、假 peer、模型或未知命令', () => {
    expect(piWebParams['pi-web.session.history'].safeParse({ sessionId: '../secret' }).success).toBe(false)
    for (const extra of [{ peerDeviceId: 'other' }, { model: 'other' }, { url: 'http://evil' }]) expect(piWebParams['pi-web.session.prompt'].safeParse({ ...ref, operationId: 'op', message: 'fixture', ...extra }).success).toBe(false)
  })
  it('目录／冷历史为 GET，固定目标且拒绝错误 session、实例与游标结果', async () => {
    const fetch = vi.fn<PiWebFetch>().mockResolvedValueOnce(Response.json({ capabilities: ['pi-web.chat.v1'], sessions: [] }))
      .mockResolvedValueOnce(Response.json({ sessionId: 's', messages: [], hasMore: false }))
      .mockResolvedValueOnce(Response.json({ sessionId: 'other', messages: [], hasMore: false }))
      .mockResolvedValueOnce(Response.json({ ...ref, agentInstanceId: 'other', messages: [], hasMore: false }))
    const client = new PiWebClient(fetch), signal = new AbortController().signal
    await client.catalog(signal); await client.history({ sessionId: 's' }, signal)
    expect(fetch.mock.calls.map(c => c[0])).toEqual(['http://127.0.0.1:30141/api/remote/catalog', 'http://127.0.0.1:30141/api/remote/s/history?'])
    expect(fetch.mock.calls.every(c => c[1].method === undefined)).toBe(true)
    await expect(client.history({ sessionId: 's' }, signal)).rejects.toMatchObject({ code: 'INVALID_UPSTREAM' })
    await expect(client.history(ref, signal)).rejects.toMatchObject({ code: 'INVALID_UPSTREAM' })
  })
  it('聊天命令带真实实例，设备隔离 operationId；只有合法原回执 accepted', async () => {
    const fetch = vi.fn<PiWebFetch>(async (_url, init) => {
      const command = JSON.parse(init.body as string) as { operationId: string }
      return Response.json({ ...ref, operationId: command.operationId, verdict: 'accepted' })
    })
    const a = new PiWebRouter(context, new PiWebClient(fetch))
    const b = new PiWebRouter({ ...context, peerDeviceId: 'other' }, new PiWebClient(fetch))
    const params = { ...ref, operationId: 'op', message: 'fixture' }
    const call = (router: PiWebRouter, method: RpcMethod) => router.handle(createRpcRequest(method, method === 'pi-web.session.prompt' ? params : { ...ref, operationId: 'op' }))
    expect(await call(a, 'pi-web.session.prompt')).toMatchObject({ payload: { result: { ...ref, operationId: 'op', verdict: 'accepted' } } })
    await call(b, 'pi-web.session.abort')
    const sent = fetch.mock.calls.map(([, init]) => JSON.parse(init.body as string))
    expect(sent[0].type).toBe('chat.prompt'); expect(sent[1].type).toBe('chat.abort')
    expect(sent[0].operationId).not.toBe(sent[1].operationId)
    fetch.mockResolvedValueOnce(Response.json({ ...ref, operationId: 'wrong', verdict: 'accepted' }))
    expect(await call(a, 'pi-web.session.abort')).toMatchObject({ payload: { code: 'OPERATION_UNKNOWN', details: { outcome: 'unknown' } } })
    fetch.mockRejectedValueOnce(new Error('transport-lost'))
    expect(await call(a, 'pi-web.session.prompt')).toMatchObject({ payload: { code: 'OPERATION_UNKNOWN', retryable: false } })
    expect(fetch).toHaveBeenCalledTimes(4)
    await a.closePeerStreams(); await b.closePeerStreams()
  })
})
