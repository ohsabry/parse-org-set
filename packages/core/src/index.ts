export { OutOfBoundsError } from './errors/out-of-bounds-error'
export { ByteReader } from './reader'
export { SetFormatError } from './errors/set-format-error'
export { toAscii } from './ascii'
export {
  defaultOutputFolder,
  planExtraction,
  safeName,
  type ExtractionIndex,
  type ExtractionPlan,
  type NameOptions,
  type PlannedFile,
} from './extraction'
export { describeSpacing, noteLabel, noteName } from './notes'
export { parseSet } from './parse-set'
export { pickMelodicSample, planSimpleExtraction } from './simple'
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
export { encodeWav, type WavAudio } from './wav'
