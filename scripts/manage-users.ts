/**
 * จัดการผู้ใช้และสิทธิ์
 *
 * ระบบปิดการสมัครสมาชิกสาธารณะ ผู้ใช้ใหม่ต้องถูกเชิญและได้สิทธิ์ `viewer` โดยอัตโนมัติ
 * การเลื่อนขั้นทำได้เฉพาะผ่านทางนี้ (ใช้ service role key ซึ่งข้าม RLS)
 * เพราะ RLS ตั้งใจห้ามผู้ใช้เปลี่ยน role ของตัวเอง
 *
 *   npm run user:list
 *   npm run user:role -- --email name@example.com --role admin
 *
 * สิทธิ์:
 *   viewer  ดูข้อมูลเต็มรวมชื่อบุคคล แต่แก้ไข/อนุมัติไม่ได้
 *   editor  บันทึก แก้ไข อนุมัติ/ปฏิเสธ สั่งดึงข่าว
 *   admin   ทุกอย่าง + จัดการแหล่งข่าว + ลบข้อมูล
 */
import './_env';
import { createClient } from '@supabase/supabase-js';

const ROLES = ['viewer', 'editor', 'admin'] as const;
type Role = (typeof ROLES)[number];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('\nยังไม่ได้ตั้ง SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ใน .env.local\n');
    process.exit(1);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: authData, error: authError } = await db.auth.admin.listUsers();
  if (authError) {
    console.error(`อ่านรายชื่อผู้ใช้ไม่ได้: ${authError.message}`);
    process.exit(1);
  }

  const email = arg('email');
  const role = arg('role') as Role | undefined;

  /* ---------------- เปลี่ยนสิทธิ์ ---------------- */
  if (email && role) {
    if (!ROLES.includes(role)) {
      console.error(`\nrole ต้องเป็นค่าใดค่าหนึ่ง: ${ROLES.join(' | ')}\n`);
      process.exit(1);
    }

    const user = authData.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (!user) {
      console.error(`\nไม่พบผู้ใช้อีเมล ${email}`);
      console.error('สร้างผู้ใช้ก่อนที่ Supabase Dashboard → Authentication → Users → Add user\n');
      process.exit(1);
    }

    // trigger handle_new_user ควรสร้าง profile ให้แล้ว แต่เผื่อกรณีที่ผู้ใช้ถูกสร้างก่อนติดตั้ง trigger
    const { error } = await db
      .from('profiles')
      .upsert({ id: user.id, role, full_name: user.email }, { onConflict: 'id' });

    if (error) {
      console.error(`\nเปลี่ยนสิทธิ์ไม่สำเร็จ: ${error.message}\n`);
      process.exit(1);
    }

    console.log(`\n✓ ${user.email} → สิทธิ์ ${role}`);
    if (!user.email_confirmed_at) {
      console.log('  ⚠ อีเมลนี้ยังไม่ยืนยัน จะเข้าสู่ระบบไม่ได้ — ยืนยันได้ที่ Dashboard → Users');
    }
    console.log('  ถ้าเปิดหน้าเว็บอยู่ ให้ออกจากระบบแล้วเข้าใหม่ เพื่อให้โหลดสิทธิ์ใหม่\n');
  }

  /* ---------------- แสดงรายชื่อ ---------------- */
  const { data: profiles } = await db.from('profiles').select('id, role, full_name');
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));

  console.log(`ผู้ใช้ทั้งหมด ${authData.users.length} คน`);
  console.log('─'.repeat(72));
  for (const u of authData.users) {
    const profile = byId.get(u.id);
    const roleText = profile?.role ?? '(ไม่มี profile)';
    const confirmed = u.email_confirmed_at ? '' : '  ⚠ ยังไม่ยืนยันอีเมล';
    console.log(`  ${String(u.email).padEnd(34)} ${roleText.padEnd(8)}${confirmed}`);
  }
  console.log('─'.repeat(72));

  const admins = authData.users.filter((u) => byId.get(u.id)?.role === 'admin').length;
  const editors = authData.users.filter((u) => byId.get(u.id)?.role === 'editor').length;
  if (admins === 0) {
    console.log('\n⚠ ยังไม่มี admin — จะจัดการแหล่งข่าวและลบข้อมูลไม่ได้');
    console.log('  npm run user:role -- --email <อีเมล> --role admin');
  }
  if (admins + editors === 0) {
    console.log('⚠ ยังไม่มีใครมีสิทธิ์อนุมัติข้อมูล — คิวตรวจสอบจะใช้งานไม่ได้');
  }
  console.log('');
}

void main();
