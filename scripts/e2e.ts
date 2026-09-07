/**
 * ทดสอบระบบในมุมผู้ใช้งาน — ขับ Chrome จริงผ่าน Playwright
 *
 * ตรวจสิ่งที่ทดสอบด้วย API ไม่ได้: การมองเห็นตามสิทธิ์ · โฟกัสช่องกรอกอัตโนมัติ ·
 * การส่งเมื่อวาง · การเลื่อนไปข่าวถัดไปเอง · ชื่อบุคคลไม่หลุดสู่หน้าสาธารณะ
 *
 * ใช้ข้อมูลทดสอบที่มีคำนำหน้า [E2E] แยกจากคิวงานจริง และล้างทิ้งเมื่อจบเสมอ
 *
 *   npm run e2e            รันแบบไม่เปิดหน้าต่าง
 *   npm run e2e -- --head  เปิดหน้าต่างให้ดูระหว่างทดสอบ
 */
import './_env';
import { execFileSync } from 'node:child_process';
import { chromium, type Browser, type Page } from 'playwright';

const BASE = 'http://localhost:3000';
const HEADED = process.argv.includes('--head');

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(ok: boolean, label: string, detail = '') {
  if (ok) passed++;
  else {
    failed++;
    failures.push(label + (detail ? ` — ${detail}` : ''));
  }
  console.log(`  ${ok ? '✓' : '✕'} ${label}${detail ? `  — ${detail}` : ''}`);
}

function section(title: string) {
  console.log(`\n── ${title}`);
}

/** ข้อความทั้งหน้า ใช้ตรวจว่ามี/ไม่มีอะไรปรากฏ */
const bodyText = (page: Page) => page.locator('body').innerText();

async function main() {
  const fixture = JSON.parse(
    execFileSync('npx', ['tsx', 'scripts/e2e-fixture.ts', 'setup'], { encoding: 'utf8' })
      .split('\n')
      .filter((l) => l.trim().startsWith('{'))
      .pop()!
  );
  console.log(`\nข้อมูลทดสอบ: ${fixture.email} · เคส #${fixture.incidentSeq} · lead ${fixture.leadIds.length} รายการ`);

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: !HEADED });
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } } as never);
    page.on('pageerror', (e) => check(false, 'หน้าเว็บมี JavaScript error', e.message.slice(0, 80)));

    /* ═══════════ 1. ผู้ไม่ล็อกอิน ═══════════ */
    section('1. ผู้เยี่ยมชมทั่วไป (ไม่ล็อกอิน)');
    await page.goto(BASE, { waitUntil: 'networkidle' });

    const anonText = await bodyText(page);
    check(anonText.includes('ภาพรวมสถิติ'), 'เห็นแดชบอร์ดสถิติสาธารณะ');
    check(!anonText.includes('โหลดข้อมูลไม่สำเร็จ'), 'หน้าสาธารณะโหลดข้อมูลได้ ไม่มี error');
    // ต้องเห็นข้อมูลจริง ไม่ใช่หน้าเปล่า — เดิมเช็คแค่ว่าหน้าเรนเดอร์ได้
    const anonCases = Number((anonText.match(/([\d,]+)\s*เคส/) ?? [])[1]?.replace(/,/g, '') ?? 0);
    check(anonCases > 0, 'ผู้ไม่ล็อกอินเห็นเคสที่อนุมัติแล้ว', `เห็น ${anonCases} เคส`);
    check(!anonText.includes('คิวตรวจสอบข่าว'), 'ไม่เห็นแท็บคิวตรวจสอบ (สำหรับเจ้าหน้าที่)');
    check(!anonText.includes('แหล่งข่าว & การดึงข้อมูล'), 'ไม่เห็นแท็บแหล่งข่าว');
    check(
      await page.getByRole('button', { name: /เข้าสู่ระบบเจ้าหน้าที่/ }).isVisible(),
      'เห็นปุ่มเข้าสู่ระบบ'
    );

    // ชื่อบุคคลต้องไม่หลุดสู่สาธารณะ — ตรวจที่หน้าฐานข้อมูลเหตุการณ์
    await page.getByRole('button', { name: /ฐานข้อมูลเหตุการณ์/ }).click();
    await page.waitForTimeout(1200);
    const anonRecords = await bodyText(page);
    check(
      !anonRecords.includes('นายทดสอบ ระบบดี') && !anonRecords.includes('นางสาวทดสอบ สองสาม'),
      'ไม่เห็นชื่อผู้ก่อเหตุและชื่อเหยื่อ'
    );
    check(
      anonRecords.includes('ตัดชื่อผู้ก่อเหตุ') || anonRecords.includes('ข้อมูลสาธารณะ'),
      'มีคำอธิบายว่ากำลังดูข้อมูลที่ตัดชื่อออกแล้ว'
    );

    /* ═══════════ 2. เข้าสู่ระบบ ═══════════ */
    section('2. เข้าสู่ระบบเจ้าหน้าที่');
    await page.getByRole('button', { name: /เข้าสู่ระบบเจ้าหน้าที่/ }).click();
    await page.getByPlaceholder('name@ddc.mail.go.th').fill(fixture.email);
    await page.getByPlaceholder('••••••••').fill(fixture.password);
    await page.getByRole('button', { name: /^เข้าสู่ระบบ$/ }).click();
    await page.waitForTimeout(2500);

    const loggedIn = await bodyText(page);
    check(loggedIn.includes('ผู้ดูแลระบบ'), 'แสดงสิทธิ์ผู้ดูแลระบบ');
    check(loggedIn.includes('คิวตรวจสอบข่าว'), 'แท็บคิวตรวจสอบปรากฏหลังล็อกอิน');
    check(loggedIn.includes('แหล่งข่าว'), 'แท็บแหล่งข่าวปรากฏ');
    check(loggedIn.includes('AI สกัดข่าว'), 'แท็บ AI สกัดข่าวปรากฏ');

    /* ═══════════ 3. คิวตรวจสอบ + อนุมัติ ═══════════ */
    section('3. คิวตรวจสอบข่าว → อนุมัติ');
    await page.getByRole('button', { name: /คิวตรวจสอบข่าว/ }).first().click();
    await page.waitForTimeout(1800);

    const queue = await bodyText(page);
    check(queue.includes('[E2E]'), 'เห็นเคสทดสอบในคิวรอตรวจสอบ');
    check(queue.includes('168') || queue.includes('เป่าแอลกอฮอล์'), 'เห็นรายละเอียดที่สกัดไว้');

    const approveBtn = page.getByRole('button', { name: /อนุมัติเข้าสถิติ/ });
    check(await approveBtn.isVisible(), 'มีปุ่มอนุมัติ');
    await approveBtn.click();
    await page.waitForTimeout(3000);
    check(
      (await bodyText(page)).includes('อนุมัติเข้าฐานสถิติเรียบร้อย'),
      'อนุมัติแล้วขึ้นข้อความยืนยัน'
    );

    // เคสที่อนุมัติต้องไปโผล่ในแดชบอร์ด
    await page.getByRole('button', { name: /ภาพรวมสถิติ/ }).click();
    await page.waitForTimeout(1500);
    check(
      /เกี่ยวข้องกับแอลกอฮอล์/.test(await bodyText(page)),
      'แดชบอร์ดแสดง KPI เกี่ยวข้องกับแอลกอฮอล์'
    );

    /* ═══════════ 4. โหมดยืนยันลิงก์ทีละข่าว ═══════════ */
    section('4. ต้องยืนยันลิงก์ — โหมดทีละข่าว');
    await page.getByRole('button', { name: /คิวตรวจสอบข่าว/ }).first().click();
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: /ต้องยืนยันลิงก์/ }).click();
    await page.waitForTimeout(2000);

    const focus = await bodyText(page);
    check(/ยืนยันลิงก์\s+\d+\s*\/\s*\d+/.test(focus), 'แสดงความคืบหน้าแบบ n / ทั้งหมด');
    check(await page.getByRole('link', { name: /เปิดข่าวต้นทาง/ }).isVisible(), 'มีปุ่มเปิดข่าวต้นทาง');

    const urlBox = page.locator('input[type="url"]');
    check(await urlBox.isVisible(), 'มีช่องรับ URL');
    check(
      await urlBox.evaluate((el) => el === document.activeElement),
      'ช่องกรอกถูกโฟกัสอัตโนมัติ (วางได้เลยไม่ต้องคลิก)'
    );

    const firstTitle = await page.locator('h3').first().innerText();
    check(
      await page.getByRole('button', { name: /^ไม่เกี่ยวข้อง$/ }).isVisible(),
      'มีปุ่มไม่เกี่ยวข้อง'
    );
    check(await page.getByRole('button', { name: /^ข้าม$/ }).isVisible(), 'มีปุ่มข้าม');

    // ข้าม → ต้องเปลี่ยนข่าวแต่ไม่หายจากคิว (ไม่แตะข้อมูล ปลอดภัยเสมอ)
    await page.getByRole('button', { name: /^ข้าม$/ }).click();
    await page.waitForTimeout(600);
    check(
      (await page.locator('h3').first().innerText()) !== firstTitle,
      'กดข้ามแล้วเปลี่ยนไปข่าวถัดไป'
    );

    /**
     * ต่อจากนี้เป็นการกระทำที่แก้ข้อมูลจริง — ต้องยืนยันก่อนว่ากำลังอยู่ที่ lead ทดสอบ
     *
     * เดิมกดเลยโดยไม่ตรวจ ทำให้ครั้งหนึ่งไปกด "ไม่เกี่ยวข้อง" ใส่ข่าวจริงของผู้จัดการออนไลน์
     * แล้ว lead นั้นหลุดออกจากคิวถาวร (ต้องมาตามคืนทีหลัง)
     * fixture ตั้ง published_at เป็นวันพรุ่งนี้ไว้แล้วเพื่อให้เรียงมาก่อนเสมอ
     * แต่ยังต้องตรวจซ้ำตรงนี้ เผื่อการเรียงเปลี่ยนไปด้วยเหตุอื่น
     */
    const onTestLead = async () => (await page.locator('h3').first().innerText()).includes('[E2E]');

    if (!(await onTestLead())) {
      // เลื่อนหา lead ทดสอบ ไม่เกิน 5 ครั้ง
      for (let i = 0; i < 5 && !(await onTestLead()); i++) {
        await page.getByRole('button', { name: /^ข้าม$/ }).click();
        await page.waitForTimeout(400);
      }
    }

    if (!(await onTestLead())) {
      console.log('  – ข้ามการทดสอบที่แก้ข้อมูล (หา lead ทดสอบในคิวไม่เจอ) — ไม่แตะข่าวจริง');
    } else {
      // ไม่เกี่ยวข้อง → ต้องหายจากคิวถาวร
      const before = (await bodyText(page)).match(/ยืนยันลิงก์\s+\d+\s*\/\s*(\d+)/)?.[1];
      await page.getByRole('button', { name: /^ไม่เกี่ยวข้อง$/ }).click();
      await page.waitForTimeout(2500);
      const after = (await bodyText(page)).match(/ยืนยันลิงก์\s+\d+\s*\/\s*(\d+)/)?.[1];
      check(
        Number(after) === Number(before) - 1,
        'กดไม่เกี่ยวข้องแล้วจำนวนในคิวลดลง',
        `${before} → ${after}`
      );
    }

    /* ---- วาง URL แล้วต้องไปข่าวถัดไปทันที ไม่ยืนรอ AI ----
     *
     * นี่คือหัวใจของการลดเวลาคิวจาก 30 นาทีเหลือไม่กี่นาที
     * เดิมโค้ดทำ await การสกัดของ AI ทั้งก้อน (5-15 วินาที) ก่อนจะไปข่าวถัดไปได้
     * เทสต์นี้จึงวัด "เวลาจนกว่าจะรับข่าวถัดไปได้" ไม่ใช่แค่ว่ากดได้หรือไม่
     */
    // ต้องอยู่ที่ lead ทดสอบก่อนวาง URL — ไม่งั้นจะไปเขียนทับ URL ของข่าวจริง
    // รายการทดสอบอาจอยู่ "ข้างหลัง" ตำแหน่งปัจจุบันแล้ว จึงต้องโหลดคิวใหม่ให้กลับไปเริ่มที่ต้นแถว
    if (!(await onTestLead())) {
      await page.getByRole('button', { name: /คิวตรวจสอบข่าว/ }).first().click();
      await page.waitForTimeout(800);
      await page.getByRole('button', { name: /ต้องยืนยันลิงก์/ }).click();
      await page.waitForTimeout(1500);
      for (let i = 0; i < 6 && !(await onTestLead()); i++) {
        await page.getByRole('button', { name: /^ข้าม$/ }).click();
        await page.waitForTimeout(400);
      }
    }
    const titleBeforePaste = await page.locator('h3').first().innerText();
    const countBeforePaste = Number(
      (await bodyText(page)).match(/ยืนยันลิงก์\s+\d+\s*\/\s*(\d+)/)?.[1] ?? 0
    );

    // ไม่เจอ lead ทดสอบ = ข้ามเทสต์นี้ไปเลย ยอมไม่ได้ที่จะเขียนทับ URL ของข่าวจริง
    if (!titleBeforePaste.includes('[E2E]')) {
      console.log('  – ข้ามการทดสอบวาง URL (หา lead ทดสอบในคิวไม่เจอ) — ไม่เขียนทับข่าวจริง');
    } else {
      const pasteStarted = Date.now();
      await page.locator('input[type="url"]').evaluate((el) => (el as HTMLElement).focus());
      // จำลองการวางจากคลิปบอร์ดจริง — โค้ดผูกกับ onPaste ไม่ใช่ onChange
      await page.evaluate(() => {
        const input = document.querySelector('input[type="url"]') as HTMLInputElement;
        const dt = new DataTransfer();
        dt.setData('text', 'https://news.ch7.com/detail/895131');
        input.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
        );
      });

      // รอจนกว่าพาดหัวจะเปลี่ยน หรือคิวหมด — สูงสุด 6 วินาที
      await page
        .waitForFunction(
          (prev) => {
            const h = document.querySelector('h3');
            return !h || h.textContent?.trim() !== prev;
          },
          titleBeforePaste,
          { timeout: 6000 }
        )
        .catch(() => undefined);
      const advancedMs = Date.now() - pasteStarted;

      check(
        advancedMs < 5000,
        'วาง URL แล้วไปข่าวถัดไปโดยไม่ต้องรอ AI',
        `${(advancedMs / 1000).toFixed(1)} วินาที (เดิมต้องรอ 5-15 วินาที)`
      );

      const countAfterPaste = Number(
        (await bodyText(page)).match(/ยืนยันลิงก์\s+\d+\s*\/\s*(\d+)/)?.[1] ?? 0
      );
      check(
        countAfterPaste === countBeforePaste - 1 || countAfterPaste === 0,
        'รายการที่วางลิงก์แล้วออกจากคิว',
        `${countBeforePaste} → ${countAfterPaste}`
      );

      // ต้องมีที่แสดงผลงานเบื้องหลัง ไม่งั้นผู้ใช้ไม่มีทางรู้ว่าข่าวไหนสำเร็จ/ล้มเหลว
      check(/งานเบื้องหลัง/.test(await bodyText(page)), 'มีแถบแสดงสถานะงานที่ทำเบื้องหลัง');
    }

    /* ═══════════ 5. แหล่งข่าว ═══════════ */
    section('5. แหล่งข่าวและการดึงข้อมูล');
    await page.getByRole('button', { name: /แหล่งข่าว/ }).first().click();
    await page.waitForTimeout(2500);
    const sources = await bodyText(page);
    check(sources.includes('RSS สำนักข่าวโดยตรง'), 'เห็นรายการฟีดสำนักข่าว');
    check(sources.includes('มติชน') || sources.includes('ข่าวสด'), 'เห็นชื่อสำนักข่าวที่ตั้งไว้');
    check(sources.includes('ดึงข่าวเดี๋ยวนี้'), 'มีปุ่มสั่งดึงข่าว');
    check(sources.includes('ประวัติการดึงข่าว'), 'เห็นประวัติการดึงข่าว');

    /* ═══════════ 6. ส่งออก CSV ═══════════ */
    section('6. นำเข้า / ส่งออก');
    await page.getByRole('button', { name: /นำเข้า \/ ส่งออก/ }).click();
    await page.waitForTimeout(1200);

    const download = page.waitForEvent('download', { timeout: 15000 });
    await page.getByRole('button', { name: /CSV \(49 คอลัมน์\)/ }).click();
    const file = await download;
    const stream = await file.createReadStream();
    let csv = '';
    for await (const chunk of stream) csv += chunk.toString('utf8');

    const header = csv.replace(/^﻿/, '').split(/\r?\n/)[0];
    const cols = header.split(',');
    check(csv.startsWith('﻿'), 'ไฟล์ CSV มี UTF-8 BOM (เปิดใน Excel ภาษาไทยได้)');
    check(cols.length === 49, 'CSV มี 49 คอลัมน์ตามสเปก', `ได้ ${cols.length}`);
    check(cols[0] === 'id' && cols[48] === 'news_summary', 'ลำดับคอลัมน์ถูกต้อง (id … news_summary)');
    check(!header.includes('alcohol_involved'), 'คอลัมน์ระบบไม่หลุดเข้า CSV');

    /* ═══════════ 7. ออกจากระบบ ═══════════ */
    section('7. ออกจากระบบ');
    await page.getByTitle('ออกจากระบบ').click();
    await page.waitForTimeout(2500);
    const out = await bodyText(page);
    check(!out.includes('คิวตรวจสอบข่าว'), 'แท็บเจ้าหน้าที่หายไปหลังออกจากระบบ');
    check(out.includes('เข้าสู่ระบบเจ้าหน้าที่'), 'กลับมาเห็นปุ่มเข้าสู่ระบบ');
  } finally {
    await browser?.close();
    execFileSync('npx', ['tsx', 'scripts/e2e-fixture.ts', 'teardown'], { encoding: 'utf8' });
    console.log('\nล้างข้อมูลทดสอบแล้ว');
  }

  console.log(`\n${'─'.repeat(56)}`);
  console.log(`สรุป: ผ่าน ${passed} · ไม่ผ่าน ${failed}`);
  if (failures.length) {
    console.log('\nรายการที่ไม่ผ่าน:');
    for (const f of failures) console.log(`  ✕ ${f}`);
    process.exitCode = 1;
  }
  console.log('');
}

void main().catch((e) => {
  console.error('\nการทดสอบล้มเหลว:', e.message);
  process.exit(1);
});
