# How the web page works

The page (`packages/web`) opens an ORG 24 `.Set` or `.Instrument` file, shows what's inside, and
saves the samples as a zip of WAV files, the same files the CLI's `extract` writes. Everything
runs in the browser: the file is never uploaded, and the page couldn't upload it if it tried (see
[the security policy](#the-security-policy)).

## The pieces

```
index.html ── style.css
   │
   └── main.ts ─────────────── the page's own code (the "main thread")
         ├── render.ts         puts results on the page (text only, never HTML)
         ├── table.ts          the instrument table's text
         └── new Worker(…) ──► worker.ts ── a second thread, for the slow work (one per file)
                                 ├── @parse-org-set/core   parse the file, plan the downloads
                                 ├── zip.ts                build the zip
                                 └── crc32.ts              the checksum every zip entry needs
protocol.ts: the messages the two threads send each other
```

A browser page has one main thread. It draws the page and runs its code, so any long task on it
freezes the page. Reading and parsing a 700 MB set, then building its zip,
takes seconds, so that work runs in a worker: a separate thread with no access to the page, which
talks to it only by passing messages. The page stays responsive the whole time.

## The messages

Messages are copied between the threads (the browser's "structured clone"), so they're plain
data. A `File` or `Blob` is an exception that makes this cheap: it's a handle to data, not the
data, so passing one copies nothing.

```
page                                        worker
 │  { type: 'open', file }            ───►  read the file, parse it, plan the 4 downloads
 │                                    ◄───  { type: 'opened', fileName, summary, sizes }
 │  { type: 'zip', options }          ───►  build the zip for those options
 │                                    ◄───  { type: 'progress', done, total }   (while zipping)
 │                                    ◄───  { type: 'zipped', zip: Blob, zipName }
 │                                    ◄───  { type: 'failed', message }   (either step)
```

- `open`: the page sends the `File` you picked or dropped. The worker reads it, parses it with
  core, and replies with a summary (the table) and the size of each download.
- `zip`: the page sends the two options ("Fewer files", "English letters in file names").
- `progress`: while zipping, how many WAV files are done, at most about 10 times a second, for the
  progress bar. Reading a file has no measurable progress, so meanwhile the bar just moves.
- `zipped`: the finished zip as a `Blob`, which the page saves through a temporary link.
- `failed`: a file that isn't a `.Set`, a broken one, or a set too big for a zip. The message is
  shown under the drop box.

Each file gets a fresh worker. Picking another file stops the old worker (`terminate()`) and
starts a new one. Whatever the old one was doing (reading a big file, making a zip) stops with it,
so it can't finish later and replace what's on the page. A message it sent just before being
stopped may still arrive, so the page ignores messages from any worker but the current one.

## What the worker does with a file

1. **Read and parse.** The whole file is read into memory once, and core's `parseOrgFile` walks
   it: instruments, samples, where each sample's audio sits in the file.
2. **Plan every download.** It works out all four downloads now (every sample or "Fewer files",
   each with or without English-letter names), with the same functions the CLI uses. Each plan is
   a list of file names and, for each, which bytes of the original file hold its audio. "Fewer
   files" needs the audio itself to skip duplicate drum sounds, which is why it's planned while
   the bytes are in memory.
3. **Let the bytes go.** Only the plans (names and offsets) and the `File` handle are kept, so a
   700 MB set isn't held in memory while you choose options.
4. **Build the zip, when asked**, without copying the audio (`zip.ts`):

   ```
   [header][name][data]  [header][name][data]  …   [table of contents]   [end record]
   ```

   A zip is a list of entries, then a table of contents saying where each one is, then a short
   record saying where that table is. Ours are stored uncompressed (WAV audio barely compresses)
   with their sizes known up front, so each entry is just a 30-byte header, the file name, then the
   data. A WAV's data is a 44-byte WAV header followed by the sample's audio, and the audio is
   `file.slice(start, end)`: a piece of the original file that the browser reads from disk only
   when it saves the zip. So the zip itself takes almost no memory.

   The one thing that needs the audio is each entry's **CRC-32**, a checksum unzip tools use to
   detect damage. The worker reads one sample at a time to work it out, then lets it go.
   `crc32.ts` processes 8 bytes per step with 8 lookup tables ("slice-by-8"), about 4 times faster
   than the textbook one-byte method.

The zips come out byte for byte the same as the CLI's folders: every path, every WAV, and
`index.json`. The browser tests check that on the fake files in all three engines; real sets
(every version, up to 700 MB) were checked the same way by hand.

## Building and the dev server

Bun turns the TypeScript into plain JavaScript (removing the types, bundling the imports into one
file) before any browser sees it, in the dev server and in the build alike.

- **`bun run web`** (`scripts/dev.ts`) serves the page at `http://127.0.0.1:3000`, reachable only
  from this computer. Bun's server bundles `index.html`, its CSS and `main.ts` on the fly and
  reloads the page when a file is saved. Bun's HTML bundling doesn't build workers, so the dev
  server builds `worker.ts` itself whenever the page asks for `/worker.js`.
- **`bun run web:build`** (`scripts/build.ts`) writes the finished site to `packages/web/dist`:
  1. It builds the worker on its own, named after a hash of its contents (`worker-ajak2gen.js`).
  2. It builds the page, writing the worker's exact name into `main.ts` in place of `WORKER_FILE`.
     Every file's name changes whenever its contents do. Browsers cache files for a while, so with
     a fixed name, someone returning right after an update could get a new page with an old
     worker.
  3. It adds the security policy below, and copies `robots.txt` and `sitemap.xml`.
  4. File references are relative (`./chunk-….js`), so the site works from a subfolder like
     `ohsabry.github.io/parse-org-set/`.

## The security policy

The built page carries a Content-Security-Policy: rules the browser enforces about what the page
may load and do. It's added at build time, not in `index.html`, because the dev server injects a
small inline script for live reloading, which the policy would block.

| Rule                                    | What it means                                                                                                                      |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `default-src 'none'`                    | Start from nothing allowed; each kind of resource below is opened up separately                                                    |
| `script-src 'self'`                     | Scripts only from the page's own files. No inline scripts and no other sites, so injected code can't run                           |
| `style-src 'self'`                      | Stylesheets only from its own files                                                                                                |
| `img-src 'self' data:`                  | Images from its own files, plus the icon written inline in the page                                                                |
| `worker-src 'self'`                     | The worker only from its own files                                                                                                 |
| `connect-src 'none'`                    | **No network requests at all.** Even a bug or a compromised dependency couldn't send a file anywhere                               |
| `base-uri 'none'`, `form-action 'none'` | No `<base>` tag to redirect relative links, and no forms that submit anywhere                                                      |
| `require-trusted-types-for 'script'`    | The browser refuses strings where code could get in (HTML via `innerHTML`, script URLs) unless an approved policy vouches for them |
| `trusted-types worker`                  | The only such policy allowed: `main.ts`'s, which approves exactly one URL, the worker's                                            |

Alongside it, `<meta name="referrer" content="no-referrer">` keeps the page's address out of
requests when someone follows a link, and everything from a file (file and instrument names) is
put on the page with `textContent`, never as HTML.

One gap: GitHub Pages can't send custom headers, and `frame-ancestors` (which stops other sites
from showing the page inside theirs) only works as a header. The page has no accounts or actions
to trick someone into, so the risk is small; a host that sends headers, like Cloudflare Pages,
would close it.

## Tests

- **Unit tests** (`packages/web/test`, run by `bun test`): the zip is checked by two readers we
  didn't write (Info-ZIP's `unzip -t` and fflate's reader), and CRC-32 against zlib.
- **Browser tests** (`packages/web/e2e`, run by `bun run test:e2e`): the built page in Chromium,
  Firefox and WebKit, through Playwright. They open every fake file, compare the table with core's
  summary, drop a file on the box, check poisoned names stay text, and download zips whose every
  byte must match what the CLI writes.
