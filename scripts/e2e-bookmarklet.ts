/**
 * ทดสอบ "ปุ่มจับข่าว" ครบวงจรในเบราว์เซอร์จริง
 *
 * แยกจาก `npm run e2e` เพราะเทสต์นี้เรียก Gemini จริง 1 ครั้ง
 * และโควตาฟรีมีแค่ ~20 ครั้ง/วัน/โมเดล — ไม่ควรเผาไปกับทุกครั้งที่รันเทสต์ทั่วไป
 *
 * สิ่งที่พิสูจน์ (อ่านโค้ดอย่างเดียวพิสูจน์ไม่ได้):
 *  - ปุ่มที่ลากไปวางบนแถบบุ๊กมาร์กมีโค้ดจริง (React 19 บล็อก href ที่ขึ้นต้นด้วย javascript:
 *    ถ้าใส่ผ่าน JSX — เคยพลาดมาแล้ว ปุ่มกลายเป็นบุ๊กมาร์กเปล่า)
 *  - postMessage ข้าม origin ทำงาน และป๊อปอัปใช้ session เดิมได้โดยไม่ต้องมี token ใหม่
 *  - ข่าวที่จับมาเข้าคิว pending ไม่ขึ้นหน้าสาธารณะทันที
 *
 *   npm run e2e:bookmarklet
 */
import './_env';
import { chromium } from 'playwright';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const APP = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const TEST_URL = 'https://fakenews.test/article/1';
const PASSWORD = `Bookmarklet!${Date.now()}`;
const EMAIL = `e2e-bookmarklet-${Date.now()}@example.com`;

let pass = 0;
let fail = 0;
const failed: string[] = [];
function check(ok: boolean, label: string, detail = ''): void {
  if (ok) pass++;
  else {
    fail++;
    failed.push(label);
  }
  console.log(`  ${ok ? '✓' : '✕'} ${label}${detail ? `  — ${detail}` : ''}`);
}

const admin = (): SupabaseClient =>
  createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

/** หน้าข่าวปลอมที่มีเนื้อครบพอให้สกัด 49 ฟิลด์ได้ */
const FAKE_ARTICLE = `<html><head><title>หนุ่มเมาแล้วขับ พุ่งชนเสาไฟฟ้า ดับ 1 เจ็บ 2</title></head><body><article>
<h1>หนุ่มเมาแล้วขับ พุ่งชนเสาไฟฟ้า ดับ 1 เจ็บ 2</h1>
<p>เมื่อเวลา 23.30 น. วันที่ 2 กันยายน 2569 เกิดอุบัติเหตุรถกระบะเสียหลักพุ่งชนเสาไฟฟ้า
บริเวณถนนมิตรภาพ ตำบลในเมือง อำเภอเมือง จังหวัดขอนแก่น เป็นเหตุให้มีผู้เสียชีวิต 1 ราย
และบาดเจ็บ 2 ราย เจ้าหน้าที่ตรวจวัดระดับแอลกอฮอล์ผู้ขับขี่ได้ 187 มิลลิกรัมเปอร์เซ็นต์
ซึ่งเกินกว่าที่กฎหมายกำหนด นายสมชาย อายุ 34 ปี ผู้ขับขี่ให้การว่าดื่มสุรากับเพื่อนที่ร้านอาหาร
ก่อนขับรถกลับบ้าน ผู้เสียชีวิตคือนางสาวมาลี อายุ 27 ปี ส่วนผู้บาดเจ็บอีก 2 รายถูกนำส่งโรงพยาบาล
ตำรวจได้ควบคุมตัวผู้ขับขี่ไว้ดำเนินคดีในข้อหาขับรถขณะเมาสุราเป็นเหตุให้ผู้อื่นถึงแก่ความตาย</p>
</article></body></html>`;

async function main() {
  const db = admin();
  const { data: created, error: userErr } = await db.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (userErr || !created.user) throw new Error(`สร้างผู้ใช้ทดสอบไม่สำเร็จ: ${userErr?.message}`);
  await db.from('profiles').upsert({ id: created.user.id, role: 'admin' }, { onConflict: 'id' });

  const browser = await chromium.launch({ channel: 'chrome', headless: !process.argv.includes('--headed') });
  const ctx = await browser.newContext();

  try {
    console.log('\n── 1. เข้าสู่ระบบ');
    const page = await ctx.newPage();
    await page.goto(APP, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /เข้าสู่ระบบ/ }).first().click();
    await page.locator('input[type="email"]').fill(EMAIL);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: /^เข้าสู่ระบบ$/ }).last().click();
    await page.waitForTimeout(3000);
    check(/ผู้ดูแลระบบ/.test(await page.locator('body').innerText()), 'ล็อกอินสำเร็จ');

    console.log('\n── 2. หน้าติดตั้งปุ่ม');
    const setup = await ctx.newPage();
    await setup.goto(`${APP}/#/bookmarklet`, { waitUntil: 'networkidle' });
    check(/ลากปุ่ม/.test(await setup.locator('body').innerText()), 'แสดงขั้นตอนการติดตั้ง');

    const href = await setup.getByRole('link', { name: /จับข่าวเข้าระบบ/ }).getAttribute('href');
    check(Boolean(href?.startsWith('javascript:')), 'ปุ่มมีโค้ด bookmarklet จริง (React ไม่ได้บล็อกทิ้ง)');
    const code = decodeURIComponent((href ?? '').replace(/^javascript:/, ''));
    check(code.includes(APP), 'โค้ดชี้กลับมาที่เซิร์ฟเวอร์เดียวกับที่เปิดหน้านี้');

    console.log('\n── 3. กดปุ่มจากหน้าเว็บสำนักข่าว (คนละ origin)');
    const news = await ctx.newPage();
    await news.route('**/fakenews.test/**', (r) =>
      r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FAKE_ARTICLE })
    );
    news.on('dialog', async (d) => {
      console.log(`    [กล่องข้อความ] ${d.message()}`);
      await d.dismiss();
    });
    await news.goto(TEST_URL, { waitUntil: 'domcontentloaded' });
    check(news.url().startsWith('https://fakenews.test'), 'อยู่บนโดเมนอื่น ไม่ใช่โดเมนของระบบ');

    const popupPromise = ctx.waitForEvent('page', { timeout: 20000 });
    await news.evaluate(code);
    const popup = await popupPromise.catch(() => null);
    if (!popup) {
      check(false, 'ป๊อปอัปเปิดขึ้น');
      return;
    }
    await popup.waitForLoadState('networkidle');
    check(popup.url().includes('/#/capture'), 'ป๊อปอัปเปิดหน้ารับข่าว');

    console.log('\n── 4. ผลลัพธ์');
    let text = '';
    for (let i = 0; i < 45; i++) {
      text = await popup.locator('body').innerText();
      if (/เรียบร้อย|บันทึกไม่สำเร็จ|ต้องเข้าสู่ระบบ/.test(text)) break;
      await popup.waitForTimeout(1000);
    }
    check(!/ต้องเข้าสู่ระบบ/.test(text), 'ป๊อปอัปใช้ session ที่ล็อกอินไว้ (ไม่ต้องมี token ใหม่)');
    check(/เรียบร้อย/.test(text), 'บันทึกข่าวสำเร็จจากการกดครั้งเดียว', text.replace(/\n+/g, ' · ').slice(0, 90));

    const seq = text.match(/#(\d+)/)?.[1];
    if (seq) {
      const { data: inc } = await db
        .from('incidents')
        .select('seq, url, news_title, status, province, alcohol_level, total_death')
        .eq('seq', Number(seq))
        .maybeSingle();
      check(Boolean(inc), `เคส #${seq} บันทึกลงฐานข้อมูลจริง`);
      check(inc?.url === TEST_URL, 'url เป็นลิงก์ของหน้าข่าวที่กดปุ่ม', inc?.url ?? '(ไม่มี)');
      check(inc?.status === 'pending', 'เข้าคิวรอตรวจสอบ ไม่ขึ้นหน้าสาธารณะทันที');
      check(
        inc?.province === 'ขอนแก่น' && inc?.alcohol_level === 187,
        'สกัดข้อมูลจากเนื้อข่าวที่เบราว์เซอร์ส่งมาได้ถูกต้อง',
        `${inc?.province} · แอลกอฮอล์ ${inc?.alcohol_level} · เสียชีวิต ${inc?.total_death}`
      );
    }
  } finally {
    await browser.close();
    await cleanup(db);
    console.log(`\n${'─'.repeat(56)}`);
    if (failed.length) console.log(`รายการที่ไม่ผ่าน:\n${failed.map((f) => `  ✕ ${f}`).join('\n')}`);
    console.log(`สรุป: ผ่าน ${pass} · ไม่ผ่าน ${fail}\n`);
    if (fail > 0) process.exitCode = 1;
  }
}

/** ลบทุกอย่างที่เทสต์สร้างขึ้น — เคสทดสอบต้องไม่ค้างในคิวงานจริง */
async function cleanup(db: SupabaseClient): Promise<void> {
  const { data: incidents } = await db.from('incidents').select('id, seq').like('url', '%fakenews.test%');

  if (incidents?.length) {
    // service_role ลบ incidents ไม่ได้ตามการออกแบบ — ต้องใช้สิทธิ์ผู้ใช้
    const anon = createClient(process.env.SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    const { data: session } = await anon.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    if (session?.session) {
      const userDb = createClient(process.env.SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!, {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${session.session.access_token}` } },
      });
      for (const inc of incidents) {
        await db.from('incident_revisions').delete().eq('incident_id', inc.id);
        await userDb.from('incidents').delete().eq('id', inc.id);
      }
    }
  }

  const { error: delErr } = await db.from('articles').delete().like('url', '%fakenews.test%');
  if (delErr) {
    // ยังไม่ได้รัน migration 0008 — ปิดสถานะแทน ห้ามปล่อยให้ค้างในคิวของคน
    await db
      .from('articles')
      .update({ screen_status: 'keyword_reject', screen_reason: 'แถวทดสอบระบบ ไม่ใช่ข่าวจริง' })
      .like('url', '%fakenews.test%');
  }

  const { data: users } = await db.auth.admin.listUsers();
  for (const u of users?.users ?? []) {
    if (u.email?.startsWith('e2e-bookmarklet-')) await db.auth.admin.deleteUser(u.id);
  }

  const { data: left } = await db.from('incidents').select('seq').like('url', '%fakenews.test%');
  console.log(`\nเก็บกวาดแล้ว — เคสทดสอบที่ยังค้าง: ${left?.length ?? 0}`);
}

void main();
