import {
  describeSpacing,
  formatDuration,
  instrumentLabel,
  noteRange,
  totalSeconds,
  type SetFile,
} from '@parse-org-set/core'

import { count } from './utils'

/** What `inspect` prints: a header line, then one row per instrument. */
export function formatSummary(fileName: string, set: SetFile): string {
  const table: string[][] = [['#', 'Samples', 'Notes', 'Spacing', 'Duration', 'Instrument']]
  let sampleCount = 0
  let seconds = 0

  for (const [i, instrument] of set.instruments.entries()) {
    // Notes and spacing describe the main samples; counts and durations
    // include the instrument's extra layers too.
    const roots = instrument.samples.map((s) => s.rootNote)
    const all = [...instrument.samples]
    for (const layer of instrument.layers) {
      all.push(...layer.samples)
    }
    const instrumentSeconds = totalSeconds(all)
    sampleCount += all.length
    seconds += instrumentSeconds
    const name = instrumentLabel(set, i)
    const layers = instrument.layers.length
    table.push([
      String(i + 1),
      String(all.length),
      noteRange(roots),
      describeSpacing(roots),
      formatDuration(instrumentSeconds),
      layers === 0 ? name : `${name} (+${count(layers, 'layer')})`,
    ])
  }

  const parts = [
    `Version ${set.version}`,
    count(set.instruments.length, 'instrument'),
    count(sampleCount, 'sample'),
    `${formatDuration(seconds)} of audio`,
  ]
  if (set.poolEntries > 0) {
    parts.push(`${count(set.poolEntries, 'shared sound')} in the sample pool`)
  }
  const header = parts.join(' · ')
  return [fileName, header, '', ...formatTable(table)].join('\n')
}

/**
 * Pads every column except the last to its widest cell: the first two
 * (numbers) on the right, the rest on the left. The last column holds names,
 * which go unpadded because Arabic text and emoji don't take predictable
 * widths in a terminal.
 */
function formatTable(table: string[][]): string[] {
  const widths: number[] = []
  for (const row of table) {
    for (const [column, cell] of row.entries()) {
      widths[column] = Math.max(widths[column] ?? 0, cell.length)
    }
  }

  const lines: string[] = []
  for (const row of table) {
    const cells: string[] = []
    for (const [column, cell] of row.entries()) {
      const width = widths[column] ?? 0
      if (column === row.length - 1) {
        cells.push(cell)
      } else if (column <= 1) {
        cells.push(cell.padStart(width))
      } else {
        cells.push(cell.padEnd(width))
      }
    }
    lines.push(cells.join('  '))
  }
  return lines
}
