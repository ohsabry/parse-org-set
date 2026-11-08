/**
 * Test helper: builds a small fake 1.3.x .Set file in memory, following the
 * Layouts section of README.md. Anything marked GUESS isn't known from real
 * files; the builder fills it with something harmless (usually zeros).
 */

export interface FakeLoop {
  mode: number
  start: number
  /** Inclusive: the last frame in the loop. */
  end: number
}

export interface FakeSample {
  name: string
  rootNote: number
  rate: number
  channels: 1 | 2
  /** Interleaved 16-bit samples: L R L R … for stereo. */
  audio: Int16Array
  /** Defaults to what real files store when a sound doesn't loop: mode 0 over the whole sound. */
  loop?: FakeLoop
}

export interface FakeInstrument {
  /** Instrument header name. Real files use '-' for the first group (Shots). */
  name: string
  samples: FakeSample[]
  /** Bytes of zero-filled stand-in settings. Real ones vary in size. Default 62. */
  settingsLength?: number
}

export interface FakeSet {
  version?: string
  /** The first one is the Shots group. */
  instruments: FakeInstrument[]
}

const FILE_HEADER_LENGTH = 485
const SAMPLE_HEADER_LENGTH = 97
const NAME_FIELD_LENGTH = 31
const ROOT_NOTE_AREA_LENGTH = 65 // hypothesis
const MAX_LISTED_ROOT_NOTES = 51
// GUESS: real settings blocks aren't decoded and vary in size. 62 zero bytes
// makes the first sample start at 630 when the name is '-', as in real files.
const FAKE_SETTINGS_LENGTH = 62

const encoder = new TextEncoder()

export function buildSet(set: FakeSet): Uint8Array {
  const version = set.version ?? '1.3.1'
  const chunks = [fileHeader(version, set.instruments.length)]
  for (const instrument of set.instruments) {
    chunks.push(instrumentHeader(instrument, version))
    for (const sample of instrument.samples) {
      chunks.push(sampleBytes(sample))
    }
  }
  return concat(chunks)
}

function fileHeader(version: string, instrumentCount: number): Uint8Array {
  const out = new Uint8Array(FILE_HEADER_LENGTH)
  const view = new DataView(out.buffer)
  out.set(encoder.encode('Music Studio music'), 0)
  const text = encoder.encode(`\r${version}\r`)
  view.setUint32(32, text.length, true)
  out.set(text, 36)
  out.set([0xff, 0xff], 36 + text.length)
  // GUESS: the rest, up to byte 480, is left as zeros.
  view.setUint32(481, instrumentCount, true) // hypothesis: instrument count
  return out
}

function instrumentHeader(instrument: FakeInstrument, version: string): Uint8Array {
  const count = instrument.samples.length
  if (count > 255) {
    throw new Error(`An instrument holds at most 255 samples (its count is one byte), got ${count}`)
  }
  const text = encoder.encode(`${instrument.name}\r${version}\r`)
  const settingsLength = instrument.settingsLength ?? FAKE_SETTINGS_LENGTH
  const out = new Uint8Array(4 + text.length + 5 + ROOT_NOTE_AREA_LENGTH + settingsLength + 1)
  new DataView(out.buffer).setUint32(0, text.length, true)
  out.set(text, 4)
  // Then an int32 (0 or −1 in real files) and the byte 01. Meaning unknown.
  const afterText = 4 + text.length
  out[afterText + 4] = 0x01
  const roots = instrument.samples.slice(0, MAX_LISTED_ROOT_NOTES).map((r) => r.rootNote)
  out.set(roots, afterText + 5)
  // GUESS: the settings block is left as zeros.
  out[out.length - 1] = count // confirmed: last byte = number of samples that follow
  return out
}

function sampleBytes(sample: FakeSample): Uint8Array {
  const { audio, channels } = sample
  if (audio.length === 0 || audio.length % channels !== 0) {
    throw new Error(
      `Audio must be whole frames: ${audio.length} samples for ${channels} channel(s)`,
    )
  }
  const frames = audio.length / channels
  const name = encoder.encode(sample.name)
  if (name.length > NAME_FIELD_LENGTH) {
    throw new Error(`Sample name is ${name.length} bytes; the field holds ${NAME_FIELD_LENGTH}`)
  }
  const loop = sample.loop ?? { mode: 0, start: 0, end: frames - 1 }

  const out = new Uint8Array(SAMPLE_HEADER_LENGTH + audio.length * 2)
  const view = new DataView(out.buffer)
  out[0] = sample.rootNote
  out[1] = 0x20
  out.set(name, 2)
  view.setUint16(33, sample.rate & 0xffff, true) // low 16 bits only
  out[35] = 16 // bits per sample
  out[36] = channels
  view.setUint32(37, sample.rate, true) // full rate
  view.setUint32(45, frames, true)
  view.setUint32(53, 100, true) // GUESS: most common real value (probably volume %)
  view.setUint32(69, loop.mode, true)
  view.setUint32(73, loop.start, true)
  view.setUint32(77, loop.end, true)
  audio.forEach((value, i) => {
    view.setInt16(SAMPLE_HEADER_LENGTH + i * 2, value, true)
  })
  return out
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}
