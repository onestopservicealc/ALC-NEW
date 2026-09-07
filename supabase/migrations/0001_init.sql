-- =============================================================================
-- ระบบเฝ้าระวังข่าวความรุนแรงและอุบัติเหตุจากเครื่องดื่มแอลกอฮอล์
-- Migration 0001: schema + RLS + view สาธารณะที่ตัด PII
--
-- หลักการ: 49 ฟิลด์ตาม "โครงสร้างข้อมูล.xlsx" คงชื่อและชนิดเดิมทุกตัว
--          คอลัมน์ระบบเพิ่มแยก และไม่อยู่ใน CSV export
-- =============================================================================

create extension if not exists pg_trgm;

-- -----------------------------------------------------------------------------
-- profiles : ผูกกับ auth.users เพื่อเก็บ role
-- -----------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  role        text not null default 'viewer' check (role in ('viewer','editor','admin')),
  created_at  timestamptz not null default now()
);

comment on table public.profiles is 'สิทธิ์ผู้ใช้: viewer=ดูอย่างเดียว, editor=บันทึก/อนุมัติได้, admin=จัดการแหล่งข่าวและลบได้';

-- สร้าง profile อัตโนมัติเมื่อมี user ใหม่ (role เริ่มต้น = viewer)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- helper: อ่าน role ของผู้ใช้ปัจจุบัน (security definer เพื่อเลี่ยง RLS recursion)
create or replace function public.current_role_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'anon');
$$;

create or replace function public.is_editor()
returns boolean language sql stable as $$
  select public.current_role_name() in ('editor','admin');
$$;

create or replace function public.is_admin()
returns boolean language sql stable as $$
  select public.current_role_name() = 'admin';
$$;

-- -----------------------------------------------------------------------------
-- sources : ทะเบียนฟีดข่าว
-- เก็บเป็นข้อมูลใน DB ไม่ hardcode เพราะจากการทดสอบ 20 ฟีด มี 8 ฟีดที่ตาย/ย้ายแล้ว
-- -----------------------------------------------------------------------------
create table public.sources (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,                    -- ชื่อสำนักข่าว → ใช้เป็น news_agency
  kind                text not null check (kind in ('outlet_rss','google_news')),
  feed_url            text not null unique,
  query               text,                             -- คำค้น (เฉพาะ google_news)
  domain              text,
  enabled             boolean not null default true,
  has_full_text       boolean not null default false,   -- ฟีดส่ง content:encoded มาด้วยไหม
  poll_priority       int not null default 100,         -- น้อย = ดึงก่อน
  last_polled_at      timestamptz,
  last_ok_at          timestamptz,
  last_item_count     int,
  consecutive_errors  int not null default 0,
  last_error          text,
  created_at          timestamptz not null default now()
);

create index sources_enabled_idx on public.sources (enabled, poll_priority);

-- -----------------------------------------------------------------------------
-- articles : คิวข่าวดิบ (เก็บทั้งที่ผ่านและไม่ผ่าน เพื่อใช้จูน keyword filter)
-- -----------------------------------------------------------------------------
create table public.articles (
  id                uuid primary key default gen_random_uuid(),
  source_id         uuid references public.sources(id) on delete set null,
  url_key           text not null unique,               -- canonical URL (ตัด utm_*, lowercase host)
  url               text,                               -- URL ต้นทางจริง (null สำหรับ lead จาก Google News)
  gnews_link        text,                               -- ลิงก์ news.google.com (ถอดเป็น URL จริงไม่ได้)
  news_agency       text,
  title             text not null,
  published_at      timestamptz,
  rss_summary       text,
  full_text         text,                               -- ลบทิ้งหลังสกัดเสร็จ
  full_text_source  text check (full_text_source in ('content_encoded','page_fetch','manual')),
  screen_score      int,
  screen_status     text not null default 'new' check (screen_status in (
                      'new',            -- เพิ่งดึงมา ยังไม่คัดกรอง
                      'keyword_pass',   -- ผ่าน keyword filter รอ AI
                      'keyword_reject', -- ไม่ผ่าน keyword filter
                      'ai_reject',      -- AI บอกว่าไม่เกี่ยวกับแอลกอฮอล์
                      'extracted',      -- สกัด 49 ฟิลด์แล้ว
                      'needs_url',      -- lead จาก Google News รอเจ้าหน้าที่ยืนยัน URL
                      'fetch_failed'    -- ดึงเนื้อข่าวไม่สำเร็จ
                    )),
  screen_reason     text,
  ai_confidence     numeric,
  attempts          int not null default 0,
  created_at        timestamptz not null default now(),
  processed_at      timestamptz
);

create index articles_queue_idx   on public.articles (screen_status, published_at desc nulls last);
create index articles_created_idx on public.articles (created_at desc);

-- -----------------------------------------------------------------------------
-- incidents : 49 ฟิลด์ตามสเปก + คอลัมน์ระบบ
-- -----------------------------------------------------------------------------
create table public.incidents (
  id    uuid   primary key default gen_random_uuid(),
  seq   bigint generated always as identity,  -- ฟิลด์ 1 "ลำดับ" สำหรับ CSV export

  -- ---- ข้อมูลข่าวและแหล่งที่มา (2-5) ----
  news_type                        text,
  url                              text not null,          -- Not Null ตามสเปก
  news_agency                      text not null,          -- Not Null ตามสเปก
  news_title                       text not null,          -- Not Null ตามสเปก

  -- ---- วันเวลาและสถานที่ (6-12) ----
  incident_date                    date,
  incident_time                    text,                   -- HH:MM
  province                         text,
  district                         text,
  sub_district                     text,
  incident_location                text,
  location_other                   text,

  -- ---- ผู้ก่อเหตุ (13-18) ----
  perpetrator_name                 text,
  perpetrator_gender               text,
  perpetrator_age                  int check (perpetrator_age is null or perpetrator_age between 1 and 120),
  perpetrator_occupation           text,
  perpetrator_occupation_detail    text,
  perpetrator_weapon               text,

  -- ---- แอลกอฮอล์และสารเสพติด (19-26) ----
  alcohol_test_method              text,
  alcohol_level                    int check (alcohol_level is null or alcohol_level between 0 and 1000),
  drinking_location                text,
  beverage_type                    text,
  test_duration                    int,
  recidivism                       text,
  drug_use                         text,
  drug_use_detail                  text,

  -- ---- ผลกระทบและความเสียหาย (27-30) ----
  total_affected                   int,
  total_death                      int,
  total_injury                     int,
  public_property_damage           text,

  -- ---- เหยื่อ 1-3 (31-48) ----
  victim_1_name                    text,
  victim_1_gender                  text,
  victim_1_age                     int check (victim_1_age is null or victim_1_age between 1 and 120),
  victim_1_occupation              text,
  victim_1_injury_type             text,
  victim_1_relation_to_perpetrator text,
  victim_2_name                    text,
  victim_2_gender                  text,
  victim_2_age                     int check (victim_2_age is null or victim_2_age between 1 and 120),
  victim_2_occupation              text,
  victim_2_injury_type             text,
  victim_2_relation_to_perpetrator text,
  victim_3_name                    text,
  victim_3_gender                  text,
  victim_3_age                     int check (victim_3_age is null or victim_3_age between 1 and 120),
  victim_3_occupation              text,
  victim_3_injury_type             text,
  victim_3_relation_to_perpetrator text,

  -- ---- สรุป (49) ----
  news_summary                     text not null,          -- Not Null ตามสเปก

  -- ======== คอลัมน์ระบบ (ไม่อยู่ใน CSV export 49 คอลัมน์) ========
  status             text not null default 'pending' check (status in ('pending','approved','rejected')),
  alcohol_involved   boolean,          -- แทน heuristic เดิมที่นับจาก beverage_type มีค่า
  alcohol_role       text check (alcohol_role is null or alcohol_role in
                       ('ผู้ก่อเหตุดื่ม','เหยื่อดื่ม','ทั้งสองฝ่ายดื่ม','ไม่ชัดเจน')),
  source_article_id  uuid references public.articles(id) on delete set null,
  ai_model           text,
  ai_confidence      numeric,
  ai_raw             jsonb,
  ai_adjusted_fields text[],           -- ฟิลด์ที่ normalizer ดัดค่า → ไฮไลต์ในคิวตรวจสอบ
  duplicate_of       uuid references public.incidents(id) on delete set null,
  created_by         uuid references auth.users(id) on delete set null,
  reviewed_by        uuid references auth.users(id) on delete set null,
  reviewed_at        timestamptz,
  review_note        text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- กฎธุรกิจระดับฐานข้อมูล: สังเกตุอาการ ห้ามมี alcohol_level
  constraint alcohol_level_requires_measurement check (
    alcohol_test_method is distinct from 'สังเกตุอาการ' or alcohol_level is null
  )
);

create index incidents_status_idx    on public.incidents (status, incident_date desc nulls last);
create index incidents_province_idx  on public.incidents (province) where status = 'approved';
create index incidents_date_idx      on public.incidents (incident_date desc) where status = 'approved';
create index incidents_title_trgm    on public.incidents using gin (news_title gin_trgm_ops);
create index incidents_article_idx   on public.incidents (source_article_id);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger incidents_touch_updated_at
  before update on public.incidents
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- incident_revisions : audit log (งานราชการต้องตรวจย้อนหลังได้)
-- -----------------------------------------------------------------------------
create table public.incident_revisions (
  id           uuid primary key default gen_random_uuid(),
  incident_id  uuid not null references public.incidents(id) on delete cascade,
  action       text not null check (action in ('create','update','approve','reject','merge','delete')),
  changed_by   uuid references auth.users(id) on delete set null,
  diff         jsonb,
  note         text,
  created_at   timestamptz not null default now()
);

create index incident_revisions_idx on public.incident_revisions (incident_id, created_at desc);

-- -----------------------------------------------------------------------------
-- ingest_runs : log การดึงข่าวแต่ละรอบ
-- -----------------------------------------------------------------------------
create table public.ingest_runs (
  id                uuid primary key default gen_random_uuid(),
  trigger           text not null check (trigger in ('cron','manual')),
  triggered_by      uuid references auth.users(id) on delete set null,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  feeds_polled      int not null default 0,
  feeds_failed      int not null default 0,
  articles_new      int not null default 0,
  keyword_passed    int not null default 0,
  keyword_rejected  int not null default 0,
  ai_screened       int not null default 0,
  ai_rejected       int not null default 0,
  incidents_created int not null default 0,
  duplicates_found  int not null default 0,
  errors            jsonb not null default '[]'::jsonb,
  notes             text
);

create index ingest_runs_idx on public.ingest_runs (started_at desc);

-- =============================================================================
-- View สาธารณะ : ตัดชื่อบุคคลออกทั้งหมด
-- dashboard เปิดสาธารณะ และข้อมูลมีชื่อผู้ก่อเหตุ/เหยื่อ (บางรายเป็นผู้เยาว์)
-- =============================================================================
create view public.incidents_public as
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

-- ให้ view รันด้วยสิทธิ์เจ้าของ เพื่อข้าม RLS ของตารางฐาน (anon แตะ incidents ตรงๆ ไม่ได้)
alter view public.incidents_public set (security_invoker = false);

grant select on public.incidents_public to anon, authenticated;

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.profiles           enable row level security;
alter table public.sources            enable row level security;
alter table public.articles           enable row level security;
alter table public.incidents          enable row level security;
alter table public.incident_revisions enable row level security;
alter table public.ingest_runs        enable row level security;

-- profiles: อ่านของตัวเองได้, admin อ่าน/แก้ได้ทุกคน
create policy profiles_self_read   on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (
    -- ผู้ใช้ทั่วไปเปลี่ยน role ตัวเองไม่ได้
    public.is_admin() or role = public.current_role_name()
  );
create policy profiles_admin_all   on public.profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- sources: ผู้ล็อกอินอ่านได้, admin แก้ได้
create policy sources_read      on public.sources for select to authenticated using (true);
create policy sources_admin_all on public.sources for all    to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- articles: ผู้ล็อกอินอ่านได้, editor แก้ได้ (เช่น เติม URL ให้ lead จาก Google News)
create policy articles_read       on public.articles for select to authenticated using (true);
create policy articles_editor_upd on public.articles for update to authenticated
  using (public.is_editor()) with check (public.is_editor());
create policy articles_admin_del  on public.articles for delete to authenticated using (public.is_admin());

-- incidents: anon แตะไม่ได้เลย (ใช้ incidents_public แทน)
create policy incidents_auth_read on public.incidents for select to authenticated using (true);
create policy incidents_editor_insert on public.incidents for insert to authenticated
  with check (public.is_editor());
create policy incidents_editor_update on public.incidents for update to authenticated
  using (public.is_editor()) with check (public.is_editor());
create policy incidents_admin_delete on public.incidents for delete to authenticated
  using (public.is_admin());

-- revisions: ผู้ล็อกอินอ่านได้, editor เขียนได้, ห้ามแก้/ลบ (append-only)
create policy revisions_read   on public.incident_revisions for select to authenticated using (true);
create policy revisions_insert on public.incident_revisions for insert to authenticated
  with check (public.is_editor());

-- ingest_runs: ผู้ล็อกอินอ่านได้ (เขียนผ่าน service role เท่านั้น)
create policy ingest_runs_read on public.ingest_runs for select to authenticated using (true);
