/**
 * ตรวจว่า import แบบ relative ทุกจุดที่โค้ดฝั่งเซิร์ฟเวอร์ใช้ ลงท้ายด้วย .js
 *
 * ทำไมต้องมี:
 * `package.json` ตั้ง `"type": "module"` Node จึงบังคับให้ ESM ระบุนามสกุลไฟล์เสมอ
 * ถ้าลืม ทุกเครื่องมือในมือจะบอกว่าโค้ดถูกต้อง — Vite แปลง path ให้ตอน dev,
 * `tsc` ผ่านเพราะ moduleResolution เป็น "bundler", esbuild ก็ bundle ผ่าน
 * แต่พอขึ้น Vercel จะได้ ERR_MODULE_NOT_FOUND แล้วฟังก์ชันตายตั้งแต่โหลดโมดูล
 * คืน HTTP 500 ที่ body ไม่ใช่ JSON ทำให้ดูเหมือนโค้ดข้างในมีปัญหา ทั้งที่ยังไม่ได้เริ่มรัน
 *
 * ไล่ตามสายจาก api/ ไปจนสุด รวมไฟล์ใน src/ ที่ฝั่งเซิร์ฟเวอร์ยืมไปใช้ด้วย
 *
 *   npm run check:imports
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const IMPORT_RE = /(?:from\s+|import\()\s*['"](\.{1,2}\/[^'"]*)['"]/g;

function listTs(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return listTs(full);
    return full.endsWith('.ts') || full.endsWith('.tsx') ? [full] : [];
  });
}

/** หาไฟล์จริงที่ specifier ชี้ไป (รองรับทั้งแบบมีและไม่มีนามสกุล) */
function resolveSpec(fromFile: string, spec: string): string | null {
  const base = resolve(dirname(fromFile), spec.replace(/\.js$/, ''));
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const problems: string[] = [];
const seen = new Set<string>();
const queue = listTs('api');

while (queue.length) {
  const file = queue.shift()!;
  const rel = file.replace(`${process.cwd()}/`, '');
  if (seen.has(rel)) continue;
  seen.add(rel);

  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(IMPORT_RE)) {
    const spec = m[1];
    if (!/\.(js|json)$/.test(spec)) {
      const line = src.slice(0, m.index).split('\n').length;
      problems.push(`${rel}:${line}  ${spec}  → ต้องเป็น ${spec}.js`);
    }
    // เดินตามสายต่อ เพราะไฟล์ใน src/ ที่ api ยืมไปใช้ก็ต้องถูกกฎเดียวกัน
    const target = resolveSpec(file, spec);
    if (target) queue.push(target);
  }
}

console.log(`\nตรวจ ${seen.size} ไฟล์ที่ฝั่งเซิร์ฟเวอร์ใช้จริง`);

if (problems.length) {
  console.error(`\n✕ พบ import ที่ไม่มีนามสกุล ${problems.length} จุด — จะพังบน Vercel:\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error('\nแก้โดยเติม .js ท้าย path (ถึงไฟล์ต้นทางจะเป็น .ts ก็ตาม)');
  process.exit(1);
}

console.log('✓ import ครบนามสกุลทุกจุด');
