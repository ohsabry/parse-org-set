/**
 * Puts results on the page. Everything shown here can come from a user's file
 * (file and instrument names), so it's only ever set with textContent, never
 * as HTML.
 */
import { describeSummary, formatDuration, type SetSummary } from '@parse-org-set/core'

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector)
  if (found === null) {
    throw new Error(`The page is missing ${selector}`)
  }
  return found
}

const status = element<HTMLParagraphElement>('#status')
const result = element<HTMLElement>('#result')
const fileName = element<HTMLHeadingElement>('#file-name')
const overview = element<HTMLParagraphElement>('#overview')
const rows = element<HTMLTableSectionElement>('#instruments')

/** A message under the drop box, read out by screen readers. */
export function showStatus(text: string, isError = false): void {
  status.textContent = text
  status.classList.toggle('error', isError)
}

export function hideResult(): void {
  result.hidden = true
}

export function showSummary(name: string, summary: SetSummary): void {
  fileName.textContent = name
  overview.textContent = describeSummary(summary)

  const fragment = document.createDocumentFragment()
  for (const instrument of summary.instruments) {
    const row = document.createElement('tr')
    const layers = instrument.layerCount === 0 ? '' : ` (+${instrument.layerCount})`
    const cells: [string, string?][] = [
      [String(instrument.number), 'number'],
      [instrument.sampleCount.toLocaleString('en-CA'), 'number'],
      [instrument.notes],
      [instrument.spacing],
      [formatDuration(instrument.seconds), 'number'],
      [`${instrument.name}${layers}`, 'name'],
    ]
    for (const [text, kind] of cells) {
      const cell = document.createElement('td')
      cell.textContent = text
      if (kind !== undefined) {
        cell.className = kind
      }
      // Arabic names read right to left inside the left-to-right table.
      if (kind === 'name') {
        cell.dir = 'auto'
      }
      row.append(cell)
    }
    fragment.append(row)
  }
  rows.replaceChildren(fragment)
  result.hidden = false
}
