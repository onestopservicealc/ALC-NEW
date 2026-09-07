/**
 * ดูเคสที่รอตรวจสอบจากบรรทัดคำสั่ง — ใช้ตรวจคุณภาพการสกัดเร็วๆ โดยไม่ต้องเปิดหน้าเว็บ
 *
 *   npm run queue:show
 */
import './_env';
import { createClient } from '@supabase/supabase-js';
async function main() {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data } = await db.from('incidents')
    .select('seq,duplicate_of,news_title,news_agency,news_type,incident_date,province,district,perpetrator_gender,perpetrator_age,alcohol_test_method,alcohol_level,beverage_type,drinking_location,perpetrator_weapon,total_death,total_injury,drug_use,alcohol_involved,alcohol_role,ai_confidence,ai_adjusted_fields,news_summary')
    .eq('status', 'pending').order('seq');
  for (const r of data ?? []) {
    const dup = r.duplicate_of ? '  ⚠ สงสัยซ้ำ' : '';
    console.log(`\n── #${r.seq}  [${r.news_agency}]  มั่นใจ ${r.ai_confidence}${dup}`);
    console.log(`   ${r.news_title}`);
    console.log(`   ประเภท: ${r.news_type} · ${r.incident_date ?? 'ไม่ระบุวัน'} · ${r.province || '-'} ${r.district || ''}`);
    console.log(`   ผู้ก่อเหตุ: ${r.perpetrator_gender || '-'} ${r.perpetrator_age ?? '-'} ปี · อาวุธ ${r.perpetrator_weapon || '-'}`);
    console.log(`   แอลกอฮอล์: ${r.alcohol_test_method || 'ไม่ระบุวิธีตรวจ'} · ${r.alcohol_level ?? '-'} mg% · ${r.beverage_type || '-'} · ดื่มที่ ${r.drinking_location || '-'}`);
    console.log(`   เกี่ยวข้อง: ${r.alcohol_involved} (${r.alcohol_role || '-'}) · ยาเสพติด ${r.drug_use || '-'}`);
    console.log(`   ผลกระทบ: เสียชีวิต ${r.total_death ?? 0} · บาดเจ็บ ${r.total_injury ?? 0}`);
    if (r.ai_adjusted_fields?.length) console.log(`   ระบบดัดค่า: ${r.ai_adjusted_fields.join(', ')}`);
    console.log(`   สรุป: ${String(r.news_summary).slice(0, 150)}`);
  }
  console.log(`\nรวม ${data?.length ?? 0} เคสรอตรวจสอบ`);
}
void main();
