import {
  describeSummary,
  formatDuration,
  instrumentTitle,
  summarizeOrgFile,
  type OrgFile,
} from '@parse-org-set/core'

/** What `inspect` prints: a header line, then one row per instrument. */
export function formatSummary(fileName: string, set: OrgFile): string {
  const summary = summarizeOrgFile(set)
  const table: string[][] = [['#', 'Samples', 'Notes', 'Spacing', 'Duration', 'Instrument']]
  for (const row of summary.instruments) {
    table.push([
      String(row.number),
      String(row.sampleCount),
      row.notes,
      row.spacing,
      formatDuration(row.seconds),
      instrumentTitle(row),
    ])
  }

  const header = describeSummary(summary)
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
