/**
 * Normalizer กลาง — ใช้ร่วมกันทั้งฝั่ง browser และ Vercel Functions
 *
 * รวมกฎที่เดิมกระจายซ้ำอยู่ 2 ที่ (server.ts post-processing และ dataHelper.parseCSV)
 * ให้เหลือแหล่งความจริงเดียว และเพิ่มการ "ดัด" ค่าอิสระที่ LLM คืนมาให้ลงกับ
 * controlled vocabulary ใน types/dataDictionary.ts
 *
 * ห้ามใช้ browser API ใดๆ ในไฟล์นี้ (ต้องรันบน Node ได้ด้วย)
 */
import {
  ALCOHOL_TEST_METHODS,
  BEVERAGE_TYPES,
  CrimeIncident,
  GENDERS,
  INCIDENT_LOCATIONS,
  INJURY_TYPES,
  NEWS_TYPES,
  WEAPONS,
  YES_NO,
} from '../types/dataDictionary';
import { THAI_PROVINCES } from '../data/thaiProvinces';

/* ------------------------------------------------------------------ */
/* พื้นฐานการทำความสะอาดข้อความไทย                                     */
/* ------------------------------------------------------------------ */

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

/** แปลงเลขไทยเป็นเลขอารบิก */
export function thaiDigitsToArabic(input: string): string {
  return input.replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)));
}

/** ตัดช่องว่างซ้ำ / zero-width / ตัวอักษรควบคุม */
export function cleanText(input: unknown): string {
  if (input === null || input === undefined) return '';
  return String(input)
    .replace(/[​-‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** รูปแบบสำหรับเปรียบเทียบ: ตัดช่องว่างและวรรคตอนออกทั้งหมด */
function comparable(input: string): string {
  return cleanText(input)
    .toLowerCase()
    .replace(/[\s.,\-_/()"'`]/g, '');
}

/** Levenshtein distance (ใช้กับสตริงสั้นๆ เท่านั้น) */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

/* ------------------------------------------------------------------ */
/* การดัดค่าให้ลงกับ controlled vocabulary                             */
/* ------------------------------------------------------------------ */

export interface SnapResult {
  value: string;
  /** exact = ตรงอยู่แล้ว, alias = ดัดจากคำพ้อง, fuzzy = เดาจากความคล้าย, fallback = ใช้ค่าสำรอง, empty = ว่าง */
  how: 'exact' | 'alias' | 'fuzzy' | 'fallback' | 'empty';
}

/**
 * ดัดค่าอิสระให้ลงกับรายการที่กำหนด
 * ลำดับ: ตรงเป๊ะ → ตรงหลังตัดวรรคตอน → คำพ้อง (aliases) → มีคำนั้นอยู่ในข้อความ → ความคล้าย ≥ 0.72 → fallback
 */
export function snapToVocab(
  raw: unknown,
  vocab: readonly string[],
  opts: { aliases?: Record<string, string>; fallback?: string } = {}
): SnapResult {
  const value = cleanText(raw);
  if (!value) return { value: '', how: 'empty' };

  if (vocab.includes(value)) return { value, how: 'exact' };

  const cmp = comparable(value);
  for (const v of vocab) {
    if (comparable(v) === cmp) return { value: v, how: 'exact' };
  }

  if (opts.aliases) {
    // เรียงคำพ้องจากยาวไปสั้น เพื่อให้คำเฉพาะเจาะจงชนะคำกว้าง
    const keys = Object.keys(opts.aliases).sort((a, b) => b.length - a.length);
    for (const key of keys) {
      if (cmp.includes(comparable(key))) {
        return { value: opts.aliases[key], how: 'alias' };
      }
    }
  }

  // ข้อความมีชื่อหมวดอยู่ข้างใน เช่น "บ้าน/ที่อยู่อาศัย ในหมู่บ้านจัดสรร"
  for (const v of vocab) {
    if (cmp.includes(comparable(v))) return { value: v, how: 'fuzzy' };
  }

  let best = { v: '', score: 0 };
  for (const v of vocab) {
    const score = similarity(cmp, comparable(v));
    if (score > best.score) best = { v, score };
  }
  if (best.score >= 0.72) return { value: best.v, how: 'fuzzy' };

  if (opts.fallback !== undefined) return { value: opts.fallback, how: 'fallback' };
  return { value: '', how: 'empty' };
}

/* ---- ตารางคำพ้องสำหรับข่าวไทย ---- */

const NEWS_TYPE_ALIASES: Record<string, string> = {
  'เมาแล้วขับ': 'อุบัติเหตุเมาขับ',
  'เมาขับ': 'อุบัติเหตุเมาขับ',
  'เมาแล้วชน': 'อุบัติเหตุเมาขับ',
  'อุบัติเหตุจราจร': 'อุบัติเหตุเมาขับ',
  'อุบัติเหตุทางถนน': 'อุบัติเหตุเมาขับ',
  'ทำร้ายร่างกาย': 'ทำร้ายร่างกายผู้อื่น',
  'ทะเลาะวิวาท': 'ทำร้ายร่างกายผู้อื่น',
  'ชกต่อย': 'ทำร้ายร่างกายผู้อื่น',
  'ฆาตกรรม': 'ทำร้ายร่างกายผู้อื่น',
  'ยิง': 'ทำร้ายร่างกายผู้อื่น',
  'แทง': 'ทำร้ายร่างกายผู้อื่น',
  'ฆ่าตัวตาย': 'ทำร้ายตนเอง',
  'ทำร้ายตัวเอง': 'ทำร้ายตนเอง',
  'ผูกคอ': 'ทำร้ายตนเอง',
  'ข่มขืน': 'ข่มขืน ล่วงละเมิด',
  'ล่วงละเมิดทางเพศ': 'ข่มขืน ล่วงละเมิด',
  'อนาจาร': 'ข่มขืน ล่วงละเมิด',
  'คุกคามทางเพศ': 'ข่มขืน ล่วงละเมิด',
  'ทุบทำลาย': 'ทำลายทรัพย์สิน',
  'วางเพลิง': 'ทำลายทรัพย์สิน',
  'เผาทรัพย์สิน': 'ทำลายทรัพย์สิน',
};

const LOCATION_ALIASES: Record<string, string> = {
  'ทางหลวงแผ่นดิน': 'ถนนสายหลัก/ทางหลวง',
  'ทางหลวง': 'ถนนสายหลัก/ทางหลวง',
  'ถนนสายเอเชีย': 'ถนนสายหลัก/ทางหลวง',
  'มอเตอร์เวย์': 'ถนนสายหลัก/ทางหลวง',
  'ถนนใหญ่': 'ถนนสายหลัก/ทางหลวง',
  'ทางหลวงชนบท': 'ถนนสายรอง/ทางหลวงชนบท',
  'ถนนสายรอง': 'ถนนสายรอง/ทางหลวงชนบท',
  'ซอย': 'ถนนในหมู่บ้าน',
  'ถนนในหมู่บ้าน': 'ถนนในหมู่บ้าน',
  'บ้านพัก': 'บ้าน/ที่อยู่อาศัย',
  'ที่พักอาศัย': 'บ้าน/ที่อยู่อาศัย',
  'ห้องพัก': 'บ้าน/ที่อยู่อาศัย',
  'หอพัก': 'บ้าน/ที่อยู่อาศัย',
  'คอนโด': 'บ้าน/ที่อยู่อาศัย',
  'ในบ้าน': 'บ้าน/ที่อยู่อาศัย',
  'สวนสาธารณะ': 'ที่สาธารณะ',
  'ตลาด': 'ที่สาธารณะ',
  'ริมทาง': 'ที่สาธารณะ',
  'รีสอร์ท': 'โรงแรม',
  'ม่านรูด': 'โรงแรม',
  'ลานเบียร์': 'สถานบริการ/สถานบันเทิง',
  'ผับ': 'สถานบริการ/สถานบันเทิง',
  'บาร์': 'สถานบริการ/สถานบันเทิง',
  'ร้านเหล้า': 'สถานบริการ/สถานบันเทิง',
  'คาราโอเกะ': 'สถานบริการ/สถานบันเทิง',
  'สถานบันเทิง': 'สถานบริการ/สถานบันเทิง',
  'ร้านอาหารกึ่งผับ': 'สถานบริการ/สถานบันเทิง',
  'งานเทศกาล': 'สถานที่จัดงาน/งานเทศกาล',
  'งานวัด': 'สถานที่จัดงาน/งานเทศกาล',
  'งานบุญ': 'สถานที่จัดงาน/งานเทศกาล',
  'งานเลี้ยง': 'สถานที่จัดงาน/งานเทศกาล',
  'งานศพ': 'สถานที่จัดงาน/งานเทศกาล',
  'คอนเสิร์ต': 'สถานที่จัดงาน/งานเทศกาล',
};

const GENDER_ALIASES: Record<string, string> = {
  'ผู้ชาย': 'ชาย',
  'เพศชาย': 'ชาย',
  'male': 'ชาย',
  'นาย': 'ชาย',
  'ผู้หญิง': 'หญิง',
  'เพศหญิง': 'หญิง',
  'female': 'หญิง',
  'นางสาว': 'หญิง',
  'น.ส.': 'หญิง',
  'นาง': 'หญิง',
  'lgbt': 'LGBTQ+',
  'lgbtq': 'LGBTQ+',
  'เพศทางเลือก': 'LGBTQ+',
  'ข้ามเพศ': 'LGBTQ+',
  'กะเทย': 'LGBTQ+',
  'ทอม': 'LGBTQ+',
};

const YES_NO_ALIASES: Record<string, string> = {
  'ใช่': 'ใช่',
  'มี': 'ใช่',
  'เคย': 'ใช่',
  'true': 'ใช่',
  'yes': 'ใช่',
  'y': 'ใช่',
  'ไม่ใช่': 'ไม่ใช่',
  'ไม่มี': 'ไม่ใช่',
  'ไม่เคย': 'ไม่ใช่',
  'false': 'ไม่ใช่',
  'no': 'ไม่ใช่',
  'n': 'ไม่ใช่',
};

const WEAPON_ALIASES: Record<string, string> = {
  'จยย': 'รถจักรยานยนต์',
  'จักรยานยนต์': 'รถจักรยานยนต์',
  'มอเตอร์ไซค์': 'รถจักรยานยนต์',
  'มอไซค์': 'รถจักรยานยนต์',
  'บิ๊กไบค์': 'รถจักรยานยนต์',
  'รถกระบะ': 'รถยนต์',
  'กระบะ': 'รถยนต์',
  'รถเก๋ง': 'รถยนต์',
  'เก๋ง': 'รถยนต์',
  'รถตู้': 'รถยนต์',
  'รถบรรทุก': 'รถอื่นๆ',
  'รถพ่วง': 'รถอื่นๆ',
  'รถไถ': 'รถอื่นๆ',
  'สามล้อ': 'รถอื่นๆ',
  'รถบัส': 'รถอื่นๆ',
  'อาวุธปืน': 'ปืน',
  'ปืนพก': 'ปืน',
  'ลูกซอง': 'ปืน',
  'มีดพก': 'มีด',
  'มีดอีโต้': 'มีด',
  'อีโต้': 'มีด',
  'มีดดาบ': 'มีด',
  'ดาบ': 'มีด',
  'ท่อนไม้': 'แท่งเหล็ก/ไม้',
  'ไม้': 'แท่งเหล็ก/ไม้',
  'ท่อเหล็ก': 'แท่งเหล็ก/ไม้',
  'เหล็ก': 'แท่งเหล็ก/ไม้',
  'ค้อน': 'แท่งเหล็ก/ไม้',
  'ขวด': 'อื่นๆ',
  'มือเปล่า': 'อื่นๆ',
};

const TEST_METHOD_ALIASES: Record<string, string> = {
  'สังเกตอาการ': 'สังเกตุอาการ',
  'สังเกต': 'สังเกตุอาการ',
  'ดูจากอาการ': 'สังเกตุอาการ',
  'ไม่ได้ตรวจ': 'สังเกตุอาการ',
  'เป่า': 'เป่าแอลกอฮอล์',
  'ลมหายใจ': 'เป่าแอลกอฮอล์',
  'เครื่องเป่า': 'เป่าแอลกอฮอล์',
  'เจาะเลือด': 'เจาะเลือดตรวจแอลกอฮอล์',
  'ตรวจเลือด': 'เจาะเลือดตรวจแอลกอฮอล์',
  'แอลกอฮอล์ในเลือด': 'เจาะเลือดตรวจแอลกอฮอล์',
};

const BEVERAGE_ALIASES: Record<string, string> = {
  'สุราขาว': 'สุราขาว/สุราสี',
  'สุราสี': 'สุราขาว/สุราสี',
  'เหล้าขาว': 'สุราขาว/สุราสี',
  'เหล้า': 'สุราขาว/สุราสี',
  'สุรา': 'สุราขาว/สุราสี',
  'วิสกี้': 'สุราขาว/สุราสี',
  'ยาดอง': 'สุราขาว/สุราสี',
  'เบียร์สด': 'เบียร์',
  'เบียร์': 'เบียร์',
  'ไวน์': 'ไวน์',
  'สปาย': 'อื่นๆ',
  'ค็อกเทล': 'อื่นๆ',
};

const INJURY_ALIASES: Record<string, string> = {
  'เล็กน้อย': 'บาดเจ็บเล็กน้อย',
  'บาดเจ็บเล็กน้อย': 'บาดเจ็บเล็กน้อย',
  'สาหัส': 'บาดเจ็บสาหัส',
  'อาการหนัก': 'บาดเจ็บสาหัส',
  'โคม่า': 'บาดเจ็บสาหัส',
  'เสียชีวิต': 'เสียชีวิต',
  'ดับ': 'เสียชีวิต',
  'ตาย': 'เสียชีวิต',
  'สิ้นใจ': 'เสียชีวิต',
};

/* ------------------------------------------------------------------ */
/* จังหวัด                                                             */
/* ------------------------------------------------------------------ */

const PROVINCE_ALIASES: Record<string, string> = {
  'กทม': 'กรุงเทพมหานคร',
  'กรุงเทพ': 'กรุงเทพมหานคร',
  'กรุงเทพฯ': 'กรุงเทพมหานคร',
  'บางกอก': 'กรุงเทพมหานคร',
  'bangkok': 'กรุงเทพมหานคร',
  'อยุธยา': 'พระนครศรีอยุธยา',
  'โคราช': 'นครราชสีมา',
  'หาดใหญ่': 'สงขลา',
  'ศรีษะเกษ': 'ศรีสะเกษ',
  'พัทยา': 'ชลบุรี',
};

/** ตัดคำนำหน้า "จ." / "จังหวัด" แล้วจับคู่กับรายชื่อ 77 จังหวัด */
export function normalizeProvince(raw: unknown): string {
  let value = cleanText(raw);
  if (!value) return '';
  value = value.replace(/^(จังหวัด|จ\.)\s*/u, '').trim();

  if ((THAI_PROVINCES as readonly string[]).includes(value)) return value;

  const cmp = comparable(value);
  for (const key of Object.keys(PROVINCE_ALIASES).sort((a, b) => b.length - a.length)) {
    if (cmp.includes(comparable(key))) return PROVINCE_ALIASES[key];
  }

  return snapToVocab(value, THAI_PROVINCES as readonly string[], { fallback: '' }).value;
}

/** ตัดคำนำหน้า "อ." / "อำเภอ" / "เขต" ออก แต่คงชื่อไว้ (ไม่มีรายการอ้างอิงในระบบ) */
export function normalizeDistrict(raw: unknown): string {
  return cleanText(raw).replace(/^(อำเภอ|อ\.|เขต)\s*/u, '').trim();
}

/** ตัดคำนำหน้า "ต." / "ตำบล" / "แขวง" ออก */
export function normalizeSubDistrict(raw: unknown): string {
  return cleanText(raw).replace(/^(ตำบล|ต\.|แขวง)\s*/u, '').trim();
}

/* ------------------------------------------------------------------ */
/* วันที่และเวลาแบบไทย                                                  */
/* ------------------------------------------------------------------ */

const THAI_MONTHS: Record<string, number> = {
  'มกราคม': 1, 'ม.ค.': 1, 'มค': 1,
  'กุมภาพันธ์': 2, 'ก.พ.': 2, 'กพ': 2,
  'มีนาคม': 3, 'มี.ค.': 3, 'มีค': 3,
  'เมษายน': 4, 'เม.ย.': 4, 'เมย': 4,
  'พฤษภาคม': 5, 'พ.ค.': 5, 'พค': 5,
  'มิถุนายน': 6, 'มิ.ย.': 6, 'มิย': 6,
  'กรกฎาคม': 7, 'ก.ค.': 7, 'กค': 7,
  'สิงหาคม': 8, 'ส.ค.': 8, 'สค': 8,
  'กันยายน': 9, 'ก.ย.': 9, 'กย': 9,
  'ตุลาคม': 10, 'ต.ค.': 10, 'ตค': 10,
  'พฤศจิกายน': 11, 'พ.ย.': 11, 'พย': 11,
  'ธันวาคม': 12, 'ธ.ค.': 12, 'ธค': 12,
};

/** แปลงปี พ.ศ. → ค.ศ. (รองรับทั้ง 2569 และ 69) */
function normalizeYear(rawYear: number, referenceYear: number): number {
  let y = rawYear;
  if (y < 100) {
    // สองหลัก: ลองทั้ง พ.ศ. และ ค.ศ. แล้วเลือกอันที่ใกล้ปีอ้างอิงกว่า
    const asBE = 2500 + y - 543;
    const asCE = 2000 + y;
    return Math.abs(asBE - referenceYear) <= Math.abs(asCE - referenceYear) ? asBE : asCE;
  }
  if (y >= 2400) y -= 543; // พ.ศ. → ค.ศ.
  return y;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * แปลงวันที่จากข่าวไทยเป็น YYYY-MM-DD
 * รองรับ: "2026-08-25" | "25/08/2569" | "25 สิงหาคม 2569" | "15 มีนาคม" (เดาปีจาก reference)
 * คืน '' ถ้าแปลงไม่ได้ — ไม่เดามั่ว
 */
export function thaiDateToISO(raw: unknown, reference?: Date | string | null): string {
  const value = thaiDigitsToArabic(cleanText(raw));
  if (!value) return '';

  const ref = reference ? new Date(reference) : new Date();
  const refYear = Number.isNaN(ref.getTime()) ? new Date().getFullYear() : ref.getFullYear();

  // ISO อยู่แล้ว
  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const y = normalizeYear(Number(iso[1]), refYear);
    return `${y}-${pad2(Number(iso[2]))}-${pad2(Number(iso[3]))}`;
  }

  // dd/mm/yyyy หรือ dd-mm-yyyy
  const slash = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (slash) {
    const y = normalizeYear(Number(slash[3]), refYear);
    return `${y}-${pad2(Number(slash[2]))}-${pad2(Number(slash[1]))}`;
  }

  // "25 สิงหาคม 2569" หรือ "15 มีนาคม"
  const monthKeys = Object.keys(THAI_MONTHS).sort((a, b) => b.length - a.length);
  for (const key of monthKeys) {
    const idx = value.indexOf(key);
    if (idx === -1) continue;
    const before = value.slice(0, idx).match(/(\d{1,2})\s*$/);
    if (!before) continue;
    const day = Number(before[1]);
    const after = value.slice(idx + key.length).match(/^\s*(\d{2,4})/);
    const month = THAI_MONTHS[key];
    let year: number;
    if (after) {
      year = normalizeYear(Number(after[1]), refYear);
    } else {
      // ไม่มีปี: ใช้ปีอ้างอิง แต่ถ้าเดือนอยู่ข้างหน้าเดือนอ้างอิงมาก แปลว่าเป็นปีก่อน
      year = refYear;
      if (!Number.isNaN(ref.getTime()) && month > ref.getMonth() + 2) year = refYear - 1;
    }
    if (day >= 1 && day <= 31) return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  return '';
}

/** แปลงเวลาเป็น HH:MM (รองรับ "02.30 น.", "23:45", "2.30") */
export function normalizeTime(raw: unknown): string {
  const value = thaiDigitsToArabic(cleanText(raw));
  if (!value) return '';
  const m = value.match(/(\d{1,2})[:.](\d{2})/);
  if (!m) return '';
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return '';
  return `${pad2(h)}:${pad2(min)}`;
}

/* ------------------------------------------------------------------ */
/* ตัวเลข                                                              */
/* ------------------------------------------------------------------ */

/** แปลงเป็นจำนวนเต็ม; คืน null เมื่อว่าง/ไม่ใช่ตัวเลข (ไม่คืน 0) */
export function toIntOrNull(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? Math.round(raw) : null;
  const value = thaiDigitsToArabic(cleanText(raw)).replace(/,/g, '');
  if (!value) return null;
  const m = value.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** อายุ: 0 หรือค่าที่เป็นไปไม่ได้ → null (กฎ "ไม่ทราบให้เว้นว่าง ห้ามใส่ 0") */
export function toAgeOrNull(raw: unknown): number | null {
  const n = toIntOrNull(raw);
  if (n === null || n <= 0 || n > 120) return null;
  return n;
}

/* ------------------------------------------------------------------ */
/* กฎธุรกิจ                                                            */
/* ------------------------------------------------------------------ */

/**
 * กฎบังคับของ data dictionary
 * (เดิมซ้ำอยู่ที่ server.ts:149-155 และ dataHelper.ts:171-178)
 */
export function applyBusinessRules<T extends Partial<CrimeIncident>>(inc: T): T {
  const out = { ...inc };

  // อายุ 0 = "ไม่ทราบ" → ต้องเป็น null
  out.perpetrator_age = toAgeOrNull(out.perpetrator_age);
  out.victim_1_age = toAgeOrNull(out.victim_1_age);
  out.victim_2_age = toAgeOrNull(out.victim_2_age);
  out.victim_3_age = toAgeOrNull(out.victim_3_age);

  // วิธีตรวจแบบสังเกตอาการ ให้ค่าระดับแอลกอฮอล์ไม่ได้
  if (out.alcohol_test_method === 'สังเกตุอาการ') {
    out.alcohol_level = null;
  } else {
    out.alcohol_level = toIntOrNull(out.alcohol_level);
    if (out.alcohol_level !== null && (out.alcohol_level < 0 || out.alcohol_level > 1000)) {
      out.alcohol_level = null;
    }
  }

  out.test_duration = toIntOrNull(out.test_duration);
  out.total_affected = toIntOrNull(out.total_affected);
  out.total_death = toIntOrNull(out.total_death);
  out.total_injury = toIntOrNull(out.total_injury);

  return out;
}

/**
 * ตัดสินว่าเหตุการณ์ "เกี่ยวข้องกับแอลกอฮอล์" หรือไม่ อย่างชัดเจน
 *
 * แทน heuristic เดิมใน AnalyticsDashboard ที่นับจาก `beverage_type` มีค่า
 * ซึ่งพังเพราะฟอร์มตั้งดีฟอลต์ beverage_type = 'สุราขาว/สุราสี' ให้ทุกเรคคอร์ดใหม่
 * ทำให้อัตราพองเป็น ~100%
 */
export function deriveAlcoholInvolved(inc: Partial<CrimeIncident>): boolean {
  // 1. มีผลตรวจเป็นตัวเลขมากกว่า 0
  if (typeof inc.alcohol_level === 'number' && inc.alcohol_level > 0) return true;
  // 2. มีการตรวจวัดจริง (เป่า/เจาะเลือด/สังเกตอาการ) = เจ้าหน้าที่เห็นว่าเมา
  if (inc.alcohol_test_method && (ALCOHOL_TEST_METHODS as readonly string[]).includes(inc.alcohol_test_method)) {
    return true;
  }
  // 3. ระบุสถานที่ดื่มก่อนเกิดเหตุเป็นข้อความจริง
  if (cleanText(inc.drinking_location).length > 0) return true;
  // 4. ประเภทข่าวเป็นเมาขับโดยตรง
  if (inc.news_type === 'อุบัติเหตุเมาขับ') return true;
  return false;
}

/* ------------------------------------------------------------------ */
/* Normalizer หลัก                                                     */
/* ------------------------------------------------------------------ */

export interface NormalizeContext {
  /** URL ข่าว (ทับค่าที่ LLM เดามา เพราะเรารู้ค่าจริง) */
  url?: string;
  /** ชื่อสำนักข่าว (ทับค่าที่ LLM เดามา) */
  newsAgency?: string;
  /** พาดหัวข่าวจริงจาก RSS */
  newsTitle?: string;
  /** วันที่เผยแพร่ ใช้เดาปีเมื่อข่าวเขียนแค่ "15 มีนาคม" */
  publishedAt?: string | Date | null;
}

export interface NormalizeReport {
  /** ฟิลด์ที่ถูกดัดค่า (ใช้ไฮไลต์ในคิวตรวจสอบ) */
  adjusted: string[];
  /** ฟิลด์ที่มีค่ามาแต่ดัดไม่ลง vocab (ต้องให้คนดู) */
  unmapped: { field: string; original: string }[];
}

/**
 * ทำความสะอาดผลลัพธ์ดิบจาก LLM / CSV ให้เป็น CrimeIncident ที่ถูกต้องตามสเปก
 */
export function normalizeIncident(
  raw: Record<string, unknown>,
  ctx: NormalizeContext = {}
): { incident: Omit<CrimeIncident, 'id'>; report: NormalizeReport } {
  const adjusted: string[] = [];
  const unmapped: { field: string; original: string }[] = [];

  const snap = (
    field: keyof CrimeIncident,
    vocab: readonly string[],
    aliases?: Record<string, string>,
    fallback?: string
  ): string => {
    const original = cleanText(raw[field]);
    const res = snapToVocab(original, vocab, { aliases, fallback });
    if (original && res.how !== 'exact' && res.how !== 'empty') adjusted.push(field);
    if (original && res.value === '') unmapped.push({ field, original });
    return res.value;
  };

  const text = (field: keyof CrimeIncident): string => cleanText(raw[field]);

  const publishedAt = ctx.publishedAt ?? null;

  const incident: Omit<CrimeIncident, 'id'> = {
    news_type: snap('news_type', NEWS_TYPES, NEWS_TYPE_ALIASES),
    url: cleanText(ctx.url ?? raw.url),
    news_agency: cleanText(ctx.newsAgency ?? raw.news_agency),
    news_title: cleanText(ctx.newsTitle ?? raw.news_title),
    incident_date: thaiDateToISO(raw.incident_date, publishedAt),
    incident_time: normalizeTime(raw.incident_time),
    province: normalizeProvince(raw.province),
    district: normalizeDistrict(raw.district),
    sub_district: normalizeSubDistrict(raw.sub_district),
    incident_location: snap('incident_location', INCIDENT_LOCATIONS, LOCATION_ALIASES),
    location_other: text('location_other'),
    perpetrator_name: text('perpetrator_name'),
    perpetrator_gender: snap('perpetrator_gender', GENDERS, GENDER_ALIASES),
    perpetrator_age: toAgeOrNull(raw.perpetrator_age),
    perpetrator_occupation: snap('perpetrator_occupation', YES_NO, YES_NO_ALIASES),
    perpetrator_occupation_detail: text('perpetrator_occupation_detail'),
    perpetrator_weapon: snap('perpetrator_weapon', WEAPONS, WEAPON_ALIASES),
    alcohol_test_method: snap('alcohol_test_method', ALCOHOL_TEST_METHODS, TEST_METHOD_ALIASES),
    alcohol_level: toIntOrNull(raw.alcohol_level),
    drinking_location: text('drinking_location'),
    beverage_type: snap('beverage_type', BEVERAGE_TYPES, BEVERAGE_ALIASES),
    test_duration: toIntOrNull(raw.test_duration),
    recidivism: snap('recidivism', YES_NO, YES_NO_ALIASES),
    drug_use: snap('drug_use', YES_NO, YES_NO_ALIASES),
    drug_use_detail: text('drug_use_detail'),
    total_affected: toIntOrNull(raw.total_affected),
    total_death: toIntOrNull(raw.total_death),
    total_injury: toIntOrNull(raw.total_injury),
    public_property_damage: text('public_property_damage'),
    victim_1_name: text('victim_1_name'),
    victim_1_gender: snap('victim_1_gender', GENDERS, GENDER_ALIASES),
    victim_1_age: toAgeOrNull(raw.victim_1_age),
    victim_1_occupation: text('victim_1_occupation'),
    victim_1_injury_type: snap('victim_1_injury_type', INJURY_TYPES, INJURY_ALIASES),
    victim_1_relation_to_perpetrator: snap('victim_1_relation_to_perpetrator', YES_NO, YES_NO_ALIASES),
    victim_2_name: text('victim_2_name'),
    victim_2_gender: snap('victim_2_gender', GENDERS, GENDER_ALIASES),
    victim_2_age: toAgeOrNull(raw.victim_2_age),
    victim_2_occupation: text('victim_2_occupation'),
    victim_2_injury_type: snap('victim_2_injury_type', INJURY_TYPES, INJURY_ALIASES),
    victim_2_relation_to_perpetrator: snap('victim_2_relation_to_perpetrator', YES_NO, YES_NO_ALIASES),
    victim_3_name: text('victim_3_name'),
    victim_3_gender: snap('victim_3_gender', GENDERS, GENDER_ALIASES),
    victim_3_age: toAgeOrNull(raw.victim_3_age),
    victim_3_occupation: text('victim_3_occupation'),
    victim_3_injury_type: snap('victim_3_injury_type', INJURY_TYPES, INJURY_ALIASES),
    victim_3_relation_to_perpetrator: snap('victim_3_relation_to_perpetrator', YES_NO, YES_NO_ALIASES),
    news_summary: text('news_summary'),
  };

  return { incident: applyBusinessRules(incident), report: { adjusted, unmapped } };
}
