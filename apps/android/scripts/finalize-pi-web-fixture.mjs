import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const app = resolve(root, '../.pi-web-remote-dev/android/build-src/apps/android')
const pkg = JSON.parse(await readFile(join(app, 'package.json'), 'utf8'))
const config = JSON.parse(await readFile(join(app, 'app.json'), 'utf8')).expo
if (pkg.main !== './fixture-entry.tsx' || config.android.package !== 'dev.piweb.remote.fixture'
  || !config.android.blockedPermissions.includes('android.permission.INTERNET')) throw new Error('Not the isolated offline fixture')
const path = join(app, 'android/app/build.gradle')
let gradle = await readFile(path, 'utf8')
const original = "            storeFile file('debug.keystore')\n            storePassword 'android'\n            keyAlias 'androiddebugkey'\n            keyPassword 'android'"
const replacement = "            storeFile file(System.getenv('PI_WEB_FIXTURE_KEYSTORE'))\n            storePassword System.getenv('PI_WEB_FIXTURE_STORE_PASSWORD')\n            keyAlias 'fixture'\n            keyPassword System.getenv('PI_WEB_FIXTURE_STORE_PASSWORD')"
if (gradle.includes(original)) gradle = gradle.replace(original, replacement)
else if (!gradle.includes(replacement)) throw new Error('Unexpected pinned template signing config')
if (!gradle.includes("applicationId 'dev.piweb.remote.fixture'")) throw new Error('Unexpected native application ID')
await writeFile(path, gradle)
console.log('Fixture native config verified; requires a new external signing key through environment only')
