/**
 * แนบ URL จริงให้ lead แล้วจบ — ไม่เรียก AI
 *
 * ทำไมต้องแยกจาก extract-url:
 * ขั้นตอนยืนยันลิงก์เดิมให้เจ้าหน้าที่วาง URL แล้ว **ยืนค้างรอ AI สกัด 5-15 วินาที**
 * ก่อนจะไปข่าวถัดไปได้ คิว 73 รายการจึงใช้เวลาอย่างน้อย 30 นาที
 * โดยที่เวลาส่วนใหญ่คือการนั่งรอเฉยๆ
 *
 * endpoint นี้ทำแค่สิ่งเดียวที่ต้องใช้คน — บอกว่า lead นี้คือข่าวที่ URL ไหน — แล้วตอบทันที
 * การสกัดปล่อยให้ stage C ของ pipeline ทำต่อ (แถวเข้าเงื่อนไข keyword_pass + attempts<3 แล้ว)
 *
 * ผลพลอยได้ที่สำคัญ: งานไม่หายแม้ผู้ใช้ปิดแท็บทันทีหลังวาง เพราะสถานะอยู่ในฐานข้อมูลแล้ว
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from '../_lib/auth';
import { canonicalizeUrl } from '../_lib/http';
import { linkArticleToUrl } from '../_lib/leads';
import { fail, methodNotAllowed } from '../_lib/respond';
import { supabaseAdmin } from '../_lib/supabaseAdmin';

export const config = { maxDuration: 30 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    await requireUser(req, 'editor');

    const { url, articleId } = (req.body ?? {}) as Record<string, string>;

    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'กรุณาระบุ URL ข่าวที่ขึ้นต้นด้วย http:// หรือ https://' });
    }
    if (/^https?:\/\/news\.google\.com\//i.test(url)) {
      return res.status(400).json({
        error:
          'ลิงก์ Google News ใช้ดึงเนื้อข่าวไม่ได้ (Google เข้ารหัสลิงก์ไว้) — กรุณาเปิดลิงก์แล้วคัดลอก URL ของสำนักข่าวต้นทางมาแทน',
      });
    }
    if (!articleId) {
      return res.status(400).json({ error: 'ไม่ได้ระบุรายการที่จะแนบ URL' });
    }

    const db = supabaseAdmin();
    const canonical = canonicalizeUrl(url);

    /* ---- มีเคสของ URL นี้อยู่แล้วหรือไม่ — ปิด lead ไปเลย ไม่ต้องเปลืองโควตา AI ---- */
    const { data: existing } = await db
      .from('incidents')
      .select('id, seq, status')
      .or(`url.eq.${url},url.eq.${canonical}`)
      .limit(1)
      .maybeSingle();

    if (existing) {
      await linkArticleToUrl(db, articleId, url, canonical);
      await db
        .from('articles')
        .update({
          screen_status: 'extracted',
          screen_reason: `ซ้ำกับเคส #${existing.seq} ที่มีอยู่แล้ว`,
          processed_at: new Date().toISOString(),
        })
        .eq('id', articleId);

      return res.status(200).json({
        success: true,
        duplicate: true,
        existing,
        message: `URL นี้มีอยู่ในระบบแล้วเป็นเคส #${existing.seq} (สถานะ ${existing.status}) จึงไม่บันทึกซ้ำ`,
      });
    }

    /* ---- เข้าคิวให้ pipeline สกัดต่อ ---- */
    // attempts: 0 เพราะ lead ที่เคยพยายามสกัดแล้วล้มเหลว (เช่นตอนยังไม่มี URL)
    // ต้องได้โอกาสใหม่ ไม่งั้นจะติดเพดาน attempts<3 ของ stage C แล้วค้างถาวร
    const queuedId = await linkArticleToUrl(db, articleId, url, canonical, {
      screen_status: 'keyword_pass',
      screen_reason: 'เจ้าหน้าที่ยืนยัน URL แล้ว รอสกัด',
      attempts: 0,
      processed_at: null,
    });

    res.status(200).json({
      success: true,
      duplicate: false,
      articleId: queuedId,
      // แถวถูกเปลี่ยนตัวเพราะชน url_key กับข่าวที่มาทางฟีดตรง
      mergedInto: queuedId !== articleId ? queuedId : null,
      message: 'บันทึกลิงก์แล้ว กำลังสกัดข้อมูล',
    });
  } catch (err) {
    fail(res, err);
  }
}
