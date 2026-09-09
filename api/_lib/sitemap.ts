/**
 * อ่าน sitemap.xml เพื่อใช้แทนฟีด RSS
 *
 * สำนักข่าวหลายเจ้าไม่มี RSS แต่มี sitemap ที่อัปเดตทุกวัน (ช่อง 7 มี 500 หน้าข่าว
 * Thai PBS มี 43) ทางนี้จึงเป็นวิธีเดียวที่จะได้ข่าวครบทุกเรื่องโดยไม่ต้องให้คนมายืนยันลิงก์
 *
 * ต่างจาก RSS ตรงที่ sitemap ให้มา **แค่ URL** ไม่มีพาดหัวและไม่มีเนื้อข่าว
 * การคัดกรองจึงต้องรอจนกว่าจะดึงหน้าเว็บมาก่อน (stage A2 ใน ingest.ts)
 */
import { XMLParser } from 'fast-xml-parser';
import { fetchText } from './http.js';

export interface SitemapEntry {
  url: string;
  /**
   * วันที่จาก <news:publication_date> หรือ <lastmod> — null ถ้า sitemap ไม่ให้มา
   *
   * สำคัญกว่าที่คิด: ข่าวจาก sitemap ไม่มีวันเผยแพร่มาก่อน ทำให้ตอนสกัดด้วย AI
   * ไม่มีตัวอ้างอิงปี โมเดลจึงเดาปีเองแล้วผิดบ่อยมาก (วัดได้ 68% ของเคสจาก sitemap)
   */
  publishedAt: string | null;
}

export interface SitemapResult {
  ok: boolean;
  /** หน้าบทความที่กรองด้วย articlePattern แล้ว */
  entries: SitemapEntry[];
  /** จำนวน <loc> ทั้งหมดก่อนกรอง — ใช้บอกว่า pattern คัดทิ้งไปเท่าไหร่ */
  totalLocs: number;
  status: number;
  error?: string;
}

const parser = new XMLParser({
  ignoreAttributes: true,
  textNodeName: '#text',
  trimValues: true,
  parseTagValue: false,
  processEntities: true,
});

/** sitemap index ที่ชี้ไปยัง sitemap ย่อย — ไล่ลงไปได้ชั้นเดียวเท่านั้น */
const MAX_CHILD_SITEMAPS = 5;

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** ค่าของ node ที่อาจเป็นสตริงตรงๆ หรือถูกห่อเป็น { '#text': ... } */
function textOf(node: unknown): string {
  if (typeof node === 'string') return node.trim();
  if (node && typeof node === 'object' && '#text' in (node as Record<string, unknown>)) {
    return String((node as Record<string, unknown>)['#text']).trim();
  }
  return '';
}

function locsOf(node: unknown): string[] {
  return asArray(node as Record<string, unknown>[])
    .map((entry) => textOf(entry?.loc))
    .filter(Boolean);
}

/**
 * ดึง URL พร้อมวันที่จาก <url> แต่ละก้อน
 *
 * เลือก <news:publication_date> ก่อนเพราะเป็นวันเผยแพร่จริง
 * ส่วน <lastmod> คือวันแก้ไขล่าสุด ซึ่งไม่ตรงเป๊ะ แต่สำหรับข่าวที่เพิ่งขึ้นเว็บใกล้เคียงพอ
 * และเพียงพอต่อหน้าที่หลักคือบอกปีให้ AI
 */
function entriesOf(node: unknown): SitemapEntry[] {
  return asArray(node as Record<string, any>[])
    .map((entry) => {
      const url = textOf(entry?.loc);
      if (!url) return null;
      const raw =
        textOf(entry?.['news:news']?.['news:publication_date']) ||
        textOf(entry?.news?.publication_date) ||
        textOf(entry?.lastmod);
      const d = raw ? new Date(raw) : null;
      return {
        url,
        publishedAt: d && !Number.isNaN(d.getTime()) ? d.toISOString() : null,
      };
    })
    .filter((e): e is SitemapEntry => e !== null);
}

/**
 * คอมไพล์ regex จากฐานข้อมูล
 *
 * โยน error เมื่อ pattern เสีย ไม่ใช่เงียบแล้วปล่อยผ่านทุก URL —
 * ถ้าปล่อยผ่าน ระบบจะไปไล่ดึงหน้าหมวด/หน้ารวมอีกหลายร้อยหน้าโดยไม่มีใครรู้ว่าตั้งค่าผิด
 */
function compilePattern(pattern: string | null): RegExp | null {
  if (!pattern) return null;
  try {
    return new RegExp(pattern);
  } catch (err: any) {
    throw new Error(`article_pattern ใช้ไม่ได้ ("${pattern}"): ${err?.message ?? err}`);
  }
}

async function readSitemap(
  url: string,
  timeoutMs: number
): Promise<{ entries: SitemapEntry[]; children: string[]; status: number; error?: string }> {
  const res = await fetchText(url, { timeoutMs, accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8' });
  if (!res.ok) {
    return { entries: [], children: [], status: res.status, error: res.error ?? `HTTP ${res.status}` };
  }

  const doc = parser.parse(res.body) as Record<string, any>;
  return {
    entries: entriesOf(doc?.urlset?.url),
    children: locsOf(doc?.sitemapindex?.sitemap),
    status: res.status,
  };
}

/**
 * ดึงรายการ URL หน้าบทความจาก sitemap
 *
 * @param articlePattern regex คัดเฉพาะหน้าบทความ (จาก sources.article_pattern)
 *                       ถ้าไม่ระบุจะคืนทุก URL ซึ่งมักมีหน้าหมวด/หน้ารวมปนมาด้วย
 */
export async function fetchSitemap(
  feedUrl: string,
  articlePattern: string | null,
  timeoutMs = 20000
): Promise<SitemapResult> {
  try {
    const root = await readSitemap(feedUrl, timeoutMs);
    if (root.error) {
      return { ok: false, entries: [], totalLocs: 0, status: root.status, error: root.error };
    }

    let all = root.entries;

    // เป็น sitemap index → ไล่ลงไปอ่าน sitemap ย่อย (ชั้นเดียว ไม่ recurse ต่อ)
    if (all.length === 0 && root.children.length > 0) {
      for (const child of root.children.slice(0, MAX_CHILD_SITEMAPS)) {
        const sub = await readSitemap(child, timeoutMs);
        all = all.concat(sub.entries);
      }
    }

    const totalLocs = all.length;
    const re = compilePattern(articlePattern);
    const matched = re ? all.filter((e) => re.test(e.url)) : all;

    // sitemap เดียวกันอาจมี URL ซ้ำเมื่อรวมจากหลาย sitemap ย่อย
    // เก็บอันแรกที่เจอ แต่ถ้าอันหลังมีวันที่และอันแรกไม่มี ให้ใช้อันที่มีวันที่
    const byUrl = new Map<string, SitemapEntry>();
    for (const e of matched) {
      const seen = byUrl.get(e.url);
      if (!seen || (!seen.publishedAt && e.publishedAt)) byUrl.set(e.url, e);
    }

    return { ok: true, entries: [...byUrl.values()], totalLocs, status: root.status };
  } catch (err: any) {
    return {
      ok: false,
      entries: [],
      totalLocs: 0,
      status: 0,
      error: `อ่าน sitemap ไม่สำเร็จ: ${err?.message ?? err}`,
    };
  }
}
