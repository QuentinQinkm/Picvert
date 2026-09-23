# Security model

Picvert encrypts images locally so a recipient with the password can recover the exact original file. The PNG is a transport format for encrypted bytes. Its noise-like appearance is not the source of security, and it does not conceal that encrypted data is being shared.

This implementation has not been independently audited. It is not a complete secure messaging protocol.

## Encryption

- AES-256-GCM provides encryption and authentication.
- PBKDF2-HMAC-SHA-256 derives the encryption key from the password using 600,000 iterations and a fresh random 16-byte salt.
- Each encryption uses a fresh random 12-byte GCM IV.
- The versioned container header is authenticated. The original filename, media type, and exact original file bytes are encrypted.
- The container is encoded into the RGB pixels of a lossless PNG.

Restoration requires a matching password and an intact authenticated container. A failed authentication check may mean the password is wrong or the image has been damaged or modified. Picvert does not return unauthenticated image data.

Original images are limited to 20 MiB. New encryption accepts 1–6 ASCII letters or numbers, with letters normalized to uppercase. Earlier v1 images made with passwords of at least 12 characters still restore using the original password verbatim, up to 1,024 UTF-8 bytes. The container format and encryption parameters are unchanged.

## Passwords and sharing

Short passcodes are a convenience choice, not strong protection against a determined attacker. Six case-insensitive letters or numbers provide at most 36^6 possibilities, about 31 bits of entropy if chosen uniformly at random; shorter or predictable codes provide less. AES-256 does not turn a short passcode into a 256-bit secret. Anyone with the PNG can test guesses offline without rate limits. PBKDF2 slows each guess but cannot make this small search space strong. Picvert should not be relied on for sensitive material requiring strong confidentiality.

Send the password separately through a trusted channel. Anyone who obtains both the PNG and its password can decrypt it. There is no password reset, identity verification, key exchange, or forward secrecy: if a reused password is later exposed, previously saved images encrypted with it are also exposed.

Send the PNG as an unmodified file or document. Resizing, recompression, screenshots, or other changes to its pixels can make it impossible to restore. Keep an original copy until you have tested a round trip.

## What this does not protect

- **Website delivery and device compromise.** You must trust the JavaScript delivered to your browser and the device running it. A malicious app update, browser extension, or compromised device could capture images and passwords before encryption or after restoration.
- **Communication metadata.** Encryption does not hide website visits, who exchanges the PNG, transfer timing, or file size. The encrypted content is not padded to hide its length.
- **Recipient behaviour.** A recipient can save or redistribute the original image and password.
- **Original metadata.** Exact recovery preserves EXIF and other original metadata. Remove sensitive metadata before encrypting if needed.
- **Secure deletion.** Images and passwords can remain in browser memory while the page is open. Downloaded files, operating-system caches, backups, and browser behaviour are outside this app’s control; closing the page is not a secure-erasure guarantee.

## Hosting and local processing

GitHub Pages hosts static application files. Picvert has no image upload endpoint, analytics, third-party code, or persistent browser storage for images and passwords. The host can log requests for the website, and your internet provider can observe connection metadata.

Once the app’s assets have loaded, processing does not need a network connection. The app does not promise offline availability on a later visit. You can also serve a reviewed local copy over `localhost`.

Picvert’s earlier pixel-scrambling outputs are unsupported. The current app does not silently fall back to that unauthenticated scheme.

## Reporting an issue

When reporting a suspected security issue, describe the problem using synthetic images and test passwords. Do not include private photos, real passwords, or confidential encrypted files in a public issue.
