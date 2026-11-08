import { describe, expect, test } from 'bun:test'

import { OutOfBoundsError } from '../src/errors/out-of-bounds-error'
import { ByteReader } from '../src/reader'

const from = (...values: number[]): Uint8Array => new Uint8Array(values)

/** Text encoded as UTF-8 into a fixed-width field, padded with nulls. */
function field(text: string, width: number): Uint8Array {
  const out = new Uint8Array(width)
  out.set(new TextEncoder().encode(text).subarray(0, width))
  return out
}

describe('numbers', () => {
  test('u8 reads one byte', () => {
    const reader = new ByteReader(from(0x10, 0x02))
    expect(reader.u8()).toBe(16)
    expect(reader.u8()).toBe(2)
    expect(reader.offset).toBe(2)
  })

  test('u16 is little-endian: 80 BB is 48000', () => {
    expect(new ByteReader(from(0x80, 0xbb)).u16()).toBe(48000)
  })

  test('u32 is little-endian: 44 AC 00 00 is 44100', () => {
    expect(new ByteReader(from(0x44, 0xac, 0x00, 0x00)).u32()).toBe(44100)
  })

  test('u32 reads the largest value as positive, not -1', () => {
    expect(new ByteReader(from(0xff, 0xff, 0xff, 0xff)).u32()).toBe(4294967295)
  })

  test('reads follow on from each other', () => {
    const reader = new ByteReader(from(0x01, 0x34, 0x12, 0x78, 0x56, 0x34, 0x12))
    expect(reader.u8()).toBe(0x01)
    expect(reader.u16()).toBe(0x1234)
    expect(reader.u32()).toBe(0x12345678)
    expect(reader.offset).toBe(7)
  })
})

describe('position', () => {
  test('seek jumps and skip moves forward', () => {
    const reader = new ByteReader(from(0, 0, 0, 7, 0, 9))
    reader.seek(3)
    expect(reader.u8()).toBe(7)
    reader.skip(1)
    expect(reader.u8()).toBe(9)
  })

  test('seeking to the end is allowed, past it is not', () => {
    const reader = new ByteReader(from(1, 2, 3))
    reader.seek(3)
    expect(reader.offset).toBe(3)
    expect(() => reader.seek(4)).toThrow('Offset 4 is outside the data (3 bytes long)')
    expect(() => reader.seek(-1)).toThrow(OutOfBoundsError)
  })
})

describe('bounds', () => {
  test('reading exactly up to the last byte works', () => {
    const reader = new ByteReader(from(1, 2, 3, 4))
    expect(reader.u32()).toBe(0x04030201)
    expect(reader.offset).toBe(4)
  })

  test('reading past the end throws a clear error', () => {
    const reader = new ByteReader(from(1, 2, 3))
    reader.skip(1)
    expect(() => reader.u32()).toThrow(OutOfBoundsError)
    expect(() => reader.u32()).toThrow('Wanted 4 bytes at offset 1, but the data is 3 bytes long')
  })

  test('a failed read leaves the position where it was', () => {
    const reader = new ByteReader(from(1, 2, 3))
    reader.skip(2)
    expect(() => reader.u16()).toThrow(OutOfBoundsError)
    expect(reader.offset).toBe(2)
    expect(reader.u8()).toBe(3)
  })

  test('bad counts are rejected', () => {
    const reader = new ByteReader(from(1, 2, 3))
    expect(() => reader.skip(-1)).toThrow(OutOfBoundsError)
    expect(() => reader.bytes(1.5)).toThrow(OutOfBoundsError)
  })
})

describe('bytes', () => {
  test('returns a view onto the same memory, not a copy', () => {
    const data = from(1, 2, 3, 4)
    const view = new ByteReader(data).bytes(2)
    data[0] = 99
    expect(Array.from(view)).toEqual([99, 2])
  })

  test('works when the data is a window onto a larger buffer', () => {
    // Only bytes 2 and 3 (80 BB) belong to the window.
    const window = from(0xaa, 0xbb, 0x80, 0xbb, 0xcc).subarray(2, 4)
    const reader = new ByteReader(window)
    expect(reader.length).toBe(2)
    expect(reader.u16()).toBe(48000)
    expect(() => reader.u8()).toThrow(OutOfBoundsError)
  })
})

describe('utf8', () => {
  test('stops at the first null but always advances the full width', () => {
    const reader = new ByteReader(new Uint8Array([...field('Metronome', 31), 0x2a]))
    expect(reader.utf8(31)).toBe('Metronome')
    expect(reader.offset).toBe(31)
    expect(reader.u8()).toBe(0x2a)
  })

  test('decodes Arabic and emoji', () => {
    expect(new ByteReader(field('كمنجه🔥', 31)).utf8(31)).toBe('كمنجه🔥')
  })

  test('a name that fills the whole field has no null', () => {
    expect(new ByteReader(field('A'.repeat(31), 31)).utf8(31)).toBe('A'.repeat(31))
  })

  test('a character cut in half by the width becomes �', () => {
    // "عود" is 6 bytes (2 per letter); a 5-byte field cuts the last letter.
    expect(new ByteReader(field('عود', 5)).utf8(5)).toBe('عو�')
  })
})
