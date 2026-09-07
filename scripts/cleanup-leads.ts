/**
 * ล้าง lead ค้างที่ไม่มีวันใช้งานได้
 *
 * lead คือข่าวที่ Google News บอกว่ามีอยู่ แต่ให้ URL ต้นทางไม่ได้ (Google เข้ารหัสลิงก์ไว้)
 * จึงต้องให้เจ้าหน้าที่เปิดลิงก์แล้วคัดลอก URL มาวางเอง — เป็นงานมือทั้งหมด
 *
 * แต่ lead จำนวนมากไม่ควรมีตั้งแต่แรก:
 *   1. มาจากโดเมนที่ไม่ใช่หน้าข่าว (facebook / LINE TODAY / Vietnam.vn) — สกัด 49 ฟิลด์ไม่ได้อยู่แล้ว
 *   2. มาจากสำนักที่เรา poll ฟีดตรงอยู่แล้ว — จะได้ข่าวเดียวกันพร้อมเนื้อข่าวเต็มอยู่ดี
 *
 * ตัวกรองที่ ingest.ts กันไว้ตอนนี้ใช้ **โดเมน** จาก <source url="..."> ของ Google News
 * แต่ lead ที่ค้างอยู่ถูกบันทึกก่อนมีตัวกรองนั้น และไม่ได้เก็บโดเมนไว้
 * สคริปต์นี้จึงจับคู่ด้วย **ชื่อสำนักข่าว** แบบยืดหยุ่นแทน (Google News ส่งชื่อมาไม่คงที่ —
 * ในคิวจริงมีทั้ง "Thairath", "Thairath.co.th", "ไทยรัฐออนไลน์")
 *
 *   npm run leads:cleanup -- --dry-run   ดูว่าจะตัดอันไหน เพราะอะไร ไม่แตะข้อมูล
 *   npm run leads:cleanup                ตัดจริง
 */
import './_env';
import { createClient } from '@supabase/supabase-js';
import { titlesLookAlike } from '../api/_lib/leads';

const DRY_RUN = process.argv.includes('--dry-run');

/** ชื่อ/โดเมนที่บ่งว่าไม่ใช่หน้าข่าว */
const NON_ARTICLE = [
  'facebook',
  'vietnam.vn',
  'line today',
  'line.me',
  'youtube',
  'tiktok',
  'twitter',
  'x.com',
  // เว็บค้าปลีก/บริการที่ Google News จัดว่าเป็นสำนักข่าว
  'grab.com',
  'โลตัส',
  'lotus',
  'shopee',
  'lazada',
];

/** ชื่อสำนักที่สคริปต์ทดสอบ (e2e-fixture) สร้างขึ้น — ไม่ใช่ข่าวจริง */
const TEST_AGENCY = 'สำนักข่าวทดสอบ';

/**
 * คำที่ใช้จับว่า lead มาจากสำนักที่เรามีฟีดตรง
 * ต้องครอบทั้งชื่อไทย ชื่ออังกฤษ และโดเมน เพราะ Google News สลับใช้ทั้งสามแบบ
 */
const COVERED_ALIASES: Record<string, string[]> = {
  'khaosod.co.th': ['ข่าวสด', 'khaosod'],
  'matichon.co.th': ['มติชน', 'matichon'],
  'thairath.co.th': ['ไทยรัฐ', 'thairath'],
  'dailynews.co.th': ['เดลินิวส์', 'dailynews'],
  'prachachat.net': ['ประชาชาติ', 'prachachat'],
  'thaipost.net': ['ไทยโพสต์', 'thaipost'],
  'innnews.co.th': ['สำนักข่าว inn', 'innnews'],
};

function rejectReason(agency: string, title: string, coveredDomains: Set<string>): string | null {
  // แถวที่หลุดจากการทดสอบระบบ (teardown ไม่ได้รัน) — ไม่ใช่ข่าว ต้องเอาออกจากคิวของคน
  if (title.startsWith('[E2E]') || agency === TEST_AGENCY) return 'รายการจากสคริปต์ทดสอบ ไม่ใช่ข่าวจริง';

  const a = agency.toLowerCase();
  if (!a) return null;

  if (NON_ARTICLE.some((n) => a.includes(n))) return `ไม่ใช่หน้าข่าว (${agency})`;

  for (const [domain, aliases] of Object.entries(COVERED_ALIASES)) {
    if (!coveredDomains.has(domain)) continue; // ฟีดนั้นถูกปิดไปแล้ว อย่าตัด
    if (aliases.some((alias) => a.includes(alias))) {
      return `มีฟีดของ ${domain} อยู่แล้ว จะได้ข่าวนี้พร้อมเนื้อเต็มจากฟีดตรง`;
    }
  }
  return null;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('\nยังไม่ได้ตั้ง SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ใน .env.local\n');
    process.exit(1);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  // รวม kind='sitemap' ด้วย — ช่อง 7 กับ Thai PBS เข้าระบบเองได้แล้ว ไม่ต้องรอคนยืนยันลิงก์
  const { data: sources } = await db
    .from('sources')
    .select('domain')
    .eq('enabled', true)
    .in('kind', ['outlet_rss', 'sitemap']);
  const coveredDomains = new Set(
    (sources ?? []).map((r) => (r.domain ?? '').toLowerCase().replace(/^www\./, '')).filter(Boolean)
  );

  const { data: leads } = await db
    .from('articles')
    .select('id, title, news_agency')
    .eq('screen_status', 'needs_url');

  if (!leads?.length) {
    console.log('\nไม่มี lead ค้างในคิว\n');
    return;
  }

  const toReject: { id: string; title: string; agency: string; reason: string }[] = [];
  const keep: typeof leads = [];
  for (const lead of leads) {
    const reason = rejectReason(lead.news_agency ?? '', lead.title, coveredDomains);
    if (reason) toReject.push({ id: lead.id, title: lead.title, agency: lead.news_agency ?? '-', reason });
    else keep.push(lead);
  }

  /* ---- เรื่องเดียวกันเข้าระบบทางอื่นไปแล้วหรือยัง ----
   *
   * หลังเพิ่มแหล่ง sitemap ข่าวช่อง 7 / Thai PBS ที่เคยเป็น lead จะถูกดึงเข้ามาเองพร้อมเนื้อเต็ม
   * lead เดิมจึงกลายเป็นงานซ้ำซ้อน — ต้องปิดให้ ไม่งั้นเจ้าหน้าที่ยังเห็นในคิวอยู่ดี
   *
   * เทียบด้วยพาดหัว เพราะ lead ไม่มี URL ให้เทียบ (นั่นคือสาเหตุที่มันเป็น lead ตั้งแต่แรก)
   */
  const { data: haveArticles } = await db
    .from('articles')
    .select('title, news_agency, screen_status')
    .in('screen_status', ['extracted', 'keyword_pass', 'ai_reject'])
    .limit(2000);

  const stillKeep: typeof leads = [];
  for (const lead of keep) {
    const twin = (haveArticles ?? []).find((a) => a.title && titlesLookAlike(a.title, lead.title));
    if (twin) {
      toReject.push({
        id: lead.id,
        title: lead.title,
        agency: lead.news_agency ?? '-',
        reason: 'เรื่องเดียวกันเข้าระบบทางอื่นไปแล้ว',
      });
    } else {
      stillKeep.push(lead);
    }
  }
  keep.length = 0;
  keep.push(...stillKeep);

  console.log(`\nlead ค้างทั้งหมด ${leads.length} รายการ`);
  console.log(`โดเมนที่มีฟีดตรงแล้ว: ${[...coveredDomains].join(', ')}\n`);

  const byReason: Record<string, typeof toReject> = {};
  for (const r of toReject) (byReason[r.reason] ??= []).push(r);

  for (const [reason, items] of Object.entries(byReason).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(items.length).padStart(3)}  ${reason}`);
    for (const i of items.slice(0, 3)) console.log(`         · [${i.agency}] ${i.title.slice(0, 52)}`);
    if (items.length > 3) console.log(`         · … อีก ${items.length - 3} รายการ`);
  }

  console.log(`\n  ตัดทิ้ง ${toReject.length} · เหลือทำมือจริง ${keep.length}`);

  const remainingByAgency: Record<string, number> = {};
  for (const k of keep) remainingByAgency[k.news_agency ?? '-'] = (remainingByAgency[k.news_agency ?? '-'] ?? 0) + 1;
  console.log('\n  ที่เหลือแยกตามสำนัก:');
  for (const [a, n] of Object.entries(remainingByAgency).sort((x, y) => y[1] - x[1])) {
    console.log(`    ${String(n).padStart(3)}  ${a}`);
  }

  if (DRY_RUN) {
    console.log('\n--dry-run: ไม่ได้แก้อะไรในฐานข้อมูล ถอดออกเพื่อตัดจริง\n');
    return;
  }

  if (toReject.length === 0) {
    console.log('\nไม่มีอะไรต้องตัด\n');
    return;
  }

  // เก็บไว้เป็น keyword_reject พร้อมเหตุผล ไม่ลบทิ้ง — ตาราง articles ตั้งใจเก็บทั้งที่ผ่านและไม่ผ่าน
  // เพื่อให้ตรวจย้อนหลังและใช้จูนตัวกรองได้
  let done = 0;
  const CHUNK = 25;
  for (let i = 0; i < toReject.length; i += CHUNK) {
    await Promise.all(
      toReject.slice(i, i + CHUNK).map((r) =>
        db
          .from('articles')
          .update({
            screen_status: 'keyword_reject',
            screen_reason: r.reason,
            processed_at: new Date().toISOString(),
          })
          .eq('id', r.id)
          .then(({ error }) => {
            if (error) console.error(`  ✕ ${r.id}: ${error.message}`);
            else done++;
          })
      )
    );
  }

  console.log(`\nตัดออกจากคิวแล้ว ${done} รายการ (เก็บไว้เป็น keyword_reject พร้อมเหตุผล ไม่ได้ลบทิ้ง)`);
  console.log(`เหลือรอยืนยันลิงก์ ${keep.length} รายการ\n`);
}

void main();
