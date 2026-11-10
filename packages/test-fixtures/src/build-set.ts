/**
 * Test helper: builds a small fake .Set file in memory, following
 * docs/format.md. Anything marked GUESS isn't known from real files; the
 * builder fills it with something harmless (usually zeros).
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
  /** 1.10 only. How R+1 marks the name: its length (default), or 0x20 with a null-padded name. */
  nameStyle?: 'length' | 'null-padded'
  /** 1.10 only: leftover bytes after a length-marked name, which readers must ignore. */
  nameLeftovers?: string
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
  /**
   * The envelope, in the last bytes before the sample count (see docs/format.md).
   * Times are in 100 ms steps; sustain (a percentage) is only written in 1.4.x.
   * The header must be long enough: settingsLength 133 is. Default all zeros.
   */
  envelope?: {
    attack: number
    decay: number
    sustain?: number
    release: number
    autoRelease: boolean
  }
}

export interface FakeSet {
  /** Default '1.3.1'. '1.10' writes samples the 1.10 way. */
  version?: string
  /** The first one is the Shots group. */
  instruments: FakeInstrument[]
  /**
   * Add a trailer after the last sample, starting like the real ones: the
   * version text with an empty name, ff ff, then bytes nothing reads.
   */
  trailer?: boolean
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
  // Like real files, the count leaves out layers (headers with only a name).
  let instrumentCount = 0
  for (const instrument of set.instruments) {
    if (instrument.bare !== true) {
      instrumentCount++
    }
  }
  const chunks = [fileHeader(version, instrumentCount, pool(set.instruments))]
  for (const instrument of set.instruments) {
    chunks.push(instrumentHeader(instrument, version))
    for (const sample of instrument.samples) {
      chunks.push(buildSample(sample, version))
    }
  }
  if (set.trailer === true) {
    const text = encoder.encode(versionText(version))
    const trailer = new Uint8Array(4 + text.length + 2 + 200)
    new DataView(trailer.buffer).setUint32(0, text.length, true)
    trailer.set(text, 4)
    trailer.set([0xff, 0xff], 4 + text.length)
    chunks.push(trailer)
  }
  return concat(chunks)
}

/**
 * A fake .Instrument file: the 32-byte title, then one instrument exactly as
 * in a .Set. 1.10 files have 4 unknown bytes at offset 28 (`40 5c 4f 06` in
 * every real one); 1.2.8 files have zeros there.
 */
export function buildInstrumentFile(instrument: FakeInstrument, version = '1.10'): Uint8Array {
  const title = new Uint8Array(32)
  title.set(encoder.encode('Music Studio Instrument'))
  if (version === '1.10') {
    title.set([0x40, 0x5c, 0x4f, 0x06], 28)
  }
  const chunks = [title, instrumentHeader(instrument, version)]
  for (const sample of instrument.samples) {
    chunks.push(buildSample(sample, version))
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
  const envelope = instrument.envelope
  if (envelope !== undefined) {
    // The 6 bytes before the count. Before 1.4: attack, decay, release, (unknown),
    // auto release, 0. From 1.4: attack, decay, sustain, release, (unknown), auto release.
    const auto = envelope.autoRelease ? 1 : 0
    const bytes = version.startsWith('1.4.')
      ? [envelope.attack, envelope.decay, envelope.sustain ?? 100, envelope.release, 0, auto]
      : [envelope.attack, envelope.decay, envelope.release, 0, auto, 0]
    out.set(bytes, out.length - 7)
  }
  out[out.length - 1] = count // confirmed: last byte = number of samples that follow
  return out
}

/** One sample: its 97-byte header, then its audio unless it's in the pool. */
export function buildSample(sample: FakeSample, version = '1.3.1'): Uint8Array {
  const { audio, channels } = sample
  if (audio.length === 0 || audio.length % channels !== 0) {
    throw new Error(
      `Audio must be whole frames: ${audio.length} samples for ${channels} channel(s)`,
    )
  }
  const frames = audio.length / channels
  const old = version === '1.10'
  const name = encoder.encode(sample.name)
  const leftovers = encoder.encode(sample.nameLeftovers ?? '')
  if (name.length + leftovers.length > NAME_FIELD_LENGTH) {
    throw new Error(`Sample name is ${name.length} bytes; the field holds ${NAME_FIELD_LENGTH}`)
  }
  if (!old && leftovers.length > 0) {
    throw new Error('Name leftovers only exist in 1.10; later versions null-pad the name')
  }
  if (old && sample.rate > 0xffff) {
    throw new Error(`1.10 stores only a 16-bit rate, so ${sample.rate} Hz doesn't fit`)
  }
  const loop = sample.loop ?? { mode: 0, start: 0, end: frames - 1 }
  const pooled = sample.poolId !== undefined

  const out = new Uint8Array(SAMPLE_HEADER_LENGTH)
  const view = new DataView(out.buffer)
  out[0] = sample.rootNote
  // 1.10: the name's length, unless the name is null-padded. Later: always 0x20.
  out[1] = old && sample.nameStyle !== 'null-padded' ? name.length : 0x20
  out.set(name, 2)
  out.set(leftovers, 2 + name.length)
  view.setUint16(33, sample.rate & 0xffff, true) // low 16 bits only
  out[35] = 16 // bits per sample
  out[36] = channels
  view.setUint32(37, old ? 0 : sample.rate, true) // full rate (0 in 1.10)
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
