import { afterEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { createRpcRequest, decodeMessage, encodeMessage, type RpcMethod } from '@dsh-remote/protocol'
import { PiWebRemoteClient, type PiWebRpc } from '../../../packages/client-core/src/pi-web-client.js'
import { PiWebClient } from '../src/pi-web-client.js'
import { PiWebRouter } from '../src/router.js'
import { piWebAnswers } from '../../android/src/services/pi-web.js'

// 显式固定开发源码；不导入生产安装，不创建 SDK AgentSession，不打开监听端口。
const source = process.env.PI_WEB_BRIDGE_SOURCE
const questionnaireSource = process.env.PI_WEB_QUESTIONNAIRE_SOURCE
const running: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of running.splice(0)) await close() })
const wait = async (test: () => boolean) => {
  for (let i = 0; i < 200; i++) { if (test()) return; await new Promise(resolve => setTimeout(resolve, 5)) }
  throw new Error('Fixture state did not arrive')
}

describe('P3 跨源码无账号／无模型原生业务链', () => {
  it('选择目录 → 原实例历史/live → 发送/Stop → 多题整份答案回原 toolCall，一次结果', async () => {
    if (!source || !questionnaireSource) throw new Error('Explicit PI_WEB_BRIDGE_SOURCE and PI_WEB_QUESTIONNAIRE_SOURCE are required; do not skip this fixture')
    const require = createRequire(`${source}/package.json`)
    const { createJiti } = require('jiti')
    const jiti = createJiti(`${source}/package.json`, { tsconfigPaths: true })
    const { AgentSessionWrapper } = await jiti.import(`${source}/lib/rpc-manager.ts`)
    const { RemoteQuestionnaireBridge } = await jiti.import(`${source}/lib/remote-questionnaire.ts`)
    const { createEventBus } = await jiti.import('@earendil-works/pi-coding-agent')
    const { registerAskUserQuestionTool } = await jiti.import(`${questionnaireSource}/ask-user-question.ts`)
    const routes = await jiti.import(`${source}/app/api/remote/[id]/route.ts`)
    const events = await jiti.import(`${source}/app/api/remote/[id]/events/route.ts`)
    const catalog = await jiti.import(`${source}/app/api/remote/catalog/route.ts`)
    const history = await jiti.import(`${source}/app/api/remote/[id]/history/route.ts`)
    const bus = createEventBus()
    let tool: { execute: (...args: unknown[]) => Promise<unknown> } | undefined
    registerAskUserQuestionTool({ events: bus, registerTool: (registered: typeof tool) => { tool = registered } })
    const entries = [
      { type: 'message', id: 'real-a', message: { role: 'user', content: '重复文本' } },
      { type: 'message', id: 'real-b', message: { role: 'toolResult', toolCallId: 'original-tool', toolName: 'read', content: [{ type: 'text', text: '普通工具结果' }] } },
    ]
    let prompts = 0, stops = 0
    const inner = { sessionId: 'native-chain', isStreaming: false, isCompacting: false, isBashRunning: false,
      sessionManager: { getCwd: () => '/fixture', getBranch: () => entries }, agent: { state: {} }, extensionRunner: {}, dispose() {},
      clearQueue: () => ({ steering: [], followUp: [] }), abort: async () => { stops++ },
    }
    const wrapper = new AgentSessionWrapper(inner, { questionnaireBridge: new RemoteQuestionnaireBridge(bus) })
    // 执行动作是可计数假上游，不启动 SDK/provider。实例校验在真实桥接／Host 完成。
    wrapper.send = async (command: { type: string }) => { command.type === 'prompt' ? prompts++ : stops++; return null }
    const globals = globalThis as typeof globalThis & { __piSessions?: Map<string, typeof wrapper> }
    const before = globals.__piSessions
    globals.__piSessions = new Map([[inner.sessionId, wrapper]])
    const context = { params: Promise.resolve({ id: inner.sessionId }) }
    let loseReceipt = false
    let cancellations = 0
    const http = new PiWebClient(async (url, init) => {
      const req = new Request(url, init)
      if (url.endsWith('/catalog')) return catalog.GET(req)
      if (url.includes('/events?')) return events.GET(req, context)
      if (url.includes('/history?')) return history.GET(req, context)
      if (init.method !== 'POST') return routes.GET(req, context)
      if (JSON.parse(init.body as string).type === 'questionnaire.cancel') cancellations++
      const response = await routes.POST(req, context)
      if (loseReceipt) { loseReceipt = false; throw new Error('Fixture lost the response after upstream commit') }
      return response
    })
    const router = new PiWebRouter({ connectionId: 'isolated', peerDeviceId: 'fixture-peer' }, http)
    const rpc: PiWebRpc = {
      async rpc(method, params) {
        const response = decodeMessage(encodeMessage(await router.handle(decodeMessage(encodeMessage(createRpcRequest(method as RpcMethod, params))))))
        const payload = response.payload as { result: never; code: string; message: string }
        if (response.type === 'rpc.error') throw Object.assign(new Error(payload.message), { code: payload.code })
        return payload.result
      }, onClose: () => () => {},
    }
    let operation = 0
    const client = new PiWebRemoteClient(rpc, () => `fixture-${++operation}`)
    running.push(async () => { client.close(); await router.closePeerStreams(); wrapper.destroy(); globals.__piSessions = before; bus.clear() })
    await client.discover()
    const rows = await client.catalog()
    const row = rows.sessions.find(row => row.sessionId === inner.sessionId)!
    expect(row.attachable).toBe(true)
    await client.attach(row.sessionId, row.agentInstanceId)
    expect(client.getState().history?.messages.map(m => m.messageId)).toEqual(['real-a', 'real-b'])
    expect(client.getState().history?.messages[1]?.message.toolCallId).toBe('original-tool')
    expect((await client.prompt('固定任务')).verdict).toBe('accepted')
    expect((await client.abort()).verdict).toBe('accepted')
    expect([prompts, stops]).toEqual([1, 1])
    const questions = [false, true].map((multiSelect, index) => ({ question: `题${index}`, header: `题${index}`, multiSelect,
      options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b', preview: '**安全文本**' }] }))
    let completions = 0
    const result = tool!.execute('original-questionnaire', { questions }, undefined, undefined, { hasUI: true, mode: 'rpc', ui: wrapper.createExtensionUiContext() }).then(value => { completions++; return value })
    await wait(() => client.getState().snapshot?.questionnaires.some(q => q.toolCallId === 'original-questionnaire') === true)
    const q = client.getState().snapshot!.questionnaires.find(q => q.toolCallId === 'original-questionnaire')!
    const answers = piWebAnswers(q, { 0: { options: [1], text: '', notes: '' }, 1: { options: [0, 1], text: '补充文字', notes: '' } })
    const receipt = await client.submit(q, answers)
    expect(receipt.verdict).toBe('accepted')
    await result
    await wait(() => client.getState().closedQuestionnaires?.some(q => q.toolCallId === 'original-questionnaire') === true)
    expect(client.getState().snapshot?.questionnaires).toEqual([])
    await client.query(receipt.operationId)
    expect(client.getState().writes.at(-1)?.verdict).toBe('accepted')
    expect(completions).toBe(1)
    expect([prompts, stops]).toEqual([1, 1])
    expect(() => client.submit(q, answers)).toThrow('QUESTIONNAIRE_CLOSED')
    const cancelledResult = tool!.execute('cancel-questionnaire', { questions }, undefined, undefined, { hasUI: true, mode: 'rpc', ui: wrapper.createExtensionUiContext() })
    await wait(() => client.getState().snapshot?.questionnaires.some(q => q.toolCallId === 'cancel-questionnaire') === true)
    const cancelQ = client.getState().snapshot!.questionnaires.find(q => q.toolCallId === 'cancel-questionnaire')!
    loseReceipt = true
    const uncertain = await client.cancel(cancelQ)
    expect(uncertain.verdict).toBe('unknown')
    expect((await cancelledResult as { details: { cancelled: boolean } }).details.cancelled).toBe(true)
    await client.query(uncertain.operationId)
    expect(client.getState().writes.at(-1)?.verdict).toBe('accepted')
    expect(cancellations).toBe(1)
    expect([prompts, stops]).toEqual([1, 1])
  })
})
