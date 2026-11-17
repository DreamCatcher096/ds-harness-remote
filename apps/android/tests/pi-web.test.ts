import { describe, expect, it } from 'vitest'
import { piWebAnswers, piWebMessageView, piWebQuestionnaireStatus, piWebQuestionnaireWrite } from '../src/services/pi-web'
import type { PiWebClientState, PiWebQuestionnaire, PiWebWrite } from '@dsh-remote/client-core'
const q: PiWebQuestionnaire = { toolCallId: 'tool', revision: 'rev', state: 'open', questions: [
  { questionIndex: 0, header: '单选', question: '单选？', multiSelect: false, options: [{ optionIndex: 0, label: '相同', description: '' }, { optionIndex: 1, label: '相同', description: '' }] },
  { questionIndex: 1, header: '多选', question: '多选？', multiSelect: true, options: [{ optionIndex: 0, label: '相同', description: '' }, { optionIndex: 1, label: '相同', description: '' }] },
  { questionIndex: 2, header: '空答', question: '空答？', multiSelect: true, options: [{ optionIndex: 0, label: 'A', description: '' }, { optionIndex: 1, label: 'B', description: '' }] },
] }
const ref = { sessionId: 's', agentInstanceId: 'i', toolCallId: 'tool', revision: 'rev' }
const write: PiWebWrite = { kind: 'submit', operationId: 'op', ref, verdict: 'submitting' }
describe('Pi Web Android 问卷业务投影（非真机）', () => {
  it('共用消息组件只作展示，重复文本保留真实 ID，不发明时间／序号／模型', () => {
    const message = { role: 'assistant' as const, content: [{ type: 'text' as const, text: '相同' }, { type: 'thinking' as const, thinking: '思考' }], isError: false, truncated: false }
    const first = piWebMessageView(message, 'original-session', 'entry-a')
    const second = piWebMessageView(message, 'original-session', 'entry-b')
    expect(first).toMatchObject({ kind: 'message', id: 'entry-a', sessionId: 'original-session', createdAt: 0, text: '相同', reasoning: '思考' })
    expect(second.id).toBe('entry-b')
    for (const key of ['nativeSeq', 'nativeTime', 'usage', 'backend', 'frameRpcId', 'remoteDetail']) expect(first).not.toHaveProperty(key)
    expect(piWebMessageView(message, 'original-session', 'local-live', true)).toMatchObject({ streaming: true })
  })
  it('工具结果只取真实错误标志；临时部分输出保持 running，不接 ACP 延迟详情', () => {
    const message = { role: 'toolResult' as const, content: [{ type: 'text' as const, text: '原结果' }], toolCallId: 'original-call', toolName: 'read', isError: true, truncated: true }
    expect(piWebMessageView(message, 'session', 'entry-result')).toMatchObject({ id: 'entry-result', state: 'failed', resultDetail: { text: '原结果', format: 'code', truncated: true } })
    const live = piWebMessageView(message, 'session', 'original-call', true)
    expect(live).toMatchObject({ id: 'original-call', state: 'running' })
    expect(live).not.toHaveProperty('remoteDetail')
  })
  it('重复 label 仍按索引，多题整份、自由输入、notes 与合法空答位置不丢失', () => {
    expect(piWebAnswers(q, { 0: { options: [1], text: '', notes: 'note' }, 1: { options: [0, 1], text: '自由文字', notes: '' } })).toEqual([
      { questionIndex: 0, optionIndexes: [1], notes: 'note' }, { questionIndex: 1, optionIndexes: [0, 1], text: '自由文字' }, { questionIndex: 2, optionIndexes: [] },
    ])
  })
  it('提交中、unknown、自己的 accepted 与其他端 closed 不混淆', () => {
    expect(piWebQuestionnaireStatus(q, write)).toBe('提交中')
    expect(piWebQuestionnaireStatus(q, { ...write, verdict: 'unknown' })).toContain('不要重新提交')
    expect(piWebQuestionnaireStatus({ ...q, state: 'answered' })).toContain('其他端')
    expect(piWebQuestionnaireStatus(q, { ...write, kind: 'cancel', verdict: 'accepted' })).toBe('已采纳取消')
  })
  it('迟到回执按 session／instance／tool／revision 隔离，不投到新表单', () => {
    const state = { snapshot: ref, writes: [write] } as unknown as PiWebClientState
    expect(piWebQuestionnaireWrite(state, q)).toBe(write)
    expect(piWebQuestionnaireWrite(state, { ...q, revision: 'new' })).toBeUndefined()
    expect(piWebQuestionnaireWrite({ ...state, snapshot: { ...state.snapshot!, agentInstanceId: 'new' } }, q)).toBeUndefined()
  })
})
