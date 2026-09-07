/**
 * ยืนยันว่า GEMINI_API_KEY และชื่อโมเดลที่ตั้งไว้ใช้งานได้จริง
 * และตรวจว่าตัวสกัดคืนค่าตรงกับ fixture ที่รู้คำตอบอยู่แล้ว
 *
 * ต้องรันให้ผ่านก่อน deploy — โค้ดเดิมอ้างอิงชื่อโมเดลที่ไม่เคยถูกตรวจสอบ
 *
 *   npm run verify:gemini
 */
import './_env';
import { screenAndExtract } from '../api/_lib/gemini';
import { GEMINI_MODEL } from '../api/_lib/env';
import { normalizeIncident } from '../src/lib/normalize';
import { SAMPLE_PRESETS } from '../src/data/sampleNews';

/**
 * โหมด --probe: ยิงคำถามสั้นๆ ไปทุกโมเดลที่คีย์นี้มองเห็น เพื่อหาว่ารุ่นไหน "เรียกได้จริง"
 *
 * จำเป็นเพราะ models.list ไม่ใช่คำตอบที่เชื่อถือได้ — บางรุ่นอยู่ในลิสต์
 * แต่เรียกจริงแล้วได้ 404 "no longer available to new users"
 * การทดสอบด้วย generateContent จริงเท่านั้นที่บอกได้
 */
async function probeModels(): Promise<void> {
  const key = process.env.GEMINI_API_KEY!;
  const base = 'https://generativelanguage.googleapis.com/v1beta';

  const listRes = await fetch(`${base}/models?pageSize=200`, {
    headers: { 'x-goog-api-key': key },
  });
  const listJson: any = await listRes.json();

  if (listJson.error) {
    console.error(`\nเรียก models.list ไม่ได้: ${listJson.error.status} — ${listJson.error.message}\n`);
    process.exit(1);
  }

  const candidates: string[] = (listJson.models ?? [])
    .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m: any) => m.name.replace('models/', ''))
    .filter((n: string) => /flash|pro|gemma/.test(n) && !/tts|image|audio|embedding|banana/.test(n));

  console.log(`\nคีย์นี้มองเห็น ${candidates.length} โมเดลที่รองรับ generateContent — ทดสอบเรียกจริงทีละตัว\n`);

  const usable: string[] = [];
  for (const model of candidates) {
    try {
      const res = await fetch(`${base}/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'ตอบว่า OK' }] }],
          generationConfig: { maxOutputTokens: 10 },
        }),
      });
      const json: any = await res.json();
      if (json.error) {
        console.log(`  ✕ ${model.padEnd(34)} ${json.error.code} ${json.error.status} — ${String(json.error.message).slice(0, 52)}`);
      } else {
        usable.push(model);
        console.log(`  ✓ ${model.padEnd(34)} ใช้ได้`);
      }
    } catch (err: any) {
      console.log(`  ? ${model.padEnd(34)} ${String(err?.message).slice(0, 50)}`);
    }
  }

  console.log(`\nสรุป: ใช้ได้ ${usable.length} จาก ${candidates.length} รุ่น`);
  if (usable.length) {
    // ระบบนี้พึ่ง responseSchema (structured output) — Gemma เป็นโมเดลเปิดที่ไม่รองรับ
    // และ lite/preview เหมาะกับงานง่ายกว่าการสกัด 49 ฟิลด์จากข่าวไทย จึงเลือกรุ่น Flash ตัวเต็มก่อน
    const preferred =
      usable.find((m) => /^gemini-[\d.]+-flash$/.test(m)) ??
      usable.find((m) => m.startsWith('gemini') && !/lite|preview/.test(m)) ??
      usable.find((m) => m.startsWith('gemini')) ??
      usable[0];
    console.log(`แนะนำสำหรับงานสกัด 49 ฟิลด์ (ต้องใช้ structured output):`);
    console.log(`  GEMINI_MODEL="${preferred}"\n`);
    const others = usable.filter((m) => m !== preferred && m.startsWith('gemini'));
    if (others.length) console.log(`  รุ่นอื่นที่ใช้ได้: ${others.join(', ')}\n`);
  } else {
    console.log(
      `\nไม่มีรุ่นไหนเรียกได้เลย — ถ้าทุกรุ่นขึ้น PERMISSION_DENIED แปลว่าบัญชี/โปรเจกต์ถูกบล็อก` +
        `\nไม่ใช่เรื่องชื่อโมเดล ดูวิธีแก้ในหัวข้อ "Gemini API" ของ README\n`
    );
    process.exitCode = 1;
  }
}

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error('ไม่ได้ตั้งค่า GEMINI_API_KEY — ใส่ไว้ใน .env.local ก่อน');
    process.exit(1);
  }

  if (process.argv.includes('--probe')) {
    await probeModels();
    return;
  }

  console.log(`\nโมเดลที่ใช้: ${GEMINI_MODEL()}\n`);

  let failures = 0;
  let totalIn = 0;
  let totalOut = 0;

  for (const preset of SAMPLE_PRESETS) {
    console.log(`── ${preset.label}`);
    try {
      const result = await screenAndExtract(preset.text, {
        url: preset.url,
        newsAgency: preset.agency,
      });

      console.log(
        `   คัดกรอง: แอลกอฮอล์=${result.screening.is_alcohol_related} · เหตุจริง=${result.screening.is_violence_or_accident} · มั่นใจ=${result.screening.confidence}`
      );
      if (result.usage) {
        totalIn += result.usage.input;
        totalOut += result.usage.output;
        console.log(`   token: เข้า ${result.usage.input} · ออก ${result.usage.output}`);
      }
      console.log(`   เหตุผล: ${result.screening.reason}`);

      if (!result.incident) {
        console.log('   → ไม่ได้สกัดข้อมูล (ถูกคัดกรองออก)\n');
        continue;
      }

      const { incident, report } = normalizeIncident(result.incident, {
        url: preset.url,
        newsAgency: preset.agency,
      });

      for (const [field, expected] of Object.entries(preset.expect)) {
        const actual = (incident as any)[field];
        const ok = actual === expected;
        if (!ok) failures++;
        console.log(
          `   ${ok ? '✓' : '✕'} ${field}: ได้ ${JSON.stringify(actual)}${ok ? '' : ` (คาดว่า ${JSON.stringify(expected)})`}`
        );
      }

      if (report.adjusted.length) console.log(`   ดัดค่า: ${report.adjusted.join(', ')}`);
      if (report.unmapped.length) {
        console.log(
          `   ดัดไม่ลง: ${report.unmapped.map((u) => `${u.field}="${u.original}"`).join(', ')}`
        );
      }
      console.log('');
    } catch (err: any) {
      failures++;
      console.error(`   ✕ ล้มเหลว: ${err?.message ?? err}\n`);
    }
  }

  // ประเมินต้นทุนจริงต่อเดือน จาก token ที่วัดได้ ไม่ใช่การเดา
  if (totalIn > 0) {
    const n = SAMPLE_PRESETS.length;
    const avgIn = Math.round(totalIn / n);
    const avgOut = Math.round(totalOut / n);

    // ราคาต่อ 1 ล้าน token (USD) เท่าที่ยืนยันจากหน้าราคาทางการ
    // รุ่นที่ไม่อยู่ในตารางนี้จะไม่ประเมินราคาให้ เพื่อไม่ให้แสดงตัวเลขที่ไม่ตรงรุ่น
    const PRICES: Record<string, { in: number; out: number }> = {
      'gemini-2.5-flash': { in: 0.3, out: 2.5 },
      'gemini-3.7-flash': { in: 0.75, out: 3.75 },
    };
    const model = GEMINI_MODEL();
    const price = PRICES[model];

    console.log(`เฉลี่ยต่อข่าว: เข้า ${avgIn} token · ออก ${avgOut} token`);

    if (price) {
      console.log(`ประเมินค่าใช้จ่ายแบบเสียเงินของ ${model} (ถ้าเกินโควตาฟรี):`);
      for (const perDay of [20, 50, 100]) {
        const usd =
          ((avgIn * perDay * 30) / 1_000_000) * price.in +
          ((avgOut * perDay * 30) / 1_000_000) * price.out;
        console.log(`  ${String(perDay).padStart(3)} ข่าว/วัน → ~$${usd.toFixed(2)}/เดือน`);
      }
    } else {
      // แสดงเป็นช่วง โดยอ้างราคารุ่นที่ยืนยันได้ ทั้งถูกสุดและแพงสุด
      console.log(`ยังไม่มีราคาทางการของ ${model} ในตาราง — ประเมินเป็นช่วงจากรุ่นที่ยืนยันราคาได้:`);
      const lo = PRICES['gemini-2.5-flash'];
      const hi = PRICES['gemini-3.7-flash'];
      for (const perDay of [20, 50, 100]) {
        const calc = (p: { in: number; out: number }) =>
          ((avgIn * perDay * 30) / 1_000_000) * p.in + ((avgOut * perDay * 30) / 1_000_000) * p.out;
        console.log(
          `  ${String(perDay).padStart(3)} ข่าว/วัน → ~$${calc(lo).toFixed(2)} ถึง $${calc(hi).toFixed(2)}/เดือน`
        );
      }
      console.log('  (ตรวจราคาจริงของรุ่นนี้ที่ ai.google.dev/gemini-api/docs/pricing)');
    }
    console.log('');
  }

  if (failures > 0) {
    console.log(`สรุป: มีข้อไม่ตรง ${failures} รายการ — ตรวจ prompt/normalizer หรือเปลี่ยนโมเดล\n`);
    process.exitCode = 1;
  } else {
    console.log('สรุป: ผ่านทั้งหมด — โมเดลและ pipeline พร้อมใช้งาน\n');
  }
}

void main();
