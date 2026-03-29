import "./style.css";
import { inject } from "@vercel/analytics";
import { injectSpeedInsights } from "@vercel/speed-insights";
import { supabase, hasSupabase } from "./supabase.js";

// Opt-out of analytics via ?notrack query param (persisted in localStorage)
if (new URLSearchParams(window.location.search).has("notrack")) {
  localStorage.setItem("brewist_notrack", "true");
}
if (new URLSearchParams(window.location.search).has("track")) {
  localStorage.removeItem("brewist_notrack");
}

const isOptedOut = localStorage.getItem("brewist_notrack") === "true";

inject({
  beforeSend: (event) => (isOptedOut ? null : event),
});

if (!isOptedOut) {
  injectSpeedInsights();
}

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
  
  // Lists - unordered (nested: 2+ spaces or tab indent)
  html = html.replace(/^ {2,}[\*\-\+] (.+)$/gim, '<li class="nested">$1</li>');
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

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function extractRecipeContent(markdown) {
  if (!markdown) return "";
  const lines = markdown.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith("## ")) {
      return lines.slice(i).join("\n").trim();
    }
  }
  return markdown;
}

async function main() {
  const pad2 = (n) => String(n).padStart(2, "0");
  const imgFor = (n) => `/bags/coffee-bag-${pad2(n)}.png`;

  // ── Multi-user state ──────────────────────────────────────────────────
  let authSession = null;
  let currentUserProfile = null;  // logged-in user's profile
  let viewingUserId = null;       // whose canvas we're viewing
  let viewingProfile = null;      // profile of canvas owner
  let isOwner = false;            // logged-in user owns this canvas
  let loadGeneration = 0;         // race condition guard for reloads

  async function getProfileByUsername(username) {
    if (!hasSupabase) return null;
    const { data } = await supabase
      .from("profiles").select("id, username, display_name")
      .eq("username", username).single();
    return data;
  }
  async function getProfileByUserId(userId) {
    if (!hasSupabase) return null;
    const { data } = await supabase
      .from("profiles").select("id, username, display_name")
      .eq("id", userId).single();
    return data;
  }

  // Get auth session early (before data fetch + routing)
  if (hasSupabase) {
    const { data: { session } } = await supabase.auth.getSession();
    authSession = session;
    if (authSession) {
      currentUserProfile = await getProfileByUserId(authSession.user.id);
    }
  }

  // ── Routing ────────────────────────────────────────────────────────
  function getRouteUsername() {
    const match = window.location.pathname.match(/^\/([a-z0-9][a-z0-9_-]{1,28}[a-z0-9])(?:\/(\d+))?$/);
    return match ? match[1] : null;
  }

  function getRouteCoffeeNumber() {
    const match = window.location.pathname.match(/^\/([a-z0-9][a-z0-9_-]{1,28}[a-z0-9])\/(\d+)$/);
    return match ? parseInt(match[2], 10) : null;
  }

  async function resolveRoute() {
    const routeUsername = getRouteUsername();
    if (routeUsername) {
      const profile = await getProfileByUsername(routeUsername);
      if (!profile) return { found: false, username: routeUsername };
      viewingProfile = profile;
      viewingUserId = profile.id;
    } else if (authSession && currentUserProfile) {
      viewingProfile = currentUserProfile;
      viewingUserId = currentUserProfile.id;
      history.pushState({}, '', `/${currentUserProfile.username}`);
    } else {
      return { found: false, landing: true };
    }
    isOwner = authSession?.user?.id === viewingUserId;
    return { found: true };
  }

  async function loadCoffeesForUser(userId) {
    let { data: rows, error } = await supabase
      .from("coffees").select("*")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("number");
    if (error) {
      ({ data: rows, error } = await supabase
        .from("coffees").select("*")
        .eq("user_id", userId)
        .order("number"));
    }
    if (!error && rows?.length) {
      return rows.map((r) => ({
        id: r.id, number: r.number, name: r.name, rating: r.rating,
        tags: r.tags || [], img: r.img_url || "",
        roaster: r.roaster || "", origin: r.origin || "",
        process: r.process || "", notes: r.notes || [],
        brew: r.brew || "", brewer: r.brewer || [],
        grinder: r.grinder || [], recipe_body: r.recipe_body || "",
      }));
    }
    return [];
  }

  const routeResult = await resolveRoute();

  // ── Fetch data: Supabase (scoped to user) or static fallback ────────
  let rawData = [];
  let fromSupabase = false;
  if (routeResult.found && hasSupabase) {
    rawData = await loadCoffeesForUser(viewingUserId);
    fromSupabase = true;
  } else if (routeResult.landing && hasSupabase) {
    // Landing background: load featured user's coffees
    const featured = await getProfileByUsername("toppbrocales");
    if (featured) {
      viewingProfile = featured;
      viewingUserId = featured.id;
      rawData = await loadCoffeesForUser(featured.id);
      fromSupabase = true;
    }
  } else if (!hasSupabase) {
    // Static demo data for dev mode
    const res = await fetch("/data/coffee.json", { cache: "default" });
    rawData = await res.json();
  }

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

  // ── Landing page (shown when not logged in and no username in URL) ──
  const landingPage = document.createElement("div");
  landingPage.className = "landing-page";
  landingPage.innerHTML = `
    <div class="landing-content">
      <h1 class="landing-title">Brewist</h1>
      <p class="landing-subtitle">Your personal canvas of coffee recipes</p>
      <div class="landing-card">
        <h2 class="landing-card-title" id="landingAuthTitle">Sign up</h2>
        <div class="auth-oauth-buttons">
          <button type="button" class="auth-oauth-btn landing-oauth-btn" data-provider="google">
            <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 010-9.18l-7.98-6.19a24.08 24.08 0 000 21.56l7.98-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
            Continue with Google
          </button>
        </div>
        <div class="auth-divider"><span>or</span></div>
        <form class="auth-form" id="landingAuthForm" novalidate>
          <input type="text" name="username" placeholder="Username" class="auth-input auth-username-input"
                 pattern="[a-z0-9][a-z0-9_\\-]{1,28}[a-z0-9]" autocomplete="username"
                 autocapitalize="none" autocorrect="off" spellcheck="false" />
          <input type="email" name="email" placeholder="Email" class="auth-input" autocomplete="username" />
          <input type="password" name="password" placeholder="Password" class="auth-input" autocomplete="new-password" />
          <button type="submit" class="auth-submit" id="landingAuthSubmitBtn">Sign up</button>
        </form>
        <p class="auth-toggle">
          <span id="landingToggleText">Already have an account?</span>
          <a href="#" id="landingToggleLink">Sign in</a>
        </p>
        <p class="auth-error" id="landingAuthError"></p>
      </div>
    </div>
  `;
  document.body.appendChild(landingPage);

  const isLanding = routeResult.landing === true;
  const isNotFound = !routeResult.found && !routeResult.landing;
  if (isLanding) {
    // Show grid behind landing overlay (canvas stays visible)
    landingPage.style.display = "flex";
  } else if (isNotFound) {
    canvas.style.display = "none";
    landingPage.style.display = "flex";
    landingPage.querySelector(".landing-subtitle").textContent =
      `No canvas found for @${routeResult.username}`;
    landingPage.querySelector(".landing-card").style.display = "none";
  } else {
    landingPage.style.display = "none";
  }

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

  // Hover state for zoom effect
  let hoveredItem = null;
  let lastHoveredItem = null; // Keep track for smooth zoom out
  let hoverScale = 1;
  const HOVER_SCALE_TARGET = 1.04;
  const HOVER_SCALE_SPEED = 0.12;

  // Search state
  let searchQuery = "";
  let isSearching = false;
  let searchTransitionAlpha = 1; // For fade transition
  let filteredBaseItems = []; // Will be set to baseItems after initialization

  // Filter state: { type: [], brewer: [], grinder: [], rating: [], tastingNotes: [] }
  let activeFilters = { type: [], brewer: [], grinder: [], rating: [], tastingNotes: [] };
  let noMatchFound = false;

  // Items setup - use actual image dimensions (no resizing)
  let baseItems = rawData.map((d) => {
    const number = Number(d.number);
    return {
      ...d,
      number,
      img: d.img || imgFor(number),
    };
  });

  // Fetch recipe metadata (only when using static files)
  if (!fromSupabase) {
    const recipeMetadata = new Map();
    const recipeFetchPromises = baseItems.map(async (item) => {
      try {
        const res = await fetch(`/recipes/coffee-${pad2(item.number)}.md`, { cache: "default" });
        const md = await res.text();
        const meta = { brewer: [], grinder: [], notes: [] };
        const lines = md.split("\n");
        let inTastingNotes = false;
        for (const line of lines) {
          const lower = line.toLowerCase();
          if (lower.startsWith("brewer: ")) {
            meta.brewer = line.substring(line.indexOf(":") + 1).split(",").map((s) => s.trim()).filter(Boolean);
          } else if (lower.startsWith("grinder: ")) {
            meta.grinder = line.substring(line.indexOf(":") + 1).split(",").map((s) => s.trim()).filter(Boolean);
          } else if (line.trim().toLowerCase() === "### tasting notes") {
            inTastingNotes = true;
          } else if (inTastingNotes && /^[-*]\s+/.test(line)) {
            meta.notes.push(line.replace(/^[-*]\s+/, "").trim());
          } else if (inTastingNotes && line.startsWith("#")) {
            inTastingNotes = false;
          }
        }
        recipeMetadata.set(item.number, meta);
      } catch (_) {}
    });
    await Promise.all(recipeFetchPromises);
    baseItems.forEach((item) => {
      const meta = recipeMetadata.get(item.number);
      if (meta) {
        item.brewer = meta.brewer;
        item.grinder = meta.grinder;
        item.notes = item.notes?.length ? item.notes : meta.notes;
      }
    });
  }

  // Initialize filteredBaseItems with all items
  filteredBaseItems = baseItems;

  // Create duplicated items for tile (mutable for search)
  let duplicatedItems = [];
  const duplicateCount = 3;
  
  function createDuplicatedItems(items) {
    const result = [];
    // Adjust duplicate count based on result size for better coverage
    const count = items.length <= 2 ? 10 : items.length <= 5 ? 6 : duplicateCount;
    for (let i = 0; i < count; i++) {
      items.forEach((item) => {
        result.push({
          ...item,
          _duplicateId: i,
        });
      });
    }
    // Shuffle
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
  
  duplicatedItems = createDuplicatedItems(baseItems);

  // Preload images and get their dimensions
  const imageCache = new Map();
  const imageDimensions = new Map();
  
  // Fixed size for items without an image (portrait ratio matching most coffee bags)
  const PLACEHOLDER_W = 200;
  const PLACEHOLDER_H = 300;

  // Colour palette cycled across placeholder bags — body, seal, text, crimp-line colour
  const BAG_PALETTE = [
    { body: "#C5A87A", seal: "#A8895A", text: "rgba(70,45,15,0.6)",      crimp: "rgba(0,0,0,0.22)"    }, // kraft
    { body: "#E2D49A", seal: "#C8BA72", text: "rgba(60,45,10,0.6)",      crimp: "rgba(0,0,0,0.18)"    }, // manila
    { body: "#EDEAE3", seal: "#D0CBC0", text: "rgba(50,45,38,0.55)",     crimp: "rgba(0,0,0,0.15)"    }, // off-white
    { body: "#3E3C39", seal: "#2C2A27", text: "rgba(240,235,225,0.65)",  crimp: "rgba(255,255,255,0.2)" }, // dark grey
  ];

  // ─── Canvas bag-shape drawing helpers ────────────────────────────────────

  function _bagGradient(ctx, bx, by, bw, bh) {
    const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    g.addColorStop(0,   "rgba(0,0,0,0.13)");
    g.addColorStop(0.1, "rgba(0,0,0,0.03)");
    g.addColorStop(0.5, "rgba(255,255,255,0.03)");
    g.addColorStop(0.9, "rgba(0,0,0,0.03)");
    g.addColorStop(1,   "rgba(0,0,0,0.13)");
    ctx.fillStyle = g;
    ctx.fillRect(bx, by, bw, bh);
  }

  function _bagCrimp(ctx, x1, y, x2, sealH, count, col) {
    ctx.strokeStyle = col.crimp;
    ctx.lineWidth = 0.5;
    for (let i = 1; i <= count; i++) {
      const ly = y + (sealH * i) / (count + 1);
      ctx.beginPath(); ctx.moveTo(x1, ly); ctx.lineTo(x2, ly); ctx.stroke();
    }
  }

  function _bagName(ctx, bx, bw, textBodyY, textBodyH, name, col) {
    if (!name) return;
    const pad = bw * 0.12;
    const maxLineW = bw - pad * 2;
    const fontSize = Math.max(11, Math.round(bw * 0.075));
    ctx.font = `500 ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.fillStyle = col.text;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const words = name.split(" ");
    const lines = [];
    let line = "";
    for (const word of words) {
      const test = line ? line + " " + word : word;
      if (ctx.measureText(test).width > maxLineW && line) { lines.push(line); line = word; }
      else { line = test; }
    }
    if (line) lines.push(line);
    const lineH = fontSize * 1.4;
    const totalH = lines.length * lineH;
    const startY = textBodyY + textBodyH / 2 - totalH / 2 + lineH / 2;
    lines.forEach((l, i) => ctx.fillText(l, bx + bw / 2, startY + i * lineH));
    ctx.textAlign = "start";
  }

  // Shape 0 — Four-seal bag: plain rectangle, prominent top seal
  function drawFourSealBag(ctx, bx, by, bw, bh, col, name) {
    const sealH = Math.round(bh * 0.09);
    const cr = Math.min(Math.round(bw * 0.025), 4);
    const path = () => { ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, cr); };
    ctx.save(); path(); ctx.clip();
    ctx.fillStyle = col.body; ctx.fillRect(bx, by, bw, bh);
    _bagGradient(ctx, bx, by, bw, bh);
    ctx.fillStyle = col.seal; ctx.fillRect(bx, by, bw, sealH);
    _bagCrimp(ctx, bx + 2, by, bx + bw - 2, sealH, 3, col);
    ctx.restore();
    ctx.strokeStyle = "rgba(0,0,0,0.1)"; ctx.lineWidth = 1; path(); ctx.stroke();
    _bagName(ctx, bx, bw, by + sealH, bh - sealH, name, col);
  }

  // Shape 1 — Stand-up pouch: wide top, tapers toward bottom
  function drawStandUpPouch(ctx, bx, by, bw, bh, col, name) {
    const ti = bw * 0.05, sealH = Math.round(bh * 0.065);
    const cr = Math.min(Math.round(bw * 0.03), 5);
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(bx, by); ctx.lineTo(bx + bw, by);
      ctx.lineTo(bx + bw - ti, by + bh - cr);
      ctx.quadraticCurveTo(bx + bw - ti, by + bh, bx + bw - ti - cr, by + bh);
      ctx.lineTo(bx + ti + cr, by + bh);
      ctx.quadraticCurveTo(bx + ti, by + bh, bx + ti, by + bh - cr);
      ctx.closePath();
    };
    ctx.save(); path(); ctx.clip();
    ctx.fillStyle = col.body; ctx.fillRect(bx, by, bw, bh);
    _bagGradient(ctx, bx, by, bw, bh);
    ctx.fillStyle = col.seal; ctx.fillRect(bx, by, bw, sealH);
    _bagCrimp(ctx, bx + 2, by, bx + bw - 2, sealH, 4, col);
    ctx.restore();
    ctx.strokeStyle = "rgba(0,0,0,0.1)"; ctx.lineWidth = 1; path(); ctx.stroke();
    _bagName(ctx, bx, bw, by + sealH, bh - sealH, name, col);
  }

  // Shape 2 — Flat-bottom pouch: simple rounded rectangle with full-width seal
  function drawFlatBottomPouch(ctx, bx, by, bw, bh, col, name) {
    const cr = Math.min(Math.round(bw * 0.025), 5);
    const sealH = Math.round(bh * 0.09);
    const path = () => { ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, cr); };
    ctx.save(); path(); ctx.clip();
    ctx.fillStyle = col.body; ctx.fillRect(bx, by, bw, bh);
    _bagGradient(ctx, bx, by, bw, bh);
    ctx.fillStyle = col.seal; ctx.fillRect(bx, by, bw, sealH);
    _bagCrimp(ctx, bx + 2, by, bx + bw - 2, sealH, 3, col);
    ctx.restore();
    ctx.strokeStyle = "rgba(0,0,0,0.1)"; ctx.lineWidth = 1; path(); ctx.stroke();
    _bagName(ctx, bx, bw, by + sealH, bh - sealH, name, col);
  }

  // Shape 3 — Side-fold bag: narrow top, widens toward the bottom (inverse of stand-up pouch)
  function drawSideFoldBag(ctx, bx, by, bw, bh, col, name) {
    const ti = Math.round(bw * 0.05);
    const cr = Math.min(Math.round(bw * 0.03), 5);
    const sealH = Math.round(bh * 0.065);
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(bx + ti, by);
      ctx.lineTo(bx + bw - ti, by);
      ctx.lineTo(bx + bw, by + bh - cr);
      ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - cr, by + bh);
      ctx.lineTo(bx + cr, by + bh);
      ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - cr);
      ctx.closePath();
    };
    ctx.save(); path(); ctx.clip();
    ctx.fillStyle = col.body; ctx.fillRect(bx, by, bw, bh);
    _bagGradient(ctx, bx, by, bw, bh);
    ctx.fillStyle = col.seal; ctx.fillRect(bx, by, bw, sealH);
    _bagCrimp(ctx, bx + ti + 2, by, bx + bw - ti - 2, sealH, 3, col);
    ctx.restore();
    ctx.strokeStyle = "rgba(0,0,0,0.1)"; ctx.lineWidth = 1; path(); ctx.stroke();
    _bagName(ctx, bx, bw, by + sealH, bh - sealH, name, col);
  }

  const BAG_DRAW_FNS = [drawFourSealBag, drawStandUpPouch, drawFlatBottomPouch, drawSideFoldBag];

  // ─────────────────────────────────────────────────────────────────────────

  async function loadImageToCache(itemNumber, src) {
    if (!src) {
      // No image — give it placeholder dimensions so it appears in the layout
      imageDimensions.set(itemNumber, {
        width: PLACEHOLDER_W,
        height: PLACEHOLDER_H,
        aspectRatio: PLACEHOLDER_H / PLACEHOLDER_W,
      });
      return;
    }
    try {
      const resp = await fetch(src);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const bitmap = await createImageBitmap(blob);
      imageCache.set(itemNumber, bitmap);
      imageDimensions.set(itemNumber, {
        width: bitmap.width,
        height: bitmap.height,
        aspectRatio: bitmap.height / bitmap.width,
      });
    } catch {
      // Fallback to Image element if fetch/createImageBitmap fails (e.g. CORS)
      await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          imageCache.set(itemNumber, img);
          imageDimensions.set(itemNumber, {
            width: img.naturalWidth,
            height: img.naturalHeight,
            aspectRatio: img.naturalHeight / img.naturalWidth,
          });
          resolve();
        };
        img.onerror = () => {
          // Image failed to load — use placeholder dimensions so it still appears
          imageDimensions.set(itemNumber, {
            width: PLACEHOLDER_W,
            height: PLACEHOLDER_H,
            aspectRatio: PLACEHOLDER_H / PLACEHOLDER_W,
          });
          resolve();
        };
        img.src = src;
      });
    }
  }

  const imageLoadPromises = baseItems.map((item) => loadImageToCache(item.number, item.img));

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
    // Track last bag number in each column to prevent consecutive duplicates
    const lastBagInCol = Array(COLS).fill(-1);
    // Track items placed for horizontal adjacency checking
    const placedItems = [];

    const tileItems = [];

    duplicatedItems.forEach((item) => {
      // Get dimensions first to know item height
      const dims = imageDimensions.get(item.number);
      if (!dims) return;
      
      const scale = colWidth / dims.width;
      const w = colWidth;
      const h = dims.height * scale;
      
      // Find best column: shortest that doesn't have same bag as last item
      // and doesn't have same bag at similar Y in adjacent columns
      let bestCol = -1;
      let bestHeight = Infinity;
      
      for (let c = 0; c < COLS; c++) {
        // Skip if same bag was just placed in this column
        if (lastBagInCol[c] === item.number) continue;
        
        // Check adjacent columns for same bag at similar Y position
        const y = colHeights[c];
        let hasAdjacentDupe = false;
        
        // Check left neighbor
        if (c > 0) {
          const leftItems = placedItems.filter(p => p.col === c - 1);
          for (const p of leftItems) {
            // Check if Y positions overlap
            if (p.number === item.number && 
                Math.abs(p.y - y) < Math.max(p.height, h) * 1.5) {
              hasAdjacentDupe = true;
              break;
            }
          }
        }
        
        // Check right neighbor
        if (!hasAdjacentDupe && c < COLS - 1) {
          const rightItems = placedItems.filter(p => p.col === c + 1);
          for (const p of rightItems) {
            if (p.number === item.number && 
                Math.abs(p.y - y) < Math.max(p.height, h) * 1.5) {
              hasAdjacentDupe = true;
              break;
            }
          }
        }
        
        if (hasAdjacentDupe) continue;
        
        // This column is valid, check if it's the shortest
        if (colHeights[c] < bestHeight) {
          bestHeight = colHeights[c];
          bestCol = c;
        }
      }
      
      // Fallback: if no valid column found, use shortest column anyway
      if (bestCol === -1) {
        bestCol = 0;
        for (let c = 1; c < COLS; c++) {
          if (colHeights[c] < colHeights[bestCol]) {
            bestCol = c;
          }
        }
      }
      
      const x = sidePadding + bestCol * (colWidth + GUTTER);
      const y = colHeights[bestCol];

      const placedItem = {
        ...item,
        x,
        y,
        width: w,
        height: h,
        col: bestCol,
      };
      
      tileItems.push(placedItem);
      placedItems.push(placedItem);
      lastBagInCol[bestCol] = item.number;
      colHeights[bestCol] += h + GUTTER;
    });

    // Store where each column ends
    columnEndHeights = [...colHeights];
    const maxHeight = Math.max(...colHeights);
    
    // For seamless tiling: each column starts offset by (maxHeight - its end height)
    // This is the "start offset" for items in subsequent tiles
    TILE_HEIGHT = maxHeight;

    return tileItems;
  }

  let tileItems = createTileLayout();

  // Center camera on a featured bag (first bag in middle column)
  function centerOnFirstBag() {
    const middleCol = Math.floor(COLS / 2);
    const centerBag = tileItems.find(item => item.col === middleCol) || tileItems[0];
    if (centerBag) {
      camX = centerBag.x + centerBag.width / 2 - canvasWidth / 2;
      camY = centerBag.y + centerBag.height / 2 - canvasHeight / 2;
      targetCamX = camX;
      targetCamY = camY;
    }
  }
  centerOnFirstBag();

  // Rebuild layout for search and filter results
  function rebuildLayoutForSearch(query) {
    // Start transition
    searchTransitionAlpha = 0;

    // First apply filters to get filter-matched set
    let items = baseItems;
    const hasFilters = Object.values(activeFilters).some((arr) => arr.length > 0);
    if (hasFilters) {
      items = baseItems.filter((item) => {
        if (activeFilters.type.length && !activeFilters.type.some((t) => (item.tags || []).includes(t))) return false;
        if (activeFilters.rating.length && !activeFilters.rating.includes(String(item.rating))) return false;
        if (activeFilters.brewer.length && !activeFilters.brewer.some((b) => (item.brewer || []).includes(b))) return false;
        if (activeFilters.grinder.length && !activeFilters.grinder.some((g) => (item.grinder || []).includes(g))) return false;
        if (activeFilters.tastingNotes.length && !activeFilters.tastingNotes.some((n) => (item.notes || []).includes(n))) return false;
        return true;
      });
    }

    // Then apply search within filter results
    if (query.trim() !== "") {
      const lowerQuery = query.toLowerCase();
      items = items.filter((item) => {
        const name = (item.name || "").toLowerCase();
        const tagsMatch = Array.isArray(item.tags) ? item.tags.some((tag) => tag.toLowerCase().includes(lowerQuery)) : false;
        const numberMatch = String(item.number).includes(lowerQuery);
        const notesMatch = Array.isArray(item.notes) ? item.notes.some((n) => n.toLowerCase().includes(lowerQuery)) : false;
        return name.includes(lowerQuery) || tagsMatch || numberMatch || notesMatch;
      });
    }

    filteredBaseItems = items;
    noMatchFound = items.length === 0 && (query.trim() !== "" || hasFilters);

    const noMatchEl = document.querySelector(".no-match-overlay");
    if (noMatchEl) noMatchEl.style.display = noMatchFound ? "flex" : "none";

    duplicatedItems = createDuplicatedItems(filteredBaseItems);
    tileItems = createTileLayout();
    centerOnFirstBag();
    hoveredItem = null;
    lastHoveredItem = null;
  }

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
            
            // Apply transition alpha for search results fade-in
            const shouldShowPlaceholder = searchTransitionAlpha < 0.3;
            
            if (shouldShowPlaceholder) {
              // Draw placeholder rectangle during transition
              ctx.globalAlpha = 1 - searchTransitionAlpha;
              ctx.fillStyle = "#E8E0D4";
              ctx.beginPath();
              ctx.roundRect(screenX, screenY, item.width, item.height, 12);
              ctx.fill();
              ctx.globalAlpha = 1;
            }
            
            if (img) {
              // Check if this is the hovered or last-hovered item (for smooth zoom out)
              const activeHover = hoveredItem || lastHoveredItem;
              const isHovered = activeHover && 
                activeHover.number === item.number && 
                Math.abs(screenX - (activeHover.screenX || 0)) < 5 &&
                Math.abs(screenY - (activeHover.screenY || 0)) < 5;
              
              // Apply search transition fade
              ctx.globalAlpha = searchTransitionAlpha;
              
              if (isHovered && hoverScale > 1.001) {
                // Draw with scale effect
                const scale = hoverScale;
                const scaledW = item.width * scale;
                const scaledH = item.height * scale;
                const offsetX = (scaledW - item.width) / 2;
                const offsetY = (scaledH - item.height) / 2;
                ctx.drawImage(img, screenX - offsetX, screenY - offsetY, scaledW, scaledH);
              } else {
                ctx.drawImage(img, screenX, screenY, item.width, item.height);
              }
              
              ctx.globalAlpha = 1;
            } else {
              // Draw placeholder coffee bag — shape and colour vary by item number
              const col = BAG_PALETTE[(item.number + 2) % BAG_PALETTE.length];
              BAG_DRAW_FNS[item.number % BAG_DRAW_FNS.length](
                ctx, screenX, screenY, item.width, item.height, col, item.name
              );
            }
          }
        });
      }
    }
    
    // Animate hover scale
    if (hoveredItem) {
      lastHoveredItem = hoveredItem;
      hoverScale += (HOVER_SCALE_TARGET - hoverScale) * HOVER_SCALE_SPEED;
    } else {
      hoverScale += (1 - hoverScale) * HOVER_SCALE_SPEED;
      // Clear lastHoveredItem once scale is back to normal
      if (hoverScale < 1.001) {
        lastHoveredItem = null;
      }
    }
    
    // Animate search transition fade-in
    if (searchTransitionAlpha < 1) {
      searchTransitionAlpha += 0.08;
      if (searchTransitionAlpha > 1) searchTransitionAlpha = 1;
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
    // Update cursor and hover state
    if (!dragging) {
      const item = hitTest(e.clientX, e.clientY);
      canvas.style.cursor = item ? "pointer" : "grab";
      
      // Track hovered item for zoom effect
      if (item) {
        // Calculate screen position of hovered item
        const colHeight = columnEndHeights[item.col];
        const tileY = Math.floor((e.clientY + camY) / colHeight);
        const tileX = Math.floor((e.clientX + camX) / TILE_WIDTH);
        hoveredItem = {
          ...item,
          screenX: item.x + tileX * TILE_WIDTH - camX,
          screenY: item.y + tileY * colHeight - camY
        };
      } else {
        hoveredItem = null;
      }
      return;
    }
    
    // Clear hover when dragging
    hoveredItem = null;

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
    hoveredItem = null;
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

  // Search bar + filter button (same combined width as before)
  const searchBar = document.createElement("div");
  searchBar.className = "search-bar";
  searchBar.innerHTML = `
    <div class="search-row">
      <div class="search-container">
        <svg class="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"></circle>
          <path d="M21 21l-4.35-4.35"></path>
        </svg>
        <input type="text" class="search-input" placeholder="Search recipes..." />
        <button class="search-clear" style="display: none;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"></path>
          </svg>
        </button>
      </div>
      <button class="filter-btn" type="button" aria-label="Filter recipes">
        <span class="filter-dot"></span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="4" y1="21" x2="4" y2="14"></line>
          <line x1="4" y1="10" x2="4" y2="3"></line>
          <line x1="12" y1="21" x2="12" y2="12"></line>
          <line x1="12" y1="8" x2="12" y2="3"></line>
          <line x1="20" y1="21" x2="20" y2="16"></line>
          <line x1="20" y1="12" x2="20" y2="3"></line>
          <line x1="1" y1="14" x2="7" y2="14"></line>
          <line x1="9" y1="8" x2="15" y2="8"></line>
          <line x1="17" y1="16" x2="23" y2="16"></line>
        </svg>
      </button>
    </div>
  `;
  document.body.appendChild(searchBar);
  if (isLanding || isNotFound) searchBar.style.display = "none";

  // No match overlay with Show all button
  const noMatchOverlay = document.createElement("div");
  noMatchOverlay.className = "no-match-overlay";
  noMatchOverlay.style.display = "none";
  noMatchOverlay.innerHTML = `
    <div class="no-match-content">
      <p class="no-match-text">No match found</p>
      <button class="no-match-show-all-btn" type="button">Show all</button>
    </div>
  `;
  document.body.appendChild(noMatchOverlay);

  // Empty canvas overlay — shown when the owner has no coffees yet
  const emptyCanvasOverlay = document.createElement("div");
  emptyCanvasOverlay.className = "no-match-overlay";
  emptyCanvasOverlay.style.display = "none";
  emptyCanvasOverlay.innerHTML = `
    <div class="no-match-content">
      <p class="no-match-text">Add your first recipe</p>
      <button class="no-match-show-all-btn" type="button">Add coffee</button>
    </div>
  `;
  document.body.appendChild(emptyCanvasOverlay);
  emptyCanvasOverlay.querySelector("button").addEventListener("click", () => openEditor(null));

  // Empty canvas overlay for visitors — shown when viewing someone else's empty grid
  const emptyVisitorOverlay = document.createElement("div");
  emptyVisitorOverlay.className = "no-match-overlay";
  emptyVisitorOverlay.style.display = "none";
  const visitorName = viewingProfile?.display_name || viewingProfile?.username || "This person";
  emptyVisitorOverlay.innerHTML = `
    <div class="no-match-content">
      <p class="no-match-emoji">☕️</p>
      <p class="no-match-text">Good things are brewing</p>
      <p class="no-match-subtext">${visitorName} hasn't added any recipes yet</p>
    </div>
  `;
  document.body.appendChild(emptyVisitorOverlay);

  // Show on initial load if canvas is empty
  if (baseItems.length === 0 && !isLanding && !isNotFound) {
    if (isOwner) {
      emptyCanvasOverlay.style.display = "flex";
    } else {
      emptyVisitorOverlay.style.display = "flex";
    }
  }

  noMatchOverlay.querySelector(".no-match-show-all-btn").addEventListener("click", () => {
    searchQuery = "";
    searchInput.value = "";
    searchClear.style.display = "none";
    Object.keys(activeFilters).forEach((k) => (activeFilters[k] = []));
    document.querySelectorAll(".filter-pill").forEach((p) => p.classList.remove("selected"));
    noMatchOverlay.style.display = "none";
    updateFilterDot();
    if (typeof updateFilterClearButton === "function") updateFilterClearButton();
    rebuildLayoutForSearch("");
  });
  
  const searchInput = searchBar.querySelector(".search-input");
  const searchClear = searchBar.querySelector(".search-clear");
  const filterBtn = searchBar.querySelector(".filter-btn");
  const filterDot = searchBar.querySelector(".filter-dot");

  function hasActiveFilters() {
    return Object.values(activeFilters).some((arr) => arr.length > 0);
  }

  function updateFilterDot() {
    filterDot.style.display = hasActiveFilters() ? "block" : "none";
  }

  function updateFilterClearButton() {
    const clearBtn = filterOverlay.querySelector(".filter-clear-btn");
    if (clearBtn) clearBtn.style.display = hasActiveFilters() ? "block" : "none";
  }
  
  let searchTimeout = null;
  
  searchInput.addEventListener("input", (e) => {
    const query = e.target.value;
    searchClear.style.display = query.length > 0 ? "flex" : "none";
    
    // Debounce search
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      searchQuery = query;
      rebuildLayoutForSearch(query);
    }, 200);
  });
  
  searchClear.addEventListener("click", () => {
    searchInput.value = "";
    searchClear.style.display = "none";
    searchQuery = "";
    rebuildLayoutForSearch("");
    searchInput.focus();
  });
  
  // Prevent drag events from interfering with search and filter
  searchBar.addEventListener("mousedown", (e) => e.stopPropagation());
  searchBar.addEventListener("touchstart", (e) => e.stopPropagation());

  // ── Reload canvas for a different user ────────────────────────────────
  async function reloadCanvasData() {
    const gen = ++loadGeneration;
    const newData = hasSupabase && viewingUserId
      ? await loadCoffeesForUser(viewingUserId)
      : [];
    if (gen !== loadGeneration) return; // stale load, discard

    baseItems = newData.map((d) => {
      const number = Number(d.number);
      return { ...d, number, img: d.img || imgFor(number) };
    });

    imageCache.clear();
    imageDimensions.clear();
    await Promise.all(baseItems.map((item) => loadImageToCache(item.number, item.img)));

    searchQuery = "";
    searchInput.value = "";
    activeFilters = { type: [], brewer: [], grinder: [], rating: [], tastingNotes: [] };
    populateFilterPills();
    filteredBaseItems = baseItems;
    duplicatedItems = createDuplicatedItems(filteredBaseItems);
    tileItems = createTileLayout();

    // Reset camera
    camX = 0; camY = 0; targetCamX = 0; targetCamY = 0;
    velocityX = 0; velocityY = 0;
    hoveredItem = null; lastHoveredItem = null;

    // Show/hide canvas vs landing
    canvas.style.display = "block";
    landingPage.style.display = "none";
    searchBar.style.display = "";
    noMatchOverlay.style.display = "none";
    emptyCanvasOverlay.style.display = baseItems.length === 0 && isOwner ? "flex" : "none";
    emptyVisitorOverlay.style.display = baseItems.length === 0 && !isOwner ? "flex" : "none";
  }

  // ── Auth UI (signup + signin) ─────────────────────────────────────────
  let authIsSignUp = false;

  const authOverlay = document.createElement("div");
  authOverlay.className = "overlay auth-overlay";
  authOverlay.style.display = "none";
  authOverlay.innerHTML = `
    <div class="modal auth-modal">
      <h2 class="auth-title" id="authTitle">Sign in</h2>
      <div class="auth-oauth-buttons">
        <button type="button" class="auth-oauth-btn" data-provider="google">
          <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 010-9.18l-7.98-6.19a24.08 24.08 0 000 21.56l7.98-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
          Continue with Google
        </button>
      </div>
      <div class="auth-divider"><span>or</span></div>
      <form class="auth-form" id="authForm" novalidate>
        <input type="text" name="username" placeholder="Username" class="auth-input auth-username-input"
               pattern="[a-z0-9][a-z0-9_\\-]{1,28}[a-z0-9]" autocomplete="username"
               autocapitalize="none" autocorrect="off" spellcheck="false"
               style="display:none" />
        <input type="email" name="email" placeholder="Email" class="auth-input" autocomplete="username" />
        <input type="password" name="password" placeholder="Password" class="auth-input" autocomplete="current-password" />
        <button type="submit" class="auth-submit" id="authSubmitBtn">Sign in</button>
      </form>
      <p class="auth-toggle">
        <span id="authToggleText">Don&rsquo;t have an account?</span>
        <a href="#" id="authToggleLink">Sign up</a>
      </p>
      <p class="auth-error" id="authError"></p>
    </div>
  `;
  document.body.appendChild(authOverlay);

  // ── Username picker overlay (for first-time OAuth users) ──
  const usernamePickerOverlay = document.createElement("div");
  usernamePickerOverlay.className = "overlay auth-overlay";
  usernamePickerOverlay.style.display = "none";
  usernamePickerOverlay.innerHTML = `
    <div class="modal auth-modal">
      <h2 class="auth-title">Choose a username</h2>
      <p class="username-picker-subtitle">Pick a username for your canvas URL</p>
      <form class="auth-form" id="usernamePickerForm" novalidate>
        <input type="text" name="pickerUsername" placeholder="Username" class="auth-input"
               autocapitalize="none" autocorrect="off" spellcheck="false" />
        <button type="submit" class="auth-submit">Let's go</button>
      </form>
      <p class="auth-error" id="usernamePickerError"></p>
    </div>
  `;
  document.body.appendChild(usernamePickerOverlay);

  // Auto-lowercase username picker input
  usernamePickerOverlay.querySelector('[name="pickerUsername"]').addEventListener("input", (e) => {
    const pos = e.target.selectionStart;
    e.target.value = e.target.value.toLowerCase();
    e.target.setSelectionRange(pos, pos);
  });

  let pendingOAuthUserId = null;

  function openUsernamePicker(userId) {
    pendingOAuthUserId = userId;
    closeAuthModal();
    usernamePickerOverlay.style.display = "flex";
    usernamePickerOverlay.style.visibility = "visible";
    usernamePickerOverlay.style.opacity = "1";
    usernamePickerOverlay.style.zIndex = "2000";
  }

  function closeUsernamePicker() {
    usernamePickerOverlay.style.display = "none";
    usernamePickerOverlay.querySelector("#usernamePickerForm").reset();
    usernamePickerOverlay.querySelector("#usernamePickerError").textContent = "";
    pendingOAuthUserId = null;
  }

  // Username picker form submit
  usernamePickerOverlay.querySelector("#usernamePickerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = usernamePickerOverlay.querySelector("#usernamePickerError");
    errEl.textContent = "";
    const username = e.target.querySelector('[name="pickerUsername"]').value?.toLowerCase().trim();
    if (!username || !/^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/.test(username)) {
      errEl.textContent = "Username must be 3\u201330 characters: lowercase letters, numbers, hyphens, underscores.";
      return;
    }
    // Check availability
    const { data: existing } = await supabase
      .from("profiles").select("id").eq("username", username).single();
    if (existing) { errEl.textContent = "Username already taken."; return; }

    // Create profile
    const { error: profileErr } = await supabase
      .from("profiles")
      .insert({ id: pendingOAuthUserId, username, display_name: username });
    if (profileErr) { errEl.textContent = profileErr.message; return; }

    currentUserProfile = { id: pendingOAuthUserId, username, display_name: username };
    viewingProfile = currentUserProfile;
    viewingUserId = currentUserProfile.id;
    isOwner = true;
    closeUsernamePicker();
    history.pushState({}, '', `/${username}`);
    await reloadCanvasData();
    updateAuthUI();
    if (typeof updateAddBtnVisibility === "function") updateAddBtnVisibility();
  });

  // Close username picker on backdrop click
  usernamePickerOverlay.addEventListener("click", (e) => {
    if (e.target === usernamePickerOverlay) closeUsernamePicker();
  });

  const authBtn = document.createElement("button");
  authBtn.className = "auth-btn";
  authBtn.type = "button";
  authBtn.textContent = authSession ? "Log out" : "Sign in";
  authBtn.style.display = hasSupabase && !isLanding && !isNotFound ? "block" : "none";
  document.body.appendChild(authBtn);

  function setAuthMode(signUp) {
    authIsSignUp = signUp;
    const title = authOverlay.querySelector("#authTitle");
    const submit = authOverlay.querySelector("#authSubmitBtn");
    const toggle = authOverlay.querySelector("#authToggleText");
    const link = authOverlay.querySelector("#authToggleLink");
    const usernameInput = authOverlay.querySelector('[name="username"]');
    title.textContent = signUp ? "Sign up" : "Sign in";
    submit.textContent = signUp ? "Sign up" : "Sign in";
    toggle.textContent = signUp ? "Already have an account?" : "Don\u2019t have an account?";
    link.textContent = signUp ? "Sign in" : "Sign up";
    usernameInput.style.display = signUp ? "" : "none";
    usernameInput.required = signUp;
    authOverlay.querySelector('[name="password"]').autocomplete = signUp ? "new-password" : "current-password";
    authOverlay.querySelector("#authError").textContent = "";
  }

  // Auto-lowercase username as user types (iOS capitalises first letter)
  authOverlay.querySelector('[name="username"]').addEventListener("input", (e) => {
    const pos = e.target.selectionStart;
    e.target.value = e.target.value.toLowerCase();
    e.target.setSelectionRange(pos, pos);
  });

  function openAuthModal(signUp = false) {
    setAuthMode(signUp);
    authOverlay.classList.add("open");
    authOverlay.style.display = "flex";
    authOverlay.style.visibility = "visible";
    authOverlay.style.opacity = "1";
    authOverlay.style.zIndex = "2000";
  }

  function closeAuthModal() {
    authOverlay.classList.remove("open");
    authOverlay.style.display = "none";
    authOverlay.querySelector("#authForm").reset();
    authOverlay.querySelector("#authError").textContent = "";
  }

  function updateAuthUI() {
    if (!hasSupabase) return;
    authBtn.textContent = authSession ? "Log out" : "Sign in";
    // Hide on landing page — it has its own sign-in/sign-up buttons
    authBtn.style.display = landingPage.style.display === "flex" ? "none" : "block";
  }

  if (hasSupabase) {
    // Auth state listener
    supabase.auth.onAuthStateChange(async (_event, session) => {
      authSession = session;
      if (session) {
        // Skip if signup handler already set the profile
        if (!currentUserProfile || currentUserProfile.id !== session.user.id) {
          currentUserProfile = await getProfileByUserId(session.user.id);
        }
        closeAuthModal();
        landingPage.style.display = "none";
        // OAuth user with no profile yet — show username picker
        if (!currentUserProfile) {
          openUsernamePicker(session.user.id);
          return;
        }
        if (currentUserProfile && viewingUserId !== currentUserProfile.id) {
          const routeUsername = getRouteUsername();
          if (routeUsername && routeUsername !== currentUserProfile.username) {
            // Viewing another user's canvas — keep it, just update auth state
            isOwner = false;
          } else {
            // On landing page or no route — redirect to own canvas
            viewingProfile = currentUserProfile;
            viewingUserId = currentUserProfile.id;
            isOwner = true;
            history.pushState({}, '', `/${currentUserProfile.username}`);
            await reloadCanvasData();
          }
        }
      } else {
        currentUserProfile = null;
        // Keep viewingProfile/viewingUserId if browsing someone's canvas while logged out
        const routeUser = getRouteUsername();
        if (!routeUser) {
          viewingUserId = null;
          viewingProfile = null;
        }
        isOwner = false;
      }
      updateAuthUI();
      if (typeof updateAddBtnVisibility === "function") updateAddBtnVisibility();
    });

    // Auth button — log out or open sign-in modal
    authBtn.addEventListener("click", async () => {
      if (authSession) {
        // Show landing with background grid
        searchBar.style.display = "none";
        landingPage.style.display = "flex";
        landingPage.querySelector(".landing-subtitle").textContent =
          "Your personal canvas of coffee recipes";
        landingPage.querySelector(".landing-card").style.display = "";
        authBtn.style.display = "none";
        await supabase.auth.signOut();
        history.pushState({}, '', '/');
        // Reload featured user's coffees as background
        const featured = await getProfileByUsername("toppbrocales");
        if (featured) {
          viewingProfile = featured;
          viewingUserId = featured.id;
          const coffeesData = await loadCoffeesForUser(featured.id);
          baseItems = coffeesData.map((d) => {
            const number = Number(d.number);
            return { ...d, number, img: d.img || imgFor(number) };
          });
          duplicatedItems = createDuplicatedItems(baseItems);
          await Promise.all(baseItems.map((item) => loadImageToCache(item.number, item.img)));
          tileItems = createTileLayout();
        }
      } else {
        openAuthModal(false);
      }
    });

    // Close on backdrop click
    authOverlay.addEventListener("click", (e) => {
      if (e.target === authOverlay) closeAuthModal();
    });

    // Toggle between sign-in / sign-up
    authOverlay.querySelector("#authToggleLink").addEventListener("click", (e) => {
      e.preventDefault();
      setAuthMode(!authIsSignUp);
    });

    // OAuth buttons
    authOverlay.querySelectorAll(".auth-oauth-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        supabase.auth.signInWithOAuth({
          provider: btn.dataset.provider,
          options: { redirectTo: window.location.origin },
        });
      });
    });

    // Form submit — sign in or sign up
    authOverlay.querySelector("#authForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const errEl = authOverlay.querySelector("#authError");
      errEl.textContent = "";

      const email = e.target.querySelector('[name="email"]').value.trim();
      const password = e.target.querySelector('[name="password"]').value;

      if (!email || !password) {
        errEl.textContent = "Please enter your email and password.";
        return;
      }

      if (authIsSignUp) {
        // ── Sign up ──
        const username = e.target.querySelector('[name="username"]').value?.toLowerCase().trim();
        if (!username || !/^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/.test(username)) {
          errEl.textContent = "Username must be 3\u201330 characters: lowercase letters, numbers, hyphens, underscores.";
          return;
        }
        // Check availability
        const { data: existing } = await supabase
          .from("profiles").select("id").eq("username", username).single();
        if (existing) { errEl.textContent = "Username already taken."; return; }

        // Create auth user
        const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({ email, password });
        if (signUpErr) { errEl.textContent = signUpErr.message; return; }

        // Create profile
        const { error: profileErr } = await supabase
          .from("profiles")
          .insert({ id: signUpData.user.id, username, display_name: username });
        if (profileErr) { errEl.textContent = profileErr.message; return; }

        // Set state directly — onAuthStateChange fires before profile exists, so we handle it here
        currentUserProfile = { id: signUpData.user.id, username, display_name: username };
        viewingProfile = currentUserProfile;
        viewingUserId = currentUserProfile.id;
        isOwner = true;
        closeAuthModal();
        history.pushState({}, '', `/${username}`);
        await reloadCanvasData();
        updateAuthUI();
        if (typeof updateAddBtnVisibility === "function") updateAddBtnVisibility();
      } else {
        // ── Sign in ──
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) { errEl.textContent = error.message; return; }
        closeAuthModal();
      }
    });

    // ── Landing page form handlers ──
    let landingIsSignUp = true;

    // Auto-lowercase landing username input
    landingPage.querySelector('[name="username"]').addEventListener("input", (e) => {
      const pos = e.target.selectionStart;
      e.target.value = e.target.value.toLowerCase();
      e.target.setSelectionRange(pos, pos);
    });

    // Landing toggle
    landingPage.querySelector("#landingToggleLink").addEventListener("click", (e) => {
      e.preventDefault();
      landingIsSignUp = !landingIsSignUp;
      const title = landingPage.querySelector("#landingAuthTitle");
      const submit = landingPage.querySelector("#landingAuthSubmitBtn");
      const toggle = landingPage.querySelector("#landingToggleText");
      const link = landingPage.querySelector("#landingToggleLink");
      const usernameInput = landingPage.querySelector('[name="username"]');
      const passwordInput = landingPage.querySelector('[name="password"]');
      title.textContent = landingIsSignUp ? "Sign up" : "Sign in";
      submit.textContent = landingIsSignUp ? "Sign up" : "Sign in";
      toggle.textContent = landingIsSignUp ? "Already have an account?" : "Don\u2019t have an account?";
      link.textContent = landingIsSignUp ? "Sign in" : "Sign up";
      usernameInput.style.display = landingIsSignUp ? "" : "none";
      usernameInput.required = landingIsSignUp;
      passwordInput.autocomplete = landingIsSignUp ? "new-password" : "current-password";
      landingPage.querySelector("#landingAuthError").textContent = "";
    });

    // Landing OAuth
    landingPage.querySelectorAll(".landing-oauth-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        supabase.auth.signInWithOAuth({
          provider: btn.dataset.provider,
          options: { redirectTo: window.location.origin },
        });
      });
    });

    // Landing form submit
    landingPage.querySelector("#landingAuthForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const errEl = landingPage.querySelector("#landingAuthError");
      errEl.textContent = "";
      const email = e.target.querySelector('[name="email"]').value.trim();
      const password = e.target.querySelector('[name="password"]').value;
      if (!email || !password) {
        errEl.textContent = "Please enter your email and password.";
        return;
      }
      if (landingIsSignUp) {
        const username = e.target.querySelector('[name="username"]').value?.toLowerCase().trim();
        if (!username || !/^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/.test(username)) {
          errEl.textContent = "Username must be 3\u201330 characters: lowercase letters, numbers, hyphens, underscores.";
          return;
        }
        const { data: existing } = await supabase
          .from("profiles").select("id").eq("username", username).single();
        if (existing) { errEl.textContent = "Username already taken."; return; }
        const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({ email, password });
        if (signUpErr) { errEl.textContent = signUpErr.message; return; }
        const { error: profileErr } = await supabase
          .from("profiles")
          .insert({ id: signUpData.user.id, username, display_name: username });
        if (profileErr) { errEl.textContent = profileErr.message; return; }
        currentUserProfile = { id: signUpData.user.id, username, display_name: username };
        viewingProfile = currentUserProfile;
        viewingUserId = currentUserProfile.id;
        isOwner = true;
        landingPage.style.display = "none";
        history.pushState({}, '', `/${username}`);
        await reloadCanvasData();
        updateAuthUI();
        if (typeof updateAddBtnVisibility === "function") updateAddBtnVisibility();
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) { errEl.textContent = error.message; return; }
        landingPage.style.display = "none";
      }
    });

    // Path change listener — navigate between user canvases (browser back/forward)
    window.addEventListener("popstate", async () => {
      // Handle recipe deep-link back/forward
      const coffeeNum = getRouteCoffeeNumber();
      if (coffeeNum != null && baseItems.length) {
        const item = baseItems.find((i) => i.number === coffeeNum);
        if (item) { openModal(item, { pushState: false }); return; }
      }
      // If we're back on the canvas (no coffee number), close any open modal
      if (overlay.classList.contains("open") && !coffeeNum) {
        overlay.classList.remove("open");
        overlay.style.display = "none";
        overlay.style.visibility = "hidden";
        renderPaused = false;
      }

      const result = await resolveRoute();
      if (result.found) {
        await reloadCanvasData();
        updateAuthUI();
        if (typeof updateAddBtnVisibility === "function") updateAddBtnVisibility();
      } else if (result.landing) {
        searchBar.style.display = "none";
        landingPage.style.display = "flex";
        landingPage.querySelector(".landing-card").style.display = "";
      } else {
        canvas.style.display = "none";
        searchBar.style.display = "none";
        landingPage.style.display = "flex";
        landingPage.querySelector(".landing-subtitle").textContent =
          `No canvas found for @${result.username}`;
      }
    });
  }
  
  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    // Focus search on "/" key
    if (e.key === "/" && document.activeElement !== searchInput) {
      e.preventDefault();
      searchInput.focus();
    }
    // Clear search on Escape
    if (e.key === "Escape" && document.activeElement === searchInput) {
      searchInput.blur();
      if (searchInput.value) {
        searchInput.value = "";
        searchClear.style.display = "none";
        searchQuery = "";
        rebuildLayoutForSearch("");
      }
    }
  });

  // Filter modal
  const filterOverlay = document.createElement("div");
  filterOverlay.className = "overlay filter-overlay";
  filterOverlay.innerHTML = `
    <div class="modal filter-modal" role="dialog" aria-modal="true">
      <div class="filter-modal-header">
        <h2 class="filter-modal-title">Filter</h2>
        <div class="filter-modal-actions">
          <button class="filter-clear-btn" type="button">Clear</button>
          <button class="closeBtn filter-close-btn" type="button" aria-label="Close">×</button>
        </div>
      </div>
      <div class="filter-modal-body">
        <div class="filter-section" data-category="type">
          <h3 class="filter-section-title">Type</h3>
          <div class="filter-pill-row"></div>
        </div>
        <div class="filter-section" data-category="brewer">
          <h3 class="filter-section-title">Brewer</h3>
          <div class="filter-pill-row"></div>
        </div>
        <div class="filter-section" data-category="grinder">
          <h3 class="filter-section-title">Grinder</h3>
          <div class="filter-pill-row"></div>
        </div>
        <div class="filter-section" data-category="rating">
          <h3 class="filter-section-title">Rating</h3>
          <div class="filter-pill-row"></div>
        </div>
        <div class="filter-section" data-category="tastingNotes">
          <h3 class="filter-section-title">Tasting Notes</h3>
          <div class="filter-pill-row"></div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(filterOverlay);

  // Populate filter pills (called on initial load and after reloadCanvasData)
  function populateFilterPills() {
    const opts = {
      type: [...new Set(baseItems.flatMap((i) => i.tags || []))].sort(),
      brewer: [...new Set(baseItems.flatMap((i) => i.brewer || []))].sort(),
      grinder: [...new Set(baseItems.flatMap((i) => i.grinder || []))].sort(),
      rating: [...new Set(baseItems.map((i) => i.rating).filter(Boolean))].sort((a, b) => a - b).map(String),
      tastingNotes: [...new Set(baseItems.flatMap((i) => i.notes || []))].sort(),
    };
    Object.entries(opts).forEach(([category, values]) => {
      const row = filterOverlay.querySelector(`.filter-section[data-category="${category}"] .filter-pill-row`);
      if (!row) return;
      row.innerHTML = "";
      const displayValues = category === "rating" ? values.map((r) => "★".repeat(parseInt(r, 10))) : values;
      values.forEach((value, idx) => {
        const pill = document.createElement("button");
        pill.className = "filter-pill";
        pill.type = "button";
        pill.dataset.category = category;
        pill.dataset.value = value;
        pill.textContent = displayValues[idx];
        row.appendChild(pill);
      });
    });
    // Re-attach click listeners to new pills
    filterOverlay.querySelectorAll(".filter-pill").forEach((pill) => {
      pill.addEventListener("click", handleFilterPillClick);
    });
  }
  populateFilterPills();

  function handleFilterPillClick(e) {
    const pill = e.currentTarget;
    const cat = pill.dataset.category;
    const val = pill.dataset.value;
    const arr = activeFilters[cat];
    const idx = arr.indexOf(val);
    if (idx >= 0) {
      arr.splice(idx, 1);
    } else {
      arr.push(val);
    }
    pill.classList.toggle("selected", arr.includes(val));
    rebuildLayoutForSearch(searchQuery);
    updateFilterDot();
    updateFilterClearButton();
  }

  filterOverlay.querySelector(".filter-clear-btn").addEventListener("click", () => {
    Object.keys(activeFilters).forEach((k) => (activeFilters[k] = []));
    filterOverlay.querySelectorAll(".filter-pill").forEach((p) => p.classList.remove("selected"));
    rebuildLayoutForSearch(searchQuery);
    updateFilterDot();
    updateFilterClearButton();
  });

  filterOverlay.querySelector(".filter-close-btn").addEventListener("click", () => {
    filterOverlay.classList.remove("open");
    filterOverlay.style.display = "none";
    filterOverlay.style.visibility = "hidden";
  });

  filterOverlay.addEventListener("click", (e) => {
    if (e.target === filterOverlay) {
      filterOverlay.classList.remove("open");
      filterOverlay.style.display = "none";
      filterOverlay.style.visibility = "hidden";
    }
  });

  filterBtn.addEventListener("click", () => {
    filterOverlay.classList.add("open");
    filterOverlay.style.display = "flex";
    filterOverlay.style.visibility = "visible";
    filterOverlay.style.opacity = "1";
    filterOverlay.style.zIndex = "2000";
    // Sync pill selected state
    filterOverlay.querySelectorAll(".filter-pill").forEach((p) => {
      p.classList.toggle("selected", activeFilters[p.dataset.category].includes(p.dataset.value));
    });
    updateFilterClearButton();
  });

  // Modal
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modalMedia"><img id="mImg" alt="" /></div>
      <div class="modalBody">
        <div class="titleRow">
          <h1 id="mTitle"></h1>
          <div class="modalActions">
            <button class="editBtn closeBtn" id="mEdit" style="display:none" aria-label="Edit">✎</button>
            <button class="closeBtn" id="mClose">×</button>
          </div>
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
  const mEdit = overlay.querySelector("#mEdit");

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

  let currentModalItem = null;
  let isEditing = false;
  let editorInstance = null;

  // Generates an SVG data URL of a coffee bag placeholder — shape & colour vary by number
  function makeBagSVG(name, number = 0) {
    const w = 200, h = 300;
    const col = BAG_PALETTE[(number + 2) % BAG_PALETTE.length];
    const shapeIdx = number % 4;
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const gradDef = `<linearGradient id="sg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${w}" y2="0">
        <stop offset="0"   stop-color="rgba(0,0,0,0.13)"/>
        <stop offset="0.1" stop-color="rgba(0,0,0,0.03)"/>
        <stop offset="0.5" stop-color="rgba(255,255,255,0.03)"/>
        <stop offset="0.9" stop-color="rgba(0,0,0,0.03)"/>
        <stop offset="1"   stop-color="rgba(0,0,0,0.13)"/>
      </linearGradient>`;

    const crimp = (x1, x2, sH, n) =>
      Array.from({ length: n }, (_, i) => {
        const ly = ((sH * (i + 1)) / (n + 1)).toFixed(1);
        return `<line x1="${x1}" y1="${ly}" x2="${x2}" y2="${ly}" stroke="${col.crimp}" stroke-width="0.5"/>`;
      }).join("");

    let d, sealEl, extraEl = "", textBodyY;
    let svgViewBox = `0 0 ${w} ${h}`, svgW = w;

    if (shapeIdx === 0) {
      // Four-seal bag — plain rectangle, prominent top seal
      const cr = 5, sH = Math.round(h * 0.09);
      d = `M${cr},0 Q0,0 0,${cr} L0,${h-cr} Q0,${h} ${cr},${h} L${w-cr},${h} Q${w},${h} ${w},${h-cr} L${w},${cr} Q${w},0 ${w-cr},0 Z`;
      sealEl = `<rect x="0" y="0" width="${w}" height="${sH}" fill="${col.seal}" clip-path="url(#b)"/>
      <g clip-path="url(#b)">${crimp(2, w-2, sH, 3)}</g>`;
      textBodyY = sH;

    } else if (shapeIdx === 1) {
      // Stand-up pouch — wide top, tapers to narrower bottom
      const ti = Math.round(w * 0.05), cr = Math.round(w * 0.03), sH = Math.round(h * 0.065);
      d = `M0,0 L${w},0 L${w-ti},${h-cr} Q${w-ti},${h} ${w-ti-cr},${h} L${ti+cr},${h} Q${ti},${h} ${ti},${h-cr} Z`;
      sealEl = `<rect x="0" y="0" width="${w}" height="${sH}" fill="${col.seal}" clip-path="url(#b)"/>
      <g clip-path="url(#b)">${crimp(2, w-2, sH, 4)}</g>`;
      textBodyY = sH;

    } else if (shapeIdx === 2) {
      // Flat-bottom pouch — simple rounded rectangle with full-width seal
      const cr = 5, sH = Math.round(h * 0.09);
      d = `M${cr},0 Q0,0 0,${cr} L0,${h-cr} Q0,${h} ${cr},${h} L${w-cr},${h} Q${w},${h} ${w},${h-cr} L${w},${cr} Q${w},0 ${w-cr},0 Z`;
      sealEl = `<rect x="0" y="0" width="${w}" height="${sH}" fill="${col.seal}" clip-path="url(#b)"/>
      <g clip-path="url(#b)">${crimp(2, w-2, sH, 3)}</g>`;
      textBodyY = sH;

    } else {
      // Side-fold bag — narrow top, widens toward the bottom (inverse of stand-up pouch)
      const ti = Math.round(w * 0.05), cr = 5, sH = Math.round(h * 0.065);
      d = `M${ti},0 L${w-ti},0 L${w},${h-cr} Q${w},${h} ${w-cr},${h} L${cr},${h} Q0,${h} 0,${h-cr} Z`;
      sealEl = `<rect x="0" y="0" width="${w}" height="${sH}" fill="${col.seal}" clip-path="url(#b)"/>
      <g clip-path="url(#b)">${crimp(ti+2, w-ti-2, sH, 3)}</g>`;
      textBodyY = sH;
    }

    // Word-wrap name
    const fontSize = 15, lineH = fontSize * 1.4;
    const maxChars = Math.floor((w - 48) / (fontSize * 0.56));
    const words = (name || "").split(" ");
    const lines = [];
    let line = "";
    for (const word of words) {
      const test = line ? line + " " + word : word;
      if (test.length > maxChars && line) { lines.push(line); line = word; } else { line = test; }
    }
    if (line) lines.push(line);
    const totalH = lines.length * lineH;
    const textStartY = textBodyY + (h - textBodyY) / 2 - totalH / 2 + lineH / 2;
    const textEls = lines.map((l, i) =>
      `<text x="${w/2}" y="${Math.round(textStartY + i*lineH)}" text-anchor="middle" dominant-baseline="middle" fill="${col.text}" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="${fontSize}" font-weight="500">${esc(l)}</text>`
    ).join("");

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${h}" viewBox="${svgViewBox}">
      <defs><clipPath id="b"><path d="${d}"/></clipPath>${gradDef}</defs>
      <path d="${d}" fill="${col.body}"/>
      <rect x="0" y="0" width="${w}" height="${h}" fill="url(#sg)" clip-path="url(#b)"/>
      ${sealEl}
      <path d="${d}" fill="none" stroke="rgba(0,0,0,0.1)" stroke-width="1"/>
      ${extraEl}
      ${textEls}
    </svg>`;
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  async function openModal(it, { pushState = true } = {}) {
    currentModalItem = it;

    // Update URL to /username/number for shareable links
    if (pushState && viewingProfile?.username && it?.number != null) {
      const recipeUrl = `/${viewingProfile.username}/${it.number}`;
      if (window.location.pathname !== recipeUrl) {
        history.pushState({ recipe: it.number }, '', recipeUrl);
      }
    }

    // Restore view-mode modal structure if editor was active
    const editorView = modalEl.querySelector(".editor-view");
    if (editorView) {
      editorView.remove();
      const mediaEl = modalEl.querySelector(".modalMedia");
      const bodyEl = modalEl.querySelector(".modalBody");
      if (mediaEl) mediaEl.style.display = "";
      if (bodyEl) bodyEl.style.display = "";
    }

    mImg.onerror = () => {
      mImg.onerror = null;
      mImg.src = makeBagSVG(it.name, it.number);
    };
    mImg.src = it.img || makeBagSVG(it.name, it.number);
    mImg.alt = it.name ? `${it.name} bag` : `Coffee bag ${it.number}`;
    mTitle.textContent = it.name || "";
    mEdit.style.display = hasSupabase && authSession && isOwner && it.id ? "flex" : "none";

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
      // Build metadata pills from item fields
      const hasItemMeta = it.tags?.length || it.rating || it.brewer?.length || it.grinder?.length || it.notes?.length;
      let metaHtml = "";
      if (hasItemMeta) {
        if (it.tags?.length) {
          metaHtml += `<div class="tagsWrapper"><span>Type: </span><span class="pillRow">${it.tags.map(t => `<span class="pill">${escapeHtml(t)}</span>`).join("")}</span></div>`;
        }
        if (it.rating) {
          metaHtml += `<div class="tagsWrapper"><span>Rating: </span><span class="pill">${"\u2605".repeat(it.rating)}${"\u2606".repeat(5 - it.rating)}</span></div>`;
        }
        if (it.brewer?.length) {
          metaHtml += `<div class="tagsWrapper"><span>Brewer: </span><span class="pillRow">${it.brewer.map(b => `<span class="pill">${escapeHtml(b)}</span>`).join("")}</span></div>`;
        }
        if (it.grinder?.length) {
          metaHtml += `<div class="tagsWrapper"><span>Grinder: </span><span class="pillRow">${it.grinder.map(g => `<span class="pill">${escapeHtml(g)}</span>`).join("")}</span></div>`;
        }
        if (it.notes?.length) {
          metaHtml += `<div class="tagsWrapper"><span>Tasting Notes: </span><span class="pillRow">${it.notes.map(n => `<span class="pill">${escapeHtml(n)}</span>`).join("")}</span></div>`;
        }
      }

      // Get recipe markdown
      let markdown = it.recipe_body;
      if (!markdown && !it.id) {
        const recipePath = `/recipes/coffee-${pad2(it.number)}.md`;
        const response = await fetch(recipePath, { cache: "default" });
        if (response.ok) markdown = await response.text();
        else {
          const altResponse = await fetch(`/src/data/recipes/coffee-${pad2(it.number)}.md`);
          if (altResponse.ok) markdown = await altResponse.text();
        }
      }

      if (hasItemMeta && markdown) {
        // Render metadata from item fields + recipe body from markdown
        const recipeBody = extractRecipeContent(markdown);
        const recipeHtml = recipeBody ? parseMarkdown(recipeBody) : "";
        mRecipe.innerHTML = metaHtml + recipeHtml;
      } else if (markdown) {
        // Fallback: parse everything from markdown (legacy/static behavior)
        const html = parseMarkdown(markdown);
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = html;
        const h1 = tempDiv.querySelector("h1");
        if (h1) {
          if (!mTitle.textContent) mTitle.textContent = h1.textContent;
          h1.remove();
        }
        convertMetaFieldsToPills(tempDiv);
        mRecipe.innerHTML = tempDiv.innerHTML;
      } else {
        mRecipe.innerHTML = metaHtml || '<div class="no-recipe">No recipe available for this coffee.</div>';
      }
    } catch (error) {
      console.error("Error loading recipe:", error);
      mRecipe.innerHTML = '<div class="no-recipe">Error loading recipe.</div>';
    }
  }

  function closeModal() {
    isEditing = false;
    editorInstance = null;
    const editorView = overlay.querySelector(".editor-view");
    if (editorView) {
      editorView.remove();
      const mediaEl = overlay.querySelector(".modalMedia");
      const bodyEl = overlay.querySelector(".modalBody");
      if (mediaEl) mediaEl.style.display = "";
      if (bodyEl) bodyEl.style.display = "";
    }
    overlay.classList.remove("open");
    overlay.style.display = "none";
    overlay.style.visibility = "hidden";
    renderPaused = false;

    // Revert URL to /username
    if (viewingProfile?.username) {
      const canvasUrl = `/${viewingProfile.username}`;
      if (window.location.pathname !== canvasUrl) {
        history.pushState({}, '', canvasUrl);
      }
    }
  }

  mClose.addEventListener("click", () => {
    if (isEditing && editorInstance?.cancel) {
      editorInstance.cancel();
      return;
    }
    closeModal();
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay && !isEditing) {
      closeModal();
    }
  });

  // Editor mode
  const modalEl = overlay.querySelector(".modal");

  async function openEditor(item) {
    if (!hasSupabase || !authSession) return;
    const { createCoffeeEditor } = await import("./editor.js");
    isEditing = true;
    const isNew = !item;

    overlay.classList.add("open");
    overlay.style.display = "flex";
    overlay.style.visibility = "visible";
    overlay.style.opacity = "1";
    overlay.style.zIndex = "2000";
    renderPaused = true;

    const suggestions = {
      type: [...new Set(baseItems.flatMap((i) => i.tags || []))].sort(),
      brewer: [...new Set(baseItems.flatMap((i) => i.brewer || []))].sort(),
      grinder: [...new Set(baseItems.flatMap((i) => i.grinder || []))].sort(),
      tastingNotes: [...new Set(baseItems.flatMap((i) => i.notes || []))].sort(),
    };

    editorInstance = createCoffeeEditor(modalEl, {
      item,
      supabase,
      pad2,
      suggestions,
      userId: viewingUserId,
      placeholderSrc: makeBagSVG(item?.name, item?.number),
      onSave: async (savedItem) => {
        if (isNew) {
          baseItems.push(savedItem);
        } else {
          const idx = baseItems.findIndex((i) => i.number === savedItem.number);
          if (idx >= 0) baseItems[idx] = savedItem;
        }

        // Load and cache image BEFORE recalculating layout (always call — handles empty src for placeholder)
        await loadImageToCache(savedItem.number, savedItem.img);

        filteredBaseItems = baseItems;
        duplicatedItems = createDuplicatedItems(filteredBaseItems);
        tileItems = createTileLayout();
        hoveredItem = null;
        lastHoveredItem = null;
        emptyCanvasOverlay.style.display = "none";
        emptyVisitorOverlay.style.display = "none";

        isEditing = false;
        editorInstance = null;
        currentModalItem = savedItem;
        openModal(savedItem);
      },
      onCancel: () => {
        isEditing = false;
        editorInstance = null;
        if (item) {
          openModal(item);
        } else {
          closeModal();
        }
      },
      onDelete: (deletedItem) => {
        isEditing = false;
        editorInstance = null;
        const idx = baseItems.findIndex((i) => i.number === deletedItem.number);
        if (idx >= 0) baseItems.splice(idx, 1);
        filteredBaseItems = baseItems;
        duplicatedItems = createDuplicatedItems(filteredBaseItems);
        tileItems = createTileLayout();
        imageCache.delete(deletedItem.number);
        closeModal();
      },
    });
  }

  mEdit.addEventListener("click", () => openEditor(currentModalItem));

  // Add-new button
  const addBtn = document.createElement("button");
  addBtn.className = "add-coffee-btn";
  addBtn.type = "button";
  addBtn.textContent = "+";
  addBtn.setAttribute("aria-label", "Add new coffee");
  addBtn.style.display = hasSupabase && authSession && isOwner ? "flex" : "none";
  searchBar.querySelector(".search-row").appendChild(addBtn);
  addBtn.addEventListener("click", () => openEditor(null));
  addBtn.addEventListener("mousedown", (e) => e.stopPropagation());
  addBtn.addEventListener("touchstart", (e) => e.stopPropagation());

  // Home button — navigate to own canvas when viewing someone else's
  const homeBtn = document.createElement("button");
  homeBtn.className = "home-canvas-btn";
  homeBtn.type = "button";
  homeBtn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
  homeBtn.setAttribute("aria-label", "Go to my canvas");
  homeBtn.style.display = "none";
  searchBar.querySelector(".search-row").appendChild(homeBtn);
  homeBtn.addEventListener("click", () => {
    if (currentUserProfile) {
      history.pushState({}, '', `/${currentUserProfile.username}`);
      viewingProfile = currentUserProfile;
      viewingUserId = currentUserProfile.id;
      isOwner = true;
      reloadCanvasData();
      updateAddBtnVisibility();
    }
  });
  homeBtn.addEventListener("mousedown", (e) => e.stopPropagation());
  homeBtn.addEventListener("touchstart", (e) => e.stopPropagation());

  function updateAddBtnVisibility() {
    addBtn.style.display = hasSupabase && authSession && isOwner ? "flex" : "none";
    homeBtn.style.display = hasSupabase && authSession && !isOwner ? "flex" : "none";
  }

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (isEditing) {
        if (editorInstance?.cancel) editorInstance.cancel();
      } else if (filterOverlay.classList.contains("open")) {
        filterOverlay.classList.remove("open");
        filterOverlay.style.display = "none";
        filterOverlay.style.visibility = "hidden";
      } else {
        closeModal();
      }
    }
  });

  // Deep-link: open recipe modal if URL is /username/number
  const deepLinkNumber = getRouteCoffeeNumber();
  if (deepLinkNumber != null && baseItems.length) {
    const deepItem = baseItems.find((i) => i.number === deepLinkNumber);
    if (deepItem) requestAnimationFrame(() => requestAnimationFrame(() => openModal(deepItem, { pushState: false })));
  }
}

main().catch((err) => {
  console.error(err);
  const app = document.querySelector("#app");
  if (app) app.innerHTML = `<pre style="padding:24px;color:red;">${String(err)}</pre>`;
});
