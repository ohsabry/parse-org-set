export { formatDuration, totalSeconds } from './durations'
export { SetFormatError } from './errors/set-format-error'
export {
  defaultOutputFolder,
  instrumentLabel,
  planExtraction,
  type ExtractionIndex,
  type ExtractionPlan,
  type NameOptions,
  type PlannedFile,
} from './extraction'
export { describeSpacing, noteLabel, noteRange } from './notes'
export { parseSet } from './parse-set'
export { planSimpleExtraction } from './simple'
export type {
  Envelope,
  Instrument,
  InstrumentKind,
  Layer,
  Loop,
  PoolEntry,
  Sample,
  SetFile,
} from './types'
export { encodeWav, wavHeader, type WavAudio } from './wav'
