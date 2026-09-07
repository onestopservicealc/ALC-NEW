-- =============================================================================
-- Migration 0004: ปิดช่องโหว่ — ฟังก์ชัน SECURITY DEFINER ที่ผู้ไม่ล็อกอินเรียกได้
--
-- ปัญหา: ใน Postgres ฟังก์ชันที่สร้างใหม่จะได้สิทธิ์ EXECUTE ให้ PUBLIC โดยปริยาย
--        การเขียน `grant execute ... to authenticated` ใน 0003 จึงไม่ได้ถอนสิทธิ์ PUBLIC ออก
--        ผลคือ role `anon` เรียกฟังก์ชันที่ตั้งใจให้ข้าม RLS ได้ทั้งหมด
--
-- ยืนยันด้วยการยิงจริงด้วย anon key ก่อนแก้ (ทั้งสามตัวคืน HTTP 200):
--   POST /rest/v1/rpc/find_similar_article     → พาดหัว + URL ของข่าวทุกสถานะ
--   POST /rest/v1/rpc/find_duplicate_incident  → news_title ของเคส pending / rejected
--   POST /rest/v1/rpc/queue_summary            → จำนวนงานในคิว
--
-- ถ้าไม่แก้ ข้อมูลที่ยังไม่ผ่านการตรวจสอบจะรั่วสู่สาธารณะ
-- ซึ่งล้มล้างเจตนาของ view `incidents_public` ที่ตัดชื่อบุคคลออก
-- =============================================================================

-- ── ถอนสิทธิ์ที่ได้มาโดยปริยาย ──────────────────────────────────────────────
revoke all on function public.find_similar_article(text, uuid, real)             from public, anon;
revoke all on function public.find_duplicate_incident(date, text, text, real)    from public, anon;
revoke all on function public.queue_summary()                                    from public, anon;
revoke all on function public.current_role_name()                                from public, anon;
revoke all on function public.is_editor()                                        from public, anon;
revoke all on function public.is_admin()                                         from public, anon;

-- ── ให้สิทธิ์เฉพาะ role ที่ต้องใช้จริง ───────────────────────────────────────
-- current_role_name / is_editor / is_admin ถูกเรียกจากภายใน RLS policy
-- จึงต้องคง authenticated ไว้ ไม่งั้น policy จะประเมินไม่ได้
grant execute on function public.find_similar_article(text, uuid, real)          to authenticated, service_role;
grant execute on function public.find_duplicate_incident(date, text, text, real) to authenticated, service_role;
grant execute on function public.queue_summary()                                 to authenticated, service_role;
grant execute on function public.current_role_name()                             to authenticated, service_role;
grant execute on function public.is_editor()                                     to authenticated, service_role;
grant execute on function public.is_admin()                                      to authenticated, service_role;

-- handle_new_user() และ touch_updated_at() เป็น trigger function (คืนชนิด trigger)
-- PostgREST เรียกผ่าน /rpc/ ไม่ได้อยู่แล้ว จึงไม่ต้องจัดการ

-- ── ตรวจผลหลังรัน ───────────────────────────────────────────────────────────
-- ต้องไม่มีแถวไหนที่ anon หรือ PUBLIC ยังมีสิทธิ์ execute เหลืออยู่
select
  p.proname as function_name,
  coalesce(
    array_to_string(
      array(
        select r.rolname
        from unnest(array['anon','authenticated','service_role']::text[]) as r(rolname)
        where has_function_privilege(r.rolname, p.oid, 'EXECUTE')
      ),
      ', '
    ),
    '(ไม่มี)'
  ) as can_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_ยังเรียกได้
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'find_similar_article', 'find_duplicate_incident', 'queue_summary',
    'current_role_name', 'is_editor', 'is_admin'
  )
order by p.proname;
-- คอลัมน์ anon_ยังเรียกได้ ต้องเป็น false ทั้ง 6 แถว
