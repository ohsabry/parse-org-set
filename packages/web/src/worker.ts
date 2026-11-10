/**
 * Runs in a background thread, so reading and parsing a big set never freezes
 * the page. It reads the file itself: the page only passes a handle.
 */
import { SetFormatError, parseSet, summarizeSet } from '@parse-org-set/core'

import type { OpenFile, WorkerReply } from './protocol'

// The page's TypeScript setup types `self` as a window. In a worker it's the
// worker's own scope, which has the same postMessage and message events as a
// Worker object, so it's typed as that.
const scope = self as unknown as Pick<Worker, 'postMessage' | 'addEventListener'>

function reply(message: WorkerReply): void {
  scope.postMessage(message)
}

scope.addEventListener('message', (event: MessageEvent<OpenFile>) => {
  void open(event.data.file)
})

async function open(file: File): Promise<void> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const set = parseSet(bytes)
    reply({ type: 'opened', fileName: file.name, summary: summarizeSet(set) })
  } catch (error) {
    // A file that doesn't fit the format says why. Anything else is a bug.
    if (!(error instanceof SetFormatError)) {
      console.error(error)
    }
    const message =
      error instanceof SetFormatError ? error.message : 'Something went wrong reading this file.'
    reply({ type: 'failed', fileName: file.name, message })
  }
}
