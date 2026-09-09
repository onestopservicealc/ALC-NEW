/**
 * Pipeline ดึงข่าว — 3 สเตจใน 1 invocation
 *
 *   A. poll ฟีดทั้งหมด → เก็บลง articles (กันซ้ำด้วย url_key)
 *   B. คัดกรองด้วย keyword (ไม่ใช้ LLM — ตัวคุมต้นทุนหลัก)
 *   C. ให้ Gemini คัดกรองซ้ำ + สกัด 49 ฟิลด์ → incidents (status='pending')
 *
 * ออกแบบให้ทำงานภายใต้งบเวลาที่จำกัด (Vercel Hobby ให้ 300 วินาทีต่อ invocation)
 * ทุกสเตจหยุดได้กลางคัน และรอบถัดไปทำงานต่อจากเดิมได้ เพราะสถานะอยู่ใน DB ทั้งหมด
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { MIN_INCIDENT_DATE, MIN_PUBLISHED_DATE, intEnv, optionalEnv } from './env.js';
import { fetchArticleText } from './article.js';
import { canonicalizeUrl } from './http.js';
import { DailyQuotaExhaustedError, screenAndExtract } from './gemini.js';
import { persistIncident } from './persistIncident.js';
import { fetchFeed, isGoogleNewsLink, splitGoogleNewsTitle, type FeedItem } from './rss.js';
import { fetchSitemap } from './sitemap.js';
import { hostOf, titlesLookAlike } from './leads.js';
import { DEFAULT_THRESHOLDS, LEAD_THRESHOLDS, screenArticle } from './screen.js';
import { normalizeIncident } from '../../src/lib/normalize.js';

export interface IngestOptions {
  trigger: 'cron' | 'manual';
  triggeredBy?: string | null;
  timeBudgetMs?: number;
  maxArticles?: number;
  /** จำกัดเฉพาะ source ที่ระบุ (ใช้ตอนกดทดสอบฟีดเดียว) */
  sourceIds?: string[];
  /** ข้ามการ poll ฟีด ทำเฉพาะคิวที่ค้างอยู่ */
  skipPoll?: boolean;
  /**
   * จำนวนข่าวสูงสุดที่คัดกรองด้วย keyword ต่อรอบ (ขั้นนี้ฟรี ไม่เรียก LLM)
   * cron ใช้ค่าน้อยเพราะมีงบเวลาจำกัด · backfill ควรตั้งสูงเพื่อเคลียร์คิวให้หมด
   */
  maxKeywordScreen?: number;
}

export interface IngestSummary {
  run_id: string;
  feeds_polled: number;
  feeds_failed: number;
  articles_new: number;
  keyword_passed: number;
  keyword_rejected: number;
  ai_screened: number;
  ai_rejected: number;
  incidents_created: number;
  duplicates_found: number;
  leads_pending: number;
  /** lead ที่ถูกตัดตั้งแต่ต้นทางเพราะไม่ใช่หน้าข่าว หรือมีฟีดตรงอยู่แล้ว */
  leads_skipped: number;
  /** ข่าวที่เก่ากว่าวันเริ่มเก็บข้อมูล — ตัดทิ้งตั้งแต่ก่อนบันทึก */
  too_old_skipped: number;
  /** ข่าวใหม่แต่รายงานเหตุการณ์เก่า — AI สกัดแล้วแต่ไม่บันทึกเป็นเคส */
  incidents_too_old: number;
  elapsed_ms: number;
  errors: { where: string; message: string }[];
  /** ข้อสังเกตที่ไม่ใช่ข้อผิดพลาด เช่น ยังมีคิวค้าง */
  notes: string[];
  stopped_reason: string;
}

const FEED_CONCURRENCY = 5;
const STAGE_A_MAX_MS = 70_000;
/** ต้องเหลือเวลาอย่างน้อยเท่านี้ถึงจะเริ่มประมวลผลข่าวชิ้นถัดไป */
const PER_ARTICLE_RESERVE_MS = 30_000;

interface SourceRow {
  id: string;
  name: string;
  kind: 'outlet_rss' | 'google_news' | 'sitemap';
  feed_url: string;
  domain: string | null;
  has_full_text: boolean;
  /** regex คัด <loc> ที่เป็นหน้าบทความ (ใช้เฉพาะ kind = sitemap) */
  article_pattern: string | null;
}

/** รันงานพร้อมกันแบบจำกัดจำนวน */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * โดเมนที่ไม่ใช่หน้าข่าว — สกัด 49 ฟิลด์จากหน้าเหล่านี้ไม่ได้อยู่แล้ว
 * Google News ดึงโพสต์โซเชียลและเว็บรวมข่าวมาปนด้วย
 */
const NON_ARTICLE_DOMAINS = [
  'facebook.com',
  'm.facebook.com',
  'vietnam.vn',
  'line.me',
  'today.line.me',
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'x.com',
  'twitter.com',
  // เว็บค้าปลีก/บริการที่ Google News จัดว่าเป็นสำนักข่าว — เคยหลุดเข้าคิวมาแล้ว
  // (พบ grab.com และ "โลตัส มันนี่ พลัส" ในคิวจริง เป็นบทความโปรโมชัน ไม่ใช่ข่าวเหตุการณ์)
  'grab.com',
  'lotuss.com',
  'lotusmoneyplus.com',
  'linemanwongnai.com',
  'shopee.co.th',
  'lazada.co.th',
];

/**
 * lead จาก Google News ควรเก็บไว้ให้คนมายืนยันลิงก์หรือไม่
 *
 * ตัดสินด้วย **โดเมน** ไม่ใช่ชื่อสำนัก เพราะ Google News ส่งชื่อมาไม่คงที่
 * (ในคิวจริงมีทั้ง "Thairath", "Thairath.co.th", "ไทยรัฐออนไลน์" ปนกัน)
 *
 * @param coveredDomains โดเมนที่เรามีฟีดตรงอยู่แล้ว — อ่านจาก sources.domain
 *                       จึงได้ผลทันทีเมื่อเพิ่มฟีดใหม่ ไม่ต้องมาแก้โค้ด
 */
export function leadRejectReason(
  publisherUrl: string | null | undefined,
  coveredDomains: Set<string>
): string | null {
  const host = hostOf(publisherUrl);
  if (!host) return null; // ไม่รู้โดเมน ปล่อยผ่านไปให้คนตัดสิน

  if (NON_ARTICLE_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) {
    return `ไม่ใช่หน้าข่าว (${host})`;
  }
  for (const covered of coveredDomains) {
    if (host === covered || host.endsWith(`.${covered}`)) {
      return `มีฟีดของ ${covered} อยู่แล้ว จะได้ข่าวนี้พร้อมเนื้อเต็มจากฟีดตรง`;
    }
  }
  return null;
}

function articleRowFromItem(item: FeedItem, source: SourceRow) {
  const link = item.link;
  const viaGoogleNews = source.kind === 'google_news' || isGoogleNewsLink(link);

  let title = item.title;
  let agency: string | null = source.kind === 'google_news' ? null : source.name;

  if (viaGoogleNews) {
    const split = splitGoogleNewsTitle(item.title);
    title = split.title;
    agency = item.sourceName || split.agency || 'ไม่ทราบสำนักข่าว';
  }

  const key = link ? canonicalizeUrl(link) : (item.guid ?? `${source.id}:${title}`);

  return {
    // โดเมนผู้เผยแพร่จาก <source url="..."> ของ Google News — ใช้ตัดสินว่าเก็บ lead ไหม
    // ไม่ได้เก็บลงฐานข้อมูล (ตัดออกก่อน insert) จึงไม่ต้องเพิ่มคอลัมน์
    publisherUrl: viaGoogleNews ? (item.sourceUrl ?? null) : link,
    source_id: source.id,
    url_key: key,
    url: viaGoogleNews ? null : link,
    gnews_link: viaGoogleNews ? link : null,
    news_agency: agency,
    title,
    published_at: item.publishedAt,
    rss_summary: item.summary,
    full_text: item.fullText && item.fullText.length > 200 ? item.fullText : null,
    full_text_source: item.fullText && item.fullText.length > 200 ? 'content_encoded' : null,
    viaGoogleNews,
  };
}


/* ------------------------------------------------------------------ */
/* STAGE A — poll ฟีด                                                  */
/* ------------------------------------------------------------------ */

/**
 * แหล่งข่าวชนิด sitemap ให้มาแค่ URL — บันทึกไว้เป็น needs_fetch แล้วให้ stage A2 ไปดึงพาดหัว
 *
 * ต้องแยกจาก pollFeeds เพราะ sitemap ไม่มีพาดหัว ไม่มีวันที่ ไม่มีสรุป
 * ซึ่งเป็นสิ่งที่ articleRowFromItem() ต้องใช้ทั้งหมด
 */
async function pollSitemap(
  db: SupabaseClient,
  source: SourceRow,
  summary: IngestSummary
): Promise<void> {
  const result = await fetchSitemap(source.feed_url, source.article_pattern);
  const now = new Date().toISOString();

  if (!result.ok) {
    summary.feeds_failed++;
    summary.errors.push({ where: `sitemap:${source.name}`, message: result.error ?? 'ไม่ทราบสาเหตุ' });
    const { data: current } = await db
      .from('sources')
      .select('consecutive_errors')
      .eq('id', source.id)
      .maybeSingle();
    await db
      .from('sources')
      .update({
        last_polled_at: now,
        last_error: result.error ?? `HTTP ${result.status}`,
        consecutive_errors: (current?.consecutive_errors ?? 0) + 1,
      })
      .eq('id', source.id);
    return;
  }

  summary.feeds_polled++;

  // เส้นทางนี้เคยไม่ผ่านด่านวันที่เลย และบันทึก published_at เป็น null ตายตัว
  // ผลคือตอนสกัดด้วย AI ไม่มีตัวอ้างอิงปี โมเดลจึงเดาปีเองแล้วผิด (วัดได้ 68% ของเคสจาก sitemap)
  const minDate = MIN_PUBLISHED_DATE();
  const fresh = result.entries.filter((e) => {
    if (e.publishedAt && e.publishedAt.slice(0, 10) < minDate) {
      summary.too_old_skipped++;
      return false;
    }
    return true;
  });

  // title ว่างไว้ก่อน — คอลัมน์เป็น not null จึงใส่ '' แล้วให้สถานะ needs_fetch เป็นตัวบอกว่ายังไม่รู้
  const payload = fresh.map((e) => ({
    source_id: source.id,
    url_key: canonicalizeUrl(e.url),
    url: e.url,
    gnews_link: null,
    news_agency: source.name,
    title: '',
    published_at: e.publishedAt,
    rss_summary: null,
    full_text: null,
    full_text_source: null,
    screen_status: 'needs_fetch',
  }));

  // ignoreDuplicates ทำให้ URL ที่เคยเห็นแล้วไม่ถูกดึงซ้ำ — สำคัญมาก
  // ไม่งั้นทุกรอบ cron จะไปไล่ดึงหน้าเดิม 500 หน้าใหม่หมด
  const { data: inserted, error } = await db
    .from('articles')
    .upsert(payload, { onConflict: 'url_key', ignoreDuplicates: true })
    .select('id');

  if (error) {
    summary.errors.push({ where: `insert:${source.name}`, message: error.message });
  } else {
    summary.articles_new += inserted?.length ?? 0;
  }

  await db
    .from('sources')
    .update({
      last_polled_at: now,
      last_ok_at: now,
      last_item_count: result.entries.length,
      consecutive_errors: 0,
      last_error: null,
    })
    .eq('id', source.id);
}

async function pollFeeds(
  db: SupabaseClient,
  sources: SourceRow[],
  deadline: number,
  summary: IngestSummary,
  coveredDomains: Set<string>
): Promise<void> {
  await mapLimit(sources, FEED_CONCURRENCY, async (source) => {
    if (Date.now() > deadline) return;

    if (source.kind === 'sitemap') {
      await pollSitemap(db, source, summary);
      return;
    }

    const result = await fetchFeed(source.feed_url);
    const now = new Date().toISOString();

    if (!result.ok) {
      summary.feeds_failed++;
      summary.errors.push({ where: `feed:${source.name}`, message: result.error ?? 'ไม่ทราบสาเหตุ' });

      // supabase-js อัปเดตแบบ expression ไม่ได้ จึงต้องอ่านตัวนับเดิมมาบวกเอง
      const { data: current } = await db
        .from('sources')
        .select('consecutive_errors')
        .eq('id', source.id)
        .maybeSingle();

      await db
        .from('sources')
        .update({
          last_polled_at: now,
          last_error: result.error ?? `HTTP ${result.status}`,
          consecutive_errors: (current?.consecutive_errors ?? 0) + 1,
        })
        .eq('id', source.id);
      return;
    }

    summary.feeds_polled++;

    const rows = result.items.map((item) => articleRowFromItem(item, source));
    // กันซ้ำภายในรอบเดียวกันก่อน (ฟีดบางเจ้ามีรายการซ้ำในตัวเอง)
    const seen = new Set<string>();
    const unique = rows.filter((r) => {
      if (seen.has(r.url_key)) return false;
      seen.add(r.url_key);
      return true;
    });

    // ตัด lead ที่ไม่มีวันใช้งานได้ตั้งแต่ก่อนบันทึก — ไม่งั้นไปกองรอคนยืนยันลิงก์เปล่าๆ
    const minDate = MIN_PUBLISHED_DATE();
    const keep = unique.filter((r) => {
      // ข่าวเก่ากว่าวันเริ่มเก็บข้อมูล ตัดทิ้งก่อนเข้าฐานข้อมูล
      // เช็คก่อนด่านอื่นเพราะใช้กับทุกแหล่ง ไม่ใช่เฉพาะ lead จาก Google News
      if (r.published_at && r.published_at.slice(0, 10) < minDate) {
        summary.too_old_skipped++;
        return false;
      }
      if (!r.viaGoogleNews) return true;
      const reason = leadRejectReason(r.publisherUrl, coveredDomains);
      if (reason) {
        summary.leads_skipped++;
        return false;
      }
      return true;
    });

    const payload = keep.map(({ viaGoogleNews, publisherUrl, ...rest }) => rest);

    const { data: inserted, error } = await db
      .from('articles')
      .upsert(payload, { onConflict: 'url_key', ignoreDuplicates: true })
      .select('id');

    if (error) {
      summary.errors.push({ where: `insert:${source.name}`, message: error.message });
    } else {
      summary.articles_new += inserted?.length ?? 0;
    }

    await db
      .from('sources')
      .update({
        last_polled_at: now,
        last_ok_at: now,
        last_item_count: result.items.length,
        consecutive_errors: 0,
        last_error: null,
      })
      .eq('id', source.id);
  });
}

/* ------------------------------------------------------------------ */
/* STAGE A2 — ดึงพาดหัว+เนื้อข่าวให้แถวที่มาจาก sitemap                 */
/* ------------------------------------------------------------------ */

/** ดึงหน้าเว็บพร้อมกันกี่หน้า — คูณกับ HTTP_MIN_INTERVAL_MS เป็นอัตราจริงที่ยิงใส่เว็บสำนักข่าว */
const HYDRATE_CONCURRENCY = 3;

/**
 * เติมพาดหัวและเนื้อข่าวให้แถวที่ sitemap ให้มาแค่ URL
 *
 * ทำก่อน stage B เพราะ stage B ให้คะแนนจากพาดหัว+เนื้อ ถ้าปล่อยแถวพาดหัวว่างเข้าไป
 * จะได้คะแนน 0 แล้วถูกตัดทิ้งทุกเรื่อง
 *
 * เนื้อที่ดึงได้เก็บลง full_text เลย stage C จึงไม่ต้องดึงหน้าเดิมซ้ำอีกรอบ
 */
async function hydrateSitemapArticles(
  db: SupabaseClient,
  summary: IngestSummary,
  maxToFetch: number,
  deadline: number
): Promise<void> {
  if (maxToFetch <= 0) return;

  const { data: pending, error } = await db
    .from('articles')
    .select('id, url')
    .eq('screen_status', 'needs_fetch')
    .order('created_at', { ascending: true })
    .limit(maxToFetch);

  if (error) {
    summary.errors.push({ where: 'hydrate:pick', message: error.message });
    return;
  }
  if (!pending?.length) return;

  let fetched = 0;
  let failed = 0;

  await mapLimit(pending, HYDRATE_CONCURRENCY, async (row) => {
    if (Date.now() > deadline) return;
    if (!row.url) {
      await db
        .from('articles')
        .update({ screen_status: 'fetch_failed', screen_reason: 'แถวจาก sitemap แต่ไม่มี URL' })
        .eq('id', row.id);
      return;
    }

    const article = await fetchArticleText(row.url);

    if (!article.ok) {
      failed++;
      await db
        .from('articles')
        .update({
          screen_status: 'fetch_failed',
          screen_reason: `ดึงเนื้อข่าวไม่สำเร็จ: ${article.error}`,
        })
        .eq('id', row.id);
      return;
    }

    fetched++;
    await db
      .from('articles')
      .update({
        // Readability คืนพาดหัวมาพร้อมชื่อเว็บต่อท้ายบ่อยๆ ตัดออกให้เหลือเฉพาะพาดหัว
        title: cleanPageTitle(article.title) || row.url,
        full_text: article.text,
        full_text_source: 'page_fetch',
        screen_status: 'new', // ปล่อยให้ stage B คัดกรองตามปกติ
      })
      .eq('id', row.id);
  });

  if (fetched || failed) {
    summary.notes.push(`ดึงหน้าข่าวจาก sitemap ${fetched} หน้า (ล้มเหลว ${failed})`);
  }

  const { count: stillPending } = await db
    .from('articles')
    .select('*', { count: 'exact', head: true })
    .eq('screen_status', 'needs_fetch');
  if (stillPending) {
    summary.notes.push(`ยังเหลือ ${stillPending} หน้าจาก sitemap ที่ยังไม่ได้ดึง — รอบถัดไปจะทำต่อ`);
  }
}

/** "พาดหัวข่าว | ชื่อเว็บ" → "พาดหัวข่าว" */
function cleanPageTitle(raw: string | null): string {
  const title = (raw ?? '').trim();
  if (!title) return '';
  const cut = title.split(/\s+[|–—]\s+/)[0].trim();
  // ถ้าตัดแล้วสั้นจนน่าสงสัยว่าตัดผิด ให้ใช้ของเดิม
  return cut.length >= 10 ? cut : title;
}

/* ------------------------------------------------------------------ */
/* STAGE B — คัดกรองด้วย keyword                                       */
/* ------------------------------------------------------------------ */

const KEYWORD_BATCH = 500;

async function keywordScreen(
  db: SupabaseClient,
  summary: IngestSummary,
  maxLeads: number,
  maxToScreen: number,
  deadline: number
): Promise<void> {
  let leadsCreated = 0;
  let screened = 0;

  // ทำเป็นชุดจนกว่าจะหมดคิว — ตอน backfill มีข่าวค้างเป็นหมื่น
  // ถ้าทำแค่ชุดเดียวแล้วจบ จะเข้าใจผิดว่า "ไม่มีข่าวค้างแล้ว" ทั้งที่ยังเหลืออีกมาก
  while (screened < maxToScreen && Date.now() < deadline) {
    const { data: pending, error } = await db
      .from('articles')
      .select('id, title, rss_summary, full_text, gnews_link, url')
      .eq('screen_status', 'new')
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(Math.min(KEYWORD_BATCH, maxToScreen - screened));

    if (error) {
      summary.errors.push({ where: 'keyword_screen', message: error.message });
      return;
    }
    if (!pending?.length) return;

    screened += pending.length;
    const written = await screenBatch(
      db,
      pending,
      summary,
      maxLeads,
      () => leadsCreated,
      (n) => (leadsCreated = n)
    );

    // ถ้าชุดนี้ไม่มีแถวไหนถูกเขียนสถานะเลย แถวเดิมจะยังเป็น 'new'
    // แล้ว query รอบหน้าดึงชุดเดียวกันกลับมาอีก → วนอ่านซ้ำจนหมดงบเวลา
    // (เกิดจริงตอน backfill: lead ที่เกินโควตาถูก skip โดยไม่เขียนสถานะ
    //  ขั้นคัดกรองจึงกินเวลาทั้ง 30 นาทีจนไม่เหลือให้ขั้นสกัด)
    if (written === 0) {
      summary.notes.push(
        `หยุดคัดกรองก่อนกำหนด: เหลือแต่ lead ที่เกินโควตา ${maxLeads} รายการต่อรอบ — รอบถัดไปจะทำต่อ`
      );
      return;
    }
  }
}

interface PendingArticle {
  id: string;
  title: string;
  rss_summary: string | null;
  full_text: string | null;
  gnews_link: string | null;
  url: string | null;
}

async function screenBatch(
  db: SupabaseClient,
  pending: PendingArticle[],
  summary: IngestSummary,
  maxLeads: number,
  getLeads: () => number,
  setLeads: (n: number) => void
): Promise<number> {
  let leadsCreated = getLeads();
  /** เก็บผลไว้ก่อน แล้วค่อยเขียนกลับพร้อมกันทีหลัง (ดูหมายเหตุท้ายฟังก์ชัน) */
  const updates: { id: string; screen_status: string; screen_score: number; screen_reason: string }[] = [];
  /** พาดหัวของ lead ที่รับเข้าคิวไปแล้ว "ในชุดนี้" — ยังไม่ถูกเขียนลง DB จึงต้องจำเอง */
  const acceptedLeadTitles: string[] = [];

  for (const row of pending) {
    const body = row.full_text ?? row.rss_summary ?? null;
    const isLead = !row.url && Boolean(row.gnews_link);
    const result = screenArticle(row.title, body, isLead ? LEAD_THRESHOLDS : DEFAULT_THRESHOLDS);

    let status: string;
    let reason = result.reason;

    if (!result.pass) {
      status = 'keyword_reject';
      summary.keyword_rejected++;
    } else if (!isLead) {
      status = 'keyword_pass';
      summary.keyword_passed++;
    } else {
      // ---- lead จาก Google News ----
      // ข่าวเด่นเรื่องเดียวโผล่พร้อมกัน 5-10 สำนัก ถ้าเก็บทุกอันคิวจะท่วม
      // จึงเช็คก่อนว่ามีข่าวเดียวกันอยู่ในระบบแล้วหรือยัง
      // เทียบกับ lead ที่รับเข้าคิวไปแล้วในชุดเดียวกันก่อน
      // เดิมถาม DB อย่างเดียว ซึ่งยังเห็นทั้งสองแถวเป็น 'new' → A เห็น B เป็นคู่ซ้ำ
      // และ B เห็น A เป็นคู่ซ้ำ ผลคือ**ถูกปฏิเสธทั้งคู่** เหตุการณ์นั้นหายจากระบบทั้งเรื่อง
      const twinInBatch = acceptedLeadTitles.find((t) => titlesLookAlike(t, row.title));
      if (twinInBatch) {
        updates.push({
          id: row.id,
          screen_status: 'keyword_reject',
          screen_score: result.score,
          screen_reason: 'ซ้ำกับ lead อีกชิ้นในรอบเดียวกัน',
        });
        summary.keyword_rejected++;
        continue;
      }

      const { data: similar } = await db.rpc('find_similar_article', {
        p_title: row.title,
        p_exclude: row.id,
      });

      // RPC ไม่กรอง screen_status ให้ → ต้องกรองเอง ไม่งั้น lead จะถูกตัดเพราะ "ซ้ำ"
      // กับแถวที่จบชีวิตเป็น keyword_reject / fetch_failed คือซ้ำกับของที่ไม่เคยเป็นข่าวจริง
      const usable = (Array.isArray(similar) ? similar : []).filter(
        (t: { screen_status?: string }) =>
          t.screen_status === 'extracted' || t.screen_status === 'needs_url'
      );
      const twin = usable[0] ?? null;

      if (twin?.url) {
        // มีข่าวเดียวกันจากฟีดสำนักข่าวโดยตรงแล้ว ซึ่งดีกว่าเพราะมีเนื้อข่าวเต็ม
        status = 'keyword_reject';
        reason = `ซ้ำกับข่าวที่ดึงจากฟีดสำนักข่าวโดยตรงแล้ว (คล้าย ${Math.round(twin.sim * 100)}%)`;
        summary.keyword_rejected++;
      } else if (twin) {
        status = 'keyword_reject';
        reason = `ซ้ำกับรายการที่มีอยู่แล้วในระบบ (คล้าย ${Math.round(twin.sim * 100)}%)`;
        summary.keyword_rejected++;
      } else if (leadsCreated >= maxLeads) {
        // เกินโควตารอบนี้ ปล่อยไว้เป็น 'new' ให้รอบถัดไปมาทำต่อ
        continue;
      } else {
        status = 'needs_url';
        leadsCreated++;
        acceptedLeadTitles.push(row.title);
        summary.leads_pending++;
      }
    }

    updates.push({ id: row.id, screen_status: status, screen_score: result.score, screen_reason: reason });
  }

  // เขียนกลับแบบขนาน — screen_score/screen_reason ต่างกันทุกแถว จึงรวมเป็น UPDATE เดียวไม่ได้
  // แต่ยิงพร้อมกันทีละชุดได้ ตอน backfill มีข่าวเป็นหมื่น การยิงทีละแถวแบบรอทีละครั้งช้ามาก
  const WRITE_CONCURRENCY = 25;
  for (let i = 0; i < updates.length; i += WRITE_CONCURRENCY) {
    await Promise.all(
      updates.slice(i, i + WRITE_CONCURRENCY).map(({ id, ...patch }) =>
        db
          .from('articles')
          .update(patch)
          .eq('id', id)
          .then(({ error }) => {
            if (error) summary.errors.push({ where: `screen_update:${id}`, message: error.message });
          })
      )
    );
  }

  setLeads(leadsCreated);
  return updates.length;
}

/**
 * พาดหัวสองอันเป็นข่าวเดียวกันไหม — ใช้กับ lead ในชุดเดียวกันที่ยังไม่ได้ลง DB
 * จึงใช้ trigram ของฐานข้อมูลไม่ได้ ต้องเทียบเองแบบง่ายๆ ด้วยคำที่ยาวพอจะมีความหมาย
 */
/* ------------------------------------------------------------------ */
/* STAGE C — AI คัดกรองซ้ำ + สกัด 49 ฟิลด์                              */
/* ------------------------------------------------------------------ */

interface QueuedArticle {
  id: string;
  url: string | null;
  news_agency: string | null;
  title: string;
  published_at: string | null;
  rss_summary: string | null;
  full_text: string | null;
  attempts: number;
}

async function extractOne(
  db: SupabaseClient,
  article: QueuedArticle,
  summary: IngestSummary
): Promise<void> {
  await db.from('articles').update({ attempts: article.attempts + 1 }).eq('id', article.id);

  // 1. หาเนื้อข่าว
  let body = article.full_text;
  if (!body || body.length < 400) {
    if (!article.url) {
      await db
        .from('articles')
        .update({ screen_status: 'fetch_failed', screen_reason: 'ไม่มี URL สำหรับดึงเนื้อข่าว' })
        .eq('id', article.id);
      return;
    }
    const fetched = await fetchArticleText(article.url);
    if (!fetched.ok) {
      await db
        .from('articles')
        .update({
          screen_status: 'fetch_failed',
          screen_reason: `ดึงเนื้อข่าวไม่สำเร็จ: ${fetched.error}`,
        })
        .eq('id', article.id);
      summary.errors.push({ where: `fetch:${article.url}`, message: fetched.error ?? '' });
      return;
    }
    body = fetched.text;
    await db
      .from('articles')
      .update({ full_text: body, full_text_source: 'page_fetch' })
      .eq('id', article.id);
  }

  // 2. ให้ Gemini คัดกรอง + สกัด
  const result = await screenAndExtract(body, {
    url: article.url ?? undefined,
    newsAgency: article.news_agency ?? undefined,
    newsTitle: article.title,
    publishedAt: article.published_at,
  });

  summary.ai_screened++;

  const inScope =
    result.screening.is_alcohol_related && result.screening.is_violence_or_accident && result.incident;

  if (!inScope) {
    summary.ai_rejected++;
    await db
      .from('articles')
      .update({
        screen_status: 'ai_reject',
        screen_reason: result.screening.reason || 'AI ตัดสินว่าไม่อยู่ในขอบเขต',
        ai_confidence: result.screening.confidence,
        processed_at: new Date().toISOString(),
        full_text: null, // ไม่เก็บเนื้อข่าวที่ไม่ได้ใช้
      })
      .eq('id', article.id);
    return;
  }

  // 3. ทำความสะอาดให้ตรง controlled vocabulary + กฎธุรกิจ
  const { incident, report } = normalizeIncident(result.incident!, {
    url: article.url ?? undefined,
    newsAgency: article.news_agency ?? undefined,
    newsTitle: article.title,
    publishedAt: article.published_at,
  });

  // 4-6. ตรวจข่าวซ้ำ → บันทึกเข้าคิว → ปิดงานฝั่ง articles (ตรรกะกลาง)
  const persisted = await persistIncident({
    db,
    incident,
    screening: result.screening,
    rawIncident: result.incident,
    adjustedFields: report.adjusted,
    model: result.model,
    articleId: article.id,
    publishedAt: article.published_at,
    fallback: {
      url: article.url,
      newsAgency: article.news_agency,
      newsTitle: article.title,
      summary: article.rss_summary,
    },
  });

  if (persisted.needsUrl) {
    // ทางนี้แทบไม่เกิด: lead ที่ไม่มี URL ถูกตั้งเป็น needs_url ตั้งแต่ stage B
    // และ stage C หยิบเฉพาะ keyword_pass (ตรวจฐานข้อมูลจริงแล้วพบ 0 แถวที่เข้าเงื่อนไขนี้)
    // คงการ์ดไว้เป็นตัวกันเหนียว และ **ไม่ล้าง full_text** เพื่อให้รอบหน้าไม่ต้อง fetch ใหม่
    summary.errors.push({
      where: `no_url:${article.id}`,
      message: 'สกัดสำเร็จแต่ไม่มี URL ต้นทาง — ต้องให้เจ้าหน้าที่ยืนยันลิงก์',
    });
    await db
      .from('articles')
      .update({
        screen_status: 'needs_url',
        screen_reason: 'สกัดได้แต่ไม่มี URL ต้นทาง — รอยืนยันลิงก์',
        ai_confidence: result.screening.confidence,
      })
      .eq('id', article.id);
    summary.leads_pending++;
    return;
  }

  // ต้องดักก่อน !persisted.ok ด้านล่าง — ไม่ใช่ความผิดพลาด แต่เป็นการตัดสินใจไม่เก็บ
  // ถ้าปล่อยตกไปบล็อกนั้น บทความจะถูกตั้งกลับเป็น keyword_pass แล้ววนสกัดซ้ำทุกรอบไม่จบ
  // (persistIncident ปิดบทความเป็น ai_reject ให้แล้ว)
  if (persisted.tooOld) {
    summary.incidents_too_old++;
    return;
  }

  if (!persisted.ok) {
    summary.errors.push({
      where: `insert_incident:${article.id}`,
      message: persisted.error ?? 'ไม่ทราบสาเหตุ',
    });
    await db
      .from('articles')
      .update({ screen_status: 'keyword_pass', screen_reason: `บันทึกล้มเหลว: ${persisted.error}` })
      .eq('id', article.id);
    return;
  }

  if (persisted.duplicateOf) summary.duplicates_found++;
  summary.incidents_created++;
}

/* ------------------------------------------------------------------ */
/* ตัวควบคุมหลัก                                                       */
/* ------------------------------------------------------------------ */

export async function runIngest(db: SupabaseClient, opts: IngestOptions): Promise<IngestSummary> {
  const startedAt = Date.now();
  const timeBudget = opts.timeBudgetMs ?? intEnv('INGEST_TIME_BUDGET_MS', 250_000);
  const maxArticles = opts.maxArticles ?? intEnv('INGEST_MAX_ARTICLES_PER_TICK', 40);
  const deadline = startedAt + timeBudget;

  const { data: run, error: runError } = await db
    .from('ingest_runs')
    .insert({ trigger: opts.trigger, triggered_by: opts.triggeredBy ?? null })
    .select('id')
    .single();

  if (runError || !run) throw new Error(`สร้าง ingest_runs ไม่สำเร็จ: ${runError?.message}`);

  const summary: IngestSummary = {
    run_id: run.id,
    feeds_polled: 0,
    feeds_failed: 0,
    articles_new: 0,
    keyword_passed: 0,
    keyword_rejected: 0,
    ai_screened: 0,
    ai_rejected: 0,
    incidents_created: 0,
    duplicates_found: 0,
    leads_pending: 0,
    leads_skipped: 0,
    too_old_skipped: 0,
    incidents_too_old: 0,
    elapsed_ms: 0,
    errors: [],
    notes: [],
    stopped_reason: 'เสร็จสมบูรณ์',
  };

  try {
    // ---- STAGE A ----
    if (!opts.skipPoll) {
      let query = db
        .from('sources')
        .select('id, name, kind, feed_url, domain, has_full_text, article_pattern')
        .eq('enabled', true)
        .order('poll_priority', { ascending: true });
      if (opts.sourceIds?.length) query = query.in('id', opts.sourceIds);

      const { data: sources, error } = await query;
      if (error) {
        summary.errors.push({ where: 'load_sources', message: error.message });
      } else if (sources?.length) {
        // โดเมนที่เรามีทางเข้าถึงข่าวตรงอยู่แล้ว — อ่านจากตาราง ไม่ hardcode
        // ต้องอ่านทุกแถวที่เปิดใช้งาน ไม่ใช่แค่ที่กรองด้วย sourceIds
        //
        // ต้องรวม kind='sitemap' ด้วย ไม่งั้น Google News จะยังสร้าง lead ของช่อง 7
        // ให้คนมานั่งยืนยันลิงก์ต่อไป ทั้งที่ระบบดึงข่าวช่อง 7 เองได้ครบแล้ว
        const { data: allSources } = await db
          .from('sources')
          .select('domain')
          .eq('enabled', true)
          .in('kind', ['outlet_rss', 'sitemap']);
        const coveredDomains = new Set(
          (allSources ?? [])
            .map((r) => (r.domain ?? '').toLowerCase().replace(/^www\./, ''))
            .filter(Boolean)
        );

        await pollFeeds(
          db,
          sources as SourceRow[],
          Math.min(deadline, startedAt + STAGE_A_MAX_MS),
          summary,
          coveredDomains
        );
      }
    }

    // ---- STAGE B ----
    // กันเวลาไว้ให้ขั้น AI ก่อน ไม่งั้นการคัดกรอง (ซึ่งฟรีและมีข่าวเป็นหมื่น)
    // จะกินงบเวลาจนหมดแล้วไม่เหลือให้ขั้นที่เป็นเป้าหมายจริงของการรัน
    const aiReserveMs = Math.min(
      maxArticles * PER_ARTICLE_RESERVE_MS,
      Math.floor(timeBudget * 0.6)
    );
    const screenDeadline = Math.max(startedAt + 30_000, deadline - aiReserveMs);

    // ---- STAGE A2 ----
    // ใช้งบเวลาครึ่งหนึ่งของช่วงคัดกรอง ที่เหลือให้ stage B ทำงานต่อได้ในรอบเดียวกัน
    await hydrateSitemapArticles(
      db,
      summary,
      intEnv('INGEST_MAX_SITEMAP_FETCH_PER_TICK', 150),
      Math.min(screenDeadline, Date.now() + Math.max(20_000, (screenDeadline - Date.now()) / 2))
    );

    await keywordScreen(
      db,
      summary,
      intEnv('INGEST_MAX_LEADS_PER_TICK', 15),
      opts.maxKeywordScreen ?? KEYWORD_BATCH,
      screenDeadline
    );

    const { count: stillUnscreened } = await db
      .from('articles')
      .select('*', { count: 'exact', head: true })
      .eq('screen_status', 'new');
    if (stillUnscreened) {
      summary.notes.push(`ยังเหลือ ${stillUnscreened} ข่าวที่ยังไม่ได้คัดกรอง — รันซ้ำเพื่อทำต่อ`);
    }

    // ---- STAGE C ----
    let processed = 0;
    while (processed < maxArticles) {
      const timeLeft = deadline - Date.now();
      if (timeLeft < PER_ARTICLE_RESERVE_MS) {
        summary.stopped_reason = `หมดงบเวลา (เหลือ ${Math.round(timeLeft / 1000)} วินาที) — รอบถัดไปจะทำต่อ`;
        break;
      }

      const { data: next, error } = await db
        .from('articles')
        .select('id, url, news_agency, title, published_at, rss_summary, full_text, attempts')
        .eq('screen_status', 'keyword_pass')
        .lt('attempts', 3)
        .order('screen_score', { ascending: false })
        .order('published_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        summary.errors.push({ where: 'pick_article', message: error.message });
        break;
      }
      if (!next) {
        // ไม่มีข่าวที่ผ่านคัดกรองเหลือ — แต่ต้องดูด้วยว่ายังมีข่าวที่ยังไม่ถูกคัดกรองอยู่ไหม
        const { count: unscreened } = await db
          .from('articles')
          .select('*', { count: 'exact', head: true })
          .eq('screen_status', 'new');
        summary.stopped_reason = unscreened
          ? `สกัดครบทุกข่าวที่ผ่านคัดกรองแล้ว แต่ยังเหลือ ${unscreened} ข่าวที่ยังไม่ได้คัดกรอง — รันซ้ำเพื่อทำต่อ`
          : 'ไม่มีข่าวค้างในคิวแล้ว';
        break;
      }

      try {
        await extractOne(db, next as QueuedArticle, summary);
      } catch (err: any) {
        // โควตาหมด = หยุดทั้งรอบ ไม่ใช่ข้ามข่าวนี้ ไม่งั้นจะไล่ยิงจนคิวหมดโดยล้มเหลวทุกครั้ง
        if (err instanceof DailyQuotaExhaustedError) {
          summary.stopped_reason = err.message;
          // คืนสถานะให้ข่าวนี้กลับเข้าคิว จะได้ไม่นับ attempt เสียเปล่า
          await db
            .from('articles')
            .update({ attempts: (next as QueuedArticle).attempts })
            .eq('id', next.id);
          break;
        }
        summary.errors.push({ where: `extract:${next.id}`, message: String(err?.message ?? err) });
        await db
          .from('articles')
          .update({ screen_reason: `สกัดล้มเหลว: ${String(err?.message ?? err).slice(0, 400)}` })
          .eq('id', next.id);
      }
      processed++;
    }

    if (processed >= maxArticles) {
      summary.stopped_reason = `ครบโควตา ${maxArticles} ข่าวต่อรอบ — รอบถัดไปจะทำต่อ`;
    }
  } catch (err: any) {
    summary.errors.push({ where: 'runIngest', message: String(err?.message ?? err) });
    summary.stopped_reason = `หยุดเพราะข้อผิดพลาด: ${String(err?.message ?? err)}`;
  }

  if (summary.incidents_too_old > 0) {
    summary.notes.push(
      `ข่าวใหม่แต่รายงานเหตุการณ์ก่อน ${MIN_INCIDENT_DATE()} จำนวน ${summary.incidents_too_old} รายการ — สกัดแล้วแต่ไม่บันทึกเป็นเคส`
    );
  }
  if (summary.too_old_skipped > 0) {
    summary.notes.push(
      `ตัดข่าวที่เผยแพร่ก่อน ${MIN_PUBLISHED_DATE()} ทิ้ง ${summary.too_old_skipped} รายการ (นอกช่วงที่ระบบเก็บข้อมูล)`
    );
  }
  if (summary.leads_skipped > 0) {
    summary.notes.push(
      `ตัด lead ที่ใช้ไม่ได้ทิ้ง ${summary.leads_skipped} รายการ (ไม่ใช่หน้าข่าว หรือมีฟีดตรงอยู่แล้ว)`
    );
  }

  summary.elapsed_ms = Date.now() - startedAt;

  await db
    .from('ingest_runs')
    .update({
      finished_at: new Date().toISOString(),
      feeds_polled: summary.feeds_polled,
      feeds_failed: summary.feeds_failed,
      articles_new: summary.articles_new,
      keyword_passed: summary.keyword_passed,
      keyword_rejected: summary.keyword_rejected,
      ai_screened: summary.ai_screened,
      ai_rejected: summary.ai_rejected,
      incidents_created: summary.incidents_created,
      duplicates_found: summary.duplicates_found,
      errors: summary.errors,
      notes: summary.stopped_reason,
    })
    .eq('id', run.id);

  return summary;
}
