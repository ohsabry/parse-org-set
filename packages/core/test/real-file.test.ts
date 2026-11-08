import { beforeAll, describe, expect, test } from 'bun:test'

import { ByteReader, parseSet, type Sample, type SetFile } from '../src/index'

// Optional smoke test against a real 1.3.x .Set file, which can't be committed:
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

const median = (values: number[]): number =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0

describe.skipIf(path === undefined)(`real file ${path ?? ''}`, () => {
  beforeAll(async () => {
    const bytes = await Bun.file(path ?? '').bytes()
    const set = parseSet(bytes)
    loaded = { bytes, set, samples: set.instruments.flatMap((i) => i.samples) }
  })

  test('each instrument header lists the root notes of the samples that follow', () => {
    // The parser takes each root note from its sample (R+0); the header keeps
    // its own list of the first 51, 5 bytes after its text. They must agree.
    const { bytes, set } = real()
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

  test('audio starts right after 16 zero bytes, and starts smoothly', () => {
    // Bytes R+81 … R+96 are always zero in real 1.3.x files, so the audio can't
    // start earlier. And if it started at the wrong byte, pairs of bytes would
    // be split across samples and neighbouring values would jump wildly: real
    // audio moves in small steps (a median of 5 to 7 out of ±32,768).
    const { bytes, samples } = real()
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const notZeroBefore = samples.filter((s) =>
      bytes.subarray(s.audioOffset - 16, s.audioOffset).some((b) => b !== 0),
    )
    expect(notZeroBefore.map((s) => s.name)).toEqual([])
    const firstSteps = samples
      .filter((s) => s.channels === 1 && s.frames >= 2)
      .map((s) =>
        Math.abs(view.getInt16(s.audioOffset, true) - view.getInt16(s.audioOffset + 2, true)),
      )
    expect(median(firstSteps)).toBeLessThan(1000)
  })

  test('loop points lie inside each sample', () => {
    const outside = real().samples.filter(
      (s) => s.loop.end >= s.frames || (s.loop.mode !== 0 && s.loop.start >= s.loop.end),
    )
    expect(outside.map((s) => `${s.name} at ${s.offset}`)).toEqual([])
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
