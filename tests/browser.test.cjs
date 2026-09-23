'use strict';

// Optional browser integration test. Requires Playwright and a running static server.
// PICVERT_TEST_URL=http://127.0.0.1:8765 node tests/browser.test.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { deflateSync } = require('node:zlib');
const { createHash } = require('node:crypto');

const baseURL = process.env.PICVERT_TEST_URL || 'http://127.0.0.1:8765/';
const outputDir = path.resolve('test-results');
const password = 'cobalt meadow canoe comet 27';

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length);
  result.write(type, 4);
  result.set(data, 8);
  result.writeUInt32BE(crc32(result.subarray(4, -4)), result.length - 4);
  return result;
}
function fixture() {
  const size = 160;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const rows = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * (size * 3 + 1) + 1 + x * 3;
    rows[i] = x; rows[i + 1] = y; rows[i + 2] = (x ^ y) + 70;
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr),
    chunk('tEXt', Buffer.from('Comment\0Synthetic test metadata must survive unchanged.')),
    chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
async function saveDownload(page, name) {
  const pending = page.waitForEvent('download');
  await page.locator('#download-link').click();
  const download = await pending;
  assert.equal(await download.failure(), null);
  const destination = path.join(outputDir, name);
  await download.saveAs(destination);
  return { destination, filename: download.suggestedFilename() };
}

(async () => {
  await fs.mkdir(outputDir, { recursive: true });
  const original = fixture();
  const errors = [];
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(baseURL);
    assert.equal(await page.locator('#support-error').isVisible(), false);
    assert.equal(await page.locator('#controls').isDisabled(), false);
    await page.screenshot({ path: path.join(outputDir, 'desktop-empty.png'), fullPage: true });
    const network = [];
    context.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
    await context.setOffline(true);
    await page.locator('#file-input').setInputFiles({ name: 'original-photo.png', mimeType: 'image/png', buffer: original });
    await page.locator('#password').fill(password);
    await page.locator('#confirm-password').fill('wrong confirmation');
    await page.locator('#submit-button').click();
    assert.match(await page.locator('#confirm-password').evaluate(element => element.validationMessage), /do not match/);
    await page.locator('#confirm-password').fill(password);
    await page.locator('#submit-button').click();
    await page.locator('#download-link').waitFor({ state: 'visible' });
    assert.match(await page.locator('#status').textContent(), /Encrypted/);
    await page.waitForFunction(() => document.querySelector('#result-image').naturalWidth > 0);
    const encrypted = await saveDownload(page, 'encrypted.png');
    assert.equal(encrypted.filename, 'picvert-encrypted.png');
    await page.screenshot({ path: path.join(outputDir, 'desktop-encrypted.png'), fullPage: true });
    assert.deepEqual(network, [], 'Encrypt/download must make no HTTP requests, even offline.');

    // A separate browser context represents the friend: no memory, password or key is shared.
    const recipient = await browser.newContext({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
    const friend = await recipient.newPage();
    friend.on('pageerror', error => errors.push(error.message));
    await friend.goto(baseURL);
    const recipientNetwork = [];
    recipient.on('request', request => { if (/^https?:/.test(request.url())) recipientNetwork.push(request.url()); });
    await recipient.setOffline(true);
    await friend.locator('#restore-mode').click();
    await friend.locator('#file-input').setInputFiles(encrypted.destination);
    assert.equal(await friend.locator('#source-preview').isVisible(), false);
    await friend.locator('#password').fill('the wrong password');
    await friend.locator('#submit-button').click();
    await friend.waitForFunction(() => document.querySelector('#status').classList.contains('error'));
    assert.match(await friend.locator('#status').textContent(), /incorrect|damaged/);
    assert.equal(await friend.locator('#download-link').isVisible(), false);
    await friend.locator('#password').fill(password);
    await friend.locator('#submit-button').click();
    await friend.locator('#download-link').waitFor({ state: 'visible' });
    const restored = await saveDownload(friend, 'restored.png');
    assert.equal(restored.filename, 'original-photo.png');
    const restoredBytes = await fs.readFile(restored.destination);
    assert.deepEqual(restoredBytes, original);
    await friend.screenshot({ path: path.join(outputDir, 'desktop-restored.png'), fullPage: true });
    assert.deepEqual(recipientNetwork, [], 'Restore/download must make no HTTP requests, even offline.');
    assert.equal(await friend.evaluate(() => localStorage.length + sessionStorage.length), 0);

    // Navigating away resets private state, including a page restored from the back/forward cache.
    await friend.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    assert.equal(await friend.locator('#download-link').isVisible(), false);
    assert.equal(await friend.locator('#password').inputValue(), '');
    assert.equal(await friend.locator('#submit-button').isDisabled(), true);
    await friend.locator('#file-input').setInputFiles({ name: 'ordinary.png', mimeType: 'image/png', buffer: original });
    await friend.locator('#password').fill(password);
    await friend.locator('#submit-button').click();
    await friend.waitForFunction(() => document.querySelector('#status').classList.contains('error'));
    assert.equal(await friend.locator('#download-link').isVisible(), false);

    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 2 });
    const small = await mobile.newPage();
    await small.goto(baseURL);
    assert.equal(await small.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await small.screenshot({ path: path.join(outputDir, 'mobile.png'), fullPage: true });
    // Narrow-screen restore works with the same saved carrier and original password.
    await small.locator('#restore-mode').click();
    await small.locator('#file-input').setInputFiles(encrypted.destination);
    await small.locator('#password').fill(password);
    await small.locator('#submit-button').click();
    await small.locator('#download-link').waitFor({ state: 'visible' });
    assert.equal(await small.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await small.screenshot({ path: path.join(outputDir, 'mobile-restored.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'passed', browser: await browser.version(), originalBytes: original.length,
      sha256: createHash('sha256').update(restoredBytes).digest('hex'),
      checks: ['password confirmation', 'offline encryption and PNG download', 'independent recipient context', 'wrong password rejection', 'exact original download with metadata', 'no HTTP requests during processing', 'no browser storage', 'pagehide state reset', 'ordinary PNG rejection', '390px mobile restore'],
      screenshots: outputDir }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
