/**
 * ตรวจว่าการถอดลิงก์ Google News ยังใช้ได้อยู่ไหม
 *
 * ทำไมต้องมีสคริปต์นี้:
 * `api/_lib/gnews.ts` พึ่ง endpoint ภายในของ Google (`batchexecute`) ที่ไม่มีสัญญาว่าจะไม่เปลี่ยน
 * ถ้าวันหนึ่ง Google เปลี่ยนรูปแบบ การถอดจะพังเงียบๆ แล้วคิว "ต้องยืนยันลิงก์" จะบวมขึ้นเรื่อยๆ
 * โดยไม่มีใครรู้สาเหตุ — สคริปต์นี้ทำให้รู้ตัวก่อน
 *
 * ดึงลิงก์สดจาก Google News จริงทุกครั้ง ไม่ใช้ลิงก์ฝังไว้ เพราะ signature มีอายุจำกัด
 *
 *   npm run check:gnews              ตรวจ 8 ลิงก์
 *   npm run check:gnews -- --n 20    ตรวจ 20 ลิงก์
 */
import './_env';
import { resolveGoogleNewsUrl } from '../api/_lib/gnews';
import { fetchText } from '../api/_lib/http';

/** ต่ำกว่านี้ถือว่าพัง — เผื่อบางลิงก์ล่มเป็นรายตัวได้ แต่ไม่ควรพร้อมกันทั้งหมด */
const PASS_RATE = 0.7;

const QUERY = 'เมาแล้วขับ';
const FEED = `https://news.google.com/rss/search?q=${encodeURIComponent(QUERY)}&hl=th&gl=TH&ceid=TH:th`;

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

async function main() {
  const want = arg('n', 8);
  console.log(`\nดึงลิงก์สดจาก Google News (ค้น "${QUERY}")...`);

  const feed = await fetchText(FEED, { timeoutMs: 20000 });
  if (!feed.ok) {
    console.error(`✕ ดึงฟีด Google News ไม่สำเร็จ: ${feed.error ?? feed.status}`);
    process.exit(1);
  }

  const links = [...new Set(feed.body.match(/https:\/\/news\.google\.com\/rss\/articles\/[A-Za-z0-9_-]+/g) ?? [])].slice(
    0,
    want
  );

  if (links.length === 0) {
    console.error('✕ ฟีดไม่มีลิงก์บทความให้ทดสอบ (รูปแบบฟีดอาจเปลี่ยน)');
    process.exit(1);
  }

  console.log(`ทดสอบถอด ${links.length} ลิงก์\n`);

  let ok = 0;
  let totalMs = 0;
  const errors: string[] = [];

  for (const link of links) {
    const started = Date.now();
    const result = await resolveGoogleNewsUrl(link);
    const took = Date.now() - started;
    totalMs += took;

    if (result.url) {
      ok++;
      console.log(`  ✓ ${String(took).padStart(5)}ms  ${new URL(result.url).hostname}`);
    } else {
      errors.push(result.error ?? 'ไม่ทราบสาเหตุ');
      console.log(`  ✕ ${String(took).padStart(5)}ms  ${result.error}`);
    }
  }

  const rate = ok / links.length;
  console.log(
    `\nถอดสำเร็จ ${ok}/${links.length} (${Math.round(rate * 100)}%) · เฉลี่ย ${Math.round(totalMs / links.length)}ms ต่อลิงก์`
  );

  if (rate < PASS_RATE) {
    console.error(
      `\n✕ ต่ำกว่าเกณฑ์ ${Math.round(PASS_RATE * 100)}% — Google อาจเปลี่ยนรูปแบบแล้ว`
    );
    console.error('  ต้องกลับไปแก้ api/_lib/gnews.ts');
    console.error(`  สาเหตุที่พบ: ${[...new Set(errors)].join(' · ')}`);
    console.error('  ระหว่างที่ยังแก้ไม่ได้ เจ้าหน้าที่ยังยืนยันลิงก์ด้วยมือได้ตามเดิม (ระบบถอยให้เอง)');
    process.exit(1);
  }

  console.log('✓ การถอดลิงก์ Google News ยังใช้งานได้');
}

void main();
