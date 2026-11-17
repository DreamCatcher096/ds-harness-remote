import type { PiWebAnswer, PiWebClientState, PiWebQuestionnaire, PiWebWrite } from '@dsh-remote/client-core'
import type { PiWebMessage } from '@dsh-remote/protocol'
import type { ChatMessage, ToolActivity } from '../types'

/** 只适配既有展示组件；不写入 ACP store，不猜序号、时间、模型或持久消息 ID。 */
export function piWebMessageView(message: PiWebMessage, sessionId: string, displayId: string, streaming = false): ChatMessage | ToolActivity {
  const text = message.content.map(block => block.type === 'toolCall'
    ? `工具调用：${block.toolName} · ${block.toolCallId}\n${block.input ?? ''}`
    : block.type === 'text' ? block.text : '').filter(Boolean).join('\n\n')
  const base = { id: displayId, sessionId, createdAt: 0 }
  if (message.role === 'toolResult') return {
    ...base, kind: 'tool', toolName: message.toolName ?? '工具结果',
    state: streaming ? 'running' : message.isError ? 'failed' : 'finished',
    summary: text, resultDetail: { text, format: 'code', truncated: message.truncated },
  }
  return { ...base, kind: 'message', role: message.role === 'assistant' || message.role === 'user' ? message.role : 'system',
    text, reasoning: message.content.filter(block => block.type === 'thinking').map(block => block.thinking).join('\n\n'), streaming }
}

// 独立 Pi Web backend 的表单投影；不接 ACP session/模型服务，不生成 frameRpcId。
export interface PiWebDraft { options: number[]; text: string; notes: string }
export function piWebAnswers(q: PiWebQuestionnaire, drafts: Record<number, PiWebDraft>): PiWebAnswer[] {
  return (q.questions ?? []).map(question => {
    const draft = drafts[question.questionIndex]
    return { questionIndex: question.questionIndex, optionIndexes: draft?.options ?? [],
      ...(draft?.text.trim() ? { text: draft.text } : {}), ...(draft?.notes.trim() ? { notes: draft.notes } : {}) }
  })
}
export function piWebQuestionnaireWrite(state: PiWebClientState, q: PiWebQuestionnaire): PiWebWrite | undefined {
  return [...state.writes].reverse().find(write => write.ref.sessionId === state.snapshot?.sessionId && write.ref.agentInstanceId === state.snapshot?.agentInstanceId
    && write.ref.toolCallId === q.toolCallId && write.ref.revision === q.revision)
}
export function piWebQuestionnaireStatus(q: PiWebQuestionnaire, write?: PiWebWrite, closed = false): string {
  if (write?.verdict === 'accepted') return write.kind === 'cancel' ? '已采纳取消' : '答案已采纳（不代表 Agent 已完成）'
  if (write?.verdict === 'submitting') return '提交中'
  if (write?.verdict === 'unknown') return '结果未知：请查询回执，不要重新提交'
  if (closed || q.state !== 'open' || write?.verdict === 'already-closed') return '已在其他端处理／原调用已关闭'
  if (write) return `未采纳：${write.code ?? write.verdict}`
  return '待整份提交'
}
