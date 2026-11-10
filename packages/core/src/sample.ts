import { OrgFormatError } from './errors/org-format-error'
import type { ByteReader } from './reader'
import type { PoolEntry, Sample } from './types'

/** Every sample starts with a 97-byte header. */
export const SAMPLE_HEADER_LENGTH = 97

// Real files use 22,050 to 152,174 Hz. These limits are deliberately wide;
// they only exist to reject bytes that clearly aren't a sample.
const MIN_SAMPLE_RATE = 4000
const MAX_SAMPLE_RATE = 400_000

const NO_POOL: ReadonlyMap<number, PoolEntry> = new Map()

const NAME_FIELD_LENGTH = 31
// R+1 in 1.2.x and later. In 1.10 it's the name's length, or this value for a
// null-padded name.
const NAME_MARK = 0x20

/**
 * How sample headers are written. 'v1.10': R+1 is the name's length (or 0x20)
 * and only the 16-bit rate at R+33 is filled in (R+37 is 0). 'modern'
 * (1.2.x to 1.4.x): R+1 is always 0x20 and R+37 holds the full rate.
 */
export type SampleLayout = 'v1.10' | 'modern'

export function sampleLayout(version: string): SampleLayout {
  return version === '1.10' ? 'v1.10' : 'modern'
}

/**
 * Where a sample's audio is. R+41 holds 0 when the audio follows the header,
 * or N when the audio is the sample pool entry with ID N − 1.
 */
interface AudioLocation {
  sampleRate: number
  /** How many bytes of the name field hold the name; the rest is padding or leftovers. */
  nameLength: number
  poolId: number | undefined
  audioOffset: number
  /** Where the next sample or instrument header starts. */
  next: number
}

/**
 * Says why the bytes at `offset` aren't a valid sample, or returns
 * undefined if they are. Leaves the reader's position unchanged.
 */
export function sampleProblem(
  reader: ByteReader,
  offset: number,
  pool: ReadonlyMap<number, PoolEntry> = NO_POOL,
  layout: SampleLayout = 'modern',
): string | undefined {
  const located = locate(reader, offset, pool, layout)
  return typeof located === 'string' ? located : undefined
}

/**
 * Reads the sample at the reader's position and leaves the reader where the
 * next sample or instrument header starts: after the audio, or straight
 * after the header if the audio is in the sample pool.
 */
export function readSample(
  reader: ByteReader,
  pool: ReadonlyMap<number, PoolEntry> = NO_POOL,
  layout: SampleLayout = 'modern',
): Sample {
  const offset = reader.offset
  const located = locate(reader, offset, pool, layout)
  if (typeof located === 'string') {
    throw new OrgFormatError(`No valid sample at offset ${offset}: ${located}`, offset)
  }

  const rootNote = reader.u8() // R+0
  reader.skip(1) // R+1: name mark (checked)
  const name = reader.utf8(located.nameLength) // R+2
  reader.seek(offset + 36)
  const channels = reader.u8() === 1 ? 1 : 2 // R+36 (checked)
  const sampleRate = located.sampleRate // R+33 or R+37 (checked)

  reader.seek(offset + 45)
  const frames = reader.u32()

  reader.seek(offset + 69)
  const loop = { mode: reader.u32(), start: reader.u32(), end: reader.u32() }

  reader.seek(located.next)
  return {
    offset,
    rootNote,
    name,
    sampleRate,
    channels,
    frames,
    loop,
    poolId: located.poolId,
    audioOffset: located.audioOffset,
    audioLength: frames * channels * 2,
  }
}

/** Checks the sample at `offset` and works out where its audio is, or says why it isn't valid. */
function locate(
  reader: ByteReader,
  offset: number,
  pool: ReadonlyMap<number, PoolEntry>,
  layout: SampleLayout,
): AudioLocation | string {
  if (offset < 0 || offset + SAMPLE_HEADER_LENGTH > reader.length) {
    return 'not enough bytes left for a sample header'
  }
  const resumeAt = reader.offset
  try {
    reader.seek(offset + 1)
    const mark = reader.u8()
    if (layout === 'modern' && mark !== NAME_MARK) {
      return `byte R+1 is 0x${mark.toString(16)}, not 0x20`
    }
    if (layout === 'v1.10' && (mark === 0 || mark > NAME_MARK)) {
      return `byte R+1 is 0x${mark.toString(16)}, neither a name length (1 to 31) nor 0x20`
    }
    const nameLength = mark === NAME_MARK ? NAME_FIELD_LENGTH : mark
    reader.seek(offset + 33)
    const rateLow = reader.u16()
    const bits = reader.u8()
    const channels = reader.u8()
    const rateFull = reader.u32()
    if (bits !== 16) {
      return `bits per sample is ${bits}, not 16`
    }
    if (channels !== 1 && channels !== 2) {
      return `channel count is ${channels}, not 1 or 2`
    }
    // 1.10 fills in only R+33. Later versions put the full rate at R+37 and
    // its low 16 bits at R+33.
    if (layout === 'v1.10' && rateFull !== 0) {
      return `R+37 is ${rateFull}, not 0 as in 1.10`
    }
    if (layout === 'modern' && rateLow !== (rateFull & 0xffff)) {
      return `the two sample-rate fields disagree (${rateLow} and ${rateFull})`
    }
    const rate = layout === 'v1.10' ? rateLow : rateFull
    if (rate < MIN_SAMPLE_RATE || rate > MAX_SAMPLE_RATE) {
      return `sample rate ${rate} Hz is implausible`
    }
    const poolReference = reader.u32() // R+41
    const frames = reader.u32() // R+45
    if (frames === 0) {
      return 'frame count is 0'
    }
    const audioLength = frames * channels * 2

    if (poolReference === 0) {
      const audioOffset = offset + SAMPLE_HEADER_LENGTH
      if (audioOffset + audioLength > reader.length) {
        return `its audio (${frames} frames) runs past the end of the file`
      }
      return {
        sampleRate: rate,
        nameLength,
        poolId: undefined,
        audioOffset,
        next: audioOffset + audioLength,
      }
    }

    const poolId = poolReference - 1
    const entry = pool.get(poolId)
    if (entry === undefined) {
      return `its audio is in sample pool entry ${poolId}, which doesn't exist`
    }
    if (entry.length !== audioLength) {
      return `sample pool entry ${poolId} holds ${entry.length} bytes, but ${frames} frames need ${audioLength}`
    }
    return {
      sampleRate: rate,
      nameLength,
      poolId,
      audioOffset: entry.offset,
      next: offset + SAMPLE_HEADER_LENGTH,
    }
  } finally {
    reader.seek(resumeAt)
  }
}
