import { describe, expect, test } from 'bun:test'
import { crc32 as zlibCrc32 } from 'node:zlib'

import { crc32 } from '../src/crc32'

describe('crc32', () => {
  test('matches the standard check value: "123456789" is cbf43926', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
    expect(crc32(new Uint8Array(0))).toBe(0)
  })

  test('agrees with zlib on random data of every length around the 8-byte blocks', () => {
    for (let length = 0; length < 40; length++) {
      const data = crypto.getRandomValues(new Uint8Array(length))
      expect(crc32(data)).toBe(zlibCrc32(data))
    }
    const big = crypto.getRandomValues(new Uint8Array(65_536 + 3))
    expect(crc32(big)).toBe(zlibCrc32(big))
  })

  test('can be computed in pieces', () => {
    const data = crypto.getRandomValues(new Uint8Array(1000))
    expect(crc32(data.subarray(300), crc32(data.subarray(0, 300)))).toBe(zlibCrc32(data))
  })
})
