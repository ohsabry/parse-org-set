import { describe, expect, test } from 'bun:test'

import { formatDuration } from '../src/index'

describe('formatDuration', () => {
  test('picks a unit that suits the length', () => {
    expect(formatDuration(0.37)).toBe('0.4 s')
    expect(formatDuration(38.2)).toBe('38 s')
    expect(formatDuration(127)).toBe('2 min 7 s')
    expect(formatDuration(3725)).toBe('1 h 2 min')
  })
})
