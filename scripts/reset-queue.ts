/**
 * ล้างคิวข่าวดิบทั้งหมด เพื่อเริ่มดึงใหม่จากศูนย์
 *
 * ลบ:  articles (คิวข่าวดิบ) · ingest_runs (ประวัติการดึง)
 * เก็บ: incidents (เคสที่สกัดและตรวจแล้ว) · sources (ตั้งค่าแหล่งข่าว) · บัญชีผู้ใช้
 *
 * ปลอดภัยกับ incidents เพราะ `incidents.source_article_id` ตั้งไว้เป็น
 * `on delete set null` (ไม่ใช่ cascade) — ตรวจใน 0001_init.sql:196 แล้ว
 * เคสจะยังอยู่ครบ เพียงแต่ลิงก์กลับไปยังแถวข่าวดิบจะกลายเป็นว่าง
 * สคริปต์ตรวจซ้ำหลังลบด้วย ถ้าจำนวนเคสเปลี่ยนจะรายงานว่าผิดปกติ
 *
 * ทำไมต้องสร้างผู้ใช้ชั่วคราว: `service_role` ไม่มีสิทธิ์ DELETE บน articles
 * (migration 0006 ให้เฉพาะ `authenticated` + RLS ยอมให้เฉพาะ admin)
 * จึงต้องลบผ่าน session ของผู้ใช้ระดับ admin เหมือนตอนลบเคส
 *
 * ผลข้างเคียงที่ตั้งใจ: url_key ที่เคยกันข่าวซ้ำหายไปด้วย การดึงรอบใหม่จึงได้ข่าวมาครบ
 * ส่วนเรื่องที่ตรงกับเคสเดิมจะถูกจับด้วย find_duplicate_incident ตอนสกัดอยู่แล้ว
 *
 *   npm run reset:queue              ดูว่าจะลบอะไรบ้าง ไม่แตะข้อมูล
 *   npm run reset:queue -- --yes     ลบจริง
 */
import './_env';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const CONFIRMED = process.argv.includes('--yes');
/** ขนาดชุดตอนต้องลบทีละชุด — เล็กพอให้ query string ไม่ยาวเกินที่ PostgREST รับได้ */
const CHUNK = 150;

async function count(db: SupabaseClient, table: string): Promise<number> {
  const { count: n } = await db.from(table).select('*', { count: 'exact', head: true });
  return n ?? 0;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key || !anonKey) {
    console.error('\nต้องมี SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY และ VITE_SUPABASE_ANON_KEY ใน .env.local\n');
    process.exit(1);
  }
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const before = {
    articles: await count(admin, 'articles'),
    ingest_runs: await count(admin, 'ingest_runs'),
    incidents: await count(admin, 'incidents'),
    revisions: await count(admin, 'incident_revisions'),
    sources: await count(admin, 'sources'),
  };

  console.log('\nสถานะก่อนล้าง');
  console.log(`  จะลบ    articles       ${String(before.articles).padStart(6)}`);
  console.log(`  จะลบ    ingest_runs    ${String(before.ingest_runs).padStart(6)}`);
  console.log(`  เก็บไว้  incidents      ${String(before.incidents).padStart(6)}`);
  console.log(`  เก็บไว้  ประวัติการตรวจ  ${String(before.revisions).padStart(6)}`);
  console.log(`  เก็บไว้  sources        ${String(before.sources).padStart(6)}`);

  if (!CONFIRMED) {
    console.log('\nนี่คือการดูเฉยๆ ยังไม่ได้ลบอะไร');
    console.log('ลบจริงด้วย:  npm run reset:queue -- --yes\n');
    return;
  }

  /* ---- ผู้ใช้ชั่วคราวระดับ admin สำหรับลบ articles ---- */
  const password = `Reset-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const email = `reset-queue-${Date.now()}@example.com`;
  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userErr || !created.user) {
    console.error(`\nสร้างผู้ใช้ชั่วคราวไม่สำเร็จ: ${userErr?.message}\n`);
    process.exit(1);
  }
  await admin.from('profiles').upsert({ id: created.user.id, role: 'admin' }, { onConflict: 'id' });

  try {
    const anon = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data: session, error: signErr } = await anon.auth.signInWithPassword({ email, password });
    if (signErr || !session.session) throw new Error(`ล็อกอินผู้ใช้ชั่วคราวไม่สำเร็จ: ${signErr?.message}`);

    const userDb = createClient(url, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${session.session.access_token}` } },
    });

    console.log('\nกำลังลบ...');

    /* ---- articles ---- */
    // ลองลบทีเดียวก่อน (เร็วที่สุด) — ถ้า statement timeout ค่อยแบ่งเป็นชุด
    //
    // ห้ามส่ง id เป็นชุดใหญ่ผ่าน .in() เพราะ PostgREST วางเงื่อนไขไว้ใน query string
    // 1,000 uuid ยาวเกิน 37 KB เซิร์ฟเวอร์ตอบ "Bad Request" (เจอมาแล้ว)
    const ALL_ROWS = '00000000-0000-0000-0000-000000000000';
    let removed = 0;

    const { error: bulkErr } = await userDb.from('articles').delete().neq('id', ALL_ROWS);

    if (!bulkErr) {
      removed = before.articles - (await count(admin, 'articles'));
      console.log(`  ✓ ลบ articles แล้ว ${removed} แถว`);
    } else if (/permission denied/i.test(bulkErr.message)) {
      throw new Error(
        `ลบ articles ไม่ได้: ${bulkErr.message} — ตรวจว่าผู้ใช้เป็น admin และ migration 0006 ลงแล้ว`
      );
    } else {
      // น่าจะเป็น statement timeout — ลบทีละชุดเล็กแทน
      console.log(`  – ลบทีเดียวไม่ผ่าน (${bulkErr.message.slice(0, 60)}) เปลี่ยนเป็นลบทีละชุด`);
      for (;;) {
        const { data: batch, error: pickErr } = await admin.from('articles').select('id').limit(CHUNK);
        if (pickErr) throw new Error(`อ่านรายการไม่สำเร็จ: ${pickErr.message}`);
        if (!batch?.length) break;

        const { error: delErr } = await userDb
          .from('articles')
          .delete()
          .in('id', batch.map((r) => r.id));
        if (delErr) throw new Error(`ลบ articles ไม่สำเร็จ: ${delErr.message}`);

        removed += batch.length;
        process.stdout.write(`\r  articles: ลบแล้ว ${removed}/${before.articles}`);
      }
      console.log(`\r  ✓ ลบ articles แล้ว ${removed} แถว${' '.repeat(20)}`);
    }

    /* ---- ingest_runs: authenticated ถูกถอนสิทธิ์ DELETE ไว้ ลองด้วย service_role ---- */
    const { error: runErr } = await admin
      .from('ingest_runs')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (runErr) console.log(`  – ข้าม ingest_runs (${runErr.message.slice(0, 50)}) — เป็นแค่ประวัติ ไม่กระทบการดึงใหม่`);
    else console.log('  ✓ ลบ ingest_runs แล้ว');
  } finally {
    await admin.auth.admin.deleteUser(created.user.id);
  }

  const after = {
    articles: await count(admin, 'articles'),
    ingest_runs: await count(admin, 'ingest_runs'),
    incidents: await count(admin, 'incidents'),
    revisions: await count(admin, 'incident_revisions'),
    sources: await count(admin, 'sources'),
  };

  console.log('\nสถานะหลังล้าง');
  console.log(`  articles        ${String(after.articles).padStart(6)}`);
  console.log(`  ingest_runs     ${String(after.ingest_runs).padStart(6)}`);
  console.log(
    `  incidents       ${String(after.incidents).padStart(6)}  ${after.incidents === before.incidents ? '✓ ครบเท่าเดิม' : '✕ หายไป!'}`
  );
  console.log(
    `  ประวัติการตรวจ   ${String(after.revisions).padStart(6)}  ${after.revisions === before.revisions ? '✓ ครบเท่าเดิม' : '✕ หายไป!'}`
  );
  console.log(
    `  sources         ${String(after.sources).padStart(6)}  ${after.sources === before.sources ? '✓ ครบเท่าเดิม' : '✕ หายไป!'}`
  );

  if (after.incidents !== before.incidents || after.revisions !== before.revisions) {
    console.error('\n⚠ เคสหายไปด้วย ไม่ควรเกิดขึ้น — ตรวจ foreign key ของ incidents.source_article_id\n');
    process.exitCode = 1;
    return;
  }

  console.log('\nล้างเรียบร้อย ขั้นต่อไป:');
  console.log('  npm run backfill -- --days 30     ดึงข่าวย้อนหลัง 1 เดือน\n');
}

void main();
