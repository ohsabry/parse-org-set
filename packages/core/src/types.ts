/** A parsed .Set or .Instrument file. Audio isn't copied: samples point into the original bytes. */
export interface OrgFile {
  /** 'set' for a .Set; 'instrument' for an .Instrument, which holds a single instrument. */
  fileType: 'set' | 'instrument'
  /** For example '1.3.1'. */
  version: string
  /** In a .Set, the first one is the Shots group. */
  instruments: Instrument[]
  /** How many entries the file's sample pool has (0 if it has none). */
  poolEntries: number
  /** Where the undecoded trailer after the last sample starts (the file's length if it has none). */
  trailerOffset: number
}

export interface Instrument {
  /** The instrument header's name. The first one (Shots) is '-', or 'Constant' in 1.4.9. */
  name: string
  /** Where the instrument header starts. */
  headerOffset: number
  /** Undefined if the header has no settings or an unknown type value. */
  kind: InstrumentKind | undefined
  /** Undefined if the header has no settings. */
  envelope: Envelope | undefined
  /** The instrument's main samples (its "Primary" layer in 1.4.x). Can be empty. */
  samples: Sample[]
  /** Extra layers, such as soft or growl articulations or breath noises. */
  layers: Layer[]
}

/**
 * An extra group of samples belonging to an instrument. Its header holds only
 * a name and a sample count.
 */
export interface Layer {
  name: string
  headerOffset: number
  samples: Sample[]
}

/** Melodic instruments are pitched; drum kits play one sound per key; audio instruments hold phrases. */
export type InstrumentKind = 'melodic' | 'drum' | 'audio'

/** The amplitude envelope, as set in the ORG 24 app. */
export interface Envelope {
  attackMs: number
  decayMs: number
  /** Only stored from version 1.4 on; undefined before that. */
  sustainPercent: number | undefined
  releaseMs: number
  /** The app's "auto release" switch. */
  autoRelease: boolean
}

export interface Loop {
  /** 0 = no loop. 1, 2 and 3 are seen on looping sounds; how they differ isn't known. */
  mode: number
  /** First frame of the loop. */
  start: number
  /** Last frame of the loop (always at most frames − 1). */
  end: number
}

/** One recorded sound. */
export interface Sample {
  /** Where the sample starts (R). */
  offset: number
  /** MIDI note number the sound was recorded at (60 = middle C). */
  rootNote: number
  /** As stored, including any trailing spaces. */
  name: string
  /** In Hz. */
  sampleRate: number
  channels: 1 | 2
  frames: number
  loop: Loop
  /**
   * The sample pool entry holding this sample's audio, or undefined if the
   * audio follows the sample's header.
   */
  poolId: number | undefined
  /** Where the 16-bit PCM audio starts: R+97, or inside the sample pool. */
  audioOffset: number
  /** frames × channels × 2 bytes. */
  audioLength: number
}

/** One entry of a file's sample pool: audio that samples can point to. */
export interface PoolEntry {
  id: number
  /** Where the entry's 16-bit PCM audio starts. */
  offset: number
  /** In bytes. */
  length: number
}
