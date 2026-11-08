import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { encodeWav, type ExtractionPlan } from '@parse-org-set/core'

import { ExtractError } from './errors/extract-error'

/**
 * Writes every file in `plan` as a WAV under `folder` (creating subfolders as
 * needed), plus index.json. Refuses to write into a folder that already has
 * something in it, so it never overwrites anything.
 */
export function writeExtraction(
  bytes: Uint8Array,
  plan: ExtractionPlan,
  folder: string,
): { files: number; folders: number } {
  if (existsSync(folder)) {
    if (!statSync(folder).isDirectory()) {
      throw new ExtractError(`${folder} already exists and isn't a folder`)
    }
    if (readdirSync(folder).length > 0) {
      throw new ExtractError(`${folder} already exists and isn't empty`)
    }
  }

  const folders = new Set<string>()
  for (const { path } of plan.files) {
    folders.add(dirname(path))
  }
  mkdirSync(folder, { recursive: true })
  for (const sub of folders) {
    mkdirSync(join(folder, sub), { recursive: true })
  }

  for (const { path, sample } of plan.files) {
    // A view onto the sample's audio inside the .Set bytes: nothing is copied
    // until encodeWav builds the WAV file.
    const audio = bytes.subarray(sample.audioOffset, sample.audioOffset + sample.audioLength)
    const wav = encodeWav({ sampleRate: sample.sampleRate, channels: sample.channels, audio })
    writeFileSync(join(folder, path), wav)
  }
  writeFileSync(join(folder, 'index.json'), `${JSON.stringify(plan.index, null, 2)}\n`)

  return { files: plan.files.length, folders: folders.size }
}
