/** Thrown when bytes aren't a .Set or .Instrument file we can read, or use a version we don't support. */
export class OrgFormatError extends Error {
  /** Byte offset where the problem was found. */
  readonly offset: number

  constructor(message: string, offset: number) {
    super(message)
    this.name = 'OrgFormatError'
    this.offset = offset
  }
}
