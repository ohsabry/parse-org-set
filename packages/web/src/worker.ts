/**
 * Runs in a background thread, so reading, parsing and zipping a big set never
 * freezes the page. It reads the file itself (the page only passes a handle)
 * and keeps it, to build the zip when asked.
 */
import {
  OrgFormatError,
  defaultOutputFolder,
  parseOrgFile,
  planExtraction,
  planSimpleExtraction,
  summarizeOrgFile,
  type ExtractionPlan,
  type OrgFile,
} from '@parse-org-set/core'

import type { DownloadSize, PageRequest, WorkerReply, ZipOptions } from './protocol'
import { zipExtraction, zipSize } from './zip'

// The page's TypeScript setup types `self` as a window. In a worker it's the
// worker's own scope, which has the same postMessage and message events as a
// Worker object, so it's typed as that.
const scope = self as unknown as Pick<Worker, 'postMessage' | 'addEventListener'>

/** The file open right now, kept for building its zip. */
let current: { fileName: string; bytes: Uint8Array; set: OrgFile } | undefined
/**
 * Counts open requests. Reading a file takes a while, so a big file picked
 * first can finish after a small one picked next; only the latest request's
 * result is used.
 */
let latestOpen = 0

function reply(message: WorkerReply): void {
  scope.postMessage(message)
}

scope.addEventListener('message', (event: MessageEvent<PageRequest>) => {
  const request = event.data
  if (request.type === 'open') {
    void open(request.file)
  } else {
    zip(request.options)
  }
})

async function open(file: File): Promise<void> {
  const request = ++latestOpen
  current = undefined
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (request !== latestOpen) {
      return // another file was picked meanwhile
    }
    const set = parseOrgFile(bytes)
    current = { fileName: file.name, bytes, set }
    const sizes = {
      all: sizeOf({ simple: false, ascii: false }),
      simple: sizeOf({ simple: true, ascii: false }),
    }
    reply({ type: 'opened', fileName: file.name, summary: summarizeOrgFile(set), sizes })
  } catch (error) {
    if (request === latestOpen) {
      fail(error, `Couldn't read ${file.name}`)
    }
  }
}

function zip(options: ZipOptions): void {
  if (current === undefined) {
    reply({ type: 'failed', message: 'Open a file first.' })
    return
  }
  try {
    const plan = planFor(options)
    const zipName = folderFor(options)
    const parts = zipExtraction(current.bytes, plan, zipName)
    // A Blob made from the parts. Posting it to the page passes a handle. The
    // parts are views of plain ArrayBuffers (the file's, and fflate's own),
    // never shared memory, which is what Blob's type asks for.
    const blob = new Blob(parts as Uint8Array<ArrayBuffer>[], { type: 'application/zip' })
    reply({ type: 'zipped', zip: blob, zipName })
  } catch (error) {
    fail(error, "Couldn't make the zip")
  }
}

/** The same plans as the CLI's extract, with or without --simple and --ascii. */
function planFor(options: ZipOptions): ExtractionPlan {
  if (current === undefined) {
    throw new Error('No file is open')
  }
  const { fileName, bytes, set } = current
  return options.simple
    ? planSimpleExtraction(fileName, bytes, set, { ascii: options.ascii })
    : planExtraction(fileName, set, { ascii: options.ascii })
}

/** The zip's top folder, also its name: what the CLI calls its default folder. */
function folderFor(options: ZipOptions): string {
  const fileName = current?.fileName ?? ''
  return defaultOutputFolder(
    fileName,
    { ascii: options.ascii },
    options.simple ? 'simple' : 'samples',
  )
}

function sizeOf(options: ZipOptions): DownloadSize {
  const plan = planFor(options)
  return { files: plan.files.length, bytes: zipSize(plan, folderFor(options)).bytes }
}

/** A file that doesn't fit the format, or a zip that's too big, says why. Anything else is a bug. */
function fail(error: unknown, context: string): void {
  const expected = error instanceof OrgFormatError || error instanceof RangeError
  if (!expected) {
    console.error(error)
  }
  const reason = expected ? error.message : 'something went wrong.'
  reply({ type: 'failed', message: `${context}: ${reason}` })
}
