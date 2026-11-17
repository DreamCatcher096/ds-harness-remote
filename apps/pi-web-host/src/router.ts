import { createHash } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import {
  PI_WEB_ATTACH_CAPABILITY, PI_WEB_CHAT_CAPABILITY, PI_WEB_MAX_STREAMS, PI_WEB_READ_WAIT_MS, PI_WEB_STREAM_IDLE_MS,
  createRpcError, createRpcResponse, piWebParams,
  type PiWebFrame, type PiWebMethod, type RemoteMessage,
} from '@dsh-remote/protocol'
import { z } from 'zod'
import type { PeerConnectionContext, PeerRpcRouter } from '../../../packages/plugin/src/connection-controller.js'
import { PiWebHostError } from './errors.js'
import { PiWebClient, type PiWebStream } from './pi-web-client.js'

const wire = z.object({ method: z.string(), params: z.unknown() }).strict()
interface Subscription {
  stream: PiWebStream
  busy: boolean
  pending?: Promise<PiWebFrame | undefined>
  idle?: ReturnType<typeof setTimeout>
}
const EMPTY = Symbol('empty-read')

export class PiWebRouter implements PeerRpcRouter {
  private readonly lifetime = new AbortController()
  private readonly subscriptions = new Map<string, Subscription>()
  private opening = 0
  private active = 0

  constructor(private readonly context: PeerConnectionContext, private readonly client: PiWebClient) {}

  async handle(message: RemoteMessage): Promise<RemoteMessage> {
    if (this.lifetime.signal.aborted) return createRpcError(message.id, 'CONNECTION_CLOSED', 'The connection has closed.')
    if (message.type !== 'rpc.request') return createRpcError(message.id, 'INVALID_MESSAGE', 'Only RPC requests are accepted.')
    const request = wire.safeParse(message.payload)
    if (!request.success) return createRpcError(message.id, 'INVALID_MESSAGE', 'Invalid RPC envelope.')
    if (!Object.hasOwn(piWebParams, request.data.method)) return createRpcError(message.id, 'METHOD_NOT_FOUND', 'Unsupported Pi Web operation.')
    if (this.active >= 128) return createRpcError(message.id, 'RATE_LIMITED', 'Too many pending requests.')
    const method = request.data.method as PiWebMethod
    const params = piWebParams[method].safeParse(request.data.params)
    if (!params.success) return createRpcError(message.id, 'INVALID_PARAMS', 'Invalid Pi Web parameters.')
    this.active += 1
    try {
      const result = await this.invoke(method, params.data as Record<string, unknown>)
      this.lifetime.signal.throwIfAborted()
      return createRpcResponse(message.id, result)
    } catch (error) {
      const code = this.lifetime.signal.aborted ? 'CONNECTION_CLOSED' : error instanceof PiWebHostError ? error.code : 'UPSTREAM_UNAVAILABLE'
      return createRpcError(message.id, code, 'The Pi Web operation did not complete.',
        error instanceof PiWebHostError && error.unknownOutcome ? { outcome: 'unknown' } : undefined, false)
    } finally { this.active -= 1 }
  }

  private async invoke(method: PiWebMethod, params: Record<string, unknown>): Promise<unknown> {
    if (method === 'pi-web.describe') return { kind: 'pi-web', capabilities: [PI_WEB_ATTACH_CAPABILITY, PI_WEB_CHAT_CAPABILITY], upstream: 'unverified' }
    if (method === 'pi-web.sessions.list') return this.client.catalog(this.lifetime.signal)
    if (method === 'pi-web.session.history') return this.client.history(params as { sessionId: string }, this.lifetime.signal)
    if (method === 'pi-web.session.snapshot') return this.client.snapshot(params.sessionId as string, this.lifetime.signal)
    if (method === 'pi-web.session.subscribe') {
      if (this.subscriptions.size + this.opening >= PI_WEB_MAX_STREAMS) throw new PiWebHostError('RATE_LIMITED')
      this.opening += 1
      try {
        const { stream, snapshot, ...boundary } = await this.client.subscribe(params as { sessionId: string; agentInstanceId: string }, this.lifetime.signal)
        if (this.lifetime.signal.aborted) { await stream.close(); throw new PiWebHostError('CONNECTION_CLOSED') }
        const streamId = randomUUID()
        const subscription: Subscription = { stream, busy: false }
        this.subscriptions.set(streamId, subscription)
        this.armIdle(streamId, subscription)
        return { streamId, snapshot, ...boundary }
      } finally { this.opening -= 1 }
    }
    if (method === 'pi-web.session.unsubscribe') {
      await this.release(params.streamId as string)
      return { closed: true }
    }
    if (method === 'pi-web.session.read') return this.read(params.streamId as string)
    const operationId = params.operationId
    const forwarded = operationId === undefined ? params : { ...params, operationId: 'remote:' + createHash('sha256')
      .update(JSON.stringify([this.context.peerDeviceId, operationId])).digest('hex') }
    const receipt = await this.client.command(method, forwarded, this.lifetime.signal)
    return operationId === undefined ? receipt : { ...(receipt as Record<string, unknown>), operationId }
  }

  private async read(streamId: string): Promise<unknown> {
    const subscription = this.subscriptions.get(streamId)
    if (!subscription) throw new PiWebHostError('STREAM_NOT_FOUND')
    if (subscription.busy) throw new PiWebHostError('READ_IN_PROGRESS')
    subscription.busy = true
    if (subscription.idle) clearTimeout(subscription.idle)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      subscription.pending ??= subscription.stream.next()
      const event = await Promise.race([subscription.pending, new Promise<typeof EMPTY>(resolve => { timer = setTimeout(() => resolve(EMPTY), PI_WEB_READ_WAIT_MS) })])
      if (event === EMPTY) return { events: [], done: false }
      subscription.pending = undefined
      const done = event === undefined || event.type === 'attachment_ended' || event.type === 'attachment_error'
      if (done) await this.release(streamId)
      return { events: event ? [event] : [], done }
    } catch (error) {
      await this.release(streamId)
      throw error
    } finally {
      if (timer) clearTimeout(timer)
      subscription.busy = false
      if (this.subscriptions.has(streamId)) this.armIdle(streamId, subscription)
    }
  }

  private armIdle(streamId: string, subscription: Subscription): void {
    subscription.idle = setTimeout(() => { void this.release(streamId) }, PI_WEB_STREAM_IDLE_MS)
    subscription.idle.unref?.()
  }

  private async release(streamId: string): Promise<void> {
    const subscription = this.subscriptions.get(streamId)
    if (!subscription) throw new PiWebHostError('STREAM_NOT_FOUND')
    this.subscriptions.delete(streamId)
    if (subscription.idle) clearTimeout(subscription.idle)
    await subscription.stream.close()
  }

  async closePeerStreams(): Promise<void> {
    this.lifetime.abort()
    await Promise.all([...this.subscriptions.keys()].map(id => this.release(id)))
  }
}
