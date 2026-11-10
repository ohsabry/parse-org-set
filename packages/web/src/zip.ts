import { indexJson, planFolders, wavHeader, type ExtractionPlan } from '@parse-org-set/core'

import { crc32 } from './crc32'

/**
 * Builds the zip of an extraction without copying the audio into memory.
 *
 * A zip is a list of entries, then a table of contents (the "central
 * directory"), then a short end record saying where that table is. Every
 * number is little-endian. Ours are "stored" (not compressed: WAV audio barely
 * compresses), and their sizes are known up front, so each entry is simply:
 *
 *   [30-byte local header][name][data]
 *
 * The data of a WAV entry is its 44-byte header, then the sample's audio. The
 * audio part is `source.slice(…)`: a piece of the original file that the
 * browser reads from disk only when it saves the zip, so the zip costs almost
 * no memory however big the set. The one thing that needs the audio itself is
 * each entry's CRC-32 checksum, worked out one sample at a time.
 */

// Without the ZIP64 extension (which real sets don't need), a zip counts its
// entries in 16 bits and its sizes and offsets in 32 bits.
const MAX_ENTRIES = 0xffff
const MAX_BYTES = 0xffff_ffff
// Per entry: a 30-byte local header and a 46-byte central directory record,
// each followed by the name. The zip ends with a 22-byte record.
const LOCAL_HEADER = 30
const CENTRAL_RECORD = 46
const END_RECORD = 22
const WAV_HEADER = 44
// "Version 2.0", the lowest version that knows folders and stored entries.
const ZIP_VERSION = 20
// Flag bit 11: the name is UTF-8 (otherwise readers assume an old DOS code page).
const UTF8_NAMES = 0x0800
// In the central directory, the MS-DOS "folder" attribute, for folder entries.
const DOS_FOLDER = 0x10

const encoder = new TextEncoder()

interface Entry {
  name: Uint8Array
  /** The entry's data, in order: byte arrays and slices of the source file. */
  data: (Uint8Array | Blob)[]
  size: number
  crc: number
  /** Where its local header starts in the zip. */
  offset: number
}

/**
 * Zips an extraction: every instrument folder (empty ones too, as the CLI
 * makes them), every planned WAV file and index.json, all inside `folder`.
 * `source` is the .Set or .Instrument file itself (a File is a Blob).
 * `onProgress` hears how many WAV files are done, after each one.
 */
export async function zipExtraction(
  source: Blob,
  plan: ExtractionPlan,
  folder: string,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const size = zipSize(plan, folder)
  if (size.entries > MAX_ENTRIES || size.bytes > MAX_BYTES) {
    const gigabytes = (size.bytes / 1024 ** 3).toFixed(1)
    throw new RangeError(
      `Too big for a zip file: ${size.entries.toLocaleString('en-US')} files and folders, ${gigabytes} GB. ` +
        'A zip holds at most 65,535 files and 4 GB.',
    )
  }

  const entries: Entry[] = []
  let offset = 0
  const add = (path: string, data: (Uint8Array | Blob)[], dataSize: number, crc: number): void => {
    const name = encoder.encode(`${folder}/${path}`)
    entries.push({ name, data, size: dataSize, crc, offset })
    offset += LOCAL_HEADER + name.length + dataSize
  }

  const folderPaths = planFolders(plan)
  for (const path of folderPaths) {
    add(`${path}/`, [], 0, 0)
  }
  const folders = folderPaths.length
  for (const { path, sample } of plan.files) {
    const header = wavHeader({
      sampleRate: sample.sampleRate,
      channels: sample.channels,
      audioLength: sample.audioLength,
    })
    const audio = source.slice(sample.audioOffset, sample.audioOffset + sample.audioLength)
    // Read just this sample to checksum it; the zip keeps the slice, not the bytes.
    const crc = crc32(new Uint8Array(await audio.arrayBuffer()), crc32(header))
    add(path, [header, audio], WAV_HEADER + sample.audioLength, crc)
    onProgress?.(entries.length - folders, plan.files.length)
  }
  const index = encoder.encode(indexJson(plan.index))
  add('index.json', [index], index.length, crc32(index))

  const time = dosTime(new Date())
  const parts: (Uint8Array | Blob)[] = []
  for (const entry of entries) {
    parts.push(localHeader(entry, time), entry.name, ...entry.data)
  }
  const directoryStart = offset
  for (const entry of entries) {
    parts.push(centralRecord(entry, time), entry.name)
  }
  parts.push(endRecord(entries.length, size.bytes - END_RECORD - directoryStart, directoryStart))
  // The byte arrays are ours alone, never shared memory, as Blob's type asks.
  return new Blob(parts as (Uint8Array<ArrayBuffer> | Blob)[], { type: 'application/zip' })
}

/**
 * Exactly how big zipExtraction's zip will be, and how many entries it will
 * hold, worked out without building it.
 */
export function zipSize(plan: ExtractionPlan, folder: string): { entries: number; bytes: number } {
  const folders = planFolders(plan)
  const entries = folders.length + plan.files.length + 1
  // Each name is written twice: after its local header and after its central record.
  const nameBytes = (path: string): number => 2 * encoder.encode(`${folder}/${path}`).length
  let bytes =
    END_RECORD +
    entries * (LOCAL_HEADER + CENTRAL_RECORD) +
    encoder.encode(indexJson(plan.index)).length +
    nameBytes('index.json')
  for (const path of folders) {
    bytes += nameBytes(`${path}/`)
  }
  for (const { path, sample } of plan.files) {
    bytes += nameBytes(path) + WAV_HEADER + sample.audioLength
  }
  return { entries, bytes }
}

/** Flag bit 11 for names that aren't plain ASCII. */
function flags(name: Uint8Array): number {
  return name.some((byte) => byte > 0x7f) ? UTF8_NAMES : 0
}

/** The 30-byte header in front of each entry's name and data. */
function localHeader(entry: Entry, time: number): Uint8Array {
  const out = new Uint8Array(LOCAL_HEADER)
  const view = new DataView(out.buffer)
  view.setUint32(0, 0x04034b50, true) // "PK\x03\x04"
  view.setUint16(4, ZIP_VERSION, true) // version needed to extract
  view.setUint16(6, flags(entry.name), true)
  view.setUint16(8, 0, true) // compression method 0: stored
  view.setUint32(10, time, true) // last modified: time, then date
  view.setUint32(14, entry.crc, true)
  view.setUint32(18, entry.size, true) // compressed size (stored, so the same)
  view.setUint32(22, entry.size, true) // uncompressed size
  view.setUint16(26, entry.name.length, true)
  view.setUint16(28, 0, true) // no extra field
  return out
}

/** The entry's 46-byte record in the central directory, the zip's table of contents. */
function centralRecord(entry: Entry, time: number): Uint8Array {
  const out = new Uint8Array(CENTRAL_RECORD)
  const view = new DataView(out.buffer)
  view.setUint32(0, 0x02014b50, true) // "PK\x01\x02"
  view.setUint16(4, ZIP_VERSION, true) // version made by (high byte 0: MS-DOS attributes)
  view.setUint16(6, ZIP_VERSION, true) // version needed to extract
  view.setUint16(8, flags(entry.name), true)
  view.setUint16(10, 0, true) // stored
  view.setUint32(12, time, true)
  view.setUint32(16, entry.crc, true)
  view.setUint32(20, entry.size, true)
  view.setUint32(24, entry.size, true)
  view.setUint16(28, entry.name.length, true)
  // 30: extra field length, 32: comment length, 34: disk number, 36: internal
  // attributes, all 0.
  const isFolder = entry.name.at(-1) === 0x2f // "/"
  view.setUint32(38, isFolder ? DOS_FOLDER : 0, true) // external attributes
  view.setUint32(42, entry.offset, true) // where the local header is
  return out
}

/** The 22-byte record that ends the zip and says where the central directory is. */
function endRecord(entries: number, directorySize: number, directoryStart: number): Uint8Array {
  const out = new Uint8Array(END_RECORD)
  const view = new DataView(out.buffer)
  view.setUint32(0, 0x06054b50, true) // "PK\x05\x06"
  // 4: this disk's number, 6: the disk the directory starts on, both 0.
  view.setUint16(8, entries, true) // entries on this disk
  view.setUint16(10, entries, true) // entries in all
  view.setUint32(12, directorySize, true)
  view.setUint32(16, directoryStart, true)
  // 20: comment length, 0.
  return out
}

/**
 * A moment in MS-DOS format, as zips store it: two 16-bit numbers, the time
 * (hours, minutes, seconds in 2-second steps) then the date (years since
 * 1980, month, day).
 */
function dosTime(when: Date): number {
  const time = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1)
  const date = ((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate()
  return ((date << 16) | time) >>> 0
}
