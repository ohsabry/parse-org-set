import { afterAll, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildSet } from '../../core/test/helpers/build-set'

// Runs the real command in a separate process, inside a temporary folder.
const main = join(import.meta.dir, '../src/main.ts')
const root = mkdtempSync(join(tmpdir(), 'parse-org-set-extract-'))
afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

let counter = 0
/** A fresh empty working folder holding "my pack.Set". */
function workspace(): string {
  const dir = join(root, String(counter++))
  mkdirSync(dir)
  const set = buildSet({
    instruments: [
      {
        name: '-',
        samples: [
          {
            name: 'Metronome Long',
            rootNote: 0,
            rate: 48000,
            channels: 1,
            audio: Int16Array.from([1000, -2, 3]),
          },
        ],
      },
      {
        name: 'Organ (Stereo)',
        samples: [
          {
            name: 'low',
            rootNote: 40,
            rate: 44100,
            channels: 2,
            audio: Int16Array.from([5, -5, 6, -6]),
          },
        ],
      },
    ],
  })
  writeFileSync(join(dir, 'my pack.Set'), set)
  return dir
}

function run(cwd: string, ...args: string[]): { code: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync({ cmd: [process.execPath, main, 'extract', ...args], cwd })
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

/** The 16-bit values stored after a WAV file's 44-byte header. */
function wavSamples(path: string): number[] {
  const bytes = readFileSync(path)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const values: number[] = []
  for (let offset = 44; offset < bytes.length; offset += 2) {
    values.push(view.getInt16(offset, true))
  }
  return values
}

describe('parse-org-set extract', () => {
  test('writes every sample as a WAV, with the audio unchanged, into <set name>_samples', () => {
    const dir = workspace()
    const { code, stdout, stderr } = run(dir, 'my pack.Set')
    expect(stderr).toBe('')
    expect(code).toBe(0)
    expect(stdout).toBe('Wrote 2 WAV files in 2 folders to my_pack_samples/\n')

    const out = join(dir, 'my_pack_samples')
    expect(readdirSync(out).sort()).toEqual(['01_Shots', '02_Organ_(Stereo)', 'index.json'])
    expect(wavSamples(join(out, '01_Shots/001_C-1_Metronome_Long.wav'))).toEqual([1000, -2, 3])
    expect(wavSamples(join(out, '02_Organ_(Stereo)/001_E2_low.wav'))).toEqual([5, -5, 6, -6])
  })

  test('index.json keeps the original names', () => {
    const dir = workspace()
    run(dir, 'my pack.Set')
    const index = JSON.parse(readFileSync(join(dir, 'my_pack_samples/index.json'), 'utf-8')) as {
      source: string
      instruments: { name: string; samples: { name: string; file: string }[] }[]
    }
    expect(index.source).toBe('my pack.Set')
    expect(index.instruments[1]?.name).toBe('Organ (Stereo)')
    expect(index.instruments[0]?.samples[0]).toMatchObject({
      name: 'Metronome Long',
      file: '001_C-1_Metronome_Long.wav',
    })
  })

  test('writes into a chosen folder, including one that exists but is empty', () => {
    const dir = workspace()
    mkdirSync(join(dir, 'chosen'))
    expect(run(dir, 'my pack.Set', 'chosen').code).toBe(0)
    expect(existsSync(join(dir, 'chosen/index.json'))).toBe(true)
  })

  test('refuses a folder that is not empty, and leaves it alone', () => {
    const dir = workspace()
    mkdirSync(join(dir, 'busy'))
    writeFileSync(join(dir, 'busy/keep.txt'), 'mine')
    const { code, stderr } = run(dir, 'my pack.Set', 'busy')
    expect(code).toBe(1)
    expect(stderr).toBe("busy already exists and isn't empty\n")
    expect(readdirSync(join(dir, 'busy'))).toEqual(['keep.txt'])
  })
})
