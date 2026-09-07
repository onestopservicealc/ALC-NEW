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
