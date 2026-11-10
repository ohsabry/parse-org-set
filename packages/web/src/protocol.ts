import type { SetSummary } from '@parse-org-set/core'

// The messages the page and the worker send each other. postMessage copies
// them with the structured clone algorithm, so they're plain data; a File is
// only a handle, so passing one copies none of its contents.

/** From the page to the worker. */
export interface OpenFile {
  type: 'open'
  file: File
}

/** From the worker to the page. */
export type WorkerReply =
  | { type: 'opened'; fileName: string; summary: SetSummary }
  | { type: 'failed'; fileName: string; message: string }
