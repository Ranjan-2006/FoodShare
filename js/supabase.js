import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config.js";

export function getSupabaseConfigError() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY ||
      SUPABASE_URL.includes("YOUR_PROJECT") ||
      SUPABASE_ANON_KEY.includes("YOUR_SUPABASE")) {
    return "Supabase is not configured. Add your project URL and publishable key in js/config.js.";
  }

  let projectUrl;
  try {
    projectUrl = new URL(SUPABASE_URL);
  } catch {
    return "The Supabase URL is invalid. Use the project URL from Supabase → Project Settings → API.";
  }

  if (!["https:", "http:"].includes(projectUrl.protocol) ||
      projectUrl.pathname !== "/" || projectUrl.search || projectUrl.hash) {
    return "Use only the Supabase project URL in js/config.js (for example, https://your-project.supabase.co). Do not append /rest/v1, /auth/v1, or another API path.";
  }

  return null;
}

export const isSupabaseConfigured = getSupabaseConfigError() === null;

export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    })
  : null;

export function requireSupabase() {
  if (!supabase) {
    throw new Error("FoodShare is not connected yet. Add your Supabase project URL and publishable key in js/config.js, then run database/schema.sql in the Supabase SQL Editor.");
  }
  return supabase;
}
