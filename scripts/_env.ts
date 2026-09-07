/**
 * โหลดตัวแปรสภาพแวดล้อมให้สคริปต์ใน scripts/
 *
 * Vite อ่าน .env.local เป็นหลัก แต่ dotenv ปริยายอ่านแค่ .env
 * ถ้าไม่จัดการตรงนี้ สคริปต์จะหาคีย์ไม่เจอทั้งที่ตั้งค่าไว้ถูกแล้ว
 * ลำดับความสำคัญ: ค่าที่ตั้งใน shell > .env.local > .env
 *
 * และคัดค่าที่ยังเป็น "ข้อความตัวอย่าง" ออก เพราะค่าพวกนี้ผ่านการเช็ค
 * `if (!process.env.X)` ไปได้ แล้วไปพังลึกๆ ด้วย error ที่อ่านไม่ออก
 * (เช่น ค่าที่มีอักขระไทยหรือ → จะทำให้ HTTP header ตั้งไม่ได้)
 */
import { config } from 'dotenv';

config({ path: '.env.local' });
config({ path: '.env' });

/** ค่าที่ยังไม่ได้แทนที่จริง — วงเล็บมุม หรืออักขระที่ใส่ใน HTTP header ไม่ได้ */
function looksLikePlaceholder(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  if (v.startsWith('<') || v.startsWith('MY_')) return true;
  // header ต้องเป็น Latin-1 เท่านั้น ค่าที่มีภาษาไทย/ลูกศร แปลว่ายังเป็นข้อความอธิบาย
  return [...v].some((c) => c.charCodeAt(0) > 255);
}

const WATCHED = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'GEMINI_API_KEY',
  'CRON_SECRET',
];

const placeholders: string[] = [];
for (const key of WATCHED) {
  const value = process.env[key];
  if (value && looksLikePlaceholder(value)) {
    placeholders.push(key);
    delete process.env[key]; // ให้โค้ดถัดไปมองว่า "ยังไม่ได้ตั้ง" ซึ่งตรงความจริงกว่า
  }
}

if (placeholders.length) {
  console.warn(
    `\n⚠ ตัวแปรเหล่านี้ใน .env.local ยังเป็นข้อความตัวอย่าง ไม่ใช่ค่าจริง — ถือว่ายังไม่ได้ตั้งค่า:\n` +
      placeholders.map((k) => `    ${k}`).join('\n') +
      `\n  แทนที่ด้วยค่าจริงจาก Supabase Dashboard → Settings → API` +
      `\n  และ Gemini key จาก aistudio.google.com/apikey\n`
  );
}
