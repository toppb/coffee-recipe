import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";

// Detect whether an image has a solid (non-transparent) background.
// Samples 4 corners + 4 edge midpoints. Returns { solid: bool, white: bool } or null on error.
async function detectSolidBackground(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const size = 64;
        const canvas = document.createElement("canvas");
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, size, size);
        const pts = [
          [0, 0], [size - 1, 0], [0, size - 1], [size - 1, size - 1],
          [size >> 1, 0], [size >> 1, size - 1], [0, size >> 1], [size - 1, size >> 1],
        ];
        const samples = pts.map(([x, y]) => ctx.getImageData(x, y, 1, 1).data);
        const opaque = samples.filter((p) => p[3] > 250);
        if (opaque.length < 6) { resolve({ solid: false, white: false }); return; }
        // Mutual similarity: max channel delta across opaque samples
        let maxDelta = 0;
        for (let i = 0; i < opaque.length; i++) {
          for (let j = i + 1; j < opaque.length; j++) {
            for (let c = 0; c < 3; c++) {
              const d = Math.abs(opaque[i][c] - opaque[j][c]);
              if (d > maxDelta) maxDelta = d;
            }
          }
        }
        const similar = maxDelta < 48;
        // Light/uniform background: average across opaque samples
        let r = 0, g = 0, b = 0;
        opaque.forEach((p) => { r += p[0]; g += p[1]; b += p[2]; });
        r /= opaque.length; g /= opaque.length; b /= opaque.length;
        const white = r > 200 && g > 200 && b > 200;
        resolve({ solid: similar || white, white });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

// Resize an image File and return a base64-encoded JPEG (no data URL prefix).
// Used to keep payloads small when calling the remove.bg proxy.
async function resizeImageToBase64(file, maxWidth = 1500, quality = 0.9) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxWidth / img.naturalWidth);
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      // toDataURL → strip "data:image/jpeg;base64,"
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      const b64 = dataUrl.split(",")[1] || "";
      if (!b64) reject(new Error("encode failed"));
      else resolve(b64);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image load failed")); };
    img.src = url;
  });
}

// Convert any image File to a PNG Blob (for clipboard, which only reliably accepts PNG).
async function fileToPngBlob(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("png convert failed")), "image/png");
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image load failed")); };
    img.src = url;
  });
}

// Resize and compress an image file to max 600px wide, output as WebP
async function resizeImage(file, maxWidth = 600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxWidth / img.naturalWidth);
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => {
        if (blob) resolve({ blob, width: w, height: h });
        else reject(new Error("Image conversion failed"));
      }, "image/webp", quality);
    };
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = url;
  });
}

function renderPillEditor(container, { label, values, suggestions, onChanged }) {
  const currentValues = [...values];
  const allSuggestions = suggestions || [];

  const row = document.createElement("div");
  row.className = "editor-prop-row";

  const lbl = document.createElement("span");
  lbl.className = "editor-prop-label";
  lbl.textContent = label;
  row.appendChild(lbl);

  const pillArea = document.createElement("div");
  pillArea.className = "editor-pill-area";
  row.appendChild(pillArea);

  function addValue(v) {
    if (v && !currentValues.includes(v)) {
      currentValues.push(v);
      render();
      if (onChanged) onChanged(currentValues);
      const newInput = pillArea.querySelector(".pill-add-input");
      if (newInput) newInput.focus();
    }
  }

  function render() {
    pillArea.innerHTML = "";
    currentValues.forEach((val, i) => {
      const pill = document.createElement("span");
      pill.className = "pill editable";
      pill.innerHTML = `<span class="pill-text">${val}</span><button type="button" class="pill-remove" aria-label="Remove">&times;</button>`;
      pill.querySelector(".pill-remove").addEventListener("click", () => {
        currentValues.splice(i, 1);
        render();
        if (onChanged) onChanged(currentValues);
      });
      pillArea.appendChild(pill);
    });

    // Input wrapper (positioned container for dropdown)
    const inputWrapper = document.createElement("div");
    inputWrapper.className = "pill-input-wrapper";

    const addInput = document.createElement("input");
    addInput.type = "text";
    addInput.className = "pill-add-input";
    addInput.placeholder = "+";

    const dropdown = document.createElement("div");
    dropdown.className = "pill-suggestions";
    dropdown.style.display = "none";

    let highlightIndex = -1;

    function updateDropdown() {
      const query = addInput.value.trim().toLowerCase();
      dropdown.innerHTML = "";
      highlightIndex = -1;

      if (allSuggestions.length === 0 || query === "") {
        dropdown.style.display = "none";
        return;
      }

      const filtered = allSuggestions.filter(
        (s) => !currentValues.includes(s) && s.toLowerCase().includes(query)
      );

      if (filtered.length === 0) {
        dropdown.style.display = "none";
        return;
      }

      filtered.forEach((val) => {
        const opt = document.createElement("div");
        opt.className = "pill-suggestion-item";
        opt.textContent = val;
        opt.addEventListener("mousedown", (e) => {
          e.preventDefault();
          addInput.value = ""; // Clear before render() removes input from DOM (prevents blur adding stale text as pill)
          addValue(val);
        });
        dropdown.appendChild(opt);
      });

      dropdown.style.display = "";
    }

    function updateHighlight() {
      const items = dropdown.querySelectorAll(".pill-suggestion-item");
      items.forEach((el, i) => {
        el.classList.toggle("highlighted", i === highlightIndex);
      });
      if (items[highlightIndex]) {
        items[highlightIndex].scrollIntoView({ block: "nearest" });
      }
    }

    addInput.addEventListener("input", updateDropdown);

    addInput.addEventListener("focus", () => {
      if (addInput.value.trim().length > 0) updateDropdown();
    });

    addInput.addEventListener("keydown", (e) => {
      const items = dropdown.querySelectorAll(".pill-suggestion-item");

      if (e.key === "ArrowDown" && items.length > 0) {
        e.preventDefault();
        highlightIndex = Math.min(highlightIndex + 1, items.length - 1);
        updateHighlight();
        return;
      }
      if (e.key === "ArrowUp" && items.length > 0) {
        e.preventDefault();
        highlightIndex = Math.max(highlightIndex - 1, 0);
        updateHighlight();
        return;
      }
      if (e.key === "Escape") {
        dropdown.style.display = "none";
        highlightIndex = -1;
        return;
      }

      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        if (highlightIndex >= 0 && items[highlightIndex]) {
          addValue(items[highlightIndex].textContent);
          return;
        }
        addValue(addInput.value.trim().replace(/,+$/, ""));
      }
    });

    addInput.addEventListener("blur", () => {
      dropdown.style.display = "none";
      highlightIndex = -1;
      const v = addInput.value.trim().replace(/,+$/, "");
      if (v && !currentValues.includes(v)) {
        currentValues.push(v);
        render();
        if (onChanged) onChanged(currentValues);
      }
    });

    inputWrapper.appendChild(addInput);
    inputWrapper.appendChild(dropdown);
    pillArea.appendChild(inputWrapper);
  }

  render();
  container.appendChild(row);

  return () => [...currentValues];
}

function renderStarRating(container, { rating, onChanged }) {
  let current = rating || 0;

  const row = document.createElement("div");
  row.className = "editor-prop-row";

  const lbl = document.createElement("span");
  lbl.className = "editor-prop-label";
  lbl.textContent = "Rating";
  row.appendChild(lbl);

  const starsContainer = document.createElement("div");
  starsContainer.className = "editor-stars";
  row.appendChild(starsContainer);

  function render() {
    starsContainer.innerHTML = "";
    const starEls = [];
    for (let i = 1; i <= 5; i++) {
      const star = document.createElement("button");
      star.type = "button";
      star.className = `editor-star ${i <= current ? "active" : ""}`;
      star.textContent = "★";
      star.addEventListener("mouseenter", () => {
        starEls.forEach((s, idx) => s.classList.toggle("active", idx < i));
      });
      star.addEventListener("mouseleave", () => {
        starEls.forEach((s, idx) => s.classList.toggle("active", idx < current));
      });
      star.addEventListener("click", () => {
        current = i;
        render();
        if (onChanged) onChanged(current);
      });
      starsContainer.appendChild(star);
      starEls.push(star);
    }
  }

  render();
  container.appendChild(row);

  return () => current;
}

function extractRecipeBody(fullMarkdown) {
  if (!fullMarkdown) return "";
  const lines = fullMarkdown.split("\n");
  let recipeStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("## ")) {
      recipeStart = i;
      break;
    }
    if (line.startsWith("### Tasting Notes")) {
      for (let j = i + 1; j < lines.length; j++) {
        const jLine = lines[j].trim();
        if (jLine.startsWith("## ") || (jLine.startsWith("### ") && jLine !== "### Tasting Notes")) {
          recipeStart = j;
          break;
        }
      }
      if (recipeStart !== -1) break;
    }
  }

  if (recipeStart === -1) return fullMarkdown.trim();
  return lines.slice(recipeStart).join("\n").trim();
}

function createToolbar(editor) {
  const toolbar = document.createElement("div");
  toolbar.className = "tiptap-toolbar";

  const buttons = [
    { label: "B", cmd: () => editor.chain().focus().toggleBold().run(), active: () => editor.isActive("bold") },
    { label: "I", cmd: () => editor.chain().focus().toggleItalic().run(), active: () => editor.isActive("italic") },
    { label: "H2", cmd: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), active: () => editor.isActive("heading", { level: 2 }) },
    { label: "H3", cmd: () => editor.chain().focus().toggleHeading({ level: 3 }).run(), active: () => editor.isActive("heading", { level: 3 }) },
    { label: "\u2022", cmd: () => editor.chain().focus().toggleBulletList().run(), active: () => editor.isActive("bulletList") },
    { label: "1.", cmd: () => editor.chain().focus().toggleOrderedList().run(), active: () => editor.isActive("orderedList") },
    { label: "\u21A9", cmd: () => editor.chain().focus().undo().run(), active: () => false },
    { label: "\u21AA", cmd: () => editor.chain().focus().redo().run(), active: () => false },
  ];

  buttons.forEach(({ label, cmd, active }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tiptap-toolbar-btn";
    btn.textContent = label;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      cmd();
      updateActive();
    });
    toolbar.appendChild(btn);
  });

  function updateActive() {
    const btns = toolbar.querySelectorAll(".tiptap-toolbar-btn");
    btns.forEach((btn, i) => {
      btn.classList.toggle("active", buttons[i].active());
    });
  }

  editor.on("selectionUpdate", updateActive);
  editor.on("transaction", updateActive);

  return toolbar;
}

export function createCoffeeEditor(modalEl, { item, supabase, pad2, suggestions, placeholderSrc, userId, onSave, onCancel, onDelete, onDuplicate }) {
  const isNew = !item;

  const mediaEl = modalEl.querySelector(".modalMedia");
  const bodyEl = modalEl.querySelector(".modalBody");
  if (mediaEl) mediaEl.style.display = "none";
  if (bodyEl) bodyEl.style.display = "none";

  const existing = modalEl.querySelector(".editor-view");
  if (existing) existing.remove();

  const view = document.createElement("div");
  view.className = "editor-view";

  // Image section — acts as a label so clicking anywhere triggers file input
  // Show placeholder bag only for existing items with no photo; new coffees start empty
  const showPlaceholder = !isNew && !item?.img && !!placeholderSrc;
  const imgSection = document.createElement("label");
  imgSection.className = (item?.img || showPlaceholder) ? "editor-image" : "editor-image editor-image--empty";

  const imgEl = document.createElement("img");
  imgEl.alt = item?.name ? `${item.name} bag` : "Coffee bag";
  if (item?.img) {
    imgEl.src = item.img;
    if (placeholderSrc) {
      imgEl.onerror = () => {
        imgEl.onerror = null;
        imgEl.src = placeholderSrc;
        imgSection.classList.remove("editor-image--empty");
      };
    }
  } else if (showPlaceholder) {
    imgEl.src = placeholderSrc;
  } else {
    imgEl.style.display = "none";
  }
  imgSection.appendChild(imgEl);

  const imgOverlay = document.createElement("span");
  imgOverlay.className = "editor-image-overlay";
  imgOverlay.dataset.label = item?.img ? "Change image" : "Add image";

  const overlayChangeBtn = document.createElement("span");
  overlayChangeBtn.className = "editor-image-overlay-change";
  overlayChangeBtn.textContent = imgOverlay.dataset.label;
  imgOverlay.appendChild(overlayChangeBtn);

  const overlayDeleteBtn = document.createElement("button");
  overlayDeleteBtn.type = "button";
  overlayDeleteBtn.className = "editor-image-overlay-delete";
  overlayDeleteBtn.textContent = "Delete";
  imgOverlay.appendChild(overlayDeleteBtn);

  imgSection.appendChild(imgOverlay);

  // Keep the visible pill text in sync with the dataset label so existing
  // updates throughout the file (which set dataset.label) still work.
  const setOverlayLabel = (label) => {
    imgOverlay.dataset.label = label;
    overlayChangeBtn.textContent = label;
  };

  let imgHint = null;
  if (isNew) {
    imgHint = document.createElement("span");
    imgHint.className = "editor-image-hint";
    imgHint.textContent = "Photos with transparent background work best";
    imgSection.appendChild(imgHint);
  }

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/png,image/jpeg,image/webp";
  fileInput.style.display = "none";
  // Insert as the first labelable descendant of imgSection so clicking the
  // label activates the file picker — otherwise the Delete <button> would
  // claim that role and a tap anywhere on the image area would delete.
  imgSection.insertBefore(fileInput, imgSection.firstChild);

  // Coaching panel for non-transparent backgrounds
  const bgWarning = document.createElement("div");
  bgWarning.className = "editor-bg-warning";
  bgWarning.style.display = "none";
  bgWarning.innerHTML = `
    <button type="button" class="editor-bg-warning-close" aria-label="Clear image">&times;</button>
    <p class="editor-bg-warning-text">Heads up! This photo has a background. Transparent PNGs look best on the canvas.</p>
    <div class="editor-bg-warning-actions">
      <button type="button" class="editor-bg-warning-use">Use as-is</button>
      <a class="editor-bg-warning-remove" href="https://www.remove.bg/upload" target="_blank" rel="noopener noreferrer">Remove background</a>
    </div>
  `;
  bgWarning.querySelector(".editor-bg-warning-use").addEventListener("click", () => {
    bgWarning.style.display = "none";
  });

  // Cached PNG of the picked file — populated as soon as a flagged image is
  // detected, so the "Remove background" link can copy to clipboard instantly.
  let pendingPngBlobPromise = null;

  const removeLink = bgWarning.querySelector(".editor-bg-warning-remove");
  const warningTextEl = bgWarning.querySelector(".editor-bg-warning-text");
  const originalWarningText = warningTextEl.textContent;
  // When true, the click handler stops intercepting so the user's click opens
  // Remove.bg via the default anchor behavior. Reset when a new file is picked.
  let inFallbackMode = false;

  async function clipboardHandoff(originalLinkText, reason) {
    const prefix = reason ? `${reason}. ` : "";
    if (!pendingPngBlobPromise || !navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      warningTextEl.textContent = `${prefix}Open Remove.bg and upload your image to manually remove background.`;
      removeLink.textContent = "Open Remove.bg ↗";
      inFallbackMode = true;
      return;
    }
    try {
      const item = new ClipboardItem({ "image/png": pendingPngBlobPromise });
      await navigator.clipboard.write([item]);
      warningTextEl.textContent = `${prefix}Image copied. Open Remove.bg and paste to manually remove background.`;
    } catch {
      warningTextEl.textContent = `${prefix}Open Remove.bg and upload your image to manually remove background.`;
    }
    removeLink.textContent = "Open Remove.bg ↗";
    inFallbackMode = true;
  }

  removeLink.addEventListener("click", async (e) => {
    if (inFallbackMode) {
      // Let the anchor's target="_blank" open Remove.bg on the user's click.
      return;
    }
    e.preventDefault();
    const originalText = removeLink.textContent;
    const file = fileInput.files?.[0];
    if (!file) return;

    // Try the in-app proxy first.
    removeLink.textContent = "Removing background…";
    removeLink.classList.add("is-loading");
    try {
      const session = (await supabase?.auth.getSession())?.data?.session;
      if (!session?.access_token) throw new Error("no_session");

      const b64 = await resizeImageToBase64(file, 1500, 0.9);
      const resp = await fetch("/api/remove-bg", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ image_b64: b64 }),
      });

      if (resp.ok) {
        const pngBlob = await resp.blob();
        const cutoutFile = new File([pngBlob], "cutout.png", { type: "image/png" });
        const dt = new DataTransfer();
        dt.items.add(cutoutFile);
        fileInput.files = dt.files;
        const url = URL.createObjectURL(pngBlob);
        imgEl.src = url;
        imgEl.style.display = "";
        imgSection.classList.remove("editor-image--empty");
        setOverlayLabel("Change image");
        if (imgHint) imgHint.style.display = "none";
        bgWarning.style.display = "none";
        removeLink.textContent = originalText;
        removeLink.classList.remove("is-loading");
        pendingPngBlobPromise = Promise.resolve(pngBlob);
        return;
      }

      // 429 → cap hit; anything else → upstream/server problem. Fall back to clipboard.
      let reasonText = "Try again later";
      if (resp.status === 429) {
        const body = await resp.json().catch(() => ({}));
        reasonText = body.reason === "user_cap_reached" ? "Monthly limit reached" : "Daily limit reached";
      }
      removeLink.classList.remove("is-loading");
      await clipboardHandoff(originalText, reasonText);
    } catch {
      removeLink.classList.remove("is-loading");
      await clipboardHandoff(originalText, null);
    }
  });

  // Snapshot of the image state before the user picked a new file, so the
  // close button can revert to whatever was there originally.
  let preChangeState = null;

  bgWarning.querySelector(".editor-bg-warning-close").addEventListener("click", () => {
    bgWarning.style.display = "none";
    fileInput.value = "";
    if (!preChangeState) return;
    const prev = preChangeState;
    if (prev.src) {
      imgEl.src = prev.src;
      imgEl.style.display = prev.display;
    } else {
      imgEl.removeAttribute("src");
      imgEl.style.display = "none";
    }
    imgSection.classList.toggle("editor-image--empty", prev.empty);
    setOverlayLabel(prev.overlayLabel);
    if (imgHint) imgHint.style.display = prev.hintDisplay;
  });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    preChangeState = {
      src: imgEl.getAttribute("src") || "",
      display: imgEl.style.display,
      empty: imgSection.classList.contains("editor-image--empty"),
      overlayLabel: imgOverlay.dataset.label,
      hintDisplay: imgHint ? imgHint.style.display : "",
    };
    const url = URL.createObjectURL(file);
    imgEl.src = url;
    imgEl.style.display = "";
    imgSection.classList.remove("editor-image--empty");
    setOverlayLabel("Change image");
    if (imgHint) imgHint.style.display = "none";
    bgWarning.style.display = "none";
    pendingPngBlobPromise = null;
    // Reset fallback state and any leftover copy from a previous picked file.
    inFallbackMode = false;
    warningTextEl.textContent = originalWarningText;
    removeLink.textContent = "Remove background";
    removeLink.classList.remove("is-loading");
    try {
      const result = await detectSolidBackground(file);
      if (result && result.solid) {
        bgWarning.style.display = "";
        // Kick off PNG conversion in parallel so it's ready when the user clicks "Remove background".
        pendingPngBlobPromise = fileToPngBlob(file).catch(() => null);
      }
    } catch { /* non-fatal */ }
  });

  // Delete image — clears the current photo back to the placeholder.
  let deleteImg = false;
  const updateDeleteBtnVisibility = () => {
    const hasPicked = !!fileInput.files?.[0];
    const hasSavedImg = !!item?.img && !deleteImg;
    overlayDeleteBtn.style.display = (hasPicked || hasSavedImg) ? "" : "none";
  };
  updateDeleteBtnVisibility();
  overlayDeleteBtn.addEventListener("click", (e) => {
    // Prevent the label from forwarding the click to the file input.
    e.preventDefault();
    e.stopPropagation();
    deleteImg = true;
    fileInput.value = "";
    pendingPngBlobPromise = null;
    bgWarning.style.display = "none";
    if (placeholderSrc) {
      imgEl.onerror = null;
      imgEl.src = placeholderSrc;
      imgEl.style.display = "";
      imgSection.classList.remove("editor-image--empty");
    } else {
      imgEl.removeAttribute("src");
      imgEl.style.display = "none";
      imgSection.classList.add("editor-image--empty");
    }
    setOverlayLabel("Add image");
    if (imgHint) imgHint.style.display = "";
    updateDeleteBtnVisibility();
  });
  fileInput.addEventListener("change", () => {
    deleteImg = false;
    updateDeleteBtnVisibility();
  });

  // Scrollable content wrapper (everything except footer)
  const scrollArea = document.createElement("div");
  scrollArea.className = "editor-scroll";

  scrollArea.appendChild(imgSection);
  scrollArea.appendChild(bgWarning);

  // Title
  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.className = "editor-title";
  titleInput.placeholder = "Coffee name";
  titleInput.value = item?.name || "";
  scrollArea.appendChild(titleInput);

  // Properties
  const propsSection = document.createElement("div");
  propsSection.className = "editor-props";

  const s = suggestions || {};
  const getTagValues = renderPillEditor(propsSection, { label: "Type", values: item?.tags || [], suggestions: s.type });
  const getRating = renderStarRating(propsSection, { rating: item?.rating || 0 });
  const getBrewerValues = renderPillEditor(propsSection, { label: "Brewer", values: item?.brewer || [], suggestions: s.brewer });
  const getGrinderValues = renderPillEditor(propsSection, { label: "Grinder", values: item?.grinder || [], suggestions: s.grinder });
  const getNotesValues = renderPillEditor(propsSection, { label: "Tasting Notes", values: item?.notes || [], suggestions: s.tastingNotes });

  scrollArea.appendChild(propsSection);

  // Tiptap editor
  const editorSection = document.createElement("div");
  editorSection.className = "editor-tiptap";

  const recipeBody = item ? extractRecipeBody(item.recipe_body || "") : "";

  const tiptapEl = document.createElement("div");
  tiptapEl.className = "editor-tiptap-content";
  editorSection.appendChild(tiptapEl);
  scrollArea.appendChild(editorSection);

  const tiptapEditor = new Editor({
    element: tiptapEl,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
      }),
      Markdown,
    ],
    content: recipeBody,
    contentType: "markdown",
  });

  const toolbar = createToolbar(tiptapEditor);
  editorSection.insertBefore(toolbar, tiptapEl);

  // Error area
  const errEl = document.createElement("p");
  errEl.className = "editor-error";
  scrollArea.appendChild(errEl);

  view.appendChild(scrollArea);

  // Footer
  const footer = document.createElement("div");
  footer.className = "editor-footer";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "editor-save-btn";
  saveBtn.textContent = "Save";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "editor-cancel-btn";
  cancelBtn.textContent = "Cancel";

  footer.appendChild(saveBtn);
  footer.appendChild(cancelBtn);

  if (!isNew) {
    const menuWrap = document.createElement("div");
    menuWrap.className = "editor-more-menu";

    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "editor-more-btn";
    menuBtn.innerHTML = "&#8942;"; // vertical ellipsis
    menuBtn.setAttribute("aria-label", "More options");

    const menuDropdown = document.createElement("div");
    menuDropdown.className = "editor-more-dropdown";

    const dupBtn = document.createElement("button");
    dupBtn.type = "button";
    dupBtn.className = "editor-more-item";
    dupBtn.textContent = "Duplicate";
    dupBtn.addEventListener("click", async () => {
      menuDropdown.classList.remove("open");
      errEl.textContent = "";
      try {
        // Get next number
        const { data: maxRow } = await supabase
          .from("coffees")
          .select("number")
          .eq("user_id", userId)
          .order("number", { ascending: false })
          .limit(1)
          .single();
        const nextNumber = (maxRow?.number || 0) + 1;

        // Copy the image to a new path if one exists
        let newImgUrl = item.img || null;
        if (newImgUrl) {
          const srcPath = `${userId}/coffee-bag-${pad2(item.number)}.webp`;
          const destPath = `${userId}/coffee-bag-${pad2(nextNumber)}.webp`;
          const resp = await fetch(newImgUrl);
          if (resp.ok) {
            const blob = await resp.blob();
            await supabase.storage.from("coffee-bags").upload(destPath, blob, { contentType: "image/webp", upsert: true });
            const { data } = supabase.storage.from("coffee-bags").getPublicUrl(destPath);
            newImgUrl = data.publicUrl;
          }
        }

        const payload = {
          number: nextNumber,
          user_id: userId,
          name: item.name + " (copy)",
          rating: item.rating || null,
          tags: item.tags || [],
          img_url: newImgUrl,
          img_width: item.img_width || null,
          img_height: item.img_height || null,
          notes: item.notes || [],
          brewer: item.brewer || [],
          grinder: item.grinder || [],
          recipe_body: item.recipe_body || "",
          roaster: item.roaster || "",
          origin: item.origin || "",
          process: item.process || "",
          brew: item.brew || "",
          updated_at: new Date().toISOString(),
        };

        const { data: inserted, error } = await supabase
          .from("coffees")
          .insert(payload)
          .select()
          .single();
        if (error) {
          errEl.textContent = error.message;
          return;
        }

        const dupItem = {
          id: inserted.id,
          number: inserted.number,
          name: inserted.name,
          rating: inserted.rating,
          tags: inserted.tags || [],
          img: inserted.img_url || "",
          img_width: inserted.img_width || null,
          img_height: inserted.img_height || null,
          roaster: inserted.roaster || "",
          origin: inserted.origin || "",
          process: inserted.process || "",
          notes: inserted.notes || [],
          brew: inserted.brew || "",
          brewer: inserted.brewer || [],
          grinder: inserted.grinder || [],
          recipe_body: inserted.recipe_body || "",
        };
        tiptapEditor.destroy();
        if (onDuplicate) onDuplicate(dupItem);
      } catch (err) {
        errEl.textContent = "Duplicate failed: " + (err.message || err);
      }
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "editor-more-item editor-more-item--danger";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", async () => {
      menuDropdown.classList.remove("open");
      if (!confirm("Are you sure you want to delete this coffee?")) return;
      errEl.textContent = "";
      try {
        const { error } = await supabase
          .from("coffees")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", item.id);
        if (error) {
          errEl.textContent = error.message;
          return;
        }
        tiptapEditor.destroy();
        if (onDelete) onDelete(item);
      } catch (err) {
        errEl.textContent = "Delete failed: " + (err.message || err);
      }
    });

    menuDropdown.appendChild(dupBtn);
    menuDropdown.appendChild(delBtn);
    menuWrap.appendChild(menuBtn);
    menuWrap.appendChild(menuDropdown);

    menuBtn.addEventListener("click", () => {
      menuDropdown.classList.toggle("open");
    });

    // Close menu when clicking outside
    document.addEventListener("click", (e) => {
      if (!menuWrap.contains(e.target)) menuDropdown.classList.remove("open");
    });

    footer.appendChild(menuWrap);
  }

  view.appendChild(footer);
  modalEl.appendChild(view);

  // Auto-focus title input
  requestAnimationFrame(() => titleInput.focus());

  // Save handler
  saveBtn.addEventListener("click", async () => {
    errEl.textContent = "";
    const name = titleInput.value.trim();
    if (!name) {
      errEl.textContent = "Name is required.";
      titleInput.focus();
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving\u2026";

    let imgUrl = item?.img || "";
    let imgWidth = item?.img_width || null;
    let imgHeight = item?.img_height || null;
    const file = fileInput.files?.[0];
    if (deleteImg && !(file && file.size)) {
      imgUrl = "";
      imgWidth = null;
      imgHeight = null;
    }
    if (file && file.size) {
      const number = item?.number || 0;
      const path = `${userId}/coffee-bag-${pad2(number || Date.now())}.webp`;
      let blob, width, height;
      try {
        ({ blob, width, height } = await resizeImage(file));
      } catch {
        errEl.textContent = "Image processing failed.";
        saveBtn.disabled = false;
        saveBtn.textContent = "Save";
        return;
      }
      const { error: upErr } = await supabase.storage.from("coffee-bags").upload(path, blob, {
        contentType: "image/webp",
        upsert: true,
      });
      if (upErr) {
        errEl.textContent = "Image upload failed: " + upErr.message;
        saveBtn.disabled = false;
        saveBtn.textContent = "Save";
        return;
      }
      const { data } = supabase.storage.from("coffee-bags").getPublicUrl(path);
      imgUrl = data.publicUrl;
      imgWidth = width;
      imgHeight = height;
    }

    const recipeMarkdown = tiptapEditor.getMarkdown ? tiptapEditor.getMarkdown() : tiptapEditor.storage.markdown.getMarkdown();

    const ratingVal = getRating();
    const payload = {
      name,
      rating: ratingVal || null,
      tags: getTagValues(),
      img_url: imgUrl || null,
      img_width: imgWidth,
      img_height: imgHeight,
      notes: getNotesValues(),
      brewer: getBrewerValues(),
      grinder: getGrinderValues(),
      recipe_body: recipeMarkdown,
      updated_at: new Date().toISOString(),
    };

    if (isNew) {
      const { data: maxRow } = await supabase
        .from("coffees")
        .select("number")
        .eq("user_id", userId)
        .order("number", { ascending: false })
        .limit(1)
        .single();
      const nextNumber = (maxRow?.number || 0) + 1;
      payload.number = nextNumber;
      payload.user_id = userId;
      payload.roaster = "";
      payload.origin = "";
      payload.process = "";
      payload.brew = "";

      const { data: inserted, error } = await supabase
        .from("coffees")
        .insert(payload)
        .select()
        .single();
      if (error) {
        errEl.textContent = error.message;
        saveBtn.disabled = false;
        saveBtn.textContent = "Save";
        return;
      }

      const savedItem = {
        id: inserted.id,
        number: inserted.number,
        name: inserted.name,
        rating: inserted.rating,
        tags: inserted.tags || [],
        img: inserted.img_url || "",
        img_width: inserted.img_width || null,
        img_height: inserted.img_height || null,
        roaster: inserted.roaster || "",
        origin: inserted.origin || "",
        process: inserted.process || "",
        notes: inserted.notes || [],
        brew: inserted.brew || "",
        brewer: inserted.brewer || [],
        grinder: inserted.grinder || [],
        recipe_body: inserted.recipe_body || "",
      };
      tiptapEditor.destroy();
      if (onSave) onSave(savedItem);
    } else {
      const { error } = await supabase.from("coffees").update(payload).eq("id", item.id);
      if (error) {
        errEl.textContent = error.message;
        saveBtn.disabled = false;
        saveBtn.textContent = "Save";
        return;
      }

      const savedItem = {
        ...item,
        name: payload.name,
        rating: payload.rating,
        tags: payload.tags,
        img: payload.img_url || item.img,
        notes: payload.notes,
        brewer: payload.brewer,
        grinder: payload.grinder,
        recipe_body: payload.recipe_body,
      };
      tiptapEditor.destroy();
      if (onSave) onSave(savedItem);
    }
  });

  // Cancel handler
  cancelBtn.addEventListener("click", () => {
    tiptapEditor.destroy();
    if (onCancel) onCancel();
  });

  return {
    cancel: () => {
      tiptapEditor.destroy();
      if (onCancel) onCancel();
    },
    destroy: () => {
      tiptapEditor.destroy();
    },
  };
}
