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
  
  // Lists - unordered (handle nested lists with indentation)
  // Process nested lists first (4 spaces or tab)
  html = html.replace(/^    [\*\-\+] (.+)$/gim, '<li class="nested">$1</li>');
  html = html.replace(/^\t[\*\-\+] (.+)$/gim, '<li class="nested">$1</li>');
  // Then regular list items
  html = html.replace(/^[\*\-\+] (.+)$/gim, '<li>$1</li>');
  
  // Lists - ordered
  html = html.replace(/^\d+\. (.+)$/gim, '<li>$1</li>');
  
  // Bold and italic (bold first, then italic)
  html = html.replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/gim, '<em>$1</em>');
  
  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  
  // Inline code (after code blocks)
  html = html.replace(/`([^`]+)`/gim, '<code>$1</code>');
  
  // Line breaks - convert double newlines to paragraph breaks
  const lines = html.split('\n');
  const processed = [];
  let inList = false;
  let inNestedList = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Skip empty lines
    if (!line) {
      if (inNestedList) {
        processed.push('</ul>');
        inNestedList = false;
      }
      if (inList) {
        processed.push('</ul>');
        inList = false;
      }
      continue;
    }
    
    // Check if it's a nested list item
    if (line.startsWith('<li class="nested">')) {
      if (!inList) {
        processed.push('<ul>');
        inList = true;
      }
      if (!inNestedList) {
        processed.push('<ul class="nested">');
        inNestedList = true;
      }
      processed.push(line);
    } 
    // Check if it's a regular list item
    else if (line.startsWith('<li>')) {
      // Close nested list if open
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
      // Close any open lists
      if (inNestedList) {
        processed.push('</ul>');
        inNestedList = false;
      }
      if (inList) {
        processed.push('</ul>');
        inList = false;
      }
      // Check if it's already a block element
      if (line.match(/^<(h[1-6]|pre|hr|ul|ol)/)) {
        processed.push(line);
      } else {
        // Wrap in paragraph
        processed.push(`<p>${line}</p>`);
      }
    }
  }
  
  // Close any remaining open lists
  if (inNestedList) {
    processed.push('</ul>');
  }
  if (inList) {
    processed.push('</ul>');
  }
  
  return processed.join('\n');
}

/**
 * Infinite scrollable masonry grid with drag
 * - Smaller bags, closer to original size
 * - Infinite scroll horizontal and vertical
 * - Seamless duplication
 */

function pad2(n) {
  return String(n).padStart(2, "0");
}

function imgFor(number) {
  return `/bags/coffee-bag-${pad2(number)}.png`;
}

async function main() {
  const res = await fetch("/data/coffee.json");
  const data = await res.json();

  const app = document.querySelector("#app");
  
  // Create stage as a direct child of body (moved from inside app)
  const stage = document.createElement("div");
  stage.id = "stage";
  stage.setAttribute("aria-label", "Infinite coffee grid");
  
  // Insert stage at index 3 in body (after app and script, before any other elements)
  const body = document.body;
  if (body.children.length >= 3) {
    body.insertBefore(stage, body.children[3]);
  } else {
    body.appendChild(stage);
  }

  // Tile dimensions - smaller for more frequent duplication
  // Must be declared before camera position initialization
  const TILE_WIDTH = 1800;
  const TILE_HEIGHT = 2400;
  // Detect mobile once at the start for use in layout calculations
  const isMobile = window.innerWidth <= 760 || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const GUTTER = 90; // Same gutter gap for desktop and mobile
  const COLS = 6; // Number of columns in the tile

  // Camera position (world-space)
  // Will be initialized after layout is created and window dimensions are known
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
  let lastDragEndTime = 0;
  // Track bag tap positions for better click detection
  let bagTapStartX = 0;
  let bagTapStartY = 0;
  let bagTapStartTime = 0;

  // Initialize items with doubled sizes
  // Same sizes for desktop and mobile
  const baseSize = 200;
  const sizeRange = 16;
  
  const baseItems = data.map((d) => {
    const number = Number(d.number);
    return {
      ...d,
      number,
      img: imgFor(number),
      // Doubled size - around 200-232px on desktop, 280-304px on mobile
      size: baseSize + (number % 3) * sizeRange,
    };
  });

  // Duplicate items to fill the view better (create variations)
  const duplicatedItems = [];
  // Same duplicate count for desktop and mobile
  const duplicateCount = 3;
  for (let i = 0; i < duplicateCount; i++) {
    baseItems.forEach((item) => {
      duplicatedItems.push({
        ...item,
        // Add a unique ID to track duplicates
        _duplicateId: i,
      });
    });
  }

  // Shuffle for better distribution
  for (let i = duplicatedItems.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [duplicatedItems[i], duplicatedItems[j]] = [duplicatedItems[j], duplicatedItems[i]];
  }

  // Create masonry layout within a tile
  // We'll create a promise-based layout that waits for images to load
  async function createTileLayout() {
    // Same padding for desktop and mobile
    const padding = 20;
    const placeW = TILE_WIDTH - padding * 2;
    const placeH = TILE_HEIGHT - padding * 2;
    const colWidth = (placeW - (COLS - 1) * GUTTER) / COLS;
    const colHeights = new Array(COLS).fill(0);

    const positionedItems = [];

    // Preload images and get their dimensions
    const imagePromises = duplicatedItems.map((it) => {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          resolve({
            ...it,
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
          });
        };
        img.onerror = () => {
          // Fallback dimensions if image fails to load
          resolve({
            ...it,
            naturalWidth: it.size * 0.75,
            naturalHeight: it.size,
          });
        };
        img.src = it.img;
      });
    });

    const itemsWithDimensions = await Promise.all(imagePromises);

    // Place items in masonry layout with duplicate spacing
    // Track recent placements to avoid placing duplicates close together
    const recentPlacements = []; // Track placements: { number, x, y }
    const MIN_DUPLICATE_DISTANCE = 600; // Minimum 2D distance between duplicates

    itemsWithDimensions.forEach((it) => {
      // Calculate item dimensions - constrain to column width to prevent cross-column overlaps
      const aspectRatio = it.naturalHeight / it.naturalWidth;
      const targetHeight = it.size;
      const calculatedWidth = targetHeight / aspectRatio;
      // Strictly limit width to column width (no 1.1x multiplier)
      const itemWidth = Math.min(colWidth, calculatedWidth);
      const itemHeight = itemWidth * aspectRatio;
      
      // Constraint: items must fit within tile boundaries (respecting padding)
      const maxY = TILE_HEIGHT - padding - itemHeight;

      // Helper function to check if a position has overlaps
      function checkOverlaps(x, y, width, height, excludeItem = null) {
        let maxOverlapBottom = 0;
        let hasAnyOverlap = false;
        
        for (const placed of positionedItems) {
          if (excludeItem && placed === excludeItem) continue;
          
          const itemLeft = x;
          const itemRight = x + width;
          const itemTop = y;
          const itemBottom = y + height;
          
          const placedLeft = placed.x;
          const placedRight = placed.x + placed.width;
          const placedTop = placed.y;
          const placedBottom = placed.y + placed.height;
          
          // Check for overlap (with gutter spacing)
          // Items overlap if their bounding boxes (with gutter) intersect
          const horizontalOverlap = itemLeft < placedRight + GUTTER && itemRight + GUTTER > placedLeft;
          const verticalOverlap = itemTop < placedBottom + GUTTER && itemBottom + GUTTER > placedTop;
          
          if (horizontalOverlap && verticalOverlap) {
            hasAnyOverlap = true;
            // Track the bottommost overlapping item to place below it
            maxOverlapBottom = Math.max(maxOverlapBottom, placedBottom);
          }
        }
        
        return { 
          hasOverlap: hasAnyOverlap, 
          overlapBottom: maxOverlapBottom 
        };
      }

      // Helper function to check if position is too close to duplicates
      function checkDuplicateProximity(x, y, itemNumber, itemWidth, itemHeight, minDistance = 500) {
        for (const placed of positionedItems) {
          if (placed.number === itemNumber) {
            const dx = Math.abs(x - placed.x);
            const dy = Math.abs(y - placed.y);
            
            // Calculate which columns the items are in
            const currentCol = Math.floor((x - padding) / (colWidth + GUTTER));
            const placedCol = Math.floor((placed.x - padding) / (colWidth + GUTTER));
            const colDistance = Math.abs(currentCol - placedCol);
            
            // Check if items are in adjacent columns (colDistance <= 1)
            if (colDistance <= 1) {
              // Check if Y positions overlap or are very close (within item height range)
              const currentTop = y;
              const currentBottom = y + itemHeight;
              const placedTop = placed.y;
              const placedBottom = placed.y + placed.height;
              
              // Check for vertical overlap or close proximity
              const verticalOverlap = !(currentBottom < placedTop - GUTTER || currentTop > placedBottom + GUTTER);
              const verticalClose = Math.abs(currentTop - placedTop) < Math.max(itemHeight, placed.height) + GUTTER * 2;
              
              if (verticalOverlap || verticalClose) {
                return { tooClose: true, distance: Math.sqrt(dx * dx + dy * dy), reason: 'adjacent_column' };
              }
            }
            
            // Check if vertically adjacent (same column or very close columns)
            if (colDistance === 0 || (colDistance === 1 && dx < colWidth + GUTTER)) {
              const verticalClose = dy < Math.max(itemHeight, placed.height) + GUTTER * 2;
              if (verticalClose) {
                return { tooClose: true, distance: Math.sqrt(dx * dx + dy * dy), reason: 'vertical_adjacent' };
              }
            }
            
            // Check 2D distance as fallback
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < minDistance) {
              return { tooClose: true, distance, reason: 'distance' };
            }
          }
        }
        return { tooClose: false };
      }

      // For each column, calculate where the item would be placed
      const columnOptions = [];
      
      for (let col = 0; col < COLS; col++) {
        // Calculate X position (centered in column, strictly within column bounds)
        const colLeft = padding + col * (colWidth + GUTTER);
        const x = colLeft + (colWidth - itemWidth) / 2;
        
        // Start Y at the column height
        let y = padding + colHeights[col];
        
        // Keep checking and adjusting Y until no overlaps
        let maxIterations = 100; // Safety limit
        let iterations = 0;
        while (iterations < maxIterations) {
          const overlapCheck = checkOverlaps(x, y, itemWidth, itemHeight);
          if (!overlapCheck.hasOverlap) {
            break; // No overlap, position is good
          }
          // Move below the overlapping item
          y = overlapCheck.overlapBottom + GUTTER;
          iterations++;
        }
        
        // Check if this position is too close to duplicates
        const duplicateCheck = checkDuplicateProximity(x, y, it.number, itemWidth, itemHeight);
        
        // Only add column option if item fits within tile boundary and isn't adjacent to duplicates
        if (y <= maxY && !duplicateCheck.tooClose) {
          const minDuplicateDistance = duplicateCheck.distance || Infinity;
          columnOptions.push({
            col,
            x,
            y,
            height: y,
            minDuplicateDistance,
          });
        }
      }

      // If no column options available (item too tall for tile), skip it
      if (columnOptions.length === 0) {
        return; // Skip this item, it doesn't fit in any column
      }

      // Select best column: prioritize avoiding adjacent duplicates
      // Sort by: 1) Not adjacent to duplicates, 2) Shortest column
      columnOptions.sort((a, b) => {
        // Prioritize columns with better duplicate distance
        if (a.minDuplicateDistance !== b.minDuplicateDistance) {
          return b.minDuplicateDistance - a.minDuplicateDistance;
        }
        // Then by shortest column
        return a.height - b.height;
      });
      
      let selectedCol = columnOptions[0];

      // Place the item - resolve all overlaps iteratively
      let finalX = selectedCol.x;
      let finalY = selectedCol.y;
      
      // Iteratively resolve all overlaps until none remain
      let maxResolveIterations = 200;
      let resolveIterations = 0;
      while (resolveIterations < maxResolveIterations) {
        const overlapCheck = checkOverlaps(finalX, finalY, itemWidth, itemHeight);
        if (!overlapCheck.hasOverlap) {
          // Check duplicates again after resolving overlaps
          const duplicateCheck = checkDuplicateProximity(finalX, finalY, it.number, itemWidth, itemHeight);
          if (!duplicateCheck.tooClose) {
            break; // No overlaps and no adjacent duplicates, position is good
          }
          // If too close to duplicate, move down further
          // Move down by at least the item height plus gutter to ensure separation
          finalY += Math.max(itemHeight, 200) + GUTTER * 2;
        } else {
          // Move below the overlapping item
          finalY = overlapCheck.overlapBottom + GUTTER;
        }
        
        // If item would extend beyond tile boundary, skip placing it
        if (finalY > maxY) {
          // Item doesn't fit in this tile, skip it entirely
          return; // Exit early, don't add to positionedItems
        }
        resolveIterations++;
      }
      
      // Final check: ensure not adjacent to duplicates
      const finalDuplicateCheck = checkDuplicateProximity(finalX, finalY, it.number, itemWidth, itemHeight);
      if (finalDuplicateCheck.tooClose) {
        // Try moving down significantly more to avoid adjacent duplicates
        finalY += Math.max(itemHeight, 250) + GUTTER * 3;
        if (finalY > maxY || finalY + itemHeight > TILE_HEIGHT - padding) {
          return; // Still too close or doesn't fit, skip this item
        }
        // Re-check after moving
        const recheck = checkDuplicateProximity(finalX, finalY, it.number, itemWidth, itemHeight);
        if (recheck.tooClose) {
          return; // Still too close, skip this item
        }
      }
      
      // Double-check item fits within tile before placing
      // Check both top edge and bottom edge
      if (finalY > maxY || finalY + itemHeight > TILE_HEIGHT - padding) {
        return; // Skip this item, it doesn't fit
      }
      
      // Final position after resolving all overlaps
      positionedItems.push({
        ...it,
        x: finalX,
        y: finalY,
        width: itemWidth,
        height: itemHeight,
      });
      
      // Update column height (but don't let it exceed tile boundary)
      const itemBottom = finalY + itemHeight + GUTTER;
      colHeights[selectedCol.col] = Math.min(itemBottom - padding, TILE_HEIGHT - padding * 2);

      // Track this placement
      recentPlacements.push({
        number: it.number,
        x: finalX,
        y: finalY,
      });
      
      // Keep only recent placements
      if (recentPlacements.length > 30) {
        recentPlacements.shift();
      }
    });

    return positionedItems;
  }

  // Wait for layout to be created
  const tileItems = await createTileLayout();

  // Initialize camera to center on a specific bag for a nicer initial view
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  
  // Find a bag positioned around the middle of the tile to center on
  // Pick a bag that's not too close to the edges
  let centerBag = null;
  const centerX = TILE_WIDTH / 2;
  const centerY = TILE_HEIGHT / 2;
  let minDistance = Infinity;
  
  // Find the bag closest to the center of the tile
  for (const item of tileItems) {
    const bagCenterX = item.x + item.width / 2;
    const bagCenterY = item.y + item.height / 2;
    const distance = Math.sqrt(
      Math.pow(bagCenterX - centerX, 2) + Math.pow(bagCenterY - centerY, 2)
    );
    if (distance < minDistance) {
      minDistance = distance;
      centerBag = item;
    }
  }
  
  // If we found a bag, center on it; otherwise fall back to tile center
  if (centerBag) {
    const bagCenterX = centerBag.x + centerBag.width / 2;
    const bagCenterY = centerBag.y + centerBag.height / 2;
    // Center the bag in the viewport
    camX = bagCenterX - vw / 2;
    camY = bagCenterY - vh / 2;
  } else {
    // Fallback to tile center
    camX = TILE_WIDTH / 2 - vw / 2;
    camY = TILE_HEIGHT / 2 - vh / 2;
  }
  
  targetCamX = camX;
  targetCamY = camY;

  // Create DOM elements for items (we'll duplicate these)
  const itemElements = new Map(); // Map from item number to element

  // Helper function to ensure cursor is set on bag elements
  function setupBagCursor(bagEl) {
    // Set cursor inline - this has high priority
    bagEl.style.cursor = "pointer";
    // Use mouseenter/mouseleave to track hover state
    bagEl.addEventListener("mouseenter", () => {
      bagEl.style.cursor = "pointer";
      bagHoverCount++;
      updateStageCursor();
    }, { passive: true });
    bagEl.addEventListener("mouseleave", () => {
      bagHoverCount--;
      updateStageCursor();
    }, { passive: true });
  }

  function createItemElement(item) {
    // Use duplicate ID to create unique elements for duplicates
    const key = `${item.number}_${item._duplicateId || 0}`;
    let el;
    
    if (itemElements.has(key)) {
      // Clone the element
      el = itemElements.get(key).cloneNode(true);
      // Ensure cursor is set on cloned elements
      setupBagCursor(el);
      // Re-attach event listener (cloneNode doesn't copy event listeners)
      // Use pointer events for better mobile support
      el.addEventListener("pointerdown", (e) => {
        bagTapStartX = e.clientX;
        bagTapStartY = e.clientY;
        bagTapStartTime = Date.now();
      }, { passive: true });
      
      el.addEventListener("pointerup", (e) => {
        e.stopPropagation();
        const dx = Math.abs(e.clientX - bagTapStartX);
        const dy = Math.abs(e.clientY - bagTapStartY);
        const timeDiff = Date.now() - bagTapStartTime;
        const distance = dx + dy;
        
        // If tap was quick (< 300ms) and movement was small (< 10px), treat as click
        if (timeDiff < 300 && distance < 10 && !dragging) {
          e.preventDefault();
          openModal(item);
        }
      }, { passive: false });
      return el;
    }

    el = document.createElement("button");
    el.className = "bag";
    el.type = "button";
    el.setAttribute("aria-label", item.name || `Coffee ${item.number}`);

    const img = document.createElement("img");
    img.src = item.img;
    img.alt = item.name ? `${item.name} bag` : `Coffee bag ${item.number}`;
    img.style.width = `${item.width}px`;
    img.style.height = `${item.height}px`;
    img.style.objectFit = "contain";

    el.appendChild(img);
    setupBagCursor(el);
    
    // Use pointer events for better mobile support
    el.addEventListener("pointerdown", (e) => {
      bagTapStartX = e.clientX;
      bagTapStartY = e.clientY;
      bagTapStartTime = Date.now();
    }, { passive: true });
    
    el.addEventListener("pointerup", (e) => {
      e.stopPropagation();
      const dx = Math.abs(e.clientX - bagTapStartX);
      const dy = Math.abs(e.clientY - bagTapStartY);
      const timeDiff = Date.now() - bagTapStartTime;
      const distance = dx + dy;
      
      // If tap was quick (< 300ms) and movement was small (< 10px), treat as click
      if (timeDiff < 300 && distance < 10 && !dragging) {
        e.preventDefault();
        openModal(item);
      }
    }, { passive: false });

    itemElements.set(key, el);
    return el;
  }

  // Active clones (visible items) - use Map for faster lookups
  const activeClones = [];
  const cloneMap = new Map(); // Key: `${item.number}_${item._duplicateId}_${tx}_${ty}`

  // Render function - creates/updates visible clones
  let lastTileX = Infinity;
  let lastTileY = Infinity;
  let frameCount = 0; // For frame-based throttling on mobile
  let renderPaused = false; // Pause rendering when modal is open

  function render() {
    // Skip rendering when modal is open for better scroll performance
    if (renderPaused) {
      requestAnimationFrame(render);
      return;
    }
    
    frameCount++;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Calculate which tiles are visible
    const centerX = camX + vw / 2;
    const centerY = camY + vh / 2;

    const tileX = Math.floor(centerX / TILE_WIDTH);
    const tileY = Math.floor(centerY / TILE_HEIGHT);

    // During drag, skip expensive operations (clone creation/removal)
    const isDragging = dragging;
    const tileChanged = tileX !== lastTileX || tileY !== lastTileY;
    lastTileX = tileX;
    lastTileY = tileY;

    // Render tiles in a grid around the center (larger radius to fill view)
    // Same render radius for desktop and mobile
    const renderRadius = 3;
    const tilesToRender = [];
    
    // Same render radius extension for desktop and mobile
    const radiusYDown = renderRadius + 1;
    const radiusYUp = renderRadius;

    for (let tx = tileX - renderRadius; tx <= tileX + renderRadius; tx++) {
      for (let ty = tileY - radiusYUp; ty <= tileY + radiusYDown; ty++) {
        tilesToRender.push({ tx, ty });
      }
    }

    // Create/remove clones when tile changes or when not dragging
    // On mobile, also update when tile changes during drag to prevent gaps
    if (!isDragging || tileChanged) {
      // Remove clones that are too far away (larger buffer for smooth transitions)
      // Same buffer for desktop and mobile
      const buffer = 800;
      const clonesToRemove = [];
      activeClones.forEach((clone, index) => {
        const worldX = clone.item.x + clone.tileX * TILE_WIDTH;
        const worldY = clone.item.y + clone.tileY * TILE_HEIGHT;

        const screenX = worldX - camX;
        const screenY = worldY - camY;

        if (
          screenX < -buffer ||
          screenY < -buffer ||
          screenX > vw + buffer ||
          screenY > vh + buffer
        ) {
          if (clone.el.parentNode) {
            clone.el.remove();
          }
          // Create key for map removal
          const key = `${clone.item.number}_${clone.item._duplicateId || 0}_${clone.tileX}_${clone.tileY}`;
          cloneMap.delete(key);
          clonesToRemove.push(index);
        }
      });

      // Remove clones in reverse order to maintain indices
      for (let i = clonesToRemove.length - 1; i >= 0; i--) {
        activeClones.splice(clonesToRemove[i], 1);
      }

      // Create new clones for visible tiles
      tilesToRender.forEach(({ tx, ty }) => {
        tileItems.forEach((item) => {
          const worldX = item.x + tx * TILE_WIDTH;
          const worldY = item.y + ty * TILE_HEIGHT;

          const screenX = worldX - camX;
          const screenY = worldY - camY;

          // Use Map for O(1) lookup instead of O(n) find
          const key = `${item.number}_${item._duplicateId || 0}_${tx}_${ty}`;
          const existing = cloneMap.get(key);

          if (!existing) {
            // Create new clone
            const el = createItemElement(item);
            el.style.position = "absolute";
            el.style.transform = `translate3d(${screenX}px, ${screenY}px, 0)`;
            el.style.willChange = "transform";
            // Cursor is already set by setupBagCursor in createItemElement
            stage.appendChild(el);

            const clone = {
              item,
              el,
              tileX: tx,
              tileY: ty,
            };
            activeClones.push(clone);
            cloneMap.set(key, clone);
          }
        });
      });
    }

    // Smooth camera interpolation for jitter-free movement
    // During drag, camera is updated directly in pointermove handler (no interpolation lag)
    // Only interpolate when not dragging for smooth deceleration
    if (!dragging) {
      if (Math.abs(targetCamX - camX) > 0.01 || Math.abs(targetCamY - camY) > 0.01) {
        // Smooth interpolation when idle (for scroll wheel, etc.)
        const lerpFactor = 0.2;
        camX += (targetCamX - camX) * lerpFactor;
        camY += (targetCamY - camY) * lerpFactor;
      } else {
        // Snap to target when very close to avoid micro-movements
        camX = targetCamX;
        camY = targetCamY;
      }
    }

    // Always update positions (this is fast - just transform updates)
    // Use sub-pixel precision for smoother rendering
    // Same update behavior for desktop and mobile
    const shouldUpdate = true;
    
    if (shouldUpdate) {
      // During drag, only update clones that are visible or near viewport for better performance
      // This prevents updating hundreds of off-screen clones
      const clonesToUpdate = dragging && activeClones.length > 50
        ? activeClones.filter((clone) => {
            const worldX = clone.item.x + clone.tileX * TILE_WIDTH;
            const worldY = clone.item.y + clone.tileY * TILE_HEIGHT;
            const screenX = worldX - camX;
            const screenY = worldY - camY;
            // Only update clones within viewport + margin
            return screenX > -vw && screenX < vw * 2 && screenY > -vh && screenY < vh * 2;
          })
        : activeClones;
      
      clonesToUpdate.forEach((clone) => {
        const worldX = clone.item.x + clone.tileX * TILE_WIDTH;
        const worldY = clone.item.y + clone.tileY * TILE_HEIGHT;

        const screenX = worldX - camX;
        const screenY = worldY - camY;

        // Browser handles sub-pixel rendering automatically
        clone.el.style.transform = `translate3d(${screenX}px, ${screenY}px, 0)`;
      });
    }

    requestAnimationFrame(render);
  }

  // Start render loop
  requestAnimationFrame(render);

  // Floating instruction element
  const instructionEl = document.createElement("div");
  instructionEl.className = "instruction";
  instructionEl.textContent = "Drag to explore • Open bag for details";
  document.body.appendChild(instructionEl);

  // Track if any bag is being hovered
  let bagHoverCount = 0;
  
  function updateStageCursor() {
    if (bagHoverCount > 0 && !dragging) {
      stage.classList.add("bag-hovered");
    } else {
      stage.classList.remove("bag-hovered");
    }
  }
  
  // Fallback: detect bags on mousemove in case event handlers weren't attached
  stage.addEventListener("mousemove", (e) => {
    if (dragging) return;
    const bag = e.target.closest('.bag');
    if (bag) {
      // Ensure cursor is set
      bag.style.cursor = "pointer";
      if (!stage.classList.contains("bag-hovered")) {
        stage.classList.add("bag-hovered");
      }
    }
  }, { passive: true });

  // Drag handlers
  stage.addEventListener("pointerdown", (e) => {
    // Don't start dragging if clicking on a bag button - let bag handle it
    if (e.target.closest('.bag')) {
      return;
    }
    
    // Prevent default immediately for faster touch response
    e.preventDefault();
    
    dragging = true;
    movedDuringDrag = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    lastX = e.clientX;
    lastY = e.clientY;
    // Sync target with current position when starting drag
    targetCamX = camX;
    targetCamY = camY;
    stage.classList.add("dragging");
    stage.setPointerCapture(e.pointerId);
  }, { passive: false });

  stage.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    
    // Prevent default to ensure smooth dragging on mobile
    e.preventDefault();

    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;

    // Only mark as moved if movement is significant (more than 3px for faster response)
    // Reduced threshold for faster drag detection
    if (Math.abs(dx) + Math.abs(dy) > 3) {
      movedDuringDrag = true;
    }

    // Update camera position directly during drag for instant response (no interpolation lag)
    camX -= dx;
    camY -= dy;
    // Also update target to keep them in sync
    targetCamX = camX;
    targetCamY = camY;

    lastX = e.clientX;
    lastY = e.clientY;
    
    // Immediately update positions for visible clones to reduce perceived delay
    // Update synchronously for immediate visual feedback, especially important on mobile
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    activeClones.forEach((clone) => {
      const worldX = clone.item.x + clone.tileX * TILE_WIDTH;
      const worldY = clone.item.y + clone.tileY * TILE_HEIGHT;
      const screenX = worldX - camX;
      const screenY = worldY - camY;
      // Only update visible clones to avoid performance hit
      if (screenX > -vw && screenX < vw * 2 && screenY > -vh && screenY < vh * 2) {
        clone.el.style.transform = `translate3d(${screenX}px, ${screenY}px, 0)`;
      }
    });
  }, { passive: false });

  stage.addEventListener("pointerup", (e) => {
    dragging = false;
    stage.classList.remove("dragging");
    stage.releasePointerCapture(e.pointerId);
    updateStageCursor(); // Update cursor state after drag ends
    lastDragEndTime = Date.now(); // Track when drag ended
    setTimeout(() => (movedDuringDrag = false), 100);
  }, { passive: true });

  // Scroll wheel navigation
  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    
    // Support both vertical and horizontal scrolling
    // Shift + wheel or horizontal wheel for horizontal scroll
    const deltaX = e.deltaX !== 0 ? e.deltaX : (e.shiftKey ? e.deltaY : 0);
    const deltaY = e.deltaY !== 0 && !e.shiftKey ? e.deltaY : 0;
    
    // Update target camera position (smooth interpolation happens in render loop)
    targetCamX -= deltaX * 1.2;
    targetCamY -= deltaY * 1.2;
  }, { passive: false });

  // --- Modal (lightbox) ---
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

  // Convert meta fields (Type, Brewer, Grinder, Rating) to pill elements
  function convertMetaFieldsToPills(container) {
    const fields = ["Tags", "Brewer", "Grinder", "Rating"];
    
    // Find all paragraphs that match our meta fields
    const paragraphs = container.querySelectorAll("p");
    paragraphs.forEach((p) => {
      const text = p.textContent.trim();
      
      // Remove Number field entirely
      if (text.startsWith("Number: ")) {
        p.remove();
        return;
      }
      
      // Check each field
      for (const field of fields) {
        const prefix = `${field}: `;
        if (text.startsWith(prefix)) {
          // Extract value (everything after the prefix)
          const valueText = text.substring(prefix.length).trim();
          
          // Determine display label (change Tags to Type)
          const displayLabel = field === "Tags" ? "Type: " : prefix;
          
          // For Rating, treat as single pill (stars)
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
            // For Tags, Brewer, Grinder - split by comma if multiple values
            const values = valueText
              .split(",")
              .map(val => val.trim())
              .filter(val => val.length > 0);
            
            if (values.length > 0) {
              const wrapper = document.createElement("div");
              wrapper.className = "tagsWrapper";
              
              const label = document.createElement("span");
              label.textContent = displayLabel;
              wrapper.appendChild(label);
              
              const pillRow = document.createElement("span");
              pillRow.className = "pillRow";
              
              // Create a pill for each value
              values.forEach((value) => {
                const pill = document.createElement("span");
                pill.className = "pill";
                pill.textContent = value;
                pillRow.appendChild(pill);
              });
              
              wrapper.appendChild(pillRow);
              
              // Replace the paragraph with the wrapper
              p.replaceWith(wrapper);
            }
          }
          break; // Found a match, no need to check other fields
        }
      }
    });
    
    // Convert Tasting Notes section to pills
    const headings = container.querySelectorAll("h3");
    headings.forEach((h3) => {
      // Case-insensitive match for "Tasting Notes" or "Tasting notes"
      if (h3.textContent.trim().toLowerCase() === "tasting notes") {
        // Find the next sibling ul element, skipping over empty paragraphs and whitespace
        let nextSibling = h3.nextElementSibling;
        while (nextSibling) {
          // Skip empty paragraphs
          if (nextSibling.tagName === "P" && nextSibling.textContent.trim() === "") {
            nextSibling = nextSibling.nextElementSibling;
            continue;
          }
          // Found a ul - use it
          if (nextSibling.tagName === "UL") {
            break;
          }
          // If we hit another heading or non-list element before finding ul, stop searching
          if (nextSibling.tagName === "H1" || nextSibling.tagName === "H2" || nextSibling.tagName === "H3" || nextSibling.tagName === "H4") {
            nextSibling = null;
            break;
          }
          // Otherwise continue searching
          nextSibling = nextSibling.nextElementSibling;
        }
        
        if (nextSibling && nextSibling.tagName === "UL") {
          // Get all list items (including nested ones)
          const listItems = nextSibling.querySelectorAll("li");
          const notes = Array.from(listItems)
            .map(li => li.textContent.trim())
            .filter(text => text.length > 0);
          
          if (notes.length > 0) {
            // Create wrapper
            const wrapper = document.createElement("div");
            wrapper.className = "tagsWrapper";
            
            // Keep the heading but style it inline
            const label = document.createElement("span");
            label.textContent = "Tasting Notes: ";
            wrapper.appendChild(label);
            
            // Create pill row
            const pillRow = document.createElement("span");
            pillRow.className = "pillRow";
            
            // Create a pill for each note
            notes.forEach((note) => {
              const pill = document.createElement("span");
              pill.className = "pill";
              pill.textContent = note;
              pillRow.appendChild(pill);
            });
            
            wrapper.appendChild(pillRow);
            
            // Remove empty paragraphs between h3 and ul
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
            
            // Replace both the heading and the ul with the wrapper
            h3.replaceWith(wrapper);
            nextSibling.remove();
          }
        }
      }
    });
    
    // Move Notes section to the bottom and convert h3 to h2
    const allHeadings = Array.from(container.querySelectorAll("h2, h3"));
    allHeadings.forEach((heading) => {
      // Case-insensitive match for "Notes"
      if (heading.textContent.trim().toLowerCase() === "notes") {
        // Convert h3 to h2 if needed
        if (heading.tagName === "H3") {
          const h2 = document.createElement("h2");
          h2.textContent = heading.textContent;
          heading.replaceWith(h2);
          heading = h2;
        }
        
        // Collect the Notes section (heading and all following content until next major heading)
        const notesSection = [];
        notesSection.push(heading);
        
        let nextSibling = heading.nextElementSibling;
        while (nextSibling) {
          // Stop if we hit another major heading
          if (nextSibling.tagName === "H1" || 
              nextSibling.tagName === "H2" || 
              (nextSibling.tagName === "H3" && nextSibling.textContent.trim().toLowerCase() !== "notes")) {
            break;
          }
          
          notesSection.push(nextSibling);
          nextSibling = nextSibling.nextElementSibling;
        }
        
        // Move all Notes section elements to the end
        if (notesSection.length > 0) {
          notesSection.forEach(element => {
            container.appendChild(element);
          });
        }
      }
    });
  }

  async function openModal(it) {
    mImg.src = it.img;
    mImg.alt = it.name ? `${it.name} bag` : `Coffee bag ${it.number}`;
    mTitle.textContent = ""; // Clear title initially

    // Load markdown recipe
    mRecipe.innerHTML = '<div class="loading">Loading recipe...</div>';
    // Show modal immediately
    overlay.classList.add("open");
    overlay.style.display = "flex";
    overlay.style.visibility = "visible";
    overlay.style.opacity = "1";
    overlay.style.zIndex = "2000";
    renderPaused = true; // Pause grid rendering when modal is open
    
    // Scroll modal body to top
    const modalBody = overlay.querySelector(".modalBody");
    if (modalBody) {
      modalBody.scrollTop = 0;
    }
    
    try {
      // Try to load markdown file - adjust path based on where you place your .md files
      // Options: /recipes/coffee-01.md, /src/data/recipes/coffee-01.md, etc.
      const recipePath = `/recipes/coffee-${pad2(it.number)}.md`;
      const response = await fetch(recipePath);
      
      if (response.ok) {
        const markdown = await response.text();
        const html = parseMarkdown(markdown);
        
        // Extract H1 from the parsed HTML and move it to titleRow
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = html;
        const h1 = tempDiv.querySelector("h1");
        
        if (h1) {
          // Set title from H1
          mTitle.textContent = h1.textContent;
          // Remove H1 from recipe content
          h1.remove();
        }
        
        // Convert meta fields to pills (after H1 extraction)
        convertMetaFieldsToPills(tempDiv);
        
        // Set the final HTML
        mRecipe.innerHTML = tempDiv.innerHTML;
      } else {
        // Try alternative path
        const altPath = `/src/data/recipes/coffee-${pad2(it.number)}.md`;
        const altResponse = await fetch(altPath);
        if (altResponse.ok) {
          const markdown = await altResponse.text();
          const html = parseMarkdown(markdown);
          
          // Extract H1 from the parsed HTML and move it to titleRow
          const tempDiv = document.createElement("div");
          tempDiv.innerHTML = html;
          const h1 = tempDiv.querySelector("h1");
          
          if (h1) {
            // Set title from H1
            mTitle.textContent = h1.textContent;
            // Remove H1 from recipe content
            h1.remove();
          }
          
          // Convert meta fields to pills (after H1 extraction)
          convertMetaFieldsToPills(tempDiv);
          
          // Set the final HTML
          mRecipe.innerHTML = tempDiv.innerHTML;
        } else {
          mRecipe.innerHTML = '<div class="no-recipe">No recipe available for this coffee.</div>';
        }
      }
    } catch (error) {
      console.error("Error loading recipe:", error);
      mRecipe.innerHTML = '<div class="no-recipe">Error loading recipe. Please check that the markdown file exists.</div>';
    }
  }

  function closeModal() {
    overlay.classList.remove("open");
    overlay.style.display = "none";
    overlay.style.visibility = "hidden";
    renderPaused = false; // Resume grid rendering when modal closes
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
  app.innerHTML = `<pre style="padding:24px;color:red;">${String(err)}</pre>`;
});
