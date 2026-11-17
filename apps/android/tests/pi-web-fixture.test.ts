import { afterEach, describe, expect, it, vi } from 'vitest'
import { PiWebFixtureRpc } from '../src/fixtures/pi-web-rpc'
const active: PiWebFixtureRpc[] = []
afterEach(() => { active.splice(0).forEach(driver => driver.close()); vi.useRealTimers() })
async function fixture() {
  vi.useFakeTimers()
  const driver = new PiWebFixtureRpc(); active.push(driver)
  await driver.client.discover(); await driver.client.attach('fixture-live')
  return driver
}
describe('离线设备夹具的测试真实性与写入隔离', () => {
  it('冷读不发业务写入；页面复用真实客户端而非复制其成功状态', async () => {
    const d = await fixture()
    await d.client.browse('fixture-cold')
    expect(d.client.getState().phase).toBe('read-only')
    expect(d.counts).toEqual({ prompts: 0, stops: 0, submits: 0, cancels: 0, other: 0 })
  })
  it('回执丢失后的取消只执行一次，query 只查询；恢复不重发', async () => {
    const d = await fixture(); d.openQuestionnaire(); await vi.advanceTimersByTimeAsync(0)
    const q = d.client.getState().snapshot!.questionnaires[0]!
    d.dropNextReceipt = true
    const cancelling = d.client.cancel(q)
    expect(d.client.getState().writes[0]?.verdict).toBe('submitting')
    await vi.advanceTimersByTimeAsync(900)
    const result = await cancelling
    expect(result.verdict).toBe('unknown'); expect(d.counts.cancels).toBe(1)
    d.disconnect(); d.reconnect(); await d.client.resync(); await d.client.query(result.operationId)
    expect(d.client.getState().writes[0]?.verdict).toBe('accepted')
    expect(d.counts.cancels).toBe(1); expect(d.counts.prompts).toBe(0)
  })
  it('其他端完成和 Stop 使表单失效，不能把它们显示成本端答案采纳', async () => {
    const d = await fixture(); d.openQuestionnaire(); await vi.advanceTimersByTimeAsync(0)
    d.finishElsewhere(); await vi.advanceTimersByTimeAsync(0)
    expect(d.client.getState().snapshot?.questionnaires).toEqual([])
    expect(d.client.getState().closedQuestionnaires).toHaveLength(1)
    expect(d.client.getState().writes).toEqual([])
    d.openQuestionnaire(); await vi.advanceTimersByTimeAsync(0)
    const stopping = d.client.abort(); await vi.advanceTimersByTimeAsync(900); await stopping
    expect(d.counts.stops).toBe(1); expect(d.counts.submits).toBe(0)
    expect(d.client.getState().snapshot?.questionnaires).toEqual([])
  })
  it('实例换代不默默重附着或续发任务', async () => {
    const d = await fixture(); d.replaceInstance(); await vi.advanceTimersByTimeAsync(0)
    expect(d.client.getState().phase).toBe('replaced')
    expect(d.counts.prompts).toBe(0); expect(d.counts.submits).toBe(0)
  })
})
