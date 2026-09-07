/**
 * งานที่ทำกับแถว `articles` ที่เป็น lead รอเจ้าหน้าที่ยืนยันลิงก์
 *
 * ใช้ร่วมกันระหว่าง:
 *  - `api/leads/attach.ts`   แนบ URL อย่างเดียว ตอบเร็ว ไม่แตะ AI
 *  - `api/ai/extract-url.ts` แนบ URL แล้วสกัดต่อในคำขอเดียว
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * เติม URL จริงให้แถว lead
 *
 * `articles.url_key` เป็น `not null unique` — ถ้าข่าวเดียวกันเข้ามาทางฟีดสำนักข่าวอยู่ก่อนแล้ว
 * การเขียน url_key ทับจะชน unique constraint เดิมโค้ดไม่รับ error มาตรวจเลย จึงล้มเหลวเงียบ
 * และแถวค้างที่ needs_url ตลอดไป
 *
 * คืน id ของแถวที่ควรผูกกับ incident — ถ้าชนกับแถวที่มีอยู่ ให้ใช้แถวนั้นแทน
 * แล้วปิดแถว lead ทิ้งเป็น keyword_reject เพราะเป็นข่าวเดียวกัน
 */
export async function linkArticleToUrl(
  db: SupabaseClient,
  articleId: string,
  url: string,
  canonical: string,
  extra: Record<string, unknown> = {}
): Promise<string> {
  const { error } = await db
    .from('articles')
    .update({ url, url_key: canonical, full_text_source: 'manual', ...extra })
    .eq('id', articleId);

  if (!error) return articleId;

  // 23505 = unique_violation
  const isConflict = (error as { code?: string }).code === '23505' || /duplicate key/i.test(error.message);
  if (!isConflict) throw new Error(`ผูก URL กับรายการไม่สำเร็จ: ${error.message}`);

  const { data: owner } = await db
    .from('articles')
    .select('id')
    .eq('url_key', canonical)
    .neq('id', articleId)
    .limit(1)
    .maybeSingle();

  if (!owner) throw new Error(`ผูก URL ไม่สำเร็จและหาแถวที่ถือ URL นี้ไม่พบ: ${error.message}`);

  await db
    .from('articles')
    .update({
      screen_status: 'keyword_reject',
      screen_reason: 'ข่าวเดียวกันมีอยู่แล้วจากฟีดสำนักข่าวโดยตรง',
      processed_at: new Date().toISOString(),
    })
    .eq('id', articleId);

  return owner.id;
}

/**
 * เทียบว่าพาดหัวสองอันน่าจะเป็นข่าวเดียวกันไหม
 *
 * ภาษาไทยไม่มีช่องว่างระหว่างคำ การตัดคำจริงต้องใช้ dictionary
 * ที่นี่จึงเทียบเป็น "ก้อนคำ" ที่คั่นด้วยช่องว่างและเครื่องหมายวรรคตอนแทน
 *
 * **ห้ามใช้ \p{L} มาคัดอักขระ** — สระและวรรณยุกต์ไทยเป็น \p{M} (nonspacing mark)
 * ไม่ใช่ \p{L} การกรองด้วย \p{L} จะทำให้ "เมาแล้วขับ" แตกเป็นเศษอย่าง "เมาแล"/"วขบ"
 * แล้วเศษพวกนี้ไปตรงกันข้ามข่าวที่ไม่เกี่ยวกันเลย (ทดสอบแล้วจับคู่ผิด 14 จาก 14 คู่)
 */
export function titlesLookAlike(a: string, b: string): boolean {
  const tokens = (t: string) =>
    new Set(
      t
        .replace(/[“”"'‘’\-–—|()[\]!?]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 4)
    );
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  let shared = 0;
  for (const w of ta) if (tb.has(w)) shared++;
  return shared / Math.min(ta.size, tb.size) >= 0.5;
}

/** โฮสต์ของ URL แบบตัด www. ออก */
export function hostOf(rawUrl: string | null | undefined): string {
  if (!rawUrl) return '';
  try {
    return new URL(rawUrl).host.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * หา lead ที่ค้างอยู่ซึ่งน่าจะเป็นข่าวเดียวกับ URL ที่เพิ่งได้มา
 *
 * ใช้ตอนเจ้าหน้าที่กดปุ่มจับข่าวจากหน้าเว็บสำนักข่าวโดยตรง — ตอนนั้นเราไม่รู้ว่าตรงกับ
 * lead ไหน จึงต้องเดาจากโดเมนของสำนักข่าว + ความคล้ายของพาดหัว
 * ถ้าเดาไม่ได้ให้คืน null ไปเลย ดีกว่าปิด lead ผิดตัวแล้วข่าวจริงหลุดหาย
 */
export async function findMatchingLead(
  db: SupabaseClient,
  url: string,
  title: string | null
): Promise<{ id: string; title: string } | null> {
  if (!title || title.trim().length < 8) return null;

  const host = hostOf(url);
  if (!host) return null;

  const { data: leads } = await db
    .from('articles')
    .select('id, title, news_agency')
    .eq('screen_status', 'needs_url')
    .limit(500);

  if (!leads?.length) return null;

  // ชื่อสำนักที่ Google News ส่งมาไม่คงที่ ("Thairath" / "Thairath.co.th" / "ไทยรัฐออนไลน์")
  // จึงเทียบแบบหลวม: ชื่อสำนักมีส่วนของโดเมนอยู่ หรือกลับกัน
  const brand = host.split('.')[0];
  const sameOutlet = (agency: string | null) => {
    const a = (agency ?? '').toLowerCase();
    return a.includes(host) || a.includes(brand) || host.includes(a.replace(/\s+/g, ''));
  };

  const candidates = leads.filter((l) => sameOutlet(l.news_agency));
  const match = (candidates.length ? candidates : leads).find((l) => titlesLookAlike(l.title, title));

  return match ? { id: match.id, title: match.title } : null;
}
