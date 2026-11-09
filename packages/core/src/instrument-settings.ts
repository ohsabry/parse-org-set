import type { ByteReader } from './reader'
import type { Envelope, InstrumentKind } from './types'

// Offsets inside an instrument header's settings, counted from the end of its
// text (name + version). See docs/format.md.
const KIND_OFFSET = 124
const KINDS: Record<number, InstrumentKind> = { 0: 'melodic', 1: 'drum', 2: 'audio' }

// The envelope is in the last 7 bytes before the first sample (the last of
// them is the sample count):
//   before 1.4:  attack, decay, release, (unknown), auto release, 0
//   1.4 on:      attack, decay, sustain, release, (unknown), auto release
const ENVELOPE_FROM_END = 7
const ENVELOPE_STEP_MS = 100

/**
 * Reads the decoded settings of an instrument header whose text ends at
 * `settingsStart`. Returns undefined for anything the header is too short to
 * hold, and for a type value we've never seen.
 */
export function readInstrumentSettings(
  reader: ByteReader,
  settingsStart: number,
  firstSample: number,
  version: string,
): { kind: InstrumentKind | undefined; envelope: Envelope | undefined } {
  const envelopeStart = firstSample - ENVELOPE_FROM_END
  // Real settings blocks are at least 128 bytes; a header too short to hold
  // both fields doesn't have them.
  if (envelopeStart <= settingsStart + KIND_OFFSET) {
    return { kind: undefined, envelope: undefined }
  }

  reader.seek(settingsStart + KIND_OFFSET)
  const kind = KINDS[reader.u8()]

  reader.seek(envelopeStart)
  const attack = reader.u8()
  const decay = reader.u8()
  const hasSustain = version.startsWith('1.4.')
  const sustainPercent = hasSustain ? reader.u8() : undefined
  const release = reader.u8()
  reader.skip(1) // unknown
  const autoRelease = reader.u8() !== 0
  const envelope: Envelope = {
    attackMs: attack * ENVELOPE_STEP_MS,
    decayMs: decay * ENVELOPE_STEP_MS,
    sustainPercent,
    releaseMs: release * ENVELOPE_STEP_MS,
    autoRelease,
  }
  return { kind, envelope }
}
