import { OutOfBoundsError } from './errors/out-of-bounds-error'

// Not `fatal`: invalid UTF-8 (for example a character cut in half by a
// fixed-width field) becomes U+FFFD "�" instead of throwing.
const utf8Decoder = new TextDecoder('utf-8')

/**
 * Reads little-endian numbers and text from bytes, keeping track of the
 * position. Every read checks bounds first and moves the position forward.
 */
export class ByteReader {
  readonly #bytes: Uint8Array
  readonly #view: DataView
  #offset = 0

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes
    // A Uint8Array can be a window onto a larger buffer, so the DataView must
    // start where the window starts, not at the start of the whole buffer.
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  /** Where the next read happens. */
  get offset(): number {
    return this.#offset
  }

  get length(): number {
    return this.#bytes.length
  }

  /** Jumps to `offset`. Seeking to `length` (just past the last byte) is allowed. */
  seek(offset: number): void {
    if (!Number.isInteger(offset) || offset < 0 || offset > this.length) {
      throw new OutOfBoundsError(offset, 0, this.length)
    }
    this.#offset = offset
  }

  skip(count: number): void {
    this.#take(count)
  }

  u8(): number {
    return this.#view.getUint8(this.#take(1))
  }

  /** 2 bytes, little-endian (low byte first): `80 BB` is 0xBB80 = 48000. */
  u16(): number {
    return this.#view.getUint16(this.#take(2), true)
  }

  /** 4 bytes, little-endian: `44 AC 00 00` is 0x0000AC44 = 44100. */
  u32(): number {
    return this.#view.getUint32(this.#take(4), true)
  }

  /** The next `count` bytes as a view onto the same memory (not a copy). */
  bytes(count: number): Uint8Array {
    const start = this.#take(count)
    return this.#bytes.subarray(start, start + count)
  }

  /**
   * A fixed-width text field: reads exactly `width` bytes and decodes them as
   * UTF-8 up to the first null byte.
   */
  utf8(width: number): string {
    const field = this.bytes(width)
    const end = field.indexOf(0)
    return utf8Decoder.decode(end === -1 ? field : field.subarray(0, end))
  }

  /** Checks that `count` bytes are available, advances, and returns where they start. */
  #take(count: number): number {
    const start = this.#offset
    if (!Number.isInteger(count) || count < 0 || start + count > this.length) {
      throw new OutOfBoundsError(start, count, this.length)
    }
    this.#offset = start + count
    return start
  }
}
