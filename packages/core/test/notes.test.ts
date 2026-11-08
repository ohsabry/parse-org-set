import { describe, expect, test } from 'bun:test'

import { describeSpacing, noteLabel, noteName } from '../src/index'

describe('noteName', () => {
  test('follows the MIDI convention where 60 is middle C', () => {
    expect(noteName(60)).toBe('C4')
    expect(noteName(61)).toBe('C#4')
    expect(noteName(69)).toBe('A4') // concert A, 440 Hz
    expect(noteName(0)).toBe('C-1')
    expect(noteName(127)).toBe('G9')
  })

  test('rejects numbers that are not MIDI notes', () => {
    expect(() => noteName(128)).toThrow(RangeError)
    expect(() => noteName(-1)).toThrow(RangeError)
    expect(() => noteName(1.5)).toThrow(RangeError)
  })
})

test('noteLabel names real MIDI notes and labels impossible ones instead of throwing', () => {
  expect(noteLabel(60)).toBe('C4')
  expect(noteLabel(200)).toBe('note200') // a root-note byte can hold up to 255
})

describe('describeSpacing', () => {
  test('one sample per semitone', () => {
    const areed = Array.from({ length: 36 }, (_, i) => 36 + i) // C2–B4
    expect(describeSpacing(areed)).toBe('every semitone')
  })

  test('equal steps', () => {
    expect(describeSpacing([48, 60, 72])).toBe('every 12')
  })

  test('a step that makes up more than half of them is "mostly"', () => {
    // Steps 4 3 4 3 4 4 4 4 3 3 4 3 4: eight 4s out of 13.
    expect(describeSpacing([41, 45, 48, 52, 55, 59, 63, 67, 71, 74, 77, 81, 84, 88])).toBe(
      'mostly every 4 (3–4)',
    )
    // Like a real drum kit: C1 D1 E1, then every semitone.
    const kit = [24, 26, 28, ...Array.from({ length: 20 }, (_, i) => 29 + i)]
    expect(describeSpacing(kit)).toBe('mostly every semitone (1–2)')
  })

  test('no step makes up more than half', () => {
    // The real Finger Bass: steps 10 8 7 6 10 24. The 10s are only 2 of 6.
    expect(describeSpacing([23, 33, 41, 48, 54, 64, 88])).toBe('every 6–24')
    // Two steps of different sizes: each is exactly half.
    expect(describeSpacing([48, 52, 55])).toBe('every 3–4')
  })

  test('order does not matter', () => {
    expect(describeSpacing([60, 48, 72])).toBe('every 12')
  })

  test('single notes and repeats', () => {
    expect(describeSpacing([60])).toBe('one sample')
    expect(describeSpacing([60, 60])).toBe('one note, 1 repeat')
    expect(describeSpacing([36, 36, 37, 37, 38])).toBe('every semitone, 2 repeats')
    expect(describeSpacing([])).toBe('no samples')
  })
})
