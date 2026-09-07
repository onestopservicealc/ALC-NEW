/**
 * ขั้นที่ 2 ของการดึงข่าวย้อนหลัง — ให้ AI สกัด 49 ฟิลด์จากคิวที่ `npm run backfill` เก็บไว้
 *
 * แยกจากขั้นแรกเพราะขั้นนี้เรียก Gemini ซึ่งมีค่าใช้จ่ายและกินโควตา
 * จึงต้องกำหนดเพดานได้ชัดเจนและเห็นตัวเลขก่อนตัดสินใจรันเพิ่ม
 *
 * รันในเครื่อง จึงไม่ติดเพดานเวลา 300 วินาทีของ Vercel — ตั้งงบเวลาไว้ 30 นาทีต่อรอบ
 * ใช้ pipeline ตัวเดียวกับ cron ทุกประการ (api/_lib/ingest.ts) ผลลัพธ์จึงเหมือนกัน
 *
 *   npm run backfill:extract -- --max 20     ลองก่อน 20 ข่าว เพื่อดูคุณภาพและต้นทุน
 *   npm run backfill:extract -- --max 200    เดินหน้าเต็ม
 *   npm run backfill:extract -- --status     ดูสถานะคิวเฉยๆ ไม่เรียก AI
 *   npm run backfill:extract -- --poll       ดึงฟีดใหม่ก่อนด้วย (Google News + sitemap)
 *   npm run backfill:extract -- --poll --max 0   ดึง+คัดกรองอย่างเดียว ไม่เรียก AI (ฟรี)
 *
 * ต้องใส่ --poll เมื่อต้องการข่าวจากแหล่งชนิด sitemap (ช่อง 7 / Thai PBS)
 * เพราะ `npm run backfill` ไล่เฉพาะฟีด RSS ที่รองรับการย้อนหน้าเท่านั้น
 */
import './_env';
import { createClient } from '@supabase/supabase-js';
import { runIngest } from '../api/_lib/ingest';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const MAX = Number(arg('max') ?? 20);
const STATUS_ONLY = process.argv.includes('--status');
const POLL = process.argv.includes('--poll');

const STATUS_LABELS: Record<string, string> = {
  new: 'เพิ่งดึงมา รอคัดกรอง',
  keyword_pass: 'ผ่านคัดกรอง รอ AI',
  keyword_reject: 'ไม่ผ่านคัดกรอง',
  needs_fetch: 'รอดึงหน้าเว็บ (จาก sitemap)',
  ai_reject: 'AI ตัดออก',
  extracted: 'สกัดแล้ว',
  needs_url: 'รอยืนยันลิงก์',
  fetch_failed: 'ดึงเนื้อข่าวไม่ได้',
};

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('\nยังไม่ได้ตั้ง SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ใน .env.local\n');
    process.exit(1);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  async function showQueue(label: string) {
    // ต้องใช้ count:'exact' + head — ถ้าดึงแถวมานับเองจะได้แค่ 1000 แถวตามลิมิตของ Supabase
    // (ตอนแรกเขียนแบบนั้นแล้วรายงานว่ามี 1000 ข่าว ทั้งที่จริงมี 12,154)
    const counts: Record<string, number> = {};
    for (const status of Object.keys(STATUS_LABELS)) {
      const { count } = await db
        .from('articles')
        .select('*', { count: 'exact', head: true })
        .eq('screen_status', status);
      if (count) counts[status] = count;
    }

    const { count: pending } = await db
      .from('incidents')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    console.log(`\n${label}`);
    for (const [k, text] of Object.entries(STATUS_LABELS)) {
      if (counts[k]) console.log(`  ${text.padEnd(22)} ${String(counts[k]).padStart(6)}`);
    }
    console.log(`  ${'รวมข่าวในระบบ'.padEnd(22)} ${String(total).padStart(6)}`);
    console.log(`  ${'รอตรวจสอบใน incidents'.padEnd(22)} ${String(pending ?? 0).padStart(6)}`);
  }

  await showQueue('สถานะคิวปัจจุบัน:');

  if (STATUS_ONLY) {
    console.log('');
    return;
  }

  if (!process.env.GEMINI_API_KEY) {
    if (MAX > 0) {
      console.error('\nยังไม่ได้ตั้ง GEMINI_API_KEY — ขั้นนี้ต้องใช้\n');
      process.exit(1);
    }
  }

  console.log(
    MAX > 0
      ? `\nเริ่มสกัดสูงสุด ${MAX} ข่าว (โมเดล ${process.env.GEMINI_MODEL ?? 'ค่าเริ่มต้น'})`
      : '\nโหมดไม่เรียก AI — ทำแค่ดึงฟีด ดึงหน้าเว็บ และคัดกรองด้วยคำสำคัญ'
  );
  if (POLL) console.log('รวมการดึงฟีดใหม่ด้วย (--poll) — จะได้ข่าวจากแหล่งชนิด sitemap ด้วย');
  console.log('กด Ctrl+C หยุดได้ตลอด — สถานะเก็บอยู่ในฐานข้อมูล รอบถัดไปทำต่อจากเดิม\n');

  const started = Date.now();
  const summary = await runIngest(db, {
    trigger: 'manual',
    // ปกติข่าวถูกดึงมาแล้วในขั้น backfill จึงข้ามการ poll
    // แต่ backfill ไล่เฉพาะฟีด RSS — แหล่งชนิด sitemap และ Google News ต้องใช้ --poll
    skipPoll: !POLL,
    maxArticles: MAX,
    // ขั้นคัดกรอง keyword ไม่มีค่าใช้จ่าย จึงเคลียร์ให้หมดคิวไปเลย
    // เพดาน --max คุมเฉพาะจำนวนครั้งที่เรียก AI ซึ่งเป็นส่วนที่เสียเงิน
    maxKeywordScreen: 100_000,
    timeBudgetMs: 30 * 60 * 1000, // รันในเครื่อง ไม่ติดเพดาน 300 วินาทีของ Vercel
  });

  console.log('─────────────────────────────────────────────');
  if (POLL) {
    console.log(`ดึงฟีด              : สำเร็จ ${summary.feeds_polled} · ล้มเหลว ${summary.feeds_failed}`);
    console.log(`ข่าวใหม่            : ${summary.articles_new} · ตัด lead ซ้ำซ้อน ${summary.leads_skipped}`);
  }
  console.log(`คัดกรองด้วย keyword : ผ่าน ${summary.keyword_passed} · ตัดออก ${summary.keyword_rejected}`);
  console.log(`ส่งให้ AI           : ${summary.ai_screened} · AI ตัดออก ${summary.ai_rejected}`);
  console.log(`เข้าคิวตรวจสอบ      : ${summary.incidents_created} (สงสัยซ้ำ ${summary.duplicates_found})`);
  console.log(`รอยืนยันลิงก์       : ${summary.leads_pending}`);
  console.log(`ใช้เวลา             : ${Math.round((Date.now() - started) / 1000)} วินาที`);
  console.log(`สาเหตุที่หยุด        : ${summary.stopped_reason}`);
  for (const note of summary.notes) console.log(`หมายเหตุ            : ${note}`);

  if (summary.errors.length) {
    console.log(`\nข้อผิดพลาด ${summary.errors.length} รายการ:`);
    for (const e of summary.errors.slice(0, 10)) console.log(`  · ${e.where}: ${e.message}`);
  }

  await showQueue('สถานะคิวหลังรัน:');
  console.log('\nตรวจสอบและอนุมัติต่อได้ที่แท็บ "คิวตรวจสอบข่าว" ในหน้าเว็บ\n');
}

void main();
