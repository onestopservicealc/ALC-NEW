/**
 * ตรวจว่าตัวอักษรบนหน้าจออ่านได้จริง
 *
 * ผู้ใช้ระบบนี้เป็นเจ้าหน้าที่อายุ 30 ปีขึ้นไป สายตาเริ่มถอย ตัวอักษรเล็กหรือสีจางจึงเป็นปัญหาจริง
 * ตรวจสองอย่างที่อ่านโค้ดแล้วบอกไม่ได้:
 *   1. อัตราความต่างของสี (contrast) ตามเกณฑ์ WCAG AA — 4.5:1 สำหรับตัวอักษรปกติ 3:1 สำหรับตัวใหญ่
 *   2. ขนาดตัวอักษรที่เล็กกว่า 12px
 *
 * Tailwind 4 ใช้สี oklch() การแยกตัวเลขจากสตริงจะอ่านค่าผิด จึงให้เบราว์เซอร์แปลงผ่าน canvas
 * (เคยพลาดตรงนี้จนรายงานว่าตัวหนังสือเกือบดำมี contrast ต่ำ)
 *
 * เคยจับของจริงได้: ปุ่ม "อนุมัติเข้าสถิติ" เป็นตัวหนังสือดำบนพื้นดำ (1.17:1) อ่านไม่ออกเลย
 *
 *   npm run check:a11y
 */
import './_env';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

/**
 * ตรวจ contrast ตามเกณฑ์ WCAG AA
 *
 * Tailwind 4 ใช้สี oklch() การแยกตัวเลขจากสตริงตรงๆ จะอ่านค่าผิด
 * จึงให้เบราว์เซอร์แปลงสีผ่าน canvas เป็น rgba ก่อนคำนวณ
 */
const SCRIPT = `(() => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const cx = cv.getContext('2d');
  const toRgb = (css) => {
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = '#000';
    cx.fillStyle = css;
    cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };
  const lum = (rgb) => {
    const f = rgb.slice(0, 3).map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
  };
  const out = [];
  const stack = [document.body];
  while (stack.length) {
    const el = stack.pop();
    for (const c of Array.from(el.children)) stack.push(c);
    const t = (el.textContent || '').trim();
    if (el.children.length !== 0 || t.length < 3 || t.length > 60) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    let bgEl = el, bg = null;
    while (bgEl) {
      const c = toRgb(getComputedStyle(bgEl).backgroundColor);
      if (c[3] > 0.5) { bg = c; break; }
      bgEl = bgEl.parentElement;
    }
    if (!bg) bg = [255, 255, 255, 1];
    const fg = toRgb(cs.color);
    const l1 = lum(fg), l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    out.push({
      text: t.slice(0, 42),
      size: parseFloat(cs.fontSize),
      weight: cs.fontWeight,
      ratio: Math.round(ratio * 100) / 100,
      fg: 'rgb(' + fg.slice(0, 3).join(',') + ')',
      bg: 'rgb(' + bg.slice(0, 3).join(',') + ')',
    });
  }
  return out;
})()`;

async function main() {
  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const PW = 'A11y!' + Date.now();
  const EMAIL = `a11y-${Date.now()}@example.com`;
  const { data: u } = await admin.auth.admin.createUser({ email: EMAIL, password: PW, email_confirm: true });
  await admin.from('profiles').upsert({ id: u.user!.id, role: 'admin' }, { onConflict: 'id' });

  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1200 } });
  const p = await ctx.newPage();
  await p.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await p.waitForTimeout(3500);

  const TABS = [
    { name: 'หน้าสถิติสาธารณะ', go: async () => {} },
  ];

  const rows = (await p.evaluate(SCRIPT)) as {
    text: string; size: number; weight: string; ratio: number; fg: string; bg: string;
  }[];

  const seen = new Set<string>();
  const bad: typeof rows = [];
  for (const r of rows) {
    const large = r.size >= 24 || (r.size >= 18.66 && Number(r.weight) >= 700);
    const need = large ? 3 : 4.5;
    if (r.ratio >= need) continue;
    const k = `${r.fg}|${r.bg}|${Math.round(r.size)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    bad.push(r);
  }

  console.log(`ตรวจข้อความ ${rows.length} ชิ้น`);
  if (bad.length === 0) console.log('  ✓ ผ่านเกณฑ์ WCAG AA ทุกชิ้น');
  for (const r of bad) {
    console.log(`  ✕ ${r.ratio}:1  ${Math.round(r.size)}px  "${r.text}"`);
    console.log(`      ${r.fg} บน ${r.bg}`);
  }

  const tiny = rows.filter((r) => r.size < 12);
  const tinySet = new Map<number, string[]>();
  for (const t of tiny) {
    const arr = tinySet.get(Math.round(t.size)) ?? [];
    if (arr.length < 3) arr.push(t.text);
    tinySet.set(Math.round(t.size), arr);
  }
  console.log(`\nข้อความเล็กกว่า 12px: ${tiny.length} ชิ้น`);
  for (const [size, ex] of [...tinySet].sort()) {
    console.log(`  ${size}px (${tiny.filter((t) => Math.round(t.size) === size).length} ชิ้น) เช่น ${ex.map((e) => `"${e.slice(0, 22)}"`).join(', ')}`);
  }
  // ---- หน้าฝั่งเจ้าหน้าที่ ----
  await p.getByRole('button', { name: /เข้าสู่ระบบ/ }).first().click();
  await p.locator('input[type="email"]').fill(EMAIL);
  await p.locator('input[type="password"]').fill(PW);
  await p.getByRole('button', { name: /^เข้าสู่ระบบ$/ }).last().click();
  await p.waitForTimeout(3500);

  for (const [label, pattern] of [
    ['คิวตรวจสอบข่าว', /คิวตรวจสอบข่าว/],
    ['แหล่งข่าว', /แหล่งข่าว/],
    ['ฟอร์มบันทึก', /ฟอร์มบันทึก/],
  ] as [string, RegExp][]) {
    await p.getByRole('button', { name: pattern }).first().click();
    await p.waitForTimeout(2500);
    const rs = (await p.evaluate(SCRIPT)) as typeof rows;
    const seen2 = new Set<string>();
    const bad2 = rs.filter((r) => {
      const large = r.size >= 24 || (r.size >= 18.66 && Number(r.weight) >= 700);
      if (r.ratio >= (large ? 3 : 4.5)) return false;
      const k = `${r.fg}|${r.bg}|${Math.round(r.size)}`;
      if (seen2.has(k)) return false;
      seen2.add(k);
      return true;
    });
    const tiny2 = rs.filter((r) => r.size < 12);
    console.log(`\n${label}: ตรวจ ${rs.length} ชิ้น · contrast ไม่ผ่าน ${bad2.length} · เล็กกว่า 12px ${tiny2.length}`);
    for (const r of bad2.slice(0, 6)) console.log(`  ✕ ${r.ratio}:1 ${Math.round(r.size)}px "${r.text}" — ${r.fg} บน ${r.bg}`);
    for (const r of tiny2.slice(0, 4)) console.log(`  · ${Math.round(r.size)}px "${r.text}"`);
  }

  await b.close();
  await admin.auth.admin.deleteUser(u.user!.id);
}
void main();
