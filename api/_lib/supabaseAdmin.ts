/**
 * Supabase client ฝั่ง server ด้วย service role key — ข้าม RLS
 * ใช้เฉพาะใน Vercel Functions เท่านั้น ห้าม import จากโค้ดฝั่ง browser
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { requireEnv } from './env';

let cached: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (!cached) {
    cached = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

/** สร้าง client ที่ผูกกับ JWT ของผู้ใช้ เพื่อให้ RLS ทำงานตาม role จริง */
export function supabaseAsUser(accessToken: string): SupabaseClient {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
