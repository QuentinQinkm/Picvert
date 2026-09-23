# Picvert

Encrypt an image into a noise-like PNG, share it, and restore the exact original image with the same password. Picvert runs in your browser. GitHub Pages serves the app’s static files; Picvert does not upload your images or passwords.

**[Open Picvert](https://quentinqinkm.github.io/Picvert/)**

## Use it

1. Open Picvert and choose **Encrypt an image**.
2. Select an image and enter a password. Use a unique passphrase made from at least four randomly chosen words.
3. Download the encrypted PNG.
4. Send that PNG to your friend **as a file or document**, keeping the original file intact. Give them the password separately through a trusted channel.
5. Your friend opens Picvert, chooses **Restore an image**, selects the encrypted PNG, and enters the same password.
6. Download the restored original image.

Keep the original until you have checked that restoration works. There is no password reset or recovery key.

**Do not resize, crop, edit, screenshot, or convert the encrypted PNG to JPEG.** Image-sharing services may recompress pictures and destroy the encrypted data. Use their file/document attachment option, or another transfer method that preserves the file.

## What stays private

Encryption and restoration happen on your device. The app has no upload endpoint, analytics, third-party scripts, or saved image/password history. GitHub can still log visits to the website. Anyone who receives an encrypted PNG can see its size and recognise that it carries encoded data.

The original filename, media type, and file contents are encrypted. Restoration preserves the original bytes, including any EXIF metadata such as location. Check the original image’s metadata before encrypting if you do not want the recipient to receive it.

Picvert uses AES-256-GCM authenticated encryption with a key derived from your password using PBKDF2-SHA-256. This implementation has **not been independently audited**. See [SECURITY.md](SECURITY.md) for the security model and limitations.

## Requirements and limits

- A modern browser with Web Crypto, `CompressionStream`, and `DecompressionStream` support.
- HTTPS when hosted, or `localhost` for local development.
- Original images up to 20 MiB.
- Passwords of at least 12 characters, up to 1,024 UTF-8 bytes. Longer, randomly generated passphrases are preferable to predictable passwords.

After the app’s assets have loaded, encryption and restoration can run with the network disconnected. There is no offline cache or guarantee that reopening the page will work offline.

Outputs from Picvert’s earlier pixel-scrambling prototype are **not compatible** with this version. The old `main.html` entry point redirects to the current app; it does not provide legacy decryption.

## Run locally

From this directory:

```sh
python3 -m http.server 8080
```

Open [localhost:8080](http://localhost:8080). No install or build step is required.

Run the core tests with Node.js 22 or newer:

```sh
node --test tests/core.test.cjs
```

The optional browser integration test requires Playwright with Chromium and a running static server. It uses synthetic images, separate sender/recipient browser sessions, and offline processing:

```sh
PICVERT_TEST_URL=http://localhost:8080 node tests/browser.test.cjs
```

It saves temporary downloads and desktop/mobile screenshots in the ignored `test-results/` directory.

## Host on GitHub Pages

1. Push this directory to your GitHub repository’s `main` branch. Include `index.html`, its local assets, and `.nojekyll`.
2. In the repository, open **Settings → Pages**.
3. Choose **Deploy from a branch**, then select **main** and **/ (root)**, and save.
4. Wait for GitHub’s deployment to finish, then open the URL shown in Pages settings.

No backend, secrets, API keys, or database are required. Publish only the app’s source files; keep personal images, encrypted samples containing private information, and passwords out of the repository.
