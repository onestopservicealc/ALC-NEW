/**
 * ทดสอบ Row Level Security ด้วยผู้ใช้ที่ล็อกอินจริง
 *
 * นี่คือส่วนที่เสี่ยงที่สุดและตรวจด้วยการอ่านโค้ดไม่ได้ — policy บน `profiles`
 * เรียก `current_role_name()` ซึ่งไปอ่าน `profiles` เอง ถ้าตั้งไม่ถูกจะเกิด recursion
 * และ policy การเขียนต้องกัน viewer ไม่ให้อนุมัติข้อมูลได้จริง
 *
 * สร้างผู้ใช้ทดสอบขึ้นมาชั่วคราวแล้วลบทิ้ง ไม่แตะบัญชีจริง
 * ถ้าเทสต์แก้สถานะเคสใด จะคืนค่าเดิมให้เสมอ
 *
 *   npm run check:rls
 */
import './_env';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const PASSWORD = `Test-${Math.random().toString(36).slice(2)}-${Date.now()}`;
const STAMP = Date.now();
const ACCOUNTS = {
  viewer: `rls-viewer-${STAMP}@example.com`,
  editor: `rls-editor-${STAMP}@example.com`,
};

let failures = 0;
function check(ok: boolean, label: string, detail = '') {
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✕'} ${label}${detail ? `  — ${detail}` : ''}`);
}

async function main() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !serviceKey || !anonKey) {
    console.error('\nต้องมี SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY และ VITE_SUPABASE_ANON_KEY\n');
    process.exit(1);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const createdIds: string[] = [];

  /** ล็อกอินเป็นผู้ใช้ที่ระบุ แล้วคืน client ที่ผูก session นั้น */
  async function signIn(email: string): Promise<SupabaseClient | null> {
    const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
    if (error) {
      console.log(`  ✕ ล็อกอิน ${email} ไม่สำเร็จ — ${error.message}`);
      failures++;
      return null;
    }
    return client;
  }

  try {
    /* ---------- เตรียมผู้ใช้ทดสอบ ---------- */
    console.log('\nเตรียมผู้ใช้ทดสอบ');
    for (const [role, email] of Object.entries(ACCOUNTS)) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) {
        console.error(`  สร้างผู้ใช้ ${email} ไม่สำเร็จ: ${error?.message}`);
        process.exit(1);
      }
      createdIds.push(data.user.id);
      // ทดสอบ trigger handle_new_user ว่าสร้าง profile ให้จริง
      const { data: profile } = await admin
        .from('profiles')
        .select('role')
        .eq('id', data.user.id)
        .maybeSingle();
      check(Boolean(profile), `trigger สร้าง profile ให้ ${role} อัตโนมัติ`, `role เริ่มต้น = ${profile?.role}`);
      check(profile?.role === 'viewer', `role เริ่มต้นเป็น viewer (ไม่ใช่สิทธิ์สูง)`);

      await admin.from('profiles').upsert({ id: data.user.id, role }, { onConflict: 'id' });
    }

    /* ---------- หาเคสสำหรับทดสอบ ---------- */
    const { data: target } = await admin
      .from('incidents')
      .select('id, seq, status')
      .eq('status', 'pending')
      .limit(1)
      .maybeSingle();

    if (!target) {
      console.log('\n  – ข้ามการทดสอบอนุมัติ (ไม่มีเคสสถานะ pending ในฐานข้อมูล)');
    }

    /* ---------- anon ---------- */
    console.log('\nผู้ที่ไม่ล็อกอิน (anon)');
    const anon = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data: anonIncidents } = await anon.from('incidents').select('id').limit(1);
    check((anonIncidents?.length ?? 0) === 0, 'อ่านตาราง incidents ไม่ได้');
    // ต้องเช็คว่า "ได้ข้อมูลจริง" ไม่ใช่แค่ "ไม่ error"
    // view ที่ทำงานแบบ invoker จะคืน 200 พร้อม [] ซึ่งแยกไม่ออกจากฐานข้อมูลว่าง
    // — ช่องโหว่นี้ทำให้หน้าสาธารณะพังโดยไม่มีใครรู้ (แก้ใน migration 0007)
    const { data: anonPublic, error: anonPublicErr } = await anon
      .from('incidents_public')
      .select('seq')
      .limit(5);
    check(!anonPublicErr, 'อ่าน view incidents_public ได้', anonPublicErr?.message.slice(0, 60));

    const { count: approvedCount } = await admin
      .from('incidents')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'approved');
    if ((approvedCount ?? 0) > 0) {
      check(
        (anonPublic?.length ?? 0) > 0,
        'view คืนข้อมูลจริงให้ผู้ไม่ล็อกอิน (ไม่ใช่ถูกกรองจนว่าง)',
        `มีเคสอนุมัติ ${approvedCount} แต่ anon เห็น ${anonPublic?.length ?? 0}`
      );
    } else {
      console.log('  – ข้ามการเช็คจำนวนแถวใน view (ยังไม่มีเคสที่อนุมัติ)');
    }
    const { error: anonWriteErr } = await anon
      .from('incidents')
      .update({ status: 'approved' })
      .eq('status', 'pending');
    // RLS จะทำให้ไม่มีแถวไหนถูกแก้ (อาจไม่ error แต่ต้องไม่มีผล)
    const { count: approvedAfterAnon } = await admin
      .from('incidents')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'approved');
    check(
      Boolean(anonWriteErr) || approvedAfterAnon === 0,
      'เขียนตาราง incidents ไม่ได้',
      anonWriteErr ? anonWriteErr.message.slice(0, 40) : 'ไม่มีแถวถูกแก้'
    );

    /* ---------- viewer ---------- */
    console.log('\nสิทธิ์ viewer');
    const viewer = await signIn(ACCOUNTS.viewer);
    if (viewer) {
      const { data: rows, error } = await viewer.from('incidents').select('id, perpetrator_name').limit(1);
      check(!error, 'อ่านตาราง incidents ได้ (เห็นข้อมูลเต็ม)', error?.message.slice(0, 50));

      const { data: own, error: profErr } = await viewer.from('profiles').select('role').maybeSingle();
      check(!profErr, 'อ่าน profile ของตัวเองได้ (ไม่เกิด RLS recursion)', profErr?.message.slice(0, 60));
      check(own?.role === 'viewer', 'profile ของตัวเองรายงาน role ถูกต้อง');

      if (target) {
        const { error: upErr } = await viewer
          .from('incidents')
          .update({ status: 'approved' })
          .eq('id', target.id);
        const { data: after } = await admin
          .from('incidents')
          .select('status')
          .eq('id', target.id)
          .single();
        check(after?.status === 'pending', 'อนุมัติเคสไม่ได้ (ถูก RLS ปฏิเสธ)', upErr?.message.slice(0, 40) ?? 'สถานะไม่เปลี่ยน');
      }

      // viewer ต้องยกระดับสิทธิ์ตัวเองไม่ได้
      const { data: uid } = await viewer.auth.getUser();
      await viewer.from('profiles').update({ role: 'admin' }).eq('id', uid.user!.id);
      const { data: escalated } = await admin
        .from('profiles')
        .select('role')
        .eq('id', uid.user!.id)
        .single();
      check(escalated?.role === 'viewer', 'ยกระดับสิทธิ์ตัวเองเป็น admin ไม่ได้');
    }

    /* ---------- editor ---------- */
    console.log('\nสิทธิ์ editor');
    const editor = await signIn(ACCOUNTS.editor);
    if (editor && target) {
      const { error: upErr } = await editor
        .from('incidents')
        .update({ status: 'approved', reviewed_at: new Date().toISOString() })
        .eq('id', target.id);
      const { data: after } = await admin
        .from('incidents')
        .select('status')
        .eq('id', target.id)
        .single();
      check(after?.status === 'approved', `อนุมัติเคส #${target.seq} ได้`, upErr?.message.slice(0, 60));

      // คืนสถานะเดิมให้เสมอ ไม่ทิ้งผลข้างเคียงจากการทดสอบ
      await admin
        .from('incidents')
        .update({ status: target.status, reviewed_at: null, reviewed_by: null })
        .eq('id', target.id);
      const { data: restored } = await admin
        .from('incidents')
        .select('status')
        .eq('id', target.id)
        .single();
      check(restored?.status === target.status, 'คืนสถานะเดิมของเคสทดสอบแล้ว');

      const { error: srcErr } = await editor.from('sources').update({ enabled: true }).eq('kind', 'outlet_rss');
      check(Boolean(srcErr), 'แก้ตาราง sources ไม่ได้ (ต้องเป็น admin)', srcErr?.message.slice(0, 40) ?? 'แก้ได้ ← ผิด');

      const { error: revErr } = await editor
        .from('incident_revisions')
        .insert({ incident_id: target.id, action: 'update', note: 'ทดสอบ RLS' });
      check(!revErr, 'บันทึก audit log ได้', revErr?.message.slice(0, 50));
    }
  } finally {
    /* ---------- เก็บกวาด ---------- */
    console.log('\nลบผู้ใช้ทดสอบ');
    for (const id of createdIds) {
      const { error } = await admin.auth.admin.deleteUser(id);
      check(!error, `ลบผู้ใช้ ${id.slice(0, 8)}…`, error?.message);
    }
    await admin.from('incident_revisions').delete().eq('note', 'ทดสอบ RLS');
  }

  console.log(`\nสรุป: ${failures === 0 ? 'RLS ทำงานถูกต้องทั้งหมด' : `พบปัญหา ${failures} จุด`}\n`);
  if (failures > 0) process.exitCode = 1;
}

void main();
