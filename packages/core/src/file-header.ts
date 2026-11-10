import { OrgFormatError } from './errors/org-format-error'
import type { ByteReader } from './reader'
import type { PoolEntry } from './types'
import { startsWith } from './utils'

const SET_TITLE = 'music studio music'
const INSTRUMENT_TITLE = 'music studio instrument'
// Versions seen in real files: 1.10, 1.2.8, 1.3.0, 1.3.1 and 1.4.9.
const SUPPORTED = /^1\.(10|[234]\.\d+)$/

// After the version text come `ff ff` and 14 more bytes (not decoded), then a
// text field: a uint32 character count and the characters. Before 1.4 each
// character is one byte; from 1.4 on, two.
const VERSION_TO_TEXT_FIELD = 16
// From the end of that text field to the sample pool's entry count.
const TEXT_FIELD_TO_POOL = 134
// How far past the pool to look for the copy of the version text that ends the
// file header. In real files it's a few hundred bytes.
const MAX_SEARCH = 1 << 20

export interface FileHeader {
  fileType: 'set' | 'instrument'
  /** For example '1.3.1'. */
  version: string
  /** Where the first instrument header starts. */
  firstInstrumentOffset: number
  /** The number of instruments the file header says follow. */
  instrumentCount: number
  /** The sample pool: shared audio, by entry ID. Empty if the file has none. */
  pool: Map<number, PoolEntry>
}

/**
 * Reads the file header: title, version, the sample pool (if any), and where
 * the first instrument starts. Throws OrgFormatError if it isn't a .Set or
 * .Instrument file, or uses a version we don't support.
 *
 * An .Instrument file is a 32-byte title ("Music Studio Instrument") followed
 * directly by one instrument, exactly as it would appear inside a .Set. Its
 * version is in the instrument header's text ("Oud\r1.10\r").
 *
 * Layout (see docs/format.md):
 *   0   title, 32 bytes ("Music Studio music", any case)
 *   32  uint32 length, then the version text ("\r1.3.1\r" or "\r1.4.9")
 *   then ff ff and 14 bytes, a text field, 134 bytes, the sample pool,
 *   more settings, and finally the version text again, ff ff 00 00 and a
 *   uint32 instrument count, right before the first instrument header.
 */
export function readFileHeader(reader: ByteReader): FileHeader {
  if (reader.length < 36) {
    throw new OrgFormatError(
      `Too short to be a .Set or .Instrument file (${reader.length} bytes)`,
      0,
    )
  }
  reader.seek(0)
  const title = reader.utf8(32).toLowerCase()
  if (title !== SET_TITLE && title !== INSTRUMENT_TITLE) {
    throw new OrgFormatError(
      `Not a .Set or .Instrument file: it starts with ${JSON.stringify(title)}`,
      0,
    )
  }

  const textLength = reader.u32()
  // A .Set's version record is short; an instrument header also holds the name.
  const maxLength = title === SET_TITLE ? 64 : 1024
  if (textLength > maxLength || 36 + textLength > reader.length) {
    throw new OrgFormatError(`Text length ${textLength} at offset 32 doesn't make sense`, 32)
  }
  const text = reader.bytes(textLength)

  if (title === INSTRUMENT_TITLE) {
    // "Oud\r1.10\r": the version is what follows the name's \r.
    const version = new TextDecoder().decode(text).split('\r')[1] ?? ''
    checkVersion(version)
    return {
      fileType: 'instrument',
      version,
      firstInstrumentOffset: 32,
      instrumentCount: 1,
      pool: new Map(),
    }
  }

  const version = cleanVersion(text)
  checkVersion(version)

  // The text field: 1 byte per character before 1.4, 2 bytes from 1.4 on.
  const fieldAt = 36 + textLength + VERSION_TO_TEXT_FIELD
  if (fieldAt + 4 > reader.length) {
    throw new OrgFormatError('The file header is cut off', fieldAt)
  }
  reader.seek(fieldAt)
  const characters = reader.u32()
  const bytesPerCharacter = version.startsWith('1.4.') ? 2 : 1
  const poolAt = reader.offset + characters * bytesPerCharacter + TEXT_FIELD_TO_POOL
  if (characters > 4096 || poolAt + 4 > reader.length) {
    throw new OrgFormatError(`Text field length ${characters} doesn't make sense`, fieldAt)
  }
  reader.seek(poolAt)

  const pool = readPool(reader)
  const { firstInstrumentOffset, instrumentCount } = findInstruments(reader, textLength)
  return { fileType: 'set', version, firstInstrumentOffset, instrumentCount, pool }
}

function checkVersion(version: string): void {
  if (!SUPPORTED.test(version)) {
    throw new OrgFormatError(
      `Version ${JSON.stringify(version)} isn't supported (only 1.10 and 1.2.x to 1.4.x)`,
      36,
    )
  }
}

/** "\r1.3.1\r" → "1.3.1". */
function cleanVersion(text: Uint8Array): string {
  let version = ''
  for (const byte of text) {
    if (byte !== 0x0d) {
      version += String.fromCharCode(byte)
    }
  }
  return version
}

/**
 * The sample pool: a uint32 entry count, then for each entry a uint32 ID, a
 * uint32 size in bytes and that many bytes of 16-bit PCM. Samples can point
 * at an entry instead of carrying their own audio.
 *
 * The pool is only accepted if it checks out completely: IDs increasing,
 * sizes even and inside the file, and the uint32 100 right after it (as in
 * every real file). Some files hold other values at this spot (a 1.4.9 save
 * of a converted set has 105 and 213 there), so anything else counts as no
 * pool; samples that point into a missing pool are then reported as errors.
 * Leaves the reader after the pool, or where it started if there's none.
 */
function readPool(reader: ByteReader): Map<number, PoolEntry> {
  const countAt = reader.offset
  const pool = tryReadPool(reader)
  if (pool === undefined) {
    reader.seek(countAt)
    return new Map()
  }
  return pool
}

const AFTER_POOL = 100

function tryReadPool(reader: ByteReader): Map<number, PoolEntry> | undefined {
  const count = reader.u32()
  const pool = new Map<number, PoolEntry>()
  let previousId = -1
  for (let i = 0; i < count; i++) {
    if (reader.offset + 8 > reader.length) {
      return undefined
    }
    const id = reader.u32()
    const length = reader.u32()
    const offset = reader.offset
    if (id <= previousId || length === 0 || length % 2 !== 0 || offset + length > reader.length) {
      return undefined
    }
    pool.set(id, { id, offset, length })
    previousId = id
    reader.skip(length)
  }
  if (reader.offset + 4 > reader.length) {
    return undefined
  }
  const after = reader.offset
  const marker = reader.u32()
  reader.seek(after)
  return marker === AFTER_POOL ? pool : undefined
}

/**
 * The file header ends with the version text again (with its uint32 length),
 * ff ff 00 00, and a uint32 instrument count. The first instrument header
 * comes right after. Searches from the reader's position (just after the pool).
 */
function findInstruments(
  reader: ByteReader,
  textLength: number,
): { firstInstrumentOffset: number; instrumentCount: number } {
  const searchFrom = reader.offset
  reader.seek(32)
  const marker = new Uint8Array(4 + textLength + 4)
  marker.set(reader.bytes(4 + textLength))
  marker.set([0xff, 0xff, 0x00, 0x00], 4 + textLength)

  const found = indexOf(reader, marker, searchFrom, searchFrom + MAX_SEARCH)
  if (found === undefined || found + marker.length + 4 > reader.length) {
    throw new OrgFormatError("Couldn't find where the instruments start", searchFrom)
  }
  reader.seek(found + marker.length)
  const instrumentCount = reader.u32()
  return { firstInstrumentOffset: reader.offset, instrumentCount }
}

/** The first offset in [from, to] where `needle` occurs. */
function indexOf(
  reader: ByteReader,
  needle: Uint8Array,
  from: number,
  to: number,
): number | undefined {
  const last = Math.min(to, reader.length - needle.length)
  for (let offset = from; offset <= last; offset++) {
    reader.seek(offset)
    if (startsWith(reader.bytes(needle.length), needle)) {
      return offset
    }
  }
  return undefined
}
