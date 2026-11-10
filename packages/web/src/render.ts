/**
 * Puts results on the page. Everything shown here can come from a user's file
 * (file and instrument names), so it's only ever set with textContent, never
 * as HTML.
 */
import { count, describeSummary, formatDuration, type SetSummary } from '@parse-org-set/core'

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
const download = element<HTMLButtonElement>('#download')

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
  // Each part ("4 min 43 s of audio") stays on one line; lines break between parts.
  const parts: (Node | string)[] = []
  for (const [i, text] of describeSummary(summary).split(' · ').entries()) {
    const part = document.createElement('span')
    part.className = 'nowrap'
    part.textContent = text
    parts.push(...(i === 0 ? [part] : [' · ', part]))
  }
  overview.replaceChildren(...parts)

  const fragment = document.createDocumentFragment()
  for (const instrument of summary.instruments) {
    const row = document.createElement('tr')
    const layers = instrument.layerCount === 0 ? '' : ` (+${count(instrument.layerCount, 'layer')})`
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

/** The download button's label, and whether it can be pressed. */
export function showDownload(label: string, enabled: boolean): void {
  download.textContent = label
  download.disabled = !enabled
}

/** "820 KB", "4.2 MB", "703 MB", "1.2 GB", in the same units as Finder and Explorer's size column. */
export function formatSize(bytes: number): string {
  const units: [number, string][] = [
    [1e9, 'GB'],
    [1e6, 'MB'],
    [1e3, 'KB'],
  ]
  for (const [size, unit] of units) {
    if (bytes >= size) {
      const value = bytes / size
      return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${unit}`
    }
  }
  return `${bytes} bytes`
}
