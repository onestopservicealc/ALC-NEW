/**
 * สกัด 49 ฟิลด์จากเนื้อข่าวที่ผู้ใช้วางมาเอง
 *
 * แก้บั๊กเดิม: server.ts รับเฉพาะ newsText แล้วทิ้ง url/newsAgency ที่ AiNewsParser ส่งมา
 * ทำให้โมเดลเดา URL และสำนักข่าวเอง ทั้งที่เป็นฟิลด์ Not Null ตามสเปก
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from '../_lib/auth';
import { screenAndExtract } from '../_lib/gemini';
import { normalizeAlcoholRole } from '../_lib/persistIncident';
import { fail, methodNotAllowed } from '../_lib/respond';
import { normalizeIncident, deriveAlcoholInvolved } from '../../src/lib/normalize';

export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    // endpoint นี้เรียก Gemini ด้วยคีย์ของโปรเจกต์ — ถ้าไม่ตรวจสิทธิ์ ใครก็เผาโควตาได้
    // (โควตาฟรีมีแค่ 20 ครั้ง/วัน/โมเดล) endpoint อื่นใน api/ ตรวจกันหมดแล้ว
    await requireUser(req, 'editor');

    const { newsText, url, newsAgency, newsTitle, publishedAt } = (req.body ?? {}) as Record<
      string,
      string
    >;

    if (!newsText || typeof newsText !== 'string' || newsText.trim().length < 50) {
      return res.status(400).json({ error: 'กรุณาระบุเนื้อหาข่าวอย่างน้อย 50 ตัวอักษร' });
    }

    const result = await screenAndExtract(newsText, {
      url: url || undefined,
      newsAgency: newsAgency || undefined,
      newsTitle: newsTitle || undefined,
      publishedAt: publishedAt || undefined,
    });

    if (!result.incident) {
      return res.status(200).json({
        success: true,
        screening: result.screening,
        data: null,
        message: result.screening.reason || 'ข่าวนี้ไม่เข้าเกณฑ์ความรุนแรง/อุบัติเหตุจากแอลกอฮอล์',
      });
    }

    const { incident, report } = normalizeIncident(result.incident, {
      url: url || undefined,
      newsAgency: newsAgency || undefined,
      newsTitle: newsTitle || undefined,
      publishedAt: publishedAt || undefined,
    });

    res.status(200).json({
      success: true,
      screening: result.screening,
      data: {
        ...incident,
        alcohol_involved: deriveAlcoholInvolved(incident) || result.screening.is_alcohol_related,
        alcohol_role: normalizeAlcoholRole(result.screening.alcohol_role),
      },
      normalization: report,
      model: result.model,
    });
  } catch (err) {
    fail(res, err);
  }
}
