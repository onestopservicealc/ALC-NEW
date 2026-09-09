/** อ่าน env แบบมี error ที่บอกได้ว่าขาดตัวไหน */

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`ไม่ได้ตั้งค่า environment variable: ${name}`);
  }
  return value.trim();
}

export function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

export function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const USER_AGENT = () =>
  optionalEnv(
    'INGEST_USER_AGENT',
    'AlcoholIncidentWatch/1.0 (+https://github.com/; news monitoring for public health research)'
  );

/**
 * วันแรกที่ระบบเก็บข้อมูล — ข่าวที่เผยแพร่ก่อนหน้านี้ถูกตัดทิ้งตั้งแต่ก่อนบันทึก
 *
 * ตั้งไว้เพราะฟีดสำนักข่าวและ Google News ยังส่งข่าวเก่าย้อนหลังหลายปีมาปนอยู่เรื่อยๆ
 * ซึ่งไม่ใช่ขอบเขตที่ระบบนี้เฝ้าระวัง และเปลืองโควตา AI ไปกับข่าวที่ไม่ได้ใช้
 *
 * ข่าวที่ **ไม่มีวันเผยแพร่** ยังรับไว้ เพราะฟีดบางเจ้าไม่ส่งวันมาเลย
 * และมักเป็นข่าวใหม่ที่เพิ่งขึ้นเว็บ — ตัดทิ้งจะเสียของจริง
 */
export const MIN_PUBLISHED_DATE = () => optionalEnv('INGEST_MIN_PUBLISHED_DATE', '2026-01-01');

/**
 * วันแรกของ "เหตุการณ์" ที่ระบบเก็บ — คนละเรื่องกับวันเผยแพร่ข่าว
 *
 * ข่าวที่เผยแพร่วันนี้อาจรายงานเหตุการณ์เมื่อสองปีก่อน (ข่าวศาลตัดสิน ข่าวติดตามคดี)
 * ซึ่งอยู่นอกช่วงที่ระบบเฝ้าระวัง ด่านวันเผยแพร่จับไม่ได้ ต้องมีด่านนี้แยกอีกชั้น
 */
export const MIN_INCIDENT_DATE = () => optionalEnv('INGEST_MIN_INCIDENT_DATE', '2026-01-01');

export const GEMINI_MODEL = () => optionalEnv('GEMINI_MODEL', 'gemini-3.7-flash');

/**
 * ลำดับโมเดลที่จะใช้ โดยตัวแรกเป็นตัวหลัก
 *
 * โควตาฟรีของ Gemini จำกัด "ต่อวัน ต่อโมเดล" (พบจริงว่าเป็น 20 ครั้ง/วัน)
 * การมีรุ่นสำรองจึงเพิ่มเพดานได้เป็นเท่าตัวโดยไม่ต้องเปิด billing
 * และกัน cron หยุดทำงานเงียบๆ เมื่อรุ่นหลักหมดโควตา
 *
 * หา่รุ่นที่บัญชีเรียกได้จริงด้วย: npm run verify:gemini -- --probe
 */
export function GEMINI_MODELS(): string[] {
  const list = optionalEnv('GEMINI_MODEL_FALLBACKS', '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  return [GEMINI_MODEL(), ...list.filter((m) => m !== GEMINI_MODEL())];
}
