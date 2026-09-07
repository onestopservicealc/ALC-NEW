import { CrimeIncident, CSV_HEADER_ARRAY, CSV_HEADER_STRING, validateIncident } from '../types/dataDictionary';
import { applyBusinessRules } from '../lib/normalize';

/**
 * คีย์ localStorage ของระบบเวอร์ชันก่อนย้ายขึ้น Supabase
 * เก็บไว้เพื่อให้ผู้ใช้ย้ายข้อมูลเดิมขึ้นฐานข้อมูลได้ครั้งเดียว แล้วไม่ใช้ต่อ
 */
const LEGACY_STORAGE_KEY = 'CRIME_INCIDENT_DATA_DICTIONARY_V1';

/** อ่านข้อมูลที่ค้างอยู่ใน localStorage ของเวอร์ชันเดิม (คืน [] ถ้าไม่มี) */
export function readLegacyLocalData(): CrimeIncident[] {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CrimeIncident[]) : [];
  } catch (e) {
    console.error('อ่านข้อมูลเดิมจาก localStorage ไม่สำเร็จ:', e);
    return [];
  }
}

/** ลบข้อมูลเดิมทิ้งหลังย้ายขึ้น Supabase สำเร็จแล้ว */
export function clearLegacyLocalData(): void {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch (e) {
    console.error('ลบข้อมูลเดิมไม่สำเร็จ:', e);
  }
}

/**
 * Converts array of CrimeIncident to CSV with standard 49 columns and UTF-8 BOM for Thai Excel
 */
export function exportToCSV(incidents: CrimeIncident[]): string {
  const escapeCsvCell = (val: any): string => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows: string[] = [CSV_HEADER_STRING];

  for (const item of incidents) {
    const line = CSV_HEADER_ARRAY.map((key) => escapeCsvCell(item[key])).join(',');
    rows.push(line);
  }

  return '\uFEFF' + rows.join('\r\n');
}

/**
 * Downloads text as a file in browser
 */
export function downloadFile(content: string, fileName: string, mimeType: string = 'text/csv;charset=utf-8;') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Parses CSV text into CrimeIncident records
 */
export function parseCSV(csvText: string): { incidents: CrimeIncident[]; errors: string[] } {
  const errors: string[] = [];
  const incidents: CrimeIncident[] = [];

  // Remove BOM if present
  let cleanText = csvText;
  if (cleanText.charCodeAt(0) === 0xfeff) {
    cleanText = cleanText.substring(1);
  }

  // Parse CSV line by line taking into account quoted fields
  const parseRows = (text: string): string[][] => {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentCell = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          currentCell += '"';
          i++; // Skip escaped quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        currentRow.push(currentCell.trim());
        currentCell = '';
      } else if ((char === '\r' || char === '\n') && !inQuotes) {
        if (char === '\r' && nextChar === '\n') {
          i++;
        }
        currentRow.push(currentCell.trim());
        if (currentRow.some((c) => c.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentCell = '';
      } else {
        currentCell += char;
      }
    }

    if (currentCell.length > 0 || currentRow.length > 0) {
      currentRow.push(currentCell.trim());
      if (currentRow.some((c) => c.length > 0)) {
        rows.push(currentRow);
      }
    }

    return rows;
  };

  const parsedRows = parseRows(cleanText);
  if (parsedRows.length < 2) {
    return { incidents: [], errors: ['ไฟล์ CSV ไม่มีข้อมูลหรือมีเพียงแถวหัวตาราง'] };
  }

  const headerRow = parsedRows[0].map((h) => h.trim().toLowerCase());
  
  // Find column mapping index for each standard field
  const fieldIndexMap: Record<keyof CrimeIncident, number> = {} as any;
  CSV_HEADER_ARRAY.forEach((key) => {
    const idx = headerRow.findIndex((h) => h === key.toLowerCase());
    fieldIndexMap[key] = idx;
  });

  for (let r = 1; r < parsedRows.length; r++) {
    const row = parsedRows[r];
    const item: Partial<CrimeIncident> = {};

    CSV_HEADER_ARRAY.forEach((key) => {
      const colIdx = fieldIndexMap[key] !== -1 ? fieldIndexMap[key] : -1;
      const rawVal = colIdx !== -1 && colIdx < row.length ? row[colIdx] : '';

      if (key === 'id') {
        item.id = rawVal ? parseInt(rawVal, 10) || r : r;
      } else if (
        key === 'perpetrator_age' ||
        key === 'victim_1_age' ||
        key === 'victim_2_age' ||
        key === 'victim_3_age' ||
        key === 'alcohol_level' ||
        key === 'test_duration' ||
        key === 'total_affected' ||
        key === 'total_death' ||
        key === 'total_injury'
      ) {
        if (rawVal === '' || rawVal === null || rawVal === undefined) {
          (item as any)[key] = null;
        } else {
          const num = parseInt(rawVal, 10);
          (item as any)[key] = isNaN(num) ? null : num;
        }
      } else {
        (item as any)[key] = rawVal;
      }
    });

    // กฎธุรกิจทั้งหมดอยู่ที่ lib/normalize.ts ที่เดียว (ใช้ร่วมกับฝั่งเซิร์ฟเวอร์)
    Object.assign(item, applyBusinessRules(item));

    const validation = validateIncident(item);
    if (!validation.isValid) {
      const errMsgs = Object.values(validation.errors).join(', ');
      errors.push(`แถวที่ ${r + 1}: ${errMsgs}`);
    }

    incidents.push(item as CrimeIncident);
  }

  return { incidents, errors };
}
