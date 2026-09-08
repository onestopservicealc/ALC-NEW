/**
 * รับ URL ข่าว → ดึงเนื้อหาหน้าเว็บ → คัดกรอง + สกัด 49 ฟิลด์ → บันทึกเข้าคิวตรวจสอบ
 *
 * ใช้ 2 ทาง:
 *  1. เจ้าหน้าที่วางลิงก์ข่าวเองในหน้า AI สกัดข่าว
 *  2. ยืนยันลิงก์ให้ lead ที่มาจาก Google News (ซึ่งถอด URL ต้นทางไม่ได้)
 *
 * เดิมไฟล์นี้สกัดสำเร็จแล้วแต่ไม่เคยบันทึกอะไรลงฐานข้อมูล — return JSON กลับไปเฉยๆ
 * ผู้ใช้จึงกดแล้วไม่มีเคสเข้าคิว และแถว articles ค้างที่ needs_url ตลอดไป
 * ตอนนี้ใช้ persistIncident() ตัวเดียวกับ pipeline อัตโนมัติ
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchArticleText } from '../_lib/article.js';
import { requireUser } from '../_lib/auth.js';
import { screenAndExtract } from '../_lib/gemini.js';
import { canonicalizeUrl } from '../_lib/http.js';
import { findMatchingLead, linkArticleToUrl } from '../_lib/leads.js';
import { normalizeAlcoholRole, persistIncident } from '../_lib/persistIncident.js';
import { fail, methodNotAllowed } from '../_lib/respond.js';
import { supabaseAdmin } from '../_lib/supabaseAdmin.js';
import { deriveAlcoholInvolved, normalizeIncident } from '../../src/lib/normalize.js';

export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    const user = await requireUser(req, 'editor');

    const {
      url,
      articleId: articleIdRaw,
      newsAgency,
      newsText,
      newsTitle: pastedTitle,
      matchLead,
    } = (req.body ?? {}) as Record<string, any>;
    let articleId: string | null = typeof articleIdRaw === 'string' ? articleIdRaw : null;
    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'กรุณาระบุ URL ข่าวที่ขึ้นต้นด้วย http:// หรือ https://' });
    }
    if (/^https?:\/\/news\.google\.com\//i.test(url)) {
      return res.status(400).json({
        error:
          'ลิงก์ Google News ใช้ดึงเนื้อข่าวไม่ได้ (Google เข้ารหัสลิงก์ไว้) — กรุณาเปิดลิงก์แล้วคัดลอก URL ของสำนักข่าวต้นทางมาแทน',
      });
    }

    const db = supabaseAdmin();
    const canonical = canonicalizeUrl(url);

    /* ---- 0. มาจากปุ่มจับข่าว: ยังไม่รู้ว่าตรงกับ lead ไหน ต้องเดาเอง ---- */
    // ถ้าไม่จับคู่ lead ที่ค้างอยู่จะถูกทิ้งไว้ในคิวให้คนมาทำซ้ำทั้งที่ข่าวเข้าระบบแล้ว
    // เดาไม่ได้ก็ปล่อยไว้ ดีกว่าปิด lead ผิดตัวแล้วข่าวจริงหลุดหาย
    if (!articleId && matchLead) {
      const lead = await findMatchingLead(db, url, pastedTitle ?? null);
      if (lead) articleId = lead.id;
    }

    /* ---- 1. มีเคสของ URL นี้อยู่แล้วหรือไม่ (เช็คก่อนเปลืองค่า AI) ---- */
    const { data: existing } = await db
      .from('incidents')
      .select('id, seq, status, news_title')
      .or(`url.eq.${url},url.eq.${canonical}`)
      .limit(1)
      .maybeSingle();

    if (existing) {
      // ปิดงานฝั่ง articles ด้วย ไม่งั้นรายการจะค้างในแท็บ "ต้องยืนยันลิงก์" ตลอดไป
      if (articleId) {
        await linkArticleToUrl(db, articleId, url, canonical);
        await db
          .from('articles')
          .update({
            screen_status: 'extracted',
            screen_reason: `ซ้ำกับเคส #${existing.seq} ที่มีอยู่แล้ว`,
            processed_at: new Date().toISOString(),
          })
          .eq('id', articleId);
      }
      return res.status(200).json({
        success: true,
        data: null,
        existing,
        duplicate: true,
        message: `URL นี้มีอยู่ในระบบแล้วเป็นเคส #${existing.seq} (สถานะ ${existing.status}) จึงไม่บันทึกซ้ำ`,
      });
    }

    /* ---- 2. ดึงเนื้อข่าว ---- */
    // ถ้าผู้ใช้วางเนื้อข่าวมาให้ ข้ามการ fetch ไปเลย
    // จำเป็นเพราะ 4 จาก 7 สำนักบล็อกการดึงหน้าบทความจากเซิร์ฟเวอร์ (403) ทั้งที่ยอมให้ดึง RSS
    // และไม่ได้เกิดจาก User-Agent — UA เบราว์เซอร์ก็ได้ 403 เท่ากัน
    const pasted = typeof newsText === 'string' ? newsText.trim() : '';
    const fetched = pasted
      ? {
          ok: true as const,
          // พาดหัวจากหน้าเว็บที่ผู้ใช้เปิดอยู่ ดีกว่าปล่อยให้ AI เดาเอง
          text: pasted,
          title: (typeof pastedTitle === 'string' ? pastedTitle.trim() : '') || null,
          error: undefined,
        }
      : await fetchArticleText(url);

    /**
     * ดึงไม่ได้ = ต้องให้คนวางเนื้อข่าวแทน
     *
     * ต้องคืนแถวกลับเข้าคิว "ต้องยืนยันลิงก์" ด้วย ไม่ใช่ปล่อยไว้ที่ keyword_pass —
     * ไม่งั้นถ้าผู้ใช้ปิดแท็บก่อนวางเนื้อข่าว แถวจะหลุดออกจากคิวของคน
     * แล้วไปจบที่ fetch_failed ซึ่งยังไม่มีหน้าจอให้จัดการ = ข่าวหายเงียบ
     *
     * URL ที่ผู้ใช้ยืนยันมาแล้วยังเก็บไว้ ครั้งหน้าจึงข้ามไปขอเนื้อข่าวได้เลย
     */
    const bounceBackToQueue = async (reason: string) => {
      if (!articleId) return;
      await linkArticleToUrl(db, articleId, url, canonical, {
        screen_status: 'needs_url',
        screen_reason: reason,
        processed_at: null,
      });
    };

    if (!fetched.ok) {
      await bounceBackToQueue(`ยืนยัน URL แล้วแต่ดึงหน้าเว็บไม่ได้ (${fetched.error}) — ต้องวางเนื้อข่าว`);
      return res.status(422).json({
        error: `ดึงเนื้อข่าวไม่สำเร็จ: ${fetched.error}`,
        // บอก UI ว่าให้เสนอทางเลือก "วางเนื้อข่าวแทน" — URL ที่ผู้ใช้ให้มายังใช้ได้
        canPasteText: true,
      });
    }
    if (fetched.text.length < 200) {
      if (!pasted) await bounceBackToQueue('ยืนยัน URL แล้วแต่เนื้อข่าวที่ดึงได้สั้นเกินไป — ต้องวางเนื้อข่าว');
      return res.status(422).json({
        error: `เนื้อข่าวสั้นเกินไป (${fetched.text.length} ตัวอักษร) สกัด 49 ฟิลด์ไม่ได้`,
        canPasteText: !pasted,
      });
    }

    /* ---- 3. คัดกรอง + สกัด ---- */
    const result = await screenAndExtract(fetched.text, {
      url,
      newsAgency: newsAgency || undefined,
      newsTitle: fetched.title ?? undefined,
    });

    const inScope =
      result.screening.is_alcohol_related && result.screening.is_violence_or_accident && result.incident;

    if (!inScope) {
      if (articleId) {
        await linkArticleToUrl(db, articleId, url, canonical);
        await db
          .from('articles')
          .update({
            screen_status: 'ai_reject',
            screen_reason: result.screening.reason || 'AI ตัดสินว่าไม่อยู่ในขอบเขต',
            ai_confidence: result.screening.confidence,
            processed_at: new Date().toISOString(),
          })
          .eq('id', articleId);
      }
      return res.status(200).json({
        success: true,
        screening: result.screening,
        data: null,
        message: result.screening.reason || 'ข่าวนี้ไม่เข้าเกณฑ์ความรุนแรง/อุบัติเหตุจากแอลกอฮอล์',
      });
    }

    const { incident, report } = normalizeIncident(result.incident!, {
      url,
      newsAgency: newsAgency || undefined,
      newsTitle: fetched.title ?? undefined,
    });

    /* ---- 4. ผูก URL เข้ากับแถว articles (ถ้ามาจาก lead) ---- */
    let linkedArticleId: string | null = null;
    if (articleId) {
      linkedArticleId = await linkArticleToUrl(db, articleId, url, canonical);
    }

    /* ---- 5. บันทึกเข้าคิวตรวจสอบ ---- */
    const persisted = await persistIncident({
      db,
      incident,
      screening: result.screening,
      rawIncident: result.incident,
      adjustedFields: report.adjusted,
      model: result.model,
      articleId: linkedArticleId,
      fallback: { url, newsAgency, newsTitle: fetched.title, summary: fetched.text.slice(0, 500) },
      createdBy: user.id,
    });

    if (!persisted.ok) {
      return res.status(500).json({ error: `บันทึกไม่สำเร็จ: ${persisted.error}` });
    }

    res.status(200).json({
      success: true,
      screening: result.screening,
      seq: persisted.seq,
      incidentId: persisted.incidentId,
      duplicateSeq: persisted.duplicateSeq,
      data: {
        ...incident,
        alcohol_involved: deriveAlcoholInvolved(incident) || result.screening.is_alcohol_related,
        alcohol_role: normalizeAlcoholRole(result.screening.alcohol_role),
      },
      normalization: report,
      model: result.model,
      articleText: fetched.text.slice(0, 6000),
    });
  } catch (err) {
    fail(res, err);
  }
}
