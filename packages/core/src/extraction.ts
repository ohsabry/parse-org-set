import { toAscii } from './ascii'
import { noteLabel } from './notes'
import type { Loop, Sample, SetFile } from './types'

/** Every file to write, plus the index.json contents. */
export interface ExtractionPlan {
  files: PlannedFile[]
  index: ExtractionIndex
}

/** One WAV file to write: where it goes (relative to the output folder) and what's in it. */
export interface PlannedFile {
  /** For example "02_Oud/001_C2_oud_C2.wav". */
  path: string
  sample: Sample
}

/** The contents of index.json: every original name and detail, next to the file names used. */
export interface ExtractionIndex {
  source: string
  version: string
  instruments: IndexInstrument[]
}

export interface IndexInstrument {
  folder: string
  /** Exactly as stored in the .Set. */
  name: string
  samples: IndexSample[]
  /** Extra layers, each in its own subfolder of the instrument's folder. */
  layers: { folder: string; name: string; samples: IndexSample[] }[]
}

export interface IndexSample {
  file: string
  /** Exactly as stored in the .Set, including any trailing spaces. */
  name: string
  rootNote: number
  note: string
  sampleRate: number
  channels: 1 | 2
  frames: number
  seconds: number
  loop: Loop
  /** The sample pool entry the audio came from, if it was in the pool. */
  poolId?: number
}

/** `ascii: true` makes every folder and file name plain ASCII (Arabic in the Arabic chat alphabet). */
export interface NameOptions {
  ascii?: boolean
}

// Characters that macOS, Linux or Windows don't allow in file names.
const UNSAFE = new Set(['/', '\\', ':', '*', '?', '"', '<', '>', '|'])

// File systems allow 255 bytes per file or folder name. Names are kept well
// under that, leaving room for the number prefix, the note and ".wav".
const MAX_NAME_BYTES = 120

/**
 * Turns any text into a safe file or folder name: drops unsafe and control
 * characters, turns runs of spaces into one underscore, trims spaces and
 * dots from the ends, and cuts it to 120 bytes. Returns "unnamed" if nothing
 * is left.
 */
export function safeName(text: string): string {
  let name = ''
  let spaceBefore = false
  for (const char of text) {
    // Whitespace first: a tab is both whitespace and a control character.
    if (/\s/.test(char)) {
      spaceBefore = name !== '' // leading spaces are dropped
      continue
    }
    const code = char.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f || UNSAFE.has(char)) {
      continue
    }
    if (spaceBefore) {
      name += '_'
      spaceBefore = false
    }
    name += char
  }
  // Trailing spaces never get written. Dots at either end are trimmed too:
  // a leading dot hides a file on macOS and Linux, Windows rejects a trailing one.
  let start = 0
  let end = name.length
  while (start < end && name[start] === '.') {
    start++
  }
  while (end > start && name[end - 1] === '.') {
    end--
  }
  name = shorten(name.slice(start, end), MAX_NAME_BYTES)
  return name === '' ? 'unnamed' : name
}

/** Cuts `text` to at most `limit` bytes of UTF-8, never splitting a character. */
function shorten(text: string, limit: number): string {
  const encoder = new TextEncoder()
  let out = ''
  let bytes = 0
  for (const char of text) {
    const size = encoder.encode(char).length
    if (bytes + size > limit) {
      break
    }
    out += char
    bytes += size
  }
  return out
}

/** A safe file or folder name for `text`, in ASCII if asked. */
export function nameFor(text: string, options: NameOptions): string {
  return safeName(options.ascii === true ? toAscii(text) : text)
}

/** "001_C2_oud_C2.wav": a number padded to `digits`, the root note and the sample's name. */
export function sampleFileName(
  number: number,
  digits: number,
  sample: Sample,
  options: NameOptions,
): string {
  return `${pad(number, digits)}_${noteLabel(sample.rootNote)}_${nameFor(sample.name, options)}.wav`
}

/**
 * The name to show for an instrument. A .Set's first instrument is named "-"
 * (or "Constant" in 1.4.9); we call it Shots. An .Instrument file has no Shots.
 */
export function instrumentLabel(set: SetFile, position: number): string {
  const name = set.instruments[position]?.name ?? ''
  return set.fileType === 'set' && position === 0 ? 'Shots' : name
}

export function pad(n: number, digits: number): string {
  return String(n).padStart(digits, '0')
}

/** "سيت الأصوات2023.Set" → "سيت_الأصوات2023_samples"; "Oud.Instrument" → "Oud_samples". */
export function defaultOutputFolder(
  setFileName: string,
  options: NameOptions = {},
  suffix = 'samples',
): string {
  const withoutExtension = setFileName.replace(/\.(set|instrument)$/i, '')
  return `${nameFor(withoutExtension, options)}_${suffix}`
}

/**
 * Works out every file to write and the index, without writing anything.
 * Folders are "NN_name" and files "NNN_note_name.wav", numbered in file order
 * so names stay unique even when instruments or samples share a name.
 */
export function planExtraction(
  sourceName: string,
  set: SetFile,
  options: NameOptions = {},
): ExtractionPlan {
  const files: PlannedFile[] = []
  const index: ExtractionIndex = { source: sourceName, version: set.version, instruments: [] }
  const folderDigits = Math.max(2, String(set.instruments.length).length)

  for (const [i, instrument] of set.instruments.entries()) {
    const folder = `${pad(i + 1, folderDigits)}_${nameFor(instrumentLabel(set, i), options)}`
    const entry: IndexInstrument = { folder, name: instrument.name, samples: [], layers: [] }
    entry.samples = planSamples(folder, instrument.samples, files, options)

    // Each extra layer goes in its own subfolder: "30_Alto_Sax/01_Alto_Sax_p/…".
    for (const [k, layer] of instrument.layers.entries()) {
      const layerFolder = `${folder}/${pad(k + 1, 2)}_${nameFor(layer.name, options)}`
      const samples = planSamples(layerFolder, layer.samples, files, options)
      entry.layers.push({ folder: layerFolder, name: layer.name, samples })
    }
    index.instruments.push(entry)
  }
  return { files, index }
}

/** Plans "NNN_note_name.wav" files in `folder` and returns their index entries. */
function planSamples(
  folder: string,
  samples: Sample[],
  files: PlannedFile[],
  options: NameOptions,
): IndexSample[] {
  const digits = Math.max(3, String(samples.length).length)
  const entries: IndexSample[] = []
  for (const [j, sample] of samples.entries()) {
    const file = sampleFileName(j + 1, digits, sample, options)
    files.push({ path: `${folder}/${file}`, sample })
    entries.push(indexEntry(file, sample))
  }
  return entries
}

/** A sample's entry in index.json. */
export function indexEntry(file: string, sample: Sample): IndexSample {
  return {
    file,
    name: sample.name,
    rootNote: sample.rootNote,
    note: noteLabel(sample.rootNote),
    sampleRate: sample.sampleRate,
    channels: sample.channels,
    frames: sample.frames,
    seconds: sample.frames / sample.sampleRate,
    loop: sample.loop,
    ...(sample.poolId === undefined ? {} : { poolId: sample.poolId }),
  }
}
