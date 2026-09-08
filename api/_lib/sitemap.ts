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

export interface SitemapResult {
  ok: boolean;
  /** URL ของหน้าบทความ (กรองด้วย articlePattern แล้ว) */
  urls: string[];
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

function locsOf(node: unknown): string[] {
  return asArray(node as Record<string, unknown>[])
    .map((entry) => {
      const loc = entry?.loc;
      if (typeof loc === 'string') return loc.trim();
      if (loc && typeof loc === 'object' && '#text' in (loc as Record<string, unknown>)) {
        return String((loc as Record<string, unknown>)['#text']).trim();
      }
      return '';
    })
    .filter(Boolean);
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
): Promise<{ urls: string[]; children: string[]; status: number; error?: string }> {
  const res = await fetchText(url, { timeoutMs, accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8' });
  if (!res.ok) {
    return { urls: [], children: [], status: res.status, error: res.error ?? `HTTP ${res.status}` };
  }

  const doc = parser.parse(res.body) as Record<string, any>;
  return {
    urls: locsOf(doc?.urlset?.url),
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
      return { ok: false, urls: [], totalLocs: 0, status: root.status, error: root.error };
    }

    let all = root.urls;

    // เป็น sitemap index → ไล่ลงไปอ่าน sitemap ย่อย (ชั้นเดียว ไม่ recurse ต่อ)
    if (all.length === 0 && root.children.length > 0) {
      for (const child of root.children.slice(0, MAX_CHILD_SITEMAPS)) {
        const sub = await readSitemap(child, timeoutMs);
        all = all.concat(sub.urls);
      }
    }

    const totalLocs = all.length;
    const re = compilePattern(articlePattern);
    const urls = re ? all.filter((u) => re.test(u)) : all;

    // sitemap เดียวกันอาจมี URL ซ้ำเมื่อรวมจากหลาย sitemap ย่อย
    return { ok: true, urls: [...new Set(urls)], totalLocs, status: root.status };
  } catch (err: any) {
    return {
      ok: false,
      urls: [],
      totalLocs: 0,
      status: 0,
      error: `อ่าน sitemap ไม่สำเร็จ: ${err?.message ?? err}`,
    };
  }
}
