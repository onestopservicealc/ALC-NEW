-- =============================================================================
-- Migration 0006: ให้สิทธิ์ระดับตารางแก่ role `authenticated`
--
-- บั๊กที่พบจากการทดสอบด้วยผู้ใช้ที่ล็อกอินจริง (npm run check:rls):
--   editor อนุมัติเคสไม่ได้ · บันทึก audit log ไม่ได้
--   error: "permission denied for table incidents"
--
-- สาเหตุ: migration 0001 เขียน RLS policy ไว้ครบ แต่ไม่เคย GRANT สิทธิ์ระดับตาราง
-- ใน Postgres ต้องผ่านสองชั้น — GRANT (ตาราง) แล้วจึงถึง RLS (แถว)
-- ถ้าไม่มี GRANT จะถูกปฏิเสธก่อนที่ policy จะได้ทำงาน ไม่ว่า policy จะเขียนถูกแค่ไหน
--
-- ที่ SELECT ใช้ได้อยู่แล้วเพราะ Supabase ตั้ง default privileges ให้เฉพาะการอ่าน
-- ส่วน INSERT/UPDATE/DELETE ต้องให้เอง
--
-- หลักการ: GRANT ให้กว้างพอที่แอปจะทำงาน แล้วให้ RLS เป็นตัวคุมว่าใครทำอะไรได้จริง
-- (policy ที่เขียนไว้ใน 0001 ตรวจ is_editor() / is_admin() อยู่แล้ว)
-- =============================================================================

-- incidents: อ่านได้ทุกคนที่ล็อกอิน · เขียนได้เฉพาะ editor/admin ตาม RLS
grant select, insert, update, delete on public.incidents to authenticated;

-- articles: อ่านได้ · editor แก้ได้ (เช่น เติม URL ให้ lead) · admin ลบได้
grant select, update, delete on public.articles to authenticated;

-- sources: อ่านได้ · admin จัดการได้
grant select, insert, update, delete on public.sources to authenticated;

-- incident_revisions: append-only — อ่านและเพิ่มได้ แต่ห้ามแก้/ลบประวัติ
grant select, insert on public.incident_revisions to authenticated;
revoke update, delete on public.incident_revisions from authenticated;

-- ingest_runs: อ่านอย่างเดียว (เขียนผ่าน service role ตอน cron)
grant select on public.ingest_runs to authenticated;
revoke insert, update, delete on public.ingest_runs from authenticated;

-- profiles: อ่าน/แก้ของตัวเองได้ (RLS กันการเปลี่ยน role ของตัวเอง)
grant select, update on public.profiles to authenticated;
revoke insert, delete on public.profiles from authenticated;

-- -----------------------------------------------------------------------------
-- ผู้ไม่ล็อกอินต้องแตะตารางฐานไม่ได้เลย — เห็นได้เฉพาะผ่าน view ที่ตัดชื่อบุคคลออกแล้ว
-- -----------------------------------------------------------------------------
revoke all on public.incidents           from anon;
revoke all on public.articles            from anon;
revoke all on public.sources             from anon;
revoke all on public.incident_revisions  from anon;
revoke all on public.ingest_runs         from anon;
revoke all on public.profiles            from anon;

grant select on public.incidents_public to anon, authenticated;

-- -----------------------------------------------------------------------------
-- ตรวจผล: สิทธิ์ระดับตารางของแต่ละ role
-- -----------------------------------------------------------------------------
select
  c.relname as ตาราง,
  r.rolname as role,
  string_agg(
    case
      when has_table_privilege(r.rolname, c.oid, p.priv) then p.priv
    end, ', ' order by p.priv
  ) as สิทธิ์
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) as p(priv)
cross join (select rolname from pg_roles where rolname in ('anon','authenticated')) r
where n.nspname = 'public'
  and c.relname in ('incidents','incidents_public','articles','sources','incident_revisions','ingest_runs','profiles')
group by c.relname, r.rolname
order by c.relname, r.rolname;
-- ที่ควรเห็น: anon มีสิทธิ์เฉพาะ SELECT บน incidents_public เท่านั้น
--             authenticated มี SELECT/INSERT/UPDATE/DELETE บน incidents
