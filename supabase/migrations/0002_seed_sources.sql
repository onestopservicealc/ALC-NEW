-- =============================================================================
-- Migration 0002: seed แหล่งข่าวเริ่มต้น
--
-- ฟีดทุกตัวในนี้ทดสอบจริงแล้วเมื่อ 2026-08-30 (http=200 และมี <item>)
-- has_full_text = true หมายถึงฟีดส่ง <content:encoded> มาด้วย → ไม่ต้อง fetch หน้าเว็บ
-- ตรวจสุขภาพซ้ำเป็นระยะด้วย `npm run check:feeds`
-- =============================================================================

insert into public.sources (name, kind, feed_url, query, domain, has_full_text, poll_priority) values
  -- ── RSS สำนักข่าวโดยตรง: ได้ URL จริง + เนื้อข่าวเต็ม (เชื้อเพลิงหลักของ pipeline) ──
  ('มติชนออนไลน์ (อาชญากรรม)', 'outlet_rss', 'https://www.matichon.co.th/local/crime/feed',            null, 'matichon.co.th',   true,  1),
  ('ข่าวสดออนไลน์',            'outlet_rss', 'https://www.khaosod.co.th/feed',                          null, 'khaosod.co.th',    true,  2),
  ('ข่าวสดออนไลน์ (ทั่วไทย)',  'outlet_rss', 'https://www.khaosod.co.th/around-thailand/feed',          null, 'khaosod.co.th',    true,  3),
  ('มติชนออนไลน์',            'outlet_rss', 'https://www.matichon.co.th/feed',                         null, 'matichon.co.th',   true,  4),
  ('เดลินิวส์ (อาชญากรรม)',    'outlet_rss', 'https://www.dailynews.co.th/news_group/crime/feed/',      null, 'dailynews.co.th',  false, 5),
  ('เดลินิวส์ (ภูมิภาค)',      'outlet_rss', 'https://www.dailynews.co.th/news_group/regional/feed/',   null, 'dailynews.co.th',  false, 6),
  ('ไทยรัฐออนไลน์',           'outlet_rss', 'https://www.thairath.co.th/rss/news',                     null, 'thairath.co.th',   false, 7),
  ('ประชาชาติธุรกิจ',         'outlet_rss', 'https://www.prachachat.net/feed',                         null, 'prachachat.net',   true,  8),
  ('ไทยโพสต์',                'outlet_rss', 'https://www.thaipost.net/feed',                           null, 'thaipost.net',     true,  9),
  ('สำนักข่าว INN',           'outlet_rss', 'https://www.innnews.co.th/feed',                          null, 'innnews.co.th',    true, 10),

  -- ── Google News: ใช้เป็นตัวจับสัญญาณ ไม่ใช่แหล่งเนื้อหา ──
  --    Google เปลี่ยน encoding ลิงก์แล้ว ถอดกลับเป็น URL ต้นทางไม่ได้
  --    รายการจากที่นี่จะถูกเก็บเป็น lead (screen_status='needs_url') ให้เจ้าหน้าที่ยืนยันลิงก์
  ('Google News (เมาแล้วขับ ชน)', 'google_news', 'https://news.google.com/rss/search?q=%E0%B9%80%E0%B8%A1%E0%B8%B2%E0%B9%81%E0%B8%A5%E0%B9%89%E0%B8%A7%E0%B8%82%E0%B8%B1%E0%B8%9A%20%E0%B8%8A%E0%B8%99&hl=th&gl=TH&ceid=TH:th', 'เมาแล้วขับ ชน', 'news.google.com', false, 10),
  ('Google News (เมาแล้วขับ เสียชีวิต)', 'google_news', 'https://news.google.com/rss/search?q=%E0%B9%80%E0%B8%A1%E0%B8%B2%E0%B9%81%E0%B8%A5%E0%B9%89%E0%B8%A7%E0%B8%82%E0%B8%B1%E0%B8%9A%20%E0%B9%80%E0%B8%AA%E0%B8%B5%E0%B8%A2%E0%B8%8A%E0%B8%B5%E0%B8%A7%E0%B8%B4%E0%B8%95&hl=th&gl=TH&ceid=TH:th', 'เมาแล้วขับ เสียชีวิต', 'news.google.com', false, 10),
  ('Google News (เมาสุรา ทำร้ายร่างกาย)', 'google_news', 'https://news.google.com/rss/search?q=%E0%B9%80%E0%B8%A1%E0%B8%B2%E0%B8%AA%E0%B8%B8%E0%B8%A3%E0%B8%B2%20%E0%B8%97%E0%B8%B3%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%A2%E0%B8%A3%E0%B9%88%E0%B8%B2%E0%B8%87%E0%B8%81%E0%B8%B2%E0%B8%A2&hl=th&gl=TH&ceid=TH:th', 'เมาสุรา ทำร้ายร่างกาย', 'news.google.com', false, 20),
  ('Google News (ดื่มสุรา ก่อเหตุ)', 'google_news', 'https://news.google.com/rss/search?q=%E0%B8%94%E0%B8%B7%E0%B9%88%E0%B8%A1%E0%B8%AA%E0%B8%B8%E0%B8%A3%E0%B8%B2%20%E0%B8%81%E0%B9%88%E0%B8%AD%E0%B9%80%E0%B8%AB%E0%B8%95%E0%B8%B8&hl=th&gl=TH&ceid=TH:th', 'ดื่มสุรา ก่อเหตุ', 'news.google.com', false, 20),
  ('Google News (เป่าแอลกอฮอล์ เกินกฎหมายกำหนด)', 'google_news', 'https://news.google.com/rss/search?q=%E0%B9%80%E0%B8%9B%E0%B9%88%E0%B8%B2%E0%B9%81%E0%B8%AD%E0%B8%A5%E0%B8%81%E0%B8%AD%E0%B8%AE%E0%B8%AD%E0%B8%A5%E0%B9%8C%20%E0%B9%80%E0%B8%81%E0%B8%B4%E0%B8%99%E0%B8%81%E0%B8%8E%E0%B8%AB%E0%B8%A1%E0%B8%B2%E0%B8%A2%E0%B8%81%E0%B8%B3%E0%B8%AB%E0%B8%99%E0%B8%94&hl=th&gl=TH&ceid=TH:th', 'เป่าแอลกอฮอล์ เกินกฎหมายกำหนด', 'news.google.com', false, 20),
  ('Google News (เมาอาละวาด)', 'google_news', 'https://news.google.com/rss/search?q=%E0%B9%80%E0%B8%A1%E0%B8%B2%E0%B8%AD%E0%B8%B2%E0%B8%A5%E0%B8%B0%E0%B8%A7%E0%B8%B2%E0%B8%94&hl=th&gl=TH&ceid=TH:th', 'เมาอาละวาด', 'news.google.com', false, 30),
  ('Google News (ทะเลาะวิวาท ลานเบียร์)', 'google_news', 'https://news.google.com/rss/search?q=%E0%B8%97%E0%B8%B0%E0%B9%80%E0%B8%A5%E0%B8%B2%E0%B8%B0%E0%B8%A7%E0%B8%B4%E0%B8%A7%E0%B8%B2%E0%B8%97%20%E0%B8%A5%E0%B8%B2%E0%B8%99%E0%B9%80%E0%B8%9A%E0%B8%B5%E0%B8%A2%E0%B8%A3%E0%B9%8C&hl=th&gl=TH&ceid=TH:th', 'ทะเลาะวิวาท ลานเบียร์', 'news.google.com', false, 30);


-- หมายเหตุ: ฟีดที่ทดสอบแล้วใช้ไม่ได้ (404/403/ไม่มี item) เมื่อ 2026-08-30 จึงไม่ใส่ไว้ —
-- thaipbs.or.th, mgronline.com, pptvhd36.com, sanook.com, komchadluek.net,
-- nationtv.tv, springnews.co.th, amarintv.com, naewna.com,
-- thairath.co.th/rss/news/crime, khaosod.co.th/crime-report/feed
