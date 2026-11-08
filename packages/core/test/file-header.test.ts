import { describe, expect, test } from 'bun:test'

import { readFileHeader } from '../src/file-header'
import { ByteReader, SetFormatError } from '../src/index'
import { FILE_STARTS } from './fixtures/real-bytes'

describe('readFileHeader on real file starts', () => {
  test('reads the version of a 1.3.1 file', () => {
    expect(readFileHeader(new ByteReader(FILE_STARTS.v131))).toBe('1.3.1')
  })

  test('accepts the capitalised 1.4.9 title, then rejects the version', () => {
    // The error is about the version, so "Music Studio Music" passed the title check.
    expect(() => readFileHeader(new ByteReader(FILE_STARTS.v149))).toThrow(
      `Version "1.4.9" isn't supported yet (only 1.3.x)`,
    )
  })
})

describe('readFileHeader on things that are not .Set files', () => {
  test('rejects a different title', () => {
    const png = new Uint8Array(64)
    png.set([0x89, 0x50, 0x4e, 0x47])
    expect(() => readFileHeader(new ByteReader(png))).toThrow('Not a .Set file')
  })

  test('rejects a file too short to hold a header', () => {
    expect(() => readFileHeader(new ByteReader(FILE_STARTS.v131.subarray(0, 20)))).toThrow(
      SetFormatError,
    )
  })

  test('rejects a version length that runs past the end', () => {
    const bytes = FILE_STARTS.v131.slice(0, 40)
    expect(() => readFileHeader(new ByteReader(bytes))).toThrow("Version text length 7 doesn't")
  })
})
