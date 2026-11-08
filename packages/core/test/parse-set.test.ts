import { describe, expect, test } from 'bun:test'

import { parseSet } from '../src/index'
import { buildSet, type FakeInstrument, type FakeSample } from './helpers/build-set'

const mono = (name: string, rootNote: number, frames: number): FakeSample => ({
  name,
  rootNote,
  rate: 44100,
  channels: 1,
  audio: new Int16Array(frames),
})

// Real settings blocks vary in size, so these do too.
const instruments: FakeInstrument[] = [
  { name: '-', samples: [mono('Metronome Long', 0, 10), mono('Metronome Short', 1, 7)] },
  {
    name: 'Oud',
    samples: [mono('oud 48', 48, 5), mono('oud 55', 55, 6), mono('oud 60', 60, 3)],
    settingsLength: 900,
  },
  { name: 'GENERAL', samples: [mono('36 Bass Drum', 36, 4)], settingsLength: 0 },
]

describe('parseSet', () => {
  test('walks every instrument, whatever the size of its undecoded settings', () => {
    const bytes = buildSet({ instruments })
    const set = parseSet(bytes)
    expect(set.version).toBe('1.3.1')
    expect(set.instruments.map((i) => i.name)).toEqual(['-', 'Oud', 'GENERAL'])
    const names: string[][] = []
    for (const instrument of set.instruments) {
      names.push(instrument.samples.map((s) => s.name))
    }
    expect(names).toEqual([
      ['Metronome Long', 'Metronome Short'],
      ['oud 48', 'oud 55', 'oud 60'],
      ['36 Bass Drum'],
    ])
    expect(set.trailerOffset).toBe(bytes.length)
  })

  test("each instrument header starts right after the previous instrument's audio", () => {
    const [shots, oud] = parseSet(buildSet({ instruments })).instruments
    const last = shots?.samples.at(-1)
    expect(last).toBeDefined()
    expect(oud?.headerOffset).toBe((last?.audioOffset ?? 0) + (last?.audioLength ?? 0))
  })

  test('a trailer that starts like a header with an empty name is not an instrument', () => {
    // The shape both real trailers start with: length 7, "\r1.3.1\r", ff ff.
    const start = [7, 0, 0, 0, ...new TextEncoder().encode('\r1.3.1\r'), 0xff, 0xff]
    const set = buildSet({ instruments })
    const parsed = parseSet(new Uint8Array([...set, ...start, ...new Uint8Array(200)]))
    expect(parsed.instruments).toHaveLength(3)
    expect(parsed.trailerOffset).toBe(set.length)
  })

  test('bytes after the last sample are the trailer', () => {
    const set = buildSet({ instruments })
    const withTrailer = new Uint8Array([...set, ...new Uint8Array(300).fill(0xab)])
    const parsed = parseSet(withTrailer)
    expect(parsed.instruments).toHaveLength(3)
    expect(parsed.trailerOffset).toBe(set.length)
  })
})

describe('instrument settings', () => {
  test('a header with only a name has no kind or envelope', () => {
    const set = parseSet(
      buildSet({
        instruments: [
          { name: '-', samples: [mono('click', 0, 4)] },
          { name: 'Sax Breath', samples: [mono('sax', 60, 4)], bare: true },
        ],
      }),
    )
    expect(set.instruments[1]?.name).toBe('Sax Breath')
    expect(set.instruments[1]?.kind).toBeUndefined()
    expect(set.instruments[1]?.envelope).toBeUndefined()
  })

  test('a header too short to hold the settings has no kind or envelope', () => {
    const set = parseSet(
      buildSet({ instruments: [{ name: '-', samples: [mono('click', 0, 4)], settingsLength: 0 }] }),
    )
    expect(set.instruments[0]?.kind).toBeUndefined()
    expect(set.instruments[0]?.envelope).toBeUndefined()
  })

  test('a type value never seen in real files gives undefined, not a guess', () => {
    const set = parseSet(
      buildSet({ instruments: [{ name: '-', samples: [mono('click', 0, 4)], kind: 7 }] }),
    )
    expect(set.instruments[0]?.kind).toBeUndefined()
    expect(set.instruments[0]?.envelope).toBeDefined()
  })
})

describe('parseSet on broken files', () => {
  /** The offset of the Shots header's sample-count byte: just before its first sample. */
  function shotsCountByte(bytes: Uint8Array): number {
    return (parseSet(bytes).instruments[0]?.samples[0]?.offset ?? 0) - 1
  }

  test('a header that promises more samples than follow', () => {
    const bytes = buildSet({ instruments: instruments.slice(0, 1) })
    bytes[shotsCountByte(bytes)] = 3
    expect(() => parseSet(bytes)).toThrow(
      'Instrument "-" at 485 says 3 samples follow, but sample 3',
    )
  })

  test('a header that promises fewer samples than follow', () => {
    const bytes = buildSet({ instruments: instruments.slice(0, 1) })
    bytes[shotsCountByte(bytes)] = 1
    // The second sample is then read as if it were an instrument header.
    expect(() => parseSet(bytes)).toThrow('runs past its first sample')
  })

  test('a file cut off in the middle of an instrument', () => {
    // Without GENERAL, the file ends with the Oud's third sample; cut into it.
    const bytes = buildSet({ instruments: instruments.slice(0, 2) })
    expect(() => parseSet(bytes.subarray(0, bytes.length - 1))).toThrow(
      /Instrument "Oud" at \d+ says 3 samples follow, but sample 3/,
    )
  })

  test('a file cut off inside the only sample of the last instrument', () => {
    // GENERAL's one sample no longer fits, so no valid sample follows its header.
    const bytes = buildSet({ instruments })
    expect(() => parseSet(bytes.subarray(0, bytes.length - 1))).toThrow('Instrument "GENERAL"')
  })

  test('a file header with no instruments after it', () => {
    expect(() => parseSet(buildSet({ instruments: [] }))).toThrow('No samples found')
  })
})
