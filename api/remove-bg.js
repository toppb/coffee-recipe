import { createClient } from "@supabase/supabase-js";

const REMOVE_BG_URL = "https://api.remove.bg/v1.0/removebg";

export const config = {
  api: { bodyParser: { sizeLimit: "6mb" } },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const apiKey = process.env.REMOVEBG_API_KEY;
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!apiKey || !supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: "misconfigured" });
  }

  const defaultUserCap = parseInt(process.env.REMOVEBG_USER_MONTHLY_CAP || "5", 10);
  const globalCap = parseInt(process.env.REMOVEBG_GLOBAL_DAILY_CAP || "200", 10);
  // Per-user overrides: "uuid:cap,uuid:cap". Parsed once per cold start.
  const overrides = Object.fromEntries(
    (process.env.REMOVEBG_USER_CAP_OVERRIDES || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((pair) => {
        const [id, cap] = pair.split(":").map((s) => s.trim());
        return [id, parseInt(cap, 10)];
      })
      .filter(([id, cap]) => id && Number.isFinite(cap))
  );

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return res.status(401).json({ error: "no_token" });

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const { data: userData, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !userData?.user) {
    return res.status(401).json({ error: "invalid_token" });
  }
  const userId = userData.user.id;

  const now = new Date();
  const monthKey = now.toISOString().slice(0, 7);
  const dayKey = now.toISOString().slice(0, 10);

  const [{ data: userRow }, { data: globalRow }] = await Promise.all([
    supabase
      .from("bg_removal_usage")
      .select("count")
      .eq("user_id", userId)
      .eq("month", monthKey)
      .maybeSingle(),
    supabase
      .from("bg_removal_usage_global")
      .select("count")
      .eq("day", dayKey)
      .maybeSingle(),
  ]);

  const userCap = overrides[userId] ?? defaultUserCap;
  if ((userRow?.count ?? 0) >= userCap) {
    return res
      .status(429)
      .json({ reason: "user_cap_reached", cap: userCap, used: userRow?.count ?? 0 });
  }
  if ((globalRow?.count ?? 0) >= globalCap) {
    return res.status(429).json({ reason: "global_cap_reached" });
  }

  const { image_b64 } = req.body || {};
  if (!image_b64 || typeof image_b64 !== "string") {
    return res.status(400).json({ error: "missing_image" });
  }

  const form = new FormData();
  form.append("image_file_b64", image_b64);
  form.append("size", "auto");
  form.append("format", "png");

  let upstream;
  try {
    upstream = await fetch(REMOVE_BG_URL, {
      method: "POST",
      headers: { "X-Api-Key": apiKey },
      body: form,
    });
  } catch (err) {
    console.error("remove.bg fetch failed", err);
    return res.status(502).json({ reason: "upstream_unreachable" });
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    console.error("remove.bg error", upstream.status, text);
    return res
      .status(502)
      .json({ reason: "remove_bg_error", status: upstream.status });
  }

  await supabase.rpc("increment_bg_usage", {
    p_user_id: userId,
    p_month: monthKey,
    p_day: dayKey,
  });

  const arrayBuf = await upstream.arrayBuffer();
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "no-store");
  return res.send(Buffer.from(arrayBuf));
}
