-- =============================================================================
-- Migration 0008: แหล่งข่าวชนิด sitemap
--
-- ปัญหา: สำนักข่าวที่ไม่มี RSS จะเข้าระบบได้ทางเดียวคือ lead จาก Google News
--        ซึ่ง Google เข้ารหัสลิงก์ต้นทางไว้ เจ้าหน้าที่จึงต้องเปิดทีละอันแล้วคัดลอก URL มาวาง
--        คิวค้าง 73 รายการ ใช้เวลาอย่างน้อย 30 นาที และ 28 รายการในนั้นเป็นข่าวช่อง 7
--
-- สิ่งที่ตรวจแล้ว: news.ch7.com/sitemap.xml มี 500 URL หน้าข่าว อัปเดตทุกวัน
--        robots.txt อนุญาต /detail/ · ทดสอบดึง 48/48 สำเร็จ 261 ms/หน้า เนื้อเต็มครบ
--        Thai PBS มี sitemap/sitemap_news.xml 43 URL เช่นกัน
--
-- ทางแก้: เพิ่มชนิดแหล่งข่าว 'sitemap' เข้าไปในไปป์ไลน์เดิม
--        ข่าวสองสำนักนี้จึงเข้าระบบเองครบทุกเรื่อง ไม่ต้องมี lead ให้คนยืนยันอีก
--        (และดีกว่าเดิมด้วย — เดิมได้เฉพาะเรื่องที่ Google News หยิบมาให้)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. sources: รับ kind ใหม่ + คอลัมน์บอกว่า <loc> ไหนคือหน้าข่าว
-- -----------------------------------------------------------------------------

alter table public.sources drop constraint if exists sources_kind_check;

alter table public.sources
  add constraint sources_kind_check
  check (kind in ('outlet_rss', 'google_news', 'sitemap'));

-- regex ชี้ว่า <loc> ไหนเป็นหน้าบทความ (ที่เหลือคือหน้าหมวด/หน้ารวม ซึ่งสกัดไม่ได้)
-- ไม่ใช้คอลัมน์ query ซ้ำ เพราะ query หมายถึงคำค้นของ Google News คนละความหมายกัน
alter table public.sources
  add column if not exists article_pattern text;

comment on column public.sources.article_pattern is
  'regex คัด <loc> ที่เป็นหน้าบทความ (ใช้เฉพาะ kind = sitemap)';

-- -----------------------------------------------------------------------------
-- 2. articles: สถานะใหม่สำหรับแถวที่ยังไม่รู้พาดหัว
--
-- sitemap ให้มาแค่ URL ไม่มีพาดหัวและไม่มีเนื้อ ต่างจาก RSS ที่ให้พาดหัวมาเลย
-- จึงต้องมีสถานะคั่นระหว่าง "เพิ่งเห็น URL" กับ "พร้อมคัดกรอง"
-- ถ้าปล่อยเป็น 'new' ทั้งที่ title ว่าง stage B จะให้คะแนน 0 แล้วตัดทิ้งทุกเรื่อง
-- -----------------------------------------------------------------------------

alter table public.articles drop constraint if exists articles_screen_status_check;

alter table public.articles
  add constraint articles_screen_status_check
  check (screen_status in (
    'new',            -- เพิ่งดึงมา ยังไม่คัดกรอง
    'needs_fetch',    -- รู้แค่ URL (มาจาก sitemap) ต้องดึงหน้าเว็บก่อนถึงจะคัดกรองได้
    'keyword_pass',   -- ผ่าน keyword filter รอ AI
    'keyword_reject', -- ไม่ผ่าน keyword filter
    'ai_reject',      -- AI บอกว่าไม่เกี่ยวกับแอลกอฮอล์
    'extracted',      -- สกัด 49 ฟิลด์แล้ว
    'needs_url',      -- lead จาก Google News รอเจ้าหน้าที่ยืนยัน URL
    'fetch_failed'    -- ดึงเนื้อข่าวไม่สำเร็จ
  ));

-- stage A2 หยิบงานด้วย screen_status='needs_fetch' เรียงตามวันที่เห็น
-- index เดิม (screen_status, published_at) ใช้ไม่ได้เพราะแถวจาก sitemap ไม่มี published_at
create index if not exists articles_needs_fetch_idx
  on public.articles (screen_status, created_at)
  where screen_status = 'needs_fetch';

-- -----------------------------------------------------------------------------
-- 3. เพิ่มสองแหล่งข่าว
--
-- poll_priority สูงกว่าฟีด RSS ปกติ (= ทำทีหลัง) เพราะแต่ละรอบต้องดึงหน้าเว็บหลายร้อยหน้า
-- ควรให้ฟีดที่ได้ผลเร็วทำงานให้เสร็จก่อน
-- -----------------------------------------------------------------------------

insert into public.sources (name, kind, feed_url, domain, article_pattern, has_full_text, poll_priority)
values
  ('ช่อง 7HD', 'sitemap', 'https://news.ch7.com/sitemap.xml',
   'news.ch7.com', '/detail/[0-9]+', false, 200),
  ('Thai PBS', 'sitemap', 'https://www.thaipbs.or.th/sitemap/sitemap_news.xml',
   'thaipbs.or.th', '/news/content/[0-9]+', false, 200)
on conflict (feed_url) do update
  set kind            = excluded.kind,
      domain          = excluded.domain,
      article_pattern = excluded.article_pattern,
      enabled         = true;

-- -----------------------------------------------------------------------------
-- 4. ให้ service_role ลบแถวใน articles ได้
--
-- migration 0006 ให้สิทธิ์ DELETE เฉพาะ authenticated — service_role จึงลบไม่ได้
-- อาการที่เจอ: สคริปต์เก็บกวาดข้อมูลทดสอบ (e2e-fixture teardown) รันแล้วรายงานว่าสำเร็จ
-- แต่แถวยังอยู่ครบ เพราะ supabase-js คืน error มาแล้วสคริปต์ไม่ได้ตรวจ
-- ผลคือข้อมูลทดสอบค้างปนอยู่ในคิวงานจริงของเจ้าหน้าที่
--
-- articles เป็นตารางคิวงานภายใน ไม่ใช่ข้อมูลสถิติ — ลบทิ้งได้ปลอดภัย
-- ต่างจาก incidents ที่ตั้งใจไม่ให้ service_role ลบ (ต้องผ่านสิทธิ์ผู้ใช้ที่ตรวจสอบได้)
-- -----------------------------------------------------------------------------

grant delete on public.articles to service_role;

-- ingest_runs ก็เช่นกัน — เป็นบันทึกประวัติการดึงข่าว ล้างได้ตอนรีเซ็ตระบบ
grant delete on public.ingest_runs to service_role;

-- -----------------------------------------------------------------------------
-- ตรวจผล
-- -----------------------------------------------------------------------------

-- 1. ต้องเห็นแหล่งข่าวชนิด sitemap 2 แถว พร้อม article_pattern
select name, kind, domain, article_pattern, enabled, poll_priority
from public.sources
where kind = 'sitemap'
order by name;

-- 2. โดเมนที่ระบบมีทางเข้าถึงข่าวตรงแล้ว (ใช้ตัด lead ซ้ำซ้อนจาก Google News)
--    ต้องมี news.ch7.com และ thaipbs.or.th เพิ่มเข้ามา
select string_agg(domain, ', ' order by domain) as โดเมนที่ไม่ต้องรอคนยืนยันลิงก์
from public.sources
where enabled = true and kind in ('outlet_rss', 'sitemap') and domain is not null;

-- 3. สถานะใหม่ต้องใช้ได้จริง (ควรได้ 0 แถว ยังไม่มีข้อมูล แต่ต้องไม่ error)
select count(*) as รอดึงหน้าเว็บ
from public.articles
where screen_status = 'needs_fetch';

-- 4. service_role ต้องลบแถวในตารางคิวงานได้แล้ว (ควรเห็น true ทั้งคู่)
select
  has_table_privilege('service_role', 'public.articles', 'DELETE')    as ลบ_articles_ได้,
  has_table_privilege('service_role', 'public.ingest_runs', 'DELETE') as ลบ_ingest_runs_ได้;
