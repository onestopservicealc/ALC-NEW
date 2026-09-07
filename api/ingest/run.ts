/** ปุ่ม "ดึงข่าวเดี๋ยวนี้" สำหรับเจ้าหน้าที่ (ต้องมีสิทธิ์ editor ขึ้นไป) */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from '../_lib/auth';
import { runIngest } from '../_lib/ingest';
import { fail, methodNotAllowed } from '../_lib/respond';
import { supabaseAdmin } from '../_lib/supabaseAdmin';

export const config = { maxDuration: 300 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    const user = await requireUser(req, 'editor');
    const body = (req.body ?? {}) as {
      sourceIds?: string[];
      skipPoll?: boolean;
      maxArticles?: number;
    };

    const summary = await runIngest(supabaseAdmin(), {
      trigger: 'manual',
      triggeredBy: user.id,
      sourceIds: Array.isArray(body.sourceIds) ? body.sourceIds : undefined,
      skipPoll: Boolean(body.skipPoll),
      maxArticles:
        typeof body.maxArticles === 'number' ? Math.min(Math.max(body.maxArticles, 1), 100) : undefined,
    });

    res.status(200).json({ success: true, summary });
  } catch (err) {
    fail(res, err);
  }
}
