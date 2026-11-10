/**
 * Fake .Set and .Instrument files for the tests of every package: the builder
 * that writes them byte by byte, and a ready-made set covering every version
 * and case the parser supports. Never published; real files stay out of git.
 */
export {
  buildInstrumentFile,
  buildSample,
  buildSet,
  type FakeInstrument,
  type FakeLoop,
  type FakeSample,
  type FakeSet,
} from './build-set'
export { fakeFiles, type FakeFile } from './fake-sets'
