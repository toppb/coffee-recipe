/**
 * One-time backfill: populate img_width / img_height on every row in `coffees`
 * by reading the actual bag image from Supabase Storage (or the static URL).
 * After this runs, the app can render every bag with correct aspect ratio
 * without downloading the image just to learn its shape.
 *
 * Run: node scripts/backfill-bag-dimensions.js
 *
 * Requires VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// node 18+ has fetch and a WHATWG-compatible Blob. For decoding, use sharp if available,
// otherwise fall back to parsing PNG/WebP headers directly. Headers-only avoids a heavy dep.
function readDimsFromBuffer(buf) {
  // PNG: signature 89 50 4E 47, IHDR at offset 16-23 (width), 20-23 (height) big-endian
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
  ) {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    return { width, height };
  }
  // WebP: 'RIFF' .... 'WEBP' then 'VP8 ' / 'VP8L' / 'VP8X'
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    const fourcc = buf.toString("ascii", 12, 16);
    if (fourcc === "VP8 ") {
      // VP8 keyframe: width/height at offset 26-29
      const width = buf.readUInt16LE(26) & 0x3fff;
      const height = buf.readUInt16LE(28) & 0x3fff;
      return { width, height };
    }
    if (fourcc === "VP8L") {
      const b0 = buf[21], b1 = buf[22], b2 = buf[23], b3 = buf[24];
      const width = 1 + (((b1 & 0x3f) << 8) | b0);
      const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      return { width, height };
    }
    if (fourcc === "VP8X") {
      const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      return { width, height };
    }
  }
  // JPEG: scan SOF marker
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      const size = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = buf.readUInt16BE(i + 5);
        const width = buf.readUInt16BE(i + 7);
        return { width, height };
      }
      i += 2 + size;
    }
  }
  return null;
}

async function main() {
  const { data: rows, error } = await supabase
    .from("coffees")
    .select("id, number, name, img_url, img_width, img_height")
    .is("deleted_at", null);
  if (error) throw error;

  let updated = 0, skipped = 0, failed = 0;
  for (const row of rows) {
    if (row.img_width && row.img_height) { skipped++; continue; }
    if (!row.img_url) { skipped++; continue; }
    try {
      // For images we'd usually want a range header to grab just headers, but Supabase
      // Storage doesn't always honor it cleanly — fetching the whole image is fine for a
      // one-time backfill of ~93 rows.
      const resp = await fetch(row.img_url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = Buffer.from(await resp.arrayBuffer());
      const dims = readDimsFromBuffer(buf);
      if (!dims) throw new Error("unrecognized image format");
      const { error: upErr } = await supabase
        .from("coffees")
        .update({ img_width: dims.width, img_height: dims.height })
        .eq("id", row.id);
      if (upErr) throw upErr;
      updated++;
      console.log(`#${row.number} ${row.name}: ${dims.width}x${dims.height}`);
    } catch (e) {
      failed++;
      console.error(`#${row.number} ${row.name}: ${e.message}`);
    }
  }
  console.log(`\nDone. updated=${updated} skipped=${skipped} failed=${failed}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
