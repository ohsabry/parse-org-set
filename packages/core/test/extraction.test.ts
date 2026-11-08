import { describe, expect, test } from 'bun:test'

import {
  defaultOutputFolder,
  planExtraction,
  safeName,
  type Sample,
  type SetFile,
} from '../src/index'

describe('safeName', () => {
  test('spaces become single underscores, and the ends are trimmed', () => {
    expect(safeName('Metronome Long')).toBe('Metronome_Long')
    expect(safeName('⭕ الطبلاااااه ⭕')).toBe('⭕_الطبلاااااه_⭕')
    expect(safeName('A#5             ')).toBe('A#5') // a real name with trailing spaces
    expect(safeName('  two   spaces  ')).toBe('two_spaces')
  })

  test('drops characters that file systems reject', () => {
    expect(safeName('AC/DC: "Live"?')).toBe('ACDC_Live')
    expect(safeName('a\\b*c<d>e|f')).toBe('abcdef')
    expect(safeName('tab\there\u0000')).toBe('tab_here')
  })

  test('trims dots from the ends but keeps them inside', () => {
    expect(safeName('Take.2')).toBe('Take.2')
    expect(safeName('.hidden.')).toBe('hidden')
  })

  test('keeps Arabic, emoji and a cut-off character', () => {
    expect(safeName('نااااي�')).toBe('نااااي�')
    expect(safeName('🎵♦️NAY ♦️🎵')).toBe('🎵♦️NAY_♦️🎵')
  })

  test('long names are cut to 120 bytes, never in the middle of a character', () => {
    // A real drum kit is named with a long list of program numbers.
    const programs = '120,000,077 '.repeat(40)
    expect(new TextEncoder().encode(safeName(programs)).length).toBeLessThanOrEqual(120)
    const arabic = safeName('ع'.repeat(100)) // 2 bytes per letter
    expect(arabic).toBe('ع'.repeat(60))
  })

  test('nothing left means "unnamed"', () => {
    expect(safeName('')).toBe('unnamed')
    expect(safeName(' / ')).toBe('unnamed')
    expect(safeName('...')).toBe('unnamed')
  })
})

test('ascii mode: every path is plain ASCII', () => {
  const arabic: SetFile = {
    version: '1.3.1',
    trailerOffset: 0,
    poolEntries: 0,
    instruments: [
      {
        name: '-',
        headerOffset: 0,
        kind: 'drum',
        envelope: undefined,
        samples: [sample('قانون🔥', 60, 10)],
        layers: [],
      },
      {
        name: '❌الناي',
        headerOffset: 0,
        kind: 'melodic',
        envelope: undefined,
        samples: [sample('🌀', 62, 10)],
        layers: [],
      },
    ],
  }
  const paths = planExtraction('x.Set', arabic, { ascii: true }).files.map((f) => f.path)
  expect(paths).toEqual(['01_Shots/001_C4_qanon.wav', '02_alnai/001_D4_unnamed.wav'])
  expect(defaultOutputFolder('سيت الأصوات2023.Set', { ascii: true })).toBe(
    'sit_alasoat2023_samples',
  )
})

test('defaultOutputFolder', () => {
  expect(defaultOutputFolder('سيت الأصوات2023.Set')).toBe('سيت_الأصوات2023_samples')
  expect(defaultOutputFolder('pack.set')).toBe('pack_samples')
  expect(defaultOutputFolder('no extension')).toBe('no_extension_samples')
})

function sample(name: string, rootNote: number, frames: number): Sample {
  return {
    offset: 0,
    rootNote,
    name,
    sampleRate: 48000,
    channels: 1,
    frames,
    loop: { mode: 0, start: 0, end: frames - 1 },
    poolId: undefined,
    audioOffset: 0,
    audioLength: frames * 2,
  }
}

const set: SetFile = {
  version: '1.3.1',
  trailerOffset: 0,
  poolEntries: 0,
  instruments: [
    {
      name: '-',
      headerOffset: 485,
      kind: undefined,
      envelope: undefined,
      samples: [sample('Metronome Long', 0, 24000)],
      layers: [],
    },
    {
      name: 'Organ (Stereo)',
      headerOffset: 0,
      kind: undefined,
      envelope: undefined,
      // Two samples with the same name and root note.
      samples: [sample('-', 60, 4800), sample('-', 60, 4800), sample('A#5   ', 82, 100)],
      layers: [],
    },
  ],
}

describe('planExtraction', () => {
  const { files, index } = planExtraction('pack.Set', set)

  test('numbered folders (the first is Shots) and numbered files with the note', () => {
    expect(files.map((f) => f.path)).toEqual([
      '01_Shots/001_C-1_Metronome_Long.wav',
      '02_Organ_(Stereo)/001_C4_-.wav',
      '02_Organ_(Stereo)/002_C4_-.wav',
      '02_Organ_(Stereo)/003_A#5_A#5.wav',
    ])
  })

  test('the index keeps the original names exactly', () => {
    expect(index.source).toBe('pack.Set')
    expect(index.instruments[0]?.name).toBe('-')
    expect(index.instruments[1]?.name).toBe('Organ (Stereo)')
    expect(index.instruments[1]?.samples[2]?.name).toBe('A#5   ')
    expect(index.instruments[1]?.samples[2]?.file).toBe('003_A#5_A#5.wav')
  })

  test('the index works out seconds and note names', () => {
    const metronome = index.instruments[0]?.samples[0]
    expect(metronome?.seconds).toBe(0.5) // 24,000 frames at 48 kHz
    expect(metronome?.note).toBe('C-1')
  })

  test('numbers get wider when there are more than 99 instruments', () => {
    const many: SetFile = { ...set, instruments: [] }
    for (let i = 0; i < 120; i++) {
      many.instruments.push({
        name: `i${i}`,
        headerOffset: 0,
        kind: undefined,
        envelope: undefined,
        samples: [sample('s', 60, 10)],
        layers: [],
      })
    }
    const paths = planExtraction('x.Set', many).files.map((f) => f.path)
    expect(paths[0]).toBe('001_Shots/001_C4_s.wav')
    expect(paths[119]).toBe('120_i119/001_C4_s.wav')
  })
})
