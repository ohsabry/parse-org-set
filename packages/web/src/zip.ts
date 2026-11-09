import { wavHeader, type ExtractionPlan } from '@parse-org-set/core'
import { Zip, ZipPassThrough } from 'fflate'

// A zip without the ZIP64 extension (which fflate doesn't write) counts its
// entries in 16 bits and its sizes and offsets in 32 bits.
const MAX_ENTRIES = 0xffff
const MAX_BYTES = 0xffff_ffff
// Per entry, besides its name and data: a 30-byte local header, a 16-byte
// data descriptor (written after the data, because fflate streams) and a
// 46-byte central directory record. The zip ends with a 22-byte record.
const ENTRY_OVERHEAD = 30 + 16 + 46
const END_RECORD = 22

/**
 * Zips an extraction: every instrument folder (empty ones too, as the CLI
 * makes them), every planned WAV file and index.json, all inside `folder`.
 *
 * The audio isn't copied: each WAV is pushed as its 44-byte header followed
 * by a view into `bytes`. Files are stored, not compressed: WAV audio barely
 * compresses, and storing is fast. Returns the zip in pieces, in order;
 * `new Blob(parts)` makes them one downloadable file.
 */
export function zipExtraction(
  bytes: Uint8Array,
  plan: ExtractionPlan,
  folder: string,
): Uint8Array[] {
  const encoder = new TextEncoder()
  const index = encoder.encode(`${JSON.stringify(plan.index, null, 2)}\n`)
  const folders = folderPaths(plan)
  checkLimits(plan, folders, folder, index.length)

  const parts: Uint8Array[] = []
  const errors: Error[] = []
  // With stored entries, fflate calls this right away, during push().
  const zip = new Zip((error, chunk) => {
    if (error === null) {
      parts.push(chunk)
    } else {
      errors.push(error)
    }
  })

  for (const path of folders) {
    addEntry(zip, `${folder}/${path}/`, [])
  }
  for (const { path, sample } of plan.files) {
    const audio = bytes.subarray(sample.audioOffset, sample.audioOffset + sample.audioLength)
    const header = wavHeader({
      sampleRate: sample.sampleRate,
      channels: sample.channels,
      audioLength: audio.length,
    })
    addEntry(zip, `${folder}/${path}`, [header, audio])
  }
  addEntry(zip, `${folder}/index.json`, [index])
  zip.end()

  const [error] = errors
  if (error !== undefined) {
    throw error
  }
  return parts
}

/** Adds one stored entry. A name ending in "/" with no data is a folder. */
function addEntry(zip: Zip, name: string, chunks: Uint8Array[]): void {
  const entry = new ZipPassThrough(name)
  zip.add(entry)
  if (chunks.length === 0) {
    entry.push(new Uint8Array(0), true)
    return
  }
  for (const [i, chunk] of chunks.entries()) {
    entry.push(chunk, i === chunks.length - 1)
  }
}

/** Every folder the CLI would create: each instrument's and layer's, and each file's. */
function folderPaths(plan: ExtractionPlan): string[] {
  const folders = new Set<string>()
  for (const instrument of plan.index.instruments) {
    folders.add(instrument.folder)
    for (const layer of instrument.layers) {
      folders.add(layer.folder)
    }
  }
  for (const { path } of plan.files) {
    folders.add(path.slice(0, path.lastIndexOf('/')))
  }
  return [...folders]
}

/** Throws a clear error, before any work, if the zip would break a plain zip's limits. */
function checkLimits(
  plan: ExtractionPlan,
  folders: string[],
  folder: string,
  indexLength: number,
): void {
  const entries = folders.length + plan.files.length + 1
  const encoder = new TextEncoder()
  // Each name is written twice: in its local header and in the central directory.
  const nameBytes = (path: string): number => 2 * encoder.encode(`${folder}/${path}`).length
  let size = END_RECORD + entries * ENTRY_OVERHEAD + indexLength + nameBytes('index.json')
  for (const path of folders) {
    size += nameBytes(`${path}/`)
  }
  for (const { path, sample } of plan.files) {
    size += nameBytes(path) + 44 + sample.audioLength
  }
  if (entries > MAX_ENTRIES || size > MAX_BYTES) {
    const gigabytes = (size / 1024 ** 3).toFixed(1)
    throw new RangeError(
      `Too big for a zip file: ${entries.toLocaleString('en-US')} files and folders, ${gigabytes} GB. ` +
        'A zip holds at most 65,535 files and 4 GB.',
    )
  }
}
