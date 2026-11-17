import type { SupabaseClient } from '@supabase/supabase-js';

declare global {
  interface Window {
    __MEU_PLANTAO_CONFIG__?: {
      supabaseUrl?: string;
      supabaseAnonKey?: string;
    };
  }
}

let clientPromise: Promise<SupabaseClient | null> | undefined;

/** Load and cache the existing browser client only when a Supabase operation is needed. */
export function getSupabase(): Promise<SupabaseClient | null> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const config = typeof window === 'undefined' ? undefined : window.__MEU_PLANTAO_CONFIG__;
      if (!config?.supabaseUrl || !config.supabaseAnonKey) return null;

      const { createClient } = await import('@supabase/supabase-js');
      return createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
    })();
  }
  return clientPromise;
}
