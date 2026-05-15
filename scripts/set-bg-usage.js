// One-off: set a user's bg_removal_usage count to a value (default: cap = 5)
// for the current month. Use to simulate cap-reached UX.
//   node scripts/set-bg-usage.js <username> [count]
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Missing env"); process.exit(1); }

const username = process.argv[2];
const count = parseInt(process.argv[3] || "5", 10);
if (!username) { console.error("Usage: node scripts/set-bg-usage.js <username> [count]"); process.exit(1); }

const supabase = createClient(url, key, { auth: { persistSession: false } });
const { data: profile, error: profErr } = await supabase
  .from("profiles").select("id").eq("username", username).single();
if (profErr || !profile) { console.error("profile not found:", profErr?.message); process.exit(1); }

const monthKey = new Date().toISOString().slice(0, 7);
const { error } = await supabase
  .from("bg_removal_usage")
  .upsert({ user_id: profile.id, month: monthKey, count, updated_at: new Date().toISOString() });
if (error) { console.error("upsert failed:", error.message); process.exit(1); }

console.log(`✅ Set ${username}'s ${monthKey} count to ${count}`);
console.log(`Next /api/remove-bg call will return 429 if count >= cap.`);
