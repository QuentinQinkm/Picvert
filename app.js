/* Files and passcodes stay in memory. No networking or persistent storage. */
"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const fileInput = $("file-input");
  const passcode = $("passcode");
  const preview = $("preview");
  const supported = Boolean(globalThis.PicvertCore?.isSupported());
  let resultURL = null;
  let resultName = "";
  let busy = false;
  let operation = 0;

  function status(text = "", error = false) {
    $("status").textContent = text;
    $("status").className = error ? "error" : "";
  }

  function updateButtons() {
    const ready = supported && !busy && Boolean(fileInput.files[0] && passcode.value);
    $("encrypt-button").disabled = !ready;
    $("restore-button").disabled = !ready;
    $("download-button").disabled = busy || !resultURL;
  }

  function clearResult() {
    preview.removeAttribute("src");
    preview.hidden = true;
    if (resultURL) URL.revokeObjectURL(resultURL);
    resultURL = null;
    resultName = "";
    updateButtons();
  }

  function showResult(blob, name, encrypted) {
    resultURL = URL.createObjectURL(blob);
    resultName = name;
    const previewable = /^image\/(png|jpeg|webp|gif|avif|bmp|x-icon|vnd\.microsoft\.icon)$/.test(blob.type);
    if (previewable) {
      preview.src = resultURL;
      preview.alt = encrypted ? "Encrypted image" : "Restored image";
      preview.className = encrypted ? "encrypted" : "";
      preview.hidden = false;
    }
  }

  async function run(encrypting) {
    if (busy || !supported || !fileInput.files[0] || !passcode.value) return;
    const file = fileInput.files[0];
    const code = passcode.value;
    clearResult();
    busy = true;
    const currentOperation = ++operation;
    $("controls").disabled = true;
    $("image-form").setAttribute("aria-busy", "true");
    updateButtons();
    status(encrypting ? "Encrypting…" : "Restoring…");
    try {
      if (encrypting) {
        const png = await PicvertCore.encryptFile(file, code);
        if (currentOperation !== operation) return;
        // Short codes are case-insensitive; show the same canonical form used by the codec.
        passcode.value = code.toUpperCase();
        showResult(png, "picvert-encrypted.png", true);
      } else {
        const original = await PicvertCore.decryptImage(file, code);
        if (currentOperation !== operation) { original.bytes.fill(0); return; }
        const name = original.name.replace(/[\\/\u0000-\u001f\u007f]/g, "_").replace(/^\.+/, "_") || "restored-image";
        showResult(new Blob([original.bytes], { type: original.type }), name, false);
        original.bytes.fill(0);
      }
      status(encrypting ? "Encrypted." : "Restored.");
    } catch (error) {
      if (currentOperation !== operation) return;
      clearResult();
      status(error instanceof Error ? error.message : "Unable to process this image.", true);
    } finally {
      if (currentOperation === operation) {
        busy = false;
        $("controls").disabled = false;
        $("image-form").setAttribute("aria-busy", "false");
        updateButtons();
      }
    }
  }

  $("image-form").addEventListener("submit", event => {
    event.preventDefault();
    run(true);
  });
  $("restore-button").addEventListener("click", () => run(false));
  $("download-button").addEventListener("click", () => {
    if (!resultURL || busy) return;
    const link = document.createElement("a");
    link.href = resultURL;
    link.download = resultName;
    document.body.append(link);
    link.click();
    link.remove();
  });
  for (const [input, event] of [[fileInput, "change"], [passcode, "input"]]) {
    input.addEventListener(event, () => { clearResult(); status(); });
  }
  preview.addEventListener("error", () => { preview.hidden = true; });
  window.addEventListener("pagehide", () => {
    operation++;
    busy = false;
    fileInput.value = "";
    passcode.value = "";
    clearResult();
    $("controls").disabled = !supported;
    $("image-form").setAttribute("aria-busy", "false");
    status();
  });
  if (!supported) {
    $("controls").disabled = true;
    status("Open Picvert over HTTPS in a current browser.", true);
  }
  updateButtons();
})();
