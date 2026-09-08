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
 * `url` เป็นตัวเลือก — ถ้าไม่ส่งมา เซิร์ฟเวอร์จะถอดลิงก์ Google News ของ lead เอง
 * (ดู `_lib/gnews.ts`) เจ้าหน้าที่จึงกดยืนยันได้เลยโดยไม่ต้องเปิดข่าวไปคัดลอก URL
 * การถอดพังได้เพราะพึ่ง endpoint ภายในของ Google จึงคืน needsManualUrl ให้หน้าจอถอยไปทางวางเอง
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from '../_lib/auth';
import { resolveGoogleNewsUrl } from '../_lib/gnews';
import { canonicalizeUrl } from '../_lib/http';
import { linkArticleToUrl } from '../_lib/leads';
import { fail, methodNotAllowed } from '../_lib/respond';
import { supabaseAdmin } from '../_lib/supabaseAdmin';

// 60 วินาที ไม่ใช่ 30 — ค่านี้ในไฟล์ชนะค่าใน vercel.json เสมอ
// (@vercel/node ส่ง staticConfig.maxDuration เข้า Lambda โดยตรง)
// เดิมตั้ง 30 ไว้ตอนที่ endpoint นี้ยังไม่ต้องออกไปคุยกับ Google ตอนนี้ต้องเผื่อให้พอ
export const config = { maxDuration: 60 };

/**
 * เส้นตายรวมของขั้นตอนถอดลิงก์ ครอบทุกอย่างรวมถึงเวลารอคิวจำกัดอัตรา
 * ปกติถอดเสร็จใน ~350 ms ถ้าเกิน 10 วินาทีแปลว่าผิดปกติแล้ว
 * ถอยไปให้เจ้าหน้าที่วาง URL เองเร็วกว่าปล่อยให้คำขอตายคาแพลตฟอร์ม
 */
const RESOLVE_DEADLINE_MS = 10000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    await requireUser(req, 'editor');

    const { url: givenUrl, articleId } = (req.body ?? {}) as Record<string, string>;

    if (!articleId) {
      return res.status(400).json({ error: 'ไม่ได้ระบุรายการที่จะแนบ URL' });
    }

    const db = supabaseAdmin();
    let url = (givenUrl ?? '').trim();
    /** true เมื่อ URL มาจากการถอดอัตโนมัติ ไม่ใช่เจ้าหน้าที่วางมา */
    let autoResolved = false;

    /* ---- ไม่ได้ส่ง URL มา = ให้เซิร์ฟเวอร์ถอดจากลิงก์ Google News ของ lead เอง ---- */
    if (!url) {
      const { data: lead } = await db
        .from('articles')
        .select('gnews_link')
        .eq('id', articleId)
        .maybeSingle();

      if (!lead?.gnews_link) {
        return res.status(422).json({
          error: 'รายการนี้ไม่มีลิงก์ Google News ให้ถอด — กรุณาเปิดข่าวแล้ววาง URL เอง',
          needsManualUrl: true,
        });
      }

      // ถอดอัตโนมัติพังได้เสมอเพราะพึ่ง endpoint ภายในของ Google
      // ห้ามให้พังแบบ 500 เด็ดขาด — ต้องกลายเป็นทางถอยให้คนวาง URL เองทุกกรณี
      //
      // เส้นตายครอบทั้งขั้นตอน ไม่ใช่แค่ต่อคำขอ: timeout ข้างในครอบเฉพาะตัว fetch
      // แต่การรอคิวจำกัดอัตราต่อโดเมนใน http.ts เกิด "ก่อน" AbortController จึงไม่ถูกนับ
      // วัดแล้วคำขอที่ 20 บนโดเมนเดียวกันรอถึง 6.6 วินาทีก่อนเริ่มยิงด้วยซ้ำ
      // ถ้าไม่มีเส้นตายตรงนี้ คำขอจะเลยเพดานเวลาของ Vercel แล้วกลายเป็น 500 เปล่าที่อ่านไม่รู้เรื่อง
      const resolved = await Promise.race([
        resolveGoogleNewsUrl(lead.gnews_link).catch((err) => ({
          url: null as string | null,
          error: `เรียกตัวถอดลิงก์ไม่สำเร็จ: ${String((err as Error)?.message ?? err).slice(0, 200)}`,
        })),
        new Promise<{ url: string | null; error: string }>((resolve) =>
          setTimeout(
            () => resolve({ url: null, error: `ถอดลิงก์เกินเวลาที่กำหนด (${RESOLVE_DEADLINE_MS}ms)` }),
            RESOLVE_DEADLINE_MS
          )
        ),
      ]);

      if (!resolved.url) {
        // log ไว้ให้เห็นใน Vercel logs — ไม่งั้นเวลามันพังจะไล่หาสาเหตุไม่ได้เลย
        console.warn('[attach] ถอดลิงก์ไม่สำเร็จ', { articleId, reason: resolved.error });
        return res.status(422).json({
          error: `ถอดลิงก์อัตโนมัติไม่สำเร็จ (${resolved.error}) — กรุณาเปิดข่าวแล้ววาง URL เอง`,
          needsManualUrl: true,
        });
      }
      url = resolved.url;
      autoResolved = true;
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
