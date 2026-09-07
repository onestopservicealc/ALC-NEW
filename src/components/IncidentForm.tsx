import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  CrimeIncident, 
  NEWS_TYPES, 
  INCIDENT_LOCATIONS, 
  GENDERS, 
  YES_NO, 
  WEAPONS, 
  ALCOHOL_TEST_METHODS, 
  BEVERAGE_TYPES, 
  INJURY_TYPES,
  validateIncident 
} from '../types/dataDictionary';
import { THAI_PROVINCES } from '../data/thaiProvinces';
import { 
  Save, 
  AlertCircle, 
  CheckCircle2, 
  Newspaper,
  MapPin,
  User,
  Wine,
  ShieldAlert,
  Users,
  FileText
} from 'lucide-react';

interface IncidentFormProps {
  initialData: CrimeIncident;
  isEditing: boolean;
  onSave: (data: CrimeIncident) => void;
  onCancel: () => void;
  /** ข้อความบนปุ่มบันทึก (คิวตรวจสอบใช้คำว่า "บันทึกการแก้ไข") */
  saveLabel?: string;
  /** ฟิลด์ที่ระบบดัดค่าอัตโนมัติ — จะถูกไฮไลต์ให้ผู้ตรวจสอบสังเกต */
  highlightFields?: string[];
  /**
   * แจ้งค่าที่กรอกค้างอยู่ให้ผู้เรียกทราบทุกครั้งที่เปลี่ยน
   *
   * จำเป็นเพราะคิวตรวจสอบมีปุ่ม "อนุมัติ" อยู่นอกฟอร์ม เดิมปุ่มนั้นเปลี่ยนแค่สถานะ
   * ค่าที่ผู้ตรวจแก้ไว้แต่ยังไม่กดบันทึกจึงหายไปเงียบๆ ทั้งที่การแก้ค่าคือเนื้องานหลัก
   */
  onDraftChange?: (data: CrimeIncident, dirty: boolean) => void;
}

/**
 * ฟิลด์ไหนอยู่หมวดไหน
 *
 * ใช้สองที่: ทำจุดเตือนบนแท็บหมวด และกระโดดไปหมวดที่มีข้อผิดพลาดตอนกดบันทึก
 * เดิมการกระโดดใช้ if-else ไล่เช็คทีละกลุ่มซึ่งครอบไม่ครบทุกฟิลด์
 */
const SECTION_ORDER = [
  'news_meta', 'location_time', 'perpetrator', 'alcohol_drugs', 'impact', 'victims', 'summary',
];

const FIELD_SECTION: Record<string, string> = {
  id: 'news_meta', news_type: 'news_meta', url: 'news_meta', news_agency: 'news_meta', news_title: 'news_meta',

  incident_date: 'location_time', incident_time: 'location_time', province: 'location_time',
  district: 'location_time', sub_district: 'location_time', incident_location: 'location_time',
  location_other: 'location_time',

  perpetrator_name: 'perpetrator', perpetrator_gender: 'perpetrator', perpetrator_age: 'perpetrator',
  perpetrator_occupation: 'perpetrator', perpetrator_occupation_detail: 'perpetrator',
  perpetrator_weapon: 'perpetrator',

  alcohol_test_method: 'alcohol_drugs', alcohol_level: 'alcohol_drugs', drinking_location: 'alcohol_drugs',
  beverage_type: 'alcohol_drugs', test_duration: 'alcohol_drugs', recidivism: 'alcohol_drugs',
  drug_use: 'alcohol_drugs', drug_use_detail: 'alcohol_drugs',

  total_affected: 'impact', total_death: 'impact', total_injury: 'impact', public_property_damage: 'impact',

  news_summary: 'summary',
};

for (const n of [1, 2, 3]) {
  for (const f of ['name', 'gender', 'age', 'occupation', 'injury_type', 'relation_to_perpetrator']) {
    FIELD_SECTION[`victim_${n}_${f}`] = 'victims';
  }
}

/** คีย์ระบุ "ตัวเรคคอร์ด" ไม่ใช่ตัวอ็อบเจกต์ — ใช้ตัดสินว่าควร sync ค่าจากพาเรนต์ใหม่ไหม */
function recordKey(data: CrimeIncident): string {
  const uuid = (data as { uuid?: string }).uuid ?? '';
  return `${uuid}|${data.id ?? ''}`;
}

export const IncidentForm: React.FC<IncidentFormProps> = ({
  initialData,
  isEditing,
  onSave,
  onCancel,
  saveLabel,
  highlightFields,
  onDraftChange,
}) => {
  const [formData, setFormData] = useState<CrimeIncident>(initialData);
  const [activeSection, setActiveSection] = useState<string>('news_meta');
  const [submitted, setSubmitted] = useState(false);
  /** ข้อมูลจากเซิร์ฟเวอร์เปลี่ยนขณะมีค่าค้าง — ให้ผู้ใช้เลือกว่าจะทับหรือเก็บของตัวเองไว้ */
  const [incoming, setIncoming] = useState<CrimeIncident | null>(null);

  /** ค่าตั้งต้นที่ sync มาครั้งล่าสุด ใช้เทียบว่ามีการแก้ค้างอยู่ไหม */
  const baselineRef = useRef<string>(JSON.stringify(initialData));
  const dirty = JSON.stringify(formData) !== baselineRef.current;

  /**
   * sync ค่าจากพาเรนต์ **เมื่อเปลี่ยนเรคคอร์ด** เท่านั้น
   *
   * เดิม effect ผูกกับ `initialData` ซึ่งเป็นอ็อบเจกต์ พอพาเรนต์โหลดข้อมูลใหม่
   * (เช่นกดปุ่มรีเฟรช หรือ onRefresh หลังบันทึก) จะได้อ็อบเจกต์ใหม่ทุกครั้ง
   * effect จึงทับค่าที่ผู้ตรวจกรอกค้างไว้ทิ้งโดยไม่เตือน
   */
  const key = recordKey(initialData);
  const syncedKeyRef = useRef<string>(key);

  useEffect(() => {
    if (syncedKeyRef.current === key) return; // เรคคอร์ดเดิม — ไม่แตะค่าที่กรอกค้าง
    syncedKeyRef.current = key;
    baselineRef.current = JSON.stringify(initialData);
    setFormData(initialData);
    setSubmitted(false);
    setIncoming(null);
    setActiveSection('news_meta');
  }, [key, initialData]);

  // เรคคอร์ดเดิมแต่ข้อมูลฝั่งเซิร์ฟเวอร์เปลี่ยน: ไม่มีค่าค้างก็รับมาเลย ถ้ามีค่าค้างต้องถามก่อน
  useEffect(() => {
    if (syncedKeyRef.current !== key) return;
    const next = JSON.stringify(initialData);
    if (next === baselineRef.current) return;
    if (dirty) {
      setIncoming(initialData);
      return;
    }
    baselineRef.current = next;
    setFormData(initialData);
  }, [key, initialData, dirty]);

  const acceptIncoming = () => {
    if (!incoming) return;
    baselineRef.current = JSON.stringify(incoming);
    setFormData(incoming);
    setIncoming(null);
  };

  useEffect(() => {
    onDraftChange?.(formData, dirty);
  }, [formData, dirty, onDraftChange]);

  // Validation results in real-time
  const validation = validateIncident(formData);

  const updateField = (key: keyof CrimeIncident, value: any) => {
    setFormData((prev) => {
      const next = { ...prev, [key]: value };

      // Business Rule: if alcohol_test_method is 'สังเกตุอาการ', alcohol_level MUST be null
      if (key === 'alcohol_test_method' && value === 'สังเกตุอาการ') {
        next.alcohol_level = null;
      }

      return next;
    });
  };

  const handleNumberChange = (key: keyof CrimeIncident, rawVal: string, forbidZero = false) => {
    if (rawVal === '' || rawVal === null || rawVal === undefined) {
      updateField(key, null);
      return;
    }
    const num = parseInt(rawVal, 10);
    if (isNaN(num)) {
      updateField(key, null);
    } else {
      updateField(key, num);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);

    if (!validation.isValid) {
      // กระโดดไปหมวดแรกที่มีข้อผิดพลาด โดยใช้แผนที่ฟิลด์ชุดเดียวกับจุดเตือนบนแท็บ
      const order = SECTION_ORDER.filter((id) =>
        Object.keys(validation.errors).some((f) => FIELD_SECTION[f] === id)
      );
      if (order.length > 0) setActiveSection(order[0]);
      return;
    }

    baselineRef.current = JSON.stringify(formData);
    onSave(formData);
  };

  /**
   * แต่ละหมวดมีอะไรที่ผู้ตรวจต้องดูบ้าง
   *
   * ผู้ตรวจต้องกดเปิดทั้ง 7 หมวดทุกเคสเพื่อหาว่ามีอะไรผิด — จุดเตือนบนแท็บทำให้กดตรงจุดได้เลย
   */
  const sectionFlags = useMemo(() => {
    const flags: Record<string, { errors: number; adjusted: number }> = {};
    for (const field of Object.keys(validation.errors)) {
      const sec = FIELD_SECTION[field];
      if (!sec) continue;
      flags[sec] ??= { errors: 0, adjusted: 0 };
      flags[sec].errors++;
    }
    for (const field of highlightFields ?? []) {
      const sec = FIELD_SECTION[field];
      if (!sec) continue;
      flags[sec] ??= { errors: 0, adjusted: 0 };
      flags[sec].adjusted++;
    }
    return flags;
  }, [validation.errors, highlightFields]);

  const sections = [
    { id: 'news_meta', label: '1. ข้อมูลข่าว (5 ฟิลด์)', icon: Newspaper },
    { id: 'location_time', label: '2. วันเวลา & สถานที่ (7 ฟิลด์)', icon: MapPin },
    { id: 'perpetrator', label: '3. ผู้ก่อเหตุ (6 ฟิลด์)', icon: User },
    { id: 'alcohol_drugs', label: '4. แอลกอฮอล์ & สารเสพติด (8 ฟิลด์)', icon: Wine },
    { id: 'impact', label: '5. ความเสียหาย (4 ฟิลด์)', icon: ShieldAlert },
    { id: 'victims', label: '6. ผู้เสียหาย/เหยื่อ 1-3 (18 ฟิลด์)', icon: Users },
    { id: 'summary', label: '7. สรุปข่าว (1 ฟิลด์)', icon: FileText },
  ];

  return (
    <div className="bg-white border border-neutral-200 rounded-sm overflow-hidden shadow-2xl pb-6">
      {/* Form Header */}
      <div className="bg-neutral-50 px-6 py-4 border-b border-neutral-200 flex items-center justify-between">
        <div>
          <h2 className="text-base sm:text-lg font-serif italic text-neutral-900 flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-neutral-600" />
            {isEditing ? `แก้ไขข้อมูลเหตุการณ์ (ลำดับ #${formData.id})` : 'บันทึกเหตุการณ์ใหม่'}
          </h2>
          <p className="text-xs text-neutral-600 mt-0.5 font-mono">
            กรอกให้ครบตามที่กำหนด ระบบจะตรวจความถูกต้องให้ระหว่างพิมพ์
          </p>
        </div>

        <div className="flex items-center gap-2 font-mono">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-xs text-neutral-600 hover:text-neutral-800 bg-neutral-100 hover:bg-neutral-200 border border-neutral-200 rounded-sm transition-colors"
          >
            DISCARD
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="px-4 py-1.5 text-xs font-bold text-white bg-neutral-900 hover:bg-black rounded-sm transition-all flex items-center gap-1.5 shadow-sm"
          >
            <Save className="w-4 h-4" />
            <span>บันทึก</span>
          </button>
        </div>
      </div>

      {/* ข้อมูลฝั่งเซิร์ฟเวอร์เปลี่ยนขณะที่ยังมีค่าแก้ค้างอยู่ — ห้ามทับเงียบๆ */}
      {incoming && (
        <div className="mx-6 mt-4 p-3.5 bg-neutral-100 border border-neutral-300 rounded-sm text-xs text-neutral-800 flex items-start gap-2.5 font-sans">
          <AlertCircle className="w-4 h-4 text-neutral-700 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <span className="font-semibold">ข้อมูลเคสนี้ถูกอัปเดตจากที่อื่น</span>
            <p className="mt-0.5 text-neutral-600">
              ค่าที่คุณแก้ไว้ยังอยู่ครบและไม่ถูกทับ — จะใช้ของใหม่จากเซิร์ฟเวอร์แทนก็ได้
            </p>
            <button
              type="button"
              onClick={acceptIncoming}
              className="mt-2 text-[13px] font-mono bg-neutral-200 hover:bg-neutral-300 border border-neutral-300 px-2.5 py-1 rounded-sm"
            >
              ใช้ข้อมูลใหม่ (ทิ้งที่แก้ไว้)
            </button>
          </div>
        </div>
      )}

      {/* Validation Error Summary Bar */}
      {submitted && !validation.isValid && (
        <div className="mx-6 mt-4 p-3.5 bg-red-50 border border-red-200 rounded-sm text-xs text-red-700 flex items-start gap-2.5 font-mono">
          <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold ">ข้อมูลยังไม่ผ่านเกณฑ์ ({Object.keys(validation.errors).length}):</span>
            <ul className="list-disc list-inside mt-1 space-y-0.5 text-neutral-700">
              {Object.entries(validation.errors).map(([field, msg]) => (
                <li key={field}><span className="text-red-700 font-semibold">{field}:</span> {msg}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* ฟิลด์ที่ระบบดัดค่าให้อัตโนมัติ — ผู้ตรวจสอบควรดูซ้ำ */}
      {highlightFields && highlightFields.length > 0 && (
        <div className="mx-6 mt-4 p-3.5 bg-red-50 border border-red-200 rounded-sm text-xs text-red-700 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
          <div className="font-sans">
            <span className="font-semibold">ระบบดัดค่า {highlightFields.length} ฟิลด์ให้ตรงกับรายการที่กำหนด</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {highlightFields.map((field) => (
                <span key={field} className="font-mono text-xs bg-red-100 border border-red-200 px-1.5 py-0.5 rounded-sm">
                  {field}
                </span>
              ))}
            </div>
            <p className="mt-1.5 text-[13px] text-red-700/70">กรุณาตรวจสอบว่าค่าที่ระบบเลือกให้ตรงกับเนื้อข่าวจริง</p>
          </div>
        </div>
      )}

      {/* Section Tabs */}
      <div className="px-6 mt-4 border-b border-neutral-200 overflow-x-auto scrollbar-none flex space-x-2">
        {sections.map((sec) => {
          const Icon = sec.icon;
          const isActive = activeSection === sec.id;
          return (
            <button
              key={sec.id}
              type="button"
              onClick={() => setActiveSection(sec.id)}
              className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-mono border-b-2 whitespace-nowrap transition-colors ${
                isActive
                  ? 'border-neutral-900 text-neutral-900 font-semibold bg-neutral-50 rounded-t-sm'
                  : 'border-transparent text-neutral-600 hover:text-neutral-700'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{sec.label}</span>
              {/* จุดเตือน: แดง = ข้อมูลไม่ผ่านเกณฑ์ · เหลือง = ระบบดัดค่าไว้ ควรตรวจซ้ำ */}
              {/*
                ใช้แดงทั้งคู่เพราะทั้งสองกรณีคือ "ต้องดู" แต่แยกด้วยรูปทรง
                ทึบ = ข้อมูลไม่ผ่านเกณฑ์ (อนุมัติไม่ได้) · วงกลมกลวง = ระบบดัดค่าไว้ ควรตรวจซ้ำ
                แยกด้วยรูปทรงไม่ใช่แค่สี ผู้ใช้ที่ตาบอดสีจึงยังแยกออก
              */}
              {sectionFlags[sec.id]?.errors ? (
                <span
                  data-flag="error"
                  title={`มีข้อมูลไม่ผ่านเกณฑ์ ${sectionFlags[sec.id].errors} ฟิลด์`}
                  className="w-2 h-2 rounded-full bg-red-600 shrink-0"
                />
              ) : sectionFlags[sec.id]?.adjusted ? (
                <span
                  data-flag="adjusted"
                  title={`ระบบดัดค่าไว้ ${sectionFlags[sec.id].adjusted} ฟิลด์ ควรตรวจซ้ำ`}
                  className="w-2 h-2 rounded-full border-2 border-red-500 shrink-0"
                />
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Form Body */}
      <form onSubmit={handleSubmit} className="p-6 space-y-6">
        {/* SECTION 1: News Meta */}
        {activeSection === 'news_meta' && (
          <div className="space-y-4">
            <h3 className="text-xs font-mono font-bold  text-neutral-800 flex items-center gap-1.5 pb-2 border-b border-neutral-200">
              <Newspaper className="w-4 h-4 text-neutral-600" />
              หมวด 1: ข้อมูลข่าวและแหล่งที่มา (ฟิลด์ที่ 1 - 5)
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* 1. id */}
              <div>
                <label className="block text-xs font-mono  text-neutral-700 mb-1.5">
                  1. ลำดับ (id) <span className="text-red-700" title="ต้องกรอก">*</span>
                </label>
                <input
                  type="number"
                  value={formData.id ?? ''}
                  onChange={(e) => handleNumberChange('id', e.target.value)}
                  className={`w-full bg-neutral-50 border ${
                    submitted && validation.errors['id'] ? 'border-red-500' : 'border-neutral-200'
                  } rounded-sm px-3 py-2 text-xs text-neutral-900 font-mono focus:outline-none focus:border-neutral-400`}
                  placeholder="เช่น 1"
                  required
                />
                {validation.errors['id'] && (
                  <p className="text-[13px] text-red-700 mt-1 font-mono">{validation.errors['id']}</p>
                )}
              </div>

              {/* 2. news_type */}
              <div>
                <label className="block text-xs font-mono  text-neutral-700 mb-1.5">
                  2. ประเภทข่าว <span className="text-neutral-600 text-xs">เลือกจากรายการ</span>
                </label>
                <select
                  value={formData.news_type}
                  onChange={(e) => updateField('news_type', e.target.value)}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-2 text-xs text-neutral-900 font-mono focus:outline-none focus:border-neutral-400"
                >
                  <option value="">-- เลือกประเภทข่าว --</option>
                  {NEWS_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              {/* 3. url */}
              <div className="md:col-span-2">
                <label className="block text-xs font-mono  text-neutral-700 mb-1.5">
                  3. ลิงก์ <span className="text-red-700" title="ต้องกรอก">*</span>
                  <span className="text-[13px] text-neutral-600 font-normal ml-2">(มากกว่า 1 ใช้ ; คั่น)</span>
                </label>
                <input
                  type="text"
                  value={formData.url}
                  onChange={(e) => updateField('url', e.target.value)}
                  className={`w-full bg-neutral-50 border ${
                    submitted && validation.errors['url'] ? 'border-red-500' : 'border-neutral-200'
                  } rounded-sm px-3 py-2 text-xs text-neutral-900 font-mono focus:outline-none focus:border-neutral-400`}
                  placeholder="https://news.example.com/item1;https://news.example.com/item2"
                  required
                />
                {validation.errors['url'] && (
                  <p className="text-[13px] text-red-700 mt-1 font-mono">{validation.errors['url']}</p>
                )}
              </div>

              {/* 4. news_agency */}
              <div>
                <label className="block text-xs font-mono  text-neutral-700 mb-1.5">
                  4. สำนักข่าว <span className="text-red-700" title="ต้องกรอก">*</span>
                  <span className="text-[13px] text-neutral-600 font-normal ml-2">(มากกว่า 1 ใช้ ; คั่น)</span>
                </label>
                <input
                  type="text"
                  value={formData.news_agency}
                  onChange={(e) => updateField('news_agency', e.target.value)}
                  className={`w-full bg-neutral-50 border ${
                    submitted && validation.errors['news_agency'] ? 'border-red-500' : 'border-neutral-200'
                  } rounded-sm px-3 py-2 text-xs text-neutral-900 font-mono focus:outline-none focus:border-neutral-400`}
                  placeholder="ไทยรัฐ;ข่าวสด;ช่อง 3"
                  required
                />
                {validation.errors['news_agency'] && (
                  <p className="text-[13px] text-red-700 mt-1 font-mono">{validation.errors['news_agency']}</p>
                )}
              </div>

              {/* 5. news_title */}
              <div className="md:col-span-2">
                <label className="block text-xs font-mono  text-neutral-700 mb-1.5">
                  5. พาดหัวข่าว <span className="text-red-700" title="ต้องกรอก">*</span>
                  <span className="text-[13px] text-neutral-600 font-normal ml-2">(มากกว่า 1 ใช้ ; คั่น)</span>
                </label>
                <textarea
                  rows={2}
                  value={formData.news_title}
                  onChange={(e) => updateField('news_title', e.target.value)}
                  className={`w-full bg-neutral-50 border ${
                    submitted && validation.errors['news_title'] ? 'border-red-500' : 'border-neutral-200'
                  } rounded-sm px-3 py-2 text-xs text-neutral-900 focus:outline-none focus:border-neutral-400 leading-relaxed`}
                  placeholder="พาดหัวข่าวตามที่ปรากฏในสื่อ..."
                  required
                />
                {validation.errors['news_title'] && (
                  <p className="text-[13px] text-red-700 mt-1 font-mono">{validation.errors['news_title']}</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* SECTION 2: Location & Time */}
        {activeSection === 'location_time' && (
          <div className="space-y-4">
            <h3 className="text-xs font-mono font-bold  text-neutral-800 flex items-center gap-1.5 pb-2 border-b border-neutral-200">
              <MapPin className="w-4 h-4 text-neutral-600" />
              หมวด 2: วันเวลาและสถานที่เกิดเหตุ (ฟิลด์ที่ 6 - 12)
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* 6. incident_date */}
              <div>
                <label className="block text-xs font-mono  text-neutral-700 mb-1.5">
                  6. วันที่เกิดเหตุ (incident_date)
                </label>
                <input
                  type="date"
                  value={formData.incident_date || ''}
                  onChange={(e) => updateField('incident_date', e.target.value)}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-2 text-xs text-neutral-900 font-mono focus:outline-none focus:border-neutral-400"
                />
              </div>

              {/* 7. incident_time */}
              <div>
                <label className="block text-xs font-mono  text-neutral-700 mb-1.5">
                  7. เวลาเกิดเหตุ (incident_time)
                </label>
                <input
                  type="time"
                  value={formData.incident_time || ''}
                  onChange={(e) => updateField('incident_time', e.target.value)}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-2 text-xs text-neutral-900 font-mono focus:outline-none focus:border-neutral-400"
                />
              </div>

              {/* 8. province */}
              <div>
                <label className="block text-xs font-mono  text-neutral-700 mb-1.5">
                  8. จังหวัด (province)
                </label>
                <select
                  value={formData.province || ''}
                  onChange={(e) => updateField('province', e.target.value)}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-2 text-xs text-neutral-900 focus:outline-none focus:border-neutral-400"
                >
                  <option value="">-- เลือกจังหวัด --</option>
                  {THAI_PROVINCES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>

              {/* 9. district */}
              <div>
                <label className="block text-xs font-mono  text-neutral-700 mb-1.5">
                  9. อำเภอ (district)
                </label>
                <input
                  type="text"
                  value={formData.district || ''}
                  onChange={(e) => updateField('district', e.target.value)}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-2 text-xs text-neutral-900 focus:outline-none focus:border-neutral-400"
                  placeholder="เช่น บางบัวทอง, เมือง"
                />
              </div>

              {/* 10. sub_district */}
              <div>
                <label className="block text-xs font-mono  text-neutral-700 mb-1.5">
                  10. ตำบล (sub_district)
                </label>
                <input
                  type="text"
                  value={formData.sub_district || ''}
                  onChange={(e) => updateField('sub_district', e.target.value)}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-2 text-xs text-neutral-900 focus:outline-none focus:border-neutral-400"
                  placeholder="เช่น ละหาร, ในเมือง"
                />
              </div>

              {/* 11. incident_location */}
              <div>
                <label className="block text-xs font-mono  text-neutral-700 mb-1.5">
                  11. สถานที่เกิดเหตุ <span className="text-neutral-600 text-xs">เลือกจากรายการ</span>
                </label>
                <select
                  value={formData.incident_location || ''}
                  onChange={(e) => updateField('incident_location', e.target.value)}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-2 text-xs text-neutral-900 focus:outline-none focus:border-neutral-400"
                >
                  <option value="">-- เลือกสถานที่ --</option>
                  {INCIDENT_LOCATIONS.map((loc) => (
                    <option key={loc} value={loc}>
                      {loc}
                    </option>
                  ))}
                </select>
              </div>

              {/* 12. location_other */}
              <div className="md:col-span-3">
                <label className="block text-xs font-mono  text-neutral-700 mb-1.5">
                  12. สถานที่เกิดเหตุ: อื่นๆ ระบุ (location_other)
                </label>
                <input
                  type="text"
                  value={formData.location_other || ''}
                  onChange={(e) => updateField('location_other', e.target.value)}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-2 text-xs text-neutral-900 focus:outline-none focus:border-neutral-400"
                  placeholder="กรณีเลือก 'อื่นๆ' ให้ระบุรายละเอียดสถานที่..."
                />
              </div>
            </div>
          </div>
        )}

        {/* SECTION 3: Perpetrator Profile */}
        {activeSection === 'perpetrator' && (
          <div className="space-y-4">
            <h3 className="text-xs font-mono font-bold  text-neutral-800 flex items-center gap-1.5 pb-2 border-b border-neutral-200">
              <User className="w-4 h-4 text-neutral-600" />
              หมวด 3: ข้อมูลผู้ก่อเหตุ (ฟิลด์ที่ 13 - 18)
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* 13. perpetrator_name */}
              <div>
                <label className="block text-xs font-mono  text-neutral-700 mb-1.5">
                  13. ผู้ก่อเหตุ : ชื่อ - สกุล (perpetrator_name)
                </label>
                <input
                  type="text"
                  value={formData.perpetrator_name || ''}
                  onChange={(e) => updateField('perpetrator_name', e.target.value)}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-2 text-xs text-neutral-900 focus:outline-none focus:border-neutral-400"
                  placeholder="เช่น นายสมชาย ใจกล้า"
                />
              </div>

              {/* 14. perpetrator_gender */}
              <div>
                <label className="block text-xs font-mono  text-neutral-700 mb-1.5">
                  14. ผู้ก่อเหตุ : เพศ (perpetrator_gender)
                </label>
                <select
                  value={formData.perpetrator_gender || ''}
                  onChange={(e) => updateField('perpetrator_gender', e.target.value)}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-2 text-xs text-neutral-900 focus:outline-none focus:border-neutral-400"
                >
                  <option value="">-- เลือกเพศ --</option>
                  {GENDERS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>

              {/* 15. perpetrator_age */}
              <div>
                <label className="block text-xs font-mono  text-neutral-700 mb-1.5">
                  15. ผู้ก่อเหตุ : อายุ
                  <span className="text-[13px] text-red-700 font-normal ml-2">⚠️ ไม่ทราบให้เว้นว่าง ห้ามใส่ 0</span>
                </label>
                <input
                  type="number"
                  min="1"
                  max="120"
                  value={formData.perpetrator_age ?? ''}
                  onChange={(e) => handleNumberChange('perpetrator_age', e.target.value, true)}
                  className={`w-full bg-neutral-50 border ${
                    validation.errors['perpetrator_age'] ? 'border-red-500' : 'border-neutral-200'
                  } rounded-sm px-3 py-2 text-xs text-neutral-900 font-mono focus:outline-none focus:border-neutral-400`}
                  placeholder="ระบุเป็นปี (เว้นว่างถ้าไม่ทราบ)"
                />
                {validation.errors['perpetrator_age'] && (
                  <p className="text-[13px] text-red-700 mt-1 font-mono">{validation.errors['perpetrator_age']}</p>
                )}
              </div>

              {/* 16. perpetrator_occupation */}
              <div>
                <label className="block text-xs font-mono  text-neutral-700 mb-1.5">
                  16. ผู้ก่อเหตุ : ประกอบอาชีพ (perpetrator_occupation)
                </label>
                <select
                  value={formData.perpetrator_occupation || ''}
                  onChange={(e) => updateField('perpetrator_occupation', e.target.value)}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-2 text-xs text-neutral-900 focus:outline-none focus:border-neutral-400"
                >
                  <option value="">-- เลือก --</option>
                  {YES_NO.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>

              {/* 17. perpetrator_occupation_detail */}
              <div>
                <label className="block text-xs font-mono  text-neutral-700 mb-1.5">
                  17. อาชีพผู้ก่อเหตุ: ระบุ (perpetrator_occupation_detail)
                </label>
                <input
                  type="text"
                  value={formData.perpetrator_occupation_detail || ''}
                  onChange={(e) => updateField('perpetrator_occupation_detail', e.target.value)}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-2 text-xs text-neutral-900 focus:outline-none focus:border-neutral-400"
                  placeholder="เช่น พนักงานขับรถ, ช่างซ่อม"
                />
              </div>

              {/* 18. perpetrator_weapon */}
              <div>
                <label className="block text-xs font-mono  text-neutral-700 mb-1.5">
                  18. ผู้ก่อเหตุ : อาวุธ <span className="text-neutral-600 text-xs">เลือกจากรายการ</span>
                </label>
                <select
                  value={formData.perpetrator_weapon || ''}
                  onChange={(e) => updateField('perpetrator_weapon', e.target.value)}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-2 text-xs text-neutral-900 focus:outline-none focus:border-neutral-400"
                >
                  <option value="">-- เลือกอาวุธ/ยานพาหนะ --</option>
                  {WEAPONS.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* SECTION 4: Alcohol & Substance Test */}
        {activeSection === 'alcohol_drugs' && (
          <div className="space-y-4">
            <h3 className="text-xs font-mono font-bold  text-neutral-800 flex items-center gap-1.5 pb-2 border-b border-neutral-200">
              <Wine className="w-4 h-4 text-neutral-600" />
              หมวด 4: การตรวจแอลกอฮอล์และสารเสพติด (ฟิลด์ที่ 19 - 26)
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* 19. alcohol_test_method */}
              <div>
                <label className="block text-xs font-mono  text-neutral-700 mb-1.5">
                  19. วิธีตรวจแอลกอฮอล์ (alcohol_test_method)
                </label>
                <select
                  value={formData.alcohol_test_method || ''}
                  onChange={(e) => updateField('alcohol_test_method', e.target.value)}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-2 text-xs text-neutral-900 focus:outline-none focus:border-neutral-400"
                >
                  <option value="">-- เลือกวิธีตรวจ --</option>
                  {ALCOHOL_TEST_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              {/* 20. alcohol_level */}
              <div>
                <label className="block text-xs font-mono  text-neutral-700 mb-1.5">
                  20. ระดับแอลกอฮอล์ที่ตรวจได้ (mg%) (alcohol_level)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    max="600"
                    disabled={formData.alcohol_test_method === 'สังเกตุอาการ'}
                    value={formData.alcohol_level ?? ''}
                    onChange={(e) => handleNumberChange('alcohol_level', e.target.value)}
                    className={`w-full bg-neutral-50 border ${
                      validation.errors['alcohol_level'] ? 'border-red-500' : 'border-neutral-200'
                    } rounded-sm px-3 py-2 text-xs text-neutral-900 font-mono focus:outline-none focus:border-neutral-400 disabled:opacity-30 disabled:cursor-not-allowed`}
                    placeholder={
                      formData.alcohol_test_method === 'สังเกตุอาการ'
                        ? 'ปิดใช้งาน (เมื่อเลือกสังเกตุอาการ ต้องเว้นว่าง)'
                        : 'หน่วย mg% เช่น 185'
                    }
                  />
                </div>
                {formData.alcohol_test_method === 'สังเกตุอาการ' ? (
                  <p className="text-[13px] text-red-700 mt-1 font-mono">
                    ℹ️ กฎ Data Dictionary: ต้องเว้นว่างเมื่อวิธีตรวจเป็น 'สังเกตุอาการ'
                  </p>
                ) : validation.errors['alcohol_level'] ? (
                  <p className="text-[13px] text-red-700 mt-1 font-mono">{validation.errors['alcohol_level']}</p>
                ) : null}
              </div>

              {/* 21. drinking_location */}
              <div>
                <label className="block text-xs font-mono  text-neutral-700 mb-1.5">
                  21. สถานที่ดื่มก่อนเกิดเหตุ (drinking_location)
                </label>
                <input
                  type="text"
                  value={formData.drinking_location || ''}
                  onChange={(e) => updateField('drinking_location', e.target.value)}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-2 text-xs text-neutral-900 focus:outline-none focus:border-neutral-400"
                  placeholder="เช่น ร้านคาราโอเกะ, บ้านเพื่อน, ลานเบียร์"
                />
              </div>

              {/* 22. beverage_type */}
              <div>
                <label className="block text-xs font-mono  text-neutral-700 mb-1.5">
                  22. ประเภทเครื่องดื่ม (beverage_type)
                </label>
                <select
                  value={formData.beverage_type || ''}
                  onChange={(e) => updateField('beverage_type', e.target.value)}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-2 text-xs text-neutral-900 focus:outline-none focus:border-neutral-400"
                >
                  <option value="">-- เลือกประเภทเครื่องดื่ม --</option>
                  {BEVERAGE_TYPES.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>

              {/* 23. test_duration */}
              <div>
                <label className="block text-xs font-mono  text-neutral-700 mb-1.5">
                  23. ระยะเวลาจากเกิดเหตุถึงเวลาตรวจ (นาที) (test_duration)
                </label>
                <input
                  type="number"
                  min="0"
                  value={formData.test_duration ?? ''}
                  onChange={(e) => handleNumberChange('test_duration', e.target.value)}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-2 text-xs text-neutral-900 font-mono focus:outline-none focus:border-neutral-400"
                  placeholder="จำนวนนาที นับจากเวลาเกิดเหตุ"
                />
              </div>

              {/* 24. recidivism */}
              <div>
                <label className="block text-xs font-mono  text-neutral-700 mb-1.5">
                  24. กระทำความผิดซ้ำ (recidivism)
                </label>
                <select
                  value={formData.recidivism || ''}
                  onChange={(e) => updateField('recidivism', e.target.value)}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-2 text-xs text-neutral-900 focus:outline-none focus:border-neutral-400"
                >
                  <option value="">-- เลือก --</option>
                  {YES_NO.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>

              {/* 25. drug_use */}
              <div>
                <label className="block text-xs font-mono  text-neutral-700 mb-1.5">
                  25. มีการใช้ยาเสพติด (drug_use)
                </label>
                <select
                  value={formData.drug_use || ''}
                  onChange={(e) => updateField('drug_use', e.target.value)}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-2 text-xs text-neutral-900 focus:outline-none focus:border-neutral-400"
                >
                  <option value="">-- เลือก --</option>
                  {YES_NO.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>

              {/* 26. drug_use_detail */}
              <div>
                <label className="block text-xs font-mono  text-neutral-700 mb-1.5">
                  26. มีการใช้ยาเสพติด: ระบุ
                  <span className="text-[13px] text-neutral-600 font-normal ml-2">(มากกว่า 1 ใช้ ; คั่น)</span>
                </label>
                <input
                  type="text"
                  value={formData.drug_use_detail || ''}
                  onChange={(e) => updateField('drug_use_detail', e.target.value)}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-2 text-xs text-neutral-900 focus:outline-none focus:border-neutral-400"
                  placeholder="เช่น ยาบ้า;กัญชา;ไอซ์"
                />
              </div>
            </div>
          </div>
        )}

        {/* SECTION 5: Impact & Casualties */}
        {activeSection === 'impact' && (
          <div className="space-y-4">
            <h3 className="text-xs font-mono font-bold  text-neutral-800 flex items-center gap-1.5 pb-2 border-b border-neutral-200">
              <ShieldAlert className="w-4 h-4 text-neutral-600" />
              หมวด 5: ความเสียหายและจำนวนผู้ได้รับผลกระทบ (ฟิลด์ที่ 27 - 30)
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* 27. total_affected */}
              <div>
                <label className="block text-xs font-mono  text-neutral-700 mb-1.5">
                  27. จำนวนผู้ได้รับผลกระทบ (total_affected)
                </label>
                <input
                  type="number"
                  min="0"
                  value={formData.total_affected ?? ''}
                  onChange={(e) => handleNumberChange('total_affected', e.target.value)}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-2 text-xs text-neutral-900 font-mono focus:outline-none focus:border-neutral-400"
                  placeholder="จำนวนคน"
                />
              </div>

              {/* 28. total_death */}
              <div>
                <label className="block text-xs font-mono  text-red-700 mb-1.5">
                  28. จำนวนผู้เสียชีวิต (total_death)
                </label>
                <input
                  type="number"
                  min="0"
                  value={formData.total_death ?? ''}
                  onChange={(e) => handleNumberChange('total_death', e.target.value)}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-2 text-xs text-neutral-900 font-mono focus:outline-none focus:border-neutral-400"
                  placeholder="จำนวนศพ/ผู้เสียชีวิต"
                />
              </div>

              {/* 29. total_injury */}
              <div>
                <label className="block text-xs font-mono  text-red-700 mb-1.5">
                  29. จำนวนผู้บาดเจ็บ (total_injury)
                </label>
                <input
                  type="number"
                  min="0"
                  value={formData.total_injury ?? ''}
                  onChange={(e) => handleNumberChange('total_injury', e.target.value)}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-2 text-xs text-neutral-900 font-mono focus:outline-none focus:border-neutral-400"
                  placeholder="จำนวนผู้บาดเจ็บ"
                />
              </div>

              {/* 30. public_property_damage */}
              <div className="md:col-span-3">
                <label className="block text-xs font-mono  text-neutral-700 mb-1.5">
                  30. ทรัพย์สินสาธารณะ
                  <span className="text-[13px] text-neutral-600 font-normal ml-2">(มากกว่า 1 ใช้ ; คั่น)</span>
                </label>
                <input
                  type="text"
                  value={formData.public_property_damage || ''}
                  onChange={(e) => updateField('public_property_damage', e.target.value)}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-2 text-xs text-neutral-900 focus:outline-none focus:border-neutral-400"
                  placeholder="เช่น เสาไฟฟ้า 1 ต้น;การ์ดเรล 5 เมตร;ป้ายบอกทาง 1 ป้าย"
                />
              </div>
            </div>
          </div>
        )}

        {/* SECTION 6: Victims Profiles 1, 2, 3 */}
        {activeSection === 'victims' && (
          <div className="space-y-6">
            <h3 className="text-xs font-mono font-bold  text-neutral-800 flex items-center gap-1.5 pb-2 border-b border-neutral-200">
              <Users className="w-4 h-4 text-neutral-600" />
              หมวด 6: ข้อมูลเหยื่อ / ผู้เสียหาย (ฟิลด์ที่ 31 - 48)
            </h3>

            {/* Victim 1 (Fields 31-36) */}
            <div className="p-4 bg-neutral-50 border border-neutral-200 rounded-sm space-y-3">
              <div className="text-xs font-mono font-bold  text-neutral-800 flex items-center gap-2">
                <span className="w-5 h-5 rounded-sm bg-neutral-200 text-neutral-700 border border-neutral-300 flex items-center justify-center text-xs">
                  01
                </span>
                <span>ผู้เสียหายรายที่ 1</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[13px] font-mono text-neutral-600 mb-1">31. ชื่อ - สกุล</label>
                  <input
                    type="text"
                    value={formData.victim_1_name || ''}
                    onChange={(e) => updateField('victim_1_name', e.target.value)}
                    className="w-full bg-neutral-100/80 border border-neutral-200 rounded-sm px-3 py-1.5 text-xs text-neutral-900 focus:outline-none focus:border-neutral-400"
                    placeholder="ชื่อผู้เสียหาย 1"
                  />
                </div>

                <div>
                  <label className="block text-[13px] font-mono text-neutral-600 mb-1">32. เพศ</label>
                  <select
                    value={formData.victim_1_gender || ''}
                    onChange={(e) => updateField('victim_1_gender', e.target.value)}
                    className="w-full bg-neutral-100/80 border border-neutral-200 rounded-sm px-3 py-1.5 text-xs text-neutral-900 focus:outline-none focus:border-neutral-400"
                  >
                    <option value="">-- เลือกเพศ --</option>
                    {GENDERS.map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[13px] font-mono text-neutral-600 mb-1">
                    33. อายุ (ปี) <span className="text-red-700 font-normal text-xs">(ไม่ทราบให้เว้นว่าง ห้ามใส่ 0)</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={formData.victim_1_age ?? ''}
                    onChange={(e) => handleNumberChange('victim_1_age', e.target.value, true)}
                    className={`w-full bg-neutral-100/80 border ${
                      validation.errors['victim_1_age'] ? 'border-red-500' : 'border-neutral-200'
                    } rounded-sm px-3 py-1.5 text-xs text-neutral-900 font-mono focus:outline-none focus:border-neutral-400`}
                    placeholder="อายุเหยื่อ 1"
                  />
                  {validation.errors['victim_1_age'] && (
                    <p className="text-xs text-red-700 mt-0.5 font-mono">{validation.errors['victim_1_age']}</p>
                  )}
                </div>

                <div>
                  <label className="block text-[13px] font-mono text-neutral-600 mb-1">34. อาชีพ</label>
                  <input
                    type="text"
                    value={formData.victim_1_occupation || ''}
                    onChange={(e) => updateField('victim_1_occupation', e.target.value)}
                    className="w-full bg-neutral-100/80 border border-neutral-200 rounded-sm px-3 py-1.5 text-xs text-neutral-900 focus:outline-none focus:border-neutral-400"
                    placeholder="อาชีพเหยื่อ 1"
                  />
                </div>

                <div>
                  <label className="block text-[13px] font-mono text-neutral-600 mb-1">35. ลักษณะบาดเจ็บ</label>
                  <select
                    value={formData.victim_1_injury_type || ''}
                    onChange={(e) => updateField('victim_1_injury_type', e.target.value)}
                    className="w-full bg-neutral-100/80 border border-neutral-200 rounded-sm px-3 py-1.5 text-xs text-neutral-900 focus:outline-none focus:border-neutral-400"
                  >
                    <option value="">-- เลือกลักษณะบาดเจ็บ --</option>
                    {INJURY_TYPES.map((it) => (
                      <option key={it} value={it}>{it}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[13px] font-mono text-neutral-600 mb-1">36. มีความสัมพันธ์กับคู่กรณี</label>
                  <select
                    value={formData.victim_1_relation_to_perpetrator || ''}
                    onChange={(e) => updateField('victim_1_relation_to_perpetrator', e.target.value)}
                    className="w-full bg-neutral-100/80 border border-neutral-200 rounded-sm px-3 py-1.5 text-xs text-neutral-900 focus:outline-none focus:border-neutral-400"
                  >
                    <option value="">-- เลือก --</option>
                    {YES_NO.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Victim 2 (Fields 37-42) */}
            <div className="p-4 bg-neutral-50 border border-neutral-200 rounded-sm space-y-3">
              <div className="text-xs font-mono font-bold  text-neutral-800 flex items-center gap-2">
                <span className="w-5 h-5 rounded-sm bg-neutral-200 text-neutral-700 border border-neutral-300 flex items-center justify-center text-xs">
                  02
                </span>
                <span>ผู้เสียหายรายที่ 2</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[13px] font-mono text-neutral-600 mb-1">37. ชื่อ - สกุล</label>
                  <input
                    type="text"
                    value={formData.victim_2_name || ''}
                    onChange={(e) => updateField('victim_2_name', e.target.value)}
                    className="w-full bg-neutral-100/80 border border-neutral-200 rounded-sm px-3 py-1.5 text-xs text-neutral-900 focus:outline-none focus:border-neutral-400"
                    placeholder="ชื่อผู้เสียหาย 2"
                  />
                </div>

                <div>
                  <label className="block text-[13px] font-mono text-neutral-600 mb-1">38. เพศ</label>
                  <select
                    value={formData.victim_2_gender || ''}
                    onChange={(e) => updateField('victim_2_gender', e.target.value)}
                    className="w-full bg-neutral-100/80 border border-neutral-200 rounded-sm px-3 py-1.5 text-xs text-neutral-900 focus:outline-none focus:border-neutral-400"
                  >
                    <option value="">-- เลือกเพศ --</option>
                    {GENDERS.map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[13px] font-mono text-neutral-600 mb-1">
                    39. อายุ (ปี) <span className="text-red-700 font-normal text-xs">(ไม่ทราบให้เว้นว่าง ห้ามใส่ 0)</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={formData.victim_2_age ?? ''}
                    onChange={(e) => handleNumberChange('victim_2_age', e.target.value, true)}
                    className={`w-full bg-neutral-100/80 border ${
                      validation.errors['victim_2_age'] ? 'border-red-500' : 'border-neutral-200'
                    } rounded-sm px-3 py-1.5 text-xs text-neutral-900 font-mono focus:outline-none focus:border-neutral-400`}
                    placeholder="อายุเหยื่อ 2"
                  />
                  {validation.errors['victim_2_age'] && (
                    <p className="text-xs text-red-700 mt-0.5 font-mono">{validation.errors['victim_2_age']}</p>
                  )}
                </div>

                <div>
                  <label className="block text-[13px] font-mono text-neutral-600 mb-1">40. อาชีพ</label>
                  <input
                    type="text"
                    value={formData.victim_2_occupation || ''}
                    onChange={(e) => updateField('victim_2_occupation', e.target.value)}
                    className="w-full bg-neutral-100/80 border border-neutral-200 rounded-sm px-3 py-1.5 text-xs text-neutral-900 focus:outline-none focus:border-neutral-400"
                    placeholder="อาชีพเหยื่อ 2"
                  />
                </div>

                <div>
                  <label className="block text-[13px] font-mono text-neutral-600 mb-1">41. ลักษณะบาดเจ็บ</label>
                  <select
                    value={formData.victim_2_injury_type || ''}
                    onChange={(e) => updateField('victim_2_injury_type', e.target.value)}
                    className="w-full bg-neutral-100/80 border border-neutral-200 rounded-sm px-3 py-1.5 text-xs text-neutral-900 focus:outline-none focus:border-neutral-400"
                  >
                    <option value="">-- เลือกลักษณะบาดเจ็บ --</option>
                    {INJURY_TYPES.map((it) => (
                      <option key={it} value={it}>{it}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[13px] font-mono text-neutral-600 mb-1">42. มีความสัมพันธ์กับคู่กรณี</label>
                  <select
                    value={formData.victim_2_relation_to_perpetrator || ''}
                    onChange={(e) => updateField('victim_2_relation_to_perpetrator', e.target.value)}
                    className="w-full bg-neutral-100/80 border border-neutral-200 rounded-sm px-3 py-1.5 text-xs text-neutral-900 focus:outline-none focus:border-neutral-400"
                  >
                    <option value="">-- เลือก --</option>
                    {YES_NO.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Victim 3 (Fields 43-48) */}
            <div className="p-4 bg-neutral-50 border border-neutral-200 rounded-sm space-y-3">
              <div className="text-xs font-mono font-bold  text-neutral-800 flex items-center gap-2">
                <span className="w-5 h-5 rounded-sm bg-neutral-200 text-neutral-700 border border-neutral-300 flex items-center justify-center text-xs">
                  03
                </span>
                <span>ผู้เสียหายรายที่ 3</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[13px] font-mono text-neutral-600 mb-1">43. ชื่อ - สกุล</label>
                  <input
                    type="text"
                    value={formData.victim_3_name || ''}
                    onChange={(e) => updateField('victim_3_name', e.target.value)}
                    className="w-full bg-neutral-100/80 border border-neutral-200 rounded-sm px-3 py-1.5 text-xs text-neutral-900 focus:outline-none focus:border-neutral-400"
                    placeholder="ชื่อผู้เสียหาย 3"
                  />
                </div>

                <div>
                  <label className="block text-[13px] font-mono text-neutral-600 mb-1">44. เพศ</label>
                  <select
                    value={formData.victim_3_gender || ''}
                    onChange={(e) => updateField('victim_3_gender', e.target.value)}
                    className="w-full bg-neutral-100/80 border border-neutral-200 rounded-sm px-3 py-1.5 text-xs text-neutral-900 focus:outline-none focus:border-neutral-400"
                  >
                    <option value="">-- เลือกเพศ --</option>
                    {GENDERS.map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[13px] font-mono text-neutral-600 mb-1">
                    45. อายุ (ปี) <span className="text-red-700 font-normal text-xs">(ไม่ทราบให้เว้นว่าง ห้ามใส่ 0)</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={formData.victim_3_age ?? ''}
                    onChange={(e) => handleNumberChange('victim_3_age', e.target.value, true)}
                    className={`w-full bg-neutral-100/80 border ${
                      validation.errors['victim_3_age'] ? 'border-red-500' : 'border-neutral-200'
                    } rounded-sm px-3 py-1.5 text-xs text-neutral-900 font-mono focus:outline-none focus:border-neutral-400`}
                    placeholder="อายุเหยื่อ 3"
                  />
                  {validation.errors['victim_3_age'] && (
                    <p className="text-xs text-red-700 mt-0.5 font-mono">{validation.errors['victim_3_age']}</p>
                  )}
                </div>

                <div>
                  <label className="block text-[13px] font-mono text-neutral-600 mb-1">46. อาชีพ</label>
                  <input
                    type="text"
                    value={formData.victim_3_occupation || ''}
                    onChange={(e) => updateField('victim_3_occupation', e.target.value)}
                    className="w-full bg-neutral-100/80 border border-neutral-200 rounded-sm px-3 py-1.5 text-xs text-neutral-900 focus:outline-none focus:border-neutral-400"
                    placeholder="อาชีพเหยื่อ 3"
                  />
                </div>

                <div>
                  <label className="block text-[13px] font-mono text-neutral-600 mb-1">47. ลักษณะบาดเจ็บ</label>
                  <select
                    value={formData.victim_3_injury_type || ''}
                    onChange={(e) => updateField('victim_3_injury_type', e.target.value)}
                    className="w-full bg-neutral-100/80 border border-neutral-200 rounded-sm px-3 py-1.5 text-xs text-neutral-900 focus:outline-none focus:border-neutral-400"
                  >
                    <option value="">-- เลือกลักษณะบาดเจ็บ --</option>
                    {INJURY_TYPES.map((it) => (
                      <option key={it} value={it}>{it}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[13px] font-mono text-neutral-600 mb-1">48. มีความสัมพันธ์กับคู่กรณี</label>
                  <select
                    value={formData.victim_3_relation_to_perpetrator || ''}
                    onChange={(e) => updateField('victim_3_relation_to_perpetrator', e.target.value)}
                    className="w-full bg-neutral-100/80 border border-neutral-200 rounded-sm px-3 py-1.5 text-xs text-neutral-900 focus:outline-none focus:border-neutral-400"
                  >
                    <option value="">-- เลือก --</option>
                    {YES_NO.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SECTION 7: News Summary */}
        {activeSection === 'summary' && (
          <div className="space-y-4">
            <h3 className="text-xs font-mono font-bold  text-neutral-800 flex items-center gap-1.5 pb-2 border-b border-neutral-200">
              <FileText className="w-4 h-4 text-neutral-600" />
              หมวด 7: สรุปข่าวโดยย่อ (ฟิลด์ที่ 49)
            </h3>

            <div>
              <label className="block text-xs font-mono  text-neutral-700 mb-1.5">
                49. สรุปข่าวโดยย่อ <span className="text-red-700" title="ต้องกรอก">*</span>
              </label>
              <textarea
                rows={5}
                value={formData.news_summary}
                onChange={(e) => updateField('news_summary', e.target.value)}
                className={`w-full bg-neutral-50 border ${
                  submitted && validation.errors['news_summary'] ? 'border-red-500' : 'border-neutral-200'
                } rounded-sm p-3 text-xs text-neutral-900 focus:outline-none focus:border-neutral-400 leading-relaxed`}
                placeholder="สรุปพฤติการณ์การก่อเหตุ ลำดับเหตุการณ์ ผลกระทบ และผลการตรวจทางนิติวิทยาศาสตร์/ตรวจวัดแอลกอฮอล์โดยย่อ..."
                required
              />
              {validation.errors['news_summary'] && (
                <p className="text-[13px] text-red-700 mt-1 font-mono">{validation.errors['news_summary']}</p>
              )}
            </div>
          </div>
        )}

        {/* Bottom Section Navigator and Save Button */}
        <div className="pt-4 border-t border-neutral-200 flex items-center justify-between font-mono">
          <div className="text-xs text-neutral-600">
            {validation.isValid ? (
              <span className="text-neutral-900 flex items-center gap-1 font-semibold">
                <CheckCircle2 className="w-4 h-4" /> VALID: 49-FIELD SCHEMA COMPLIANT
              </span>
            ) : (
              <span className="text-red-700 flex items-center gap-1">
                <AlertCircle className="w-4 h-4" /> ATTENTION: {Object.keys(validation.errors).length} INVALID FIELDS
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-xs font-mono text-neutral-600 hover:text-neutral-800 bg-neutral-100 hover:bg-neutral-200 border border-neutral-200 rounded-sm transition-colors"
            >
              DISCARD
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-xs font-mono font-bold  text-white bg-neutral-900 hover:bg-black rounded-sm transition-all flex items-center gap-1.5 shadow-sm"
            >
              <Save className="w-4 h-4" />
              <span>{saveLabel ?? (isEditing ? 'UPDATE INCIDENT' : 'COMMIT RECORD')}</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
