/**
 * ดึงและ parse RSS/Atom
 *
 * รองรับทั้ง RSS 2.0 และ Atom เพราะฟีดสำนักข่าวไทยใช้ทั้งสองแบบ
 * ฟีด WordPress (ข่าวสด/มติชน/ประชาชาติ/ไทยโพสต์/INN) ส่ง <content:encoded>
 * ที่มีเนื้อข่าวเต็มมาด้วย ~9,000 ตัวอักษร → ไม่ต้องไป fetch หน้าเว็บเลย
 */
import { XMLParser } from 'fast-xml-parser';
import { fetchText } from './http';

export interface FeedItem {
  title: string;
  link: string | null;
  guid: string | null;
  publishedAt: string | null;
  summary: string | null;
  /** เนื้อข่าวเต็มจาก content:encoded (ถ้าฟีดส่งมา) */
  fullText: string | null;
  /** ชื่อ + โดเมนสำนักข่าว (Google News ส่งมาใน <source>) */
  sourceName: string | null;
  sourceUrl: string | null;
}

export interface FeedResult {
  ok: boolean;
  items: FeedItem[];
  error?: string;
  status: number;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
  htmlEntities: true,
});

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** ดึงค่าข้อความจาก node ที่อาจเป็น string, {'#text': ...} หรือ CDATA */
function textOf(node: unknown): string {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if ('#text' in obj) return textOf(obj['#text']);
  }
  return '';
}

/** ตัดแท็ก HTML ออกให้เหลือข้อความล้วน */
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function toIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseRssItem(raw: Record<string, any>): FeedItem {
  const encoded = textOf(raw['content:encoded']);
  const description = textOf(raw.description);
  const sourceNode = raw.source;

  return {
    title: stripHtml(textOf(raw.title)),
    link: textOf(raw.link).trim() || null,
    guid: textOf(raw.guid).trim() || null,
    publishedAt: toIso(textOf(raw.pubDate) || textOf(raw['dc:date'])),
    summary: description ? stripHtml(description).slice(0, 2000) : null,
    fullText: encoded ? stripHtml(encoded) : null,
    sourceName: sourceNode ? stripHtml(textOf(sourceNode)) || null : null,
    sourceUrl: sourceNode && typeof sourceNode === 'object' ? (sourceNode['@_url'] ?? null) : null,
  };
}

function parseAtomEntry(raw: Record<string, any>): FeedItem {
  const links = asArray(raw.link);
  const alternate =
    links.find((l: any) => typeof l === 'object' && (l['@_rel'] === 'alternate' || !l['@_rel'])) ??
    links[0];
  const href =
    typeof alternate === 'object' ? (alternate?.['@_href'] ?? null) : textOf(alternate) || null;
  const content = textOf(raw.content);
  const summary = textOf(raw.summary);

  return {
    title: stripHtml(textOf(raw.title)),
    link: href,
    guid: textOf(raw.id).trim() || null,
    publishedAt: toIso(textOf(raw.published) || textOf(raw.updated)),
    summary: summary ? stripHtml(summary).slice(0, 2000) : null,
    fullText: content ? stripHtml(content) : null,
    sourceName: null,
    sourceUrl: null,
  };
}

export function parseFeed(xml: string): FeedItem[] {
  const doc = parser.parse(xml);

  const channel = doc?.rss?.channel ?? doc?.['rdf:RDF'] ?? null;
  if (channel) {
    const items = asArray(channel.item ?? doc?.['rdf:RDF']?.item);
    return items.map(parseRssItem).filter((i) => i.title);
  }

  const feed = doc?.feed;
  if (feed) {
    return asArray(feed.entry).map(parseAtomEntry).filter((i) => i.title);
  }

  return [];
}

export async function fetchFeed(url: string, timeoutMs = 15000): Promise<FeedResult> {
  const res = await fetchText(url, {
    timeoutMs,
    accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
  });

  if (!res.ok) {
    return { ok: false, items: [], status: res.status, error: res.error ?? `HTTP ${res.status}` };
  }

  try {
    const items = parseFeed(res.body);
    if (items.length === 0) {
      return { ok: false, items: [], status: res.status, error: 'ฟีดตอบกลับแต่ไม่พบรายการข่าว' };
    }
    return { ok: true, items, status: res.status };
  } catch (err: any) {
    return { ok: false, items: [], status: res.status, error: `parse ล้มเหลว: ${err?.message ?? err}` };
  }
}

/** true เมื่อลิงก์เป็น redirect ของ Google News ซึ่งถอดกลับเป็น URL ต้นทางไม่ได้ */
export function isGoogleNewsLink(link: string | null): boolean {
  if (!link) return false;
  return /^https?:\/\/news\.google\.com\/(rss\/)?articles\//i.test(link);
}

/**
 * Google News ใส่ชื่อสำนักข่าวต่อท้ายพาดหัวด้วย " - ชื่อสำนัก"
 * ตัดออกเพื่อให้ news_title สะอาด
 */
export function splitGoogleNewsTitle(title: string): { title: string; agency: string | null } {
  const m = title.match(/^(.*?)\s+-\s+([^-]{2,40})$/s);
  if (!m) return { title, agency: null };
  return { title: m[1].trim(), agency: m[2].trim() };
}
