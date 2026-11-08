/** Thrown when a read or seek would go outside the data. */
export class OutOfBoundsError extends RangeError {
  readonly offset: number
  readonly wanted: number
  readonly length: number

  constructor(offset: number, wanted: number, length: number) {
    super(
      wanted === 0
        ? `Offset ${offset} is outside the data (${plural(length)} long)`
        : `Wanted ${plural(wanted)} at offset ${offset}, but the data is ${plural(length)} long`,
    )
    this.name = 'OutOfBoundsError'
    this.offset = offset
    this.wanted = wanted
    this.length = length
  }
}

function plural(count: number): string {
  return `${count} byte${count === 1 ? '' : 's'}`
}
