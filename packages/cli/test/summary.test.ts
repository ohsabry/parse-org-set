import { describe, expect, test } from 'bun:test'

import type { Sample, SetFile } from '@parse-org-set/core'

import { formatDuration, formatSummary } from '../src/summary'

function sample(rootNote: number, frames: number, sampleRate: number): Sample {
  return {
    offset: 0,
    rootNote,
    name: `note ${rootNote}`,
    sampleRate,
    channels: 1,
    frames,
    loop: { mode: 0, start: 0, end: frames - 1 },
    audioOffset: 0,
    audioLength: frames * 2,
  }
}

const set: SetFile = {
  version: '1.3.1',
  trailerOffset: 0,
  instruments: [
    // 0.5 s + 0.25 s at 48 kHz
    {
      name: '-',
      headerOffset: 485,
      kind: undefined,
      envelope: undefined,
      samples: [sample(0, 24000, 48000), sample(1, 12000, 48000)],
    },
    // 3 × 20 s at 44.1 kHz = 60 s
    {
      name: 'نااااي',
      headerOffset: 0,
      kind: undefined,
      envelope: undefined,
      samples: [sample(48, 882000, 44100), sample(52, 882000, 44100), sample(55, 882000, 44100)],
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

describe('formatDuration', () => {
  test('picks a unit that suits the length', () => {
    expect(formatDuration(0.37)).toBe('0.4 s')
    expect(formatDuration(38.2)).toBe('38 s')
    expect(formatDuration(127)).toBe('2 min 7 s')
    expect(formatDuration(3725)).toBe('1 h 2 min')
  })
})
