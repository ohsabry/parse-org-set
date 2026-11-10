/**
 * The page's own code: takes a file from the picker or a drop, hands it to a
 * worker, and shows what comes back.
 *
 * Each file gets a fresh worker. Picking another file stops the old one, so
 * nothing it was still doing (reading a big file, making a zip) can finish
 * later and replace what's on the page.
 */
import { count } from '@parse-org-set/core'

import type { DownloadSize, PageRequest, WorkerReply, ZipOptions } from './protocol'
import {
  formatSize,
  hideProgress,
  hideResult,
  showDownload,
  showProgress,
  showStatus,
  showSummary,
} from './render'

// The worker is built as its own file next to the page. The build writes its
// hashed name in place of WORKER_FILE (see scripts/build.ts); the dev server
// serves it as worker.js. It's found relative to the page's address, so it
// works from a subfolder like ohsabry.github.io/parse-org-set/ too.
declare const WORKER_FILE: string | undefined
const workerFile = typeof WORKER_FILE === 'string' ? WORKER_FILE : 'worker.js'
const workerUrl = new URL(workerFile, document.baseURI).href

/**
 * The page's security policy turns on Trusted Types: the browser only loads
 * a script (a worker counts) from a URL that a named policy approved. This
 * policy, the only one the security policy allows, approves exactly one URL:
 * our own worker. Browsers without Trusted Types take the plain URL.
 */
function trustedWorkerUrl(url: string): string {
  const trustedTypes = (window as { trustedTypes?: TrustedTypes }).trustedTypes
  if (trustedTypes === undefined) {
    return url
  }
  const policy = trustedTypes.createPolicy('worker', {
    createScriptURL: (input) => {
      if (input !== url) {
        throw new TypeError(`Refusing to load a script from ${input}`)
      }
      return input
    },
  })
  // A TrustedScriptURL, which the Worker constructor accepts in place of a string.
  return policy.createScriptURL(url) as unknown as string
}

// TypeScript's DOM types don't include Trusted Types yet; just what's used here.
interface TrustedTypes {
  createPolicy(
    name: string,
    rules: { createScriptURL: (input: string) => string },
  ): { createScriptURL(input: string): unknown }
}

// Approved once: the security policy allows the "worker" policy to be created only once.
const trustedUrl = trustedWorkerUrl(workerUrl)

/** The worker for the file open now, if any. */
let worker: Worker | undefined

/** Stops the current worker, if any, and starts a fresh one. */
function startWorker(): Worker {
  worker?.terminate()
  const fresh = new Worker(trustedUrl, { type: 'module' })
  // A message the old worker sent just before it was stopped may still
  // arrive; only the current worker's count.
  fresh.addEventListener('message', (event: MessageEvent<WorkerReply>) => {
    if (fresh === worker) {
      handle(event.data)
    }
  })
  fresh.addEventListener('error', () => {
    if (fresh === worker) {
      hideProgress()
      showStatus('Something went wrong. Reload the page and try again.', true)
    }
  })
  worker = fresh
  return fresh
}

/** The open file's download sizes, once the worker has read it. */
let sizes: { all: DownloadSize; simple: DownloadSize } | undefined
let zipping = false

function handle(reply: WorkerReply): void {
  if (reply.type === 'progress') {
    showProgress(reply.done / reply.total)
    return
  }
  hideProgress()
  if (reply.type === 'opened') {
    sizes = reply.sizes
    showStatus('')
    showSummary(reply.fileName, reply.summary)
  } else if (reply.type === 'zipped') {
    zipping = false
    save(reply.zip, `${reply.zipName}.zip`)
    showStatus(`Saved ${reply.zipName}.zip`)
  } else {
    zipping = false
    showStatus(reply.message, true)
  }
  updateDownload()
}

function send(message: PageRequest): void {
  worker?.postMessage(message)
}

function open(file: File | undefined): void {
  if (file === undefined) {
    return
  }
  sizes = undefined
  zipping = false
  hideResult()
  showStatus(`Reading ${file.name}…`)
  showProgress() // reading a file has no measurable progress, so the bar just moves
  startWorker().postMessage({ type: 'open', file } satisfies PageRequest)
}

const simple = checkbox('simple')
const ascii = checkbox('ascii')

function checkbox(name: string): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>(`.options input[name="${name}"]`)
  if (found === null) {
    throw new Error(`The page is missing the ${name} option`)
  }
  return found
}

function options(): ZipOptions {
  return { simple: simple.checked, ascii: ascii.checked }
}

/** The button shows what you'd get: "Download zip (258 WAV files, 45 MB)". */
function updateDownload(): void {
  if (zipping) {
    showDownload('Making the zip…', false)
    return
  }
  let size: DownloadSize | undefined
  if (sizes !== undefined) {
    size = simple.checked ? sizes.simple : sizes.all
  }
  if (size === undefined) {
    showDownload('Download zip', false)
    return
  }
  showDownload(`Download zip (${count(size.files, 'WAV file')}, ${formatSize(size.bytes)})`, true)
}

simple.addEventListener('change', updateDownload)

document.querySelector('#download')?.addEventListener('click', () => {
  if (sizes === undefined || zipping) {
    return
  }
  zipping = true
  updateDownload()
  showStatus('Making the zip…')
  showProgress(0)
  send({ type: 'zip', options: options() })
})

/** Saves a Blob as a download, through a temporary link to it. */
function save(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  // Freeing the link right away can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

const drop = document.querySelector<HTMLLabelElement>('.drop')
const input = drop?.querySelector<HTMLInputElement>('input[type="file"]')
if (drop == null || input == null) {
  throw new Error('The page is missing its drop box')
}

input.addEventListener('change', () => open(input.files?.[0]))

// Dragging a file over the box highlights it; dropping opens the file.
// preventDefault is what tells the browser the box accepts drops.
drop.addEventListener('dragover', (event) => {
  event.preventDefault()
  drop.classList.add('over')
})
drop.addEventListener('dragleave', () => drop.classList.remove('over'))
drop.addEventListener('drop', (event) => {
  event.preventDefault()
  drop.classList.remove('over')
  const files = event.dataTransfer?.files
  if (files !== undefined && files.length > 0) {
    // Show the dropped file in the picker too. Setting files this way doesn't
    // fire "change", so the file isn't opened twice.
    input.files = files
  }
  open(files?.[0])
})

// A file dropped anywhere else would make the browser leave the page to open
// it, so drops outside the box are ignored.
for (const type of ['dragover', 'drop']) {
  window.addEventListener(type, (event) => event.preventDefault())
}
