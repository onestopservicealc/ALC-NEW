/**
 * HTTP client สำหรับดึงฟีดและหน้าข่าว
 * - ระบุ User-Agent ที่ติดต่อกลับได้
 * - จำกัดอัตราการยิงต่อโดเมน
 * - timeout ชัดเจน ไม่ให้ค้างจนหมดงบเวลาของ function
 */
import { intEnv, USER_AGENT } from './env.js';

/**
 * เว้นระยะระหว่าง request ของโดเมนเดียวกัน
 *
 * 350 ms ≈ 3 ครั้ง/วินาที — เร็วพอให้ดึง sitemap ของช่อง 7 (500 หน้า) จบในไม่กี่รอบ cron
 * และช้าพอที่จะไม่ถูกมองว่าเป็นการถล่มเว็บ (เคยโดนหน้าค้นหาของช่อง 7 บล็อกมาแล้ว
 * ตอนยิงรัวโดยไม่เว้นจังหวะ)
 */
const MIN_INTERVAL_MS = () => intEnv('HTTP_MIN_INTERVAL_MS', 350);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * คิวรอต่อโดเมน
 *
 * เดิมเก็บแค่ "เวลาที่ยิงล่าสุด" แล้วอ่าน-หน่วง-เขียน ซึ่งแข่งกันเอง:
 * ผู้เรียกที่ทำงานพร้อมกันอ่านค่าเดียวกันได้หมด ทุกตัวจึงคำนวณว่าไม่ต้องรอ
 * แล้วยิงออกไปพร้อมกัน — การจำกัดอัตราจึงไม่เคยทำงานจริงเมื่อมีการทำงานขนาน
 *
 * แก้ด้วยการต่อคิวเป็นลูกโซ่ promise ต่อโดเมน ผู้เรียกลำดับถัดไปรอคิวก่อนหน้าเสมอ
 */
const hostQueue = new Map<string, Promise<void>>();
const lastRequestAt = new Map<string, number>();

function throttle(host: string): Promise<void> {
  const previous = hostQueue.get(host) ?? Promise.resolve();

  const next = previous.then(async () => {
    // หน่วงเท่าที่ยังขาด ไม่ใช่หน่วงเต็มทุกครั้ง — โดเมนที่ไม่ได้ยิงมานานจึงไปได้ทันที
    // (สำคัญกับหน้าที่ผู้ใช้รออยู่ เช่นตอนวางลิงก์ในคิวยืนยัน)
    const wait = (lastRequestAt.get(host) ?? 0) + MIN_INTERVAL_MS() - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt.set(host, Date.now());
  });

  // กัน unhandled rejection ถ้าคิวก่อนหน้าพัง และไม่ให้ error ลามไปคิวถัดไป
  hostQueue.set(
    host,
    next.catch(() => undefined)
  );
  return next;
}

export interface FetchTextResult {
  ok: boolean;
  status: number;
  body: string;
  finalUrl: string;
  error?: string;
}

/**
 * อ่าน body ทีละก้อนแล้วหยุดเองเมื่อเกินเพดาน
 *
 * ทำไมเช็ค content-length ไม่พอ: ทดสอบแล้วพบว่า Google ไม่ส่ง content-length มาเลย
 * ใช้ chunked ทั้งหมด ด่านที่ดูแต่ header จึงไม่เคยทำงาน และ res.text() จะดูดทุกอย่าง
 * เข้าหน่วยความจำไม่จำกัด ถ้าปลายทางส่งก้อนใหญ่มา ฟังก์ชันจะตายด้วย out of memory
 * ซึ่ง try/catch ดักไม่ได้ เพราะโปรเซสถูกฆ่าทั้งตัว ไม่ใช่ throw
 */
async function readCapped(
  res: Response,
  maxBytes: number
): Promise<{ text: string; truncated: boolean }> {
  const reader = res.body?.getReader();
  if (!reader) return { text: await res.text(), truncated: false };

  const decoder = new TextDecoder();
  let text = '';
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        // ตัดการเชื่อมต่อทิ้งทันที ไม่ต้องรอให้ดาวน์โหลดจบ
        await reader.cancel().catch(() => undefined);
        return { text, truncated: true };
      }
      text += decoder.decode(value, { stream: true });
    }
    return { text: text + decoder.decode(), truncated: false };
  } finally {
    reader.releaseLock?.();
  }
}

export async function fetchText(
  url: string,
  opts: {
    timeoutMs?: number;
    accept?: string;
    /**
     * ข้ามคิวจำกัดอัตราต่อโดเมน
     *
     * คิวนี้รอ "นอก" AbortController จึงไม่ถูกนับใน timeoutMs เลย
     * งานเบื้องหลังรอได้ แต่เส้นทางที่มีคนกดปุ่มรออยู่ไม่ควรไปต่อท้ายคิว
     * แล้วเลยเพดานเวลาของ serverless จนกลายเป็น 500 เปล่า
     */
    skipThrottle?: boolean;
    /** เพดานขนาด body กันหน้าที่ยัดข้อมูลก้อนใหญ่มาให้ */
    maxBytes?: number;
  } = {}
): Promise<FetchTextResult> {
  const timeoutMs = opts.timeoutMs ?? 15000;
  let host = '';
  try {
    host = new URL(url).host;
  } catch {
    return { ok: false, status: 0, body: '', finalUrl: url, error: 'URL ไม่ถูกต้อง' };
  }

  if (!opts.skipThrottle) await throttle(host);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT(),
        Accept: opts.accept ?? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'th,en;q=0.8',
      },
    });
    if (opts.maxBytes) {
      const capped = await readCapped(res, opts.maxBytes);
      if (capped.truncated) {
        return {
          ok: false,
          status: res.status,
          body: '',
          finalUrl: res.url || url,
          error: `หน้าเว็บใหญ่เกินกำหนด (เกิน ${opts.maxBytes} ไบต์)`,
        };
      }
      return { ok: res.ok, status: res.status, body: capped.text, finalUrl: res.url || url };
    }

    const body = await res.text();
    return { ok: res.ok, status: res.status, body, finalUrl: res.url || url };
  } catch (err: any) {
    return {
      ok: false,
      status: 0,
      body: '',
      finalUrl: url,
      error: err?.name === 'AbortError' ? `timeout ${timeoutMs}ms` : String(err?.message ?? err),
    };
  } finally {
    clearTimeout(timer);
  }
}

const TRACKING_PARAMS = /^(utm_|fbclid|gclid|igshid|mc_cid|mc_eid|ref|ref_src|spm|s_cid|cx_)/i;

/**
 * ทำ URL ให้อยู่ในรูปมาตรฐานเพื่อใช้เป็นกุญแจกันข้อมูลซ้ำ
 * lowercase host, ตัด www., ตัด tracking params, ตัด fragment, ตัด / ท้าย
 */
export function canonicalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = '';
    u.host = u.host.toLowerCase().replace(/^www\./, '');
    u.protocol = 'https:';
    const keep: [string, string][] = [];
    u.searchParams.forEach((value, key) => {
      if (!TRACKING_PARAMS.test(key)) keep.push([key, value]);
    });
    u.search = '';
    keep.sort(([a], [b]) => a.localeCompare(b));
    for (const [k, v] of keep) u.searchParams.append(k, v);
    let out = u.toString();
    if (out.endsWith('/') && u.pathname !== '/') out = out.slice(0, -1);
    return out;
  } catch {
    return raw.trim();
  }
}
