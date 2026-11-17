import { PiWebRemoteClient, type PiWebRpc, type PiWebAnswer } from '@dsh-remote/client-core'
import { piWebParams, type PiWebMethod, type PiWebSnapshot, type PiWebFrame } from '@dsh-remote/protocol'
import { createNativeRpcId } from '../services/rpc-id'

type Question = PiWebSnapshot['questionnaires'][number]
type Message = NonNullable<PiWebSnapshot['chat']>['messages'][number]
interface Session { sessionId: string; agentInstanceId: string; messages: Message[]; running: boolean; streaming: PiWebSnapshot['streaming']; q?: Question }
interface Stream { session: Session; epoch: string; seq: number; queue: PiWebFrame[]; wake?: (value: unknown) => void }
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const error = (code: string) => Object.assign(new Error(code), { code })
const textMessage = (role: 'user' | 'assistant' | 'toolResult', text: string, toolCallId?: string) => ({ role, content: [{ type: 'text' as const, text }], isError: false, truncated: false, ...(toolCallId ? { toolCallId, toolName: 'fixture-tool' } : {}) })

/** 只为离线设备测试提供内存权威；不打开 socket、不导入 SDK／账号、不模拟真实网络验收。 */
export class PiWebFixtureRpc {
  readonly client: PiWebRemoteClient
  readonly counts = { prompts: 0, stops: 0, submits: 0, cancels: 0, other: 0 }
  answerSummary = ''
  dropNextReceipt = false
  private selected = 'fixture-live'
  private serial = 0
  private readonly streams = new Map<string, Stream>()
  private readonly connections = new Set<{ closed: boolean; listeners: Set<() => void> }>()
  private readonly receipts = new Map<string, { payload: string; receipt: Record<string, unknown> }>()
  private readonly sessions = new Map<string, Session>(['fixture-live', 'fixture-other'].map(sessionId => [sessionId, {
    sessionId, agentInstanceId: `${sessionId}-instance-1`, running: false, streaming: null,
    messages: [
      { messageId: `${sessionId}-entry-1`, message: textMessage('user', '固定夹具：相同文本也保留真实夹具 ID。') },
      { messageId: `${sessionId}-entry-2`, message: textMessage('user', '固定夹具：相同文本也保留真实夹具 ID。') },
      { messageId: `${sessionId}-entry-3`, message: { ...textMessage('assistant', '原生聊天与普通工具结果测试。'), content: [{ type: 'thinking', thinking: '固定思考内容，不调用模型。' }, { type: 'text', text: '原生聊天与普通工具结果测试。' }] } },
      { messageId: `${sessionId}-entry-4`, message: textMessage('toolResult', '固定普通工具结果：读取成功。', 'fixture-read-call') },
    ],
  }]))

  constructor() { this.client = new PiWebRemoteClient(this.connection(), createNativeRpcId) }
  snapshot(s: Session): PiWebSnapshot {
    return copy({ sessionId: s.sessionId, agentInstanceId: s.agentInstanceId,
      capabilities: ['pi-web.attach.v1', 'pi-web.chat.v1', 'pi-web.questionnaire.v1'], running: s.running, isStreaming: !!s.streaming,
      awaitingInput: !!s.q, questionnaires: s.q ? [s.q] : [], chat: { messages: s.messages.slice(-100), hasMore: false }, streaming: s.streaming, tools: [], pendingUi: [] })
  }
  private connection(): PiWebRpc {
    const connection = { closed: false, listeners: new Set<() => void>() }
    this.connections.add(connection)
    return {
      rpc: async <T>(method: string, params: unknown, signal?: AbortSignal): Promise<T> => {
        if (connection.closed || signal?.aborted) throw error('TRANSPORT_CLOSED')
        // SAFETY: 与真实客户端共用协议 schema；所有返回值还由 PiWebRemoteClient 再次校验。
        return await this.call(method as PiWebMethod, params, signal) as T
      },
      onClose: handler => { connection.listeners.add(handler); return () => connection.listeners.delete(handler) },
    }
  }
  disconnect(): void {
    for (const c of this.connections) { c.closed = true; for (const listener of c.listeners) listener() }
    for (const stream of this.streams.values()) stream.wake?.({ events: [], done: true })
    this.streams.clear()
  }
  reconnect(): void { this.client.reconnect(this.connection()) }
  close(): void { this.disconnect(); this.client.close() }
  private publish(s: Session, event: Record<string, unknown> = { type: 'chat.state', snapshot: this.snapshot(s) }): void {
    for (const stream of this.streams.values()) {
      if (stream.session !== s) continue
      const frame = { ...event, sessionId: s.sessionId, agentInstanceId: s.agentInstanceId, epoch: stream.epoch, seq: ++stream.seq } as PiWebFrame
      if (stream.wake) { const wake = stream.wake; stream.wake = undefined; wake({ events: [copy(frame)], done: false }) }
      else stream.queue.push(copy(frame))
    }
  }
  openQuestionnaire(): void {
    const s = this.sessions.get(this.selected)!
    if (s.q) return
    const n = ++this.serial
    s.running = true; s.streaming = null
    s.q = { toolCallId: `fixture-question-${n}`, revision: `fixture-revision-${n}`, state: 'open', questions: [
      { questionIndex: 0, header: '单选', question: '请选择一个颜色。', multiSelect: false, options: [{ optionIndex: 0, label: '蓝色', description: '选项一' }, { optionIndex: 1, label: '绿色', description: '选项二', preview: '<b>仅安全文本，不执行 HTML</b>' }] },
      { questionIndex: 1, header: '多选', question: '请选择多个渠道，可补充文字。', multiSelect: true, options: [{ optionIndex: 0, label: '邮件', description: '渠道一' }, { optionIndex: 1, label: '消息', description: '渠道二' }] },
      { questionIndex: 2, header: '自由输入', question: '请填写自由文字。', multiSelect: false, options: [{ optionIndex: 0, label: '同意', description: '也可以选择选项' }, { optionIndex: 1, label: '拒绝', description: '也可以自由输入' }] },
    ] }
    this.publish(s)
  }
  finishElsewhere(): void {
    const s = this.sessions.get(this.selected)!
    if (s.q) { this.counts.other++; this.finish(s, 'answered') }
  }
  private finish(s: Session, state: 'answered' | 'cancelled' | 'aborted'): void {
    const q = s.q!
    this.publish(s, { type: 'questionnaire_state', questionnaire: { ...q, state } })
    s.q = undefined; s.running = false
    s.messages.push({ messageId: `fixture-result-${++this.serial}`, message: textMessage('toolResult', state === 'answered' ? '夹具整份问卷已完成。' : state === 'cancelled' ? '夹具整份问卷已取消。' : '夹具原调用已中止。', q.toolCallId) })
    this.publish(s)
  }
  replaceInstance(): void {
    const s = this.sessions.get(this.selected)!
    s.agentInstanceId = `fixture-instance-replacement-${++this.serial}`
    s.running = false; s.streaming = null; s.q = undefined
    this.publish(s)
  }
  gap(): void {
    const s = this.sessions.get(this.selected)!
    for (const stream of this.streams.values()) if (stream.session === s) stream.seq++
    this.publish(s)
  }
  private async call(method: PiWebMethod, input: unknown, signal?: AbortSignal): Promise<unknown> {
    const schema = piWebParams[method]
    if (!schema) throw error('METHOD_NOT_FOUND')
    const parsed = schema.safeParse(input)
    if (!parsed.success) throw error('INVALID_PARAMS')
    const p = parsed.data as Record<string, unknown>
    if (method === 'pi-web.describe') return { kind: 'pi-web', capabilities: ['pi-web.chat.v1'] }
    if (method === 'pi-web.sessions.list') return { capabilities: ['pi-web.chat.v1'], sessions: [
      ...[...this.sessions.values()].map(s => ({ ...s, title: s.sessionId === 'fixture-live' ? '活动夹具' : '另一个会话', cwd: '/offline-fixture', attachable: true })),
      { sessionId: 'fixture-cold', title: '冷会话只读', cwd: '/offline-fixture', attachable: false, running: false },
    ] }
    if (method === 'pi-web.session.unsubscribe') { const stream = this.streams.get(String(p.streamId)); stream?.wake?.({ events: [], done: true }); this.streams.delete(String(p.streamId)); return { closed: true } }
    if (method === 'pi-web.session.read') {
      const stream = this.streams.get(String(p.streamId))
      if (!stream) throw error('STREAM_NOT_FOUND')
      if (stream.queue.length) return { events: [stream.queue.shift()], done: false }
      return new Promise((resolve, reject) => {
        const abort = () => { stream.wake = undefined; reject(error('RPC_ABORTED')) }
        stream.wake = value => { signal?.removeEventListener('abort', abort); resolve(value) }
        signal?.addEventListener('abort', abort, { once: true })
      })
    }
    const s = this.sessions.get(String(p.sessionId))
    if (method === 'pi-web.session.history') return { sessionId: p.sessionId, ...(s ? { agentInstanceId: s.agentInstanceId } : {}), messages: s?.messages.slice(-100) ?? [{ messageId: 'fixture-cold-entry', message: textMessage('user', '冷会话只读夹具；没有创建或恢复任何 Agent。') }], hasMore: false }
    if (!s) throw error('NOT_ATTACHABLE')
    this.selected = s.sessionId
    if (method === 'pi-web.session.snapshot') return this.snapshot(s)
    if (p.agentInstanceId !== s.agentInstanceId) throw error('STALE_INSTANCE')
    if (method === 'pi-web.session.subscribe') {
      const streamId = `fixture-stream-${++this.serial}`, epoch = `fixture-epoch-${this.serial}`
      this.streams.set(streamId, { session: s, epoch, seq: 1, queue: [] })
      return { streamId, epoch, seq: 1, snapshot: this.snapshot(s), pendingExtensionUiIds: [] }
    }
    const operationId = String(p.operationId)
    const ref = { sessionId: s.sessionId, agentInstanceId: s.agentInstanceId, operationId,
      ...(p.toolCallId ? { toolCallId: p.toolCallId, revision: p.revision } : {}) }
    if (method.endsWith('operation.get')) return this.receipts.get(operationId)?.receipt ?? { ...ref, verdict: 'unknown' }
    const payload = JSON.stringify([method, p])
    const old = this.receipts.get(operationId)
    if (old) return old.payload === payload ? old.receipt : { ...ref, verdict: p.toolCallId ? 'operation-conflict' : 'rejected', code: 'operation-conflict' }
    await new Promise(resolve => setTimeout(resolve, 900)) // 真实 UI 可观察 submitting；不是模型／网络延迟测试。
    if (p.agentInstanceId !== s.agentInstanceId) throw error('STALE_INSTANCE')
    let receipt: Record<string, unknown> = { ...ref, verdict: 'accepted' }
    if (method === 'pi-web.session.prompt') {
      if (s.running) receipt = { ...ref, verdict: 'rejected', code: 'busy' }
      else {
        this.counts.prompts++; s.running = true
        s.messages.push({ messageId: `fixture-prompt-${++this.serial}`, message: textMessage('user', String(p.message)) })
        s.streaming = { ...textMessage('assistant', ''), content: [{ type: 'thinking', thinking: '夹具思考增量一……' }] }
        this.publish(s)
        const instance = s.agentInstanceId
        setTimeout(() => { if (s.running && s.agentInstanceId === instance) { s.streaming = textMessage('assistant', '夹具回答增量；可按停止按钮。'); this.publish(s) } }, 1800)
      }
    } else if (method === 'pi-web.session.abort') { this.counts.stops++; s.running = false; s.streaming = null; if (s.q) this.finish(s, 'aborted'); else this.publish(s) }
    else if (method === 'pi-web.questionnaire.submit' || method === 'pi-web.questionnaire.cancel') {
      if (!s.q || s.q.toolCallId !== p.toolCallId || s.q.revision !== p.revision) receipt = { ...ref, verdict: 'already-closed' }
      else {
        if (method.endsWith('submit')) {
          this.counts.submits++
          const answers = p.answers as PiWebAnswer[]
          this.answerSummary = answers.map(a => `题${a.questionIndex + 1}=[${(a.optionIndexes ?? []).join(',')}]${a.text ? '+文字' : ''}`).join(' ')
        } else this.counts.cancels++
        this.finish(s, method.endsWith('submit') ? 'answered' : 'cancelled')
      }
    } else throw error('METHOD_NOT_FOUND')
    this.receipts.set(operationId, { payload, receipt })
    if (this.dropNextReceipt) { this.dropNextReceipt = false; throw error('RPC_TIMEOUT') }
    return receipt
  }
}
