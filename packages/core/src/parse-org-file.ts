import { OrgFormatError } from './errors/org-format-error'
import { OutOfBoundsError } from './errors/out-of-bounds-error'
import { readFileHeader } from './file-header'
import { readInstrumentSettings } from './instrument-settings'
import { ByteReader } from './reader'
import {
  SAMPLE_HEADER_LENGTH,
  readSample,
  sampleLayout,
  sampleProblem,
  type SampleLayout,
} from './sample'
import type { Instrument, PoolEntry, Sample, OrgFile } from './types'
import { startsWith } from './utils'

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
 * Parses a .Set or .Instrument file, version 1.10 or 1.2.x to 1.4.x. Audio isn't copied: each
 * sample says where its audio is in `bytes`, either right after its header or
 * in the file's sample pool. Throws OrgFormatError if the bytes don't fit.
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
export function parseOrgFile(bytes: Uint8Array): OrgFile {
  try {
    return walk(new ByteReader(bytes))
  } catch (error) {
    // Every read is bounds-checked; one that runs off the end means the file
    // doesn't fit the format either, so callers only ever see OrgFormatError.
    if (error instanceof OutOfBoundsError) {
      throw new OrgFormatError(`The file ends too early: ${error.message}`, error.offset)
    }
    throw error
  }
}

function walk(reader: ByteReader): OrgFile {
  const { fileType, version, firstInstrumentOffset, pool } = readFileHeader(reader)
  // Instrument texts end with the version: "Oud\r1.3.1\r" or "Oud\r1.4.9".
  const ending = new TextEncoder().encode(
    version.startsWith('1.4.') ? `\r${version}` : `\r${version}\r`,
  )

  const layout = sampleLayout(version)
  const groups: Group[] = []
  let at = firstInstrumentOffset
  for (;;) {
    const firstSample = findNextSample(reader, at, pool, layout)
    if (firstSample === undefined) {
      const orphan = namedHeaderAt(reader, at)
      if (orphan !== undefined) {
        throw new OrgFormatError(
          `Instrument ${JSON.stringify(orphan)} at ${at} has no samples after it; the file may be cut off`,
          at,
        )
      }
      break
    }
    const next = hiddenHeader(reader, at, firstSample, ending)
    groups.push(
      readGroup(reader, at, next ?? firstSample, next === undefined, pool, version, layout),
    )
    at = next ?? reader.offset
  }

  if (groups.length === 0) {
    throw new OrgFormatError('No samples found', firstInstrumentOffset)
  }
  return {
    fileType,
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
  layout: SampleLayout,
): number | undefined {
  for (let offset = from; offset + SAMPLE_HEADER_LENGTH <= reader.length; offset++) {
    if (sampleProblem(reader, offset, pool, layout) === undefined) {
      return offset
    }
  }
  return undefined
}

// An instrument header starts with a uint32 length, then that many bytes of
// text. Real names are well under this; anything longer isn't a header.
const LENGTH_FIELD = 4
const MAX_TEXT_LENGTH = 256

/**
 * The start of an instrument header hidden between the header at
 * `headerOffset` and `before`, which means the header at `headerOffset` has
 * no samples. Right after its own text, the empty header ends with a sample
 * count of 0, so the bytes look like:
 *
 *   … [count = 0] [uint32 length] [name + ending] …
 *                 ^ returned       ^ start         ^ end
 *
 * where `ending` is the version text ("\r1.3.1\r") and the name is at least
 * one byte.
 */
function hiddenHeader(
  reader: ByteReader,
  headerOffset: number,
  before: number,
  ending: Uint8Array,
): number | undefined {
  reader.seek(headerOffset)
  const ownTextEnd = headerOffset + LENGTH_FIELD + reader.u32()
  // The earliest the hidden text can start: after the count byte and length.
  const firstStart = ownTextEnd + 1 + LENGTH_FIELD
  const shortestText = 1 + ending.length

  for (let end = firstStart + shortestText; end <= before; end++) {
    reader.seek(end - ending.length)
    if (!startsWith(reader.bytes(ending.length), ending)) {
      continue
    }
    // Look back for a uint32 length whose text ends exactly here.
    const earliest = Math.max(firstStart, end - MAX_TEXT_LENGTH)
    for (let start = end - shortestText; start >= earliest; start--) {
      reader.seek(start - LENGTH_FIELD)
      if (reader.u32() !== end - start) {
        continue
      }
      reader.seek(start - LENGTH_FIELD - 1)
      if (reader.u8() === 0) {
        return start - LENGTH_FIELD
      }
    }
  }
  return undefined
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
  if (
    textLength === 0 ||
    textLength > MAX_TEXT_LENGTH ||
    reader.offset + textLength > reader.length
  ) {
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
  layout: SampleLayout,
): Group {
  reader.seek(headerOffset)
  const textLength = reader.u32()
  // The text, then at least the sample count byte, must fit in the header.
  if (headerOffset + 4 + textLength >= end) {
    throw new OrgFormatError(
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
      samples.push(readSample(reader, pool, layout))
    } catch (error) {
      // A sample that doesn't fit gets context; anything else is a bug.
      if (!(error instanceof OrgFormatError || error instanceof OutOfBoundsError)) {
        throw error
      }
      const reason = error.message
      throw new OrgFormatError(
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
