import { SetFormatError } from './errors/set-format-error'
import type { ByteReader } from './reader'
import type { Sample } from './types'

/** Every sample starts with a 97-byte header; the audio follows. */
export const SAMPLE_HEADER_LENGTH = 97

// Real files use 22,050 to 152,174 Hz. These limits are deliberately wide;
// they only exist to reject bytes that clearly aren't a sample.
const MIN_SAMPLE_RATE = 4000
const MAX_SAMPLE_RATE = 400_000

/**
 * Says why the bytes at `offset` aren't a valid sample, or returns
 * undefined if they are. Leaves the reader's position unchanged.
 */
export function sampleProblem(reader: ByteReader, offset: number): string | undefined {
  if (offset < 0 || offset + SAMPLE_HEADER_LENGTH > reader.length) {
    return 'not enough bytes left for a sample header'
  }
  const resumeAt = reader.offset
  try {
    reader.seek(offset + 1)
    const marker = reader.u8()
    if (marker !== 0x20) {
      return `byte R+1 is 0x${marker.toString(16)}, not 0x20`
    }
    reader.seek(offset + 33)
    const rateLow = reader.u16()
    const bits = reader.u8()
    const channels = reader.u8()
    const rate = reader.u32()
    if (bits !== 16) {
      return `bits per sample is ${bits}, not 16`
    }
    if (channels !== 1 && channels !== 2) {
      return `channel count is ${channels}, not 1 or 2`
    }
    // R+33 holds the low 16 bits of the full rate at R+37.
    if (rateLow !== (rate & 0xffff)) {
      return `the two sample-rate fields disagree (${rateLow} and ${rate})`
    }
    if (rate < MIN_SAMPLE_RATE || rate > MAX_SAMPLE_RATE) {
      return `sample rate ${rate} Hz is implausible`
    }
    reader.seek(offset + 45)
    const frames = reader.u32()
    if (frames === 0) {
      return 'frame count is 0'
    }
    if (offset + SAMPLE_HEADER_LENGTH + frames * channels * 2 > reader.length) {
      return `its audio (${frames} frames) runs past the end of the file`
    }
    return undefined
  } finally {
    reader.seek(resumeAt)
  }
}

/**
 * Reads the sample at the reader's position and leaves the reader just
 * after its audio, where the next sample or instrument header starts.
 */
export function readSample(reader: ByteReader): Sample {
  const offset = reader.offset
  const problem = sampleProblem(reader, offset)
  if (problem !== undefined) {
    throw new SetFormatError(`No valid sample at offset ${offset}: ${problem}`, offset)
  }

  const rootNote = reader.u8() // R+0
  reader.skip(1) // R+1: always 0x20
  const name = reader.utf8(31) // R+2
  reader.skip(3) // R+33: low 16 bits of the rate; R+35: bits (checked above)
  const channels = reader.u8() === 1 ? 1 : 2 // R+36 (checked above)
  const sampleRate = reader.u32() // R+37: the full rate

  reader.seek(offset + 45)
  const frames = reader.u32()

  reader.seek(offset + 69)
  const loop = { mode: reader.u32(), start: reader.u32(), end: reader.u32() }

  const audioOffset = offset + SAMPLE_HEADER_LENGTH
  const audioLength = frames * channels * 2
  reader.seek(audioOffset + audioLength)

  return { offset, rootNote, name, sampleRate, channels, frames, loop, audioOffset, audioLength }
}
