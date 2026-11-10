import { describeFileChecks } from './helpers/file-checks'

// Optional smoke test against a real file (a .Set or .Instrument, version 1.10
// or 1.2.x to 1.4.x), which can't be committed:
//
//   PARSE_ORG_SET_FILE=~/path/to/some.Set bun test
//
// Without the variable it's skipped. The same checks always run on the fake
// files (fake-sets.test.ts); real files are what show our reading is right.
const path = process.env.PARSE_ORG_SET_FILE
if (path !== undefined) {
  describeFileChecks(`real file ${path}`, () => Bun.file(path).bytes())
}
