import { describe, expect, test } from 'bun:test'

import { buildSet, type FakeSample } from '@parse-org-set/test-fixtures'
import { readFileHeader } from '../src/file-header'
import { OrgFormatError } from '../src/index'
import { ByteReader } from '../src/reader'
import { FILE_STARTS } from './fixtures/real-bytes'

const tone = (name: string, rootNote: number, values: number[], poolId?: number): FakeSample => ({
  name,
  rootNote,
  rate: 44100,
  channels: 1,
  audio: Int16Array.from(values),
  ...(poolId === undefined ? {} : { poolId }),
})

/** The text of the instrument header at `offset`: a uint32 length, then the text. */
function headerText(bytes: Uint8Array, offset: number): string {
  const reader = new ByteReader(bytes)
  reader.seek(offset)
  return reader.utf8(reader.u32())
}

describe('readFileHeader', () => {
  test('a file without a pool: finds the first instrument header after the version copy', () => {
    const bytes = buildSet({
      instruments: [
        { name: '-', samples: [tone('a', 0, [1])] },
        { name: 'Oud', samples: [tone('b', 48, [2])] },
      ],
    })
    const header = readFileHeader(new ByteReader(bytes))
    expect(header.version).toBe('1.3.1')
    expect(headerText(bytes, header.firstInstrumentOffset)).toBe('-\r1.3.1\r')
    expect(header.instrumentCount).toBe(2)
    expect(header.pool.size).toBe(0)
  })

  test('accepts 1.2.x and 1.4.x, whose version texts differ ("\\r1.2.8\\r", "\\r1.4.9")', () => {
    for (const version of ['1.2.8', '1.3.0', '1.4.9']) {
      const bytes = buildSet({
        version,
        instruments: [{ name: '-', samples: [tone('a', 0, [1])] }],
      })
      expect(readFileHeader(new ByteReader(bytes)).version).toBe(version)
    }
  })

  test('reads the sample pool: each entry is where its audio is', () => {
    const bytes = buildSet({
      instruments: [
        {
          name: '-',
          samples: [tone('a', 0, [7, 8], 4), tone('b', 1, [9], 10), tone('c', 2, [7, 8], 4)],
        },
      ],
    })
    const { pool, firstInstrumentOffset } = readFileHeader(new ByteReader(bytes))
    expect([...pool.keys()]).toEqual([4, 10]) // samples a and c share entry 4
    const entry = pool.get(4)
    expect(entry?.length).toBe(4)
    const view = new DataView(bytes.buffer)
    expect(view.getInt16(entry?.offset ?? 0, true)).toBe(7)
    // The pool sits inside the file header; the instruments still start right after it.
    expect(headerText(bytes, firstInstrumentOffset)).toBe('-\r1.3.1\r')
  })

  test('rejects versions it has never seen', () => {
    const bytes = buildSet({
      version: '1.5.0',
      instruments: [{ name: '-', samples: [tone('a', 0, [1])] }],
    })
    expect(() => readFileHeader(new ByteReader(bytes))).toThrow(
      `Version "1.5.0" isn't supported (only 1.10 and 1.2.x to 1.4.x)`,
    )
  })

  test('a file header without the closing copy of the version', () => {
    const bytes = buildSet({ instruments: [{ name: '-', samples: [tone('a', 0, [1])] }] })
    bytes[470] = 0x21 // inside the copy of "\r1.3.1\r" at 466
    expect(() => readFileHeader(new ByteReader(bytes))).toThrow(
      "Couldn't find where the instruments start",
    )
  })
})

describe('readFileHeader on real file starts', () => {
  test('accepts the capitalised 1.4.9 title and version, then runs out of bytes', () => {
    // Only 48 real bytes: title and version are fine, the rest of the header is missing.
    expect(() => readFileHeader(new ByteReader(FILE_STARTS.v149))).toThrow(
      'The file header is cut off',
    )
  })
})

describe('readFileHeader on things that are not .Set files', () => {
  test('rejects a different title', () => {
    const png = new Uint8Array(64)
    png.set([0x89, 0x50, 0x4e, 0x47])
    expect(() => readFileHeader(new ByteReader(png))).toThrow('Not a .Set or .Instrument file')
  })

  test('rejects a file too short to hold a header', () => {
    expect(() => readFileHeader(new ByteReader(FILE_STARTS.v131.subarray(0, 20)))).toThrow(
      OrgFormatError,
    )
  })

  test('rejects a version length that runs past the end', () => {
    const bytes = FILE_STARTS.v131.slice(0, 40)
    expect(() => readFileHeader(new ByteReader(bytes))).toThrow(
      "Text length 7 at offset 32 doesn't",
    )
  })
})
