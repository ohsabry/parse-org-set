import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { encodeWav, planExtraction, type NameOptions, type SetFile } from '@parse-org-set/core'

import { ExtractError } from './errors/extract-error'

/**
 * Writes every sample of `set` as a WAV file under `folder`, one subfolder per
 * instrument, plus index.json. Refuses to write into a folder that already
 * has something in it, so it never overwrites anything.
 */
export function writeExtraction(
  bytes: Uint8Array,
  sourceName: string,
  set: SetFile,
  folder: string,
  options: NameOptions = {},
): { files: number; folders: number } {
  if (existsSync(folder)) {
    if (!statSync(folder).isDirectory()) {
      throw new ExtractError(`${folder} already exists and isn't a folder`)
    }
    if (readdirSync(folder).length > 0) {
      throw new ExtractError(`${folder} already exists and isn't empty`)
    }
  }

  const { files, index } = planExtraction(sourceName, set, options)
  mkdirSync(folder, { recursive: true })
  for (const instrument of index.instruments) {
    mkdirSync(join(folder, instrument.folder))
  }

  for (const { path, sample } of files) {
    // A view onto the sample's audio inside the .Set bytes: nothing is copied
    // until encodeWav builds the WAV file.
    const audio = bytes.subarray(sample.audioOffset, sample.audioOffset + sample.audioLength)
    const wav = encodeWav({ sampleRate: sample.sampleRate, channels: sample.channels, audio })
    writeFileSync(join(folder, path), wav)
  }
  writeFileSync(join(folder, 'index.json'), `${JSON.stringify(index, null, 2)}\n`)

  return { files: files.length, folders: index.instruments.length }
}
