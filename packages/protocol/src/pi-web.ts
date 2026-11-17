import { z } from 'zod'

export const PI_WEB_CHAT_CAPABILITY = 'pi-web.chat.v1' as const
export const PI_WEB_ATTACH_CAPABILITY = 'pi-web.attach.v1' as const
export const PI_WEB_QUESTIONNAIRE_CAPABILITY = 'pi-web.questionnaire.v1' as const
export const PI_WEB_MAX_BYTES = 1024 * 1024
export const PI_WEB_READ_WAIT_MS = 10_000
export const PI_WEB_MAX_STREAMS = 16
export const PI_WEB_STREAM_IDLE_MS = 60_000
export const PI_WEB_STREAM_TOTAL_BYTES = 64 * 1024 * 1024

const id = z.string().min(1).max(128)
const sessionId = id.regex(/^[a-zA-Z0-9_-]+$/)
export const piWebSessionRefSchema = z.object({ sessionId, agentInstanceId: id }).strict()
export type PiWebSessionRef = z.infer<typeof piWebSessionRefSchema>
export const piWebQuestionnaireRefSchema = piWebSessionRefSchema.extend({ toolCallId: id, revision: id })
export const piWebAnswerSchema = z.object({
  questionIndex: z.number().int().min(0).max(3),
  optionIndexes: z.array(z.number().int().min(0).max(3)).max(4).optional(),
  text: z.string().max(PI_WEB_MAX_BYTES).optional(),
  notes: z.string().max(PI_WEB_MAX_BYTES).optional(),
}).strict()
const operation = piWebQuestionnaireRefSchema.extend({ operationId: id })
export const piWebParams = {
  'pi-web.describe': z.object({}).strict(),
  'pi-web.sessions.list': z.object({}).strict(),
  'pi-web.session.history': z.object({ sessionId, agentInstanceId: id.optional(), before: id.optional() }).strict(),
  'pi-web.session.prompt': piWebSessionRefSchema.extend({ operationId: id, message: z.string().min(1).max(64 * 1024) }),
  'pi-web.session.abort': piWebSessionRefSchema.extend({ operationId: id }),
  'pi-web.session.operation.get': piWebSessionRefSchema.extend({ operationId: id }),
  'pi-web.session.snapshot': z.object({ sessionId }).strict(),
  'pi-web.session.subscribe': piWebSessionRefSchema,
  'pi-web.session.read': z.object({ streamId: id }).strict(),
  'pi-web.session.unsubscribe': z.object({ streamId: id }).strict(),
  'pi-web.questionnaire.submit': operation.extend({ answers: z.array(piWebAnswerSchema).max(4), globalNote: z.string().max(PI_WEB_MAX_BYTES).optional() }),
  'pi-web.questionnaire.cancel': operation.extend({ globalNote: z.string().max(PI_WEB_MAX_BYTES).optional() }),
  'pi-web.questionnaire.operation.get': operation,
  'pi-web.ui.respond': piWebSessionRefSchema.extend({
    id, value: z.string().max(PI_WEB_MAX_BYTES).optional(), confirmed: z.boolean().optional(), cancelled: z.boolean().optional(),
  }),
} as const
export type PiWebMethod = keyof typeof piWebParams

export const piWebQuestionnaireSchema = z.object({
  toolCallId: id, revision: id, state: z.enum(['open', 'answered', 'cancelled', 'aborted']),
  questions: z.array(z.object({
    questionIndex: z.number().int().nonnegative(), question: z.string(), header: z.string(), multiSelect: z.boolean(),
    options: z.array(z.object({ optionIndex: z.number().int().nonnegative(), label: z.string(), description: z.string(), preview: z.string().optional() })).min(2).max(4),
  })).min(1).max(4).optional(),
}).refine(q => (q.state !== 'open' || q.questions !== undefined) && (!q.questions || q.questions.every((question, i) =>
  question.questionIndex === i && question.options.every((option, j) => option.optionIndex === j))))
export const piWebMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'toolResult', 'custom', 'bashExecution']),
  content: z.array(z.object({ type: z.enum(['text', 'thinking', 'toolCall']), text: z.string().optional(), thinking: z.string().optional(),
    toolCallId: id.optional(), toolName: z.string().optional(), input: z.string().optional() }).refine(block =>
    block.type === 'toolCall' ? !!block.toolCallId && !!block.toolName : block.type === 'thinking' ? block.thinking !== undefined : block.text !== undefined)).max(64),
  toolCallId: id.optional(), toolName: z.string().optional(), isError: z.boolean(), truncated: z.boolean(),
})
export type PiWebMessage = z.infer<typeof piWebMessageSchema>
export const piWebHistorySchema = z.object({
  messages: z.array(z.object({ messageId: id, message: piWebMessageSchema })).max(100), hasMore: z.boolean(), before: id.optional(),
}).refine(h => new Set(h.messages.map(m => m.messageId)).size === h.messages.length && (!h.hasMore || !!h.before))
export type PiWebHistory = z.infer<typeof piWebHistorySchema>
export const piWebCatalogSchema = z.object({ capabilities: z.array(z.string()), sessions: z.array(z.object({
  sessionId, cwd: z.string(), title: z.string(), attachable: z.boolean(), agentInstanceId: id.optional(), running: z.boolean(),
})).max(1000) })
export type PiWebCatalog = z.infer<typeof piWebCatalogSchema>
export const piWebChatOperationSchema = piWebSessionRefSchema.extend({ operationId: id,
  verdict: z.enum(['accepted', 'rejected', 'unknown']), code: z.string().optional(),
})
export type PiWebChatOperation = z.infer<typeof piWebChatOperationSchema>
export const piWebSnapshotSchema = piWebSessionRefSchema.extend({
  capabilities: z.array(z.string()).max(128), running: z.boolean(), isStreaming: z.boolean(), awaitingInput: z.boolean(),
  questionnaires: z.array(piWebQuestionnaireSchema),
  chat: piWebHistorySchema.optional(), streaming: piWebMessageSchema.nullable().optional(),
  tools: z.array(z.object({ toolCallId: id, toolName: z.string(), partial: piWebMessageSchema.nullable() })).optional(),
  pendingUi: z.array(z.object({ id, method: z.enum(['select', 'input', 'editor', 'confirm']), title: z.string(), options: z.array(z.string()).optional() }).passthrough()).optional(),
}).passthrough()
export type PiWebSnapshot = z.infer<typeof piWebSnapshotSchema>
export const piWebFrameSchema = z.object({
  type: z.string().min(1), sessionId, agentInstanceId: id, epoch: id, seq: z.number().int().positive(),
}).passthrough()
export type PiWebFrame = z.infer<typeof piWebFrameSchema>
export const piWebConnectedSchema = piWebFrameSchema.extend({
  type: z.literal('connected'), remoteSnapshot: piWebSnapshotSchema,
  pendingExtensionUiIds: z.array(id).max(128),
})
export const piWebOperationSchema = operation.extend({
  verdict: z.enum(['accepted', 'invalid', 'stale', 'already-closed', 'operation-conflict', 'unknown']),
  state: z.enum(['open', 'answered', 'cancelled', 'aborted']).optional(), code: z.string().optional(),
}).passthrough()
export type PiWebQuestionnaireOperation = z.infer<typeof piWebOperationSchema>
