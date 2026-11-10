import { describe, expect, test } from 'bun:test'

import { buildSample, type FakeSample } from '@parse-org-set/test-fixtures'
import { OrgFormatError } from '../src/index'
import { ByteReader } from '../src/reader'
import { readSample, sampleProblem } from '../src/sample'
import { SAMPLE_HEADERS } from './fixtures/real-bytes'

/** Real sample header bytes, then silent audio of the given size. */
function withAudio(header: Uint8Array, audioLength: number): Uint8Array {
  const bytes = new Uint8Array(header.length + audioLength)
  bytes.set(header)
  return bytes
}

describe('readSample on real sample headers', () => {
  test('Metronome Long: mono, 48 kHz, no loop', () => {
    const bytes = withAudio(SAMPLE_HEADERS.metronomeLong, 17800 * 2)
    const reader = new ByteReader(bytes)
    expect(readSample(reader)).toEqual({
      offset: 0,
      rootNote: 0,
      name: 'Metronome Long',
      sampleRate: 48000,
      channels: 1,
      frames: 17800,
      loop: { mode: 0, start: 0, end: 17799 },
      poolId: undefined,
      audioOffset: 97,
      audioLength: 35600,
    })
    expect(reader.offset).toBe(bytes.length)
  })

  test('Kel: stereo audio is twice as long per frame', () => {
    const sample = readSample(new ByteReader(withAudio(SAMPLE_HEADERS.kel, 114980 * 4)))
    expect(sample.channels).toBe(2)
    expect(sample.rootNote).toBe(28)
    expect(sample.sampleRate).toBe(44100)
    expect(sample.audioLength).toBe(459920)
  })

  test('XP-F#2: a pooled sample, its audio in the pool entry R+41 − 1 names', () => {
    // In the real file, R+41 is 2636 and the audio is pool entry 2635 (179,274 bytes).
    const header = SAMPLE_HEADERS.xpFSharp2
    const pool = new Map([[2635, { id: 2635, offset: 5000, length: 89637 * 2 }]])
    const reader = new ByteReader(withAudio(header, 6000 + 89637 * 2))
    const sample = readSample(reader, pool)
    expect(sample.poolId).toBe(2635)
    expect(sample.audioOffset).toBe(5000)
    expect(sample.loop).toEqual({ mode: 2, start: 69090, end: 89636 })
    // The audio isn't after the header, so the next sample starts right after it.
    expect(reader.offset).toBe(97)
  })

  test('a pooled sample whose pool entry is missing or the wrong size', () => {
    const reader = new ByteReader(withAudio(SAMPLE_HEADERS.xpFSharp2, 0))
    expect(sampleProblem(reader, 0)).toBe(
      "its audio is in sample pool entry 2635, which doesn't exist",
    )
    const wrongSize = new Map([[2635, { id: 2635, offset: 0, length: 100 }]])
    expect(sampleProblem(reader, 0, wrongSize)).toBe(
      'sample pool entry 2635 holds 100 bytes, but 89637 frames need 179274',
    )
  })

  test('a 152,174 Hz sample takes its rate from R+37, not the truncated R+33', () => {
    const sample = readSample(new ByteReader(withAudio(SAMPLE_HEADERS.highRate, 17800 * 2)))
    expect(sample.sampleRate).toBe(152174)
  })

  test('leaves the reader at the next sample', () => {
    const first = withAudio(SAMPLE_HEADERS.metronomeLong, 17800 * 2)
    const second = withAudio(SAMPLE_HEADERS.highRate, 17800 * 2)
    const reader = new ByteReader(new Uint8Array([...first, ...second]))
    readSample(reader)
    const next = readSample(reader)
    expect(next.offset).toBe(first.length)
    expect(next.sampleRate).toBe(152174)
  })
})

describe('sampleProblem', () => {
  test('explains why bytes are not a sample', () => {
    const header = SAMPLE_HEADERS.metronomeLong
    expect(sampleProblem(new ByteReader(new Uint8Array(200)), 0)).toBe('byte R+1 is 0x0, not 0x20')
    expect(sampleProblem(new ByteReader(header), 0)).toBe(
      'its audio (17800 frames) runs past the end of the file',
    )
    const badRate = withAudio(header, 17800 * 2)
    // R+33 holds 80 BB (48000). Changing its low byte gives 44 BB = 0xBB44 = 47940.
    badRate[33] = 0x44
    expect(sampleProblem(new ByteReader(badRate), 0)).toBe(
      'the two sample-rate fields disagree (47940 and 48000)',
    )
    expect(sampleProblem(new ByteReader(header), 10)).toBe(
      'not enough bytes left for a sample header',
    )
  })

  test('does not move the reader', () => {
    const reader = new ByteReader(withAudio(SAMPLE_HEADERS.metronomeLong, 17800 * 2))
    reader.seek(5)
    expect(sampleProblem(reader, 0)).toBeUndefined()
    expect(reader.offset).toBe(5)
  })

  test('readSample throws OrgFormatError with the offset and the reason', () => {
    const reader = new ByteReader(new Uint8Array(300))
    reader.seek(100)
    expect(() => readSample(reader)).toThrow(OrgFormatError)
    expect(() => readSample(reader)).toThrow('No valid sample at offset 100: byte R+1')
  })
})

describe('1.10 samples', () => {
  const noPool = new Map()
  const sample = (fields: Partial<FakeSample>): FakeSample => ({
    name: 'MS000003',
    rootNote: 66,
    rate: 16000,
    channels: 1,
    audio: new Int16Array(5),
    ...fields,
  })

  test('the name is as long as R+1 says; bytes after it are leftovers', () => {
    // Like a real 1.10 sample: R+1 is 8 and the field goes on with spaces.
    const bytes = buildSample(sample({ nameLeftovers: '        ' }), '1.10')
    const read = readSample(new ByteReader(bytes), noPool, 'v1.10')
    expect(read.name).toBe('MS000003')
    expect(read.sampleRate).toBe(16000)
    expect(read.frames).toBe(5)
    expect(read.audioOffset).toBe(97)
  })

  test('R+1 = 0x20 means a null-padded name, as in later versions', () => {
    const bytes = buildSample(sample({ name: 'NewSample_0000', nameStyle: 'null-padded' }), '1.10')
    expect(readSample(new ByteReader(bytes), noPool, 'v1.10').name).toBe('NewSample_0000')
  })

  test("each layout rejects the other's samples", () => {
    const old = new ByteReader(buildSample(sample({}), '1.10'))
    expect(sampleProblem(old, 0)).toBe('byte R+1 is 0x8, not 0x20')
    const padded = new ByteReader(buildSample(sample({ nameStyle: 'null-padded' }), '1.10'))
    expect(sampleProblem(padded, 0)).toBe('the two sample-rate fields disagree (16000 and 0)')
    const modern = new ByteReader(buildSample(sample({}), '1.3.1'))
    expect(sampleProblem(modern, 0, noPool, 'v1.10')).toBe('R+37 is 16000, not 0 as in 1.10')
  })
})
