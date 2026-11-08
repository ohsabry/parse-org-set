/** A parsed .Set file. Audio isn't copied: records point into the original bytes. */
export interface SetFile {
  /** For example '1.3.1'. */
  version: string
  /** The first one is the Shots group. */
  instruments: Instrument[]
  /** Where the undecoded trailer after the last record starts. */
  trailerOffset: number
}

export interface Instrument {
  /** The instrument header's name. '-' for Shots in 1.3.x. */
  name: string
  /** Where the instrument header starts. */
  headerOffset: number
  records: SampleRecord[]
}

export interface Loop {
  /** 0–3 seen. See CLAUDE.md for what they probably mean. */
  mode: number
  /** First frame of the loop. */
  start: number
  /** Last frame of the loop (always at most frames − 1). */
  end: number
}

/** One recorded sound. */
export interface SampleRecord {
  /** Where the record starts (R). */
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
  /** Where the 16-bit PCM audio starts (R+97). */
  audioOffset: number
  /** frames × channels × 2 bytes. */
  audioLength: number
}
