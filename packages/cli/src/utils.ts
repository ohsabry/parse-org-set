/** "1 sample", "1,336 samples". */
export function count(n: number, noun: string): string {
  return `${n.toLocaleString('en-US')} ${noun}${n === 1 ? '' : 's'}`
}
