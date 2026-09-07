import React, { useState } from 'react';
import { DATA_DICTIONARY_FIELDS, CSV_HEADER_STRING } from '../types/dataDictionary';
import {  
  Search, 
  Copy, 
  Check, 
  Code, 
} from 'lucide-react';

/** หมวดหมู่ทั้งหมดดึงจากตัวสเปกเอง จะได้ไม่หลุดกันเมื่อสเปกเปลี่ยน */
const CATEGORY_OPTIONS = Array.from(
  new Map(DATA_DICTIONARY_FIELDS.map((f) => [f.category, f.categoryThai])).entries()
).map(([id, label]) => ({ id, label }));

export const DataDictionaryView: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [missingFilter, setMissingFilter] = useState<'ALL' | 'Not Null' | 'Null'>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [copied, setCopied] = useState(false);

  const filteredFields = DATA_DICTIONARY_FIELDS.filter((item) => {
    if (missingFilter !== 'ALL' && item.missing !== missingFilter) return false;
    if (typeFilter !== 'ALL' && item.dataType !== typeFilter) return false;
    if (categoryFilter !== 'ALL' && item.category !== categoryFilter) return false;

    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      const matchTh = item.fieldThai.toLowerCase().includes(q);
      const matchEn = item.fieldEnglish.toLowerCase().includes(q);
      const matchNotes = item.notes?.toLowerCase().includes(q);
      const matchNum = String(item.index) === q;
      const matchControlled = item.controlledVocab?.some((opt) => opt.toLowerCase().includes(q));

      if (!matchTh && !matchEn && !matchNotes && !matchNum && !matchControlled) {
        return false;
      }
    }
    return true;
  });

  const handleCopyCsvHeader = () => {
    navigator.clipboard.writeText(CSV_HEADER_STRING);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const notNullCount = DATA_DICTIONARY_FIELDS.filter((d) => d.missing === 'Not Null').length;
  const nullCount = DATA_DICTIONARY_FIELDS.filter((d) => d.missing === 'Null').length;

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header Card */}
      <div className="bg-white border border-neutral-200 rounded-sm p-6 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs  font-mono uppercase text-neutral-600">
                Specification Standard
              </span>
              <span className="w-1 h-1 rounded-full bg-neutral-300" />
              <span className="text-xs font-mono text-neutral-600">v1.0 Frozen</span>
            </div>
            <h2 className="font-serif text-2xl text-neutral-900 italic tracking-wide">
              Schema Definitions & Data Dictionary
            </h2>
            <p className="text-xs text-neutral-600 mt-1">
              พจนานุกรมโครงสร้างข้อมูล 49 ฟิลด์ (อ้างอิง Data Dictionary และ Sheet1) สำหรับจัดเก็บสถิติอาชญากรรม
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleCopyCsvHeader}
              className="inline-flex items-center gap-2 px-4 py-2 bg-neutral-900 hover:bg-black active:bg-neutral-800 text-white text-xs font-bold  rounded-sm transition-all shadow-sm"
              title="คัดลอก Header 49 คอลัมน์สำหรับ Sheet1/CSV"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-neutral-900 stroke-[2.5]" />
                  <span>Copied 49 Keys</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 stroke-[2]" />
                  <span>Copy Header String</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Quick Spec Metrics Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-5 border-t border-neutral-200/80">
          <div className="bg-neutral-50 p-4 rounded-sm border border-neutral-200">
            <span className="text-xs tracking-wider uppercase font-mono text-neutral-600 block">Total Fields</span>
            <span className="text-2xl font-serif text-neutral-900 font-medium mt-0.5 block">49 Metrics</span>
          </div>

          <div className="bg-neutral-50 p-4 rounded-sm border border-neutral-200">
            <span className="text-xs tracking-wider uppercase font-mono text-neutral-600 block">Constraint Status</span>
            <span className="text-2xl font-serif text-red-700 font-medium mt-0.5 block">{notNullCount} Not Null</span>
          </div>

          <div className="bg-neutral-50 p-4 rounded-sm border border-neutral-200">
            <span className="text-xs tracking-wider uppercase font-mono text-neutral-600 block">Nullable Keys</span>
            <span className="text-2xl font-serif text-neutral-600 font-medium mt-0.5 block">{nullCount} Fields</span>
          </div>

          <div className="bg-neutral-50 p-4 rounded-sm border border-neutral-200">
            <span className="text-xs tracking-wider uppercase font-mono text-neutral-600 block">Multi-Value Delimiter</span>
            <span className="text-2xl font-mono text-neutral-700 font-bold mt-0.5 block">Semicolon (;)</span>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white border border-neutral-200 rounded-sm p-4 flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-neutral-600" />
          <input
            type="text"
            placeholder="Search field, English key, notes..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-neutral-50 border border-neutral-200 rounded-sm pl-9 pr-3 py-1.5 text-xs text-neutral-800 placeholder-neutral-400 focus:outline-none focus:border-neutral-400 font-mono"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <select
            value={missingFilter}
            onChange={(e) => setMissingFilter(e.target.value as any)}
            className="bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-1.5 text-xs text-neutral-700 focus:outline-none focus:border-neutral-400 font-mono"
          >
            <option value="ALL">Nullability: All</option>
            <option value="Not Null">NOT NULL (Required)</option>
            <option value="Null">Null (Optional)</option>
          </select>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-1.5 text-xs text-neutral-700 focus:outline-none focus:border-neutral-400 font-mono"
          >
            <option value="ALL">Datatype: All</option>
            <option value="int">int (Integer)</option>
            <option value="str">str (Text)</option>
            <option value="date">date (Date YYYY-MM-DD)</option>
            <option value="time">time (Time HH:MM)</option>
          </select>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-1.5 text-xs text-neutral-700 focus:outline-none focus:border-neutral-400 font-mono"
          >
            <option value="ALL">หมวด: ทั้งหมด</option>
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Data Dictionary Table */}
      <div className="bg-white border border-neutral-200 rounded-sm overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="text-xs  text-neutral-600 border-b border-neutral-200 bg-neutral-50">
                <th className="py-3 px-3.5 w-12 text-center font-mono">#</th>
                <th className="py-3 px-3.5 min-w-[170px] font-medium">Logical Name (ภาษาไทย)</th>
                <th className="py-3 px-3.5 min-w-[180px] font-medium">System Key (English)</th>
                <th className="py-3 px-3.5 min-w-[90px] text-center font-medium">Datatype</th>
                <th className="py-3 px-3.5 min-w-[110px] text-center font-medium">Nullability</th>
                <th className="py-3 px-3.5 min-w-[240px] font-medium">Controlled Vocabulary</th>
                <th className="py-3 px-3.5 min-w-[230px] font-medium">Notes & Rules</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 text-neutral-700">
              {filteredFields.map((field) => (
                <tr key={field.index} className="hover:bg-white/[0.03] transition-colors">
                  {/* Field Number */}
                  <td className="py-3 px-3.5 text-center font-mono text-neutral-600 font-medium">
                    {field.index < 10 ? `0${field.index}` : field.index}
                  </td>

                  {/* Thai Name */}
                  <td className="py-3 px-3.5 font-medium text-neutral-800">
                    {field.fieldThai}
                  </td>

                  {/* English Key */}
                  <td className="py-3 px-3.5 font-mono text-neutral-700">
                    {field.fieldEnglish}
                  </td>

                  {/* Data Type */}
                  <td className="py-3 px-3.5 text-center font-mono">
                    <span className="inline-block px-2 py-0.5 rounded-sm text-xs uppercase font-mono bg-neutral-100 text-neutral-600 border border-neutral-200">
                      {field.dataType}
                    </span>
                  </td>

                  {/* Missing Rule */}
                  <td className="py-3 px-3.5 text-center">
                    {field.missing === 'Not Null' ? (
                      <span className="inline-block px-2 py-0.5 rounded-sm text-xs font-mono font-bold  bg-red-950/60 text-red-400 border border-red-900/60">
                        NOT NULL
                      </span>
                    ) : (
                      <span className="text-[13px] font-mono text-neutral-600">
                        Null
                      </span>
                    )}
                  </td>

                  {/* List Options */}
                  <td className="py-3 px-3.5">
                    {field.controlledVocab && field.controlledVocab.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {field.controlledVocab.map((opt) => (
                          <span
                            key={opt}
                            className="bg-neutral-100 text-neutral-600 px-1.5 py-0.5 rounded-sm text-xs border border-neutral-200"
                          >
                            {opt}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-neutral-600 font-mono text-[13px]">—</span>
                    )}
                  </td>

                  {/* Remarks & Business Rules */}
                  <td className="py-3 px-3.5 text-neutral-600 text-[13px] leading-relaxed italic">
                    {field.notes ? (
                      <span className={field.notes.includes('ห้ามใส่ 0') || field.notes.includes('Null') ? 'text-red-700/90 not-italic font-sans' : 'text-neutral-600'}>
                        {field.notes}
                      </span>
                    ) : (
                      <span className="text-neutral-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* CSV Column Mapping Box (Sheet1 Appendix) */}
      <div className="bg-white border border-neutral-200 rounded-sm p-5 space-y-3 shadow-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Code className="w-4 h-4 text-neutral-600" />
            <h4 className="text-xs uppercase font-bold text-neutral-600  font-mono">
              Header String Preview (Sheet1 CSV Schema Layout)
            </h4>
          </div>
          <span className="text-xs font-mono text-neutral-600">49 Tokens</span>
        </div>
        <div className="p-4 bg-neutral-50 rounded-sm border border-neutral-200 font-mono text-xs text-neutral-600 break-all leading-relaxed select-all">
          {CSV_HEADER_STRING}
        </div>
      </div>
    </div>
  );
};

