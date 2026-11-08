import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FILE_STARTS } from '../../core/test/fixtures/real-bytes'
import { buildSet } from '../../core/test/helpers/build-set'

// Runs the real command in a separate process, the way a user would.
const main = join(import.meta.dir, '../src/main.ts')
const dir = mkdtempSync(join(tmpdir(), 'parse-org-set-'))
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

function run(...args: string[]): { code: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync({ cmd: [process.execPath, main, ...args] })
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

function writeTemp(name: string, bytes: Uint8Array): string {
  const path = join(dir, name)
  writeFileSync(path, bytes)
  return path
}

describe('parse-org-set inspect', () => {
  test('prints the summary of a .Set file', () => {
    const tone = { rate: 48000, channels: 1 as const, audio: new Int16Array(48000) }
    const path = writeTemp(
      'test.Set',
      buildSet({
        instruments: [
          { name: '-', samples: [{ name: 'click', rootNote: 0, ...tone }] },
          { name: 'Oud', samples: [{ name: 'oud', rootNote: 48, ...tone }] },
        ],
      }),
    )
    const { code, stdout, stderr } = run('inspect', path)
    expect(stderr).toBe('')
    expect(code).toBe(0)
    expect(stdout).toContain('test.Set\nVersion 1.3.1 · 2 instruments · 2 samples · 2.0 s of audio')
    expect(stdout).toContain('Shots')
    expect(stdout).toContain('Oud')
  })

  test('a missing file', () => {
    const { code, stderr } = run('inspect', join(dir, 'nope.Set'))
    expect(code).toBe(1)
    expect(stderr).toContain('No such file')
  })

  test('a file that is not a .Set', () => {
    const { code, stderr } = run('inspect', writeTemp('photo.Set', new Uint8Array(100).fill(7)))
    expect(code).toBe(1)
    expect(stderr).toContain('Not a .Set file')
  })

  test('a version that is not supported yet', () => {
    const { code, stderr } = run('inspect', writeTemp('new.Set', FILE_STARTS.v149))
    expect(code).toBe(1)
    expect(stderr).toContain(`Version "1.4.9" isn't supported yet`)
  })

  test('wrong arguments print the usage', () => {
    for (const args of [[], ['inspect'], ['extract', 'x.Set'], ['inspect', 'a.Set', 'b.Set']]) {
      const { code, stderr } = run(...args)
      expect(code).toBe(1)
      expect(stderr).toContain('Usage: parse-org-set inspect <file.Set>')
    }
  })
})
