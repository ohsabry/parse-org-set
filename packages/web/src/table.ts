import { formatDuration, instrumentTitle, type OrgFileSummary } from '@parse-org-set/core'

/** How each column is shown: numbers line up on the right; names keep their own direction. */
export const COLUMNS = ['number', 'number', 'text', 'text', 'number', 'name'] as const

/**
 * The instrument table's text: one row per instrument with its number, sample
 * count, note range, spacing, length and name. No page code here, so the
 * browser tests can compare what the page shows with it.
 */
export function tableRows(summary: OrgFileSummary): string[][] {
  const rows: string[][] = []
  for (const instrument of summary.instruments) {
    rows.push([
      String(instrument.number),
      instrument.sampleCount.toLocaleString('en-CA'),
      instrument.notes,
      instrument.spacing,
      formatDuration(instrument.seconds),
      instrumentTitle(instrument),
    ])
  }
  return rows
}
