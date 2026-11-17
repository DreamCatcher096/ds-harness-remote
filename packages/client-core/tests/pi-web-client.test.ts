import { afterEach, describe, expect, it, vi } from 'vitest'
import { PiWebRemoteClient, type PiWebRpc } from '../src/pi-web-client.js'

const ref = { sessionId: 'session-1', agentInstanceId: 'instance-1' }
const message = { role: 'user', content: [{ type: 'text', text: '重复文本' }], isError: false, truncated: false }
const q = { toolCallId: 'tool-1', revision: 'revision-1', state: 'open' as const, questions: [
  { questionIndex: 0, question: '选择', header: '选择', multiSelect: false, options: [{ optionIndex: 0, label: '相同', description: 'a' }, { optionIndex: 1, label: '相同', description: 'b' }] },
] }
const snapshot = { ...ref, capabilities: ['pi-web.attach.v1', 'pi-web.chat.v1', 'pi-web.questionnaire.v1'], running: false, isStreaming: false, awaitingInput: false, questionnaires: [q],
  chat: { messages: [{ messageId: 'real-1', message }, { messageId: 'real-2', message }], hasMore: false }, streaming: null, tools: [], pendingUi: [] }
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const clients: PiWebRemoteClient[] = []
afterEach(() => { for (const client of clients.splice(0)) client.close() })
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
function fixture() {
  let close = () => {}
  let next = deferred<unknown>()
  let stream = 0
  const rpc = vi.fn(async (method: string, params: unknown): Promise<unknown> => {
    const p = params as Record<string, unknown>
    if (method === 'pi-web.describe') return { kind: 'pi-web', capabilities: ['pi-web.chat.v1'] }
    if (method === 'pi-web.sessions.list') return { capabilities: ['pi-web.chat.v1'], sessions: [] }
    if (method === 'pi-web.session.snapshot') return snapshot
    if (method === 'pi-web.session.subscribe') return { streamId: `stream-${++stream}`, epoch: `epoch-${stream}`, seq: 1, snapshot }
    if (method === 'pi-web.session.read') return next.promise
    if (method === 'pi-web.session.unsubscribe') return { closed: true }
    return { ...p, verdict: 'accepted' }
  })
  const wire = { rpc, onClose: (fn: () => void) => { close = fn; return () => {} } } as PiWebRpc
  let id = 0
  const client = new PiWebRemoteClient(wire, () => `operation-${++id}`)
  clients.push(client)
  return { client, wire, rpc, close: () => close(), push: (events: unknown[], done = false) => { const old = next; next = deferred(); old.resolve({ events, done }) } }
}
const frame = (seq: number, rest: Record<string, unknown> = {}) => ({ ...ref, epoch: 'epoch-1', seq, type: 'heartbeat', ...rest })

describe('Pi Web 客户端状态机', () => {
  it('关闭是终态，迟到回调、browse／release／reconnect 不能复活旧客户端', async () => {
    const h = fixture(); h.client.close(); h.client.release(); h.client.suspend()
    expect(h.client.getState().phase).toBe('closed')
    await expect(h.client.browse(ref.sessionId)).rejects.toThrow('CLIENT_CLOSED')
    await expect(h.client.attach(ref.sessionId)).rejects.toThrow('CLIENT_CLOSED')
    expect(() => h.client.reconnect(h.wire)).toThrow('CLIENT_CLOSED')
    expect(h.rpc).not.toHaveBeenCalled()
  })
  it('能力发现拒绝假兼容；冷读历史不会订阅／恢复／发 prompt', async () => {
    const h = fixture(); await h.client.discover(); await h.client.catalog()
    h.rpc.mockImplementationOnce(async () => ({ sessionId: ref.sessionId, ...snapshot.chat }))
    await h.client.browse(ref.sessionId)
    expect(h.client.getState().phase).toBe('read-only')
    expect(h.rpc.mock.calls.map(c => c[0])).not.toContain('pi-web.session.subscribe')
    h.rpc.mockResolvedValueOnce({ kind: 'pi', capabilities: ['agent.acp.pi.v1'] })
    await expect(h.client.discover()).rejects.toThrow('PI_WEB_CHAT_UNSUPPORTED')
  })
  it('connected 是权威边界；真实 ID 的相同文本保留两条，释放不 Stop', async () => {
    const h = fixture(); await h.client.attach(ref.sessionId)
    expect(h.client.getState().history?.messages.map(m => m.messageId)).toEqual(['real-1', 'real-2'])
    expect(h.client.getState().phase).toBe('ready')
    h.client.release(); await tick()
    expect(h.rpc.mock.calls.map(c => c[0])).toContain('pi-web.session.unsubscribe')
    expect(h.rpc.mock.calls.map(c => c[0])).not.toContain('pi-web.session.abort')
  })
  it.each([{ seq: 7 }, { epoch: 'other' }, { agentInstanceId: 'other' }])('缺口／换代 %j 只读重同步，不重发写入', async mutation => {
    const h = fixture(); await h.client.attach(ref.sessionId)
    await h.client.prompt('fixture')
    h.push([frame(2, mutation)]); await tick(); await tick()
    expect(h.rpc.mock.calls.filter(c => c[0] === 'pi-web.session.subscribe')).toHaveLength(2)
    expect(h.rpc.mock.calls.filter(c => c[0] === 'pi-web.session.prompt')).toHaveLength(1)
    expect(h.client.getState().phase).toBe('ready')
  })
  it('同 session 不同实例明确 replaced，不自动附着新执行器', async () => {
    const h = fixture(); await h.client.attach(ref.sessionId)
    h.rpc.mockResolvedValueOnce({ closed: true })
    h.rpc.mockResolvedValueOnce({ ...snapshot, agentInstanceId: 'new-instance' })
    await h.client.resync()
    expect(h.client.getState().phase).toBe('replaced')
    expect(h.rpc.mock.calls.filter(c => c[0] === 'pi-web.session.subscribe')).toHaveLength(1)
  })
  it('迟到 subscribe 句柄只向创建它的旧连接释放，绝不发送给新连接', async () => {
    const a = fixture(), b = fixture(), pending = deferred<unknown>()
    const normal = a.rpc.getMockImplementation()!
    a.rpc.mockImplementation((method, params) => method === 'pi-web.session.subscribe' ? pending.promise : normal(method, params))
    const opening = a.client.attach(ref.sessionId)
    await tick()
    a.client.reconnect(b.wire)
    pending.resolve({ streamId: 'old-stream', epoch: 'old-epoch', seq: 1, snapshot })
    await opening
    expect(a.rpc.mock.calls.filter(call => call[0] === 'pi-web.session.unsubscribe')).toHaveLength(1)
    expect(b.rpc.mock.calls).toHaveLength(0)
    expect(a.client.getState().phase).toBe('disconnected')
  })
  it('断线与旧连接迟到 accepted 被隔离，重连只拉快照，查询原回执不重发', async () => {
    const a = fixture(); await a.client.attach(ref.sessionId)
    const pending = deferred<unknown>()
    a.rpc.mockImplementationOnce(() => pending.promise)
    const sending = a.client.prompt('fixture')
    a.close()
    expect(a.client.getState().writes[0]?.verdict).toBe('unknown')
    const b = fixture(); a.client.reconnect(b.wire)
    await a.client.resync()
    pending.resolve({ ...ref, operationId: 'operation-1', verdict: 'accepted' })
    expect((await sending).verdict).toBe('unknown')
    expect(a.client.getState().writes[0]?.verdict).toBe('unknown')
    await a.client.query('operation-1')
    expect(a.client.getState().writes[0]?.verdict).toBe('accepted')
    expect(b.rpc.mock.calls.filter(c => c[0] === 'pi-web.session.prompt')).toHaveLength(0)
    expect(b.rpc.mock.calls.filter(c => c[0] === 'pi-web.session.operation.get')).toHaveLength(1)
  })
  it('切换会话后旧 read／写回执不能污染当前页', async () => {
    const h = fixture(); await h.client.attach(ref.sessionId)
    const pending = deferred<unknown>(); h.rpc.mockImplementationOnce(() => pending.promise)
    const answer = h.client.submit(q, [{ questionIndex: 0, optionIndexes: [1] }])
    h.client.release()
    pending.resolve({ ...ref, toolCallId: q.toolCallId, revision: q.revision, operationId: 'operation-1', verdict: 'accepted' })
    expect((await answer).verdict).toBe('unknown')
    expect(h.client.getState().snapshot).toBeUndefined()
  })
  it('HTTP/RPC 成功但错误原调用／operation ID 不可 accepted；unknown 禁重复整份提交', async () => {
    const h = fixture(); await h.client.attach(ref.sessionId)
    h.rpc.mockResolvedValueOnce({ ...ref, toolCallId: 'other', revision: q.revision, operationId: 'operation-1', verdict: 'accepted' })
    expect((await h.client.submit(q, [{ questionIndex: 0, optionIndexes: [1] }])).verdict).toBe('unknown')
    expect(() => h.client.cancel(q)).toThrow('OPERATION_UNRESOLVED')
    expect(h.rpc.mock.calls.filter(c => c[0] === 'pi-web.questionnaire.cancel')).toHaveLength(0)
  })
  it('单题 closed 不关闭整份问卷；整份权威 closed 才失效', async () => {
    const h = fixture(); await h.client.attach(ref.sessionId)
    h.push([frame(2, { type: 'extension_ui_closed', id: 'dialog' })]); await tick()
    expect(h.client.getState().snapshot?.questionnaires[0]?.state).toBe('open')
    h.push([frame(3, { type: 'questionnaire_state', questionnaire: { ...q, state: 'answered' } })]); await tick()
    expect(() => h.client.submit(q, [])).toThrow('QUESTIONNAIRE_CLOSED')
  })
  it('chat.state 快照替换临时流式区与真实工具结果，缺失合法快照不猜恢复', async () => {
    const h = fixture(); await h.client.attach(ref.sessionId)
    h.push([frame(2, { type: 'chat.state', snapshot: { ...snapshot, streaming: { ...message, role: 'assistant', content: [{ type: 'thinking', thinking: '增量' }] } } })]); await tick()
    expect(h.client.getState().snapshot?.streaming?.content[0]?.thinking).toBe('增量')
    h.push([frame(3, { type: 'chat.state', snapshot: { ...snapshot, streaming: null } })]); await tick()
    expect(h.client.getState().snapshot?.streaming).toBeNull()
  })
  it('权威 pending 集合消失即失效，不猜 answered；未知回执仍可查询', async () => {
    const h = fixture(); await h.client.attach(ref.sessionId)
    h.push([frame(2, { type: 'chat.state', snapshot: { ...snapshot, questionnaires: [] } })]); await tick()
    expect(h.client.getState().closedQuestionnaires?.[0]?.toolCallId).toBe(q.toolCallId)
    expect(h.client.getState().closedQuestionnaires?.[0]?.state).toBe('open') // 没收到终态，不伪造 answered。
    expect(() => h.client.submit(q, [])).toThrow('QUESTIONNAIRE_CLOSED')
  })
  it('可证明的执行前拒绝与断线 unknown 区分，不把 rejected 写成 accepted', async () => {
    const h = fixture(); await h.client.attach(ref.sessionId)
    h.rpc.mockRejectedValueOnce(Object.assign(new Error('stale'), { code: 'STALE_INSTANCE' }))
    expect((await h.client.prompt('fixture')).verdict).toBe('rejected')
    h.rpc.mockRejectedValueOnce(new Error('lost'))
    expect((await h.client.prompt('fixture')).verdict).toBe('unknown')
  })
  it('query 错误回执不洗掉 unknown，取消有自己的回执', async () => {
    const h = fixture(); await h.client.attach(ref.sessionId)
    h.rpc.mockRejectedValueOnce(new Error('lost'))
    expect((await h.client.cancel(q)).verdict).toBe('unknown')
    h.rpc.mockResolvedValueOnce({ ...ref, toolCallId: q.toolCallId, revision: 'old', operationId: 'operation-1', verdict: 'accepted' })
    await h.client.query('operation-1')
    expect(h.client.getState().writes[0]?.verdict).toBe('unknown')
  })
})
