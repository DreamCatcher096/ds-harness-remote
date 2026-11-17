import { describe, expect, it } from 'vitest'
import { piWebParams, piWebHistorySchema, piWebMessageSchema, piWebQuestionnaireSchema, createRpcRequest, encodeMessage, decodeMessage } from '../src/index.js'
const message = { role: 'user', content: [{ type: 'text', text: '相同内容' }], isError: false, truncated: false }
describe('Pi Web P3 协议负向契约', () => {
  it('新方法沿用原 envelope；未知字段／空实例不能偷渡模型或目标', () => {
    for (const method of ['pi-web.sessions.list', 'pi-web.session.history', 'pi-web.session.prompt', 'pi-web.session.abort', 'pi-web.session.operation.get'] as const) {
      expect(decodeMessage(encodeMessage(createRpcRequest(method, {}))).payload).toMatchObject({ method })
    }
    expect(piWebParams['pi-web.session.prompt'].safeParse({ sessionId: 's', agentInstanceId: '', operationId: 'op', message: 'fixture' }).success).toBe(false)
    expect(piWebParams['pi-web.session.prompt'].safeParse({ sessionId: 's', agentInstanceId: 'i', operationId: 'op', message: 'fixture', model: 'hidden' }).success).toBe(false)
    expect(piWebParams['pi-web.session.history'].safeParse({ sessionId: 's', before: '/tmp/secret' }).success).toBe(true) // opaque cursor，不是路径；Host 只放 query。
    expect(piWebParams['pi-web.session.history'].safeParse({ sessionId: '../secret' }).success).toBe(false)
  })
  it('相同文本的不同真实 ID 保留；重复 ID／无游标的缺页不能冒充完整快照', () => {
    const h = { messages: [{ messageId: 'a', message }, { messageId: 'b', message }], hasMore: false }
    expect(piWebHistorySchema.safeParse(h).success).toBe(true)
    expect(piWebHistorySchema.safeParse({ ...h, messages: [h.messages[0], h.messages[0]] }).success).toBe(false)
    expect(piWebHistorySchema.safeParse({ ...h, hasMore: true }).success).toBe(false)
  })
  it('工具必须有真实 toolCallId；问卷重复／乱序索引不能进入原生表单', () => {
    expect(piWebMessageSchema.safeParse({ ...message, role: 'assistant', content: [{ type: 'toolCall', toolName: 'read' }] }).success).toBe(false)
    const question = { questionIndex: 0, header: 'h', question: 'q', multiSelect: false,
      options: [{ optionIndex: 0, label: '相同', description: '' }, { optionIndex: 1, label: '相同', description: '' }] }
    const q = { toolCallId: 'call', revision: 'rev', state: 'open', questions: [question] }
    expect(piWebQuestionnaireSchema.safeParse(q).success).toBe(true)
    expect(piWebQuestionnaireSchema.safeParse({ ...q, questions: [question, question] }).success).toBe(false)
    expect(piWebQuestionnaireSchema.safeParse({ ...q, questions: [{ ...question, options: [question.options[0], question.options[0]] }] }).success).toBe(false)
  })
})
