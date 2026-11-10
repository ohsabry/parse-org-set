import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseOrgFile, planExtraction, type ExtractionPlan } from '@parse-org-set/core'
import { buildSet, type FakeSample } from '@parse-org-set/test-fixtures'
import { unzipSync } from 'fflate'

import { zipExtraction, zipSize } from '../src/zip'

const tone = (name: string, rootNote: number, channels: 1 | 2, values: number[]): FakeSample => ({
  name,
  rootNote,
  rate: channels === 1 ? 44100 : 22050,
  channels,
  audio: Int16Array.from(values),
})

const bytes = buildSet({
  instruments: [
    { name: '-', samples: [tone('Metronome', 0, 1, [1, -2, 3])] },
    { name: 'Empty', samples: [] },
    { name: 'إسترينج 🎼', samples: [tone('MS000001', 52, 2, [100, -100, 200, -200])] },
  ],
})
const set = parseOrgFile(bytes)
const plan = planExtraction('x.Set', set)
const folder = 'x_samples'

const dir = mkdtempSync(join(tmpdir(), 'parse-org-set-zip-'))
const zipPath = join(dir, 'x.zip')
const zip = new Uint8Array(Buffer.concat(zipExtraction(bytes, plan, folder)))
writeFileSync(zipPath, zip)
afterAll(() => rmSync(dir, { recursive: true, force: true }))

// Two checks. Info-ZIP's unzip (on macOS and Ubuntu) validates the zip's
// structure and every CRC by a standard tool's rules. fflate's reader, a
// separate code path from its writer, reads names and contents back. It decodes
// a name as UTF-8 only when the zip says so (flag bit 11), so Arabic names
// coming back intact proves the flag. (Apple's unzip can't be used for names:
// it's a 2009 build without Unicode support.)
function unzip(...args: string[]): { code: number; out: Uint8Array } {
  const result = Bun.spawnSync(['unzip', ...args, zipPath])
  return { code: result.exitCode, out: new Uint8Array(result.stdout) }
}

const entries = unzipSync(zip)

/** One file's contents. */
function unzipFile(name: string): Uint8Array {
  const file = entries[name]
  if (file === undefined) {
    throw new Error(`${name} isn't in the zip`)
  }
  return file
}

describe('zipExtraction', () => {
  test('makes a zip that unzip checks without errors', () => {
    const { code, out } = unzip('-t')
    expect(code).toBe(0)
    expect(new TextDecoder().decode(out)).toContain('No errors detected')
  })

  test('holds every folder (the empty one too), WAV file and index.json, with Arabic names intact', () => {
    const names = Object.keys(entries)
    expect(names).toEqual([
      'x_samples/01_Shots/',
      'x_samples/02_Empty/',
      'x_samples/03_إسترينج_🎼/',
      'x_samples/01_Shots/001_C-1_Metronome.wav',
      'x_samples/03_إسترينج_🎼/001_E3_MS000001.wav',
      'x_samples/index.json',
    ])
  })

  test('each WAV is a header for its sample, then exactly its audio bytes', () => {
    for (const { path, sample } of plan.files) {
      const wav = unzipFile(`${folder}/${path}`)
      const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
      expect(view.getUint32(24, true)).toBe(sample.sampleRate)
      expect(view.getUint16(22, true)).toBe(sample.channels)
      expect(view.getUint32(40, true)).toBe(sample.audioLength)
      const audio = bytes.subarray(sample.audioOffset, sample.audioOffset + sample.audioLength)
      expect(Array.from(wav.subarray(44))).toEqual(Array.from(audio))
    }
  })

  test('index.json matches the plan', () => {
    const json = new TextDecoder().decode(unzipFile(`${folder}/index.json`))
    expect(JSON.parse(json)).toEqual(JSON.parse(JSON.stringify(plan.index)))
  })

  test('marks non-ASCII names as UTF-8 (flag bit 11), so unzip tools decode them right', () => {
    // Each entry starts with a local header: "PK\x03\x04", then the flags at
    // +6, the name's length at +26 and the name itself at +30.
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
    const flags = new Map<string, number>()
    for (let at = 0; at + 30 <= zip.length; at++) {
      if (view.getUint32(at, true) === 0x04034b50) {
        const name = new TextDecoder().decode(
          zip.subarray(at + 30, at + 30 + view.getUint16(at + 26, true)),
        )
        flags.set(name, view.getUint16(at + 6, true))
      }
    }
    expect((flags.get('x_samples/03_إسترينج_🎼/001_E3_MS000001.wav') ?? 0) & 0x800).toBe(0x800)
    expect((flags.get('x_samples/01_Shots/001_C-1_Metronome.wav') ?? 0x800) & 0x800).toBe(0)
  })

  test('zipSize says exactly how big the zip is, and how many entries it holds', () => {
    expect(zipSize(plan, folder)).toEqual({
      entries: Object.keys(entries).length,
      bytes: zip.length,
    })
  })

  test('refuses, with a clear error, more files than a plain zip can hold', () => {
    const first = plan.files[0]
    if (first === undefined) {
      throw new Error('The test set has no files')
    }
    const huge: ExtractionPlan = { ...plan, files: Array.from({ length: 70_000 }, () => first) }
    expect(() => zipExtraction(bytes, huge, folder)).toThrow(
      'A zip holds at most 65,535 files and 4 GB.',
    )
  })
})
