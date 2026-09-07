/**
 * ตรวจ 2 อย่าง:
 *
 * 1. คอลัมน์ที่โค้ดฝั่ง client ขอ มีอยู่จริงในตาราง/วิวของ migration
 *    ถ้าไม่ตรงกัน Supabase จะคืน error ตอน runtime เท่านั้น (หน้าสถิติสาธารณะพังเงียบๆ)
 *
 * 2. ผู้ที่ไม่ล็อกอินเรียกฟังก์ชัน SECURITY DEFINER ไม่ได้
 *    ฟังก์ชันพวกนี้ข้าม RLS โดยตั้งใจ (ระบบ ingest ต้องใช้) แต่ Postgres ให้สิทธิ์ PUBLIC
 *    มาโดยปริยาย ทำให้ anon เรียกได้ถ้าไม่ revoke — เคยเกิดขึ้นจริงและถูกแก้ใน migration 0004
 *    ข้อนี้ข้ามอัตโนมัติถ้ายังไม่ได้ตั้งค่า VITE_SUPABASE_* (ตรวจแบบออฟไลน์ไม่ได้)
 *
 *   npm run check:schema
 */
import './_env';
import { readFileSync } from 'node:fs';
import { CSV_HEADER_ARRAY } from '../src/types/dataDictionary';

const schema = readFileSync('supabase/migrations/0001_init.sql', 'utf8');

/** ดึงชื่อคอลัมน์จากบล็อก create table */
function tableColumns(table: string): Set<string> {
  const start = schema.indexOf(`create table public.${table} (`);
  if (start === -1) throw new Error(`ไม่พบตาราง ${table} ใน migration`);
  const body = schema.slice(start);
  const end = body.indexOf('\n);');
  const cols = new Set<string>();
  for (const raw of body.slice(0, end).split('\n').slice(1)) {
    const line = raw.trim();
    if (!line || line.startsWith('--') || line.startsWith('constraint')) continue;
    const m = line.match(/^([a-z_0-9]+)\s+/);
    if (m) cols.add(m[1]);
  }
  return cols;
}

/** ดึงชื่อคอลัมน์จาก select list ของ view */
function viewColumns(view: string): Set<string> {
  const start = schema.indexOf(`create view public.${view} as`);
  if (start === -1) throw new Error(`ไม่พบวิว ${view} ใน migration`);
  const body = schema.slice(start, schema.indexOf('where status', start));
  const cols = new Set<string>();
  for (const raw of body.split('\n').slice(2)) {
    const line = raw.split('--')[0].trim();
    if (!line || line.startsWith('from')) continue;
    for (const part of line.split(',')) {
      const name = part.trim();
      if (/^[a-z_0-9]+$/.test(name)) cols.add(name);
    }
  }
  return cols;
}

const DATA_COLUMNS = CSV_HEADER_ARRAY.filter((k) => k !== 'id');
const NAME_FIELDS = ['perpetrator_name', 'victim_1_name', 'victim_2_name', 'victim_3_name'];

const SYSTEM_COLUMNS = [
  'id', 'seq', 'status', 'alcohol_involved', 'alcohol_role', 'source_article_id',
  'ai_model', 'ai_confidence', 'ai_adjusted_fields', 'duplicate_of',
  'reviewed_by', 'reviewed_at', 'review_note', 'created_at',
];

let failures = 0;
function check(label: string, missing: string[]) {
  if (missing.length) {
    failures++;
    console.log(`  ✕ ${label} — ขาด: ${missing.join(', ')}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

const incidents = tableColumns('incidents');
const publicView = viewColumns('incidents_public');

console.log('\n=== ตาราง incidents ต้องมีครบทั้ง 48 ฟิลด์ข้อมูล + คอลัมน์ระบบ ===');
check('48 ฟิลด์ตามสเปก', DATA_COLUMNS.filter((c) => !incidents.has(c)));
check('คอลัมน์ระบบที่โค้ด select', SYSTEM_COLUMNS.filter((c) => c !== 'seq' && !incidents.has(c)));

console.log('\n=== view incidents_public ต้องมีทุกคอลัมน์ที่ client ขอ ===');
const requested = ['seq', 'alcohol_involved', 'alcohol_role', ...DATA_COLUMNS.filter((k) => !NAME_FIELDS.includes(k))];
check('คอลัมน์ที่ client select', requested.filter((c) => !publicView.has(c)));

console.log('\n=== view ต้องไม่มีชื่อบุคคลหลุดออกไป (ข้อกำหนดความเป็นส่วนตัว) ===');
const leaked = NAME_FIELDS.filter((c) => publicView.has(c));
check('ไม่มีฟิลด์ชื่อบุคคลใน view', leaked);

/* ------------------------------------------------------------------ */
/* ตรวจสิทธิ์ RPC ด้วย anon key จริง (ข้ามถ้ายังไม่ได้ตั้งค่า env)        */
/* ------------------------------------------------------------------ */

/** ฟังก์ชันที่ข้าม RLS — ห้ามให้ anon เรียกได้เด็ดขาด */
const GUARDED_RPCS: { name: string; body: Record<string, unknown> }[] = [
  { name: 'find_similar_article', body: { p_title: 'ตรวจสิทธิ์' } },
  { name: 'find_duplicate_incident', body: { p_title: 'ตรวจสิทธิ์', p_date: null, p_province: null } },
  { name: 'queue_summary', body: {} },
  { name: 'current_role_name', body: {} },
  { name: 'is_editor', body: {} },
  { name: 'is_admin', body: {} },
];

async function checkAnonRpcAccess(): Promise<void> {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;

  console.log('\n=== ผู้ที่ไม่ล็อกอินต้องเรียกฟังก์ชันที่ข้าม RLS ไม่ได้ ===');

  if (!url || !key) {
    console.log('  – ข้าม (ยังไม่ได้ตั้ง VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)');
    return;
  }

  for (const rpc of GUARDED_RPCS) {
    let status: number;
    try {
      const res = await fetch(`${url}/rest/v1/rpc/${rpc.name}`, {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(rpc.body),
      });
      status = res.status;
    } catch (err) {
      console.log(`  – ${rpc.name}: เชื่อมต่อไม่ได้ (${String((err as Error).message).slice(0, 40)})`);
      continue;
    }

    // 404 = PostgREST ไม่เห็นฟังก์ชันเพราะไม่มีสิทธิ์ · 403 = ถูกปฏิเสธ · 200 = ยังเรียกได้ (ช่องโหว่)
    const blocked = status === 404 || status === 403 || status === 401;
    if (!blocked) failures++;
    console.log(`  ${blocked ? '✓' : '✕'} ${rpc.name.padEnd(24)} HTTP ${status}${blocked ? '' : '  ← anon ยังเรียกได้ ให้รัน migration 0004'}`);
  }
}

await checkAnonRpcAccess();

/**
 * migration 0008 ลงครบหรือยัง
 *
 * ถ้าไม่ลง ระบบจะยังทำงานได้แต่แหล่งข่าวชนิด sitemap จะใช้ไม่ได้เลย —
 * และอาการที่เห็นคือ "ข่าวช่อง 7 ไม่เข้าระบบ" ซึ่งสืบสาเหตุยากถ้าไม่มีการตรวจตรงนี้
 */
async function checkSitemapSupport(): Promise<void> {
  console.log('\n=== รองรับแหล่งข่าวชนิด sitemap (migration 0008) ===');

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log('  – ข้าม (ยังไม่ได้ตั้ง SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
    return;
  }

  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { error: colErr } = await db.from('sources').select('article_pattern').limit(1);
  const hasColumn = !colErr;
  if (!hasColumn) failures++;
  console.log(
    `  ${hasColumn ? '✓' : '✕'} คอลัมน์ sources.article_pattern${hasColumn ? '' : '  ← ยังไม่ได้รัน migration 0008'}`
  );

  if (hasColumn) {
    const { data: sitemaps } = await db
      .from('sources')
      .select('name, domain, article_pattern, enabled')
      .eq('kind', 'sitemap');
    const ok = (sitemaps?.length ?? 0) > 0;
    if (!ok) failures++;
    console.log(`  ${ok ? '✓' : '✕'} แหล่งข่าวชนิด sitemap ${sitemaps?.length ?? 0} รายการ`);
    for (const s of sitemaps ?? []) {
      console.log(`      · ${s.name} (${s.domain}) pattern=${s.article_pattern} ${s.enabled ? '' : '[ปิดอยู่]'}`);
    }
  }

  // ต้องลองเขียนจริง — การ select ด้วย eq() ผ่านได้เสมอแม้ CHECK constraint จะไม่รับค่านี้
  // จึงพิสูจน์อะไรไม่ได้เลย ต้อง insert แล้วลบทิ้ง
  const probeKey = `schema-check-needs-fetch-${Date.now()}`;
  const { error: statusErr } = await db.from('articles').insert({
    url_key: probeKey,
    url: 'https://example.invalid/schema-check',
    title: '',
    screen_status: 'needs_fetch',
  });
  const statusOk = !statusErr;
  if (!statusOk) failures++;
  console.log(
    `  ${statusOk ? '✓' : '✕'} สถานะ articles.screen_status = needs_fetch${statusOk ? '' : `  ← ${statusErr?.message?.slice(0, 70)}`}`
  );
  await db.from('articles').delete().eq('url_key', probeKey);
}

await checkSitemapSupport();

console.log(`\nสรุป: ${failures === 0 ? 'ผ่านทั้งหมด' : `พบปัญหา ${failures} จุด`}\n`);
if (failures > 0) process.exitCode = 1;
