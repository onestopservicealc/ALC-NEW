/**
 * เรียก Gemini เพื่อคัดกรอง + สกัด 49 ฟิลด์ ใน request เดียว
 *
 * รวมสองงานไว้ด้วยกันเพราะ:
 *  - ลดเวลาและค่าใช้จ่ายลงครึ่งหนึ่งเทียบกับเรียกสองรอบ
 *  - โมเดลตัดสินความเกี่ยวข้องได้แม่นกว่าเมื่อถูกบังคับให้สกัดรายละเอียดไปด้วย
 */
import { GoogleGenAI, Type } from '@google/genai';
import { GEMINI_MODEL, GEMINI_MODELS, intEnv, requireEnv } from './env.js';

let client: GoogleGenAI | null = null;

function ai(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({ apiKey: requireEnv('GEMINI_API_KEY') });
  }
  return client;
}

const str = (description: string) => ({ type: Type.STRING, description, nullable: true });
const int = (description: string) => ({ type: Type.INTEGER, description, nullable: true });

/** 48 ฟิลด์ (ไม่รวม id ซึ่งฐานข้อมูลออกให้) ตรงตาม types/dataDictionary.ts */
const INCIDENT_PROPERTIES = {
  news_type: str('ประเภทข่าว'),
  url: str('ลิงก์ข่าว'),
  news_agency: str('สำนักข่าว'),
  news_title: str('พาดหัวข่าว'),
  incident_date: str('วันที่เกิดเหตุ YYYY-MM-DD'),
  incident_time: str('เวลาเกิดเหตุ HH:MM'),
  province: str('จังหวัด'),
  district: str('อำเภอ/เขต'),
  sub_district: str('ตำบล/แขวง'),
  incident_location: str('ประเภทสถานที่เกิดเหตุ'),
  location_other: str('สถานที่เกิดเหตุ: อื่นๆ ระบุ'),
  perpetrator_name: str('ชื่อ-สกุลผู้ก่อเหตุ'),
  perpetrator_gender: str('เพศผู้ก่อเหตุ'),
  perpetrator_age: int('อายุผู้ก่อเหตุ เป็นปี (null ถ้าไม่ทราบ ห้ามใส่ 0)'),
  perpetrator_occupation: str('ผู้ก่อเหตุประกอบอาชีพหรือไม่ ใช่/ไม่ใช่'),
  perpetrator_occupation_detail: str('ระบุอาชีพผู้ก่อเหตุ'),
  perpetrator_weapon: str('อาวุธหรือยานพาหนะที่ใช้ก่อเหตุ'),
  alcohol_test_method: str('วิธีตรวจแอลกอฮอล์'),
  alcohol_level: int('ระดับแอลกอฮอล์ที่ตรวจได้ หน่วย mg% (null ถ้าไม่มีผลตรวจ)'),
  drinking_location: str('สถานที่ดื่มก่อนเกิดเหตุ'),
  beverage_type: str('ประเภทเครื่องดื่มแอลกอฮอล์'),
  test_duration: int('ระยะเวลาจากเกิดเหตุถึงเวลาตรวจ หน่วยนาที'),
  recidivism: str('กระทำความผิดซ้ำ ใช่/ไม่ใช่'),
  drug_use: str('มีการใช้ยาเสพติด ใช่/ไม่ใช่'),
  drug_use_detail: str('ระบุชนิดยาเสพติด (หลายชนิดใช้ ; คั่น)'),
  total_affected: int('จำนวนผู้ได้รับผลกระทบทั้งหมด'),
  total_death: int('จำนวนผู้เสียชีวิต'),
  total_injury: int('จำนวนผู้บาดเจ็บ'),
  public_property_damage: str('ทรัพย์สินสาธารณะที่เสียหาย (หลายรายการใช้ ; คั่น)'),
  victim_1_name: str('เหยื่อ 1: ชื่อ-สกุล'),
  victim_1_gender: str('เหยื่อ 1: เพศ'),
  victim_1_age: int('เหยื่อ 1: อายุ (null ถ้าไม่ทราบ)'),
  victim_1_occupation: str('เหยื่อ 1: อาชีพ'),
  victim_1_injury_type: str('เหยื่อ 1: ลักษณะบาดเจ็บ'),
  victim_1_relation_to_perpetrator: str('เหยื่อ 1: มีความสัมพันธ์กับผู้ก่อเหตุ ใช่/ไม่ใช่'),
  victim_2_name: str('เหยื่อ 2: ชื่อ-สกุล'),
  victim_2_gender: str('เหยื่อ 2: เพศ'),
  victim_2_age: int('เหยื่อ 2: อายุ'),
  victim_2_occupation: str('เหยื่อ 2: อาชีพ'),
  victim_2_injury_type: str('เหยื่อ 2: ลักษณะบาดเจ็บ'),
  victim_2_relation_to_perpetrator: str('เหยื่อ 2: มีความสัมพันธ์กับผู้ก่อเหตุ'),
  victim_3_name: str('เหยื่อ 3: ชื่อ-สกุล'),
  victim_3_gender: str('เหยื่อ 3: เพศ'),
  victim_3_age: int('เหยื่อ 3: อายุ'),
  victim_3_occupation: str('เหยื่อ 3: อาชีพ'),
  victim_3_injury_type: str('เหยื่อ 3: ลักษณะบาดเจ็บ'),
  victim_3_relation_to_perpetrator: str('เหยื่อ 3: มีความสัมพันธ์กับผู้ก่อเหตุ'),
  news_summary: str('สรุปพฤติการณ์ของเหตุการณ์โดยย่อ 2-4 ประโยค'),
} as const;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    screening: {
      type: Type.OBJECT,
      description: 'ผลการคัดกรองว่าข่าวนี้เข้าขอบเขตของระบบหรือไม่',
      properties: {
        is_alcohol_related: {
          type: Type.BOOLEAN,
          description: 'เครื่องดื่มแอลกอฮอล์มีส่วนเกี่ยวข้องกับการเกิดเหตุนี้หรือไม่',
        },
        alcohol_role: {
          type: Type.STRING,
          description: 'บทบาทของแอลกอฮอล์: ผู้ก่อเหตุดื่ม | เหยื่อดื่ม | ทั้งสองฝ่ายดื่ม | ไม่ชัดเจน',
          nullable: true,
        },
        is_violence_or_accident: {
          type: Type.BOOLEAN,
          description: 'เป็นเหตุความรุนแรงหรืออุบัติเหตุที่เกิดขึ้นจริงหรือไม่ (ไม่ใช่ข่าวนโยบาย/ธุรกิจ/สถิติ)',
        },
        confidence: {
          type: Type.NUMBER,
          description: 'ความมั่นใจ 0.0 ถึง 1.0',
        },
        reason: {
          type: Type.STRING,
          description: 'เหตุผลสั้นๆ ภาษาไทย อ้างข้อความในข่าวที่ใช้ตัดสิน',
        },
      },
      required: ['is_alcohol_related', 'is_violence_or_accident', 'confidence', 'reason'],
    },
    incident: {
      type: Type.OBJECT,
      description: 'ข้อมูล 49 ฟิลด์ — ส่ง null ทั้งก้อนถ้า is_alcohol_related เป็น false',
      nullable: true,
      properties: INCIDENT_PROPERTIES,
    },
  },
  required: ['screening'],
} as const;

const VOCAB_RULES = `ข้อกำหนดค่าที่กำหนดไว้ (Controlled Vocabulary) — ต้องเลือกจากรายการนี้เท่านั้น:
1. news_type: "อุบัติเหตุเมาขับ", "ทำร้ายร่างกายผู้อื่น", "ทำร้ายตนเอง", "ข่มขืน ล่วงละเมิด", "ทำลายทรัพย์สิน"
2. incident_location: "ถนนสายหลัก/ทางหลวง", "ถนนสายรอง/ทางหลวงชนบท", "ถนนในหมู่บ้าน", "บ้าน/ที่อยู่อาศัย", "ที่สาธารณะ", "โรงแรม", "สถานบริการ/สถานบันเทิง", "สถานที่จัดงาน/งานเทศกาล", "อื่นๆ"
3. perpetrator_gender / victim_*_gender: "ชาย", "หญิง", "LGBTQ+"
4. perpetrator_occupation / recidivism / drug_use / victim_*_relation_to_perpetrator: "ใช่", "ไม่ใช่"
5. perpetrator_weapon: "รถจักรยานยนต์", "รถยนต์", "จักรยาน", "รถอื่นๆ", "มีด", "ปืน", "แท่งเหล็ก/ไม้", "อื่นๆ"
6. alcohol_test_method: "เป่าแอลกอฮอล์", "เจาะเลือดตรวจแอลกอฮอล์", "สังเกตุอาการ"
7. beverage_type: "สุราขาว/สุราสี", "เบียร์", "ไวน์", "อื่นๆ"
8. victim_*_injury_type: "บาดเจ็บเล็กน้อย", "บาดเจ็บสาหัส", "เสียชีวิต"

กฎสำคัญ:
- ถ้าไม่ทราบอายุ ให้ส่ง null ห้ามใส่ 0 เด็ดขาด
- ถ้า alcohol_test_method เป็น "สังเกตุอาการ" ให้ alcohol_level เป็น null เสมอ
- ห้ามเดาข้อมูลที่ข่าวไม่ได้ระบุ ไม่ทราบให้ส่ง null หรือสตริงว่าง
- ถ้ามีหลายค่าใน drug_use_detail, public_property_damage ให้ใช้ ; คั่น
- incident_date รูปแบบ YYYY-MM-DD (แปลง พ.ศ. เป็น ค.ศ. ก่อน) · incident_time รูปแบบ HH:MM
- news_summary ต้องมีค่าเสมอ สรุปพฤติการณ์ 2-4 ประโยค`;

const SCREENING_RULES = `เกณฑ์การคัดกรอง (screening):
- is_alcohol_related = true ก็ต่อเมื่อข่าวระบุว่ามีการดื่มเครื่องดื่มแอลกอฮอล์ หรือมีผลตรวจแอลกอฮอล์
  หรือมีอาการมึนเมา ที่เกี่ยวข้องกับการเกิดเหตุ (ฝ่ายผู้ก่อเหตุหรือฝ่ายเหยื่อก็ได้)
- is_alcohol_related = false เมื่อข่าวเพียงกล่าวถึงสุรา/เบียร์ในเชิงนโยบาย ภาษี ธุรกิจ การตลาด
  สถิติภาพรวม การรณรงค์ หรือแอลกอฮอล์ทางการแพทย์ (เจลล้างมือ)
- is_violence_or_accident = true เมื่อเป็นเหตุการณ์จริงที่เกิดขึ้นแล้ว มีผู้เสียหายหรือความเสียหาย
  ไม่ใช่บทวิเคราะห์ ข่าวสถิติรวม หรือประกาศมาตรการ`;

export interface ScreeningOutput {
  is_alcohol_related: boolean;
  alcohol_role: string | null;
  is_violence_or_accident: boolean;
  confidence: number;
  reason: string;
}

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

export interface GeminiExtraction {
  screening: ScreeningOutput;
  incident: Record<string, unknown> | null;
  model: string;
  /** จำนวน token ที่ใช้จริง — ใช้ประเมินต้นทุนและโควตา (null ถ้า API ไม่ส่งมา) */
  usage: TokenUsage | null;
}

export interface ExtractContext {
  url?: string;
  newsAgency?: string;
  newsTitle?: string;
  publishedAt?: string | null;
}

function buildPrompt(newsText: string, ctx: ExtractContext): string {
  const known: string[] = [];
  if (ctx.newsTitle) known.push(`- พาดหัวข่าวจริง: ${ctx.newsTitle}`);
  if (ctx.newsAgency) known.push(`- สำนักข่าว: ${ctx.newsAgency}`);
  if (ctx.url) known.push(`- ลิงก์ข่าว: ${ctx.url}`);
  if (ctx.publishedAt) known.push(`- วันที่เผยแพร่: ${ctx.publishedAt} (ใช้อ้างอิงเมื่อข่าวระบุแค่วันและเดือน)`);

  return `คุณคือผู้เชี่ยวชาญการสกัดข้อมูลข่าวความรุนแรงและอุบัติเหตุที่เกี่ยวข้องกับเครื่องดื่มแอลกอฮอล์ในสังคมไทย
เพื่อลงตารางโครงสร้างข้อมูล (Data Dictionary) 49 ฟิลด์

ทำสองอย่างตามลำดับ:
ขั้นที่ 1 — คัดกรองว่าข่าวนี้อยู่ในขอบเขตของระบบหรือไม่
ขั้นที่ 2 — ถ้าอยู่ในขอบเขต (is_alcohol_related = true) ให้สกัดข้อมูลลง incident ให้ครบทุกฟิลด์
           ถ้าไม่อยู่ในขอบเขต ให้ส่ง incident เป็น null

${SCREENING_RULES}

${VOCAB_RULES}
${known.length ? `\nข้อมูลที่ทราบแน่นอนอยู่แล้ว (ให้ใช้ค่านี้ ห้ามเดาใหม่):\n${known.join('\n')}` : ''}

เนื้อหาข่าวที่ต้องวิเคราะห์:
"""
${newsText.slice(0, 30000)}
"""`;
}

/**
 * โควตารายวันหมด — ต่างจาก error ชั่วคราวตรงที่ "รอแล้วไม่หาย" ต้องรอถึงวันถัดไป
 * การลองซ้ำจึงเสียเวลาเปล่า และทำให้ผู้ใช้เข้าใจผิดว่าระบบมีปัญหาอื่น
 */
export class DailyQuotaExhaustedError extends Error {
  constructor(public readonly model: string, public readonly limit: string) {
    super(
      `โควตารายวันของโมเดล ${model} หมดแล้ว (จำกัด ${limit} ครั้ง/วัน) — ` +
        `รอวันถัดไป เปลี่ยนโมเดลด้วย GEMINI_MODEL หรือเปิด billing`
    );
    this.name = 'DailyQuotaExhaustedError';
  }
}

function asDailyQuotaError(err: unknown): DailyQuotaExhaustedError | null {
  const raw = String((err as any)?.message ?? err);
  if (!/RESOURCE_EXHAUSTED|429/.test(raw)) return null;
  if (!/PerDay|_requests_per_day|free_tier_requests/i.test(raw)) return null;
  const limit = raw.match(/"quotaValue":\s*"(\d+)"/)?.[1] ?? raw.match(/limit:\s*(\d+)/)?.[1] ?? '?';
  const model = raw.match(/model:\s*([\w.-]+)/)?.[1] ?? GEMINI_MODEL();
  return new DailyQuotaExhaustedError(model, limit);
}

/** error ที่หายเองได้ ควรลองใหม่แทนที่จะทิ้งข่าวนั้นไป */
function isTransient(err: unknown): boolean {
  const msg = String((err as any)?.message ?? err);
  return /50[0234]|UNAVAILABLE|high demand|overloaded|ETIMEDOUT|ECONNRESET/i.test(msg);
}

const RETRY_DELAYS_MS = [2_000, 6_000, 15_000];

/**
 * เพดานเวลาต่อการเรียก 1 ครั้ง
 *
 * วัดจริงพบว่ารุ่นที่คนใช้เยอะ (gemini-3.7-flash) รอคิวฝั่ง Google นานถึง 223 วินาที
 * สำหรับ output แค่ 111 token — เดิมไม่มี timeout ผู้ใช้จึงเห็นหน้าจอค้างเฉยๆ
 * ตัดที่ 45 วินาทีแล้วสลับไปรุ่นถัดไปดีกว่ารอ
 */
const CALL_TIMEOUT_MS = intEnv('GEMINI_TIMEOUT_MS', 45_000);

class GeminiTimeoutError extends Error {
  constructor(model: string, ms: number) {
    super(`โมเดล ${model} ไม่ตอบภายใน ${Math.round(ms / 1000)} วินาที`);
    this.name = 'GeminiTimeoutError';
  }
}

/**
 * Promise.race กับตัวจับเวลา
 * หมายเหตุ: ไม่ได้ยกเลิก request ที่ค้างอยู่จริง (SDK ไม่รองรับ) แต่ปลดล็อกโค้ดเราให้เดินต่อได้
 */
function withTimeout<T>(work: Promise<T>, model: string, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    work.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new GeminiTimeoutError(model, ms)), ms);
    }),
  ]);
}

/**
 * โมเดลที่ยืนยันแล้วว่าหมดโควตา**รายวัน** จริง
 *
 * เก็บระดับโมดูลได้เพราะโควตารายวันไม่ฟื้นภายในวันเดียวกัน การจำไว้จึงประหยัดการยิงซ้ำ
 * แต่ **ห้ามใส่ timeout ลงเซ็ตนี้** — timeout คือคิวฝั่ง Google แน่นชั่วคราว หายเองได้
 * เดิมใส่รวมกัน ทำให้ตอบช้าไม่กี่ครั้งแล้วทุกรุ่นถูกมาร์ก ระบบประกาศว่า "โควตาหมด"
 * ทั้งที่ยังเหลือ แล้ว runIngest หยุดทั้งรอบ (บน Vercel instance ถูก reuse
 * เซ็ตจึงไม่ได้รีเซ็ตทุกรอบ cron อย่างที่คอมเมนต์เดิมเข้าใจผิด)
 */
const dailyQuotaExhausted = new Set<string>();

/** คัดกรอง + สกัด 49 ฟิลด์ จากเนื้อข่าว 1 ชิ้น */
export async function screenAndExtract(
  newsText: string,
  ctx: ExtractContext = {}
): Promise<GeminiExtraction> {
  const all = GEMINI_MODELS();
  const candidates = all.filter((m) => !dailyQuotaExhausted.has(m));

  if (candidates.length === 0) {
    throw new DailyQuotaExhaustedError(all.join(', '), 'ทุกรุ่นที่ตั้งไว้หมดโควตารายวันแล้ว');
  }

  /** รุ่นที่ตอบช้าเกินไป — ข้ามเฉพาะการเรียกครั้งนี้ ไม่จำข้ามครั้ง */
  const slowThisCall = new Set<string>();
  let lastQuotaError: DailyQuotaExhaustedError | null = null;

  for (const model of candidates) {
    if (slowThisCall.has(model)) continue;
    try {
      return await callModel(model, newsText, ctx);
    } catch (err) {
      if (err instanceof DailyQuotaExhaustedError) {
        dailyQuotaExhausted.add(model);
        lastQuotaError = err;
        console.warn(`[gemini] ${model} หมดโควตารายวัน — สลับไปรุ่นถัดไป`);
        continue;
      }
      if (err instanceof GeminiTimeoutError) {
        slowThisCall.add(model);
        console.warn(`[gemini] ${err.message} — สลับไปรุ่นถัดไป (ยังไม่ตัดออกถาวร)`);
        continue;
      }
      throw err;
    }
  }

  // ถ้าไม่มีรุ่นไหนหมดโควตาจริง แต่ทุกรุ่นตอบช้า ต้องบอกสาเหตุที่ถูก
  if (lastQuotaError) throw lastQuotaError;
  throw new Error(
    `ทุกรุ่นตอบไม่ทันภายใน ${Math.round(CALL_TIMEOUT_MS / 1000)} วินาที ` +
      `(${candidates.join(', ')}) — คิวฝั่ง Google แน่น ลองใหม่อีกครั้ง`
  );
}

async function callModel(
  model: string,
  newsText: string,
  ctx: ExtractContext
): Promise<GeminiExtraction> {
  let response!: Awaited<ReturnType<ReturnType<typeof ai>['models']['generateContent']>>;
  for (let attempt = 0; ; attempt++) {
    try {
      response = await withTimeout(
        ai().models.generateContent({
          model,
          contents: buildPrompt(newsText, ctx),
          config: {
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA as any,
            temperature: 0,
          },
        }),
        model,
        CALL_TIMEOUT_MS
      );
      break;
    } catch (err) {
      // โควตารายวันหมด: รอไปก็ไม่หาย ต้องหยุดทั้งรอบ ไม่ใช่ข้ามข่าวนี้แล้วไปข่าวถัดไป
      const quota = asDailyQuotaError(err);
      if (quota) throw quota;

      // "This model is currently experiencing high demand" เกิดขึ้นจริงตอนรัน backfill
      // ถ้าไม่ลองซ้ำ ข่าวนั้นจะถูกข้ามไปเฉยๆ ทั้งที่ไม่มีอะไรผิด
      if (err instanceof GeminiTimeoutError) throw err;
      if (attempt >= RETRY_DELAYS_MS.length || !isTransient(err)) throw err;
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }

  const text = response.text?.trim();
  if (!text) throw new Error('Gemini ไม่ได้ส่งข้อความกลับมา');

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Gemini ส่ง JSON ที่อ่านไม่ได้: ${text.slice(0, 300)}`);
  }

  const screening: ScreeningOutput = {
    is_alcohol_related: Boolean(parsed?.screening?.is_alcohol_related),
    alcohol_role: parsed?.screening?.alcohol_role ?? null,
    is_violence_or_accident: Boolean(parsed?.screening?.is_violence_or_accident),
    confidence: Number(parsed?.screening?.confidence ?? 0),
    reason: String(parsed?.screening?.reason ?? ''),
  };

  const meta = response.usageMetadata;
  const usage: TokenUsage | null = meta
    ? {
        input: meta.promptTokenCount ?? 0,
        output: meta.candidatesTokenCount ?? 0,
        total: meta.totalTokenCount ?? 0,
      }
    : null;

  return {
    screening,
    incident: parsed?.incident && typeof parsed.incident === 'object' ? parsed.incident : null,
    model,
    usage,
  };
}
