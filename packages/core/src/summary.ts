import { formatDuration, totalSeconds } from './durations'
import { instrumentLabel } from './extraction'
import { describeSpacing, noteRange } from './notes'
import type { Sample, SetFile } from './types'

/** What `inspect` and the web page show about a file, before any formatting. */
export interface SetSummary {
  version: string
  /** Including every instrument's extra layers. */
  sampleCount: number
  seconds: number
  /** Entries in the sample pool; 0 if the file has none. */
  poolEntries: number
  instruments: InstrumentSummary[]
}

export interface InstrumentSummary {
  /** 1 for the first instrument. */
  number: number
  /** As shown: the first instrument of a .Set is "Shots". */
  name: string
  /** Including the extra layers' samples. */
  sampleCount: number
  layerCount: number
  /** The main samples' root notes, for example "C2–B4", or "-" if there are none. */
  notes: string
  /** How far apart the main samples' root notes are, for example "every 3–5". */
  spacing: string
  /** Including the extra layers. */
  seconds: number
}

export function summarizeSet(set: SetFile): SetSummary {
  const instruments: InstrumentSummary[] = []
  let sampleCount = 0
  let seconds = 0

  for (const [i, instrument] of set.instruments.entries()) {
    // Notes and spacing describe the main samples; counts and durations
    // include the instrument's extra layers too.
    const roots = instrument.samples.map((s) => s.rootNote)
    const all: Sample[] = [...instrument.samples]
    for (const layer of instrument.layers) {
      all.push(...layer.samples)
    }
    const instrumentSeconds = totalSeconds(all)
    sampleCount += all.length
    seconds += instrumentSeconds
    instruments.push({
      number: i + 1,
      name: instrumentLabel(set, i),
      sampleCount: all.length,
      layerCount: instrument.layers.length,
      notes: noteRange(roots),
      spacing: describeSpacing(roots),
      seconds: instrumentSeconds,
    })
  }

  return { version: set.version, sampleCount, seconds, poolEntries: set.poolEntries, instruments }
}

/** "Version 1.10 · 12 instruments · 258 samples · 4 min 43 s of audio", plus the pool if there is one. */
export function describeSummary(summary: SetSummary): string {
  const parts = [
    `Version ${summary.version}`,
    count(summary.instruments.length, 'instrument'),
    count(summary.sampleCount, 'sample'),
    `${formatDuration(summary.seconds)} of audio`,
  ]
  if (summary.poolEntries > 0) {
    parts.push(`${count(summary.poolEntries, 'shared sound')} in the sample pool`)
  }
  return parts.join(' · ')
}

/** "1 sample", "1,336 samples". */
export function count(n: number, noun: string): string {
  return `${n.toLocaleString('en-US')} ${noun}${n === 1 ? '' : 's'}`
}

/** The name to show for an instrument: "Alto Sax (+2 layers)" when it has extra layers. */
export function instrumentTitle(instrument: InstrumentSummary): string {
  const layers = instrument.layerCount
  return layers === 0 ? instrument.name : `${instrument.name} (+${count(layers, 'layer')})`
}
