# Picvert

[Open Picvert](https://quentinqinkm.github.io/Picvert/)

Turn an image into an encrypted PNG and restore it with the same passcode. Everything runs locally in your browser; GitHub Pages only hosts the app’s files.

## Use it

Select an image, enter **1–6 letters or numbers**, and press **Encrypt**, then **Download**. Letter case does not matter. Your friend selects the encrypted PNG, enters the same passcode, and presses **Restore**, then **Download** to save the exact original file.

Send the encrypted PNG as an unchanged **file or document**. Resizing, screenshots, or photo compression can prevent restoration. There is no passcode reset.

The app uses AES-256-GCM with PBKDF2-SHA-256. Short passcodes can be guessed offline; see [SECURITY.md](SECURITY.md) for the limitations. Earlier v1 images made with long passwords still restore with their original, case-sensitive passwords. Outputs from the original pixel-scrambling prototype are unsupported.

## Requirements

- A modern browser with Web Crypto and Compression Streams, on HTTPS or localhost.
- Original image size of at most 20 MiB.

Images and passcodes are not uploaded or saved by the app. Once its files have loaded, processing works without a network connection. There is no offline cache for later visits.

## Development

No install or build step is required. Start a local server:

```sh
python3 -m http.server 8080
```

Open [localhost:8080](http://localhost:8080). Run the core tests with Node.js 22 or newer:

```sh
node --test tests/core.test.cjs
```

The browser integration test requires Playwright with Chromium and the running server:

```sh
PICVERT_TEST_URL=http://localhost:8080 node tests/browser.test.cjs
```

It saves temporary downloads and screenshots in the ignored `test-results/` directory.

## GitHub Pages

Push the app’s files to `main`, including `.nojekyll`. In **Settings → Pages**, choose **Deploy from a branch**, **main**, and **/ (root)**. No backend, API keys, or database are required. Keep personal images and passcodes out of the repository.
