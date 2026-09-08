/**
 * พิสูจน์ว่าโค้ดฝั่งเซิร์ฟเวอร์ "โหลดได้จริง" ด้วยกติกา ESM ของ Node แบบเดียวกับบน Vercel
 *
 * ทำไมต้องจำลองการรันจริง ไม่ใช่แค่อ่านโค้ด:
 * `package.json` ตั้ง `"type": "module"` Node จึงบังคับให้ relative import ระบุนามสกุลไฟล์
 * ถ้าลืม ทุกเครื่องมือในมือจะบอกว่าโค้ดถูกต้อง — Vite แปลง path ให้ตอน dev และ
 * `tsc --noEmit` ก็ผ่านเพราะ moduleResolution เป็น "bundler"
 * แต่พอขึ้น Vercel จะได้ ERR_MODULE_NOT_FOUND แล้วฟังก์ชันตายตั้งแต่โหลดโมดูล
 * คืน HTTP 500 ที่ body ไม่ใช่ JSON ทำให้ดูเหมือนโค้ดข้างในมีปัญหา ทั้งที่ยังไม่ได้เริ่มรัน
 *
 * **ต้องใช้ tsc ในการ emit เท่านั้น ห้ามใช้ esbuild** — esbuild เติมนามสกุลให้เองตอนแปลง
 * จึงกลบบั๊กจนตรวจไม่เจอ (ลองมาแล้ว) ส่วน tsc เก็บ path ไว้ตรงตามที่เขียน เหมือนที่ Vercel ทำ
 *
 * error ที่ไม่ใช่ ERR_MODULE_NOT_FOUND (เช่นไม่มี env) ถือว่าผ่าน เพราะแปลว่าโหลดโมดูลสำเร็จแล้ว
 *
 *   npm run check:imports
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

function listTs(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return listTs(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

/** ไฟล์ที่กลายเป็น endpoint จริงบน Vercel (ไฟล์/โฟลเดอร์ขึ้นต้นด้วย _ ไม่นับ) */
const endpoints = listTs('api').filter((f) => !f.split('/').some((p) => p.startsWith('_')));

// วางไว้ในโปรเจกต์เพื่อให้หา node_modules และ @types เจอตามลำดับ parent เหมือนตอนรันจริง
const work = mkdtempSync(join(process.cwd(), '.import-check-'));

try {
  writeFileSync(
    join(work, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        skipLibCheck: true,
        noCheck: true,
        noEmit: false,
        outDir: join(work, 'out'),
        rootDir: process.cwd(),
        jsx: 'react-jsx',
        allowJs: true,
        isolatedModules: true,
      },
      include: [join(process.cwd(), 'api'), join(process.cwd(), 'src')],
    })
  );

  execFileSync('npx', ['tsc', '-p', join(work, 'tsconfig.json')], { stdio: 'pipe' });

  console.log(`\nจำลองการโหลดแบบ Node ESM · ${endpoints.length} endpoint`);
  const broken: string[] = [];

  for (const src of endpoints) {
    const compiled = join(work, 'out', src.replace(/\.ts$/, '.js'));

    // ต้องแยกไปรันด้วย node เปล่าๆ ห้าม import ตรงนี้ —
    // สคริปต์นี้รันผ่าน tsx ซึ่งมี loader ที่เติมนามสกุลให้เอง จะกลบบั๊กจนตรวจไม่เจอ
    let stderr = '';
    try {
      execFileSync('node', ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(compiled).href)})`], {
        stdio: 'pipe',
        env: { ...process.env, NODE_OPTIONS: '' },
      });
    } catch (err: any) {
      stderr = String(err?.stderr ?? '');
    }

    if (!stderr.includes('ERR_MODULE_NOT_FOUND')) {
      // ไม่มี error หรือพังตอนรัน (เช่นไม่มี env) = โหลดโมดูลผ่านแล้ว ซึ่งคือสิ่งที่ตรวจ
      console.log(`  ✓ ${src}`);
      continue;
    }

    const missing = stderr.match(/Cannot find module '([^']+)'/)?.[1] ?? '?';
    const from = stderr.match(/imported from (\S+)/)?.[1] ?? '?';
    const clean = (p: string) => p.replace(join(work, 'out') + '/', '').replace('file://', '');
    console.log(`  ✕ ${src}`);
    console.log(`      หาไม่เจอ: ${clean(missing)}`);
    console.log(`      import จาก: ${clean(from)}  → ต้องเติม .js`);
    broken.push(src);
  }

  if (broken.length) {
    console.error(`\n✕ ${broken.length} endpoint โหลดไม่ได้ — บน Vercel จะเป็น HTTP 500 ที่ไม่มีข้อความ`);
    console.error('  แก้โดยเติม .js ท้าย relative import (ถึงไฟล์ต้นทางจะเป็น .ts ก็ตาม)');
    process.exit(1);
  }
  console.log('\n✓ ทุก endpoint โหลดโมดูลได้ครบ');
} finally {
  rmSync(work, { recursive: true, force: true });
}
