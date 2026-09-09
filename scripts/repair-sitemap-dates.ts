/**
 * ซ่อมข้อมูลที่ AI สกัดปีเกิดเหตุผิด เพราะไม่มีวันเผยแพร่ให้อ้างอิง
 *
 * ที่มาของปัญหา:
 * ข่าวจาก sitemap (ช่อง 7HD, Thai PBS) เคยถูกบันทึกด้วย `published_at: null` ตายตัว
 * ตอนสกัดด้วย AI จึงไม่มีตัวอ้างอิงปี โมเดลเลยเดาปีเอง แล้วผิดถึง 68% ของเคสจากแหล่งนี้
 * (เช่นข่าวเดือน ก.ย. 2569 ถูกสกัดออกมาเป็นปี 2567)
 *
 * โค้ดฝั่ง ingest แก้แล้ว sitemap ส่งวันที่มาด้วย แต่ข้อมูลที่ค้างอยู่ต้องซ่อมย้อนหลัง
 *
 * สคริปต์ทำ 2 อย่าง:
 *   1. เติม `published_at` ให้แถว articles ที่จับคู่กับ sitemap ปัจจุบันได้
 *   2. เคสที่วันเกิดเหตุผิด → ลบ incident แล้วตั้งบทความกลับเป็น 'new'
 *      ให้ pipeline รอบถัดไปสกัดใหม่ด้วยโค้ดที่แก้แล้ว (ไม่เดาวันเอง)
 *
 * ค่าเริ่มต้นคือ **ดูอย่างเดียว ไม่แก้** ต้องใส่ --yes ถึงจะแก้จริง
 *
 *   npm run repair:dates          ดูว่าจะซ่อมอะไรบ้าง
 *   npm run repair:dates -- --yes ซ่อมจริง หลังสำรองไฟล์แล้ว
 */
import './_env';
import { writeFileSync } from 'node:fs';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { MIN_INCIDENT_DATE } from '../api/_lib/env.js';
import { fetchSitemap } from '../api/_lib/sitemap.js';

/** PostgREST คืนได้สูงสุด 1000 แถวต่อครั้ง ต้องไล่ทีละหน้าเอง */
const PAGE = 1000;

/** ต้องตรงกับ sources.feed_url ของแหล่งชนิด sitemap ในฐานข้อมูล */
const SITEMAPS: { name: string; url: string; pattern: string | null }[] = [
  { name: 'ช่อง 7HD', url: 'https://news.ch7.com/sitemap.xml', pattern: '/detail/' },
  { name: 'Thai PBS', url: 'https://www.thaipbs.or.th/sitemap/sitemap_news.xml', pattern: null },
];

async function fetchAll<T>(db: SupabaseClient, table: string, columns: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select(columns).range(from, from + PAGE - 1);
    if (error) throw new Error(`อ่าน ${table} ไม่สำเร็จ: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/** ตัด / ท้าย URL ให้เทียบกันได้ — sitemap กับฐานข้อมูลเขียนไม่เหมือนกัน */
const key = (u: string | null | undefined) => (u ?? '').trim().replace(/\/+$/, '');

async function main() {
  const confirmed = process.argv.includes('--yes');
  const minDate = MIN_INCIDENT_DATE();

  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  console.log(`\nเกณฑ์วันเกิดเหตุ: ตั้งแต่ ${minDate} เป็นต้นไป`);
  console.log(confirmed ? 'โหมด: แก้จริง' : 'โหมด: ดูอย่างเดียว (ใส่ --yes เพื่อแก้จริง)');

  /* ---- 1. ดึงวันที่จาก sitemap ปัจจุบัน ---- */
  const dateOf = new Map<string, string>();
  for (const sm of SITEMAPS) {
    const r = await fetchSitemap(sm.url, sm.pattern);
    if (!r.ok) {
      console.error(`  ✕ ${sm.name}: ${r.error}`);
      continue;
    }
    let withDate = 0;
    for (const e of r.entries) {
      if (!e.publishedAt) continue;
      dateOf.set(key(e.url), e.publishedAt);
      withDate++;
    }
    console.log(`  ${sm.name}: ได้วันที่ ${withDate}/${r.entries.length} รายการ`);
  }
  if (dateOf.size === 0) {
    console.error('\n✕ ไม่ได้วันที่จาก sitemap เลย — หยุดก่อน ไม่แตะข้อมูล');
    process.exit(1);
  }

  /* ---- 2. หาสิ่งที่ต้องซ่อม ---- */
  type Art = { id: string; url: string | null; published_at: string | null };
  type Inc = { id: string; seq: number; status: string; incident_date: string | null; url: string | null; news_title: string | null; source_article_id: string | null };

  const articles = await fetchAll<Art>(db, 'articles', 'id,url,published_at');
  const incidents = await fetchAll<Inc>(db, 'incidents', 'id,seq,status,incident_date,url,news_title,source_article_id');
  console.log(`\nอ่านข้อมูลได้ articles ${articles.length} · incidents ${incidents.length}`);

  // ก) บทความที่ไม่มีวันเผยแพร่ แต่ sitemap รู้วัน
  const fillDates = articles
    .filter((a) => !a.published_at && dateOf.has(key(a.url)))
    .map((a) => ({ id: a.id, url: a.url!, published_at: dateOf.get(key(a.url))! }));

  // ข) เคสที่วันเกิดเหตุอยู่นอกช่วง หรือไม่มีวันเลย — ต้องสกัดใหม่
  const broken = incidents.filter((r) => !r.incident_date || r.incident_date < minDate);
  const canRedo = broken.filter((r) => r.source_article_id && dateOf.has(key(r.url)));
  const cannot = broken.filter((r) => !r.source_article_id || !dateOf.has(key(r.url)));

  console.log(`\n┌─ เติมวันเผยแพร่ให้ข่าวดิบ ───────────`);
  console.log(`│  เติมได้  ${fillDates.length} รายการ`);
  console.log(`└─────────────────────────────────────`);

  console.log(`\n┌─ เคสที่วันเกิดเหตุผิด ───────────────`);
  console.log(`│  พบทั้งหมด  ${broken.length}`);
  console.log(`│  สกัดใหม่ได้ ${canRedo.length}  (จับคู่กับ sitemap ได้)`);
  console.log(`│  ทำไม่ได้    ${cannot.length}  (หลุดจาก sitemap แล้ว — ให้เจ้าหน้าที่ตัดสินเอง)`);
  console.log(`└─────────────────────────────────────`);

  for (const r of canRedo.slice(0, 6)) {
    console.log(`  #${r.seq}  AI ว่า ${r.incident_date ?? 'ไม่มีวัน'}  →  sitemap ว่า ${dateOf.get(key(r.url))!.slice(0, 10)}  ${(r.news_title ?? '').slice(0, 34)}`);
  }
  if (cannot.length) {
    console.log(`\n  เคสที่ต้องจัดการเอง:`);
    for (const r of cannot) {
      console.log(`    #${r.seq}  ${r.incident_date ?? 'ไม่มีวัน'}  [${r.status}]  ${(r.news_title ?? '').slice(0, 40)}`);
    }
  }

  if (fillDates.length === 0 && canRedo.length === 0) {
    console.log('\n✓ ไม่มีอะไรต้องซ่อม');
    return;
  }
  if (!confirmed) {
    console.log(`\nยังไม่ได้แก้อะไร — ใส่ --yes เพื่อซ่อมจริง (จะสำรองไฟล์ให้ก่อน)`);
    return;
  }

  /* ---- 3. สำรองก่อนแก้ ---- */
  const backup = 'backup-repair-sitemap-dates.json';
  writeFileSync(
    backup,
    JSON.stringify({ minDate, filledDates: fillDates, deletedIncidents: canRedo, skipped: cannot }, null, 2),
    'utf8'
  );
  console.log(`\n✓ สำรองไว้ที่ ${backup}`);

  /* ---- 4. เติมวันเผยแพร่ ---- */
  let filled = 0;
  for (const a of fillDates) {
    const { error } = await db.from('articles').update({ published_at: a.published_at }).eq('id', a.id);
    if (error) throw new Error(`เติมวันให้ ${a.id} ไม่สำเร็จ: ${error.message}`);
    filled++;
    if (filled % 100 === 0) process.stdout.write(`\r  เติมวันเผยแพร่แล้ว ${filled}/${fillDates.length}`);
  }
  console.log(`\r  ✓ เติมวันเผยแพร่แล้ว ${filled} รายการ${' '.repeat(20)}`);

  /* ---- 5. ลบเคสที่ผิด แล้วตั้งบทความให้สกัดใหม่ ----
   *
   * service_role ลบ incidents ไม่ได้โดยตั้งใจ (ดู 0008_sitemap_sources.sql)
   * เพื่อบังคับให้การลบข้อมูลสถิติผ่านสิทธิ์ผู้ใช้ที่ตรวจสอบย้อนหลังได้
   */
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!anonKey) {
    console.error('\n✕ ต้องมี VITE_SUPABASE_ANON_KEY ใน .env.local เพื่อลบ incidents');
    process.exit(1);
  }

  const password = `Repair-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const email = `repair-dates-${Date.now()}@example.com`;
  const { data: created, error: userErr } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userErr || !created.user) {
    console.error(`\n✕ สร้างผู้ใช้ชั่วคราวไม่สำเร็จ: ${userErr?.message}`);
    process.exit(1);
  }
  await db.from('profiles').upsert({ id: created.user.id, role: 'admin' }, { onConflict: 'id' });

  try {
    const anon = createClient(process.env.SUPABASE_URL!, anonKey, { auth: { persistSession: false } });
    const { data: session, error: signErr } = await anon.auth.signInWithPassword({ email, password });
    if (signErr || !session.session) throw new Error(`ล็อกอินผู้ใช้ชั่วคราวไม่สำเร็จ: ${signErr?.message}`);
    const asAdmin = createClient(process.env.SUPABASE_URL!, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${session.session.access_token}` } },
    });

    for (let i = 0; i < canRedo.length; i += 100) {
      const chunk = canRedo.slice(i, i + 100);
      const { error } = await asAdmin.from('incidents').delete().in('id', chunk.map((r) => r.id));
      if (error) throw new Error(`ลบ incidents ไม่สำเร็จ: ${error.message}`);
    }
    console.log(`  ✓ ลบเคสที่วันผิดแล้ว ${canRedo.length} รายการ`);

    // ตั้งบทความกลับให้ pipeline หยิบไปสกัดใหม่
    // attempts: 0 จำเป็น ไม่งั้นติดเพดาน attempts<3 ของ stage C แล้วค้างถาวร
    for (let i = 0; i < canRedo.length; i += 100) {
      const chunk = canRedo.slice(i, i + 100).map((r) => r.source_article_id!);
      const { error } = await db
        .from('articles')
        .update({ screen_status: 'new', screen_reason: 'ตั้งให้สกัดใหม่ เพราะวันเกิดเหตุเดิมผิด', processed_at: null, attempts: 0 })
        .in('id', chunk);
      if (error) throw new Error(`ตั้งบทความให้สกัดใหม่ไม่สำเร็จ: ${error.message}`);
    }
    console.log(`  ✓ ตั้งบทความ ${canRedo.length} รายการให้สกัดใหม่รอบถัดไป`);
  } finally {
    // ต้องลบผู้ใช้ชั่วคราวเสมอ แม้ระหว่างทางจะพัง ไม่งั้นเหลือบัญชี admin ค้างในระบบ
    await db.auth.admin.deleteUser(created.user.id);
  }

  console.log(`\n✓ ซ่อมเรียบร้อย — รอ cron รอบถัดไป หรือกด "ดึงข่าวเดี๋ยวนี้" เพื่อสกัดใหม่ทันที`);
  if (cannot.length) {
    console.log(`  เหลือ ${cannot.length} เคสที่ต้องจัดการเอง (ดูรายการด้านบน)`);
  }
}

void main();
