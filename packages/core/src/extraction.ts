import { toAscii } from './ascii'
import { noteName } from './notes'
import type { Loop, Sample, SetFile } from './types'

/** One WAV file to write: where it goes (relative to the output folder) and what's in it. */
export interface PlannedFile {
  /** For example "02_❌الناي/001_C2_nay.wav". */
  path: string
  sample: Sample
}

/** The contents of index.json: every original name and detail, next to the file names used. */
export interface ExtractionIndex {
  source: string
  version: string
  instruments: {
    folder: string
    /** Exactly as stored in the .Set. */
    name: string
    samples: {
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
    }[]
  }[]
}

// Characters that macOS, Linux or Windows don't allow in file names.
const UNSAFE = new Set(['/', '\\', ':', '*', '?', '"', '<', '>', '|'])

/**
 * Turns any text into a safe file or folder name: drops unsafe and control
 * characters, turns runs of spaces into one underscore, trims spaces and
 * dots from the ends. Returns "unnamed" if nothing is left.
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
  name = name.slice(start, end)
  return name === '' ? 'unnamed' : name
}

/** "سيت الأصوات2023.Set" → "سيت_الأصوات2023_samples". */
export function defaultOutputFolder(setFileName: string, options: NameOptions = {}): string {
  const withoutExtension = setFileName.replace(/\.set$/i, '')
  return `${fileName(withoutExtension, options)}_samples`
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
): { files: PlannedFile[]; index: ExtractionIndex } {
  const files: PlannedFile[] = []
  const index: ExtractionIndex = { source: sourceName, version: set.version, instruments: [] }
  const folderDigits = Math.max(2, String(set.instruments.length).length)

  for (const [i, instrument] of set.instruments.entries()) {
    // The first group's header is named "-"; we call it Shots.
    const label = i === 0 ? 'Shots' : instrument.name
    const folder = `${pad(i + 1, folderDigits)}_${fileName(label, options)}`
    const fileDigits = Math.max(3, String(instrument.samples.length).length)
    const entry: ExtractionIndex['instruments'][number] = {
      folder,
      name: instrument.name,
      samples: [],
    }

    for (const [j, sample] of instrument.samples.entries()) {
      const note = noteName(sample.rootNote)
      const file = `${pad(j + 1, fileDigits)}_${note}_${fileName(sample.name, options)}.wav`
      files.push({ path: `${folder}/${file}`, sample })
      entry.samples.push({
        file,
        name: sample.name,
        rootNote: sample.rootNote,
        note,
        sampleRate: sample.sampleRate,
        channels: sample.channels,
        frames: sample.frames,
        seconds: sample.frames / sample.sampleRate,
        loop: sample.loop,
      })
    }
    index.instruments.push(entry)
  }
  return { files, index }
}

/** `ascii: true` makes every folder and file name plain ASCII (Arabic in the Arabic chat alphabet). */
export interface NameOptions {
  ascii?: boolean
}

function fileName(text: string, options: NameOptions): string {
  return safeName(options.ascii === true ? toAscii(text) : text)
}

function pad(n: number, digits: number): string {
  return String(n).padStart(digits, '0')
}
