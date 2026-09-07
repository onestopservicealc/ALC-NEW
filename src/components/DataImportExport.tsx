import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowUpFromLine,
  CheckCircle2,
  Download,
  FileCheck,
  FileCode,
  FileSpreadsheet,
  Info,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { CSV_HEADER_STRING, CrimeIncident } from '../types/dataDictionary';
import {
  clearLegacyLocalData,
  downloadFile,
  exportToCSV,
  parseCSV,
  readLegacyLocalData,
} from '../utils/dataHelper';

interface DataImportExportProps {
  incidents: CrimeIncident[];
  canEdit: boolean;
  /** ต้องคืน Promise เพื่อให้รู้ผลก่อนลบข้อมูลต้นทาง — ดู handleMigrateLegacy */
  onImportData: (newIncidents: CrimeIncident[]) => Promise<number>;
  onToast: (message: string, type?: 'success' | 'info') => void;
}

export const DataImportExport: React.FC<DataImportExportProps> = ({
  incidents,
  canEdit,
  onImportData,
  onToast,
}) => {
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importSuccessMsg, setImportSuccessMsg] = useState<string | null>(null);
  const [legacyCount, setLegacyCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLegacyCount(readLegacyLocalData().length);
  }, []);

  const stamp = () => new Date().toISOString().split('T')[0];

  const handleExportCSV = () => {
    downloadFile(exportToCSV(incidents), `alcohol_incidents_${stamp()}.csv`);
  };

  const handleExportJSON = () => {
    downloadFile(
      JSON.stringify(incidents, null, 2),
      `alcohol_incidents_${stamp()}.json`,
      'application/json;charset=utf-8;'
    );
  };

  const handleDownloadTemplate = () => {
    downloadFile('﻿' + CSV_HEADER_STRING + '\r\n', 'template_49_fields.csv');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportErrors([]);
    setImportSuccessMsg(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      try {
        if (file.name.toLowerCase().endsWith('.json')) {
          const parsed = JSON.parse(content);
          if (!Array.isArray(parsed)) {
            setImportErrors(['ไฟล์ JSON ต้องเป็น array ของเหตุการณ์']);
            return;
          }
          void onImportData(parsed as CrimeIncident[]);
          setImportSuccessMsg(`อ่านไฟล์ JSON สำเร็จ ${parsed.length} รายการ กำลังบันทึกลงฐานข้อมูล`);
        } else {
          const { incidents: parsedList, errors } = parseCSV(content);
          if (errors.length > 0) setImportErrors(errors);
          if (parsedList.length > 0) {
            void onImportData(parsedList);
            setImportSuccessMsg(
              `อ่านไฟล์ CSV สำเร็จ ${parsedList.length} รายการ${
                errors.length ? ` (มีคำเตือน ${errors.length} แถว)` : ''
              }`
            );
          }
        }
      } catch (err: any) {
        setImportErrors([`อ่านไฟล์ไม่สำเร็จ: ${err?.message ?? err}`]);
      }
    };
    reader.readAsText(file, 'UTF-8');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const [migrating, setMigrating] = useState(false);

  /**
   * ย้ายข้อมูลจาก localStorage ขึ้นฐานข้อมูล
   *
   * เดิมเรียก onImportData() แบบ fire-and-forget แล้วลบ localStorage ทันทีในบรรทัดถัดไป
   * ถ้าการนำเข้าล้ม (RLS / เน็ตหลุด / ข้อมูลไม่ผ่าน constraint) ข้อมูลต้นทางจะหายถาวร
   * โดยไม่มีที่ไหนเหลือ — ต้องรู้ผลก่อนจึงลบได้
   */
  const handleMigrateLegacy = async () => {
    const legacy = readLegacyLocalData();
    if (legacy.length === 0) return;
    if (
      !window.confirm(
        `พบข้อมูลเดิมในเบราว์เซอร์ ${legacy.length} รายการ\nต้องการย้ายขึ้นฐานข้อมูล Supabase หรือไม่?`
      )
    ) {
      return;
    }

    setMigrating(true);
    try {
      const inserted = await onImportData(legacy);
      // ลบต้นทางเฉพาะเมื่อบันทึกสำเร็จจริง
      clearLegacyLocalData();
      setLegacyCount(0);
      onToast(`ย้ายข้อมูลเดิม ${inserted} รายการขึ้นฐานข้อมูลสำเร็จ`);
    } catch (err: any) {
      onToast(
        `ย้ายข้อมูลไม่สำเร็จ: ${err?.message ?? 'ไม่ทราบสาเหตุ'} — ข้อมูลเดิมในเบราว์เซอร์ยังอยู่ครบ ลองใหม่ได้`,
        'info'
      );
    } finally {
      setMigrating(false);
    }
  };

  return (
    <div className="space-y-5">
      <header className="bg-white border border-neutral-200 rounded-sm p-5 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-sm bg-neutral-100 border border-neutral-300">
            <FileSpreadsheet className="w-5 h-5 text-neutral-800" />
          </div>
          <div>
            <span className="text-xs  font-mono uppercase text-neutral-600">
              Data interchange
            </span>
            <h2 className="font-serif text-2xl text-neutral-900 italic tracking-wide">นำเข้า / ส่งออกข้อมูล</h2>
            <p className="text-xs text-neutral-600 mt-1 font-sans">
              ไฟล์ CSV ที่ส่งออกมี 49 คอลัมน์ตามสเปกเป๊ะ พร้อม UTF-8 BOM เปิดใน Excel ภาษาไทยได้ทันที
            </p>
          </div>
        </div>
      </header>

      {/* ย้ายข้อมูลจากเวอร์ชันเดิม */}
      {legacyCount > 0 && (
        <div className="bg-white border border-red-200 rounded-sm p-5 shadow-xl">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-2.5">
              <ArrowUpFromLine className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-xs font-mono font-bold  text-red-700">
                  พบข้อมูลเดิมในเบราว์เซอร์ {legacyCount} รายการ
                </h3>
                <p className="text-[13px] text-neutral-600 mt-1 font-sans max-w-xl leading-relaxed">
                  ระบบเวอร์ชันก่อนเก็บข้อมูลไว้ใน localStorage ของเครื่องนี้
                  ย้ายขึ้น Supabase เพื่อให้ใช้ร่วมกันได้หลายคนและไม่หายเมื่อล้างเบราว์เซอร์
                </p>
              </div>
            </div>
            <button
              onClick={() => void handleMigrateLegacy()}
              disabled={!canEdit || migrating}
              className="px-4 py-2 text-xs font-mono font-bold  text-white bg-neutral-900 hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed rounded-sm"
            >
              {migrating ? 'กำลังย้าย...' : 'ย้ายขึ้นฐานข้อมูล'}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* ส่งออก */}
        <div className="bg-white border border-neutral-200 rounded-sm p-5 shadow-xl space-y-4">
          <h3 className="text-xs font-mono font-bold  text-neutral-800 flex items-center gap-1.5 pb-2 border-b border-neutral-200">
            <Download className="w-4 h-4 text-neutral-600" />
            ส่งออกข้อมูล ({incidents.length} รายการ)
          </h3>

          <button
            onClick={handleExportCSV}
            disabled={incidents.length === 0}
            className="w-full flex items-center justify-between px-4 py-3 bg-neutral-50 hover:bg-neutral-100 border border-neutral-200 rounded-sm transition-colors disabled:opacity-40 group"
          >
            <span className="flex items-center gap-2.5">
              <FileSpreadsheet className="w-4 h-4 text-neutral-900" />
              <span className="text-left">
                <span className="block text-xs text-neutral-900 font-sans">CSV (49 คอลัมน์)</span>
                <span className="block text-xs font-mono text-neutral-600">
                  UTF-8 BOM · เปิดใน Excel ภาษาไทยได้
                </span>
              </span>
            </span>
            <Download className="w-3.5 h-3.5 text-neutral-600 group-hover:text-neutral-800" />
          </button>

          <button
            onClick={handleExportJSON}
            disabled={incidents.length === 0}
            className="w-full flex items-center justify-between px-4 py-3 bg-neutral-50 hover:bg-neutral-100 border border-neutral-200 rounded-sm transition-colors disabled:opacity-40 group"
          >
            <span className="flex items-center gap-2.5">
              <FileCode className="w-4 h-4 text-neutral-700" />
              <span className="text-left">
                <span className="block text-xs text-neutral-900 font-sans">JSON</span>
                <span className="block text-xs font-mono text-neutral-600">
                  สำหรับต่อยอดเชิงวิเคราะห์
                </span>
              </span>
            </span>
            <Download className="w-3.5 h-3.5 text-neutral-600 group-hover:text-neutral-800" />
          </button>

          <button
            onClick={handleDownloadTemplate}
            className="w-full flex items-center justify-between px-4 py-3 bg-neutral-50 hover:bg-neutral-100 border border-neutral-200 rounded-sm transition-colors group"
          >
            <span className="flex items-center gap-2.5">
              <FileCheck className="w-4 h-4 text-neutral-600" />
              <span className="text-left">
                <span className="block text-xs text-neutral-900 font-sans">เทมเพลต CSV เปล่า</span>
                <span className="block text-xs font-mono text-neutral-600">หัวตาราง 49 คอลัมน์</span>
              </span>
            </span>
            <Download className="w-3.5 h-3.5 text-neutral-600 group-hover:text-neutral-800" />
          </button>
        </div>

        {/* นำเข้า */}
        <div className="bg-white border border-neutral-200 rounded-sm p-5 shadow-xl space-y-4">
          <h3 className="text-xs font-mono font-bold  text-neutral-800 flex items-center gap-1.5 pb-2 border-b border-neutral-200">
            <Upload className="w-4 h-4 text-neutral-600" />
            นำเข้าข้อมูล
          </h3>

          {!canEdit ? (
            <div className="p-3.5 bg-neutral-100 border border-neutral-200 rounded-sm text-[13px] text-neutral-600 flex items-start gap-2 font-sans">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5 text-neutral-600" />
              <span>ต้องเข้าสู่ระบบด้วยบัญชีที่มีสิทธิ์บันทึกข้อมูลจึงจะนำเข้าได้</span>
            </div>
          ) : (
            <>
              <div className="p-3 bg-neutral-50 border border-neutral-200 rounded-sm text-[13px] text-neutral-600 flex items-start gap-2 font-sans">
                <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-neutral-700" />
                <span>
                  ข้อมูลที่นำเข้าจะถูกบันทึกเป็นสถานะ &ldquo;อนุมัติแล้ว&rdquo; ทันที
                  เพราะถือว่าผ่านการตรวจสอบจากต้นทางมาแล้ว
                  หากต้องการให้ผ่านคิวตรวจสอบ ให้ใช้เมนู AI สกัดข่าวหรือรอระบบดึงข่าวอัตโนมัติแทน
                </span>
              </div>

              <label className="block">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.json,text/csv,application/json"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <span className="w-full flex items-center justify-center gap-2 px-4 py-8 border border-dashed border-neutral-300 hover:border-neutral-400 rounded-sm cursor-pointer transition-colors text-xs text-neutral-600 hover:text-neutral-800 font-sans">
                  <Upload className="w-4 h-4" />
                  เลือกไฟล์ CSV หรือ JSON
                </span>
              </label>
            </>
          )}

          {importSuccessMsg && (
            <div className="p-3 bg-neutral-100 border border-neutral-300 rounded-sm text-[13px] text-neutral-800 flex items-start gap-2 font-sans">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{importSuccessMsg}</span>
            </div>
          )}

          {importErrors.length > 0 && (
            <div className="p-3 bg-neutral-100 border border-red-200 rounded-sm text-[13px] text-red-700 space-y-1 max-h-52 overflow-y-auto">
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertCircle className="w-3.5 h-3.5" />
                คำเตือนจากการตรวจสอบ {importErrors.length} รายการ
              </div>
              <ul className="list-disc list-inside space-y-0.5 text-neutral-600 font-sans">
                {importErrors.slice(0, 50).map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
