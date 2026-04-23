// OTXEngine — Frontend Supabase client (anon key, filtered by Supabase Auth session)
// All queries automatically scoped by RLS to the authenticated user's business_id
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set");
}

export const otxSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── Types mirroring DB schema (strict — no any) ─────────────────────────────

export interface ClassifiedSignal {
  id: string;
  signal_id: string;
  business_id: string;
  intent_score: number;
  sector_match_score: number;
  geo_match_score: number;
  qualified: boolean;
  processed_at: string;
  source_url: string;
  confidence_score: number;
}

export interface SectorTrend {
  id: string;
  sector: string;
  geo: string | null;
  z_score: number;
  rolling_mean: number;
  rolling_std: number;
  spike_detected: boolean;
  detected_at_utc: string;
  source_url: string;
  confidence_score: number;
}

export interface ActionRecommended {
  id: string;
  business_id: string;
  action_score: number;
  action_type: "promote" | "respond" | "alert" | "hold";
  expires_at: string;
  source_ids: string[];
  stale_memory_flag: boolean;
  source_url: string;
  confidence_score: number;
  created_at: string;
}

export interface EventOpportunity {
  id: string;
  event_id: string;
  business_id: string;
  impact_score: number;
  sector_relevance: number;
  geo_relevance: number;
  historical_weight: number;
  source_url: string;
  confidence_score: number;
  events_raw?: { event_name: string; event_date: string; geo: string | null };
}

export interface CompetitorChange {
  id: string;
  business_id: string;
  competitor_name: string | null;
  change_type: "price" | "website" | "social" | "reviews" | null;
  change_summary: string | null;
  detected_at_utc: string;
  source_url: string;
  confidence_score: number;
}

export interface AgentHeartbeat {
  id: string;
  agent_name: string;
  last_ping_utc: string;
  last_ingestion_utc: string | null;
  status: "OK" | "DELAYED" | "ERROR";
  error_message: string | null;
}

export interface Business {
  id: string;
  name: string;
  sector: "restaurant" | "fitness" | "beauty" | "local";
  geo_city: string;
  price_tier: "budget" | "mid" | "premium" | null;
}
