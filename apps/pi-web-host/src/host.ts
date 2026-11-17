import { lstat, readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PI_WEB_ATTACH_CAPABILITY } from '@dsh-remote/protocol'
import type { RtcPeerConnectionFactory } from '@dsh-remote/webrtc'
import { ConnectionController } from '../../../packages/plugin/src/connection-controller.js'
import type { ResolvedConfig } from '../../../packages/plugin/src/config.js'
import { IdentityStore, type HostIdentity } from '../../../packages/plugin/src/identity-store.js'
import { SafeLogger } from '../../../packages/plugin/src/logging.js'
import { HostServerApi, type FetchImplementation } from '../../../packages/plugin/src/server-api.js'
import { HostServerConnection } from '../../../packages/plugin/src/server-connection.js'
import { ServerCredentialStore } from '../../../packages/plugin/src/server-credentials.js'
import { loadNodeRtcFactory } from '../../../packages/plugin/src/werift-rtc.js'
import { PiWebHostError } from './errors.js'
import { type PiWebFetch } from './http.js'
import { PiWebClient } from './pi-web-client.js'
import { PiWebRouter } from './router.js'

export const HOST_IMPLEMENTATION = 'pi-web-host@source-0a0ac9a1'
interface ServerConnection {
  start(): void
  stop(): Promise<void>
  isOnline(): boolean
}
export interface PiWebHostOptions {
  stateDirectory: string
  serverUrl: string
  logger: SafeLogger
  /** 仅本地依赖注入；不会出现在 Remote 参数或磁盘配置中。 */
  piWebFetch?: PiWebFetch
  serverFetch?: FetchImplementation
  rtcFactoryProvider?: () => Promise<RtcPeerConnectionFactory | undefined>
  createConnection?: (config: ResolvedConfig, identity: HostIdentity, identities: IdentityStore, api: HostServerApi, peers: ConnectionController) => ServerConnection
}

const REPOSITORY = fileURLToPath(new URL('../../../', import.meta.url))
const PRODUCTION = resolve(REPOSITORY, '../../pi-web')
const within = (root: string, path: string) => { const rel = relative(root, path); return rel === '' || (rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\') && !isAbsolute(rel)) }

/** 无构造副作用；只连接显式独立状态，永不初始化、注册或迁移身份。 */
export class PiWebHost {
  private readonly lifetime = new AbortController()
  private started?: Promise<void>
  private closing?: Promise<void>
  private api?: HostServerApi
  private peers?: ConnectionController
  private connection?: ServerConnection

  constructor(private readonly options: PiWebHostOptions) {
    const server = new URL(options.serverUrl)
    if (server.protocol !== 'https:' || server.origin !== options.serverUrl || server.username || server.password) throw new PiWebHostError('INVALID_SERVER')
    if (!isAbsolute(options.stateDirectory)) throw new PiWebHostError('INVALID_STATE_DIRECTORY')
  }

  start(): Promise<void> {
    if (this.lifetime.signal.aborted) return Promise.reject(new PiWebHostError('HOST_CLOSED'))
    this.started ??= this.open().catch(async error => {
      this.api?.close()
      await this.connection?.stop()
      await this.peers?.close()
      throw error
    })
    return this.started
  }

  private async open(): Promise<void> {
    const directory = await realpath(this.options.stateDirectory)
    if (directory !== resolve(this.options.stateDirectory) || within(REPOSITORY, directory) || within(PRODUCTION, directory)
      || directory.split(/[\\/]/).includes('.dsh')) throw new PiWebHostError('INVALID_STATE_DIRECTORY')
    for (let parent = directory; ; parent = dirname(parent)) {
      try {
        await lstat(join(parent, '.git'))
        throw new PiWebHostError('INVALID_STATE_DIRECTORY')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      if (parent === dirname(parent)) break
    }
    for (const path of [directory, ...['pi-web-host.json', 'device.json', 'device.key', 'trusted-peers.json', 'server-credentials.json'].map(name => join(directory, name))]) {
      const info = await lstat(path)
      if (info.isSymbolicLink() || (path === directory ? !info.isDirectory() : !info.isFile())
        || (process.platform !== 'win32' && ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()))) throw new PiWebHostError('INVALID_STATE_DIRECTORY')
    }
    const marker = JSON.parse(await readFile(join(directory, 'pi-web-host.json'), 'utf8')) as { kind?: unknown; deviceId?: unknown }
    if (marker.kind !== 'pi-web-remote-host') throw new PiWebHostError('INVALID_STATE_DIRECTORY')
    this.lifetime.signal.throwIfAborted()
    const identities = new IdentityStore({ directory, role: 'host', env: {} })
    const existing = await identities.loadExistingHostState()
    if (!existing || marker.deviceId !== existing.deviceId) throw new PiWebHostError('IDENTITY_REQUIRED')
    const credentials = new ServerCredentialStore(directory)
    const stored = await credentials.load(this.options.serverUrl, existing.deviceId)
    if (!stored || stored.refreshTokenExpiresAt <= Date.now() + 30_000) throw new PiWebHostError('ACCOUNT_AUTH_REQUIRED')
    this.lifetime.signal.throwIfAborted()
    // 使用纯读取路径载入的同一身份；文件竞争也不得进入 loadOrCreate。
    const identity = existing
    this.lifetime.signal.throwIfAborted()
    const serverFetch: FetchImplementation = (input, init) => (this.options.serverFetch ?? fetch)(input, { ...init, redirect: 'error' })
    const api = new HostServerApi(this.options.serverUrl, credentials, serverFetch, 'host', { allowRegistration: false, clientVersion: HOST_IMPLEMENTATION })
    this.api = api
    api.bindIdentity(identity)
    await api.loadStoredPolicy()
    this.lifetime.signal.throwIfAborted()
    const peers = new ConnectionController(identities, context => new PiWebRouter(context, new PiWebClient(this.options.piWebFetch)), this.options.logger)
    this.peers = peers
    const config: ResolvedConfig = {
      enabled: true, role: 'host', serverUrl: this.options.serverUrl, deviceName: identity.name,
      forceRelay: false, rotatePinnedPeerKey: false, logLevel: 'info', reconnect: { enabled: true, initialDelayMs: 4_000, maxDelayMs: 30_000, jitter: 0.2 },
      terminal: { enabled: false }, sidebar: { entry: 'standard' }, loopback: { ports: [] },
      hostControl: { enabled: false }, remoteTools: { enabled: false },
      codex: { enabled: false, binary: '' }, cursor: { enabled: false, binary: '' }, acp: { enabled: false, backends: [] },
    }
    this.connection = this.options.createConnection?.(config, identity, identities, api, peers) ?? new HostServerConnection(
      config, identity, identities, api, peers, this.options.logger, undefined,
      this.options.rtcFactoryProvider ?? loadNodeRtcFactory, () => [PI_WEB_ATTACH_CAPABILITY], undefined, HOST_IMPLEMENTATION,
    )
    this.lifetime.signal.throwIfAborted()
    this.connection.start()
  }

  status() { return { online: this.connection?.isOnline() ?? false, connections: this.peers?.connectionCount() ?? 0, closed: this.lifetime.signal.aborted } }

  close(): Promise<void> {
    this.closing ??= (async () => {
      this.lifetime.abort()
      this.api?.close()
      await this.started?.catch(() => undefined)
      await this.connection?.stop()
      await this.peers?.close()
    })()
    return this.closing
  }
}
