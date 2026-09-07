-- =============================================================================
-- Migration 0005: ปรับการตรวจจับข่าวซ้ำให้จับได้จริง
--
-- ปัญหาที่พบจากการรันจริง: เหตุการณ์เดียวกัน (ชายวัย 52 ปี ขี่ จยย. ป่วนวัดป่าอดุลยาราม
-- ขอนแก่น 19 ส.ค.) ถูกบันทึกเป็น 3 เคสแยกกันจาก 3 สำนักข่าว โดยไม่มีอันไหนถูกตั้งธงว่าซ้ำ
--
--   #3 ไทยโพสต์  "เอฟซี 'ป้าดา' เป่าแอลกอฮอล์สูงถึง 264 รับดื่มเหล้าขาว 1 ขวด ก่อนขี่จยย.ป่วนวัด"
--   #5 มติชน     "รวบชายวัย 52 ปี ขี่ จยย.บุก 'วัดป่าอดุลยาราม' กลางดึก ลั่นเป็น FC ป้าดา..."
--   #7 ไทยโพสต์  "รวบแล้วชายบุกวัดกลางดึก ยอมรับเป็นเอฟซี 'ป้าดา' ดื่มสุราขี่จยย.ป่วนวัดอีกรอบ..."
--
-- สาเหตุ: ของเดิมตัดสินจากความคล้ายของพาดหัวอย่างเดียว (เกณฑ์ 0.35)
-- แต่สำนักข่าวไทยตั้งพาดหัวต่างกันมากสำหรับข่าวเดียวกัน — เล่นมุกคนละแบบ
-- เน้นคนละประเด็น ใช้คำต่างกัน trigram similarity จึงต่ำแม้เป็นเหตุการณ์เดียวกัน
--
-- แนวทางใหม่: ให้คะแนนจากหลายสัญญาณรวมกัน โดยวันที่+จังหวัดเป็นตัวกรองหลัก
-- (ซึ่งแม่นมาก) แล้วใช้อายุผู้ก่อเหตุและความคล้ายพาดหัวเป็นตัวยืนยัน
--
-- หมายเหตุ: ฟังก์ชันนี้แค่ "ตั้งธงให้คนดู" ไม่ได้รวมเคสอัตโนมัติ
-- การตั้งค่าให้ไวเกินไปจึงเสียหายน้อยกว่าการปล่อยข่าวซ้ำหลุดเข้าสถิติ
-- =============================================================================

drop function if exists public.find_duplicate_incident(date, text, text, real);

create or replace function public.find_duplicate_incident(
  p_date        date,
  p_province    text,
  p_title       text,
  p_threshold   real default 0.35,   -- คงพารามิเตอร์เดิมไว้เพื่อความเข้ากันได้
  p_age         int  default null,
  p_perpetrator text default null
)
returns table (
  id         uuid,
  seq        bigint,
  news_title text,
  sim        real,
  reason     text
)
language sql
stable
security definer
set search_path = public
as $$
  with scored as (
    select
      i.id,
      i.seq,
      i.news_title,
      similarity(i.news_title, p_title) as title_sim,
      -- วันเดียวกันเป๊ะเป็นสัญญาณแรงที่สุด ต่างกัน 1 วันยังนับได้ (ข่าวข้ามเที่ยงคืน)
      (i.incident_date is not null and p_date is not null and i.incident_date = p_date) as same_day,
      (i.incident_date is not null and p_date is not null and abs(i.incident_date - p_date) = 1) as near_day,
      (nullif(i.province,'') is not distinct from nullif(p_province,'') and nullif(p_province,'') is not null) as same_province,
      (i.perpetrator_age is not null and p_age is not null and i.perpetrator_age = p_age) as same_age,
      (
        nullif(i.perpetrator_name,'') is not null and nullif(p_perpetrator,'') is not null
        and similarity(i.perpetrator_name, p_perpetrator) > 0.6
      ) as same_person
    from public.incidents i
    where i.status <> 'rejected'
      and p_title is not null
      and (
        p_date is null or i.incident_date is null
        or abs(i.incident_date - p_date) <= 1
      )
  )
  select
    id,
    seq,
    news_title,
    title_sim as sim,
    concat_ws(' + ',
      case when same_day then 'วันเดียวกัน' when near_day then 'วันติดกัน' end,
      case when same_province then 'จังหวัดเดียวกัน' end,
      case when same_age then 'อายุผู้ก่อเหตุตรงกัน' end,
      case when same_person then 'ชื่อผู้ก่อเหตุตรงกัน' end,
      case when title_sim >= p_threshold then 'พาดหัวคล้ายกัน' end
    ) as reason
  from scored
  where
    -- ชื่อผู้ก่อเหตุตรงกัน = แทบจะแน่นอน
    same_person
    -- วันเดียวกัน + จังหวัดเดียวกัน + อายุตรงกัน = แทบจะแน่นอนเช่นกัน
    or (same_day and same_province and same_age)
    -- วันเดียวกัน + จังหวัดเดียวกัน: ให้ผ่านด้วยพาดหัวคล้ายเพียงเล็กน้อยก็พอ
    -- เพราะตัวกรองวัน+จังหวัดแคบมากอยู่แล้ว
    or (same_day and same_province and title_sim >= 0.12)
    -- ไม่มีจังหวัด (ข่าวไม่ระบุ) แต่วันเดียวกันและพาดหัวคล้ายพอสมควร
    or (same_day and title_sim >= 0.25)
    -- เกณฑ์เดิม: พาดหัวคล้ายกันมากโดยไม่ต้องพึ่งวัน/จังหวัด
    or title_sim >= p_threshold
  order by
    same_person desc,
    (same_day and same_province and same_age) desc,
    title_sim desc
  limit 5;
$$;

revoke all on function public.find_duplicate_incident(date, text, text, real, int, text) from public, anon;
grant execute on function public.find_duplicate_incident(date, text, text, real, int, text)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- ตั้งธงย้อนหลังให้เคสที่บันทึกไปแล้วก่อนแก้ฟังก์ชันนี้
-- -----------------------------------------------------------------------------
update public.incidents t
set duplicate_of = (
  select d.id
  from public.find_duplicate_incident(
    t.incident_date, t.province, t.news_title, 0.35, t.perpetrator_age, t.perpetrator_name
  ) d
  where d.id <> t.id
    and d.seq < t.seq          -- ชี้ไปที่เคสที่มาก่อน เพื่อไม่ให้ชี้วนกันไปมา
  order by d.seq
  limit 1
)
where t.duplicate_of is null
  and t.status = 'pending';

-- ตรวจผล: เคสที่ถูกตั้งธงว่าซ้ำ
select seq, news_agency, left(news_title, 60) as title, duplicate_of is not null as ซ้ำ
from public.incidents
where status = 'pending'
order by seq;
