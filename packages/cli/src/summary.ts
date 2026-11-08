import { describeSpacing, noteName, type Sample, type SetFile } from '@parse-org-set/core'

/** What `inspect` prints: a header line, then one row per instrument. */
export function formatSummary(fileName: string, set: SetFile): string {
  const table: string[][] = [['#', 'Samples', 'Notes', 'Spacing', 'Duration', 'Instrument']]
  let sampleCount = 0
  let seconds = 0

  for (const [i, instrument] of set.instruments.entries()) {
    const roots = instrument.samples.map((s) => s.rootNote)
    const instrumentSeconds = totalSeconds(instrument.samples)
    sampleCount += instrument.samples.length
    seconds += instrumentSeconds
    table.push([
      String(i + 1),
      String(instrument.samples.length),
      noteRange(roots),
      describeSpacing(roots),
      formatDuration(instrumentSeconds),
      // The first group's header is named "-"; we call it Shots.
      i === 0 ? 'Shots' : instrument.name,
    ])
  }

  const header = [
    `Version ${set.version}`,
    count(set.instruments.length, 'instrument'),
    count(sampleCount, 'sample'),
    `${formatDuration(seconds)} of audio`,
  ].join(' · ')
  return [fileName, header, '', ...formatTable(table)].join('\n')
}

/** For example "0.4 s", "38 s", "2 min 7 s" or "1 h 2 min". */
export function formatDuration(seconds: number): string {
  if (seconds < 10) {
    return `${seconds.toFixed(1)} s`
  }
  const whole = Math.round(seconds)
  if (whole < 60) {
    return `${whole} s`
  }
  if (whole < 3600) {
    return `${Math.floor(whole / 60)} min ${whole % 60} s`
  }
  return `${Math.floor(whole / 3600)} h ${Math.floor((whole % 3600) / 60)} min`
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

function totalSeconds(samples: Sample[]): number {
  let seconds = 0
  for (const sample of samples) {
    seconds += sample.frames / sample.sampleRate
  }
  return seconds
}

function noteRange(roots: number[]): string {
  if (roots.length === 0) {
    return '-'
  }
  const low = noteName(Math.min(...roots))
  const high = noteName(Math.max(...roots))
  return low === high ? low : `${low}–${high}`
}

function count(n: number, noun: string): string {
  return `${n.toLocaleString('en-US')} ${noun}${n === 1 ? '' : 's'}`
}
