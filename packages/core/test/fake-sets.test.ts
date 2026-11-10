import { describe, expect, test } from 'bun:test'

import { parseSet } from '../src/index'
import { fakeFiles } from './fixtures/fake-sets'
import { describeFileChecks } from './helpers/file-checks'

for (const fake of fakeFiles()) {
  describe(fake.name, () => {
    test('holds what it was built to hold', () => {
      const set = parseSet(fake.bytes)
      let samples = 0
      let layers = 0
      for (const instrument of set.instruments) {
        samples += instrument.samples.length
        layers += instrument.layers.length
        for (const layer of instrument.layers) {
          samples += layer.samples.length
        }
      }
      expect({
        instruments: set.instruments.length,
        samples,
        layers,
        poolEntries: set.poolEntries,
      }).toEqual(fake.expected)
    })
  })
  describeFileChecks(`smoke checks on ${fake.name}`, () => fake.bytes)
}
