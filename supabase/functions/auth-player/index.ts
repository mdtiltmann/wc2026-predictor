import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LEAGUE_PASSWORD           = "fifa-sa";

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    }});
  }

  try {
    const { name, password } = await req.json();

    if (password !== LEAGUE_PASSWORD) {
      return json({ error: "Wrong password. Ask the league admin." }, 401);
    }
    if (!name?.trim()) {
      return json({ error: "Name is required." }, 400);
    }

    const email = `${name.trim().toLowerCase().replace(/\s+/g, ".")}@wc2026.app`;

    // Try sign in first (returning user)
    const regular = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: signInData, error: signInErr } = await regular.auth.signInWithPassword({ email, password });

    if (!signInErr && signInData?.session) {
      return json({ session: signInData.session });
    }

    // New user — create via admin API (bypasses client rate limits entirely)
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createErr) {
      if (createErr.message?.toLowerCase().includes("already been registered") ||
          createErr.message?.toLowerCase().includes("already registered")) {
        return json({ error: "That name is already taken — try a different one." }, 409);
      }
      throw createErr;
    }

    // Sign in immediately after creation
    const { data: newSignIn, error: newSignInErr } = await regular.auth.signInWithPassword({ email, password });
    if (newSignInErr) throw newSignInErr;

    return json({ session: newSignIn.session });

  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
