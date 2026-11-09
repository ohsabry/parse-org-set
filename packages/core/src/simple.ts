import {
  indexEntry,
  instrumentLabel,
  nameFor,
  pad,
  sampleFileName,
  type ExtractionIndex,
  type ExtractionPlan,
  type IndexInstrument,
  type NameOptions,
  type PlannedFile,
} from './extraction'
import { noteLabel } from './notes'
import type { Sample, SetFile } from './types'

const MIDDLE_C = 60

/**
 * A smaller export than planExtraction:
 * - melodic instruments: one sample each, in melodic/ (see pickMelodicSample)
 * - drum kits (including Shots): every distinct sound, from all of the kit's
 *   layers, in drums/<kit>/
 * - audio phrase instruments: left out (by ear, their chops aren't useful on their own)
 * Instruments without a decoded type are treated as melodic.
 * `bytes` are the .Set file's bytes, used to skip drum sounds whose audio is
 * an exact copy of one already exported, even by an earlier kit: a sound
 * shared by two kits appears only in the first.
 */
export function planSimpleExtraction(
  sourceName: string,
  bytes: Uint8Array,
  set: SetFile,
  options: NameOptions = {},
): ExtractionPlan {
  const files: PlannedFile[] = []
  const index: ExtractionIndex = { source: sourceName, version: set.version, instruments: [] }
  const digits = Math.max(2, String(set.instruments.length).length)
  const exported: Sample[] = []

  for (const [i, instrument] of set.instruments.entries()) {
    const label = `${pad(i + 1, digits)}_${nameFor(instrumentLabel(set, i), options)}`

    if (instrument.kind === 'audio') {
      continue
    }

    if (instrument.kind === 'drum') {
      const folder = `drums/${label}`
      const entry: IndexInstrument = { folder, name: instrument.name, samples: [], layers: [] }
      const sounds = [...instrument.samples]
      for (const layer of instrument.layers) {
        sounds.push(...layer.samples)
      }
      let n = 0
      for (const sample of sounds) {
        if (exported.some((other) => sameAudio(bytes, sample, other))) {
          continue
        }
        exported.push(sample)
        n++
        const file = sampleFileName(n, 3, sample, options)
        files.push({ path: `${folder}/${file}`, sample })
        entry.samples.push(indexEntry(file, sample))
      }
      index.instruments.push(entry)
      continue
    }

    const sample = pickMelodicSample(instrument.samples)
    if (sample === undefined) {
      continue
    }
    const file = `${label}_${noteLabel(sample.rootNote)}.wav`
    files.push({ path: `melodic/${file}`, sample })
    index.instruments.push({
      folder: 'melodic',
      name: instrument.name,
      samples: [indexEntry(file, sample)],
      layers: [],
    })
  }
  return { files, index }
}

/**
 * The sample to represent a melodic instrument: one whose root note is a C,
 * as close to middle C as possible (a C plays in tune on a sampler without
 * retuning). If there's no C, the sample closest to middle C.
 */
export function pickMelodicSample(samples: Sample[]): Sample | undefined {
  let best: Sample | undefined
  let bestScore = Infinity
  for (const sample of samples) {
    const notC = sample.rootNote % 12 === 0 ? 0 : 1
    // Any C beats any other note; then the distance from middle C decides.
    const score = notC * 1000 + Math.abs(sample.rootNote - MIDDLE_C)
    if (score < bestScore) {
      best = sample
      bestScore = score
    }
  }
  return best
}

/** True if two samples' audio is byte-for-byte the same. */
function sameAudio(bytes: Uint8Array, a: Sample, b: Sample): boolean {
  if (a.audioLength !== b.audioLength) {
    return false
  }
  for (let i = 0; i < a.audioLength; i++) {
    if (bytes[a.audioOffset + i] !== bytes[b.audioOffset + i]) {
      return false
    }
  }
  return true
}
