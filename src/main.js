import "./style.css";

// Simple markdown parser
function parseMarkdown(md) {
  if (!md) return "";
  
  let html = md;
  
  // Code blocks (do first to avoid processing content inside)
  html = html.replace(/```([\w]*)\n?([\s\S]*?)```/gim, '<pre><code>$2</code></pre>');
  
  // Headers (process before other formatting)
  html = html.replace(/^#### (.*$)/gim, '<h4>$1</h4>');
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
  
  // Horizontal rules
  html = html.replace(/^---$/gim, '<hr>');
  html = html.replace(/^\*\*\*$/gim, '<hr>');
  
  // Lists - unordered
  html = html.replace(/^    [\*\-\+] (.+)$/gim, '<li class="nested">$1</li>');
  html = html.replace(/^\t[\*\-\+] (.+)$/gim, '<li class="nested">$1</li>');
  html = html.replace(/^[\*\-\+] (.+)$/gim, '<li>$1</li>');
  
  // Lists - ordered
  html = html.replace(/^\d+\. (.+)$/gim, '<li>$1</li>');
  
  // Bold and italic
  html = html.replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/gim, '<em>$1</em>');
  
  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  
  // Inline code
  html = html.replace(/`([^`]+)`/gim, '<code>$1</code>');
  
  // Line breaks
  const lines = html.split('\n');
  const processed = [];
  let inList = false;
  let inNestedList = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (line.startsWith('<li class="nested">')) {
      if (!inNestedList) {
        if (!inList) {
          processed.push('<ul>');
          inList = true;
        }
        processed.push('<ul>');
        inNestedList = true;
      }
      processed.push(line);
    } else if (line.startsWith('<li>')) {
      if (inNestedList) {
        processed.push('</ul>');
        inNestedList = false;
      }
      if (!inList) {
        processed.push('<ul>');
        inList = true;
      }
      processed.push(line);
    } else {
      if (inNestedList) {
        processed.push('</ul>');
        inNestedList = false;
      }
      if (inList) {
        processed.push('</ul>');
        inList = false;
      }
      
      if (line === '') {
        processed.push('');
      } else if (line.startsWith('<h') || line.startsWith('<pre') || line.startsWith('<hr') || line.startsWith('<ul') || line.startsWith('</ul')) {
        processed.push(line);
      } else {
        processed.push(`<p>${line}</p>`);
      }
    }
  }
  
  if (inNestedList) processed.push('</ul>');
  if (inList) processed.push('</ul>');
  
  html = processed.join('\n');
  html = html.replace(/<p><\/p>/g, '');
  
  return html;
}

async function main() {
  // Fetch data
  const res = await fetch("/data/coffee.json", { cache: "default" });
  const data = await res.json();

  // Helper functions
  const pad2 = (n) => String(n).padStart(2, "0");
  const imgFor = (n) => `/bags/coffee-bag-${pad2(n)}.png`;

  // Create canvas
  const canvas = document.createElement("canvas");
  canvas.id = "stage";
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  // High-DPI support
  let dpr = window.devicePixelRatio || 1;
  let canvasWidth = window.innerWidth;
  let canvasHeight = window.innerHeight;

  function resizeCanvas() {
    dpr = window.devicePixelRatio || 1;
    canvasWidth = window.innerWidth;
    canvasHeight = window.innerHeight;
    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;
    canvas.style.width = canvasWidth + "px";
    canvas.style.height = canvasHeight + "px";
    ctx.scale(dpr, dpr);
  }
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  // Tile dimensions - 10 columns makes bags ~25% smaller
  const TILE_WIDTH = 2400;
  let TILE_HEIGHT = 4000; // Will be calculated after layout
  const GUTTER = 60;
  const COLS = 10;

  // Camera position
  let camX = 0;
  let camY = 0;
  let targetCamX = 0;
  let targetCamY = 0;

  // Drag state
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let movedDuringDrag = false;
  let dragStartX = 0;
  let dragStartY = 0;

  // Velocity for momentum
  let velocityX = 0;
  let velocityY = 0;
  let lastMoveTime = 0;

  // Items setup - use actual image dimensions (no resizing)
  const baseItems = data.map((d) => {
    const number = Number(d.number);
    return {
      ...d,
      number,
      img: imgFor(number),
    };
  });

  // Create duplicated items for tile
  const duplicatedItems = [];
  const duplicateCount = 3;
  for (let i = 0; i < duplicateCount; i++) {
    baseItems.forEach((item) => {
      duplicatedItems.push({
        ...item,
        _duplicateId: i,
      });
    });
  }

  // Shuffle
  for (let i = duplicatedItems.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [duplicatedItems[i], duplicatedItems[j]] = [duplicatedItems[j], duplicatedItems[i]];
  }

  // Preload images and get their dimensions
  const imageCache = new Map();
  const imageDimensions = new Map();
  
  const imageLoadPromises = baseItems.map((item) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        imageCache.set(item.number, img);
        // Store actual dimensions for aspect ratio calculation
        imageDimensions.set(item.number, {
          width: img.naturalWidth,
          height: img.naturalHeight,
          aspectRatio: img.naturalHeight / img.naturalWidth
        });
        resolve();
      };
      img.onerror = () => resolve();
      img.src = item.img;
    });
  });

  // Wait for all images to load
  await Promise.all(imageLoadPromises);

  // Create masonry layout for a tile using actual image sizes
  // Store column ending heights for seamless tiling
  let columnEndHeights = [];
  
  function createTileLayout() {
    const sidePadding = 30;
    const colWidth = (TILE_WIDTH - sidePadding * 2 - GUTTER * (COLS - 1)) / COLS;
    
    // Start columns at 0
    const colHeights = Array(COLS).fill(0);

    const tileItems = [];

    duplicatedItems.forEach((item) => {
      // Find shortest column
      let minCol = 0;
      let minH = colHeights[0];
      for (let c = 1; c < COLS; c++) {
        if (colHeights[c] < minH) {
          minH = colHeights[c];
          minCol = c;
        }
      }

      // Get actual image dimensions - scale to fit column while preserving aspect ratio
      const dims = imageDimensions.get(item.number);
      if (!dims) return;
      
      // Scale image to fit column width
      const scale = colWidth / dims.width;
      const w = colWidth;
      const h = dims.height * scale;
      
      const x = sidePadding + minCol * (colWidth + GUTTER);
      const y = colHeights[minCol];

      tileItems.push({
        ...item,
        x,
        y,
        width: w,
        height: h,
        col: minCol,
      });

      colHeights[minCol] += h + GUTTER;
    });

    // Store where each column ends
    columnEndHeights = [...colHeights];
    const maxHeight = Math.max(...colHeights);
    
    // For seamless tiling: each column starts offset by (maxHeight - its end height)
    // This is the "start offset" for items in subsequent tiles
    TILE_HEIGHT = maxHeight;

    return tileItems;
  }

  const tileItems = createTileLayout();

  // Center camera on a featured bag (first bag in middle column)
  // Find a bag roughly in the center of the layout
  const middleCol = Math.floor(COLS / 2);
  const centerBag = tileItems.find(item => item.col === middleCol) || tileItems[0];
  
  // Position camera so this bag is centered on screen
  camX = centerBag.x + centerBag.width / 2 - canvasWidth / 2;
  camY = centerBag.y + centerBag.height / 2 - canvasHeight / 2;
  targetCamX = camX;
  targetCamY = camY;

  // Render paused flag (for modal)
  let renderPaused = false;

  // Render function
  function render() {
    if (renderPaused) {
      requestAnimationFrame(render);
      return;
    }

    // Clear canvas
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#F6F0E6";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Apply momentum when not dragging
    if (!dragging) {
      velocityX *= 0.95;
      velocityY *= 0.95;
      
      if (Math.abs(velocityX) > 0.1 || Math.abs(velocityY) > 0.1) {
        camX += velocityX;
        camY += velocityY;
        targetCamX = camX;
        targetCamY = camY;
      }
    }

    // Smooth camera interpolation
    const lerpFactor = 0.15;
    camX += (targetCamX - camX) * lerpFactor;
    camY += (targetCamY - camY) * lerpFactor;

    // Calculate visible tile range - render tiles in all directions
    const tileX = Math.floor(camX / TILE_WIDTH);
    const tileY = Math.floor(camY / TILE_HEIGHT);
    
    // Calculate how many tiles are needed to cover the screen
    const tilesNeededX = Math.ceil(canvasWidth / TILE_WIDTH) + 2;
    const tilesNeededY = Math.ceil(canvasHeight / TILE_HEIGHT) + 2;

    // Draw items using continuous column positioning (seamless infinite scroll)
    // Instead of tiling, we calculate each item's position in a continuous column
    
    // Calculate view bounds in world space
    const viewLeft = camX - 200;
    const viewRight = camX + canvasWidth + 200;
    const viewTop = camY - 200;
    const viewBottom = camY + canvasHeight + 200;
    
    // For each column, calculate which items are visible
    for (let col = 0; col < COLS; col++) {
      const colItems = tileItems.filter(item => item.col === col);
      if (colItems.length === 0) continue;
      
      // Column height (for one set of items)
      const colHeight = columnEndHeights[col];
      
      // Calculate which tile rows this column needs to render
      const startTileY = Math.floor(viewTop / colHeight) - 1;
      const endTileY = Math.ceil(viewBottom / colHeight) + 1;
      
      for (let ty = startTileY; ty <= endTileY; ty++) {
        colItems.forEach((item) => {
          // Calculate position using this column's height for tiling
          const worldY = item.y + ty * colHeight;
          
          // Skip if out of vertical view
          if (worldY + item.height < viewTop || worldY > viewBottom) return;
          
          // Horizontal tiling
          const startTileX = Math.floor(viewLeft / TILE_WIDTH) - 1;
          const endTileX = Math.ceil(viewRight / TILE_WIDTH) + 1;
          
          for (let tx = startTileX; tx <= endTileX; tx++) {
            const worldX = item.x + tx * TILE_WIDTH;
            
            // Skip if out of horizontal view
            if (worldX + item.width < viewLeft || worldX > viewRight) continue;
            
            const screenX = worldX - camX;
            const screenY = worldY - camY;
            
            const img = imageCache.get(item.number);
            if (img) {
              ctx.drawImage(img, screenX, screenY, item.width, item.height);
            }
          }
        });
      }
    }

    requestAnimationFrame(render);
  }

  // Start render loop
  requestAnimationFrame(render);

  // Hit testing - find item at screen position
  function hitTest(clickX, clickY) {
    const worldX = clickX + camX;
    const worldY = clickY + camY;
    
    // Check each column with its own tiling height
    for (let col = COLS - 1; col >= 0; col--) {
      const colItems = tileItems.filter(item => item.col === col);
      const colHeight = columnEndHeights[col];
      
      // Find which tile row in this column
      const tileY = Math.floor(worldY / colHeight);
      const localY = worldY - tileY * colHeight;
      
      // Find which tile col horizontally
      const tileX = Math.floor(worldX / TILE_WIDTH);
      const localX = worldX - tileX * TILE_WIDTH;
      
      // Check items in this column (reverse order for z-index)
      for (let i = colItems.length - 1; i >= 0; i--) {
        const item = colItems[i];
        
        if (
          localX >= item.x &&
          localX <= item.x + item.width &&
          localY >= item.y &&
          localY <= item.y + item.height
        ) {
          return item;
        }
      }
    }
    return null;
  }

  // Touch/Mouse handling
  let touchId = null;
  let tapStartX = 0;
  let tapStartY = 0;
  let tapStartTime = 0;

  // Touch events
  canvas.addEventListener("touchstart", (e) => {
    if (touchId !== null) return;
    
    const touch = e.touches[0];
    touchId = touch.identifier;
    dragging = true;
    movedDuringDrag = false;
    lastX = touch.clientX;
    lastY = touch.clientY;
    tapStartX = touch.clientX;
    tapStartY = touch.clientY;
    tapStartTime = Date.now();
    velocityX = 0;
    velocityY = 0;
    lastMoveTime = Date.now();
  }, { passive: true });

  canvas.addEventListener("touchmove", (e) => {
    if (touchId === null) return;

    let touch = null;
    for (let i = 0; i < e.touches.length; i++) {
      if (e.touches[i].identifier === touchId) {
        touch = e.touches[i];
        break;
      }
    }
    if (!touch) return;

    e.preventDefault();

    const dx = touch.clientX - lastX;
    const dy = touch.clientY - lastY;
    const now = Date.now();
    const dt = now - lastMoveTime;

    if (Math.abs(dx) + Math.abs(dy) > 3) {
      movedDuringDrag = true;
    }

    // Update camera
    camX -= dx;
    camY -= dy;
    targetCamX = camX;
    targetCamY = camY;

    // Calculate velocity for momentum
    if (dt > 0) {
      velocityX = -dx * (16 / dt); // Normalize to ~60fps
      velocityY = -dy * (16 / dt);
    }

    lastX = touch.clientX;
    lastY = touch.clientY;
    lastMoveTime = now;
  }, { passive: false });

  canvas.addEventListener("touchend", (e) => {
    let found = false;
    for (let i = 0; i < e.touches.length; i++) {
      if (e.touches[i].identifier === touchId) {
        found = true;
        break;
      }
    }
    if (found) return;

    // Check for tap
    const touch = e.changedTouches[0];
    const dx = Math.abs(touch.clientX - tapStartX);
    const dy = Math.abs(touch.clientY - tapStartY);
    const timeDiff = Date.now() - tapStartTime;

    if (timeDiff < 300 && dx + dy < 15 && !movedDuringDrag) {
      const item = hitTest(touch.clientX, touch.clientY);
      if (item) {
        openModal(item);
      }
    }

    touchId = null;
    dragging = false;
    movedDuringDrag = false;
  }, { passive: true });

  canvas.addEventListener("touchcancel", () => {
    touchId = null;
    dragging = false;
    velocityX = 0;
    velocityY = 0;
  }, { passive: true });

  // Mouse events (desktop)
  canvas.addEventListener("mousedown", (e) => {
    dragging = true;
    movedDuringDrag = false;
    lastX = e.clientX;
    lastY = e.clientY;
    tapStartX = e.clientX;
    tapStartY = e.clientY;
    tapStartTime = Date.now();
    velocityX = 0;
    velocityY = 0;
    lastMoveTime = Date.now();
    canvas.style.cursor = "grabbing";
  });

  canvas.addEventListener("mousemove", (e) => {
    // Update cursor based on hover
    if (!dragging) {
      const item = hitTest(e.clientX, e.clientY);
      canvas.style.cursor = item ? "pointer" : "grab";
      return;
    }

    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    const now = Date.now();
    const dt = now - lastMoveTime;

    if (Math.abs(dx) + Math.abs(dy) > 3) {
      movedDuringDrag = true;
    }

    camX -= dx;
    camY -= dy;
    targetCamX = camX;
    targetCamY = camY;

    if (dt > 0) {
      velocityX = -dx * (16 / dt);
      velocityY = -dy * (16 / dt);
    }

    lastX = e.clientX;
    lastY = e.clientY;
    lastMoveTime = now;
  });

  canvas.addEventListener("mouseup", (e) => {
    if (!dragging) return;

    const dx = Math.abs(e.clientX - tapStartX);
    const dy = Math.abs(e.clientY - tapStartY);
    const timeDiff = Date.now() - tapStartTime;

    if (timeDiff < 300 && dx + dy < 10 && !movedDuringDrag) {
      const item = hitTest(e.clientX, e.clientY);
      if (item) {
        openModal(item);
      }
    }

    dragging = false;
    movedDuringDrag = false;
    canvas.style.cursor = "grab";
  });

  canvas.addEventListener("mouseleave", () => {
    if (dragging) {
      dragging = false;
      canvas.style.cursor = "grab";
    }
  });

  // Mouse wheel
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const deltaX = e.deltaX !== 0 ? e.deltaX : (e.shiftKey ? e.deltaY : 0);
    const deltaY = e.deltaY !== 0 && !e.shiftKey ? e.deltaY : 0;
    targetCamX += deltaX * 1.2;
    targetCamY += deltaY * 1.2;
  }, { passive: false });

  // Instruction element
  const instructionEl = document.createElement("div");
  instructionEl.className = "instruction";
  instructionEl.textContent = "Drag to explore • Tap bag for details";
  document.body.appendChild(instructionEl);

  // Modal
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modalMedia"><img id="mImg" alt="" /></div>
      <div class="modalBody">
        <div class="titleRow">
          <h1 id="mTitle"></h1>
          <button class="closeBtn" id="mClose">×</button>
        </div>
        <div class="recipeContent" id="mRecipe">
          <div class="loading">Loading recipe...</div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const mImg = overlay.querySelector("#mImg");
  const mTitle = overlay.querySelector("#mTitle");
  const mRecipe = overlay.querySelector("#mRecipe");
  const mClose = overlay.querySelector("#mClose");

  // Convert meta fields to pills
  function convertMetaFieldsToPills(container) {
    const fields = ["Tags", "Brewer", "Grinder", "Rating"];
    
    const paragraphs = container.querySelectorAll("p");
    paragraphs.forEach((p) => {
      const text = p.textContent.trim();
      
      if (text.startsWith("Number: ")) {
        p.remove();
        return;
      }
      
      for (const field of fields) {
        const prefix = `${field}: `;
        if (text.startsWith(prefix)) {
          const valueText = text.substring(prefix.length).trim();
          const displayLabel = field === "Tags" ? "Type: " : prefix;
          
          if (field === "Rating") {
            const wrapper = document.createElement("div");
            wrapper.className = "tagsWrapper";
            
            const label = document.createElement("span");
            label.textContent = displayLabel;
            wrapper.appendChild(label);
            
            const pill = document.createElement("span");
            pill.className = "pill";
            pill.textContent = valueText;
            wrapper.appendChild(pill);
            
            p.replaceWith(wrapper);
          } else {
            const values = valueText.split(",").map(val => val.trim()).filter(val => val.length > 0);
            
            if (values.length > 0) {
              const wrapper = document.createElement("div");
              wrapper.className = "tagsWrapper";
              
              const label = document.createElement("span");
              label.textContent = displayLabel;
              wrapper.appendChild(label);
              
              const pillRow = document.createElement("span");
              pillRow.className = "pillRow";
              
              values.forEach((value) => {
                const pill = document.createElement("span");
                pill.className = "pill";
                pill.textContent = value;
                pillRow.appendChild(pill);
              });
              
              wrapper.appendChild(pillRow);
              p.replaceWith(wrapper);
            }
          }
          break;
        }
      }
    });
    
    // Convert Tasting Notes section to pills
    const headings = container.querySelectorAll("h3");
    headings.forEach((h3) => {
      if (h3.textContent.trim().toLowerCase() === "tasting notes") {
        let nextSibling = h3.nextElementSibling;
        while (nextSibling) {
          if (nextSibling.tagName === "P" && nextSibling.textContent.trim() === "") {
            nextSibling = nextSibling.nextElementSibling;
            continue;
          }
          if (nextSibling.tagName === "UL") break;
          if (["H1", "H2", "H3", "H4"].includes(nextSibling.tagName)) {
            nextSibling = null;
            break;
          }
          nextSibling = nextSibling.nextElementSibling;
        }
        
        if (nextSibling && nextSibling.tagName === "UL") {
          const listItems = nextSibling.querySelectorAll("li");
          const notes = Array.from(listItems).map(li => li.textContent.trim()).filter(text => text.length > 0);
          
          if (notes.length > 0) {
            const wrapper = document.createElement("div");
            wrapper.className = "tagsWrapper";
            
            const label = document.createElement("span");
            label.textContent = "Tasting Notes: ";
            wrapper.appendChild(label);
            
            const pillRow = document.createElement("span");
            pillRow.className = "pillRow";
            
            notes.forEach((note) => {
              const pill = document.createElement("span");
              pill.className = "pill";
              pill.textContent = note;
              pillRow.appendChild(pill);
            });
            
            wrapper.appendChild(pillRow);
            
            let toRemove = h3.nextElementSibling;
            while (toRemove && toRemove !== nextSibling) {
              if (toRemove.tagName === "P" && toRemove.textContent.trim() === "") {
                const temp = toRemove.nextElementSibling;
                toRemove.remove();
                toRemove = temp;
              } else {
                toRemove = toRemove.nextElementSibling;
              }
            }
            
            h3.replaceWith(wrapper);
            nextSibling.remove();
          }
        }
      }
    });
    
    // Move Notes section to bottom
    const allHeadings = Array.from(container.querySelectorAll("h2, h3"));
    allHeadings.forEach((heading) => {
      const text = heading.textContent.trim().toLowerCase();
      if (text === "notes" || text === "note") {
        heading.outerHTML = heading.outerHTML.replace(/^<h3/, "<h2").replace(/<\/h3>$/, "</h2>");
        
        const updatedHeading = Array.from(container.querySelectorAll("h2")).find(
          h => h.textContent.trim().toLowerCase() === text
        );
        
        if (updatedHeading) {
          const elementsToMove = [updatedHeading];
          let sibling = updatedHeading.nextElementSibling;
          while (sibling && !["H1", "H2"].includes(sibling.tagName)) {
            elementsToMove.push(sibling);
            sibling = sibling.nextElementSibling;
          }
          
          elementsToMove.forEach(element => {
            container.appendChild(element);
          });
        }
      }
    });
  }

  async function openModal(it) {
    mImg.src = it.img;
    mImg.alt = it.name ? `${it.name} bag` : `Coffee bag ${it.number}`;
    mTitle.textContent = "";

    mRecipe.innerHTML = '<div class="loading">Loading recipe...</div>';
    overlay.classList.add("open");
    overlay.style.display = "flex";
    overlay.style.visibility = "visible";
    overlay.style.opacity = "1";
    overlay.style.zIndex = "2000";
    renderPaused = true;
    
    const modalBody = overlay.querySelector(".modalBody");
    if (modalBody) modalBody.scrollTop = 0;
    
    try {
      const recipePath = `/recipes/coffee-${pad2(it.number)}.md`;
      const response = await fetch(recipePath, { cache: "default" });
      
      if (response.ok) {
        const markdown = await response.text();
        const html = parseMarkdown(markdown);
        
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = html;
        const h1 = tempDiv.querySelector("h1");
        
        if (h1) {
          mTitle.textContent = h1.textContent;
          h1.remove();
        }
        
        convertMetaFieldsToPills(tempDiv);
        mRecipe.innerHTML = tempDiv.innerHTML;
      } else {
        const altPath = `/src/data/recipes/coffee-${pad2(it.number)}.md`;
        const altResponse = await fetch(altPath);
        if (altResponse.ok) {
          const markdown = await altResponse.text();
          const html = parseMarkdown(markdown);
          
          const tempDiv = document.createElement("div");
          tempDiv.innerHTML = html;
          const h1 = tempDiv.querySelector("h1");
          
          if (h1) {
            mTitle.textContent = h1.textContent;
            h1.remove();
          }
          
          convertMetaFieldsToPills(tempDiv);
          mRecipe.innerHTML = tempDiv.innerHTML;
        } else {
          mRecipe.innerHTML = '<div class="no-recipe">No recipe available for this coffee.</div>';
        }
      }
    } catch (error) {
      console.error("Error loading recipe:", error);
      mRecipe.innerHTML = '<div class="no-recipe">Error loading recipe.</div>';
    }
  }

  function closeModal() {
    overlay.classList.remove("open");
    overlay.style.display = "none";
    overlay.style.visibility = "hidden";
    renderPaused = false;
  }

  mClose.addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
}

main().catch((err) => {
  console.error(err);
  const app = document.querySelector("#app");
  if (app) app.innerHTML = `<pre style="padding:24px;color:red;">${String(err)}</pre>`;
});
