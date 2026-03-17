import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";

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
        if (blob) resolve(blob);
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

  if (recipeStart === -1) return "";
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

export function createCoffeeEditor(modalEl, { item, supabase, pad2, suggestions, placeholderSrc, userId, onSave, onCancel, onDelete }) {
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
  imgOverlay.textContent = item?.img ? "Change image" : "Add image";
  imgSection.appendChild(imgOverlay);

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/png,image/jpeg,image/webp";
  fileInput.style.display = "none";
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      imgEl.src = url;
      imgEl.style.display = "";
      imgSection.classList.remove("editor-image--empty");
      imgOverlay.textContent = "Change image";
    }
  });
  imgSection.appendChild(fileInput);

  // Scrollable content wrapper (everything except footer)
  const scrollArea = document.createElement("div");
  scrollArea.className = "editor-scroll";

  scrollArea.appendChild(imgSection);

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
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "editor-delete-btn";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", async () => {
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
    footer.appendChild(deleteBtn);
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
    const file = fileInput.files?.[0];
    if (file && file.size) {
      const number = item?.number || 0;
      const path = `${userId}/coffee-bag-${pad2(number || Date.now())}.webp`;
      let blob;
      try {
        blob = await resizeImage(file);
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
    }

    const recipeMarkdown = tiptapEditor.getMarkdown ? tiptapEditor.getMarkdown() : tiptapEditor.storage.markdown.getMarkdown();

    const ratingVal = getRating();
    const payload = {
      name,
      rating: ratingVal || null,
      tags: getTagValues(),
      img_url: imgUrl || null,
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
