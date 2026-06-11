import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = "https://pbmewlkzgzlzjmeoceme.supabase.co";
export const LEAGUE_ID    = "075936d5-15a1-4c7c-b16d-048441160a55";

export const supabase = createClient(
  SUPABASE_URL,
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBibWV3bGt6Z3psemptZW9jZW1lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMDA3OTgsImV4cCI6MjA5NjY3Njc5OH0.Ik9_LyE2uQ5pP3dHY5JyUtTQdRiKw-bm1URJX29exvw",
  {
    auth: {
      persistSession: true,
      storageKey: "wc2026-session",
      autoRefreshToken: true,
      detectSessionInUrl: true,
    }
  }
);
