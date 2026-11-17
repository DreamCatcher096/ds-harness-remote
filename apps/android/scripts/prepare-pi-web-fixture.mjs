import { cp, mkdir, readFile, readdir, writeFile, symlink, lstat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// 只复制开发源码到固定的工作树外目录；不改原 main/app.json、锁文件或任何生产安装。
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const destination = resolve(root, '../.pi-web-remote-dev/android/build-src')
const workspace = ['protocol', 'crypto', 'webrtc', 'client-core']
const sourceOnly = source => {
  const relative = source.slice(root.length + 1)
  return !/(?:^|\/)(?:node_modules|android\/android|ios|\.expo|artifacts|\.git|\.env[^/]*)(?:\/|$)/.test(relative)
    && !/\.(?:jks|keystore|pem|key|p8|p12|mobileprovision)$/.test(relative)
}
await mkdir(destination, { recursive: true })
for (const file of ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', 'tsconfig.base.json', '.npmrc']) {
  await cp(join(root, file), join(destination, file))
}
const app = join(destination, 'apps/android')
await cp(join(root, 'apps/android'), app, {
  recursive: true,
  filter: sourceOnly,
})
for (const name of workspace) await cp(join(root, 'packages', name), join(destination, 'packages', name), {
  recursive: true, filter: sourceOnly,
})
const modules = join(destination, 'node_modules')
await mkdir(modules, { recursive: true })
for (const entry of await readdir(join(root, 'node_modules'))) {
  if (entry === '@dsh-remote' || entry.startsWith('.')) continue
  const target = join(modules, entry)
  if (!existsSync(target)) await symlink(join(root, 'node_modules', entry), target)
}
for (const base of [destination, app, ...workspace.map(name => join(destination, 'packages', name))]) {
  // hoisted 布局仍可能保留包内不同版本；必须复用原冻结解析，不能只链根依赖。
  const originalModules = join(root, relative(destination, base), 'node_modules')
  await mkdir(join(base, 'node_modules'), { recursive: true })
  if (existsSync(originalModules)) for (const entry of await readdir(originalModules)) {
    if (entry === '@dsh-remote' || entry.startsWith('.')) continue
    const target = join(base, 'node_modules', entry)
    if (!existsSync(target)) await symlink(join(originalModules, entry), target)
  }
  const scope = join(base, 'node_modules/@dsh-remote')
  await mkdir(scope, { recursive: true })
  for (const name of workspace) {
    const target = join(scope, name)
    try { await lstat(target) } catch { await symlink(join(destination, 'packages', name), target) }
  }
}
const manifest = JSON.parse(await readFile(join(app, 'package.json'), 'utf8'))
manifest.main = './fixture-entry.tsx'
await writeFile(join(app, 'package.json'), JSON.stringify(manifest, null, 2)+'\n')
const config = JSON.parse(await readFile(join(app, 'app.json'), 'utf8'))
config.expo.name = 'Pi Web Remote 测试'
config.expo.slug = 'pi-web-remote-fixture'
config.expo.scheme = 'piwebremote-fixture'
config.expo.android.package = 'dev.piweb.remote.fixture'
config.expo.android.allowBackup = false
config.expo.android.permissions = []
config.expo.android.blockedPermissions = [...new Set([
  ...config.expo.android.blockedPermissions, 'android.permission.INTERNET', 'android.permission.REQUEST_INSTALL_PACKAGES',
  'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE', 'android.permission.RECORD_AUDIO', 'android.permission.CAMERA',
])]
config.expo.plugins = config.expo.plugins.filter(plugin => plugin !== './plugins/with-remote-foreground-service').map(plugin =>
  Array.isArray(plugin) && plugin[0] === 'expo-build-properties'
    ? [plugin[0], { ...plugin[1], android: { ...plugin[1].android, usesCleartextTraffic: false } }] : plugin)
await writeFile(join(app, 'app.json'), JSON.stringify(config, null, 2)+'\n')
console.log('Prepared isolated fixture source: '+destination)
console.log('Entry=fixture-entry.tsx; applicationId=dev.piweb.remote.fixture; INTERNET blocked; original source config unchanged')
