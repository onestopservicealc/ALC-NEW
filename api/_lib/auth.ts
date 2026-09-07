/** ตรวจสิทธิ์สำหรับ endpoint ฝั่ง server */
import type { VercelRequest } from '@vercel/node';
import { requireEnv } from './env';
import { supabaseAdmin } from './supabaseAdmin';

/** เทียบสตริงแบบไม่รั่วเวลา (กัน timing attack กับ CRON_SECRET) */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function bearer(req: VercelRequest): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice(7).trim();
}

/** endpoint ที่ Vercel Cron เรียก — Vercel ใส่ Authorization: Bearer $CRON_SECRET ให้เอง */
export function assertCronAuthorized(req: VercelRequest): void {
  const expected = requireEnv('CRON_SECRET');
  const token = bearer(req);
  if (!token || !safeEqual(token, expected)) {
    const err = new Error('ไม่ได้รับอนุญาต');
    (err as any).statusCode = 401;
    throw err;
  }
}

export interface AuthedUser {
  id: string;
  email: string | null;
  role: 'viewer' | 'editor' | 'admin';
}

/** ตรวจ JWT ของผู้ใช้จาก Supabase Auth แล้วอ่าน role จาก profiles */
export async function requireUser(
  req: VercelRequest,
  minRole: 'viewer' | 'editor' | 'admin' = 'viewer'
): Promise<AuthedUser> {
  const token = bearer(req);
  if (!token) {
    const err = new Error('กรุณาเข้าสู่ระบบ');
    (err as any).statusCode = 401;
    throw err;
  }

  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) {
    const err = new Error('เซสชันไม่ถูกต้องหรือหมดอายุ');
    (err as any).statusCode = 401;
    throw err;
  }

  const { data: profile } = await admin
    .from('profiles')
    .select('role')
    .eq('id', data.user.id)
    .maybeSingle();

  const role = (profile?.role as AuthedUser['role']) ?? 'viewer';
  const rank = { viewer: 0, editor: 1, admin: 2 };
  if (rank[role] < rank[minRole]) {
    const err = new Error(`ต้องมีสิทธิ์ระดับ ${minRole} ขึ้นไป (สิทธิ์ปัจจุบัน: ${role})`);
    (err as any).statusCode = 403;
    throw err;
  }

  return { id: data.user.id, email: data.user.email ?? null, role };
}
