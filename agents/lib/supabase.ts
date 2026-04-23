// OTXEngine — Shared Supabase client (service_role, bypasses RLS for agents)
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL: string = Deno.env.get("SUPABASE_URL") ?? (() => { throw new Error("SUPABASE_URL not set"); })();
const SERVICE_ROLE_KEY: string = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? (() => { throw new Error("SUPABASE_SERVICE_ROLE_KEY not set"); })();

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
