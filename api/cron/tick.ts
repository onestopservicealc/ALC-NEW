/**
 * Endpoint ที่ Vercel Cron เรียก
 *
 * Vercel Hobby จำกัด cron แต่ละ expression ให้รันวันละครั้ง แต่ให้ได้ถึง 100 jobs ต่อโปรเจกต์
 * vercel.json จึงลงทะเบียน 8 entries ที่ชั่วโมงต่างกัน = ดึงข่าวทุก ~3 ชั่วโมง
 * และแต่ละ invocation มีงบเวลา 300 วินาที (ค่าสูงสุดของ Hobby)
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { assertCronAuthorized } from '../_lib/auth.js';
import { runIngest } from '../_lib/ingest.js';
import { fail } from '../_lib/respond.js';
import { supabaseAdmin } from '../_lib/supabaseAdmin.js';

export const config = { maxDuration: 300 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    assertCronAuthorized(req);
    const summary = await runIngest(supabaseAdmin(), { trigger: 'cron' });
    res.status(200).json({ success: true, summary });
  } catch (err) {
    fail(res, err);
  }
}
