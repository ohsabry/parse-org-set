import { SetFormatError } from './errors/set-format-error'
import { readFileHeader } from './file-header'
import { ByteReader } from './reader'
import { SAMPLE_HEADER_LENGTH, readSample, sampleProblem } from './sample'
import type { Instrument, Sample, SetFile } from './types'

// In every 1.3.x file seen, the file header ends here and the first
// instrument header (Shots) starts. Later versions move it.
const FIRST_INSTRUMENT_HEADER_OFFSET = 485

/**
 * Parses a 1.3.x .Set file. Audio isn't copied: each sample says where its
 * audio is in `bytes`. Throws SetFormatError if the bytes don't fit the format.
 *
 * The file is walked instrument by instrument:
 * 1. An instrument header starts with a uint32 length and the name text. The
 *    rest of it isn't decoded, so we scan forward to the first valid sample.
 * 2. The byte just before that sample is the number of samples that follow.
 * 3. Exactly that many samples are read, each starting right after the
 *    previous one's audio. The next instrument header starts after the last.
 * 4. When no valid sample is left, the remaining bytes are the trailer.
 */
export function parseSet(bytes: Uint8Array): SetFile {
  const reader = new ByteReader(bytes)
  const version = readFileHeader(reader)

  const instruments: Instrument[] = []
  let at = FIRST_INSTRUMENT_HEADER_OFFSET
  for (;;) {
    const firstSample = findNextSample(reader, at)
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
    instruments.push(readInstrument(reader, at, firstSample))
    at = reader.offset
  }

  if (instruments.length === 0) {
    throw new SetFormatError('No samples found', FIRST_INSTRUMENT_HEADER_OFFSET)
  }
  return { version, instruments, trailerOffset: at }
}

/** The first offset at or after `from` where a valid sample starts. */
function findNextSample(reader: ByteReader, from: number): number | undefined {
  for (let offset = from; offset + SAMPLE_HEADER_LENGTH <= reader.length; offset++) {
    if (sampleProblem(reader, offset) === undefined) {
      return offset
    }
  }
  return undefined
}

/**
 * If `offset` holds what looks like an instrument header (a uint32 length,
 * then text with a name before the first \r), returns the name.
 *
 * Hypothesis, from two real files: the trailer also starts with a length and
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

/** Reads the instrument header at `headerOffset` and the samples after it. */
function readInstrument(reader: ByteReader, headerOffset: number, firstSample: number): Instrument {
  reader.seek(headerOffset)
  const textLength = reader.u32()
  // The text, then at least the sample count byte, must fit before the first sample.
  if (headerOffset + 4 + textLength >= firstSample) {
    throw new SetFormatError(
      `Instrument header at ${headerOffset} has a text length (${textLength}) that runs past its first sample at ${firstSample}`,
      headerOffset,
    )
  }
  // "Name\r1.3.1\r": the name is everything before the first \r.
  const name = reader.utf8(textLength).split('\r')[0] ?? ''

  reader.seek(firstSample - 1)
  const count = reader.u8()

  const samples: Sample[] = []
  for (let i = 0; i < count; i++) {
    try {
      samples.push(readSample(reader))
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new SetFormatError(
        `Instrument ${JSON.stringify(name)} at ${headerOffset} says ${count} samples follow, but sample ${i + 1} doesn't fit: ${reason}`,
        reader.offset,
      )
    }
  }
  return { name, headerOffset, samples }
}
