/**
 * Regression test ของตัวคัดกรอง keyword
 *
 * ตัวคัดกรองนี้เป็นด่านคุมต้นทุน LLM และเป็นตัวตัดสินว่าข่าวไหนจะไม่มีวันถูกเห็น
 * การจูนคำและน้ำหนักจึงต้องมีชุดทดสอบกำกับ ไม่งั้นแก้คำหนึ่งแล้วพังอีกทาง
 *
 * ภาษาไทยไม่เว้นวรรค การจับ substring จึงชนคำอื่นได้ง่าย —
 * ชุด NON_MATCHES คือกรณีที่เคยผิดจริงตอนทดสอบกับฟีดจริง
 *
 *   npm run check:screening
 */
import { DEFAULT_THRESHOLDS, LEAD_THRESHOLDS, screenArticle } from '../api/_lib/screen';

/** ต้องไม่จับคำใดเลย (คำที่มีตัวอักษรพ้องกับคำในพจนานุกรม) */
const NON_MATCHES = [
  'ประชาชนแห่ร่วมงานบุญประเพณี',
  'ชนบทไทยกับการพัฒนาอย่างยั่งยืน',
  'ทีมชาติไทยชนะเวียดนาม 2-0',
  'สินค้าชนิดใหม่วางขายแล้ว',
  'ปัญหาชนชั้นในสังคมเมือง',
  'ชนกลุ่มน้อยชายแดนใต้',
  'บริษัทมหาชนแจ้งผลประกอบการ',
  'ชนวนเหตุความขัดแย้งในพื้นที่',
  'เที่ยวสุราษฎร์ธานี 3 วัน 2 คืน',
  'รีวิวเมาส์ไร้สายรุ่นใหม่ ปุ่มกดนุ่ม',
];

/** ต้องถูกตัดออก (ข่าวนโยบาย / ธุรกิจ / รณรงค์ / การแพทย์) */
const SHOULD_REJECT: [string, 'lead' | 'outlet'][] = [
  ['ครม.เคาะขึ้นภาษีสุราและเบียร์ 5% มีผล 1 ต.ค.', 'lead'],
  ['เปิดตัวคราฟต์เบียร์ไทยแบรนด์ใหม่ ชูอัตลักษณ์ท้องถิ่น', 'lead'],
  ['เทศกาลเบียร์เยอรมัน กลางกรุง 3 วันเต็ม', 'lead'],
  ['สธ.รณรงค์งดเหล้าเข้าพรรษา ตั้งเป้าลดนักดื่มหน้าใหม่', 'lead'],
  ['ราคาเบียร์ปรับขึ้น ร้านค้าโอด ผลประกอบการวูบ', 'lead'],
  ['เจลแอลกอฮอล์ล้างมือ ขาดตลาด', 'lead'],
  ['ตำรวจจับแก๊งคอลเซ็นเตอร์ข้ามชาติ ผู้เสียหายกว่า 200 ราย', 'outlet'],
  ['ยอดผู้เสียชีวิตน้ำท่วมเนปาลพุ่ง 750 ศพ', 'outlet'],
];

/** ต้องผ่าน (เหตุการณ์จริงที่เกี่ยวข้องกับแอลกอฮอล์) */
const SHOULD_PASS: [string, 'lead' | 'outlet'][] = [
  ['ขับรถกระบะเมาชนเด็กชายวัย 13 ปี เสียชีวิต ตรวจพบแอลกอฮอล์ 187', 'lead'],
  ['หนุ่มเมาแล้วขับ ชนไรเดอร์เสียชีวิต', 'lead'],
  ['ชายชาวจีน เมาแล้วขับ ปฏิเสธเป่าแอลกอฮอล์', 'lead'],
  ['รองโฆษก ป.ป.ช.เมาแล้วขับชนไรเดอร์เสียชีวิต ตรวจวัดแอลกอฮอล์สูงถึง 189', 'lead'],
  ['ตั้งวงเหล้าท้ายซอย เกิดปากเสียง ชักมีดแทงเพื่อนบาดเจ็บสาหัส', 'outlet'],
  ['ผัวเมาคลั่งทำร้ายเมียบาดเจ็บ ก่อนถูกจับกุม', 'outlet'],
  ['กระบะเมาซิ่งแหกโค้งพุ่งชน จยย. แม่ลูกเสียชีวิต 1 สาหัส 1 เป่าวัดได้ 185 มก.%', 'outlet'],
  ['หนุ่มเมาอาละวาดกลางลานเบียร์ ชักมีดไล่ฟันคู่อริบาดเจ็บสาหัส 2 ราย', 'outlet'],
];

let failures = 0;

function line(ok: boolean, detail: string) {
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✕'} ${detail}`);
}

console.log('\n=== ต้องไม่จับคำพ้อง (ภาษาไทยไม่เว้นวรรค) ===');
for (const text of NON_MATCHES) {
  const r = screenArticle(text, null);
  line(
    r.alcoholScore === 0 && r.incidentScore === 0,
    `${text.slice(0, 52)}${r.matched.length ? `  ← จับผิดที่: ${r.matched.join(', ')}` : ''}`
  );
}

console.log('\n=== ต้องถูกตัดออก ===');
for (const [text, kind] of SHOULD_REJECT) {
  const r = screenArticle(text, null, kind === 'lead' ? LEAD_THRESHOLDS : DEFAULT_THRESHOLDS);
  line(!r.pass, `[เหล้า ${r.alcoholScore} เหตุ ${r.incidentScore} ลบ ${r.negativeScore}] ${text.slice(0, 52)}`);
}

console.log('\n=== ต้องผ่าน ===');
for (const [text, kind] of SHOULD_PASS) {
  const r = screenArticle(text, null, kind === 'lead' ? LEAD_THRESHOLDS : DEFAULT_THRESHOLDS);
  line(r.pass, `[เหล้า ${r.alcoholScore} เหตุ ${r.incidentScore} ลบ ${r.negativeScore}] ${text.slice(0, 52)}`);
}

const total = NON_MATCHES.length + SHOULD_REJECT.length + SHOULD_PASS.length;
console.log(`\nสรุป: ผ่าน ${total - failures}/${total}\n`);
if (failures > 0) process.exitCode = 1;
