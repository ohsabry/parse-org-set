/** Thrown for problems the user can fix, such as an output folder that isn't empty. */
export class ExtractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExtractError'
  }
}
