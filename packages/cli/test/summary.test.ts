import { describe, expect, test } from 'bun:test'

import type { Sample, SetFile } from '@parse-org-set/core'

import { formatSummary } from '../src/summary'

function sample(rootNote: number, frames: number, sampleRate: number): Sample {
  return {
    offset: 0,
    rootNote,
    name: `note ${rootNote}`,
    sampleRate,
    channels: 1,
    frames,
    loop: { mode: 0, start: 0, end: frames - 1 },
    poolId: undefined,
    audioOffset: 0,
    audioLength: frames * 2,
  }
}

const set: SetFile = {
  fileType: 'set',
  version: '1.3.1',
  trailerOffset: 0,
  poolEntries: 0,
  instruments: [
    // 0.5 s + 0.25 s at 48 kHz
    {
      name: '-',
      headerOffset: 485,
      kind: undefined,
      envelope: undefined,
      samples: [sample(0, 24000, 48000), sample(1, 12000, 48000)],
      layers: [],
    },
    // 3 × 20 s at 44.1 kHz = 60 s
    {
      name: 'نااااي',
      headerOffset: 0,
      kind: undefined,
      envelope: undefined,
      samples: [sample(48, 882000, 44100), sample(52, 882000, 44100), sample(55, 882000, 44100)],
      layers: [],
    },
  ],
}

describe('formatSummary', () => {
  const lines = formatSummary('test.Set', set).split('\n')

  test('starts with the file name and totals', () => {
    expect(lines[0]).toBe('test.Set')
    // 0.75 s + 60 s = 60.75 s, which rounds to 1 min 1 s
    expect(lines[1]).toBe('Version 1.3.1 · 2 instruments · 5 samples · 1 min 1 s of audio')
  })

  test('one row per instrument, with the name last and the first one called Shots', () => {
    const [shots, oud] = lines.slice(4)
    expect(shots?.split(/\s{2,}/).map((cell) => cell.trim())).toEqual([
      '1',
      '2',
      'C-1–C#-1',
      'every semitone',
      '0.8 s',
      'Shots',
    ])
    expect(oud?.endsWith('نااااي')).toBe(true)
    expect(oud).toContain('C3–G3')
    expect(oud).toContain('every 3–4')
    expect(oud).toContain('1 min 0 s')
  })
})

test('counts layers in the samples, labels them, and mentions the sample pool', () => {
  const layered: SetFile = {
    ...set,
    poolEntries: 3,
    instruments: [
      {
        name: '-',
        headerOffset: 0,
        kind: undefined,
        envelope: undefined,
        samples: [sample(0, 48000, 48000)],
        layers: [{ name: 'Breath', headerOffset: 0, samples: [sample(1, 48000, 48000)] }],
      },
    ],
  }
  const lines = formatSummary('x.Set', layered).split('\n')
  expect(lines[1]).toBe(
    'Version 1.3.1 · 1 instrument · 2 samples · 2.0 s of audio · 3 shared sounds in the sample pool',
  )
  expect(lines[4]?.split(/\s{2,}/)[1]).toBe('2') // the main sample plus the layer's
  expect(lines[4]?.endsWith('Shots (+1 layer)')).toBe(true)
})
