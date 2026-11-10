/**
 * `bun run web`: serves the page at http://localhost:3000 with live reload.
 * Bun's dev server bundles the page itself; the worker is a separate file
 * (as in scripts/build.ts), so it's built fresh on each request.
 */
import { join } from 'node:path'

import page from '../index.html'

const worker = join(import.meta.dir, '../src/worker.ts')

const server = Bun.serve({
  // Only this computer can reach it, not others on the same network.
  hostname: '127.0.0.1',
  port: 3000,
  development: true,
  routes: {
    '/': page,
    '/worker.js': async () => {
      const result = await Bun.build({ entrypoints: [worker] })
      const [output] = result.outputs
      if (!result.success || output === undefined) {
        return new Response(result.logs.join('\n'), { status: 500 })
      }
      return new Response(await output.text(), {
        headers: { 'content-type': 'text/javascript; charset=utf-8' },
      })
    },
  },
})
console.log(`Serving the page at ${server.url}`)
