import { mkdtemp, writeFile, rm, chmod, symlink, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HostServerApi } from '../../../packages/plugin/src/server-api.js'
import { IdentityStore } from '../../../packages/plugin/src/identity-store.js'
import { SafeLogger } from '../../../packages/plugin/src/logging.js'
import { ServerCredentialStore } from '../../../packages/plugin/src/server-credentials.js'
import { ConnectionController, type PeerRpcRouter } from '../../../packages/plugin/src/connection-controller.js'
import type { AuthenticatedPeerChannel } from '../../../packages/plugin/src/types.js'
import { createRpcRequest, createRpcResponse } from '@dsh-remote/protocol'
import { PiWebHost } from '../src/host.js'

const roots: string[] = []
const hosts: PiWebHost[] = []
const logger = new SafeLogger({ debug() {}, info() {}, warn() {}, error() {} })
const serverUrl = 'https://server.example'
afterEach(async () => { await Promise.all(hosts.splice(0).map(host => host.close())); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function state() {
  const directory = await mkdtemp(join(tmpdir(), 'pi-web-host-test-'))
  roots.push(directory)
  await chmod(directory, 0o700)
  const store = new IdentityStore({ directory, env: {}, role: 'host' })
  const identity = await store.loadOrCreate('fixture-only')
  await writeFile(join(directory, 'pi-web-host.json'), JSON.stringify({ kind: 'pi-web-remote-host', deviceId: identity.deviceId }), { mode: 0o600 })
  const credentials = new ServerCredentialStore(directory)
  await credentials.save({ serverUrl, deviceId: identity.deviceId, authorizationMethod: 'account',
    accessToken: 'fixture-access-token', accessTokenExpiresAt: Date.now() + 3600_000,
    refreshToken: 'fixture-refresh-token', refreshTokenExpiresAt: Date.now() + 7200_000,
  })
  return { directory, store, identity, credentials }
}

function channel(connectionId: string, peerDeviceId = 'peer') {
  let listener: ((message: ReturnType<typeof createRpcRequest>) => void) | undefined
  return {
    security: { protocol: 'Noise_IK_25519_ChaChaPoly_SHA256' as const, connectionId, membershipId: 'membership' },
    peerDeviceId, peerIdentityKey: 'pinned', send: vi.fn(async () => undefined), close: vi.fn(async () => undefined),
    onMessage: (handler: typeof listener) => { listener = handler; return () => { listener = undefined } },
    push: (message: ReturnType<typeof createRpcRequest>) => listener?.(message),
  }
}

describe('独立 Host 无副作用生命周期', () => {
  it('纯读取状态路径永不补建身份或信任文件', async () => {
    const fixture = await state()
    const store = new IdentityStore({ directory: fixture.directory, role: 'host', env: {} })
    expect((await store.loadExistingHostState())?.deviceId).toBe(fixture.identity.deviceId)
    expect(store.current().deviceId).toBe(fixture.identity.deviceId)
    await rm(join(fixture.directory, 'trusted-peers.json'))
    await expect(store.loadExistingHostState()).rejects.toBeDefined()
    await expect(readFile(join(fixture.directory, 'trusted-peers.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await rm(join(fixture.directory, 'device.json')); await rm(join(fixture.directory, 'device.key'))
    expect(await store.loadExistingHostState()).toBeUndefined()
    await expect(readFile(join(fixture.directory, 'device.key'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('构造/关闭不读身份、不访问网络；close 后不复活', async () => {
    const fetch = vi.fn()
    const create = vi.fn()
    const host = new PiWebHost({ stateDirectory: '/does-not-exist-host-fixture', serverUrl, logger, serverFetch: fetch, piWebFetch: fetch, createConnection: create })
    hosts.push(host)
    expect(host.status()).toEqual({ online: false, connections: 0, closed: false })
    await host.close()
    expect(fetch).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled()
    await expect(host.start()).rejects.toMatchObject({ code: 'HOST_CLOSED' })
  })

  it('已有独立身份才启动连接工厂，禁用 ACP/Codex；重复 start/close 幂等', async () => {
    const fixture = await state()
    const fetch = vi.fn()
    const connection = { start: vi.fn(), stop: vi.fn(async () => undefined), isOnline: () => false }
    const create = vi.fn((config) => {
      expect(config.acp.enabled).toBe(false); expect(config.codex.enabled).toBe(false)
      expect(config.cursor.enabled).toBe(false); expect(config.terminal.enabled).toBe(false)
      return connection
    })
    const host = new PiWebHost({ stateDirectory: fixture.directory, serverUrl, logger, serverFetch: fetch, piWebFetch: fetch, createConnection: create })
    hosts.push(host)
    await Promise.all([host.start(), host.start()])
    expect(create).toHaveBeenCalledOnce(); expect(connection.start).toHaveBeenCalledOnce()
    expect(fetch).not.toHaveBeenCalled()
    await Promise.all([host.close(), host.close()])
    expect(connection.stop).toHaveBeenCalledOnce()
    expect(host.status()).toEqual({ online: false, connections: 0, closed: true })
  })

  it('未授权、错误标记、symlink 和弱权限在连接前拒绝，不初始化新身份', async () => {
    const fixture = await state()
    const create = vi.fn()
    const options = { stateDirectory: fixture.directory, serverUrl, logger, createConnection: create }
    await rm(join(fixture.directory, 'server-credentials.json'))
    const host = new PiWebHost(options); hosts.push(host)
    await expect(host.start()).rejects.toBeDefined()
    expect(create).not.toHaveBeenCalled()
    const marked = await state()
    await writeFile(join(marked.directory, 'pi-web-host.json'), '{"kind":"dsh"}')
    const invalid = new PiWebHost({ ...options, stateDirectory: marked.directory }); hosts.push(invalid)
    await expect(invalid.start()).rejects.toMatchObject({ code: 'INVALID_STATE_DIRECTORY' })
    const weak = await state()
    await chmod(join(weak.directory, 'device.key'), 0o644)
    const unsafe = new PiWebHost({ ...options, stateDirectory: weak.directory }); hosts.push(unsafe)
    await expect(unsafe.start()).rejects.toMatchObject({ code: 'INVALID_STATE_DIRECTORY' })
    const linked = await state()
    const key = join(linked.directory, 'device.key')
    await rm(key); await symlink(join(marked.directory, 'device.key'), key)
    const linkHost = new PiWebHost({ ...options, stateDirectory: linked.directory }); hosts.push(linkHost)
    await expect(linkHost.start()).rejects.toMatchObject({ code: 'INVALID_STATE_DIRECTORY' })
    expect(create).not.toHaveBeenCalled()
  })

  it('close 与初始化竞争时不会迟到启动控制连接', async () => {
    const fixture = await state()
    const create = vi.fn()
    const host = new PiWebHost({ stateDirectory: fixture.directory, serverUrl, logger, createConnection: create }); hosts.push(host)
    const starting = host.start()
    const rejected = expect(starting).rejects.toBeDefined()
    await host.close(); await rejected
    expect(create).not.toHaveBeenCalled()
  })

  it('禁注册策略在初次缺凭据及后续凭据过期时都不发注册请求', async () => {
    const fixture = await state()
    const fetch = vi.fn()
    await fixture.credentials.clear()
    const api = new HostServerApi(serverUrl, fixture.credentials, fetch, 'host', { allowRegistration: false, clientVersion: 'pi-web-host@source-0a0ac9a1' })
    await expect(api.authenticate(fixture.identity)).rejects.toMatchObject({ code: 'ACCOUNT_AUTH_REQUIRED' })
    await fixture.credentials.save({ serverUrl, deviceId: fixture.identity.deviceId, authorizationMethod: 'account',
      accessToken: 'fixture-access-token', accessTokenExpiresAt: Date.now() - 2000,
      refreshToken: 'fixture-refresh-token', refreshTokenExpiresAt: Date.now() - 1000,
    })
    const before = await readFile(join(fixture.directory, 'server-credentials.json'), 'utf8')
    await expect(api.authenticate(fixture.identity)).rejects.toMatchObject({ code: 'ACCOUNT_AUTH_REQUIRED' })
    expect(await readFile(join(fixture.directory, 'server-credentials.json'), 'utf8')).toBe(before)
    expect(fetch).not.toHaveBeenCalled()
    api.close()
  })
})

describe('共享认证连接层的最小 router 契约', () => {
  it('仍拒绝无 Noise/公钥信任；相同 peer 替换只关自己的流', async () => {
    const routers: PeerRpcRouter[] = []
    const controller = new ConnectionController({ isTrusted: (_id: string, key: string) => key === 'pinned' }, () => {
      const router = { handle: vi.fn(async () => createRpcResponse('request', {})), closePeerStreams: vi.fn(async () => undefined) }
      routers.push(router); return router
    }, logger)
    const first = channel('first'), other = channel('other', 'other-peer'), replacement = channel('replacement')
    const invalid = { ...channel('invalid'), peerIdentityKey: 'not-pinned' }
    await expect(controller.accept(invalid)).rejects.toMatchObject({ code: 'PEER_IDENTITY_MISMATCH' })
    const noNoise = { ...channel('plaintext'), security: undefined } as unknown as AuthenticatedPeerChannel
    await expect(controller.accept(noNoise)).rejects.toMatchObject({ code: 'SECURE_CHANNEL_FAILED' })
    await controller.accept(first); await controller.accept(other); await controller.accept(replacement)
    expect(first.close).toHaveBeenCalledWith('CONNECTION_REPLACED')
    expect(routers[0].closePeerStreams).toHaveBeenCalledOnce()
    expect(other.close).not.toHaveBeenCalled()
    await controller.revoke('peer')
    expect(replacement.close).toHaveBeenCalledWith('DEVICE_REVOKED')
    expect(other.close).not.toHaveBeenCalled()
    await controller.close()
  })
})
