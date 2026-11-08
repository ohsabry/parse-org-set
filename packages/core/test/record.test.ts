import { describe, expect, test } from 'bun:test'

import { ByteReader, SetFormatError } from '../src/index'
import { readRecord, recordProblem } from '../src/record'
import { RECORD_HEADERS } from './fixtures/real-bytes'

/** Real record header bytes, then silent audio of the given size. */
function withAudio(header: Uint8Array, audioLength: number): Uint8Array {
  const bytes = new Uint8Array(header.length + audioLength)
  bytes.set(header)
  return bytes
}

describe('readRecord on real record headers', () => {
  test('Metronome Long: mono, 48 kHz, no loop', () => {
    const bytes = withAudio(RECORD_HEADERS.metronomeLong, 17800 * 2)
    const reader = new ByteReader(bytes)
    expect(readRecord(reader)).toEqual({
      offset: 0,
      rootNote: 0,
      name: 'Metronome Long',
      sampleRate: 48000,
      channels: 1,
      frames: 17800,
      loop: { mode: 0, start: 0, end: 17799 },
      audioOffset: 97,
      audioLength: 35600,
    })
    expect(reader.offset).toBe(bytes.length)
  })

  test('Kel: stereo audio is twice as long per frame', () => {
    const record = readRecord(new ByteReader(withAudio(RECORD_HEADERS.kel, 114980 * 4)))
    expect(record.channels).toBe(2)
    expect(record.rootNote).toBe(28)
    expect(record.sampleRate).toBe(44100)
    expect(record.audioLength).toBe(459920)
  })

  test('XP-F#2: loop points', () => {
    const record = readRecord(new ByteReader(withAudio(RECORD_HEADERS.xpFSharp2, 89637 * 2)))
    expect(record.loop).toEqual({ mode: 2, start: 69090, end: 89636 })
  })

  test('a 152,174 Hz record takes its rate from R+37, not the truncated R+33', () => {
    const record = readRecord(new ByteReader(withAudio(RECORD_HEADERS.highRate, 17800 * 2)))
    expect(record.sampleRate).toBe(152174)
  })

  test('leaves the reader at the next record', () => {
    const first = withAudio(RECORD_HEADERS.metronomeLong, 17800 * 2)
    const second = withAudio(RECORD_HEADERS.highRate, 17800 * 2)
    const reader = new ByteReader(new Uint8Array([...first, ...second]))
    readRecord(reader)
    const next = readRecord(reader)
    expect(next.offset).toBe(first.length)
    expect(next.sampleRate).toBe(152174)
  })
})

describe('recordProblem', () => {
  test('explains why bytes are not a record', () => {
    const header = RECORD_HEADERS.metronomeLong
    expect(recordProblem(new ByteReader(new Uint8Array(200)), 0)).toBe('byte R+1 is 0x0, not 0x20')
    expect(recordProblem(new ByteReader(header), 0)).toBe(
      'its audio (17800 frames) runs past the end of the file',
    )
    const badRate = withAudio(header, 17800 * 2)
    // R+33 holds 80 BB (48000). Changing its low byte gives 44 BB = 0xBB44 = 47940.
    badRate[33] = 0x44
    expect(recordProblem(new ByteReader(badRate), 0)).toBe(
      'the two sample-rate fields disagree (47940 and 48000)',
    )
    expect(recordProblem(new ByteReader(header), 10)).toBe(
      'not enough bytes left for a record header',
    )
  })

  test('does not move the reader', () => {
    const reader = new ByteReader(withAudio(RECORD_HEADERS.metronomeLong, 17800 * 2))
    reader.seek(5)
    expect(recordProblem(reader, 0)).toBeUndefined()
    expect(reader.offset).toBe(5)
  })

  test('readRecord throws SetFormatError with the offset and the reason', () => {
    const reader = new ByteReader(new Uint8Array(300))
    reader.seek(100)
    expect(() => readRecord(reader)).toThrow(SetFormatError)
    expect(() => readRecord(reader)).toThrow('No valid sample record at offset 100: byte R+1')
  })
})
