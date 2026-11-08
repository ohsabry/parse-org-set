import { SetFormatError } from './errors/set-format-error'
import { readFileHeader } from './file-header'
import { readInstrumentSettings } from './instrument-settings'
import { ByteReader } from './reader'
import { SAMPLE_HEADER_LENGTH, readSample, sampleProblem } from './sample'
import type { Instrument, PoolEntry, Sample, SetFile } from './types'

/** One header and its samples, before layers are grouped under their instrument. */
interface Group {
  name: string
  headerOffset: number
  /** A header with only a name (no "\r" and version) is a layer of the instrument before it. */
  isLayer: boolean
  kind: Instrument['kind']
  envelope: Instrument['envelope']
  samples: Sample[]
}

/**
 * Parses a .Set file, versions 1.2.x to 1.4.x. Audio isn't copied: each
 * sample says where its audio is in `bytes`, either right after its header or
 * in the file's sample pool. Throws SetFormatError if the bytes don't fit.
 *
 * The file header says where the first instrument starts. From there the
 * file is walked header by header:
 * 1. A header starts with a uint32 length and the name text. The rest of it
 *    isn't decoded, so we scan forward to the first valid sample.
 * 2. If another instrument header sits before that sample, this one is empty
 *    (its sample count is 0) and the next one starts there.
 * 3. Otherwise the byte just before the sample is the number of samples that
 *    follow, and exactly that many are read.
 * 4. When no valid sample is left, the remaining bytes are the trailer.
 * Headers with only a name are layers, grouped under the instrument before.
 */
export function parseSet(bytes: Uint8Array): SetFile {
  const reader = new ByteReader(bytes)
  const { version, firstInstrumentOffset, pool } = readFileHeader(reader)
  // Instrument texts end with the version: "Oud\r1.3.1\r" or "Oud\r1.4.9".
  const ending = new TextEncoder().encode(
    version.startsWith('1.4.') ? `\r${version}` : `\r${version}\r`,
  )

  const groups: Group[] = []
  let at = firstInstrumentOffset
  for (;;) {
    const firstSample = findNextSample(reader, at, pool)
    if (firstSample === undefined) {
      const orphan = namedHeaderAt(reader, at)
      if (orphan !== undefined) {
        throw new SetFormatError(
          `Instrument ${JSON.stringify(orphan)} at ${at} has no samples after it; the file may be cut off`,
          at,
        )
      }
      break
    }
    const next = hiddenHeader(reader, at, firstSample, ending)
    groups.push(readGroup(reader, at, next ?? firstSample, next === undefined, pool, version))
    at = next ?? reader.offset
  }

  if (groups.length === 0) {
    throw new SetFormatError('No samples found', firstInstrumentOffset)
  }
  return {
    version,
    instruments: groupLayers(groups),
    poolEntries: pool.size,
    trailerOffset: at,
  }
}

/** The first offset at or after `from` where a valid sample starts. */
function findNextSample(
  reader: ByteReader,
  from: number,
  pool: ReadonlyMap<number, PoolEntry>,
): number | undefined {
  for (let offset = from; offset + SAMPLE_HEADER_LENGTH <= reader.length; offset++) {
    if (sampleProblem(reader, offset, pool) === undefined) {
      return offset
    }
  }
  return undefined
}

/**
 * The start of an instrument header hidden between the header at
 * `headerOffset` and `before`, which means the header at `headerOffset` has
 * no samples. A hidden header is a uint32 length and a name ending with the
 * version (`ending`), right after a sample count of 0.
 */
function hiddenHeader(
  reader: ByteReader,
  headerOffset: number,
  before: number,
  ending: Uint8Array,
): number | undefined {
  reader.seek(headerOffset)
  const searchFrom = headerOffset + 4 + reader.u32()
  for (let end = searchFrom + ending.length + 6; end <= before; end++) {
    if (!endsWith(reader, end, ending)) {
      continue
    }
    // Look back for a uint32 length whose text ends exactly here.
    const earliest = Math.max(searchFrom + 5, end - 256)
    for (let start = end - ending.length - 1; start >= earliest; start--) {
      reader.seek(start - 4)
      if (reader.u32() === end - start) {
        reader.seek(start - 5)
        return reader.u8() === 0 ? start - 4 : undefined
      }
    }
  }
  return undefined
}

function endsWith(reader: ByteReader, end: number, ending: Uint8Array): boolean {
  reader.seek(end - ending.length)
  const bytes = reader.bytes(ending.length)
  for (let i = 0; i < ending.length; i++) {
    if (bytes[i] !== ending[i]) {
      return false
    }
  }
  return true
}

/**
 * If `offset` holds what looks like an instrument header (a uint32 length,
 * then text with a name before the first \r), returns the name.
 *
 * Hypothesis, from real files: the trailer also starts with a length and
 * text, but its name is empty ("\r1.3.1\r"), so it isn't mistaken for one.
 */
function namedHeaderAt(reader: ByteReader, offset: number): string | undefined {
  if (offset + 4 > reader.length) {
    return undefined
  }
  reader.seek(offset)
  const textLength = reader.u32()
  if (textLength === 0 || textLength > 256 || reader.offset + textLength > reader.length) {
    return undefined
  }
  const [name, ...rest] = reader.utf8(textLength).split('\r')
  return name !== undefined && name !== '' && rest.length > 0 ? name : undefined
}

/**
 * Reads the header at `headerOffset`, which ends at `end` (just after its
 * sample count byte), and, if `hasSamples`, the samples that follow.
 */
function readGroup(
  reader: ByteReader,
  headerOffset: number,
  end: number,
  hasSamples: boolean,
  pool: ReadonlyMap<number, PoolEntry>,
  version: string,
): Group {
  reader.seek(headerOffset)
  const textLength = reader.u32()
  // The text, then at least the sample count byte, must fit in the header.
  if (headerOffset + 4 + textLength >= end) {
    throw new SetFormatError(
      `Instrument header at ${headerOffset} has a text length (${textLength}) that runs past its end at ${end}`,
      headerOffset,
    )
  }
  // "Name\r1.3.1\r": the name is everything before the first \r.
  const text = reader.utf8(textLength)
  const name = text.split('\r')[0] ?? ''
  const isLayer = !text.includes('\r')
  const { kind, envelope } = isLayer
    ? { kind: undefined, envelope: undefined }
    : readInstrumentSettings(reader, headerOffset + 4 + textLength, end, version)

  const samples: Sample[] = []
  if (!hasSamples) {
    reader.seek(end)
    return { name, headerOffset, isLayer, kind, envelope, samples }
  }

  reader.seek(end - 1)
  const count = reader.u8()
  for (let i = 0; i < count; i++) {
    try {
      samples.push(readSample(reader, pool))
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new SetFormatError(
        `Instrument ${JSON.stringify(name)} at ${headerOffset} says ${count} samples follow, but sample ${i + 1} doesn't fit: ${reason}`,
        reader.offset,
      )
    }
  }
  return { name, headerOffset, isLayer, kind, envelope, samples }
}

/** Puts each layer under the instrument before it. */
function groupLayers(groups: Group[]): Instrument[] {
  const instruments: Instrument[] = []
  for (const group of groups) {
    const owner = instruments.at(-1)
    if (group.isLayer && owner !== undefined) {
      owner.layers.push({
        name: group.name,
        headerOffset: group.headerOffset,
        samples: group.samples,
      })
      continue
    }
    instruments.push({
      name: group.name,
      headerOffset: group.headerOffset,
      kind: group.kind,
      envelope: group.envelope,
      samples: group.samples,
      layers: [],
    })
  }
  return instruments
}
