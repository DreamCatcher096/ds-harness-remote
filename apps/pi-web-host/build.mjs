import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire, isBuiltin } from 'node:module'
import { fileURLToPath } from 'node:url'
const { build } = createRequire(new URL('../../packages/plugin/package.json', import.meta.url))('esbuild')

const root = fileURLToPath(new URL('../../', import.meta.url))
const result = await build({
  absWorkingDir: root, entryPoints: ['apps/pi-web-host/src/main.ts'],
  tsconfig: 'apps/pi-web-host/tsconfig.json', bundle: true, platform: 'node', format: 'esm',
  outfile: 'apps/pi-web-host/dist/host.mjs', metafile: true, write: false,
  external: ['@roamhq/wrtc'],
  banner: { js: 'import { createRequire as hostCreateRequire } from "node:module"; const require = hostCreateRequire(import.meta.url);' },
})
const forbidden = Object.keys(result.metafile.inputs).filter(path => /packages\/plugin\/src\/(?:service\.|index\.|acp\/|codex\/)/.test(path))
if (forbidden.length) throw new Error('Host bundle includes a forbidden execution backend')
const external = Object.values(result.metafile.outputs).flatMap(output => output.imports)
  .filter(item => item.external && !isBuiltin(item.path) && item.path !== '@roamhq/wrtc')
if (external.length) throw new Error('Host bundle has an unreviewed runtime dependency')
await mkdir(new URL('./dist/', import.meta.url), { recursive: true })
for (const file of result.outputFiles) await writeFile(file.path, file.contents)
await writeFile(new URL('./dist/graph.json', import.meta.url), JSON.stringify(result.metafile, null, 2))
console.log(`Pi Web Host bundle: ${Object.keys(result.metafile.inputs).length} source modules; no ACP/Codex/service entry`)
