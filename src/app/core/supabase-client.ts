import { createClient, SupabaseClient } from '@supabase/supabase-js';

declare global {
  interface Window {
    __MEU_PLANTAO_CONFIG__?: {
      supabaseUrl?: string;
      supabaseAnonKey?: string;
    };
  }
}

const runtimeConfig = typeof window === 'undefined' ? undefined : window.__MEU_PLANTAO_CONFIG__;

/**
 * Cliente público opcional: fica indisponível até a configuração do projeto Supabase.
 * A chave anon é pública por desenho e só é segura com RLS; service_role nunca vai ao browser.
 */
export const supabase: SupabaseClient | null =
  runtimeConfig?.supabaseUrl && runtimeConfig.supabaseAnonKey
    ? createClient(runtimeConfig.supabaseUrl, runtimeConfig.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    : null;

export const isSupabaseConfigured = supabase !== null;
