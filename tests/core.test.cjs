'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { deflateSync, inflateSync } = require('node:zlib');
const core = require('../core.js');
const password = 'aB12cD';
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// This independent PNG writer/reader uses Node zlib, not the browser codec.
function crc(bytes) {
  let result = 0xffffffff;
  for (const byte of bytes) {
    result ^= byte;
    for (let i = 0; i < 8; i++) result = result & 1 ? (result >>> 1) ^ 0xedb88320 : result >>> 1;
  }
  return (result ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const result = Buffer.alloc(bytes.length + 12);
  result.writeUInt32BE(bytes.length, 0);
  result.write(type, 4, 4, 'ascii');
  result.set(bytes, 8);
  result.writeUInt32BE(crc(result.subarray(4, -4)), result.length - 4);
  return result;
}
function png(width, height, filtered, extraChunks = []) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return new Blob([signature, chunk('IHDR', header), ...extraChunks,
    chunk('IDAT', deflateSync(filtered)), chunk('IEND', Buffer.alloc(0))], { type: 'image/png' });
}
async function readCarrier(blob) {
  const bytes = Buffer.from(await blob.arrayBuffer());
  assert.deepEqual(bytes.subarray(0, 8), signature);
  let offset = 8;
  const idat = [];
  let width, height;
  while (offset < bytes.length) {
    const size = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const contents = bytes.subarray(offset + 8, offset + 8 + size);
    assert.equal(bytes.readUInt32BE(offset + 8 + size), crc(bytes.subarray(offset + 4, offset + 8 + size)));
    if (type === 'IHDR') {
      width = contents.readUInt32BE(0);
      height = contents.readUInt32BE(4);
      assert.equal(contents[8], 8);
      assert.equal(contents[9], 2);
    }
    if (type === 'IDAT') idat.push(contents);
    offset += size + 12;
  }
  const filtered = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(width * height * 3);
  assert.equal(filtered.length, (width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    assert.equal(filtered[y * (width * 3 + 1)], 0);
    pixels.set(filtered.subarray(y * (width * 3 + 1) + 1, (y + 1) * (width * 3 + 1)), y * width * 3);
  }
  return { bytes, width, height, pixels };
}
function paeth(a, b, c) {
  const distances = [Math.abs(b - c), Math.abs(a - c), Math.abs(a + b - 2 * c)];
  return [a, b, c][distances.indexOf(Math.min(...distances))];
}
function rewrap(carrier, filters = [0]) {
  const { width, height, pixels } = carrier;
  const stride = width * 3;
  const filtered = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const filter = filters[y % filters.length];
    filtered[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x;
      const a = x >= 3 ? pixels[i - 3] : 0;
      const b = y ? pixels[i - stride] : 0;
      const c = y && x >= 3 ? pixels[i - stride - 3] : 0;
      const prediction = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter];
      filtered[y * (stride + 1) + x + 1] = (pixels[i] - prediction) & 255;
    }
  }
  return png(width, height, filtered);
}
function file(bytes, name = 'photo.png', type = 'image/png') { return new File([bytes], name, { type }); }
const hasCode = code => error => error instanceof core.PicvertError && error.code === code;

test('actual PNG image recovers byte for byte, including its filename and type', async () => {
  const original = Buffer.from(await png(1, 1, Buffer.from([0, 255, 120, 80]),
    [chunk('tEXt', Buffer.from('Comment\0Original embedded metadata survives.'))]).arrayBuffer());
  const carrier = await core.encryptFile(file(original, 'summer photo.png'), password);
  assert.equal(carrier.type, 'image/png');
  const parsed = await readCarrier(carrier);
  assert.equal(parsed.pixels.toString('ascii', 0, 7), 'PICVERT');
  const recovered = await core.decryptImage(carrier, password);
  assert.deepEqual(Buffer.from(recovered.bytes), original);
  assert.equal(recovered.name, 'summer photo.png');
  assert.equal(recovered.type, 'image/png');
});

test('random binary bytes and Unicode filename survive the complete PNG pipeline', async () => {
  const original = randomBytes(250123);
  const carrier = await core.encryptFile(file(original, '旅行🌅与家人.heic', 'image/heic'), password);
  const recovered = await core.decryptImage(carrier, password);
  assert.deepEqual(Buffer.from(recovered.bytes), original);
  assert.equal(recovered.name, '旅行🌅与家人.heic');
  assert.equal(recovered.type, 'image/heic');
  const raw = (await readCarrier(carrier)).pixels;
  assert.equal(raw.includes(Buffer.from('旅行')), false, 'filename is encrypted');
  assert.equal(raw.includes(Buffer.from('image/heic')), false, 'MIME type is encrypted');
});

test('one- and six-character passcodes accept letters and numbers regardless of case', async () => {
  const original = Buffer.from('short passcode image bytes');
  for (const [chosen, entered] of [['x', 'X'], ['Z', 'z'], ['0', '0'], ['a1B2c3', 'A1b2C3']]) {
    const carrier = await core.encryptFile(file(original), chosen);
    const recovered = await core.decryptImage(carrier, entered);
    assert.deepEqual(Buffer.from(recovered.bytes), original);
  }
});

test('existing v1 image restores with its original case-sensitive Unicode password', async () => {
  // Created with the original 12-character-minimum core before short codes were added.
  const legacyPassword = 'Legacy MixedCase 雪山!';
  const original = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSioAAAAASUVORK5CYII=', 'base64');
  const carrier = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAFCAIAAADDivseAAABAElEQVR4nAH1AAr/AFBJQ1ZFUlQAAQEAQAAJJ8AAAACwUePeo0gINc9KlL/kIOAAlIUqTMAGfXZ+IYrvagAAAAAQAAAABQAAAAAAAAAAA0cp7u+xWlZCm3VN4ToQ+kIzjLi+fsemc5WumS0jVykAdXN64By0i8f/V2Ks35kVrVoxU7TuIWRFsb3ygSMX5I0bw/QETvdf3iR9sO0JVPl7AFSzhmX61ejC1YK0uxKQ2pmydaCCefYQxaAGA7YyvlzqNhJfMWhX993hks7C+gsNkQB1E7cGz79QuRUWZEAWWk2MJBgOgnn6u0RxZvndRyaI1bP/EltIut4yrE6v3b7CaTMNaGqTvmoyfAAAAABJRU5ErkJggg==', 'base64')]);
  const recovered = await core.decryptImage(carrier, legacyPassword);
  assert.deepEqual(Buffer.from(recovered.bytes), original);
  assert.equal(recovered.name, 'legacy 雪.png');
  assert.equal(recovered.type, 'image/png');
  await assert.rejects(core.decryptImage(carrier, legacyPassword.toUpperCase()), hasCode('DECRYPT_FAILED'));
});

test('same image/password produces a different salt, IV, and ciphertext on every encryption', async () => {
  const input = file(randomBytes(400));
  const first = (await readCarrier(await core.encryptFile(input, password))).pixels;
  const second = (await readCarrier(await core.encryptFile(input, password))).pixels;
  assert.notDeepEqual(first.subarray(20, 36), second.subarray(20, 36));
  assert.notDeepEqual(first.subarray(36, 48), second.subarray(36, 48));
  assert.notDeepEqual(first.subarray(64), second.subarray(64));
});

test('wrong password fails authentication without returning file content', async () => {
  const carrier = await core.encryptFile(file(randomBytes(100)), password);
  await assert.rejects(core.decryptImage(carrier, 'wrong password 123'), hasCode('DECRYPT_FAILED'));
  await assert.rejects(core.decryptImage(carrier, 'short'), hasCode('DECRYPT_FAILED'));
});

test('authenticated header, ciphertext, and final padding reject tampering after PNG CRCs are repaired', async () => {
  const carrier = await readCarrier(await core.encryptFile(file(randomBytes(200)), password));
  for (const position of [20, 36, 64, carrier.pixels.length - 17]) {
    const mutated = { ...carrier, pixels: Buffer.from(carrier.pixels) };
    mutated.pixels[position] ^= 1;
    await assert.rejects(core.decryptImage(rewrap(mutated), password), hasCode('DECRYPT_FAILED'));
  }
});

test('standard PNG filters 0–4 reconstruct identical encrypted bytes', async () => {
  const original = randomBytes(4096);
  const carrier = await readCarrier(await core.encryptFile(file(original), password));
  const recovered = await core.decryptImage(rewrap(carrier, [0, 1, 2, 3, 4]), password);
  assert.deepEqual(Buffer.from(recovered.bytes), original);
});

test('invalid version, KDF parameters, length, and dimensions are rejected before deriving keys', async () => {
  const carrier = await readCarrier(await core.encryptFile(file(randomBytes(200)), password));
  for (const [position, value, code] of [[8, 2, 'UNSUPPORTED_VERSION'], [12, 255, 'INVALID_HEADER'],
    [16, 255, 'INVALID_HEADER'], [48, 255, 'INVALID_HEADER'], [56, 1, 'INVALID_HEADER']]) {
    const mutated = { ...carrier, pixels: Buffer.from(carrier.pixels) };
    mutated.pixels[position] = value;
    await assert.rejects(core.decryptImage(rewrap(mutated), password), hasCode(code));
  }
});

test('oversized files are rejected without reading or allocating their advertised content', async () => {
  let read = false;
  const fake = { name: 'huge.png', type: 'image/png', size: core.MAX_FILE_BYTES + 1,
    arrayBuffer() { read = true; throw new Error('must not read'); } };
  await assert.rejects(core.encryptFile(fake, password), hasCode('FILE_SIZE'));
  fake.size = core.MAX_CARRIER_BYTES + 1;
  await assert.rejects(core.decryptImage(fake, password), hasCode('CARRIER_SIZE'));
  assert.equal(read, false);
});

test('PNG decompression is bounded by validated dimensions', async () => {
  await assert.rejects(core.decryptImage(png(1, 1, Buffer.alloc(2000000)), password), hasCode('INVALID_PNG'));
  await assert.rejects(core.decryptImage(png(0xffffffff, 0xffffffff, Buffer.alloc(4)), password), hasCode('INVALID_PNG'));
  await assert.rejects(core.decryptImage(png(4096, 4096, Buffer.alloc(4)), password), hasCode('INVALID_PNG'));
  await assert.rejects(core.decryptImage(png(16, 16, Buffer.alloc(4)), password), hasCode('INVALID_PNG'));
});

test('PNG CRC errors, malformed lengths, trailing data, ordinary images, and invalid filters fail safely', async () => {
  const carrier = await core.encryptFile(file(randomBytes(400)), password);
  const bytes = Buffer.from(await carrier.arrayBuffer());
  const corrupt = Buffer.from(bytes);
  corrupt[45] ^= 1;
  await assert.rejects(core.decryptImage(new Blob([corrupt]), password), hasCode('INVALID_PNG'));
  const badLength = Buffer.from(bytes);
  badLength.writeUInt32BE(0xffffffff, 8);
  await assert.rejects(core.decryptImage(new Blob([badLength]), password), hasCode('INVALID_PNG'));
  await assert.rejects(core.decryptImage(new Blob([bytes, Buffer.from([0])]), password), hasCode('INVALID_PNG'));
  await assert.rejects(core.decryptImage(png(16, 16, Buffer.alloc(16 * 49)), password), hasCode('NOT_PICVERT'));
  const scanlines = Buffer.alloc(16 * 49);
  scanlines[0] = 5;
  await assert.rejects(core.decryptImage(png(16, 16, scanlines), password), hasCode('INVALID_PNG'));
});

test('password and metadata boundaries reject active file types, path names, and overlong strings', async () => {
  const input = file(randomBytes(10));
  for (const invalid of ['', '1234567', 'with space', 'abc!', '雪山', 'é', 'abc\n', null, 123456]) {
    await assert.rejects(core.encryptFile(input, invalid), error => {
      assert.equal(error.message, 'Use 1–6 letters or numbers.');
      return hasCode('INVALID_PASSCODE')(error);
    });
  }
  await assert.rejects(core.decryptImage(input, '🦊'.repeat(257)), hasCode('PASSWORD_TOO_LONG'));
  await assert.rejects(core.decryptImage(input, ''), hasCode('PASSWORD_REQUIRED'));
  await assert.rejects(core.encryptFile(file('svg', 'image.svg', 'image/svg+xml'), password), hasCode('UNSUPPORTED_FILE'));
  await assert.rejects(core.encryptFile(file('<html>', 'image.png', 'text/html'), password), hasCode('UNSUPPORTED_FILE'));
  await assert.rejects(core.encryptFile({ ...input, size: 1, name: '../photo.png', type: 'image/png', arrayBuffer: async () => new ArrayBuffer(1) }, password), hasCode('INVALID_FILENAME'));
  await assert.rejects(core.encryptFile(file('x', `${'x'.repeat(1024)}.png`), password), hasCode('INVALID_FILENAME'));
});

test('empty MIME type receives a safe raster fallback without changing the bytes', async () => {
  const carrier = await core.encryptFile(file('bytes with EXIF and other metadata', 'photo.JPEG', ''), password);
  const recovered = await core.decryptImage(carrier, password);
  assert.equal(recovered.type, 'image/jpeg');
  assert.equal(Buffer.from(recovered.bytes).toString(), 'bytes with EXIF and other metadata');
});
