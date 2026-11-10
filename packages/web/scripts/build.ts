/**
 * Builds the page into packages/web/dist, ready for GitHub Pages: bundles and
 * minifies it, builds the worker as its own file (worker.js, which Bun's HTML
 * bundling doesn't do), adds the Content-Security-Policy, and copies
 * robots.txt and sitemap.xml.
 *
 * The policy is added here, not written in index.html, because Bun's dev
 * server (`bun run web`) injects an inline script for live reloading, which
 * the policy would block.
 */
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Everything the page may load is its own files: no other sites, no inline
// code, and no network requests at all (connect-src 'none'), so a file you
// open can't be sent anywhere, even by a bug or a compromised dependency.
// Trusted Types make the browser refuse HTML-string injection (innerHTML and
// friends), the usual way cross-site scripting gets in.
const POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "worker-src 'self'",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "require-trusted-types-for 'script'",
  // The one Trusted Types policy allowed: main.ts's, which approves only worker.js.
  'trusted-types worker',
].join('; ')

const root = join(import.meta.dir, '..')
const out = join(root, 'dist')
rmSync(out, { recursive: true, force: true })

const builds = [
  await Bun.build({ entrypoints: [join(root, 'index.html')], outdir: out, minify: true }),
  // A fixed name, so main.ts can find it.
  await Bun.build({
    entrypoints: [join(root, 'src/worker.ts')],
    outdir: out,
    minify: true,
    naming: 'worker.js',
  }),
]
for (const result of builds) {
  if (!result.success) {
    for (const log of result.logs) {
      console.error(log)
    }
    process.exit(1)
  }
}

const htmlPath = join(out, 'index.html')
const html = readFileSync(htmlPath, 'utf8')
const charset = /<meta charset="utf-8"\s*\/?>/i
if (!charset.test(html)) {
  throw new Error("Couldn't find <meta charset> in the built page to put the policy after")
}
const meta = `<meta http-equiv="Content-Security-Policy" content="${POLICY}">`
writeFileSync(
  htmlPath,
  html.replace(charset, (tag) => `${tag}${meta}`),
)

cpSync(join(root, 'public'), out, { recursive: true })
console.log(`Built ${out}`)
