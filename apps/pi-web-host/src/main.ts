import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SafeLogger } from '../../../packages/plugin/src/logging.js'
import { PiWebHost, HOST_IMPLEMENTATION } from './host.js'

export async function main(args: string[]): Promise<PiWebHost | undefined> {
  if (args.length === 1 && args[0] === '--help') {
    console.log(`${HOST_IMPLEMENTATION}\n仅接入已独立授权的 Host 状态；不初始化、登录或注册。\n--connect --state <绝对目录> --server <HTTPS origin>`)
    return
  }
  if (args.length !== 5 || args[0] !== '--connect' || args[1] !== '--state' || args[3] !== '--server') throw new Error('INVALID_ARGUMENTS')
  const host = new PiWebHost({ stateDirectory: args[2], serverUrl: args[4], logger: new SafeLogger(console) })
  const stop = () => { void host.close().catch(() => { process.exitCode = 1 }) }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try { await host.start(); return host }
  catch (error) { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); await host.close(); throw error }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main(process.argv.slice(2)).catch(() => { console.error('Pi Web Host 启动失败；检查独立状态与授权。'); process.exitCode = 1 })
}
