import { describe, expect, test } from 'bun:test'

import {
  buildInstrumentFile,
  buildSet,
  type FakeInstrument,
  type FakeSample,
} from '@parse-org-set/test-fixtures'
import { parseOrgFile, planExtraction } from '../src/index'

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

describe('parseOrgFile', () => {
  test('walks every instrument, whatever the size of its undecoded settings', () => {
    const bytes = buildSet({ instruments })
    const set = parseOrgFile(bytes)
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

  test('a trailer that starts like a header with an empty name is not an instrument', () => {
    // The shape both real trailers start with: length 7, "\r1.3.1\r", ff ff.
    const start = [7, 0, 0, 0, ...new TextEncoder().encode('\r1.3.1\r'), 0xff, 0xff]
    const set = buildSet({ instruments })
    const parsed = parseOrgFile(new Uint8Array([...set, ...start, ...new Uint8Array(200)]))
    expect(parsed.instruments).toHaveLength(3)
    expect(parsed.trailerOffset).toBe(set.length)
  })

  test('bytes after the last sample are the trailer', () => {
    const set = buildSet({ instruments })
    const withTrailer = new Uint8Array([...set, ...new Uint8Array(300).fill(0xab)])
    const parsed = parseOrgFile(withTrailer)
    expect(parsed.instruments).toHaveLength(3)
    expect(parsed.trailerOffset).toBe(set.length)
  })
})

describe('instrument settings', () => {
  test('a header with only a name is a layer of the instrument before it', () => {
    const set = parseOrgFile(
      buildSet({
        instruments: [
          { name: '-', samples: [mono('click', 0, 4)] },
          { name: 'Sax Breath', samples: [mono('sax', 60, 4)], bare: true },
        ],
      }),
    )
    expect(set.instruments).toHaveLength(1)
    expect(set.instruments[0]?.layers.map((layer) => layer.name)).toEqual(['Sax Breath'])
    expect(set.instruments[0]?.layers[0]?.samples[0]?.name).toBe('sax')
  })

  test('a header too short to hold the settings has no kind or envelope', () => {
    const set = parseOrgFile(
      buildSet({ instruments: [{ name: '-', samples: [mono('click', 0, 4)], settingsLength: 0 }] }),
    )
    expect(set.instruments[0]?.kind).toBeUndefined()
    expect(set.instruments[0]?.envelope).toBeUndefined()
  })

  test('reads the envelope, with sustain only from 1.4 on', () => {
    const header: FakeInstrument[] = [
      {
        name: '-',
        settingsLength: 133,
        samples: [mono('click', 0, 4)],
        envelope: { attack: 15, decay: 5, sustain: 90, release: 7, autoRelease: true },
      },
    ]
    expect(
      parseOrgFile(buildSet({ version: '1.3.1', instruments: header })).instruments[0]?.envelope,
    ).toEqual({
      attackMs: 1500,
      decayMs: 500,
      sustainPercent: undefined,
      releaseMs: 700,
      autoRelease: true,
    })
    expect(
      parseOrgFile(buildSet({ version: '1.4.9', instruments: header })).instruments[0]?.envelope,
    ).toEqual({
      attackMs: 1500,
      decayMs: 500,
      sustainPercent: 90,
      releaseMs: 700,
      autoRelease: true,
    })
  })

  test('a type value never seen in real files gives undefined, not a guess', () => {
    const set = parseOrgFile(
      buildSet({ instruments: [{ name: '-', samples: [mono('click', 0, 4)], kind: 7 }] }),
    )
    expect(set.instruments[0]?.kind).toBeUndefined()
    expect(set.instruments[0]?.envelope).toBeDefined()
  })
})

describe('sample pools, layers and empty instruments', () => {
  test('pooled and inline samples mix; pooled audio comes from the pool, shared where IDs match', () => {
    const pooled = (
      name: string,
      rootNote: number,
      values: number[],
      poolId: number,
    ): FakeSample => ({
      ...mono(name, rootNote, 0),
      audio: Int16Array.from(values),
      poolId,
    })
    const bytes = buildSet({
      version: '1.4.9',
      instruments: [
        {
          name: '-',
          samples: [pooled('a', 0, [11, 12], 3), mono('inline', 1, 2), pooled('c', 2, [11, 12], 3)],
        },
      ],
    })
    const set = parseOrgFile(bytes)
    const view = new DataView(bytes.buffer)
    const [a, inline, c] = set.instruments[0]?.samples ?? []
    expect(set.poolEntries).toBe(1)
    expect([a?.poolId, inline?.poolId, c?.poolId]).toEqual([3, undefined, 3])
    expect(view.getInt16(a?.audioOffset ?? 0, true)).toBe(11)
    expect(c?.audioOffset).toBe(a?.audioOffset) // the same pool entry
    // A pooled sample has no audio after its header, so the next one follows straight on.
    expect(inline?.offset).toBe((a?.offset ?? 0) + 97)
  })

  test('an empty instrument does not swallow the one after it', () => {
    const set = parseOrgFile(
      buildSet({
        instruments: [
          { name: '-', samples: [mono('click', 0, 4)] },
          { name: 'Empty', samples: [] },
          { name: 'Oud', samples: [mono('oud', 48, 4)] },
        ],
      }),
    )
    expect(set.instruments.map((i) => i.name)).toEqual(['-', 'Empty', 'Oud'])
    expect(set.instruments[1]?.samples).toEqual([])
    expect(set.instruments[2]?.samples[0]?.name).toBe('oud')
  })
})

describe('parseOrgFile on broken files', () => {
  /** The offset of the Shots header's sample-count byte: just before its first sample. */
  function shotsCountByte(bytes: Uint8Array): number {
    return (parseOrgFile(bytes).instruments[0]?.samples[0]?.offset ?? 0) - 1
  }

  test('a header that promises more samples than follow', () => {
    const bytes = buildSet({ instruments: instruments.slice(0, 1) })
    bytes[shotsCountByte(bytes)] = 3
    expect(() => parseOrgFile(bytes)).toThrow(
      /Instrument "-" at \d+ says 3 samples follow, but sample 3/,
    )
  })

  test('a header that promises fewer samples than follow', () => {
    const bytes = buildSet({ instruments: instruments.slice(0, 1) })
    bytes[shotsCountByte(bytes)] = 1
    // The second sample is then read as if it were an instrument header.
    expect(() => parseOrgFile(bytes)).toThrow('runs past its end')
  })

  test('a file cut off in the middle of an instrument', () => {
    // Without GENERAL, the file ends with the Oud's third sample; cut into it.
    const bytes = buildSet({ instruments: instruments.slice(0, 2) })
    expect(() => parseOrgFile(bytes.subarray(0, bytes.length - 1))).toThrow(
      /Instrument "Oud" at \d+ says 3 samples follow, but sample 3/,
    )
  })

  test('a file cut off inside the only sample of the last instrument', () => {
    // GENERAL's one sample no longer fits, so no valid sample follows its header.
    const bytes = buildSet({ instruments })
    expect(() => parseOrgFile(bytes.subarray(0, bytes.length - 1))).toThrow('Instrument "GENERAL"')
  })

  test('a file header with no instruments after it', () => {
    expect(() => parseOrgFile(buildSet({ instruments: [] }))).toThrow('No samples found')
  })
})

describe('parseOrgFile on 1.10 files', () => {
  test('walks a set whose samples use both 1.10 name styles', () => {
    const at = (rate: number, sample: FakeSample): FakeSample => ({ ...sample, rate })
    const set = parseOrgFile(
      buildSet({
        version: '1.10',
        instruments: [
          { name: '-', samples: [at(22050, { ...mono('Metronome', 0, 4), nameLeftovers: 'xx' })] },
          {
            name: 'Strings (Stereo)',
            samples: [
              at(48000, { ...mono('NewSample_0000', 40, 6), nameStyle: 'null-padded' }),
              at(16000, mono('STR E3', 52, 3)),
            ],
            settingsLength: 300,
          },
        ],
      }),
    )
    expect(set.version).toBe('1.10')
    const seen: string[] = []
    for (const instrument of set.instruments) {
      for (const sample of instrument.samples) {
        seen.push(`${instrument.name}: ${sample.name} ${sample.sampleRate} Hz ${sample.frames}`)
      }
    }
    expect(seen).toEqual([
      '-: Metronome 22050 Hz 4',
      'Strings (Stereo): NewSample_0000 48000 Hz 6',
      'Strings (Stereo): STR E3 16000 Hz 3',
    ])
  })
})

describe('parseOrgFile on .Instrument files', () => {
  const accordion: FakeInstrument = {
    name: 'Accordion A MT',
    samples: [
      { ...mono('AC1C4', 60, 5), nameLeftovers: '  ' },
      { ...mono('AC1E4', 64, 4), rate: 32000 },
    ],
    settingsLength: 133,
  }

  // Name leftovers only exist in 1.10, so other versions use these samples.
  const plain: FakeInstrument = {
    ...accordion,
    samples: [mono('AC1C4', 60, 5), mono('AC1E4', 64, 4)],
  }

  test('a 1.10 file holds one instrument and nothing after it', () => {
    const bytes = buildInstrumentFile(accordion, '1.10')
    const set = parseOrgFile(bytes)
    expect(set.fileType).toBe('instrument')
    expect(set.version).toBe('1.10')
    expect(set.instruments.map((i) => i.name)).toEqual(['Accordion A MT'])
    const seen: string[] = []
    for (const sample of set.instruments[0]?.samples ?? []) {
      seen.push(`${sample.name} ${sample.sampleRate}`)
    }
    expect(seen).toEqual(['AC1C4 44100', 'AC1E4 32000'])
    expect(set.trailerOffset).toBe(bytes.length)
  })

  test('a 1.2.8 file reads the same way, with later-style samples', () => {
    const set = parseOrgFile(buildInstrumentFile(plain, '1.2.8'))
    expect(set.version).toBe('1.2.8')
    expect(set.instruments[0]?.samples.map((s) => s.name)).toEqual(['AC1C4', 'AC1E4'])
  })

  test('its one instrument is extracted under its own name, not as Shots', () => {
    const plan = planExtraction(
      'Accordion A MT.Instrument',
      parseOrgFile(buildInstrumentFile(accordion)),
    )
    expect(plan.files.map((f) => f.path)).toEqual([
      '01_Accordion_A_MT/001_C4_AC1C4.wav',
      '01_Accordion_A_MT/002_E4_AC1E4.wav',
    ])
  })

  test('rejects an unsupported version', () => {
    expect(() => parseOrgFile(buildInstrumentFile(plain, '1.5.0'))).toThrow(
      `Version "1.5.0" isn't supported`,
    )
  })
})
