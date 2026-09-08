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
 *
 * endpoint นี้ **ไม่ต่อเน็ตออกนอกเลย** คุยกับฐานข้อมูลอย่างเดียว จึงเร็วและคาดเดาได้
 * การถอดลิงก์ Google News ย้ายไปอยู่ที่ `/api/leads/resolve` แยกต่างหาก
 * เพราะงานนั้นพังได้ (ช้า ถูกบล็อก ฟังก์ชันถูกฆ่า) และเคยลาก endpoint นี้ล้มไปด้วย
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from '../_lib/auth';
import { canonicalizeUrl } from '../_lib/http';
import { linkArticleToUrl } from '../_lib/leads';
import { fail, methodNotAllowed } from '../_lib/respond';
import { supabaseAdmin } from '../_lib/supabaseAdmin';

// ค่านี้ในไฟล์ชนะค่าใน vercel.json เสมอ (@vercel/node ส่ง staticConfig.maxDuration เข้า Lambda ตรงๆ)
// 30 วินาทีพอเหลือเฟือ เพราะ endpoint นี้คุยกับฐานข้อมูลอย่างเดียว ไม่ต่อเน็ตออกนอก
export const config = { maxDuration: 30 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    await requireUser(req, 'editor');

    const { url: givenUrl, articleId, action } = (req.body ?? {}) as Record<string, string>;

    if (!articleId) {
      return res.status(400).json({ error: 'ไม่ได้ระบุรายการที่จะแนบ URL' });
    }

    const db = supabaseAdmin();

    /* ---- ถอดลิงก์ Google News (อ่านอย่างเดียว ไม่เขียนอะไร) ----
     *
     * รวมมาไว้ใน endpoint นี้แทนที่จะแยกไฟล์ เพราะ endpoint แยกที่สร้างไว้ก่อนหน้า
     * ตายตั้งแต่โหลดโมดูลบนเซิร์ฟเวอร์จริง (พังตั้งแต่ขั้นยืนยันตัวตน ทั้งที่ยังไม่แตะเน็ต)
     * ตัวแปรเดียวที่ต่างคือการ import ตัวถอดลิงก์แบบปกติที่หัวไฟล์
     *
     * ตรงนี้จึงใช้ dynamic import แทน: ถ้าโมดูลโหลดไม่ได้ มันจะ throw เข้า try/catch
     * แล้วกลายเป็น JSON ที่อ่านรู้เรื่อง ไม่ใช่ 500 เปล่าที่แพลตฟอร์มโยนมา
     * และ endpoint นี้ยังบันทึกข้อมูลได้ตามปกติแม้ตัวถอดลิงก์จะพังสนิท
     */
    if (action === 'resolve') {
      const { data: lead, error: readError } = await db
        .from('articles')
        .select('gnews_link, url')
        .eq('id', articleId)
        .maybeSingle();

      if (readError) {
        return res.status(200).json({ url: null, reason: `อ่านรายการไม่สำเร็จ: ${readError.message}` });
      }
      // เคยยืนยันไปแล้ว ใช้ของเดิม ไม่ต้องไปกวน Google ซ้ำ
      if (lead?.url) return res.status(200).json({ url: lead.url, cached: true });
      if (!lead?.gnews_link) {
        return res.status(200).json({ url: null, reason: 'รายการนี้ไม่มีลิงก์ Google News ให้ถอด' });
      }

      try {
        const { resolveGoogleNewsUrl } = await import('../_lib/gnews');
        const resolved = await Promise.race([
          resolveGoogleNewsUrl(lead.gnews_link),
          new Promise<{ url: string | null; error: string }>((done) =>
            setTimeout(() => done({ url: null, error: 'เกินเวลาที่กำหนด (12000ms)' }), 12000)
          ),
        ]);
        if (!resolved.url) console.warn('[attach] ถอดลิงก์ไม่สำเร็จ', { articleId, reason: resolved.error });
        return res.status(200).json({ url: resolved.url ?? null, reason: resolved.error ?? null });
      } catch (err: any) {
        // รวมถึงกรณีโหลดโมดูลไม่ได้ — ต้องรายงานเป็นข้อความ ไม่ใช่ปล่อยให้ฟังก์ชันตาย
        const reason = `ตัวถอดลิงก์ใช้งานไม่ได้: ${String(err?.message ?? err).slice(0, 300)}`;
        console.warn('[attach] ', reason);
        return res.status(200).json({ url: null, reason });
      }
    }
    let url = (givenUrl ?? '').trim();
    /** true เมื่อ URL มาจากการถอดอัตโนมัติ ไม่ใช่เจ้าหน้าที่วางมา */
    let autoResolved = false;

    if (!url) {
      // ต้องส่ง url มาเสมอ — หน้าจอเรียก action:'resolve' มาก่อนเพื่อให้ได้ url
      // แยกสองขั้นเพราะการคุยกับ Google พังได้ ห้ามให้มันลากขั้นบันทึกข้อมูลล้มไปด้วย
      return res.status(422).json({
        error: 'ไม่ได้ส่ง URL มา — ต้องถอดลิงก์ก่อน หรือให้เจ้าหน้าที่วาง URL เอง',
        needsManualUrl: true,
      });
    }

    if (!/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'กรุณาระบุ URL ข่าวที่ขึ้นต้นด้วย http:// หรือ https://' });
    }
    if (/^https?:\/\/news\.google\.com\//i.test(url)) {
      return res.status(400).json({
        error:
          'ลิงก์ Google News ใช้ดึงเนื้อข่าวไม่ได้ (Google เข้ารหัสลิงก์ไว้) — กรุณาเปิดลิงก์แล้วคัดลอก URL ของสำนักข่าวต้นทางมาแทน',
      });
    }

    const canonical = canonicalizeUrl(url);

    /* ---- มีเคสของ URL นี้อยู่แล้วหรือไม่ — ปิด lead ไปเลย ไม่ต้องเปลืองโควตา AI ---- */
    //
    // ใช้ .in() ไม่ใช่ .or() — .or() ต่อสตริงตัวกรองเอง ถ้า URL มีจุลภาคหรือวงเล็บ
    // (เจอบ่อยใน URL ที่ถอดมาจาก Google News ซึ่งมักพก query string มาด้วย)
    // ตัวกรองจะเพี้ยนจนหาไม่เจอ แล้วบันทึกซ้ำเงียบๆ — .in() ใส่เครื่องหมายคำพูดให้เอง
    const { data: existing, error: lookupError } = await db
      .from('incidents')
      .select('id, seq, status')
      .in('url', [url, canonical])
      .limit(1)
      .maybeSingle();

    // เดิมกลืน error ทิ้ง ทำให้ด่านกันซ้ำพังโดยไม่มีใครรู้ — อย่างน้อยต้องเห็นใน log
    if (lookupError) console.warn('[attach] ตรวจ URL ซ้ำไม่สำเร็จ', lookupError.message);

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
        url,
        autoResolved,
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
      // URL ที่บันทึกจริง — หน้าจอต้องใช้ต่อเพื่อสั่งสกัด และเพื่อให้เจ้าหน้าที่เห็นว่าถอดได้อะไรมา
      url,
      autoResolved,
      // แถวถูกเปลี่ยนตัวเพราะชน url_key กับข่าวที่มาทางฟีดตรง
      mergedInto: queuedId !== articleId ? queuedId : null,
      message: 'บันทึกลิงก์แล้ว กำลังสกัดข้อมูล',
    });
  } catch (err) {
    fail(res, err);
  }
}
