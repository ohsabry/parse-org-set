/**
 * `bun run fixtures <folder>`: writes the fake .Set and .Instrument files to
 * a folder, to try by hand in the CLI or the web page. (.gitignore keeps
 * .Set files out of git; pick a folder outside the repo anyway.)
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { fakeFiles } from './fake-sets'

const folder = process.argv[2]
if (folder === undefined) {
  console.error('Usage: bun run fixtures <folder>')
  process.exit(1)
}
mkdirSync(folder, { recursive: true })
for (const fake of fakeFiles()) {
  writeFileSync(join(folder, fake.name), fake.bytes)
  console.log(join(folder, fake.name))
}
