/**
 * ล้างข้อมูลที่เก่ากว่าวันที่กำหนด ให้เหลือเฉพาะช่วงที่ต้องการใช้งานจริง
 *
 * ทำไมต้องมีสคริปต์แทนที่จะลบด้วย SQL ตรงๆ:
 *   1. ต้องกันข่าวดิบที่ยังถูกเคสซึ่งเก็บไว้อ้างอิงอยู่ — FK เป็น `on delete set null`
 *      ถ้าลบทิ้งเฉยๆ เคสที่เหลือจะขาดที่มา สืบกลับไปต้นทางไม่ได้อีกเลย
 *   2. ต้องสำรองสิ่งที่จะลบก่อน เพราะลบแล้วเอากลับไม่ได้
 *   3. ต้องนับให้ครบ — PostgREST จำกัดผลลัพธ์ที่ 1000 แถว การนับตรงๆ จึงได้ตัวเลขผิด
 *
 * ค่าเริ่มต้นคือ **ดูอย่างเดียว ไม่ลบ** ต้องใส่ --yes ถึงจะลบจริง
 *
 *   npm run data:cleanup                        ดูว่าจะลบอะไรบ้าง ไม่แตะข้อมูล
 *   npm run data:cleanup -- --from 2026-01-01   กำหนดวันตัดเอง (ค่าเริ่มต้นคือ 1 ม.ค. 2569)
 *   npm run data:cleanup -- --yes               ลบจริง หลังสำรองไฟล์แล้ว
 */
import './_env';
import { writeFileSync } from 'node:fs';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/** 1 มกราคม 2569 = 2026-01-01 — ข้อมูลก่อนหน้านี้ไม่ใช้แล้ว */
const DEFAULT_FROM = '2026-01-01';

/** PostgREST คืนได้สูงสุด 1000 แถวต่อครั้ง ต้องไล่ทีละหน้าเอง */
const PAGE = 1000;

function flag(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? '') : null;
}

/** ดึงข้อมูลทั้งตารางโดยไล่ทีละหน้า — ห้ามเชื่อผลครั้งเดียวเพราะถูกตัดที่ 1000 */
async function fetchAll<T>(
  db: SupabaseClient,
  table: string,
  columns: string,
  filter?: (q: any) => any
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db.from(table).select(columns).range(from, from + PAGE - 1);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`อ่าน ${table} ไม่สำเร็จ: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/** ลบทีละก้อน — ส่ง id เป็นพันตัวในคำขอเดียวทำให้ URL ยาวเกินจนเซิร์ฟเวอร์ปฏิเสธ */
async function deleteByIds(db: SupabaseClient, table: string, ids: string[]): Promise<number> {
  let done = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { error } = await db.from(table).delete().in('id', chunk);
    if (error) throw new Error(`ลบ ${table} ไม่สำเร็จ: ${error.message}`);
    done += chunk.length;
    process.stdout.write(`\r  ลบ ${table} แล้ว ${done}/${ids.length}`);
  }
  if (ids.length) process.stdout.write('\n');
  return done;
}

async function main() {
  const from = flag('from') || DEFAULT_FROM;
  const confirmed = process.argv.includes('--yes');

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    console.error(`✕ รูปแบบวันที่ไม่ถูกต้อง: ${from} (ต้องเป็น YYYY-MM-DD)`);
    process.exit(1);
  }

  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const be = Number(from.slice(0, 4)) + 543;
  console.log(`\nเก็บเฉพาะข้อมูลตั้งแต่ ${from} (${from.slice(8)} ${from.slice(5, 7)} ${be}) เป็นต้นไป`);
  console.log(confirmed ? 'โหมด: ลบจริง' : 'โหมด: ดูอย่างเดียว ไม่แตะข้อมูล (ใส่ --yes เพื่อลบจริง)');

  /* ---- อ่านข้อมูลทั้งหมดก่อน ---- */
  type Inc = { id: string; seq: number; status: string; incident_date: string | null; news_title: string | null; source_article_id: string | null };
  type Art = { id: string; published_at: string | null; screen_status: string; title: string | null };

  const incidents = await fetchAll<Inc>(db, 'incidents', 'id,seq,status,incident_date,news_title,source_article_id');
  const articles = await fetchAll<Art>(db, 'articles', 'id,published_at,screen_status,title');
  console.log(`\nอ่านข้อมูลได้ incidents ${incidents.length} · articles ${articles.length}`);

  /* ---- กู้วันเกิดเหตุจากข่าวต้นทางก่อน แล้วค่อยตัดสินว่าจะลบอะไร ----
   *
   * AI สกัดวันเกิดเหตุไม่ได้ในบางข่าว แต่ข่าวต้นทางมีวันเผยแพร่อยู่แล้ว
   * ใช้วันเผยแพร่แทนได้เพราะข่าวอาชญากรรมมักรายงานภายในไม่กี่วันหลังเกิดเหตุ
   * ถ้าไม่ทำขั้นนี้ เคสที่ยังใช้ได้จะถูกลบทิ้งเพราะ "ไม่มีวันที่" ทั้งที่กู้ได้
   */
  const artPublished = new Map(articles.map((a) => [a.id, a.published_at]));
  const recoverable: { id: string; seq: number; date: string }[] = [];
  for (const r of incidents) {
    if (r.incident_date) continue;
    const pub = r.source_article_id ? artPublished.get(r.source_article_id) : null;
    if (!pub) continue;
    const date = pub.slice(0, 10);
    recoverable.push({ id: r.id, seq: r.seq, date });
    r.incident_date = date; // ใช้ค่าที่กู้มาในการตัดสินใจด้านล่างทันที
  }

  /* ---- แยกว่าอะไรเก็บ อะไรลบ ---- */
  const outOfRange = (d: string | null) => !d || d.slice(0, 10) < from;

  const incKeep = incidents.filter((r) => !outOfRange(r.incident_date));
  const incDrop = incidents.filter((r) => outOfRange(r.incident_date));

  // ข่าวดิบที่เคสซึ่งเก็บไว้ยังอ้างอิงอยู่ ต้องเก็บด้วยเสมอไม่ว่าจะเก่าแค่ไหน
  // ไม่งั้นเคสที่เหลือจะขาดที่มา สืบกลับไปข่าวต้นทางไม่ได้
  const referenced = new Set(incKeep.map((r) => r.source_article_id).filter(Boolean) as string[]);

  const artDrop = articles.filter((a) => outOfRange(a.published_at) && !referenced.has(a.id));
  const artRescued = articles.filter((a) => outOfRange(a.published_at) && referenced.has(a.id));

  /* ---- รายงาน ---- */
  const noDate = (rows: { [k: string]: any }[], field: string) => rows.filter((r) => !r[field]).length;

  const rescuedInRange = recoverable.filter((r) => r.date >= from);
  console.log(`\n┌─ กู้วันเกิดเหตุจากข่าวต้นทาง ─────────`);
  console.log(`│  เติมได้  ${recoverable.length} เคส (อยู่ในช่วงที่เก็บ ${rescuedInRange.length})`);
  console.log(`└─────────────────────────────────────`);

  console.log(`\n┌─ incidents ─────────────────────────`);
  console.log(`│  เก็บไว้  ${incKeep.length}`);
  console.log(`│  ลบ      ${incDrop.length}  (เก่ากว่ากำหนด ${incDrop.length - noDate(incDrop, 'incident_date')} · ไม่มีวันเกิดเหตุ ${noDate(incDrop, 'incident_date')})`);
  const byStatus: Record<string, number> = {};
  for (const r of incDrop) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  console.log(`│  แยกตามสถานะที่จะลบ: ${JSON.stringify(byStatus)}`);
  console.log(`└─────────────────────────────────────`);

  console.log(`\n┌─ articles ──────────────────────────`);
  console.log(`│  เก็บไว้  ${articles.length - artDrop.length}`);
  console.log(`│  ลบ      ${artDrop.length}  (เก่ากว่ากำหนด ${artDrop.length - noDate(artDrop, 'published_at')} · ไม่มีวันเผยแพร่ ${noDate(artDrop, 'published_at')})`);
  if (artRescued.length) {
    console.log(`│  กันไว้  ${artRescued.length}  เก่าแต่ยังถูกเคสที่เก็บไว้อ้างอิงอยู่ จึงไม่ลบ`);
  }
  console.log(`└─────────────────────────────────────`);

  if (incDrop.length) {
    console.log(`\nตัวอย่างเคสที่จะลบ (5 รายการแรก เรียงตามวัน):`);
    for (const r of [...incDrop].sort((a, b) => (a.incident_date ?? '') .localeCompare(b.incident_date ?? '')).slice(0, 5)) {
      console.log(`  #${r.seq}  ${r.incident_date ?? 'ไม่มีวันที่'}  [${r.status}]  ${(r.news_title ?? '').slice(0, 46)}`);
    }
  }

  if (incDrop.length === 0 && artDrop.length === 0) {
    console.log('\n✓ ไม่มีข้อมูลที่ต้องลบ');
    return;
  }

  if (!confirmed) {
    console.log(`\nยังไม่ได้ลบอะไร — ใส่ --yes เพื่อลบจริง (จะสำรองไฟล์ให้ก่อนอัตโนมัติ)`);
    return;
  }

  /* ---- สำรองก่อนลบ ---- */
  // ตั้งชื่อไฟล์จากวันตัด ไม่ใช่เวลาปัจจุบัน เพื่อให้รันซ้ำแล้วได้ไฟล์เดิม ไม่กองเป็นขยะ
  const backup = `backup-before-cleanup-${from}.json`;
  writeFileSync(
    backup,
    JSON.stringify(
      {
        cutoff: from,
        recoveredDates: recoverable,
        incidents: incDrop,
        articles: artDrop,
        note: 'ข้อมูลที่ถูกลบโดย npm run data:cleanup — เก็บไว้เผื่อต้องกู้คืน',
      },
      null,
      2
    ),
    'utf8'
  );
  console.log(`\n✓ สำรองไว้ที่ ${backup} (${incDrop.length} เคส · ${artDrop.length} ข่าวดิบ)`);

  /* ---- ผู้ใช้ระดับ admin ชั่วคราวสำหรับลบ incidents ----
   *
   * service_role ลบ incidents ไม่ได้โดยตั้งใจ (ดูคอมเมนต์ใน 0008_sitemap_sources.sql)
   * เพื่อบังคับให้การลบข้อมูลสถิติผ่านสิทธิ์ผู้ใช้ที่ตรวจสอบย้อนหลังได้
   * จึงสร้างผู้ใช้ชั่วคราวแล้วลบทิ้งเมื่อเสร็จ — รูปแบบเดียวกับ scripts/reset-queue.ts
   */
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!anonKey) {
    console.error('\n✕ ต้องมี VITE_SUPABASE_ANON_KEY ใน .env.local เพื่อลบ incidents');
    process.exit(1);
  }

  const password = `Cleanup-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const email = `cleanup-old-data-${Date.now()}@example.com`;
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

  /* ---- เติมวันเกิดเหตุที่กู้มาได้ ---- */
  if (recoverable.length) {
    for (const r of recoverable) {
      const { error } = await db.from('incidents').update({ incident_date: r.date }).eq('id', r.id);
      if (error) throw new Error(`เติมวันเกิดเหตุ #${r.seq} ไม่สำเร็จ: ${error.message}`);
    }
    console.log(`✓ เติมวันเกิดเหตุให้ ${recoverable.length} เคส จากวันเผยแพร่ของข่าวต้นทาง`);
  }

  /* ---- ลบจริง ---- */
  // ลบ incidents ก่อน เพราะ incident_revisions ผูกไว้แบบ cascade จะหายตามเอง
  // ถ้าลบ articles ก่อน เคสที่กำลังจะลบจะเสีย source_article_id ไปเปล่าๆ ก่อนถูกสำรอง
    console.log('');
    // incidents ต้องลบผ่านสิทธิ์ผู้ใช้ · articles ใช้ service_role ได้ (0008 ให้สิทธิ์ไว้แล้ว)
    await deleteByIds(asAdmin, 'incidents', incDrop.map((r) => r.id));
    await deleteByIds(db, 'articles', artDrop.map((r) => r.id));

    console.log(`\n✓ ล้างข้อมูลเรียบร้อย เหลือ incidents ${incKeep.length} · articles ${articles.length - artDrop.length}`);
    console.log(`  ถ้าต้องกู้คืน ใช้ข้อมูลใน ${backup}`);
  } finally {
    // ต้องลบผู้ใช้ชั่วคราวเสมอ แม้ระหว่างทางจะพัง ไม่งั้นเหลือบัญชี admin ค้างในระบบ
    await db.auth.admin.deleteUser(created.user.id);
  }
}

void main();
