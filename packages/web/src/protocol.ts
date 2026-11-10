import type { OrgFileSummary } from '@parse-org-set/core'

// The messages the page and the worker send each other. postMessage copies
// them with the structured clone algorithm, so they're plain data. A File or
// a Blob is only a handle: passing one copies none of its contents.

/** The two choices on the page, the same as the CLI's --simple and --ascii. */
export interface ZipOptions {
  /** One sample per melodic instrument and every distinct drum sound. */
  simple: boolean
  /** English letters only in folder and file names. */
  ascii: boolean
}

/** What a download would be: its file count and exact size. */
export interface DownloadSize {
  files: number
  bytes: number
}

/** From the page to the worker. */
export type PageRequest = { type: 'open'; file: File } | { type: 'zip'; options: ZipOptions }

/** From the worker to the page. */
export type WorkerReply =
  | {
      type: 'opened'
      fileName: string
      summary: OrgFileSummary
      /** For every sample, and with "Fewer files". */
      sizes: { all: DownloadSize; simple: DownloadSize }
    }
  | { type: 'zipped'; zip: Blob; zipName: string }
  | { type: 'failed'; message: string }
  /** While making a zip: how many of its WAV files are done. */
  | { type: 'progress'; done: number; total: number }
