import { expect, test } from 'bun:test'

import { name } from '../src/index'

test('core can be imported', () => {
  expect(name).toBe('@parse-org-set/core')
})
