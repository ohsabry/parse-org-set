/** Thrown when bytes don't match the .Set format, or use a version we don't support. */
export class SetFormatError extends Error {
  /** Byte offset where the problem was found. */
  readonly offset: number

  constructor(message: string, offset: number) {
    super(message)
    this.name = 'SetFormatError'
    this.offset = offset
  }
}
