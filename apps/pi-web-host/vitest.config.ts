import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: Object.fromEntries(['protocol', 'crypto', 'webrtc'].map(name => [
    `@dsh-remote/${name}`, fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url)),
  ])) },
  test: { include: ['apps/pi-web-host/tests/**/*.test.ts'], maxWorkers: 1, minWorkers: 1 },
})
