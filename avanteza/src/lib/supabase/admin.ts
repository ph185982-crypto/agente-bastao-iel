// Cliente com service role — usar SOMENTE no servidor (cron, webhooks, callback OAuth, executor).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../env";

let cached: SupabaseClient<any, "avanteza", any> | null = null;

export function adminDb() {
  if (!cached) {
    cached = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
      db: { schema: "avanteza" },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}
