/**
 * คัดกรองข่าวด้วย keyword ก่อนส่งเข้า LLM
 *
 * นี่คือตัวคุมต้นทุนหลักของระบบ: ฟีดทั้งหมดส่งข่าวมาราว 200-300 ข่าวต่อรอบ
 * แต่มีเพียงไม่กี่สิบข่าวที่เกี่ยวกับแอลกอฮอล์ การกรองชั้นนี้ไม่มีค่าใช้จ่ายเลย
 *
 * ข้อควรระวังภาษาไทย: ไม่มีการเว้นวรรคระหว่างคำ จึงต้องจับแบบ substring
 * ห้ามใช้พยางค์สั้นที่พบบ่อย เช่น "ชน" (จะไปโดน ชนบท / ประชาชน / ชนะ / ชนิด)
 * หรือ "ดื่ม" เดี่ยวๆ (โดน "ดื่มน้ำ", "เครื่องดื่มชูกำลัง") → ใช้วลียาวแทน
 */

export interface ScreenResult {
  pass: boolean;
  score: number;
  alcoholScore: number;
  incidentScore: number;
  negativeScore: number;
  matched: string[];
  reason: string;
}

interface Term {
  term: string;
  weight: number;
  /**
   * ใช้เมื่อคำนั้นสั้นและไปชนกับคำอื่นได้ เช่น "ชน" ที่อยู่ใน ประชาชน / ชนบท / ชนะ / ชนิด
   * ภาษาไทยไม่มีตัวคั่นคำ จึงต้องใช้ lookaround กันเอง
   */
  pattern?: RegExp;
}

/** คำบ่งชี้แอลกอฮอล์ */
const ALCOHOL_TERMS: Term[] = [
  // น้ำหนักสูง — เจาะจงเหตุการณ์ที่มีแอลกอฮอล์เกี่ยวข้องแน่นอน
  { term: 'เมาแล้วขับ', weight: 4 },
  { term: 'เมาขับ', weight: 4 },
  { term: 'เมาแล้วชน', weight: 4 },
  { term: 'เป่าแอลกอฮอล์', weight: 4 },
  { term: 'ตรวจวัดแอลกอฮอล์', weight: 4 },
  { term: 'วัดแอลกอฮอล์', weight: 4 },
  { term: 'แอลกอฮอล์ในเลือด', weight: 4 },
  { term: 'ปริมาณแอลกอฮอล์', weight: 4 },
  { term: 'มิลลิกรัมเปอร์เซ็นต์', weight: 4 },
  { term: 'มก.%', weight: 4 },
  { term: 'เมาสุรา', weight: 4 },
  { term: 'มึนเมา', weight: 3 },
  // ภาษาไทยประกอบคำ "เมา" กับกริยาได้ไม่จำกัด (เมาชน / เมาคลั่ง / เมาซิ่ง / ผัวเมา)
  // จะไล่ใส่ทีละคำไม่มีวันครบ จึงจับ "เมา" แบบมีการ์ด
  // กัน "เมาส์" (คอมพิวเตอร์) และ "เมาท์" (นินทา) ซึ่งไม่เกี่ยวกับการดื่ม
  { term: 'เมา (สภาพมึนเมา)', weight: 3, pattern: /เมา(?!ส์|ท์)/ },
  { term: 'เมาอาละวาด', weight: 4 },
  { term: 'อาการมึนเมา', weight: 4 },
  { term: 'ดื่มสุรา', weight: 3 },
  { term: 'ดื่มเหล้า', weight: 3 },
  { term: 'ดื่มเบียร์', weight: 3 },
  { term: 'ตั้งวงเหล้า', weight: 3 },
  { term: 'วงเหล้า', weight: 3 },
  { term: 'ก๊งเหล้า', weight: 3 },

  // น้ำหนักกลาง — บริบทแอลกอฮอล์
  { term: 'สุราขาว', weight: 2 },
  { term: 'เหล้าขาว', weight: 2 },
  { term: 'ลานเบียร์', weight: 2 },
  { term: 'ร้านเหล้า', weight: 2 },
  { term: 'คาราโอเกะ', weight: 2 },
  { term: 'สถานบันเทิง', weight: 2 },
  { term: 'สถานบริการ', weight: 1 },
  { term: 'ผับ', weight: 1 },
  { term: 'งานเลี้ยง', weight: 1 },
  { term: 'สังสรรค์', weight: 2 },
  { term: 'แอลกอฮอล์', weight: 2 },
  { term: 'สุรา', weight: 1 },
  { term: 'เบียร์', weight: 1 },
  { term: 'ไวน์', weight: 1 },
  { term: 'ยาดอง', weight: 2 },
];

/** คำบ่งชี้ว่ามีเหตุรุนแรง/อุบัติเหตุจริง */
const INCIDENT_TERMS: Term[] = [
  { term: 'เสียชีวิต', weight: 3 },
  { term: 'ดับคาที่', weight: 3 },
  { term: 'ชนดับ', weight: 3 },
  { term: 'บาดเจ็บสาหัส', weight: 3 },
  { term: 'สาหัส', weight: 2 },
  { term: 'ถูกแทง', weight: 3 },
  { term: 'ถูกยิง', weight: 3 },
  { term: 'ใช้มีดแทง', weight: 3 },
  { term: 'ทำร้ายร่างกาย', weight: 3 },
  { term: 'ทะเลาะวิวาท', weight: 3 },
  { term: 'ยกพวกตี', weight: 3 },
  { term: 'ข่มขืน', weight: 3 },
  { term: 'ล่วงละเมิดทางเพศ', weight: 3 },
  { term: 'อนาจาร', weight: 2 },
  { term: 'ฆ่าตัวตาย', weight: 3 },
  { term: 'ผูกคอ', weight: 2 },

  // "ชน" เดี่ยวๆ อันตราย ต้องกัน ประชาชน/ชนบท/ชนะ/ชนิด/ชนชั้น/ชนกลุ่มน้อย/ชนวนเหตุ
  {
    term: 'ชน (ยานพาหนะ)',
    weight: 2,
    pattern: /(?<!ประชา|มหา|ฝูง)ชน(?!บท|ะ|ิด|ชั้น|กลุ่ม|เผ่า|วน|พื้นเมือง)/,
  },
  { term: 'แล้วหนี', weight: 2 },
  { term: 'พุ่งชน', weight: 2 },
  { term: 'ขับชน', weight: 2 },
  { term: 'ชนแล้วหนี', weight: 3 },
  { term: 'เสยชน', weight: 2 },
  { term: 'ชนท้าย', weight: 2 },
  { term: 'ชนประสานงา', weight: 3 },
  { term: 'รถคว่ำ', weight: 2 },
  { term: 'เสียหลัก', weight: 2 },
  { term: 'แหกโค้ง', weight: 2 },
  { term: 'อุบัติเหตุ', weight: 2 },
  { term: 'บาดเจ็บ', weight: 1 },
  { term: 'ก่อเหตุ', weight: 2 },
  { term: 'คลุ้มคลั่ง', weight: 2 },
  { term: 'อาละวาด', weight: 2 },
  { term: 'จับกุม', weight: 1 },
  { term: 'ผู้ต้องหา', weight: 1 },
];

/**
 * คำที่บ่งว่าเป็นข่าวนโยบาย/ธุรกิจ/การตลาด ไม่ใช่เหตุการณ์
 * (ถ้าไม่กรอง ข่าว "ภาษีสุรา" และ "คราฟต์เบียร์" จะท่วมคิว)
 */
const NEGATIVE_TERMS: Term[] = [
  { term: 'ภาษีสุรา', weight: 6 },
  { term: 'ภาษีเบียร์', weight: 6 },
  { term: 'ภาษีความหวาน', weight: 4 },
  { term: 'สรรพสามิต', weight: 4 },
  { term: 'โรงงานสุรา', weight: 5 },
  { term: 'สุราชุมชน', weight: 5 },
  { term: 'ปลดล็อกสุรา', weight: 6 },
  { term: 'สุราก้าวหน้า', weight: 6 },
  { term: 'คราฟต์เบียร์', weight: 6 },
  { term: 'ราคาเบียร์', weight: 5 },
  { term: 'เทศกาลเบียร์', weight: 5 },
  { term: 'โฆษณาเครื่องดื่มแอลกอฮอล์', weight: 5 },
  { term: 'พ.ร.บ.ควบคุมเครื่องดื่มแอลกอฮอล์', weight: 4 },
  { term: 'ขายหุ้น', weight: 4 },
  { term: 'ผลประกอบการ', weight: 4 },
  { term: 'เปิดตัวสินค้า', weight: 4 },
  { term: 'แอลกอฮอล์ล้างมือ', weight: 6 },
  { term: 'เจลแอลกอฮอล์', weight: 6 },
  { term: 'แอลกอฮอล์ 70', weight: 6 },
];

/**
 * ข้อความที่ "มีคำแอลกอฮอล์เป็นส่วนประกอบ" แต่ไม่เกี่ยวกับเครื่องดื่ม
 * ภาษาไทยไม่เว้นวรรค การจับแบบ substring จึงชนคำเหล่านี้เต็มๆ
 * เช่น "สุราษฎร์ธานี" มีคำว่า "สุรา" อยู่ข้างใน — พบจริงตอนทดสอบกับฟีดข่าวสด
 * วิธีแก้: ลบคำเหล่านี้ออกจากข้อความก่อนให้คะแนน
 */
const FALSE_POSITIVE_MASKS = [
  'สุราษฎร์ธานี',
  'สุราษฎร์',
  'จ.สุราษฎร์',
  'เบียร์สิงห์',   // ชื่อแบรนด์ในข่าวธุรกิจ/กีฬา
  'ลีโอ เบียร์',
];

function maskFalsePositives(text: string): string {
  let out = text;
  for (const mask of FALSE_POSITIVE_MASKS) {
    out = out.split(mask).join(' ');
  }
  return out;
}

export interface ScreenThresholds {
  minAlcohol: number;
  minIncident: number;
  minTotal: number;
}

export const DEFAULT_THRESHOLDS: ScreenThresholds = {
  minAlcohol: 3,
  minIncident: 3,
  minTotal: 6,
};

/**
 * เกณฑ์สำหรับรายการจาก Google News
 *
 * ที่นี่ "คำค้นคือตัวกรอง" อยู่แล้ว — ฟีดถูกดึงมาด้วยคำค้นอย่าง "เมาแล้วขับ ชน"
 * ผลลัพธ์เกือบทั้งหมดจึงตรงเป้า การไปตั้งเกณฑ์คะแนนสูงซ้ำอีกชั้นกลับตัดของจริงทิ้ง
 * (ทดสอบแล้วพบว่าตัดพาดหัวอย่าง "ขับรถกระบะเมาชนเด็กชายวัย 13 ปี เสียชีวิต" ออกไป)
 *
 * หน้าที่ของด่านนี้จึงเหลือแค่กันข่าวนโยบาย/ภาษี/การตลาดที่หลุดมา
 * ส่วนการคุมปริมาณคิวใช้การกันข่าวซ้ำและโควตาต่อรอบแทน (ดู ingest.ts)
 */
export const LEAD_THRESHOLDS: ScreenThresholds = {
  minAlcohol: 4,
  minIncident: 0,
  minTotal: 4,
};

/** คำที่พบในพาดหัวมีน้ำหนักมากกว่า เพราะพาดหัวสรุปแก่นของข่าว */
const TITLE_MULTIPLIER = 1.5;

/**
 * ให้คะแนนคำแต่ละคำครั้งเดียว โดยดูว่าพบในพาดหัวหรือในเนื้อข่าว
 * (ไม่ได้นับจำนวนครั้งที่ปรากฏ เพราะข่าวที่พูดถึงคำเดิมซ้ำๆ ไม่ได้เกี่ยวข้องมากกว่า)
 */
function scoreTerms(
  title: string,
  body: string,
  terms: Term[]
): { score: number; matched: string[] } {
  let score = 0;
  const matched: string[] = [];
  for (const { term, weight, pattern } of terms) {
    const hit = (text: string) => (pattern ? pattern.test(text) : text.includes(term));
    if (hit(title)) {
      score += Math.round(weight * TITLE_MULTIPLIER);
      matched.push(term);
    } else if (hit(body)) {
      score += weight;
      matched.push(term);
    }
  }
  return { score, matched };
}

/** ให้คะแนนข่าว 1 ชิ้น */
export function screenArticle(
  title: string,
  body: string | null,
  thresholds: ScreenThresholds = DEFAULT_THRESHOLDS
): ScreenResult {
  const maskedTitle = maskFalsePositives(title);
  const maskedBody = maskFalsePositives(body ?? '');

  const alcohol = scoreTerms(maskedTitle, maskedBody, ALCOHOL_TERMS);
  const incident = scoreTerms(maskedTitle, maskedBody, INCIDENT_TERMS);
  const negative = scoreTerms(maskedTitle, maskedBody, NEGATIVE_TERMS);

  const total = alcohol.score + incident.score - negative.score;

  /**
   * ทางลัด: พาดหัวที่มีตัวบ่งชี้แอลกอฮอล์ชัดหลายตัว (เช่น "เมาแล้วขับ" + "เป่าแอลกอฮอล์"
   * + "ตรวจวัดปริมาณ") เป็นข่าวในขอบเขตแน่ๆ แม้คำบอกเหตุการณ์จะไม่ตรงกับพจนานุกรมของเรา
   * — ปล่อยผ่านไปให้ AI ตัดสินดีกว่าทิ้งไปเงียบๆ
   */
  const strongAlcoholSignal = alcohol.score >= 12 && negative.score === 0;

  const pass =
    (strongAlcoholSignal && total >= thresholds.minTotal) ||
    (alcohol.score >= thresholds.minAlcohol &&
      incident.score >= thresholds.minIncident &&
      total >= thresholds.minTotal);

  const parts: string[] = [
    `แอลกอฮอล์ ${alcohol.score}`,
    `เหตุการณ์ ${incident.score}`,
  ];
  if (negative.score > 0) parts.push(`หักคำลบ ${negative.score} (${negative.matched.join(', ')})`);

  let reason: string;
  if (pass && strongAlcoholSignal && incident.score < thresholds.minIncident) {
    reason = `ผ่าน (สัญญาณแอลกอฮอล์ชัดมาก): ${parts.join(' · ')}`;
  } else if (pass) {
    reason = `ผ่าน: ${parts.join(' · ')}`;
  } else if (alcohol.score < thresholds.minAlcohol) {
    reason = `ไม่ผ่าน: ไม่พบสัญญาณแอลกอฮอล์เพียงพอ (${parts.join(' · ')})`;
  } else if (incident.score < thresholds.minIncident) {
    reason = `ไม่ผ่าน: ไม่พบสัญญาณเหตุรุนแรง/อุบัติเหตุเพียงพอ (${parts.join(' · ')})`;
  } else {
    reason = `ไม่ผ่าน: คะแนนรวม ${total} ต่ำกว่าเกณฑ์ ${thresholds.minTotal} (${parts.join(' · ')})`;
  }

  return {
    pass,
    score: total,
    alcoholScore: alcohol.score,
    incidentScore: incident.score,
    negativeScore: negative.score,
    matched: [...alcohol.matched, ...incident.matched],
    reason,
  };
}
