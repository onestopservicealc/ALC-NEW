-- =============================================================================
-- Migration 0003: ฟังก์ชันช่วยงาน
-- =============================================================================

-- -----------------------------------------------------------------------------
-- หาเหตุการณ์ที่น่าจะเป็นข่าวเดียวกันแต่มาจากคนละสำนัก
-- เกณฑ์: วันเกิดเหตุห่างกันไม่เกิน 1 วัน + จังหวัดเดียวกัน + พาดหัวคล้ายกัน
-- -----------------------------------------------------------------------------
create or replace function public.find_duplicate_incident(
  p_date       date,
  p_province   text,
  p_title      text,
  p_threshold  real default 0.35
)
returns table (id uuid, seq bigint, news_title text, sim real)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.seq, i.news_title, similarity(i.news_title, p_title) as sim
  from public.incidents i
  where i.status <> 'rejected'
    and p_title is not null
    and (
      p_date is null or i.incident_date is null
      or abs(i.incident_date - p_date) <= 1
    )
    and (
      p_province is null or p_province = '' or i.province is null or i.province = ''
      or i.province = p_province
    )
    and similarity(i.news_title, p_title) >= p_threshold
  order by sim desc
  limit 5;
$$;

grant execute on function public.find_duplicate_incident(date, text, text, real) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- สรุปสถานะคิวงาน สำหรับหน้า Sources/Review
-- -----------------------------------------------------------------------------
create or replace function public.queue_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'articles', (
      select coalesce(jsonb_object_agg(screen_status, n), '{}'::jsonb)
      from (select screen_status, count(*) as n from public.articles group by screen_status) s
    ),
    'incidents', (
      select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
      from (select status, count(*) as n from public.incidents group by status) s
    ),
    'last_run', (
      select to_jsonb(r) from public.ingest_runs r order by started_at desc limit 1
    )
  );
$$;

grant execute on function public.queue_summary() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- หาบทความที่พาดหัวคล้ายกัน — ใช้กันข่าวเดียวกันที่มาจากหลายสำนักพร้อมกัน
-- (ข่าวเด่นหนึ่งเรื่องมักโผล่ใน Google News พร้อมกัน 5-10 สำนัก)
-- -----------------------------------------------------------------------------
create index if not exists articles_title_trgm on public.articles using gin (title gin_trgm_ops);

create or replace function public.find_similar_article(
  p_title      text,
  p_exclude    uuid default null,
  p_threshold  real default 0.45
)
returns table (id uuid, title text, screen_status text, url text, sim real)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.title, a.screen_status, a.url, similarity(a.title, p_title) as sim
  from public.articles a
  where p_title is not null
    and (p_exclude is null or a.id <> p_exclude)
    and a.created_at > now() - interval '30 days'
    and similarity(a.title, p_title) >= p_threshold
  order by sim desc
  limit 5;
$$;

grant execute on function public.find_similar_article(text, uuid, real) to authenticated, service_role;
