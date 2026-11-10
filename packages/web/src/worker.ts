/**
 * Runs in a background thread, so reading, parsing and zipping a big set never
 * freezes the page. It reads the file itself (the page only passes a handle),
 * plans the downloads, then lets the bytes go: the zip is built from slices
 * of the file on disk, so a big set isn't held in memory while you choose.
 */
import {
  OrgFormatError,
  defaultOutputFolder,
  parseOrgFile,
  planExtraction,
  planSimpleExtraction,
  summarizeOrgFile,
  type ExtractionPlan,
} from '@parse-org-set/core'

import type { DownloadSize, PageRequest, WorkerReply, ZipOptions } from './protocol'
import { zipExtraction, zipSize } from './zip'

// The page's TypeScript setup types `self` as a window. In a worker it's the
// worker's own scope, which has the same postMessage and message events as a
// Worker object, so it's typed as that.
const scope = self as unknown as Pick<Worker, 'postMessage' | 'addEventListener'>

/** The four downloads: every sample or "Fewer files", each with or without English letters. */
type PlanKey = `${'all' | 'simple'}-${'original' | 'ascii'}`

/** The file open right now: a handle to it on disk, and its planned downloads. */
let current: { file: File; plans: Record<PlanKey, ExtractionPlan> } | undefined

function reply(message: WorkerReply): void {
  scope.postMessage(message)
}

scope.addEventListener('message', (event: MessageEvent<PageRequest>) => {
  const request = event.data
  if (request.type === 'open') {
    void open(request.file)
  } else {
    void zip(request.options)
  }
})

// The page starts a fresh worker for every file it opens, so this worker only
// ever handles one file and never has to worry about another replacing it.
async function open(file: File): Promise<void> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const set = parseOrgFile(bytes)
    // Plan every download now, while the bytes are here: "Fewer files" reads
    // the audio to skip duplicate drum sounds. After this, only the plans
    // (names and offsets) and the file handle are kept.
    const plans = {
      'all-original': planExtraction(file.name, set),
      'all-ascii': planExtraction(file.name, set, { ascii: true }),
      'simple-original': planSimpleExtraction(file.name, bytes, set),
      'simple-ascii': planSimpleExtraction(file.name, bytes, set, { ascii: true }),
    }
    current = { file, plans }
    const sizes = {
      all: sizeOf({ simple: false, ascii: false }),
      simple: sizeOf({ simple: true, ascii: false }),
    }
    reply({ type: 'opened', fileName: file.name, summary: summarizeOrgFile(set), sizes })
  } catch (error) {
    fail(error, `Couldn't read ${file.name}`)
  }
}

async function zip(options: ZipOptions): Promise<void> {
  if (current === undefined) {
    reply({ type: 'failed', message: 'Open a file first.' })
    return
  }
  try {
    const zipName = folderFor(current.file.name, options)
    // Report progress at most about 10 times a second.
    let lastReport = 0
    const onProgress = (done: number, total: number): void => {
      const now = performance.now()
      if (now - lastReport > 100 || done === total) {
        lastReport = now
        reply({ type: 'progress', done, total })
      }
    }
    const blob = await zipExtraction(current.file, planFor(options), zipName, onProgress)
    // Posting a Blob to the page passes a handle; nothing is copied.
    reply({ type: 'zipped', zip: blob, zipName })
  } catch (error) {
    fail(error, "Couldn't make the zip")
  }
}

function planFor(options: ZipOptions): ExtractionPlan {
  if (current === undefined) {
    throw new Error('No file is open')
  }
  const key: PlanKey = `${options.simple ? 'simple' : 'all'}-${options.ascii ? 'ascii' : 'original'}`
  return current.plans[key]
}

/** The zip's top folder, also its name: what the CLI calls its default folder. */
function folderFor(fileName: string, options: ZipOptions): string {
  return defaultOutputFolder(
    fileName,
    { ascii: options.ascii },
    options.simple ? 'simple' : 'samples',
  )
}

function sizeOf(options: ZipOptions): DownloadSize {
  const plan = planFor(options)
  const fileName = current?.file.name ?? ''
  return { files: plan.files.length, bytes: zipSize(plan, folderFor(fileName, options)).bytes }
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
