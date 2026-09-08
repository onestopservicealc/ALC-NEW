/**
 * ถอดลิงก์ Google News ของ lead หนึ่งราย แล้วคืน URL ต้นทาง — ไม่แตะฐานข้อมูล
 *
 * ทำไมต้องแยกออกมาจาก /api/leads/attach:
 * เดิมรวมไว้ใน attach ซึ่งเป็นเส้นทางที่ "เขียนข้อมูลจริง" ผลคือเมื่อการคุยกับ Google
 * มีปัญหาบนเซิร์ฟเวอร์จริง (ช้า ถูกบล็อก หรือฟังก์ชันถูกฆ่าเพราะเกินเวลา)
 * มันลาก endpoint ที่เคยทำงานได้ดีมาตลอดล้มไปด้วย แล้วคืน 500 เปล่าที่ผู้ใช้อ่านไม่รู้เรื่อง
 *
 * แยกออกมาแล้วได้ 3 อย่าง:
 *   1. attach กลับไปเป็นของเดิมที่พิสูจน์แล้วว่านิ่ง — ไม่มีการต่อเน็ตออกนอกเลย
 *   2. งานที่เสี่ยงกลายเป็น "ทำได้ก็ดี" ถ้าพังก็แค่ถอยไปให้เจ้าหน้าที่วาง URL เอง
 *   3. เวลามีปัญหา แยกออกทันทีว่าพังที่ขั้นถอดลิงก์ ไม่ใช่ขั้นบันทึก
 *
 * endpoint นี้อ่านอย่างเดียว เรียกซ้ำได้ไม่จำกัด ไม่มีผลข้างเคียง
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from '../_lib/auth';
import { resolveGoogleNewsUrl } from '../_lib/gnews';
import { fail, methodNotAllowed } from '../_lib/respond';
import { supabaseAdmin } from '../_lib/supabaseAdmin';

export const config = { maxDuration: 60 };

/**
 * เส้นตายรวมของการถอด ครอบทุกอย่างรวมถึงเวลารอคิวและ DNS
 * ปกติเสร็จใน ~250 ms — ถ้าเกิน 12 วินาทีถือว่าใช้ไม่ได้ ถอยดีกว่ารอ
 */
const DEADLINE_MS = 12000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    await requireUser(req, 'editor');

    const { articleId, step } = (req.body ?? {}) as Record<string, string>;

    /* ---- โหมดตรวจหาสาเหตุ ----
     *
     * จำเป็นเพราะเมื่อฟังก์ชันตายบนแพลตฟอร์ม เราจะได้ 500 เปล่าที่ไม่มีข้อความอะไรเลย
     * และเข้าไปอ่าน log ของ Vercel ไม่ได้ วิธีเดียวที่จะรู้ว่าพังตรงไหนคือ
     * ทำทีละขั้นแล้วตอบกลับทันที ขั้นแรกที่ไม่ตอบ JSON คือขั้นที่พัง
     */
    const stage = Number(step) || 0;

    if (stage === 1) {
      return res.status(200).json({ ok: true, stage: 1, note: 'ฟังก์ชันบูตและยืนยันตัวตนได้' });
    }

    if (stage === 2) {
      const mod = await import('../_lib/gnews');
      return res.status(200).json({
        ok: true,
        stage: 2,
        note: 'โหลดโมดูลถอดลิงก์ได้',
        hasFn: typeof mod.resolveGoogleNewsUrl === 'function',
      });
    }

    if (stage === 3) {
      // ต่อเน็ตออกนอกไปเว็บทั่วไป — แยกให้ออกว่า "ออกเน็ตไม่ได้เลย" หรือ "เฉพาะ Google"
      const started = Date.now();
      const r = await fetch('https://example.com', { method: 'GET' });
      return res.status(200).json({
        ok: true,
        stage: 3,
        note: 'ต่อเน็ตออกนอกได้',
        status: r.status,
        ms: Date.now() - started,
      });
    }

    if (stage === 4) {
      const started = Date.now();
      const r = await fetch('https://news.google.com/rss/articles/CBMiK0FVX3lxTE0', { method: 'GET' });
      const body = await r.text();
      return res.status(200).json({
        ok: true,
        stage: 4,
        note: 'ต่อไปที่ Google News ได้',
        status: r.status,
        finalUrl: r.url.slice(0, 80),
        bytes: body.length,
        ms: Date.now() - started,
      });
    }

    if (!articleId) {
      return res.status(400).json({ error: 'ไม่ได้ระบุรายการที่จะถอดลิงก์' });
    }

    const db = supabaseAdmin();
    const { data: lead, error: readError } = await db
      .from('articles')
      .select('gnews_link, url')
      .eq('id', articleId)
      .maybeSingle();

    if (readError) {
      return res.status(200).json({ url: null, reason: `อ่านรายการไม่สำเร็จ: ${readError.message}` });
    }

    // เคยยืนยันไปแล้ว — ใช้ของเดิม ไม่ต้องไปกวน Google ซ้ำ
    if (lead?.url) {
      return res.status(200).json({ url: lead.url, cached: true });
    }

    if (!lead?.gnews_link) {
      return res.status(200).json({ url: null, reason: 'รายการนี้ไม่มีลิงก์ Google News ให้ถอด' });
    }

    // เส้นตายครอบทั้งก้อน: timeout ข้างในครอบแค่ตัว fetch ส่วนการรอคิวและ DNS อยู่นอกนั้น
    // ถ้าไม่มีตรงนี้ คำขออาจค้างจนแพลตฟอร์มฆ่าทิ้ง แล้วกลายเป็น 500 ที่ไม่มีข้อความบอกอะไร
    const resolved = await Promise.race([
      resolveGoogleNewsUrl(lead.gnews_link).catch((err) => ({
        url: null as string | null,
        error: `ตัวถอดลิงก์ล้มเหลว: ${String((err as Error)?.message ?? err).slice(0, 200)}`,
      })),
      new Promise<{ url: string | null; error: string }>((done) =>
        setTimeout(() => done({ url: null, error: `เกินเวลาที่กำหนด (${DEADLINE_MS}ms)` }), DEADLINE_MS)
      ),
    ]);

    if (!resolved.url) {
      console.warn('[resolve] ถอดลิงก์ไม่สำเร็จ', { articleId, reason: resolved.error });
    }

    // สังเกตว่าตอบ 200 เสมอแม้ถอดไม่ได้ — "ถอดไม่ได้" เป็นผลลัพธ์ที่ปกติของงานนี้
    // ไม่ใช่ความผิดพลาดของคำขอ หน้าจอจะได้ไม่ต้องแยกแยะจาก error จริงๆ
    res.status(200).json({ url: resolved.url ?? null, reason: resolved.error ?? null });
  } catch (err) {
    fail(res, err);
  }
}
