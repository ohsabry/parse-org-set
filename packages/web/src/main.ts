/**
 * The page's own code: takes a file from the picker or a drop, hands it to the
 * worker, and shows what comes back.
 */
import type { OpenFile, WorkerReply } from './protocol'
import { hideResult, showStatus, showSummary } from './render'

// The worker is built as its own file next to the page (see scripts/build.ts).
// It's found relative to the page's address, so it works from a subfolder
// like ohsabry.github.io/parse-org-set/ too.
const workerUrl = new URL('worker.js', document.baseURI).href
const worker = new Worker(trustedWorkerUrl(workerUrl), { type: 'module' })

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

worker.addEventListener('message', (event: MessageEvent<WorkerReply>) => {
  const reply = event.data
  if (reply.type === 'opened') {
    showStatus('')
    showSummary(reply.fileName, reply.summary)
  } else {
    showStatus(`Couldn't read ${reply.fileName}: ${reply.message}`, true)
  }
})
worker.addEventListener('error', () => {
  showStatus('Something went wrong. Reload the page and try again.', true)
})

function open(file: File | undefined): void {
  if (file === undefined) {
    return
  }
  hideResult()
  showStatus(`Reading ${file.name}…`)
  const message: OpenFile = { type: 'open', file }
  worker.postMessage(message)
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
  open(event.dataTransfer?.files[0])
})

// A file dropped anywhere else would make the browser leave the page to open
// it, so drops outside the box are ignored.
for (const type of ['dragover', 'drop']) {
  window.addEventListener(type, (event) => event.preventDefault())
}
