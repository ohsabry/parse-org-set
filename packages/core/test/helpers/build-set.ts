/**
 * Test helper: builds a small fake .Set file in memory, following the
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
  /**
   * Put the audio in the sample pool under this ID instead of after the
   * header. Samples with the same ID share one pool entry.
   */
  poolId?: number
}

export interface FakeInstrument {
  /** Instrument header name. Real files use '-' for the first group (Shots). */
  name: string
  samples: FakeSample[]
  /** Bytes of zero-filled stand-in settings. Real ones vary in size. Default 62. */
  settingsLength?: number
  /** The type byte (+124 after the text): 0 melodic, 1 drum, 2 audio. Default 0. */
  kind?: number
  /** A header with only a name, 3 zero bytes and the count, like one real header. */
  bare?: boolean
}

export interface FakeSet {
  /** Default '1.3.1'. */
  version?: string
  /** The first one is the Shots group. */
  instruments: FakeInstrument[]
}

const SAMPLE_HEADER_LENGTH = 97
const NAME_FIELD_LENGTH = 31
const ROOT_NOTE_AREA_LENGTH = 65 // hypothesis
const MAX_LISTED_ROOT_NOTES = 51
// GUESS: real settings blocks aren't decoded and vary in size. 62 zero bytes
// makes the first sample start at 630 in a 1.3.1 file, as in real files.
const FAKE_SETTINGS_LENGTH = 62
// GUESS: the undecoded file header settings after the pool. 265 bytes puts the
// first instrument header at 485 in a 1.3.1 file without a pool, as in real files.
const FAKE_HEADER_SETTINGS_LENGTH = 265

const encoder = new TextEncoder()

export function buildSet(set: FakeSet): Uint8Array {
  const version = set.version ?? '1.3.1'
  const chunks = [fileHeader(version, set.instruments.length, pool(set.instruments))]
  for (const instrument of set.instruments) {
    chunks.push(instrumentHeader(instrument, version))
    for (const sample of instrument.samples) {
      chunks.push(sampleBytes(sample))
    }
  }
  return concat(chunks)
}

/** 1.4.x writes the version as "\r1.4.9"; older versions as "\r1.3.1\r". */
function versionText(version: string): string {
  return version.startsWith('1.4.') ? `\r${version}` : `\r${version}\r`
}

function fileHeader(version: string, instrumentCount: number, poolBytes: Uint8Array): Uint8Array {
  const text = encoder.encode(versionText(version))
  const versionRecord = new Uint8Array(4 + text.length)
  new DataView(versionRecord.buffer).setUint32(0, text.length, true)
  versionRecord.set(text, 4)

  const title = new Uint8Array(32)
  title.set(encoder.encode('Music Studio music'))
  // ff ff, 14 bytes (GUESS: zeros), then an empty text field (count 0), then
  // 134 bytes (GUESS: zeros) before the pool.
  const beforePool = new Uint8Array(2 + 14 + 4 + 134)
  beforePool.set([0xff, 0xff])
  const settings = new Uint8Array(FAKE_HEADER_SETTINGS_LENGTH)
  settings[0] = 100 // real files have the uint32 100 right after the pool
  // The end of the file header: the version text again, ff ff 00 00, the instrument count.
  const ending = new Uint8Array(4 + 4)
  ending.set([0xff, 0xff, 0x00, 0x00])
  new DataView(ending.buffer).setUint32(4, instrumentCount, true)

  return concat([title, versionRecord, beforePool, poolBytes, settings, versionRecord, ending])
}

/** The sample pool: a count, then each entry's ID, size and audio, in ID order. */
function pool(instruments: FakeInstrument[]): Uint8Array {
  const entries = new Map<number, Int16Array>()
  for (const instrument of instruments) {
    for (const sample of instrument.samples) {
      if (sample.poolId === undefined) {
        continue
      }
      const existing = entries.get(sample.poolId)
      if (existing !== undefined && existing.length !== sample.audio.length) {
        throw new Error(
          `Samples sharing pool entry ${sample.poolId} must have the same audio length`,
        )
      }
      entries.set(sample.poolId, existing ?? sample.audio)
    }
  }
  const ids = [...entries.keys()].sort((a, b) => a - b)
  const chunks: Uint8Array[] = [uint32(ids.length)]
  for (const id of ids) {
    const audio = entries.get(id) ?? new Int16Array(0)
    chunks.push(uint32(id), uint32(audio.length * 2), pcm(audio))
  }
  return concat(chunks)
}

function instrumentHeader(instrument: FakeInstrument, version: string): Uint8Array {
  const count = instrument.samples.length
  if (count > 255) {
    throw new Error(`An instrument holds at most 255 samples (its count is one byte), got ${count}`)
  }
  if (instrument.bare === true) {
    const name = encoder.encode(instrument.name)
    const bare = new Uint8Array(4 + name.length + 3 + 1)
    new DataView(bare.buffer).setUint32(0, name.length, true)
    bare.set(name, 4)
    bare[bare.length - 1] = count
    return bare
  }
  const text = encoder.encode(`${instrument.name}${versionText(version)}`)
  const settingsLength = instrument.settingsLength ?? FAKE_SETTINGS_LENGTH
  const out = new Uint8Array(4 + text.length + 5 + ROOT_NOTE_AREA_LENGTH + settingsLength + 1)
  new DataView(out.buffer).setUint32(0, text.length, true)
  out.set(text, 4)
  // Then an int32 (0 or −1 in real files) and the byte 01. Meaning unknown.
  const afterText = 4 + text.length
  out[afterText + 4] = 0x01
  const roots = instrument.samples.slice(0, MAX_LISTED_ROOT_NOTES).map((r) => r.rootNote)
  out.set(roots, afterText + 5)
  // GUESS: the rest of the settings block is left as zeros.
  if (afterText + 124 < out.length - 1) {
    out[afterText + 124] = instrument.kind ?? 0
  }
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
  const pooled = sample.poolId !== undefined

  const out = new Uint8Array(SAMPLE_HEADER_LENGTH)
  const view = new DataView(out.buffer)
  out[0] = sample.rootNote
  out[1] = 0x20
  out.set(name, 2)
  view.setUint16(33, sample.rate & 0xffff, true) // low 16 bits only
  out[35] = 16 // bits per sample
  out[36] = channels
  view.setUint32(37, sample.rate, true) // full rate
  // 0 = audio follows; N = audio is pool entry N − 1
  view.setUint32(41, pooled ? (sample.poolId ?? 0) + 1 : 0, true)
  view.setUint32(45, frames, true)
  view.setUint32(53, 100, true) // GUESS: most common real value (probably volume %)
  view.setUint32(69, loop.mode, true)
  view.setUint32(73, loop.start, true)
  view.setUint32(77, loop.end, true)
  return pooled ? out : concat([out, pcm(audio)])
}

function uint32(value: number): Uint8Array {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, value, true)
  return out
}

function pcm(audio: Int16Array): Uint8Array {
  const out = new Uint8Array(audio.length * 2)
  const view = new DataView(out.buffer)
  for (const [i, value] of audio.entries()) {
    view.setInt16(i * 2, value, true)
  }
  return out
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let length = 0
  for (const chunk of chunks) {
    length += chunk.length
  }
  const out = new Uint8Array(length)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}
