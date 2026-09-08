/**
 * สร้างคำสั่ง SQL สำหรับตั้ง cron บน Supabase ให้พร้อมวางใน SQL Editor
 *
 * ทำไมต้องย้ายมาที่ Supabase:
 * ตรวจฐานข้อมูลจริงเมื่อ 2026-09-08 พบว่า ingest_runs ทั้งหมด 14 รอบเป็น manual ล้วน
 * ไม่มี cron แม้แต่รอบเดียว — Vercel Cron ไม่เคยลงทะเบียนสำเร็จเลย เพราะ vercel.json
 * ประกาศไว้ 8 รายการซึ่งเกินโควตาของแพลนที่ใช้อยู่ ข้อมูลที่เข้าระบบมาตลอดจึงมาจากการกดปุ่มเอง
 *
 * pg_cron ไม่ขึ้นกับแพลนของ Vercel ตั้งได้ถี่กว่า และดูประวัติการรันได้ในฐานข้อมูลตัวเอง
 *
 * ค่าลับถูกอ่านจาก .env.local แล้วเขียนลงไฟล์ที่ git มองข้าม ไม่พิมพ์ออกหน้าจอ
 *
 *   npm run setup:cron -- https://ชื่อแอปของคุณ.vercel.app
 */
import './_env';
import { writeFileSync } from 'node:fs';

const appUrl = process.argv.find((a) => a.startsWith('http'))?.replace(/\/+$/, '');
const secret = process.env.CRON_SECRET;
const OUT = 'pg-cron-setup.sql';

if (!appUrl) {
  console.error('\n✕ ต้องระบุ URL ของแอป เช่น');
  console.error('    npm run setup:cron -- https://ชื่อแอปของคุณ.vercel.app');
  console.error('\n  หาได้จาก Vercel → เลือกโปรเจกต์ → ดู Domains ที่หน้า Project');
  process.exit(1);
}
if (!secret) {
  console.error('\n✕ ไม่พบ CRON_SECRET ใน .env.local');
  process.exit(1);
}

// escape single quote ให้ปลอดภัยเวลาแทรกลงสตริงของ SQL
const q = (s: string) => s.replace(/'/g, "''");

writeFileSync(
  OUT,
  `-- ตั้งเวลาดึงข่าวอัตโนมัติด้วย pg_cron บน Supabase
-- วางทั้งไฟล์นี้ใน Supabase -> SQL Editor -> Run
--
-- ไฟล์นี้มีค่าลับ (CRON_SECRET) จึงถูกตั้งให้ git มองข้ามไว้แล้ว ห้าม commit
-- สร้างใหม่ได้เสมอด้วย: npm run setup:cron -- ${appUrl}

-- 1. เปิดส่วนเสริมที่ต้องใช้ (รันซ้ำได้ ไม่พัง)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. ลบตัวเดิมก่อน กันตั้งซ้ำเวลารันไฟล์นี้หลายรอบ
select cron.unschedule('ingest-tick') where exists (
  select 1 from cron.job where jobname = 'ingest-tick'
);

-- 3. ตั้งให้ยิงทุก 20 นาที
select cron.schedule('ingest-tick', '*/20 * * * *', $job$
  select net.http_post(
    url     := '${q(appUrl)}/api/cron/tick',
    headers := '{"Authorization": "Bearer ${q(secret)}", "Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 120000
  );
$job$);

-- 4. ตรวจว่าตั้งสำเร็จ
select jobid, jobname, schedule, active from cron.job where jobname = 'ingest-tick';


-- ─────────────────────────────────────────────────────────────
-- คำสั่งที่ใช้บ่อยภายหลัง
--
-- ดูผลการรัน 10 ครั้งล่าสุด (status ต้องเป็น succeeded):
--   select start_time, status, return_message
--   from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'ingest-tick')
--   order by start_time desc limit 10;
--
-- หยุดชั่วคราว:  select cron.unschedule('ingest-tick');
-- ─────────────────────────────────────────────────────────────
`,
  'utf8'
);

console.log(`\n✓ สร้าง ${OUT} แล้ว (git มองข้ามไฟล์นี้)`);
console.log(`  แอป: ${appUrl}`);
console.log(`  CRON_SECRET: อ่านจาก .env.local แล้ว (${secret.length} ตัวอักษร) — ไม่แสดงค่า`);
console.log(`\nขั้นต่อไป: เปิด ${OUT} คัดลอกทั้งไฟล์ไปวางใน Supabase -> SQL Editor -> Run`);
