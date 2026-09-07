/**
 * ถอดลิงก์ Google News กลับเป็น URL ของสำนักข่าวต้นทาง
 *
 * ทำไมถึงมีไฟล์นี้ทั้งที่ README เคยสรุปว่าถอดไม่ได้:
 * Google เปลี่ยนวิธีเข้ารหัสเป็นระยะ ตอนที่ทดสอบครั้งก่อน (ส.ค. 2026) ทั้งการตาม redirect
 * การ base64 decode และ batchexecute รุ่นเดิมใช้ไม่ได้จริง แต่ทดสอบซ้ำเมื่อ 2026-09-07
 * ด้วย payload `garturlreq` รูปแบบปัจจุบัน ถอดสำเร็จ 8 จาก 8 ลิงก์ ใช้เวลา 237-413 ms ต่อลิงก์
 *
 * กลไก 2 ขั้น:
 *   1. เปิดหน้า article เพื่อเอา signature (`data-n-a-sg`) กับ timestamp (`data-n-a-ts`)
 *      ที่ Google ฝังไว้ — สองค่านี้มีอายุจำกัด จึงขอสดทุกครั้ง แคชไม่ได้
 *   2. ยิง batchexecute พร้อมสองค่านั้น แล้วอ่าน URL จริงจากคำตอบ
 *
 * เปราะตามธรรมชาติ เพราะพึ่ง endpoint ภายในที่ Google ไม่รับประกัน
 * ทุกจุดที่พังจึงคืน `{ url: null, error }` เสมอ ไม่ throw — ผู้เรียกต้องมีทางถอยให้คนวาง URL เอง
 */
import { USER_AGENT } from './env';
import { fetchText } from './http';

export interface ResolveResult {
  url: string | null;
  error?: string;
}

/** ดึง id ท้าย path ของลิงก์ Google News */
function articleId(link: string): string | null {
  try {
    const last = new URL(link).pathname.split('/').filter(Boolean).pop();
    return last && /^[A-Za-z0-9_-]{16,}$/.test(last) ? last : null;
  } catch {
    return null;
  }
}

/**
 * payload ของคำขอ garturlreq
 * ค่าคงที่ทั้งก้อนเป็นรูปแบบที่ Google กำหนด ("X" คือช่องที่ไม่ใช้แต่ต้องมี)
 */
function buildRequest(id: string, timestamp: number, signature: string): string {
  const inner = JSON.stringify([
    'garturlreq',
    [
      ['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1],
      'X',
      'X',
      1,
      [1, 1, 1],
      1,
      1,
      null,
      0,
      0,
      null,
      0,
    ],
    id,
    timestamp,
    signature,
  ]);
  return JSON.stringify([[['Fbv4je', inner, null, 'generic']]]);
}

/** อ่าน URL จริงออกจากคำตอบของ batchexecute (คำตอบขึ้นต้นด้วย )]}' แล้วตามด้วยหลายบรรทัด) */
function readUrl(body: string): string | null {
  const line = body.split('\n').find((l) => l.includes('garturlres'));
  if (!line) return null;
  try {
    const payload = JSON.parse(line)?.[0]?.[2];
    if (typeof payload !== 'string') return null;
    const url = JSON.parse(payload)?.[1];
    return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null;
  } catch {
    return null;
  }
}

/**
 * ถอดลิงก์ Google News หนึ่งลิงก์
 * คืน `{ url: null, error }` เมื่อถอดไม่ได้ — ไม่ throw เพื่อให้ผู้เรียกถอยไปทางให้คนวาง URL ได้เสมอ
 */
export async function resolveGoogleNewsUrl(
  link: string,
  opts: { timeoutMs?: number } = {}
): Promise<ResolveResult> {
  const timeoutMs = opts.timeoutMs ?? 12000;
  const id = articleId(link);
  if (!id) return { url: null, error: 'ลิงก์นี้ไม่ใช่รูปแบบ news.google.com/articles ที่ถอดได้' };

  /* ---- 1. ขอ signature + timestamp จากหน้า article ---- */
  const page = await fetchText(`https://news.google.com/rss/articles/${id}`, { timeoutMs });
  if (!page.ok) {
    return { url: null, error: `เปิดหน้า Google News ไม่สำเร็จ (${page.error ?? page.status})` };
  }

  const signature = page.body.match(/data-n-a-sg="([^"]+)"/)?.[1];
  const timestamp = page.body.match(/data-n-a-ts="([^"]+)"/)?.[1];
  // ปกติ id ในหน้าตรงกับใน URL แต่ Google เคยส่งคนละตัว จึงเชื่อค่าในหน้าก่อน
  const innerId = page.body.match(/data-n-a-id="([^"]+)"/)?.[1] ?? id;

  if (!signature || !timestamp) {
    // สัญญาณว่า Google เปลี่ยนรูปแบบอีกแล้ว — ต้องกลับมาแก้ไฟล์นี้
    return { url: null, error: 'หน้า Google News ไม่มี signature ที่ใช้ถอดลิงก์ (Google อาจเปลี่ยนรูปแบบ)' };
  }

  /* ---- 2. แลก signature เป็น URL จริง ---- */
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT(),
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: new URLSearchParams({ 'f.req': buildRequest(innerId, Number(timestamp), signature) }),
    });

    if (!res.ok) return { url: null, error: `Google News ตอบกลับ ${res.status}` };

    const url = readUrl(await res.text());
    if (!url) return { url: null, error: 'คำตอบของ Google News ไม่มี URL ต้นทาง' };
    // กันกรณีถอดแล้ววนกลับมาที่ Google เอง ซึ่งเอาไปดึงเนื้อข่าวต่อไม่ได้
    if (/^https?:\/\/news\.google\.com\//i.test(url)) {
      return { url: null, error: 'ถอดแล้วยังเป็นลิงก์ Google News อยู่' };
    }
    return { url };
  } catch (err: any) {
    const aborted = err?.name === 'AbortError';
    return { url: null, error: aborted ? `หมดเวลา ${timeoutMs}ms` : String(err?.message ?? err) };
  } finally {
    clearTimeout(timer);
  }
}
