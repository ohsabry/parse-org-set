import { beforeAll, describe, expect, test } from 'bun:test'

import { readFileHeader } from '../src/file-header'
import { parseSet, planExtraction, type Sample, type SetFile } from '../src/index'
import { ByteReader } from '../src/reader'

// Optional smoke test against a real .Set file (1.10 or 1.2.x to 1.4.x), which can't be committed:
//
//   PARSE_ORG_SET_FILE=~/path/to/some.Set bun test
//
// Without the variable, it's skipped. Each check compares the parse with a part
// of the file the parser doesn't read, or with properties of the audio itself,
// so it can fail if our understanding of the format is wrong.
const path = process.env.PARSE_ORG_SET_FILE

let loaded: { bytes: Uint8Array; set: SetFile; samples: Sample[] } | undefined

function real(): { bytes: Uint8Array; set: SetFile; samples: Sample[] } {
  if (loaded === undefined) {
    throw new Error('The real file was not loaded')
  }
  return loaded
}

describe.skipIf(path === undefined)(`real file ${path ?? ''}`, () => {
  beforeAll(async () => {
    const bytes = await Bun.file(path ?? '').bytes()
    const set = parseSet(bytes)
    const samples: Sample[] = []
    for (const instrument of set.instruments) {
      samples.push(...instrument.samples)
      for (const layer of instrument.layers) {
        samples.push(...layer.samples)
      }
    }
    loaded = { bytes, set, samples }
  })

  test('the number of instruments matches the count in the file header', () => {
    // The app writes the count; the parser finds instruments by walking the file.
    const { bytes, set } = real()
    expect(set.instruments.length).toBe(readFileHeader(new ByteReader(bytes)).instrumentCount)
  })

  test('each instrument header lists the root notes of the samples that follow (1.3.x)', () => {
    // The parser takes each root note from its sample (R+0); a 1.3.x header keeps
    // its own list of the first 51, 5 bytes after its text. They must agree.
    // 1.2.x headers have no list there, and in 1.4.x it doesn't always match.
    const { bytes, set } = real()
    if (!set.version.startsWith('1.3.')) {
      return
    }
    const reader = new ByteReader(bytes)
    for (const instrument of set.instruments) {
      reader.seek(instrument.headerOffset)
      const text = reader.utf8(reader.u32())
      if (!text.includes('\r')) {
        continue // one real header has only a name, and no list
      }
      reader.skip(5)
      const roots = instrument.samples.slice(0, 51).map((s) => s.rootNote)
      const list = Array.from(reader.bytes(roots.length))
      expect({ instrument: instrument.name, list }).toEqual({
        instrument: instrument.name,
        list: roots,
      })
    }
  })

  test('audio starts right after 16 zero bytes, at the right byte', () => {
    // Bytes R+81 … R+96 are always zero in real files, so the audio can't
    // start earlier. And if it started one byte off, each 16-bit value would be
    // made of halves of two neighbours and jump around far more. Real files are
    // 4 to 19 times rougher read one byte late. This is checked over the whole
    // file, because single samples can go either way: noise and silence by
    // chance, and 8-bit audio stored as 16-bit (every low byte 0) always looks
    // smoother shifted, since its values shrink 256 times.
    const { bytes, samples } = real()
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const notZeroBefore: string[] = []
    let aligned = 0
    let shifted = 0
    for (const s of samples) {
      // Pooled audio sits after a pool entry's ID and size, not after a header.
      const afterHeader = s.poolId === undefined
      if (afterHeader && bytes.subarray(s.audioOffset - 16, s.audioOffset).some((b) => b !== 0)) {
        notZeroBefore.push(s.name)
      }
      aligned += roughness(view, s, 0)
      shifted += roughness(view, s, 1)
    }
    expect(notZeroBefore).toEqual([])
    expect(shifted).toBeGreaterThan(2 * aligned)
  })

  test('loop points lie inside each sample', () => {
    const outside: string[] = []
    for (const s of real().samples) {
      const endOutside = s.loop.end >= s.frames
      const backwards = s.loop.mode !== 0 && s.loop.start >= s.loop.end
      if (endOutside || backwards) {
        outside.push(`${s.name} at ${s.offset}`)
      }
    }
    expect(outside).toEqual([])
  })

  test('instrument types fit the names: Shots is a drum kit, "(Audio)" ones are audio', () => {
    // The names were written by the sound designer; the type byte by the app.
    const { set } = real()
    // .Instrument files have no Shots. In the one 1.10 set seen, Shots holds
    // only the metronome and is typed melodic.
    if (set.fileType === 'set' && set.version !== '1.10') {
      expect(set.instruments[0]?.kind).toBe('drum')
    }
    const notAudio: string[] = []
    for (const instrument of set.instruments) {
      if (instrument.name.includes('(Audio)') && instrument.kind !== 'audio') {
        notAudio.push(instrument.name)
      }
    }
    expect(notAudio).toEqual([])
  })

  test('envelope times are within what the app allows (0 to 10,000 ms, sustain 0 to 100%)', () => {
    const outside: string[] = []
    for (const instrument of real().set.instruments) {
      const e = instrument.envelope
      if (e === undefined) {
        continue
      }
      for (const ms of [e.attackMs, e.decayMs, e.releaseMs]) {
        if (ms > 10000) {
          outside.push(`${instrument.name}: ${ms} ms`)
        }
      }
      if (e.sustainPercent !== undefined && e.sustainPercent > 100) {
        outside.push(`${instrument.name}: sustain ${e.sustainPercent}%`)
      }
    }
    expect(outside).toEqual([])
  })

  test('in ascii mode every extracted path is plain ASCII, and still unique', () => {
    const { files } = planExtraction('real.Set', real().set, { ascii: true })
    const notAscii: string[] = []
    const seen = new Set<string>()
    for (const { path } of files) {
      if (!/^[\x20-\x7e]+$/.test(path)) {
        notAscii.push(path)
      }
      seen.add(path.toLowerCase())
    }
    expect(notAscii).toEqual([])
    expect(seen.size).toBe(files.length)
  })

  test('the trailer starts like a header with an empty name (hypothesis)', () => {
    const { bytes, set } = real()
    if (set.trailerOffset === bytes.length) {
      return // no trailer
    }
    const reader = new ByteReader(bytes)
    reader.seek(set.trailerOffset)
    expect(reader.utf8(reader.u32()).startsWith('\r')).toBe(true)
  })
})

/**
 * The sum of the jumps between neighbouring values of the first channel, over
 * up to 20,000 frames, reading the audio `shift` bytes after where it starts.
 */
function roughness(view: DataView, s: Sample, shift: number): number {
  if (s.frames < 2) {
    return 0
  }
  const stride = s.channels * 2
  // Stop a frame early so a shifted read never runs past the audio.
  const frames = Math.min(s.frames - 1, 20_000)
  let total = 0
  let previous = view.getInt16(s.audioOffset + shift, true)
  for (let i = 1; i < frames; i++) {
    const value = view.getInt16(s.audioOffset + shift + i * stride, true)
    total += Math.abs(value - previous)
    previous = value
  }
  return total
}
