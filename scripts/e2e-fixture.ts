/**
 * เตรียม/เก็บกวาดข้อมูลสำหรับการทดสอบผ่านหน้าเว็บ
 *
 * สร้างของทดสอบแยกจากข้อมูลจริงทั้งหมด เพื่อให้การทดสอบกดอนุมัติ/ปฏิเสธได้
 * โดยไม่ไปแตะคิวงานจริง — ทุกอย่างมีคำนำหน้า [E2E] ให้ล้างออกได้แน่นอน
 *
 *   tsx scripts/e2e-fixture.ts setup     คืน JSON ของบัญชีและรายการที่สร้าง
 *   tsx scripts/e2e-fixture.ts teardown  ลบทุกอย่างที่มีคำนำหน้า [E2E]
 */
import './_env';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const TAG = '[E2E]';
const PASSWORD = 'E2ePlaywright!2026';

function admin(): SupabaseClient {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

/** ลบเคสต้องใช้สิทธิ์ผู้ใช้ — service_role ไม่มีสิทธิ์ DELETE บน incidents */
async function asAdminUser(db: SupabaseClient, email: string): Promise<SupabaseClient | null> {
  const anon = createClient(process.env.SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.session) return null;
  return createClient(process.env.SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
}

async function teardown(): Promise<void> {
  const db = admin();

  const { data: users } = await db.auth.admin.listUsers();
  const testUsers = (users?.users ?? []).filter((u) => u.email?.startsWith('e2e-'));

  // ลบเคสทดสอบผ่านสิทธิ์ผู้ใช้ (ถ้ายังมีบัญชีเหลืออยู่)
  const { data: incidents } = await db.from('incidents').select('id, seq').like('news_title', `${TAG}%`);
  if (incidents?.length) {
    let userDb: SupabaseClient | null = null;
    for (const u of testUsers) {
      userDb = await asAdminUser(db, u.email!);
      if (userDb) break;
    }
    for (const inc of incidents) {
      await db.from('incident_revisions').delete().eq('incident_id', inc.id);
      if (userDb) await userDb.from('incidents').delete().eq('id', inc.id);
    }
  }

  // ต้องตรวจ error — service_role เพิ่งได้สิทธิ์ DELETE บน articles ใน migration 0008
  // ก่อนหน้านั้นคำสั่งนี้ล้มเหลวเงียบ แถวทดสอบจึงค้างปนอยู่ในคิวงานจริง
  const { error: delErr } = await db.from('articles').delete().like('title', `${TAG}%`);
  if (delErr) {
    // ลบไม่ได้ก็ต้องไม่ปล่อยให้ค้างในคิวของคน — ปิดสถานะแทน
    await db
      .from('articles')
      .update({
        screen_status: 'keyword_reject',
        screen_reason: 'แถวทดสอบระบบ ไม่ใช่ข่าวจริง',
        processed_at: new Date().toISOString(),
      })
      .like('title', `${TAG}%`);
    console.error(`ลบแถวทดสอบไม่ได้ (${delErr.message}) — ปิดสถานะแทน · ต้องรัน migration 0008`);
  }
  for (const u of testUsers) await db.auth.admin.deleteUser(u.id);

  const { data: left } = await db.from('incidents').select('seq').like('news_title', `${TAG}%`);
  console.log(
    JSON.stringify({ ok: true, removedUsers: testUsers.length, incidentsLeft: left?.length ?? 0 })
  );
}

async function setup(): Promise<void> {
  await teardown(); // เริ่มจากสภาพสะอาดเสมอ
  const db = admin();
  const stamp = Date.now();
  const email = `e2e-${stamp}@example.com`;

  const { data: created, error: userErr } = await db.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (userErr || !created.user) throw new Error(`สร้างผู้ใช้ไม่สำเร็จ: ${userErr?.message}`);
  await db.from('profiles').upsert({ id: created.user.id, role: 'admin' }, { onConflict: 'id' });

  // เคสรอตรวจสอบ 1 เคส สำหรับทดสอบการกดอนุมัติ
  const { data: incident, error: incErr } = await db
    .from('incidents')
    .insert({
      news_type: 'อุบัติเหตุเมาขับ',
      url: `https://example.test/e2e/${stamp}`,
      news_agency: 'สำนักข่าวทดสอบ',
      news_title: `${TAG} กระบะเมาแล้วขับพุ่งชนเสาไฟ คนขับเป่าได้ 168 มก.%`,
      news_summary: `${TAG} รายการทดสอบระบบ ไม่ใช่ข่าวจริง`,
      incident_date: '2026-08-15',
      incident_time: '23:15',
      province: 'ขอนแก่น',
      district: 'เมืองขอนแก่น',
      incident_location: 'ถนนสายหลัก/ทางหลวง',
      perpetrator_name: 'นายทดสอบ ระบบดี',
      perpetrator_gender: 'ชาย',
      perpetrator_age: 41,
      perpetrator_weapon: 'รถยนต์',
      alcohol_test_method: 'เป่าแอลกอฮอล์',
      alcohol_level: 168,
      beverage_type: 'สุราขาว/สุราสี',
      total_affected: 1,
      total_death: 0,
      total_injury: 1,
      victim_1_name: 'นางสาวทดสอบ สองสาม',
      victim_1_gender: 'หญิง',
      victim_1_age: 29,
      victim_1_injury_type: 'บาดเจ็บเล็กน้อย',
      status: 'pending',
      alcohol_involved: true,
      alcohol_role: 'ผู้ก่อเหตุดื่ม',
      ai_model: 'e2e-fixture',
      ai_confidence: 0.9,
    })
    .select('id, seq')
    .single();
  if (incErr) throw new Error(`สร้างเคสทดสอบไม่สำเร็จ: ${incErr.message}`);

  // lead 3 รายการ — หนึ่งอันต่อหนึ่งเทสต์ที่แก้ข้อมูล (ข้าม / ไม่เกี่ยวข้อง / วาง URL)
  // ต้องมีให้พอ ไม่งั้นเทสต์จะไหลไปโดนข่าวจริงในคิว
  const leads = [1, 2, 3].map((n) => ({
    url_key: `e2e-lead-${stamp}-${n}`,
    gnews_link: `https://news.google.com/rss/articles/E2E${stamp}${n}`,
    news_agency: 'สำนักข่าวทดสอบ',
    title: `${TAG} ทดสอบยืนยันลิงก์ รายการที่ ${n} — เมาแล้วขับชนเสาไฟฟ้า`,
    screen_status: 'needs_url',
    screen_score: 12,
    // ต้องใหม่กว่าข่าวจริงเสมอ เพราะหน้าจอเรียงตาม published_at จากใหม่ไปเก่า
    // ถ้าเรียงทีหลัง เทสต์จะไปกดปุ่ม "ไม่เกี่ยวข้อง" ใส่ lead ข่าวจริงแทน (เคยเกิดขึ้นมาแล้ว)
    published_at: new Date(Date.now() + 86_400_000).toISOString(),
  }));
  const { data: leadRows, error: leadErr } = await db.from('articles').insert(leads).select('id');
  if (leadErr) throw new Error(`สร้าง lead ทดสอบไม่สำเร็จ: ${leadErr.message}`);

  console.log(
    JSON.stringify({
      email,
      password: PASSWORD,
      incidentSeq: incident.seq,
      leadIds: (leadRows ?? []).map((r) => r.id),
    })
  );
}

const cmd = process.argv[2];
if (cmd === 'setup') void setup();
else if (cmd === 'teardown') void teardown();
else {
  console.error('ใช้: tsx scripts/e2e-fixture.ts setup | teardown');
  process.exit(1);
}
