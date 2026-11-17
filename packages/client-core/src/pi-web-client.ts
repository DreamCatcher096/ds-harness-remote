import {
  PI_WEB_CHAT_CAPABILITY, piWebCatalogSchema, piWebChatOperationSchema, piWebFrameSchema,
  piWebHistorySchema, piWebOperationSchema, piWebSnapshotSchema,
  type PiWebCatalog, type PiWebSessionRef, type PiWebSnapshot, type PiWebMethod,
  type PiWebChatOperation, type PiWebQuestionnaireOperation, type PiWebHistory,
} from '@dsh-remote/protocol'

export interface PiWebRpc {
  rpc<T = unknown>(method: string, params: unknown, signal?: AbortSignal): Promise<T>
  onClose(handler: () => void): () => void
}
export type PiWebQuestionnaire = PiWebSnapshot['questionnaires'][number]
export type PiWebAnswer = { questionIndex: number; optionIndexes?: number[]; text?: string; notes?: string }
export type PiWebReceipt = PiWebQuestionnaireOperation | PiWebChatOperation
export interface PiWebWrite {
  operationId: string
  kind: 'prompt' | 'abort' | 'submit' | 'cancel'
  ref: PiWebSessionRef & { toolCallId?: string; revision?: string }
  verdict: 'submitting' | PiWebReceipt['verdict']
  code?: string
}
export interface PiWebClientState {
  phase: 'idle' | 'attaching' | 'ready' | 'read-only' | 'disconnected' | 'resync-required' | 'replaced' | 'closed'
  sessionId?: string
  snapshot?: PiWebSnapshot
  history?: PiWebHistory
  /** 不再 pending 的本地表单，仅用于失效提示；缺失不推断 answered/cancelled。 */
  closedQuestionnaires?: PiWebQuestionnaire[]
  writes: readonly PiWebWrite[]
}

/** 可重建内存投影；绑定一次认证连接，不持久化或重放业务写入。 */
export class PiWebRemoteClient {
  private state: PiWebClientState = { phase: 'idle', writes: [] }
  private generation = 0
  private closed = false
  private streamId?: string
  private lifetime = new AbortController()
  private readonly listeners = new Set<(state: PiWebClientState) => void>()
  private offClose: () => void
  private readonly writes = new Map<string, PiWebWrite>()

  constructor(private rpc: PiWebRpc, private readonly createId: () => string = () => globalThis.crypto.randomUUID()) {
    this.offClose = rpc.onClose(() => this.retire('disconnected'))
  }

  private requireOpen(): void { if (this.closed) throw new Error('CLIENT_CLOSED') }
  reconnect(rpc: PiWebRpc): void {
    this.requireOpen()
    this.retire('disconnected')
    this.offClose()
    this.rpc = rpc
    this.offClose = rpc.onClose(() => this.retire('disconnected'))
  }
  suspend(): void { if (!this.closed) this.retire('disconnected') }
  getState(): PiWebClientState { return this.state }
  onState(listener: (state: PiWebClientState) => void): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => this.listeners.delete(listener)
  }
  private publish(patch: Partial<PiWebClientState>): void {
    this.state = { ...this.state, ...patch, writes: [...this.writes.values()] }
    for (const listener of this.listeners) listener(this.state)
  }
  private snapshotPatch(snapshot: PiWebSnapshot): Partial<PiWebClientState> {
    const previous = this.state.snapshot
    const same = previous?.sessionId === snapshot.sessionId && previous.agentInstanceId === snapshot.agentInstanceId
    const key = (q: PiWebQuestionnaire) => JSON.stringify([q.toolCallId, q.revision])
    const live = new Set(snapshot.questionnaires.map(key))
    const closed = new Map((same ? this.state.closedQuestionnaires ?? [] : []).map(q => [key(q), q]))
    if (same) for (const q of previous.questionnaires) if (!live.has(key(q))) closed.set(key(q), q)
    for (const id of live) closed.delete(id)
    return { snapshot, history: snapshot.chat, closedQuestionnaires: [...closed.values()].slice(-128) }
  }
  private retire(phase: PiWebClientState['phase']): void {
    ++this.generation
    this.lifetime.abort()
    this.lifetime = new AbortController()
    const streamId = this.streamId
    this.streamId = undefined
    if (streamId) void this.rpc.rpc('pi-web.session.unsubscribe', { streamId }).catch(() => undefined)
    for (const [id, write] of this.writes) if (write.verdict === 'submitting') this.writes.set(id, { ...write, verdict: 'unknown' })
    this.publish({ phase })
  }
  async discover(): Promise<void> {
    this.requireOpen()
    const description = await this.rpc.rpc<{ kind?: string; capabilities?: string[] }>('pi-web.describe', {})
    if (description.kind !== 'pi-web' || !description.capabilities?.includes(PI_WEB_CHAT_CAPABILITY)) throw new Error('PI_WEB_CHAT_UNSUPPORTED')
  }
  async catalog(): Promise<PiWebCatalog> {
    this.requireOpen()
    const result = piWebCatalogSchema.parse(await this.rpc.rpc('pi-web.sessions.list', {}))
    if (!result.capabilities.includes(PI_WEB_CHAT_CAPABILITY)) throw new Error('PI_WEB_CHAT_UNSUPPORTED')
    return result
  }
  async readHistory(sessionId: string, before?: string) {
    this.requireOpen()
    const generation = this.generation
    const ref = this.state.snapshot?.sessionId === sessionId ? this.state.snapshot : undefined
    const raw = await this.rpc.rpc<{ sessionId: string; agentInstanceId?: string }>('pi-web.session.history', {
      sessionId, ...(ref ? { agentInstanceId: ref.agentInstanceId } : {}), ...(before ? { before } : {}),
    }, this.lifetime.signal)
    if (generation !== this.generation || raw.sessionId !== sessionId || (ref && (raw.agentInstanceId !== ref.agentInstanceId || this.state.snapshot?.chat !== ref.chat))) throw new Error('STALE_READ')
    return piWebHistorySchema.parse(raw)
  }
  async browse(sessionId: string): Promise<void> {
    this.requireOpen()
    this.retire('read-only')
    this.publish({ sessionId, snapshot: undefined, history: undefined, closedQuestionnaires: [] })
    const generation = this.generation
    const history = await this.readHistory(sessionId)
    if (generation === this.generation) this.publish({ history })
  }
  async attach(sessionId: string, expectedInstance?: string, recover = true): Promise<void> {
    this.requireOpen()
    // 读流恢复不能默默跨实例；显式选择新目录行才能接受换代。
    const expected = expectedInstance ?? (this.state.sessionId === sessionId ? this.state.snapshot?.agentInstanceId : undefined)
    this.retire('attaching')
    this.publish({ sessionId, history: undefined, ...(this.state.sessionId !== sessionId ? { snapshot: undefined, closedQuestionnaires: [] } : {}) })
    const generation = this.generation
    const current = () => generation === this.generation
    const rpc = this.rpc
    try {
      const initial = piWebSnapshotSchema.parse(await rpc.rpc('pi-web.session.snapshot', { sessionId }, this.lifetime.signal))
      if (!current()) return
      if (initial.sessionId !== sessionId || !initial.capabilities.includes(PI_WEB_CHAT_CAPABILITY) || !initial.chat) throw new Error('INVALID_SNAPSHOT')
      if (expected && initial.agentInstanceId !== expected) { this.publish({ phase: 'replaced' }); return }
      const ref = { sessionId, agentInstanceId: initial.agentInstanceId }
      const subscribed = await rpc.rpc<{ streamId: string; snapshot: unknown; epoch: string; seq: number }>('pi-web.session.subscribe', ref, this.lifetime.signal)
      if (!current()) {
        void rpc.rpc('pi-web.session.unsubscribe', { streamId: subscribed.streamId }).catch(() => undefined)
        return
      }
      this.streamId = subscribed.streamId
      const snapshot = this.parseSnapshot(subscribed.snapshot, ref)
      if (typeof subscribed.streamId !== 'string' || !subscribed.streamId || typeof subscribed.epoch !== 'string' || !subscribed.epoch || subscribed.seq !== 1) throw new Error('INVALID_BOUNDARY')
      this.publish({ phase: 'ready', ...this.snapshotPatch(snapshot) })
      void this.consume(generation, subscribed.streamId, ref, subscribed.epoch, subscribed.seq, recover)
    } catch {
      if (current()) this.retire('resync-required')
    }
  }
  private parseSnapshot(value: unknown, ref: PiWebSessionRef): PiWebSnapshot {
    const snapshot = piWebSnapshotSchema.parse(value)
    if (snapshot.sessionId !== ref.sessionId || snapshot.agentInstanceId !== ref.agentInstanceId || !snapshot.chat || !snapshot.capabilities.includes(PI_WEB_CHAT_CAPABILITY)) throw new Error('RESYNC_REQUIRED')
    return snapshot
  }
  private async consume(generation: number, streamId: string, ref: PiWebSessionRef, epoch: string, seq: number, recover: boolean): Promise<void> {
    try {
      while (generation === this.generation) {
        const result = await this.rpc.rpc<{ events: unknown[]; done: boolean }>('pi-web.session.read', { streamId }, this.lifetime.signal)
        if (generation !== this.generation) return
        if (!Array.isArray(result.events) || typeof result.done !== 'boolean') throw new Error('INVALID_READ')
        for (const value of result.events) {
          const frame = piWebFrameSchema.parse(value)
          if (frame.sessionId !== ref.sessionId || frame.agentInstanceId !== ref.agentInstanceId || frame.epoch !== epoch || frame.seq !== seq + 1) throw new Error('RESYNC_REQUIRED')
          seq = frame.seq
          if (frame.type === 'chat.state') {
            const snapshot = this.parseSnapshot(frame.snapshot, ref)
            this.publish(this.snapshotPatch(snapshot))
          }
          if (frame.type === 'chat.live') {
            const live = piWebSnapshotSchema.pick({ running: true, isStreaming: true, awaitingInput: true, streaming: true, tools: true }).required().parse(frame.live)
            const snapshot = this.parseSnapshot({ ...this.state.snapshot, ...live }, ref)
            this.publish({ snapshot })
          }
          if (frame.type === 'questionnaire_state') {
            // 权威快照紧随状态事件；不将单题 dialog closed 误认作整份完成。
            const q = frame.questionnaire as PiWebQuestionnaire
            if (this.state.snapshot && q?.toolCallId) {
              const snapshot = piWebSnapshotSchema.parse({ ...this.state.snapshot, questionnaires: [...this.state.snapshot.questionnaires.filter(old => old.toolCallId !== q.toolCallId), { ...this.state.snapshot.questionnaires.find(old => old.toolCallId === q.toolCallId && old.revision === q.revision), ...q }] })
              this.publish({ snapshot })
            }
          }
          if (['attachment_ended', 'attachment_error', 'session_ended', 'questionnaire_unavailable'].includes(frame.type)) throw new Error('RESYNC_REQUIRED')
        }
        if (result.done) throw new Error('STREAM_ENDED')
      }
    } catch {
      if (generation !== this.generation) return
      this.retire('resync-required')
      // 只读重建一次；失败留在显式恢复状态，不忙轮询，不重放任何写操作。
      if (recover) await this.attach(ref.sessionId, ref.agentInstanceId, false)
    }
  }
  async resync(): Promise<void> {
    if (this.state.snapshot) await this.attach(this.state.snapshot.sessionId, this.state.snapshot.agentInstanceId)
  }
  private requireRef(): PiWebSessionRef {
    if (this.state.phase !== 'ready' || !this.state.snapshot) throw new Error('NOT_ATTACHED')
    return { sessionId: this.state.snapshot.sessionId, agentInstanceId: this.state.snapshot.agentInstanceId }
  }
  private async write(kind: PiWebWrite['kind'], method: PiWebMethod, ref: PiWebWrite['ref'], payload: Record<string, unknown>): Promise<PiWebWrite> {
    if (this.writes.size >= 256) throw new Error('OPERATION_CAPACITY')
    const operationId = this.createId()
    if (this.writes.has(operationId)) throw new Error('OPERATION_ID_COLLISION')
    const write: PiWebWrite = { operationId, kind, ref, verdict: 'submitting' }
    this.writes.set(operationId, write)
    this.publish({})
    const generation = this.generation
    let result: PiWebWrite
    try {
      const value = await this.rpc.rpc(method, { ...ref, ...payload, operationId }, this.lifetime.signal)
      const receipt = ref.toolCallId ? piWebOperationSchema.parse(value) : piWebChatOperationSchema.parse(value)
      if (receipt.sessionId !== ref.sessionId || receipt.agentInstanceId !== ref.agentInstanceId || receipt.operationId !== operationId
        || (ref.toolCallId && (!('toolCallId' in receipt) || receipt.toolCallId !== ref.toolCallId || receipt.revision !== ref.revision))) throw new Error('INVALID_RECEIPT')
      result = { ...write, verdict: receipt.verdict, code: receipt.code }
    } catch (error) {
      const code = (error as { code?: string })?.code
      const rejected = code !== undefined && ['INVALID_PARAMS', 'RATE_LIMITED', 'STALE_INSTANCE', 'NOT_ATTACHABLE', 'METHOD_NOT_FOUND', 'REQUEST_TOO_LARGE'].includes(code)
      result = { ...write, verdict: rejected ? (ref.toolCallId ? 'stale' : 'rejected') : 'unknown', ...(rejected ? { code } : {}) }
    }
    if (generation !== this.generation) return { ...write, verdict: 'unknown' }
    this.writes.set(operationId, result)
    this.publish({})
    return result
  }
  prompt(message: string) { return this.write('prompt', 'pi-web.session.prompt', this.requireRef(), { message }) }
  abort() { return this.write('abort', 'pi-web.session.abort', this.requireRef(), {}) }
  private questionnaireRef(q: PiWebQuestionnaire) {
    const ref = this.requireRef()
    if (!this.state.snapshot?.capabilities.includes('pi-web.questionnaire.v1')) throw new Error('QUESTIONNAIRE_UNSUPPORTED')
    if (!this.state.snapshot?.questionnaires.some(item => item.toolCallId === q.toolCallId && item.revision === q.revision && item.state === 'open')) throw new Error('QUESTIONNAIRE_CLOSED')
    if (this.state.writes.some(w => w.ref.sessionId === ref.sessionId && w.ref.agentInstanceId === ref.agentInstanceId && w.ref.toolCallId === q.toolCallId && w.ref.revision === q.revision && ['submitting', 'unknown'].includes(w.verdict))) throw new Error('OPERATION_UNRESOLVED')
    return { ...ref, toolCallId: q.toolCallId, revision: q.revision }
  }
  submit(q: PiWebQuestionnaire, answers: PiWebAnswer[], globalNote?: string) {
    return this.write('submit', 'pi-web.questionnaire.submit', this.questionnaireRef(q), { answers, ...(globalNote ? { globalNote } : {}) })
  }
  cancel(q: PiWebQuestionnaire, globalNote?: string) {
    return this.write('cancel', 'pi-web.questionnaire.cancel', this.questionnaireRef(q), globalNote ? { globalNote } : {})
  }
  async query(operationId: string): Promise<void> {
    const write = this.writes.get(operationId)
    if (!write || write.verdict === 'submitting') return
    const ref = this.requireRef()
    if (ref.sessionId !== write.ref.sessionId || ref.agentInstanceId !== write.ref.agentInstanceId) throw new Error('STALE_OPERATION')
    const generation = this.generation
    try {
      const raw = await this.rpc.rpc(write.ref.toolCallId ? 'pi-web.questionnaire.operation.get' : 'pi-web.session.operation.get', { ...write.ref, operationId }, this.lifetime.signal)
      const receipt = write.ref.toolCallId ? piWebOperationSchema.parse(raw) : piWebChatOperationSchema.parse(raw)
      if (receipt.operationId !== operationId || receipt.sessionId !== ref.sessionId || receipt.agentInstanceId !== ref.agentInstanceId ||
        (write.ref.toolCallId && (!('toolCallId' in receipt) || receipt.toolCallId !== write.ref.toolCallId || receipt.revision !== write.ref.revision))) throw new Error('INVALID_RECEIPT')
      if (generation === this.generation) { this.writes.set(operationId, { ...write, verdict: receipt.verdict, code: receipt.code }); this.publish({}) }
    } catch { /* 无法证明的查询保持 unknown，不重发。 */ }
  }
  release(): void { if (this.closed) return; this.retire('idle'); this.publish({ sessionId: undefined, snapshot: undefined, history: undefined, closedQuestionnaires: [] }) }
  close(): void { if (this.closed) return; this.closed = true; this.retire('closed'); this.offClose(); this.listeners.clear() }
}
