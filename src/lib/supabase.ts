/**
 * Supabase client ฝั่ง browser
 *
 * ใช้ anon key ซึ่งปลอดภัยที่จะฝังใน bundle เพราะสิทธิ์จริงถูกคุมด้วย RLS:
 *  - ผู้ไม่ล็อกอิน (anon) อ่านได้เฉพาะ view `incidents_public` ที่ตัดชื่อบุคคลออกแล้ว
 *  - ผู้ล็อกอินอ่านตาราง incidents ได้ · editor/admin เท่านั้นที่เขียนได้
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey);

/** null เมื่อยังไม่ตั้งค่า env — UI จะแสดงหน้าจอแนะนำการตั้งค่าแทนที่จะพัง */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      'ยังไม่ได้ตั้งค่า VITE_SUPABASE_URL และ VITE_SUPABASE_ANON_KEY — ดูวิธีตั้งค่าใน README'
    );
  }
  return supabase;
}

/** access token ปัจจุบัน สำหรับแนบไปกับ Vercel Functions */
export async function getAccessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * error จาก callApi ที่ยังพกคำตอบเต็มของเซิร์ฟเวอร์มาด้วย
 *
 * เดิมโยนแค่ข้อความ ทำให้ธงอย่าง needsManualUrl ที่เซิร์ฟเวอร์ส่งมาหายไประหว่างทาง
 * หน้าจอจึงแยกไม่ออกว่า "ถอดลิงก์ไม่ได้ ให้คนวางเอง" ต่างจากความล้มเหลวอื่นอย่างไร
 */
export interface ApiError extends Error {
  status: number;
  payload: Record<string, unknown>;
}

/** เรียก API ฝั่ง server พร้อมแนบ token ให้อัตโนมัติ */
export async function callApi<T>(path: string, body?: unknown): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });

  // อ่านเป็นข้อความก่อนแล้วค่อยแปลง — เวลาแพลตฟอร์มพัง (ฟังก์ชัน crash หรือหมดเวลา)
  // มันตอบเป็น HTML ไม่ใช่ JSON ถ้า .json() ไปเลยจะได้ {} แล้วสาเหตุจริงหายหมด
  const raw = await res.text();
  let json: unknown = {};
  let wasJson = true;
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    wasJson = false;
  }

  if (!res.ok) {
    const serverMessage = (json as any)?.error;
    const err = new Error(
      serverMessage ||
        (wasJson
          ? `เรียก ${path} ไม่สำเร็จ (HTTP ${res.status})`
          : // ไม่ใช่ JSON = ไม่ได้มาจากโค้ดเรา แต่มาจากแพลตฟอร์ม
            `เซิร์ฟเวอร์ล้มเหลว (HTTP ${res.status}) ที่ ${path} — ` +
            'ฟังก์ชันอาจ crash หรือทำงานนานเกินกำหนด ดูสาเหตุจริงได้ใน log ของเซิร์ฟเวอร์')
    ) as ApiError;
    err.status = res.status;
    err.payload = (wasJson ? (json ?? {}) : {}) as Record<string, unknown>;
    throw err;
  }
  return json as T;
}
