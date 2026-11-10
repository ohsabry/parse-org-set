/**
 * Browser tests of the built page (packages/web/dist), in Chromium, Firefox
 * and WebKit (Safari's engine), so the security policy, the worker build and
 * the minified code are all exercised. Run with `bun run test:e2e`, which
 * builds the page first; plain `bun test` skips this file (it isn't named
 * *.test.ts), so it doesn't need browsers.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  count,
  defaultOutputFolder,
  formatDuration,
  instrumentTitle,
  parseOrgFile,
  planExtraction,
  planSimpleExtraction,
  summarizeOrgFile,
} from '@parse-org-set/core'
import { fakeFiles } from '@parse-org-set/test-fixtures'
import { buildSet, type FakeSample } from '@parse-org-set/test-fixtures'
import { unzipSync } from 'fflate'
import { chromium, firefox, webkit, type Browser, type BrowserType, type Page } from 'playwright'

const dist = join(import.meta.dir, '../dist')
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname
    return new Response(Bun.file(join(dist, path === '/' ? 'index.html' : path)))
  },
})

const silence = (name: string, rootNote: number, frames: number): FakeSample => ({
  name,
  rootNote,
  rate: 44100,
  channels: 1,
  audio: new Int16Array(frames),
})

const dir = mkdtempSync(join(tmpdir(), 'parse-org-set-e2e-'))
const setPath = join(dir, 'Test.Set')
writeFileSync(
  setPath,
  buildSet({
    instruments: [
      { name: '-', samples: [silence('Metronome', 0, 4410)] },
      // A hostile name: it must show as text, never become an element.
      { name: '<img src=x onerror=alert(1)>', samples: [silence('a', 60, 44100)] },
    ],
  }),
)
const fakes = fakeFiles()
for (const fake of fakes) {
  writeFileSync(join(dir, fake.name), fake.bytes)
}
// Big enough (about 40 MB) that reading it takes longer than a small file.
const bigPath = join(dir, 'Big.Set')
writeFileSync(
  bigPath,
  buildSet({ instruments: [{ name: '-', samples: [silence('long', 0, 20_000_000)] }] }),
)
const notSetPath = join(dir, 'notes.txt')
writeFileSync(notSetPath, 'These are my notes, not an ORG 24 file of any kind.')

afterAll(() => {
  void server.stop()
  rmSync(dir, { recursive: true, force: true })
})

/** Opens the page and records anything that would mean something broke. */
/** The table rows the page should show for a file: core's summary, laid out as the page does. */
function expectedRows(bytes: Uint8Array): string[][] {
  const rows: string[][] = []
  for (const row of summarizeOrgFile(parseOrgFile(bytes)).instruments) {
    rows.push([
      String(row.number),
      row.sampleCount.toLocaleString('en-CA'),
      row.notes,
      row.spacing,
      formatDuration(row.seconds),
      instrumentTitle(row),
    ])
  }
  return rows
}

/** The rows the page shows. */
async function shownRows(page: Page): Promise<(string | null)[][]> {
  return page
    .locator('#instruments tr')
    .evaluateAll((trs) =>
      trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent)),
    )
}

async function openPage(browser: Browser): Promise<{ page: Page; problems: string[] }> {
  const page = await browser.newPage()
  const problems: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      problems.push(message.text())
    }
  })
  page.on('pageerror', (error) => problems.push(error.message))
  page.on('dialog', (dialog) => {
    problems.push(`dialog: ${dialog.message()}`)
    void dialog.dismiss()
  })
  await page.goto(server.url.href)
  return { page, problems }
}

const browsers: [string, BrowserType][] = [
  ['Chromium', chromium],
  ['Firefox', firefox],
  ['WebKit', webkit],
]

for (const [name, type] of browsers) {
  describe(name, () => {
    let browser: Browser
    beforeAll(async () => {
      browser = await type.launch()
    })
    afterAll(async () => {
      await browser.close()
    })

    test('opens a set and shows its summary, with no errors', async () => {
      const { page, problems } = await openPage(browser)
      await page.setInputFiles('input[type=file]', setPath)
      await page.locator('#result').waitFor({ state: 'visible', timeout: 5000 })

      expect(await page.locator('#file-name').textContent()).toBe('Test.Set')
      expect(await page.locator('#overview').textContent()).toBe(
        'Version 1.3.1 · 2 instruments · 2 samples · 1.1 s of audio',
      )
      expect(await shownRows(page)).toEqual([
        ['1', '1', 'C-1', 'one sample', '0.1 s', 'Shots'],
        ['2', '1', 'C4', 'one sample', '1.0 s', '<img src=x onerror=alert(1)>'],
      ])
      expect(await page.locator('#result img').count()).toBe(0)
      expect(problems).toEqual([])
    })

    test('shows the same summary as core for every fake file', async () => {
      const { page, problems } = await openPage(browser)
      for (const fake of fakes) {
        await page.setInputFiles('input[type=file]', join(dir, fake.name))
        await page.locator('#file-name', { hasText: fake.name }).waitFor({ timeout: 5000 })
        expect({ file: fake.name, rows: await shownRows(page) }).toEqual({
          file: fake.name,
          rows: expectedRows(fake.bytes),
        })
      }
      expect(problems).toEqual([])
    })

    test('opens a file dropped on the box', async () => {
      const { page, problems } = await openPage(browser)
      const fake = fakes[0]
      if (fake === undefined) {
        throw new Error('No fake files')
      }
      // A drop carries the file in a DataTransfer, built inside the page.
      const dataTransfer = await page.evaluateHandle(
        ({ bytes, name }) => {
          const transfer = new DataTransfer()
          transfer.items.add(new File([new Uint8Array(bytes)], name))
          return transfer
        },
        { bytes: [...fake.bytes], name: fake.name },
      )
      await page.dispatchEvent('.drop', 'drop', { dataTransfer })
      await page.locator('#file-name', { hasText: fake.name }).waitFor({ timeout: 5000 })
      expect(await shownRows(page)).toEqual(expectedRows(fake.bytes))
      // The picker shows the dropped file too.
      const picked = await page
        .locator('input[type=file]')
        .evaluate((input: HTMLInputElement) => input.files?.[0]?.name)
      expect(picked).toBe(fake.name)
      expect(problems).toEqual([])
    })

    for (const options of [
      { simple: false, ascii: false },
      { simple: true, ascii: true },
    ]) {
      test(`downloads a zip holding what the CLI would write (${JSON.stringify(options)})`, async () => {
        const { page, problems } = await openPage(browser)
        const fake = fakes[0]
        if (fake === undefined) {
          throw new Error('No fake files')
        }
        await page.setInputFiles('input[type=file]', join(dir, fake.name))
        await page.locator('#result').waitFor({ state: 'visible', timeout: 5000 })
        await page.locator('input[name=simple]').setChecked(options.simple)
        await page.locator('input[name=ascii]').setChecked(options.ascii)

        // The same plan the CLI's extract makes, with the same options.
        const set = parseOrgFile(fake.bytes)
        const plan = options.simple
          ? planSimpleExtraction(fake.name, fake.bytes, set, { ascii: options.ascii })
          : planExtraction(fake.name, set, { ascii: options.ascii })
        const folder = defaultOutputFolder(
          fake.name,
          options,
          options.simple ? 'simple' : 'samples',
        )
        expect(await page.locator('#download').textContent()).toStartWith(
          `Download zip (${count(plan.files.length, 'WAV file')}, `,
        )

        const [download] = await Promise.all([
          page.waitForEvent('download'),
          page.locator('#download').click(),
        ])
        expect(download.suggestedFilename()).toBe(`${folder}.zip`)
        const zip = unzipSync(new Uint8Array(readFileSync(await download.path())))
        const files = Object.keys(zip).filter((name) => !name.endsWith('/'))
        expect(files.sort()).toEqual(
          [...plan.files.map((f) => `${folder}/${f.path}`), `${folder}/index.json`].sort(),
        )
        await page.locator('#status', { hasText: 'Saved' }).waitFor({ timeout: 5000 })
        expect(problems).toEqual([])
      })
    }

    test('shows the file picked last, even if an earlier one finishes reading later', async () => {
      const { page, problems } = await openPage(browser)
      const small = fakes[0]
      if (small === undefined) {
        throw new Error('No fake files')
      }
      await page.setInputFiles('input[type=file]', bigPath)
      await page.setInputFiles('input[type=file]', join(dir, small.name))
      await page.locator('#file-name', { hasText: small.name }).waitFor({ timeout: 5000 })
      // Give the big file time to finish too; it must not replace the small one.
      await page.waitForTimeout(1500)
      expect(await page.locator('#file-name').textContent()).toBe(small.name)
      expect(await shownRows(page)).toEqual(expectedRows(small.bytes))
      expect(problems).toEqual([])
    })

    test('says why a file is not a set', async () => {
      const { page, problems } = await openPage(browser)
      await page.setInputFiles('input[type=file]', notSetPath)
      await page.locator('#status.error').waitFor({ timeout: 5000 })

      expect(await page.locator('#status').textContent()).toStartWith(
        "Couldn't read notes.txt: Not a .Set or .Instrument file",
      )
      expect(await page.locator('#result').isHidden()).toBe(true)
      expect(problems).toEqual([])
    })
  })
}
