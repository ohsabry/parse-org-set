import { SetFormatError } from './errors/set-format-error'
import type { ByteReader } from './reader'

const TITLE = 'music studio music'

/**
 * Reads the start of the file header and returns the version, for example
 * '1.3.1'. Throws SetFormatError if it isn't a .Set file or isn't version 1.3.x.
 *
 * Layout: a 32-byte null-padded title, a uint32 length, then the version text
 * (for example "\r1.3.1\r").
 */
export function readFileHeader(reader: ByteReader): string {
  if (reader.length < 36) {
    throw new SetFormatError(`Too short to be a .Set file (${reader.length} bytes)`, 0)
  }
  reader.seek(0)
  const title = reader.utf8(32)
  // 1.3.x writes "music", 1.4.9 can write "Music".
  if (title.toLowerCase() !== TITLE) {
    throw new SetFormatError(`Not a .Set file: it starts with ${JSON.stringify(title)}`, 0)
  }

  const textLength = reader.u32()
  if (textLength > 64 || 36 + textLength > reader.length) {
    throw new SetFormatError(`Version text length ${textLength} doesn't make sense`, 32)
  }
  // Split on "\r" and drop the empty pieces: "\r1.3.1\r" → "1.3.1".
  const version = reader
    .utf8(textLength)
    .split('\r')
    .filter((part) => part !== '')
    .join('\r')

  if (!/^1\.3\.\d+$/.test(version)) {
    throw new SetFormatError(
      `Version ${JSON.stringify(version)} isn't supported yet (only 1.3.x)`,
      36,
    )
  }
  return version
}
