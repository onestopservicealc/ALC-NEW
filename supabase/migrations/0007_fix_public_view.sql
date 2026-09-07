-- =============================================================================
-- Migration 0007: ทำให้หน้าสถิติสาธารณะกลับมาแสดงข้อมูลได้
--
-- อาการ: ผู้ที่ไม่ล็อกอินเปิดหน้าเว็บแล้วเห็น "โหลดข้อมูลไม่สำเร็จ: permission denied
--        for table incidents" และเห็น 0 เคส — หน้าสาธารณะใช้งานไม่ได้เลย
--
-- สาเหตุ: view `incidents_public` ทำงานแบบ security invoker (ใช้สิทธิ์ของผู้เรียก)
--        จึงต้องให้ anon มี SELECT บนตาราง `incidents` ด้วย
--        migration 0006 ถอนสิทธิ์นั้นออกไป (ถูกต้องแล้ว — ไม่ควรให้ anon แตะตารางฐาน)
--        view จึงพังตามไปด้วย
--
-- ที่ผ่านมาตรวจไม่เจอเพราะ view คืน 200 พร้อม [] ซึ่งแยกไม่ออกระหว่าง
-- "ฐานข้อมูลว่าง" กับ "ถูก RLS กรองออกหมด" — การทดสอบเดิมเช็คแค่ว่าไม่ error
--
-- ทางแก้: บังคับให้ view ทำงานด้วยสิทธิ์ของเจ้าของ (postgres ซึ่งมี BYPASSRLS)
--        anon จึงอ่าน view ได้โดยไม่ต้องมีสิทธิ์บนตารางฐาน — ตรงตามที่ออกแบบไว้แต่แรก
-- =============================================================================

-- สร้าง view ใหม่ให้แน่ใจว่าเจ้าของและ option ถูกต้อง
drop view if exists public.incidents_public;

create view public.incidents_public
with (security_invoker = false)   -- ใช้สิทธิ์เจ้าของ ไม่ใช่ของผู้เรียก
as
select
  seq,
  news_type, url, news_agency, news_title,
  incident_date, incident_time,
  province, district, sub_district, incident_location, location_other,
  -- perpetrator_name ตัดออก
  perpetrator_gender, perpetrator_age, perpetrator_occupation,
  perpetrator_occupation_detail, perpetrator_weapon,
  alcohol_test_method, alcohol_level, drinking_location, beverage_type, test_duration,
  recidivism, drug_use, drug_use_detail,
  total_affected, total_death, total_injury, public_property_damage,
  -- victim_1_name / victim_2_name / victim_3_name ตัดออก
  victim_1_gender, victim_1_age, victim_1_occupation, victim_1_injury_type, victim_1_relation_to_perpetrator,
  victim_2_gender, victim_2_age, victim_2_occupation, victim_2_injury_type, victim_2_relation_to_perpetrator,
  victim_3_gender, victim_3_age, victim_3_occupation, victim_3_injury_type, victim_3_relation_to_perpetrator,
  news_summary,
  alcohol_involved, alcohol_role
from public.incidents
where status = 'approved';

alter view public.incidents_public owner to postgres;

grant select on public.incidents_public to anon, authenticated;

-- ตารางฐานยังต้องปิดสนิทสำหรับ anon (ยืนยันซ้ำจาก 0006)
revoke all on public.incidents from anon;

-- -----------------------------------------------------------------------------
-- ตรวจผล
-- -----------------------------------------------------------------------------

-- 1. view ต้องเป็น security_invoker = false (หรือไม่มี option นี้เลย = ค่าเริ่มต้น false)
select
  c.relname as view_name,
  pg_get_userbyid(c.relowner) as owner,
  coalesce(array_to_string(c.reloptions, ', '), '(ค่าเริ่มต้น = security_invoker false)') as options
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'incidents_public';

-- 2. anon ต้องอ่าน view ได้ แต่อ่านตารางฐานไม่ได้
select
  has_table_privilege('anon', 'public.incidents_public', 'SELECT') as anon_อ่าน_view_ได้,
  has_table_privilege('anon', 'public.incidents', 'SELECT')        as anon_อ่านตารางฐานได้;
-- ที่ควรเห็น: true, false

-- 3. view ต้องคืนข้อมูลจริง ไม่ใช่ 0 แถว และต้องไม่มีคอลัมน์ชื่อบุคคล
select count(*) as จำนวนเคสที่เผยแพร่ได้ from public.incidents_public;

select string_agg(column_name, ', ') as คอลัมน์ที่เป็นชื่อบุคคล
from information_schema.columns
where table_schema = 'public' and table_name = 'incidents_public' and column_name like '%_name';
-- ที่ควรเห็น: null (ไม่มีคอลัมน์ชื่อบุคคลเลย)
