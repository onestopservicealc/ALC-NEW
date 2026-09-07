/**
 * ตรวจสุขภาพฟีดข่าวทุกตัว
 *
 * URL ฟีดของสำนักข่าวไทยตาย/ย้ายบ่อย (ตอนสำรวจครั้งแรกพบว่าใช้ไม่ได้ 8 จาก 20 ตัว)
 * รันสคริปต์นี้ก่อน deploy และเป็นระยะ เพื่อจับฟีดที่เงียบหายไปโดยไม่มีใครรู้
 *
 *   npm run check:feeds            # ตรวจจาก sources ในฐานข้อมูล (ถ้าตั้งค่า env ไว้)
 *   npm run check:feeds -- --seed  # ตรวจจากรายการตั้งต้นในไฟล์ migration
 */
import './_env';
import { createClient } from '@supabase/supabase-js';
import { fetchFeed } from '../api/_lib/rss';
import { fetchSitemap } from '../api/_lib/sitemap';
import { DEFAULT_THRESHOLDS, LEAD_THRESHOLDS, screenArticle } from '../api/_lib/screen';

interface FeedTarget {
  id?: string;
  name: string;
  feed_url: string;
  kind: string;
  article_pattern?: string | null;
}

/** รายการตั้งต้น ใช้เมื่อยังไม่มีฐานข้อมูล — ตรงกับ 0002_seed_sources.sql */
const SEED_FEEDS: FeedTarget[] = [
  { name: 'มติชนออนไลน์ (อาชญากรรม)', kind: 'outlet_rss', feed_url: 'https://www.matichon.co.th/local/crime/feed' },
  { name: 'ข่าวสดออนไลน์', kind: 'outlet_rss', feed_url: 'https://www.khaosod.co.th/feed' },
  { name: 'ข่าวสดออนไลน์ (ทั่วไทย)', kind: 'outlet_rss', feed_url: 'https://www.khaosod.co.th/around-thailand/feed' },
  { name: 'มติชนออนไลน์', kind: 'outlet_rss', feed_url: 'https://www.matichon.co.th/feed' },
  { name: 'เดลินิวส์ (อาชญากรรม)', kind: 'outlet_rss', feed_url: 'https://www.dailynews.co.th/news_group/crime/feed/' },
  { name: 'เดลินิวส์ (ภูมิภาค)', kind: 'outlet_rss', feed_url: 'https://www.dailynews.co.th/news_group/regional/feed/' },
  { name: 'ไทยรัฐออนไลน์', kind: 'outlet_rss', feed_url: 'https://www.thairath.co.th/rss/news' },
  { name: 'ประชาชาติธุรกิจ', kind: 'outlet_rss', feed_url: 'https://www.prachachat.net/feed' },
  { name: 'ไทยโพสต์', kind: 'outlet_rss', feed_url: 'https://www.thaipost.net/feed' },
  { name: 'สำนักข่าว INN', kind: 'outlet_rss', feed_url: 'https://www.innnews.co.th/feed' },
  {
    name: 'Google News (เมาแล้วขับ ชน)',
    kind: 'google_news',
    feed_url: `https://news.google.com/rss/search?q=${encodeURIComponent('เมาแล้วขับ ชน')}&hl=th&gl=TH&ceid=TH:th`,
  },
];

async function loadTargets(): Promise<{ targets: FeedTarget[]; from: string }> {
  const useSeed = process.argv.includes('--seed');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (useSeed || !url || !key) {
    return { targets: SEED_FEEDS, from: useSeed ? 'รายการตั้งต้น (--seed)' : 'รายการตั้งต้น (ยังไม่ได้ตั้งค่า SUPABASE_*)' };
  }

  const db = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await db
    .from('sources')
    .select('id, name, feed_url, kind, article_pattern')
    .order('name');
  if (error) {
    console.warn(`อ่านตาราง sources ไม่ได้ (${error.message}) — ใช้รายการตั้งต้นแทน`);
    return { targets: SEED_FEEDS, from: 'รายการตั้งต้น (อ่าน DB ไม่ได้)' };
  }
  return { targets: (data ?? []) as FeedTarget[], from: 'ตาราง sources ในฐานข้อมูล' };
}

async function main() {
  const { targets, from } = await loadTargets();
  console.log(`\nตรวจสุขภาพฟีด ${targets.length} รายการ (แหล่ง: ${from})\n`);
  console.log(
    'สถานะ  รายการ  เนื้อเต็ม  เข้าเกณฑ์  ชื่อฟีด'
  );
  console.log('─'.repeat(96));

  const broken: FeedTarget[] = [];
  let totalCandidates = 0;

  for (const target of targets) {
    // sitemap ให้มาแค่ URL ไม่มีพาดหัว จึงตรวจได้แค่ว่าอ่านได้และคัดหน้าบทความได้กี่หน้า
    // (จะรู้ว่าเข้าเกณฑ์กี่ข่าวต้องดึงหน้าเว็บทีละหน้า ซึ่งเป็นงานของ pipeline ไม่ใช่ของการตรวจสุขภาพ)
    if (target.kind === 'sitemap') {
      const sm = await fetchSitemap(target.feed_url, target.article_pattern ?? null);
      if (!sm.ok) {
        broken.push(target);
        console.log(`  ✕      —        —         —      ${target.name}`);
        console.log(`         └─ ${sm.error}`);
        console.log(`         └─ ${target.feed_url}`);
        continue;
      }
      console.log(
        `  ✓    ${String(sm.urls.length).padStart(4)}        —         —      ${target.name}  (หน้าบทความ ${sm.urls.length} จาก ${sm.totalLocs} URL)`
      );
      if (sm.urls.length === 0) {
        console.log(`         └─ ⚠ article_pattern คัดทิ้งหมด — ตรวจ pattern: ${target.article_pattern ?? '(ไม่ได้ตั้ง)'}`);
        broken.push(target);
      }
      continue;
    }

    const result = await fetchFeed(target.feed_url);

    if (!result.ok) {
      broken.push(target);
      console.log(`  ✕      —        —         —      ${target.name}`);
      console.log(`         └─ ${result.error}`);
      console.log(`         └─ ${target.feed_url}`);
      continue;
    }

    const withFullText = result.items.filter((i) => i.fullText && i.fullText.length > 200).length;
    // Google News ไม่มีเนื้อข่าว จึงใช้เกณฑ์คนละชุดกับฟีดสำนักข่าวโดยตรง
    const thresholds = target.kind === 'google_news' ? LEAD_THRESHOLDS : DEFAULT_THRESHOLDS;
    const candidates = result.items.filter(
      (i) => screenArticle(i.title, i.fullText ?? i.summary ?? null, thresholds).pass
    ).length;
    totalCandidates += candidates;

    console.log(
      `  ✓    ${String(result.items.length).padStart(4)}    ${String(withFullText).padStart(5)}     ${String(candidates).padStart(5)}    ${target.name}`
    );
  }

  console.log('─'.repeat(96));
  console.log(
    `\nสรุป: ใช้ได้ ${targets.length - broken.length}/${targets.length} ฟีด · เข้าเกณฑ์คัดกรอง ${totalCandidates} ข่าว`
  );
  console.log(
    'หมายเหตุ: ตัวเลขจาก Google News เป็นจำนวนก่อนกันข่าวซ้ำและก่อนจำกัดโควตาต่อรอบ (ค่าเริ่มต้น 15)'
  );

  if (broken.length > 0) {
    console.log(`\nฟีดที่ใช้ไม่ได้ ${broken.length} รายการ — ควรปิดใช้งานหรือหา URL ใหม่:`);
    for (const b of broken) console.log(`  · ${b.name}  ${b.feed_url}`);
    process.exitCode = 1;
  }
  console.log('');
}

void main();
