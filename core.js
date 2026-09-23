/* Picvert format v1. No network, storage, canvas, or third-party dependencies.
 * PNG: https://www.w3.org/TR/png-3/
 * Cryptography: https://www.w3.org/TR/webcrypto/
 */
(function (root) {
  'use strict';

  const MAX_FILE_BYTES = 20 * 1024 * 1024;
  const MAX_CARRIER_BYTES = 22 * 1024 * 1024;
  const MIN_PASSWORD_LENGTH = 1;
  const MAX_PASSCODE_LENGTH = 6;
  const MAX_PASSWORD_BYTES = 1024;
  const MAX_NAME_BYTES = 1024;
  const MAX_METADATA_BYTES = 4096;
  const MAX_DIMENSION = 4096;
  const HEADER_BYTES = 64;
  const TAG_BYTES = 16;
  const ITERATIONS = 600000;
  const MAX_PIXEL_BYTES = MAX_FILE_BYTES + MAX_METADATA_BYTES + 8 + HEADER_BYTES + TAG_BYTES + MAX_DIMENSION * 3;
  const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const MAGIC = new Uint8Array([80, 73, 67, 86, 69, 82, 84, 0]);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const EXTENSION_TYPES = Object.freeze({
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
    gif: 'image/gif', avif: 'image/avif', heic: 'image/heic', heif: 'image/heif',
    bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', ico: 'image/x-icon'
  });
  const MIME_TYPES = new Set([...Object.values(EXTENSION_TYPES), 'image/vnd.microsoft.icon', 'image/x-ms-bmp', 'image/heic-sequence', 'image/heif-sequence']);

  class PicvertError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'PicvertError';
      this.code = code;
    }
  }
  function fail(code, message) { throw new PicvertError(code, message); }
  function isSupported() {
    return Boolean(root.crypto && root.crypto.subtle && root.crypto.getRandomValues &&
      root.CompressionStream && root.DecompressionStream && root.Blob);
  }
  function requireSupport() {
    if (!isSupported()) fail('UNSUPPORTED_BROWSER', 'This browser needs Web Crypto and Compression Streams. Use a current browser over HTTPS or localhost.');
  }
  function passwordBytes(password, encrypting) {
    const isPasscode = typeof password === 'string' && password.length >= MIN_PASSWORD_LENGTH &&
      password.length <= MAX_PASSCODE_LENGTH && !/[^a-z0-9]/i.test(password);
    if (encrypting && !isPasscode) fail('INVALID_PASSCODE', 'Use 1–6 letters or numbers.');
    if (typeof password !== 'string' || password.length === 0) fail('PASSWORD_REQUIRED', 'Enter the passcode.');
    if (password.length > MAX_PASSWORD_BYTES) fail('PASSWORD_TOO_LONG', 'The password must fit within 1,024 UTF-8 bytes.');
    // Earlier v1 outputs required at least 12 characters. Keep those passwords
    // verbatim; only the new short alphanumeric passcodes ignore letter case.
    const bytes = encoder.encode(isPasscode ? password.toUpperCase() : password);
    if (bytes.length > MAX_PASSWORD_BYTES) fail('PASSWORD_TOO_LONG', 'The password must fit within 1,024 UTF-8 bytes.');
    return bytes;
  }
  function fileMetadata(name, type) {
    if (typeof name !== 'string' || !name || name.length > MAX_NAME_BYTES ||
        encoder.encode(name).length > MAX_NAME_BYTES || /[\\/\u0000-\u001f\u007f]/u.test(name)) {
      fail('INVALID_FILENAME', 'Use a filename of at most 1,024 UTF-8 bytes without path separators or control characters.');
    }
    const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
    if (!Object.hasOwn(EXTENSION_TYPES, extension) || name.lastIndexOf('.') < 0) {
      fail('UNSUPPORTED_FILE', 'Choose a PNG, JPEG, WebP, GIF, AVIF, HEIC, HEIF, BMP, TIFF, or ICO image.');
    }
    if (typeof type !== 'string' || type.length > 128 || (type && !MIME_TYPES.has(type))) {
      fail('UNSUPPORTED_FILE', 'This file has an unsupported image type. SVG and HTML are not supported.');
    }
    return { name, type: type || EXTENSION_TYPES[extension] };
  }
  function view(bytes) { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  function equalAt(bytes, expected, offset = 0) {
    return expected.every((byte, index) => bytes[offset + index] === byte);
  }
  function fillRandom(bytes) {
    for (let offset = 0; offset < bytes.length; offset += 65536) {
      root.crypto.getRandomValues(bytes.subarray(offset, Math.min(offset + 65536, bytes.length)));
    }
  }
  async function deriveKey(password, salt, usage) {
    const material = await root.crypto.subtle.importKey('raw', password, 'PBKDF2', false, ['deriveKey']);
    return root.crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
      material, { name: 'AES-GCM', length: 256 }, false, [usage]);
  }

  // The entire header is GCM additional authenticated data. Layout (big endian):
  // magic[8], version[1], suite[1], flags[1], headerLength[1], iterations[4],
  // cipherLength[4], salt[16], IV[12], width[4], height[4], reserved[8].
  function createHeader(cipherLength, width, height) {
    const header = new Uint8Array(HEADER_BYTES);
    header.set(MAGIC);
    header[8] = 1;
    header[9] = 1;
    header[11] = HEADER_BYTES;
    const data = view(header);
    data.setUint32(12, ITERATIONS);
    data.setUint32(16, cipherLength);
    fillRandom(header.subarray(20, 48));
    data.setUint32(48, width);
    data.setUint32(52, height);
    return header;
  }

  // PNG CRC covers the chunk type and chunk data, per the PNG specification.
  const CRC_TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    CRC_TABLE[n] = c >>> 0;
  }
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  function chunk(type, data) {
    const result = new Uint8Array(data.length + 12);
    const header = view(result);
    header.setUint32(0, data.length);
    result.set(encoder.encode(type), 4);
    result.set(data, 8);
    header.setUint32(result.length - 4, crc32(result.subarray(4, result.length - 4)));
    return result;
  }
  async function readStreamBounded(stream, limit, exact = false) {
    const reader = stream.getReader();
    let output = exact ? new Uint8Array(limit) : null;
    const pieces = [];
    let count = 0;
    let ended = false;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) { ended = true; break; }
        if (value.length > limit - count) fail('INVALID_PNG', 'The PNG expands beyond its permitted image size.');
        if (exact) output.set(value, count);
        else pieces.push(value);
        count += value.length;
      }
      if (exact && count !== limit) fail('INVALID_PNG', 'The PNG image data is incomplete.');
      if (!exact) {
        output = new Uint8Array(count);
        let offset = 0;
        for (const piece of pieces) {
          output.set(piece, offset);
          offset += piece.length;
        }
      }
      return output;
    } finally {
      if (!ended) await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  async function encodePNG(pixels, width, height) {
    const rowBytes = width * 3;
    const filtered = new Uint8Array((rowBytes + 1) * height);
    for (let y = 0; y < height; y++) filtered.set(pixels.subarray(y * rowBytes, (y + 1) * rowBytes), y * (rowBytes + 1) + 1);
    const stream = new Blob([filtered]).stream().pipeThrough(new root.CompressionStream('deflate'));
    const compressed = await readStreamBounded(stream, MAX_CARRIER_BYTES - 57);
    const ihdr = new Uint8Array(13);
    view(ihdr).setUint32(0, width);
    view(ihdr).setUint32(4, height);
    ihdr[8] = 8;
    ihdr[9] = 2; // RGB, no alpha or colour-management conversion.
    return new Blob([PNG_SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', new Uint8Array())], { type: 'image/png' });
  }
  function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  }
  async function decodePNG(bytes) {
    if (bytes.length < 57 || !equalAt(bytes, PNG_SIGNATURE)) fail('INVALID_PNG', 'Choose the original encrypted PNG downloaded from Picvert.');
    const data = view(bytes);
    const idat = [];
    let offset = 8, width = 0, height = 0, seenIHDR = false, seenIDAT = false, endedIDAT = false, seenIEND = false;
    let chunks = 0;
    while (offset < bytes.length) {
      if (++chunks > 4096 || bytes.length - offset < 12) fail('INVALID_PNG', 'The PNG chunk structure is invalid.');
      const length = data.getUint32(offset);
      if (length > bytes.length - offset - 12) fail('INVALID_PNG', 'The PNG contains a truncated chunk.');
      const typeBytes = bytes.subarray(offset + 4, offset + 8);
      if (!typeBytes.every(byte => (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122)) || (typeBytes[2] & 32)) {
        fail('INVALID_PNG', 'The PNG contains an invalid chunk type.');
      }
      const type = String.fromCharCode(...typeBytes);
      const contents = bytes.subarray(offset + 8, offset + 8 + length);
      if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== data.getUint32(offset + 8 + length)) {
        fail('INVALID_PNG', 'The PNG is damaged or has been modified. Send the original file again.');
      }
      if (!seenIHDR && type !== 'IHDR') fail('INVALID_PNG', 'The PNG is missing its image header.');
      if (type === 'IHDR') {
        if (seenIHDR || length !== 13) fail('INVALID_PNG', 'The PNG image header is invalid.');
        seenIHDR = true;
        width = view(contents).getUint32(0);
        height = view(contents).getUint32(4);
        if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION || width * height * 3 > MAX_PIXEL_BYTES) {
          fail('INVALID_PNG', 'The PNG dimensions exceed the supported carrier size.');
        }
        if (contents[8] !== 8 || contents[9] !== 2 || contents[10] !== 0 || contents[11] !== 0 || contents[12] !== 0) {
          fail('INVALID_PNG', 'This is not an original Picvert RGB PNG. Resizing or converting an encrypted image can destroy its contents.');
        }
      } else if (type === 'IDAT') {
        if (endedIDAT) fail('INVALID_PNG', 'The PNG image chunks are out of order.');
        seenIDAT = true;
        idat.push(contents);
      } else if (type === 'IEND') {
        if (!seenIDAT || length !== 0 || offset + 12 !== bytes.length) fail('INVALID_PNG', 'The PNG ending is invalid.');
        seenIEND = true;
      } else {
        // Unknown critical chunks and animated PNGs are not valid carriers.
        if (!(typeBytes[0] & 32) || ['acTL', 'fcTL', 'fdAT', 'tRNS'].includes(type)) fail('INVALID_PNG', 'This PNG format is not a supported Picvert carrier.');
        if (seenIDAT) endedIDAT = true;
      }
      offset += length + 12;
    }
    if (!seenIEND) fail('INVALID_PNG', 'The PNG is incomplete.');
    const rowBytes = width * 3;
    let filtered;
    try {
      const stream = new Blob(idat).stream().pipeThrough(new root.DecompressionStream('deflate'));
      filtered = await readStreamBounded(stream, (rowBytes + 1) * height, true);
    } catch (error) {
      if (error instanceof PicvertError) throw error;
      fail('INVALID_PNG', 'The PNG image data is damaged or invalid.');
    }
    const pixels = new Uint8Array(rowBytes * height);
    for (let y = 0; y < height; y++) {
      const source = y * (rowBytes + 1);
      const target = y * rowBytes;
      const filter = filtered[source];
      if (filter > 4) fail('INVALID_PNG', 'The PNG uses an invalid scanline filter.');
      for (let x = 0; x < rowBytes; x++) {
        const a = x >= 3 ? pixels[target + x - 3] : 0;
        const b = y > 0 ? pixels[target + x - rowBytes] : 0;
        const c = y > 0 && x >= 3 ? pixels[target + x - rowBytes - 3] : 0;
        const predictor = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : paeth(a, b, c);
        pixels[target + x] = (filtered[source + 1 + x] + predictor) & 255;
      }
    }
    return { pixels, width, height };
  }

  async function encryptFile(file, password) {
    requireSupport();
    const secret = passwordBytes(password, true);
    if (!file || typeof file.arrayBuffer !== 'function' || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_FILE_BYTES) {
      fail('FILE_SIZE', 'Choose a nonempty image no larger than 20 MiB.');
    }
    const metadata = fileMetadata(file.name, file.type || '');
    const encodedMetadata = encoder.encode(JSON.stringify(metadata));
    if (encodedMetadata.length > MAX_METADATA_BYTES) fail('INVALID_METADATA', 'The filename metadata is too large.');
    const original = new Uint8Array(await file.arrayBuffer());
    if (original.length !== file.size) fail('FILE_SIZE', 'The image size changed while reading it. Select the file again.');
    const minimumSize = HEADER_BYTES + TAG_BYTES + 8 + encodedMetadata.length + original.length;
    const width = Math.max(16, Math.ceil(Math.sqrt(minimumSize / 3)));
    const height = Math.ceil(minimumSize / (width * 3));
    const pixelSize = width * height * 3;
    const plaintext = new Uint8Array(pixelSize - HEADER_BYTES - TAG_BYTES);
    view(plaintext).setUint32(0, original.length);
    view(plaintext).setUint32(4, encodedMetadata.length);
    plaintext.set(encodedMetadata, 8);
    plaintext.set(original, 8 + encodedMetadata.length);
    fillRandom(plaintext.subarray(8 + encodedMetadata.length + original.length));
    const header = createHeader(plaintext.length + TAG_BYTES, width, height);
    try {
      const key = await deriveKey(secret, header.subarray(20, 36), 'encrypt');
      const encrypted = await root.crypto.subtle.encrypt({ name: 'AES-GCM', iv: header.subarray(36, 48), additionalData: header, tagLength: 128 }, key, plaintext);
      const pixels = new Uint8Array(pixelSize);
      pixels.set(header);
      pixels.set(new Uint8Array(encrypted), HEADER_BYTES);
      return await encodePNG(pixels, width, height);
    } finally {
      // Best-effort cleanup; JavaScript/browser memory cannot be guaranteed erased.
      secret.fill(0);
      plaintext.fill(0);
      original.fill(0);
    }
  }

  async function decryptImage(blob, password) {
    requireSupport();
    const secret = passwordBytes(password, false);
    if (!blob || typeof blob.arrayBuffer !== 'function' || !Number.isSafeInteger(blob.size) || blob.size <= 0 || blob.size > MAX_CARRIER_BYTES) {
      fail('CARRIER_SIZE', 'Choose an encrypted PNG no larger than 22 MiB.');
    }
    let plaintext;
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (bytes.length !== blob.size) fail('CARRIER_SIZE', 'The encrypted file size changed while reading it.');
      const { pixels, width, height } = await decodePNG(bytes);
      if (pixels.length < HEADER_BYTES + TAG_BYTES + 8 || !equalAt(pixels, MAGIC)) {
        fail('NOT_PICVERT', 'This image is not a Picvert encrypted image. Use the original downloaded PNG.');
      }
      const header = pixels.subarray(0, HEADER_BYTES);
      const data = view(header);
      if (header[8] !== 1 || header[9] !== 1) fail('UNSUPPORTED_VERSION', 'This Picvert image uses an unsupported format version.');
      if (header[10] !== 0 || header[11] !== HEADER_BYTES || data.getUint32(12) !== ITERATIONS ||
          data.getUint32(16) !== pixels.length - HEADER_BYTES || data.getUint32(48) !== width || data.getUint32(52) !== height ||
          header.subarray(56).some(byte => byte !== 0)) {
        fail('INVALID_HEADER', 'The encrypted image header is invalid or has been modified.');
      }
      const key = await deriveKey(secret, header.subarray(20, 36), 'decrypt');
      try {
        plaintext = new Uint8Array(await root.crypto.subtle.decrypt({ name: 'AES-GCM', iv: header.subarray(36, 48), additionalData: header, tagLength: 128 }, key, pixels.subarray(HEADER_BYTES)));
      } catch {
        fail('DECRYPT_FAILED', 'The password is incorrect, or the encrypted image has been damaged or modified.');
      }
      const originalSize = view(plaintext).getUint32(0);
      const metadataSize = view(plaintext).getUint32(4);
      const payloadEnd = 8 + metadataSize + originalSize;
      if (!originalSize || originalSize > MAX_FILE_BYTES || !metadataSize || metadataSize > MAX_METADATA_BYTES ||
          payloadEnd > plaintext.length || plaintext.length - payloadEnd >= width * 3) {
        fail('INVALID_METADATA', 'The decrypted file metadata is invalid.');
      }
      let metadata;
      try {
        metadata = JSON.parse(decoder.decode(plaintext.subarray(8, 8 + metadataSize)));
      } catch {
        fail('INVALID_METADATA', 'The decrypted file metadata is invalid.');
      }
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) fail('INVALID_METADATA', 'The decrypted file metadata is invalid.');
      const safeMetadata = fileMetadata(metadata.name, metadata.type);
      return { bytes: plaintext.slice(8 + metadataSize, payloadEnd), ...safeMetadata };
    } finally {
      secret.fill(0);
      if (plaintext) plaintext.fill(0);
    }
  }

  const api = Object.freeze({ encryptFile, decryptImage, isSupported, PicvertError, MAX_FILE_BYTES, MAX_CARRIER_BYTES,
    MIN_PASSWORD_LENGTH, MAX_PASSCODE_LENGTH, MAX_PASSWORD_BYTES, SUPPORTED_EXTENSIONS: Object.freeze(Object.keys(EXTENSION_TYPES)) });
  root.PicvertCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
