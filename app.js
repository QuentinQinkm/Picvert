/* No networking or persistence: selected files, keys and previews stay in memory. */
"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  const form = $("image-form");
  const fileInput = $("file-input");
  const password = $("password");
  const confirmation = $("confirm-password");
  let mode = "encrypt";
  let selectedFile = null;
  let sourceURL = null;
  let resultURL = null;
  let busy = false;
  let supported = false;
  let operation = 0;
  const extensions = /\.(png|jpe?g|webp|gif|avif|heic|heif|bmp|tiff?|ico)$/i;
  const formatSize = (size) => size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KiB` : `${(size / (1024 * 1024)).toFixed(2)} MiB`;

  function status(message = "", kind = "") {
    $("status").textContent = message;
    $("status").className = `status ${kind}`;
  }

  function clearResult() {
    $("result-image").removeAttribute("src");
    $("result-image").hidden = true;
    $("download-link").removeAttribute("href");
    $("download-link").removeAttribute("download");
    if (resultURL) URL.revokeObjectURL(resultURL);
    resultURL = null;
    $("result-empty").hidden = false;
    $("result-ready").hidden = true;
    $("result-tag").hidden = true;
    $("result-hint").textContent = "The image and password stay in this browser.";
  }

  function clearSource() {
    $("source-preview").removeAttribute("src");
    $("source-preview").hidden = true;
    if (sourceURL) URL.revokeObjectURL(sourceURL);
    sourceURL = null;
    selectedFile = null;
    fileInput.value = "";
    $("selected-file").hidden = true;
    $("drop-empty").hidden = false;
    $("file-detail").textContent = "";
  }

  function updateButton() {
    $("submit-button").disabled = !supported || busy || !selectedFile || !password.value;
    $("clear-button").hidden = !selectedFile && !password.value && !resultURL;
  }

  function reset() {
    operation++;
    clearSource();
    clearResult();
    password.value = "";
    confirmation.value = "";
    confirmation.setCustomValidity("");
    password.type = confirmation.type = "password";
    $("show-password").textContent = "Show";
    $("show-password").setAttribute("aria-label", "Show password");
    $("show-password").setAttribute("aria-pressed", "false");
    status();
    updateButton();
  }

  function setMode(nextMode) {
    if (busy || mode === nextMode) return;
    mode = nextMode;
    reset();
    const encrypt = mode === "encrypt";
    $("encrypt-mode").setAttribute("aria-pressed", String(encrypt));
    $("restore-mode").setAttribute("aria-pressed", String(!encrypt));
    $("file-label").textContent = encrypt ? "Choose your image" : "Choose the encrypted PNG";
    $("choose-copy").textContent = encrypt ? "Choose an image" : "Choose a Picvert PNG";
    fileInput.accept = encrypt ? ".png,.jpg,.jpeg,.webp,.gif,.avif,.heic,.heif,.bmp,.tif,.tiff,.ico" : ".png";
    $("file-help").textContent = encrypt ? "PNG, JPG, WebP, HEIC and other image formats. Up to 20 MiB." : "Use the original encrypted PNG file. Up to 22 MiB.";
    $("password-label").textContent = encrypt ? "Create a password" : "Enter the shared password";
    password.autocomplete = encrypt ? "new-password" : "off";
    password.minLength = encrypt ? 12 : 1;
    $("password-help").textContent = encrypt ? "At least 12 characters. Try four or more randomly chosen words." : "Enter it exactly as shared, including spaces and capital letters.";
    $("confirm-wrap").hidden = !encrypt;
    confirmation.required = encrypt;
    confirmation.disabled = !encrypt;
    $("submit-button").textContent = encrypt ? "Encrypt image" : "Restore original image";
    $("empty-title").textContent = encrypt ? "A picture with a secret." : "Bring the original back.";
    $("empty-description").textContent = encrypt ? "Your encrypted image will appear here, ready to download and share." : "Select the encrypted PNG and enter its password to restore the original file.";
  }

  function chooseFile(file) {
    if (!file || busy || !supported) return;
    clearSource();
    clearResult();
    status();
    const maximum = mode === "encrypt" ? PicvertCore.MAX_FILE_BYTES : PicvertCore.MAX_CARRIER_BYTES;
    if (!file.size || file.size > maximum) {
      status(`Choose a non-empty image no larger than ${mode === "encrypt" ? 20 : 22} MiB.`, "error");
      updateButton();
      return;
    }
    if (mode === "encrypt" ? !extensions.test(file.name) : !/\.png$/i.test(file.name)) {
      status(mode === "encrypt" ? "Choose a supported image file, such as JPG, PNG, WebP or HEIC." : "Choose the encrypted PNG downloaded from Picvert.", "error");
      updateButton();
      return;
    }
    selectedFile = file;
    $("selected-name").textContent = file.name;
    $("selected-size").textContent = formatSize(file.size);
    $("selected-file").hidden = false;
    $("drop-empty").hidden = true;
    $("file-detail").textContent = `Selected ${file.name}, ${formatSize(file.size)}.`;
    // Restrict inline previews to passive raster formats; HEIC/TIFF still round-trip.
    if (mode === "encrypt" && /\.(png|jpe?g|webp|gif|avif|bmp|ico)$/i.test(file.name) && /^image\/(png|jpeg|webp|gif|avif|bmp|x-icon|vnd\.microsoft\.icon)$/.test(file.type)) {
      sourceURL = URL.createObjectURL(file);
      $("source-preview").src = sourceURL;
      $("source-preview").hidden = false;
    }
    updateButton();
  }

  function setBusy(value) {
    busy = value;
    $("controls").disabled = value || !supported;
    $("encrypt-mode").disabled = value;
    $("restore-mode").disabled = value;
    $("clear-button").disabled = value;
    form.setAttribute("aria-busy", String(value));
    $("submit-button").textContent = value ? (mode === "encrypt" ? "Encrypting…" : "Restoring…") : (mode === "encrypt" ? "Encrypt image" : "Restore original image");
    updateButton();
  }

  function showResult(blob, name, recovered) {
    clearResult();
    resultURL = URL.createObjectURL(blob);
    $("download-link").href = resultURL;
    $("download-link").download = name;
    $("download-link").textContent = recovered ? "Download original image" : "Download encrypted PNG";
    $("result-empty").hidden = true;
    $("result-ready").hidden = false;
    $("result-tag").hidden = false;
    $("result-tag").textContent = recovered ? "RESTORED" : "ENCRYPTED PNG";
    $("result-title").textContent = recovered ? name : "Your encrypted image is ready.";
    $("result-info").textContent = recovered ? `${formatSize(blob.size)} · Original file restored without changes` : `${formatSize(blob.size)} · Save this PNG to share it`;
    $("result-hint").textContent = recovered ? "Clear this page when you’ve finished. Downloaded files stay on your device." : "Send as a file or document to keep the PNG unchanged.";
    const previewable = /^(image\/(png|jpeg|webp|gif|avif|bmp|x-icon|vnd\.microsoft\.icon))$/.test(blob.type);
    $("preview-unavailable").hidden = previewable;
    $("result-image").className = recovered ? "" : "encrypted";
    $("result-image").alt = recovered ? "Restored original image" : "Encrypted image containing your protected file";
    if (previewable) {
      $("result-image").src = resultURL;
      $("result-image").hidden = false;
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !supported || !selectedFile) return;
    if (mode === "encrypt" && password.value !== confirmation.value) {
      confirmation.setCustomValidity("The passwords do not match.");
      confirmation.reportValidity();
      return;
    }
    confirmation.setCustomValidity("");
    if (!form.reportValidity()) return;
    clearResult();
    setBusy(true);
    const currentOperation = ++operation;
    status(mode === "encrypt" ? "Encrypting on your device. Larger files can take a moment…" : "Checking the PNG and restoring it on your device…");
    try {
      if (mode === "encrypt") {
        const png = await PicvertCore.encryptFile(selectedFile, password.value);
        if (currentOperation !== operation) return;
        showResult(png, "picvert-encrypted.png", false);
        status("Encrypted. Download the PNG and keep your password safe.", "success");
      } else {
        const original = await PicvertCore.decryptImage(selectedFile, password.value);
        if (currentOperation !== operation) { original.bytes.fill(0); return; }
        const safeName = original.name.replace(/[\\/\u0000-\u001f\u007f]/g, "_").replace(/^\.+/, "_") || "restored-image";
        showResult(new Blob([original.bytes], { type: original.type }), safeName, true);
        original.bytes.fill(0);
        status("Restored successfully. The original file is ready to download.", "success");
      }
    } catch (error) {
      if (currentOperation !== operation) return;
      clearResult();
      status(error instanceof Error ? error.message : "That image could not be processed. Please try again.", "error");
    } finally {
      if (currentOperation === operation) setBusy(false);
    }
  });

  fileInput.addEventListener("change", () => { if (fileInput.files[0]) chooseFile(fileInput.files[0]); });
  $("source-preview").addEventListener("error", () => { $("source-preview").hidden = true; });
  $("result-image").addEventListener("error", () => { $("result-image").hidden = true; $("preview-unavailable").hidden = false; });
  for (const input of [password, confirmation]) input.addEventListener("input", () => {
    confirmation.setCustomValidity("");
    clearResult();
    status();
    updateButton();
  });
  $("show-password").addEventListener("click", () => {
    const reveal = password.type === "password";
    password.type = confirmation.type = reveal ? "text" : "password";
    $("show-password").textContent = reveal ? "Hide" : "Show";
    $("show-password").setAttribute("aria-label", reveal ? "Hide password" : "Show password");
    $("show-password").setAttribute("aria-pressed", String(reveal));
  });
  $("encrypt-mode").addEventListener("click", () => setMode("encrypt"));
  $("restore-mode").addEventListener("click", () => setMode("restore"));
  $("clear-button").addEventListener("click", reset);
  const dropZone = $("drop-zone");
  for (const eventName of ["dragenter", "dragover"]) dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (!busy) dropZone.classList.add("dragging");
  });
  for (const eventName of ["dragleave", "drop"]) dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragging");
  });
  dropZone.addEventListener("drop", (event) => {
    if (busy) return;
    if (event.dataTransfer.files.length > 1) { status("Choose one image at a time.", "error"); return; }
    chooseFile(event.dataTransfer.files[0]);
  });
  for (const eventName of ["dragover", "drop"]) window.addEventListener(eventName, (event) => event.preventDefault());
  window.addEventListener("pagehide", () => {
    reset();
    setBusy(false);
  });

  supported = Boolean(globalThis.PicvertCore?.isSupported());
  if (!supported) {
    $("support-error").hidden = false;
    $("support-error").textContent = "This browser cannot run Picvert here. Open the HTTPS page in a current version of Safari, Chrome, Firefox or Edge. For local development, use localhost.";
    $("controls").disabled = true;
  }
  updateButton();
})();
