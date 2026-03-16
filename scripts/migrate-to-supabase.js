/**
 * One-time migration: JSON + recipes + images -> Supabase
 * Run: npm run migrate
 * Requires: .env with VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in environment");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

function parseRecipe(md) {
  const meta = { brewer: [], grinder: [], notes: [], recipeBody: "" };
  const lines = md.split("\n");
  let inTastingNotes = false;
  let recipeStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase();

    if (lower.startsWith("brewer: ")) {
      meta.brewer = line.substring(line.indexOf(":") + 1).split(",").map((s) => s.trim()).filter(Boolean);
    } else if (lower.startsWith("grinder: ")) {
      meta.grinder = line.substring(line.indexOf(":") + 1).split(",").map((s) => s.trim()).filter(Boolean);
    } else if (line.trim().toLowerCase() === "### tasting notes") {
      inTastingNotes = true;
    } else if (inTastingNotes && /^[-*]\s+/.test(line)) {
      meta.notes.push(line.replace(/^[-*]\s+/, "").trim());
    } else if (inTastingNotes && line.startsWith("##")) {
      inTastingNotes = false;
      recipeStart = i;
      break;
    } else if (line.startsWith("##") && !inTastingNotes) {
      recipeStart = i;
      break;
    }
  }

  meta.recipeBody = lines.slice(recipeStart).join("\n").trim();
  return meta;
}

async function main() {
  const coffeePath = join(root, "public", "data", "coffee.json");
  const coffeeData = JSON.parse(readFileSync(coffeePath, "utf-8"));

  for (const item of coffeeData) {
    const num = Number(item.number);
    const pad2 = (n) => String(n).padStart(2, "0");
    const filename = `coffee-bag-${pad2(num)}.png`;
    const imgPath = join(root, "public", "bags", filename);

    let recipeBody = "";
    let brewer = [];
    let grinder = [];
    let notes = item.notes || [];

    const recipePath = join(root, "public", "recipes", `coffee-${pad2(num)}.md`);
    if (existsSync(recipePath)) {
      const md = readFileSync(recipePath, "utf-8");
      const parsed = parseRecipe(md);
      recipeBody = md;
      brewer = parsed.brewer;
      grinder = parsed.grinder;
      if (parsed.notes.length) notes = parsed.notes;
    }

    let imgUrl = null;
    if (existsSync(imgPath)) {
      const fileBuffer = readFileSync(imgPath);
      const uploadPath = `coffee-bag-${pad2(num)}.png`;
      const { error } = await supabase.storage.from("coffee-bags").upload(uploadPath, fileBuffer, {
        contentType: "image/png",
        upsert: true,
      });
      if (error) {
        console.error(`Upload failed for ${filename}:`, error);
      } else {
        const { data } = supabase.storage.from("coffee-bags").getPublicUrl(uploadPath);
        imgUrl = data.publicUrl;
      }
    }

    const row = {
      number: num,
      name: item.name || "",
      rating: item.rating || 5,
      tags: item.tags || [],
      img_url: imgUrl,
      roaster: item.roaster || "",
      origin: item.origin || "",
      process: item.process || "",
      notes,
      brew: item.brew || "",
      brewer,
      grinder,
      recipe_body: recipeBody,
    };

    const { error } = await supabase.from("coffees").upsert(row, {
      onConflict: "number",
      ignoreDuplicates: false,
    });

    if (error) {
      console.error(`Insert failed for coffee ${num}:`, error);
    } else {
      console.log(`Migrated: ${item.name}`);
    }
  }

  console.log("Migration complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
