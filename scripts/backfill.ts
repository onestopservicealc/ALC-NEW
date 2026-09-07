/**
 * ดึงข่าวย้อนหลัง (backfill)
 *
 * ฟีด RSS ปกติเก็บแค่ข่าวล่าสุด 8-50 รายการ ซึ่งครอบคลุมเพียง 1-3 วัน
 * แต่ฟีดที่ทำด้วย WordPress รองรับ `?paged=N` ทำให้ไล่ย้อนกลับไปได้หลายเดือน
 * และยังส่ง <content:encoded> ที่มีเนื้อข่าวเต็มมาด้วย — ได้ URL จริงครบ
 *
 * ทดสอบแล้ว (2026-08-31):
 *   รองรับ paging : มติชน (ลึกถึง 3 เดือน+), เดลินิวส์, ประชาชาติ, ไทยโพสต์, INN
 *   ไม่รองรับ     : ข่าวสด, ไทยรัฐ — คืนหน้าเดิมทุกครั้งไม่ว่าจะใส่พารามิเตอร์แบบใด
 *                   สคริปต์ตรวจจับเองและหยุด ไม่วนซ้ำไม่รู้จบ
 *
 * แยกเป็น 2 ขั้นโดยตั้งใจ เพื่อให้คุมค่าใช้จ่ายได้:
 *   ขั้นนี้ (ฟรี)       ดึงฟีด + คัดกรอง keyword + บันทึกลงตาราง articles
 *   ขั้นถัดไป (เสียเงิน) ให้ AI สกัด 49 ฟิลด์ ด้วย `npm run backfill:extract`
 *
 *   npm run backfill -- --days 30              ดึงย้อนหลัง 30 วันเข้าฐานข้อมูล
 *   npm run backfill -- --days 30 --dry-run    ดูว่าจะได้อะไรบ้าง โดยไม่แตะฐานข้อมูล
 *   npm run backfill -- --days 7 --source มติชน  จำกัดเฉพาะสำนักที่ชื่อมีคำนี้
 */
import './_env';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { canonicalizeUrl } from '../api/_lib/http';
import { fetchFeed, isGoogleNewsLink, splitGoogleNewsTitle, type FeedItem } from '../api/_lib/rss';
import { DEFAULT_THRESHOLDS, LEAD_THRESHOLDS, screenArticle } from '../api/_lib/screen';

/* ------------------------------------------------------------------ */
/* พารามิเตอร์                                                         */
/* ------------------------------------------------------------------ */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
const DAYS = Number(arg('days') ?? 30);
const DRY_RUN = process.argv.includes('--dry-run');
const SOURCE_FILTER = arg('source');
/** กันหลงวนหน้าไม่รู้จบเมื่อฟีดมีพฤติกรรมแปลก */
const MAX_PAGES = Number(arg('max-pages') ?? 120);
/** ถ้าหน้าใหม่ซ้ำกับหน้าก่อนเกินสัดส่วนนี้ แปลว่าฟีดไม่รองรับ paging */
const OVERLAP_STOP = 0.8;

const CUTOFF = new Date(Date.now() - DAYS * 86_400_000);

/* ------------------------------------------------------------------ */
/* แหล่งข่าว                                                           */
/* ------------------------------------------------------------------ */

interface Target {
  id: string | null;
  name: string;
  kind: 'outlet_rss' | 'google_news';
  feed_url: string;
}

/** ใช้เมื่อยังไม่ได้ตั้งค่า SUPABASE_SERVICE_ROLE_KEY (โหมด --dry-run) */
const FALLBACK_TARGETS: Target[] = [
  { id: null, name: 'มติชนออนไลน์ (อาชญากรรม)', kind: 'outlet_rss', feed_url: 'https://www.matichon.co.th/local/crime/feed' },
  { id: null, name: 'มติชนออนไลน์', kind: 'outlet_rss', feed_url: 'https://www.matichon.co.th/feed' },
  { id: null, name: 'เดลินิวส์ (อาชญากรรม)', kind: 'outlet_rss', feed_url: 'https://www.dailynews.co.th/news_group/crime/feed/' },
  { id: null, name: 'เดลินิวส์ (ภูมิภาค)', kind: 'outlet_rss', feed_url: 'https://www.dailynews.co.th/news_group/regional/feed/' },
  { id: null, name: 'ประชาชาติธุรกิจ', kind: 'outlet_rss', feed_url: 'https://www.prachachat.net/feed' },
  { id: null, name: 'ไทยโพสต์', kind: 'outlet_rss', feed_url: 'https://www.thaipost.net/feed' },
  { id: null, name: 'สำนักข่าว INN', kind: 'outlet_rss', feed_url: 'https://www.innnews.co.th/feed' },
  // สองรายการนี้ย้อนหลังไม่ได้ ใส่ไว้ให้ตรงกับ sources ในฐานข้อมูล
  // และเพื่อให้ตัวตรวจจับ "ฟีดไม่รองรับ paging" ได้ทำงานจริง
  { id: null, name: 'ข่าวสดออนไลน์', kind: 'outlet_rss', feed_url: 'https://www.khaosod.co.th/feed' },
  { id: null, name: 'ไทยรัฐออนไลน์', kind: 'outlet_rss', feed_url: 'https://www.thairath.co.th/rss/news' },
];

function db(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function loadTargets(client: SupabaseClient | null): Promise<Target[]> {
  let targets = FALLBACK_TARGETS;

  if (client) {
    const { data, error } = await client
      .from('sources')
      .select('id, name, kind, feed_url')
      .eq('enabled', true)
      .eq('kind', 'outlet_rss')
      .order('poll_priority');
    if (error) throw new Error(`อ่านตาราง sources ไม่สำเร็จ: ${error.message}`);
    if (data?.length) targets = data as Target[];
  }

  return SOURCE_FILTER ? targets.filter((t) => t.name.includes(SOURCE_FILTER)) : targets;
}

/* ------------------------------------------------------------------ */
/* ไล่หน้าฟีด                                                          */
/* ------------------------------------------------------------------ */

function pagedUrl(feedUrl: string, page: number): string {
  if (page === 1) return feedUrl;
  return `${feedUrl}${feedUrl.includes('?') ? '&' : '?'}paged=${page}`;
}

interface CrawlResult {
  items: FeedItem[];
  pages: number;
  oldest: Date | null;
  stopReason: string;
  supportsPaging: boolean;
  /** true เมื่อหยุดเพราะชนเพดานหน้า = ข้อมูลยังไม่ครบช่วงที่ขอ */
  hitPageCap: boolean;
}

async function crawlBack(target: Target): Promise<CrawlResult> {
  const collected = new Map<string, FeedItem>();
  let previousLinks = new Set<string>();
  let oldest: Date | null = null;
  let page = 1;
  let stopReason = `ครบ ${MAX_PAGES} หน้า (เพดานกันวนซ้ำ)`;
  let supportsPaging = true;

  for (; page <= MAX_PAGES; page++) {
    const result = await fetchFeed(pagedUrl(target.feed_url, page));

    if (!result.ok) {
      stopReason = page === 1 ? `ดึงฟีดไม่สำเร็จ: ${result.error}` : `หน้า ${page} ไม่มีข้อมูลแล้ว`;
      break;
    }

    const links = new Set(result.items.map((i) => i.link ?? i.guid ?? i.title));

    // ฟีดที่ไม่รองรับ paging จะคืนหน้าเดิมซ้ำ — ต้องจับให้ได้ ไม่งั้นวนจนครบเพดาน
    if (page > 1) {
      const overlap = [...links].filter((l) => previousLinks.has(l)).length;
      if (overlap / links.size >= OVERLAP_STOP) {
        supportsPaging = false;
        stopReason = `ฟีดไม่รองรับการย้อนหน้า (หน้า ${page} ซ้ำกับหน้าก่อน ${overlap}/${links.size})`;
        break;
      }
    }
    previousLinks = links;

    for (const item of result.items) {
      const key = item.link ? canonicalizeUrl(item.link) : (item.guid ?? item.title);
      if (!collected.has(key)) collected.set(key, item);
      if (item.publishedAt) {
        const d = new Date(item.publishedAt);
        if (!Number.isNaN(d.getTime()) && (!oldest || d < oldest)) oldest = d;
      }
    }

    if (oldest && oldest < CUTOFF) {
      stopReason = `ย้อนถึงวันที่กำหนดแล้ว (${oldest.toISOString().slice(0, 10)})`;
      break;
    }
  }

  // ตัดข่าวที่เก่ากว่าช่วงที่ขอออก
  const items = [...collected.values()].filter((i) => {
    if (!i.publishedAt) return true; // ไม่มีวันที่ ปล่อยให้ AI ตัดสินทีหลัง
    const d = new Date(i.publishedAt);
    return Number.isNaN(d.getTime()) || d >= CUTOFF;
  });

  const hitPageCap = page > MAX_PAGES && !!oldest && oldest > CUTOFF;
  if (hitPageCap) {
    stopReason =
      `ชนเพดาน ${MAX_PAGES} หน้า แต่ยังย้อนไม่ถึง ${CUTOFF.toISOString().slice(0, 10)} ` +
      `(ได้แค่ถึง ${oldest!.toISOString().slice(0, 10)}) — เพิ่มด้วย --max-pages`;
  }

  return { items, pages: page, oldest, stopReason, supportsPaging, hitPageCap };
}

/* ------------------------------------------------------------------ */
/* บันทึกลงฐานข้อมูล                                                    */
/* ------------------------------------------------------------------ */

function toArticleRow(item: FeedItem, target: Target) {
  const viaGoogleNews = target.kind === 'google_news' || isGoogleNewsLink(item.link);
  let title = item.title;
  let agency: string | null = viaGoogleNews ? null : target.name;

  if (viaGoogleNews) {
    const split = splitGoogleNewsTitle(item.title);
    title = split.title;
    agency = item.sourceName || split.agency || 'ไม่ทราบสำนักข่าว';
  }

  const hasBody = Boolean(item.fullText && item.fullText.length > 200);

  return {
    source_id: target.id,
    url_key: item.link ? canonicalizeUrl(item.link) : (item.guid ?? `${target.name}:${title}`),
    url: viaGoogleNews ? null : item.link,
    gnews_link: viaGoogleNews ? item.link : null,
    news_agency: agency,
    title,
    published_at: item.publishedAt,
    rss_summary: item.summary,
    full_text: hasBody ? item.fullText : null,
    full_text_source: hasBody ? 'content_encoded' : null,
  };
}

async function insertArticles(
  client: SupabaseClient,
  rows: ReturnType<typeof toArticleRow>[]
): Promise<number> {
  let inserted = 0;
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { data, error } = await client
      .from('articles')
      .upsert(rows.slice(i, i + CHUNK), { onConflict: 'url_key', ignoreDuplicates: true })
      .select('id');
    if (error) throw new Error(`บันทึกล้มเหลวที่ชุดที่ ${i / CHUNK + 1}: ${error.message}`);
    inserted += data?.length ?? 0;
  }
  return inserted;
}

/* ------------------------------------------------------------------ */

async function main() {
  const client = db();

  console.log(`\nดึงข่าวย้อนหลัง ${DAYS} วัน (ตั้งแต่ ${CUTOFF.toISOString().slice(0, 10)})`);
  if (DRY_RUN) console.log('โหมด --dry-run: ไม่เขียนลงฐานข้อมูล');
  else if (!client) {
    console.error('\nยังไม่ได้ตั้ง SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    console.error('ถ้าต้องการดูผลก่อนโดยไม่แตะฐานข้อมูล ให้ใส่ --dry-run\n');
    process.exit(1);
  }

  const targets = await loadTargets(client);
  console.log(`แหล่งข่าวที่จะไล่: ${targets.length} รายการ\n`);

  let grandTotal = 0;
  let grandCandidates = 0;
  const allRows: ReturnType<typeof toArticleRow>[] = [];
  const notPageable: string[] = [];
  const incomplete: string[] = [];

  // ไล่ทุกสำนักพร้อมกันได้ เพราะ http.ts จำกัดอัตราแยกตามโดเมนอยู่แล้ว
  // (สองฟีดของสำนักเดียวกันจะเข้าคิวรอกันเองโดยอัตโนมัติ)
  const crawls = await Promise.all(
    targets.map(async (target) => {
      const crawl = await crawlBack(target);
      const candidates = crawl.items.filter((i) => {
        const isLead = !i.link || isGoogleNewsLink(i.link);
        return screenArticle(
          i.title,
          i.fullText ?? i.summary ?? null,
          isLead ? LEAD_THRESHOLDS : DEFAULT_THRESHOLDS
        ).pass;
      }).length;
      console.log(
        `  ${target.name} — ${crawl.pages} หน้า · ${crawl.items.length} ข่าว · ` +
          `เข้าเกณฑ์ ${candidates} · เก่าสุด ${crawl.oldest ? crawl.oldest.toISOString().slice(0, 10) : '-'}`
      );
      console.log(`      └─ ${crawl.stopReason}`);
      return { target, crawl, candidates };
    })
  );

  for (const { target, crawl, candidates } of crawls) {
    grandTotal += crawl.items.length;
    grandCandidates += candidates;
    if (!crawl.supportsPaging) notPageable.push(target.name);
    if (crawl.hitPageCap) incomplete.push(target.name);
    allRows.push(...crawl.items.map((i) => toArticleRow(i, target)));
  }

  // กันซ้ำภายในรอบเดียวกันก่อนส่งเข้าฐานข้อมูล
  const unique = new Map<string, (typeof allRows)[number]>();
  for (const row of allRows) if (!unique.has(row.url_key)) unique.set(row.url_key, row);

  console.log(`\n─────────────────────────────────────────────`);
  console.log(`รวม ${grandTotal} ข่าว (ไม่ซ้ำ ${unique.size}) · เข้าเกณฑ์คัดกรอง ${grandCandidates} ข่าว`);

  if (notPageable.length) {
    console.log(`\nสำนักที่ย้อนหลังไม่ได้ (ได้เฉพาะข่าวล่าสุด): ${notPageable.join(', ')}`);
  }

  if (incomplete.length) {
    console.log(
      `\n⚠ ข้อมูลยังไม่ครบช่วงที่ขอ เพราะชนเพดาน ${MAX_PAGES} หน้า: ${incomplete.join(', ')}` +
        `\n  รันซ้ำด้วย --max-pages ${MAX_PAGES * 2} เพื่อไล่ต่อ`
    );
  }

  if (DRY_RUN) {
    console.log('\n--dry-run: ไม่ได้บันทึกอะไรลงฐานข้อมูล');
    console.log('ถอด --dry-run ออกเพื่อบันทึกจริง แล้วค่อยรัน `npm run backfill:extract`\n');
    return;
  }

  const inserted = await insertArticles(client!, [...unique.values()]);
  console.log(`\nบันทึกลงตาราง articles: ${inserted} รายการใหม่ (ที่เหลือมีอยู่แล้ว)`);
  console.log(`ขั้นถัดไป — ให้ AI สกัด 49 ฟิลด์ (ขั้นนี้มีค่าใช้จ่าย):`);
  console.log(`  npm run backfill:extract -- --max 50\n`);
}

void main();
