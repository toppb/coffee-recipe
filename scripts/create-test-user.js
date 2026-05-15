// One-off: create a confirmed test user + profile row.
// Run: node scripts/create-test-user.js
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Missing env"); process.exit(1); }

const admin = createClient(url, key, { auth: { persistSession: false } });

const stamp = Date.now().toString(36);
const username = `tester_${stamp}`;
const email = `tester+${stamp}@brewist.test`;
const password = `Test-${stamp}-pw!`;

const { data, error } = await admin.auth.admin.createUser({
  email, password, email_confirm: true,
});
if (error) { console.error("createUser:", error.message); process.exit(1); }

const userId = data.user.id;
const { error: profErr } = await admin
  .from("profiles")
  .insert({ id: userId, username, display_name: username });
if (profErr) {
  console.error("profile insert:", profErr.message);
  await admin.auth.admin.deleteUser(userId).catch(() => {});
  process.exit(1);
}

console.log("\n✅ Test user created\n");
console.log(`  email:    ${email}`);
console.log(`  password: ${password}`);
console.log(`  username: ${username}`);
console.log(`  user id:  ${userId}`);
console.log(`\nSign in at http://localhost:5173 with email + password.`);
console.log(`Profile URL once logged in: http://localhost:5173/${username}\n`);
