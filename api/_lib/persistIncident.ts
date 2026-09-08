/**
 * บันทึกผลสกัดเข้าคิวตรวจสอบ — ตรรกะกลางที่ทุกเส้นทางต้องใช้
 *
 * เดิมตรรกะนี้ฝังอยู่ใน ingest.extractOne() ที่เดียว ทำให้ api/ai/extract-url.ts
 * ซึ่งสกัดข้อมูลสำเร็จแล้วกลับไม่บันทึกอะไรเลย (return JSON เฉยๆ) ผู้ใช้กด
 * "ดึงและสกัด" แล้วไม่มีเคสเข้าคิว และรายการค้างที่ needs_url ตลอดไป
 *
 * ย้ายออกมาเป็นฟังก์ชันเดียวเพื่อไม่ให้เกิดชุดที่สองที่ต้องดูแลแยกกันอีก
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CrimeIncident } from '../../src/types/dataDictionary.js';
import { cleanText, deriveAlcoholInvolved } from '../../src/lib/normalize.js';
import type { ScreeningOutput } from './gemini.js';

/** ค่าที่อนุญาตของ alcohol_role — ต้องตรงกับ check constraint ใน 0001_init.sql */
const ALCOHOL_ROLES = ['ผู้ก่อเหตุดื่ม', 'เหยื่อดื่ม', 'ทั้งสองฝ่ายดื่ม', 'ไม่ชัดเจน'];

/**
 * ดัดค่าที่ AI ตอบมาให้ลงกับ vocabulary
 * ถ้าไม่ normalize ค่าดิบจาก AI จะชน check constraint แล้ว insert ล้มทั้งแถว
 */
export function normalizeAlcoholRole(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = cleanText(raw);
  return ALCOHOL_ROLES.includes(value) ? value : 'ไม่ชัดเจน';
}

export interface PersistArgs {
  db: SupabaseClient;
  /** ผ่าน normalizeIncident() มาแล้ว */
  incident: Omit<CrimeIncident, 'id'>;
  screening: ScreeningOutput;
  /** ผลดิบจาก AI ก่อน normalize — เก็บไว้ให้ผู้ตรวจเทียบได้ */
  rawIncident: Record<string, unknown> | null;
  adjustedFields: string[];
  model: string;
  /** ผูกกับแถว articles ถ้ามี — จะอัปเดตสถานะเป็น extracted และล้าง full_text */
  articleId?: string | null;
  /** ค่าสำรองสำหรับฟิลด์ Not Null เมื่อ AI สกัดไม่ได้ */
  fallback?: {
    url?: string | null;
    newsAgency?: string | null;
    newsTitle?: string | null;
    summary?: string | null;
  };
  createdBy?: string | null;
}

export interface PersistResult {
  ok: boolean;
  incidentId?: string;
  /** เลขลำดับที่ผู้ใช้เห็น — ใช้ในข้อความแจ้งผลให้ตรงกับสิ่งที่บันทึกจริง */
  seq?: number;
  duplicateOf?: string | null;
  duplicateSeq?: number | null;
  /** true เมื่อไม่มี url จึงบันทึกไม่ได้ ต้องให้คนมายืนยันลิงก์ */
  needsUrl?: boolean;
  error?: string;
}

export async function persistIncident(args: PersistArgs): Promise<PersistResult> {
  const { db, incident, screening, rawIncident, adjustedFields, model, articleId, fallback } = args;

  // ฟิลด์ Not Null ตามสเปก — เติมค่าสำรองไม่ให้ insert ล้มเพราะ AI สกัดไม่ครบ
  const url = incident.url || fallback?.url || '';
  const newsAgency = incident.news_agency || fallback?.newsAgency || 'ไม่ทราบสำนักข่าว';
  const newsTitle = incident.news_title || fallback?.newsTitle || '';
  const newsSummary =
    incident.news_summary || cleanText(fallback?.summary).slice(0, 500) || newsTitle;

  if (!url) return { ok: false, needsUrl: true, error: 'สกัดได้แต่ไม่มี URL ต้นทาง' };
  if (!newsTitle) return { ok: false, error: 'สกัดได้แต่ไม่มีพาดหัวข่าว' };

  // ตรวจข่าวซ้ำระดับเหตุการณ์ — ข่าวเดียวกันจากหลายสำนักตั้งพาดหัวต่างกันมาก
  // จึงต้องพึ่งวันที่ + จังหวัด + อายุ/ชื่อผู้ก่อเหตุ ตามที่ migration 0005 รองรับ
  let duplicateOf: string | null = null;
  let duplicateSeq: number | null = null;
  const { data: dupes } = await db.rpc('find_duplicate_incident', {
    p_date: incident.incident_date || null,
    p_province: incident.province || null,
    p_title: newsTitle,
    p_age: incident.perpetrator_age ?? null,
    p_perpetrator: incident.perpetrator_name || null,
  });
  if (Array.isArray(dupes) && dupes.length > 0) {
    duplicateOf = dupes[0].id ?? null;
    duplicateSeq = dupes[0].seq ?? null;
  }

  const { data: inserted, error: insertError } = await db
    .from('incidents')
    .insert({
      ...incident,
      url,
      news_agency: newsAgency,
      news_title: newsTitle,
      news_summary: newsSummary,
      // คอลัมน์เป็นชนิด date — สตริงว่างทำให้ insert ล้ม
      incident_date: incident.incident_date || null,
      status: 'pending',
      alcohol_involved: deriveAlcoholInvolved(incident) || screening.is_alcohol_related,
      alcohol_role: normalizeAlcoholRole(screening.alcohol_role),
      source_article_id: articleId ?? null,
      ai_model: model,
      ai_confidence: screening.confidence,
      ai_raw: rawIncident as never,
      ai_adjusted_fields: adjustedFields,
      duplicate_of: duplicateOf,
      created_by: args.createdBy ?? null,
    })
    .select('id, seq')
    .single();

  if (insertError || !inserted) {
    return { ok: false, error: insertError?.message ?? 'บันทึกไม่สำเร็จโดยไม่ทราบสาเหตุ' };
  }

  // ปิดงานฝั่ง articles — ถ้าไม่ทำ แถวจะค้างในคิวและถูกหยิบมาทำซ้ำ
  if (articleId) {
    await db
      .from('articles')
      .update({
        screen_status: 'extracted',
        screen_reason: screening.reason,
        ai_confidence: screening.confidence,
        processed_at: new Date().toISOString(),
        full_text: null, // สกัดเสร็จแล้วไม่เก็บเนื้อข่าวต้นฉบับต่อ
      })
      .eq('id', articleId);
  }

  return {
    ok: true,
    incidentId: inserted.id,
    seq: inserted.seq,
    duplicateOf,
    duplicateSeq,
  };
}
