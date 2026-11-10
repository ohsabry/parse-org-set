/**
 * CRC-32, the checksum every zip entry carries (the same one gzip and PNG
 * use). It's the remainder of dividing the data, seen as one huge binary
 * number, by a fixed 33-bit polynomial (0xEDB88320 in its bit-reversed form).
 *
 * The simple way processes one byte per step with a 256-entry table: the
 * table holds, for each possible byte, what dividing it out does to the
 * remainder. "Slice-by-8" processes 8 bytes per step with 8 such tables (table
 * t answers "this byte, followed by t zero bytes"), so the 8 lookups don't
 * wait on each other. It gives the same result, about 4 times faster.
 */

const POLYNOMIAL = 0xedb88320

// TABLES[0] is the classic one-byte table; TABLES[t] is a byte followed by t zero bytes.
const TABLES: Uint32Array[] = []
for (let t = 0; t < 8; t++) {
  TABLES.push(new Uint32Array(256))
}
const [T0, T1, T2, T3, T4, T5, T6, T7] = TABLES as [
  Uint32Array,
  Uint32Array,
  Uint32Array,
  Uint32Array,
  Uint32Array,
  Uint32Array,
  Uint32Array,
  Uint32Array,
]
for (let n = 0; n < 256; n++) {
  let c = n
  for (let bit = 0; bit < 8; bit++) {
    c = c & 1 ? POLYNOMIAL ^ (c >>> 1) : c >>> 1
  }
  T0[n] = c >>> 0
}
for (let n = 0; n < 256; n++) {
  for (let t = 1; t < 8; t++) {
    const previous = TABLES[t - 1]?.[n] ?? 0
    const table = TABLES[t]
    if (table !== undefined) {
      table[n] = (T0[previous & 0xff] ?? 0) ^ (previous >>> 8)
    }
  }
}

/**
 * The CRC-32 of `data`. Pass the result for the data before it as `previous`
 * to checksum something in pieces: crc32(b, crc32(a)) equals crc32(a + b).
 */
export function crc32(data: Uint8Array, previous = 0): number {
  // The standard CRC-32 inverts the remainder before and after.
  let crc = ~previous
  let i = 0
  const lastBlock = data.length - 8
  for (; i <= lastBlock; i += 8) {
    // The first 4 bytes are folded into the remainder; the next 4 aren't yet.
    const word =
      ((data[i] ?? 0) |
        ((data[i + 1] ?? 0) << 8) |
        ((data[i + 2] ?? 0) << 16) |
        ((data[i + 3] ?? 0) << 24)) ^
      crc
    crc =
      (T7[word & 0xff] ?? 0) ^
      (T6[(word >>> 8) & 0xff] ?? 0) ^
      (T5[(word >>> 16) & 0xff] ?? 0) ^
      (T4[word >>> 24] ?? 0) ^
      (T3[data[i + 4] ?? 0] ?? 0) ^
      (T2[data[i + 5] ?? 0] ?? 0) ^
      (T1[data[i + 6] ?? 0] ?? 0) ^
      (T0[data[i + 7] ?? 0] ?? 0)
  }
  for (; i < data.length; i++) {
    crc = (T0[(crc ^ (data[i] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8)
  }
  return ~crc >>> 0
}
