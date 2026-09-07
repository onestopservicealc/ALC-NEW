import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Edit3,
  FileText,
  Layers,
  Link2,
  MapPin,
  RefreshCw,
  Save,
  ShieldAlert,
  Sparkles,
  User,
  Wine,
  XCircle,
} from 'lucide-react';
import { CrimeIncident, validateIncident } from '../types/dataDictionary';
import { SAMPLE_PRESETS } from '../data/sampleNews';
import { callApi } from '../lib/supabase';

interface AiNewsParserProps {
  onSaveExtracted: (data: CrimeIncident) => void;
  onOpenInForm: (data: CrimeIncident) => void;
}

interface ScreeningResult {
  is_alcohol_related: boolean;
  alcohol_role: string | null;
  is_violence_or_accident: boolean;
  confidence: number;
  reason: string;
}

interface ExtractResponse {
  success: boolean;
  screening: ScreeningResult;
  data: (CrimeIncident & { alcohol_involved?: boolean; alcohol_role?: string | null }) | null;
  normalization?: { adjusted: string[]; unmapped: { field: string; original: string }[] };
  model?: string;
  message?: string;
  existing?: { seq: number; status: string; news_title: string } | null;
}

type InputMode = 'text' | 'url';

export const AiNewsParser: React.FC<AiNewsParserProps> = ({ onSaveExtracted, onOpenInForm }) => {
  const [mode, setMode] = useState<InputMode>('text');
  const [newsText, setNewsText] = useState('');
  const [newsUrl, setNewsUrl] = useState('');
  const [newsAgency, setNewsAgency] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractResponse | null>(null);

  const handleExtract = async () => {
    if (mode === 'text' && newsText.trim().length < 50) {
      setError('กรุณากรอกเนื้อหาข่าวภาษาไทยอย่างน้อย 50 ตัวอักษร');
      return;
    }
    if (mode === 'url' && !/^https?:\/\//i.test(newsUrl.trim())) {
      setError('กรุณากรอก URL ข่าวที่ขึ้นต้นด้วย http:// หรือ https://');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response =
        mode === 'url'
          ? await callApi<ExtractResponse>('/api/ai/extract-url', {
              url: newsUrl.trim(),
              newsAgency: newsAgency.trim() || undefined,
            })
          : await callApi<ExtractResponse>('/api/ai/extract-news', {
              newsText,
              url: newsUrl.trim() || undefined,
              newsAgency: newsAgency.trim() || undefined,
            });
      setResult(response);
    } catch (err: any) {
      setError(err?.message ?? 'เกิดข้อผิดพลาดในการสกัดข้อมูล');
    } finally {
      setLoading(false);
    }
  };

  const loadSample = (id: string) => {
    const preset = SAMPLE_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setMode('text');
    setNewsText(preset.text);
    setNewsAgency(preset.agency);
    setNewsUrl(preset.url);
    setError(null);
    setResult(null);
  };

  const extracted = result?.data ?? null;

  return (
    <div className="space-y-6">
      {/* หัวข้อ */}
      <div className="bg-white border border-neutral-200 rounded-sm p-6 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-sm bg-neutral-100 border border-neutral-300 text-neutral-900 shadow-sm">
            <Sparkles className="w-5 h-5 text-red-700" />
          </div>
          <div>
            <span className="text-xs  font-mono uppercase text-neutral-600">
              Neural forensic NLP
            </span>
            <h2 className="font-serif text-2xl text-neutral-900 italic tracking-wide">
              สกัดข่าวเป็น 49 ฟิลด์ด้วย AI
            </h2>
            <p className="text-xs text-neutral-600 mt-1 font-sans">
              วางลิงก์ข่าวหรือเนื้อข่าวภาษาไทย ระบบจะคัดกรองว่าเกี่ยวข้องกับแอลกอฮอล์หรือไม่
              แล้วแปลงเป็นโครงสร้าง 49 ฟิลด์ พร้อมดัดค่าให้ตรง Controlled Vocabulary อัตโนมัติ
            </p>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-neutral-200 flex flex-wrap items-center gap-2">
          <span className="text-xs tracking-wider uppercase font-mono text-neutral-600 mr-1">
            ตัวอย่างข่าว:
          </span>
          {SAMPLE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => loadSample(preset.id)}
              className="text-xs bg-neutral-50 hover:bg-neutral-100 text-neutral-700 border border-neutral-200 px-3 py-1.5 rounded-sm transition-colors font-sans"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ---- อินพุต ---- */}
        <div className="bg-white border border-neutral-200 rounded-sm p-6 space-y-4 shadow-xl flex flex-col">
          <div className="flex gap-1.5">
            <ModeButton active={mode === 'text'} onClick={() => setMode('text')} icon={FileText}>
              วางเนื้อข่าว
            </ModeButton>
            <ModeButton active={mode === 'url'} onClick={() => setMode('url')} icon={Link2}>
              วางลิงก์ข่าว
            </ModeButton>
          </div>

          {mode === 'text' ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold font-mono  text-neutral-700">
                  เนื้อหาข่าวภาษาไทย
                </label>
                <span className="text-xs font-mono text-neutral-600">{newsText.length} ตัวอักษร</span>
              </div>
              <textarea
                rows={14}
                value={newsText}
                onChange={(e) => setNewsText(e.target.value)}
                placeholder="วางเนื้อหาข่าวอุบัติเหตุเมาขับ ทะเลาะวิวาทหลังดื่มสุรา หรือความรุนแรงที่เกี่ยวข้องกับแอลกอฮอล์ที่นี่..."
                className="w-full bg-neutral-50 border border-neutral-200 rounded-sm p-3.5 text-xs text-neutral-900 placeholder-neutral-400 focus:outline-none focus:border-neutral-400 leading-relaxed font-sans"
              />
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-xs font-semibold font-mono  text-neutral-700">
                ลิงก์ข่าวจากเว็บสำนักข่าว
              </label>
              <p className="text-[13px] text-neutral-600 font-sans leading-relaxed">
                ระบบจะเปิดหน้าเว็บ ดึงเนื้อข่าวออกมา แล้วสกัดให้อัตโนมัติ —
                ใช้ลิงก์ Google News ไม่ได้เพราะถูกเข้ารหัสไว้
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs uppercase font-mono tracking-wider text-neutral-600 mb-1">
                สำนักข่าว (news_agency)
              </label>
              <input
                type="text"
                value={newsAgency}
                onChange={(e) => setNewsAgency(e.target.value)}
                className="w-full bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-1.5 text-xs text-neutral-800 focus:outline-none focus:border-neutral-400 font-sans"
                placeholder="เช่น ไทยรัฐออนไลน์"
              />
            </div>
            <div>
              <label className="block text-xs uppercase font-mono tracking-wider text-neutral-600 mb-1">
                ลิงก์ข่าว (url) {mode === 'url' && <span className="text-red-700">*</span>}
              </label>
              <input
                type="url"
                value={newsUrl}
                onChange={(e) => setNewsUrl(e.target.value)}
                className="w-full bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-1.5 text-xs text-neutral-800 focus:outline-none focus:border-neutral-400 font-mono"
                placeholder="https://..."
              />
            </div>
          </div>

          {error && (
            <div className="p-3 bg-neutral-100 border border-red-200 rounded-sm text-xs text-red-700 flex items-start gap-2 font-sans">
              <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="pt-4 mt-auto border-t border-neutral-200 flex items-center justify-between">
            <button
              onClick={() => {
                setNewsText('');
                setNewsUrl('');
                setResult(null);
                setError(null);
              }}
              className="text-xs text-neutral-600 hover:text-neutral-700 px-3 py-2 font-mono"
            >
              ล้างข้อมูล
            </button>

            <button
              onClick={() => void handleExtract()}
              disabled={loading || (mode === 'text' ? !newsText.trim() : !newsUrl.trim())}
              className="px-5 py-2.5 rounded-sm bg-neutral-900 hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-mono font-bold  transition-all shadow-md flex items-center gap-2"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>กำลังประมวลผล...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>คัดกรองและสกัด 49 ฟิลด์</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* ---- ผลลัพธ์ ---- */}
        <div className="bg-white border border-neutral-200 rounded-sm p-6 flex flex-col shadow-xl">
          {!result ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 text-neutral-600 space-y-3 min-h-[300px]">
              <div className="w-12 h-12 rounded-sm bg-neutral-100 border border-neutral-200 flex items-center justify-center text-neutral-600">
                <Layers className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-serif text-base text-neutral-700">พร้อมประมวลผล</h3>
                <p className="text-xs text-neutral-600 mt-1 max-w-sm font-sans">
                  วางเนื้อข่าวหรือลิงก์ทางด้านซ้าย หรือเลือกตัวอย่างข่าวด้านบน
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* ผลการคัดกรอง */}
              <ScreeningBanner screening={result.screening} />

              {result.existing && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-sm text-[13px] text-red-700 font-sans">
                  มีข่าวจากลิงก์นี้ในระบบแล้ว — เคส #{result.existing.seq} (สถานะ{' '}
                  {result.existing.status})
                </div>
              )}

              {!extracted ? (
                <div className="p-4 bg-neutral-50 border border-neutral-200 rounded-sm text-xs text-neutral-600 font-sans">
                  {result.message ?? 'ข่าวนี้ไม่เข้าเกณฑ์ จึงไม่ได้สกัดข้อมูล'}
                </div>
              ) : (
                <>
                  {result.normalization && result.normalization.adjusted.length > 0 && (
                    <div className="p-3 bg-neutral-100 border border-neutral-200 rounded-sm text-[13px] text-neutral-600 font-sans">
                      <span className="text-neutral-800 font-semibold">
                        ระบบดัดค่า {result.normalization.adjusted.length} ฟิลด์ให้ตรงรายการที่กำหนด:
                      </span>{' '}
                      <span className="font-mono text-xs">
                        {result.normalization.adjusted.join(', ')}
                      </span>
                    </div>
                  )}

                  <div className="flex items-center justify-between pb-3 border-b border-neutral-200">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-neutral-900" />
                      <h3 className="text-xs font-mono font-bold  text-neutral-900">
                        สกัดครบ 49 ฟิลด์แล้ว
                      </h3>
                    </div>
                    {(() => {
                      const validation = validateIncident(extracted);
                      return validation.isValid ? (
                        <span className="text-neutral-900 flex items-center gap-1 text-xs font-mono font-semibold">
                          <CheckCircle2 className="w-3.5 h-3.5" /> ผ่านการตรวจสอบ
                        </span>
                      ) : (
                        <span className="text-red-700 flex items-center gap-1 text-xs font-mono font-semibold">
                          <AlertCircle className="w-3.5 h-3.5" />{' '}
                          {Object.keys(validation.errors).length} ฟิลด์ต้องแก้
                        </span>
                      );
                    })()}
                  </div>

                  <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1 text-xs">
                    <Card label="พาดหัวและประเภท">
                      <div className="font-semibold text-neutral-900 font-sans">{extracted.news_title}</div>
                      <div className="flex items-center gap-2 mt-2 font-mono">
                        <span className="bg-neutral-100 text-neutral-700 border border-neutral-300 px-2 py-0.5 rounded-sm text-xs">
                          {extracted.news_type || 'ไม่ระบุประเภท'}
                        </span>
                        <span className="text-neutral-600 text-[13px]">
                          {extracted.incident_date || 'ไม่ระบุวัน'} |{' '}
                          {extracted.incident_time || 'ไม่ระบุเวลา'}
                        </span>
                      </div>
                    </Card>

                    <Card label="สถานที่เกิดเหตุ" icon={MapPin}>
                      <div className="text-neutral-800">
                        จ.{extracted.province || '-'} อ.{extracted.district || '-'} ต.
                        {extracted.sub_district || '-'}
                      </div>
                      <div className="text-neutral-600 text-[13px] mt-0.5">
                        ประเภทสถานที่:{' '}
                        <span className="text-neutral-800">{extracted.incident_location || '-'}</span>
                        {extracted.location_other && ` (${extracted.location_other})`}
                      </div>
                    </Card>

                    <div className="bg-neutral-50 p-3.5 rounded-sm border border-neutral-200 grid grid-cols-2 gap-3">
                      <div>
                        <Label icon={User}>ผู้ก่อเหตุ</Label>
                        <div className="font-medium text-neutral-900">
                          {extracted.perpetrator_name || 'ไม่ระบุชื่อ'}
                        </div>
                        <div className="text-neutral-600 text-[13px] font-mono">
                          {extracted.perpetrator_gender || '-'} ·{' '}
                          {extracted.perpetrator_age ? `${extracted.perpetrator_age} ปี` : 'ไม่ทราบอายุ'}
                        </div>
                        <div className="text-neutral-600 text-[13px] font-mono">
                          อาวุธ: <span className="text-neutral-800">{extracted.perpetrator_weapon || '-'}</span>
                        </div>
                      </div>
                      <div>
                        <Label icon={Wine}>แอลกอฮอล์</Label>
                        <div className="text-neutral-700 font-mono text-[13px]">
                          {extracted.alcohol_test_method || 'ไม่ระบุวิธีตรวจ'}
                        </div>
                        <div className="text-neutral-800 text-[13px] font-mono font-semibold">
                          {extracted.alcohol_level !== null
                            ? `${extracted.alcohol_level} mg%`
                            : 'ไม่มีผลตรวจเป็นตัวเลข'}
                        </div>
                        <div className="text-neutral-600 text-[13px] font-mono">
                          ยาเสพติด: {extracted.drug_use || 'ไม่ใช่'}
                          {extracted.drug_use_detail ? ` (${extracted.drug_use_detail})` : ''}
                        </div>
                      </div>
                    </div>

                    <Card label="ผู้ได้รับผลกระทบ" icon={ShieldAlert}>
                      <div className="flex items-center gap-4 text-xs font-mono font-semibold">
                        <span className="text-red-700">เสียชีวิต {extracted.total_death ?? 0}</span>
                        <span className="text-red-700">บาดเจ็บ {extracted.total_injury ?? 0}</span>
                        <span className="text-neutral-600">ได้รับผลกระทบ {extracted.total_affected ?? 0}</span>
                      </div>
                      {[1, 2, 3].map((n) => {
                        const name = (extracted as any)[`victim_${n}_name`];
                        if (!name) return null;
                        return (
                          <div key={n} className="mt-1.5 text-[13px] text-neutral-700">
                            • เหยื่อ {n}: {name} ({(extracted as any)[`victim_${n}_gender`] || '-'},{' '}
                            {(extracted as any)[`victim_${n}_age`]
                              ? `${(extracted as any)[`victim_${n}_age`]} ปี`
                              : 'ไม่ระบุอายุ'}
                            ) — {(extracted as any)[`victim_${n}_injury_type`] || '-'}
                          </div>
                        );
                      })}
                      {extracted.public_property_damage && (
                        <div className="text-[13px] text-neutral-600 mt-1.5">
                          ทรัพย์สินสาธารณะ: {extracted.public_property_damage}
                        </div>
                      )}
                    </Card>

                    <Card label="สรุปข่าวโดยย่อ (ฟิลด์ที่ 49)">
                      <p className="text-neutral-700 text-xs leading-relaxed font-sans">
                        {extracted.news_summary}
                      </p>
                    </Card>
                  </div>

                  <div className="pt-4 border-t border-neutral-200 flex items-center justify-between gap-3">
                    <button
                      onClick={() => onOpenInForm(extracted)}
                      className="px-3.5 py-2 text-xs font-mono text-neutral-700 bg-neutral-50 hover:bg-neutral-100 border border-neutral-200 rounded-sm transition-colors flex items-center gap-1.5"
                    >
                      <Edit3 className="w-3.5 h-3.5 text-neutral-600" />
                      <span>ตรวจสอบในฟอร์ม</span>
                    </button>

                    <button
                      onClick={() => onSaveExtracted(extracted)}
                      className="px-4 py-2 text-xs font-mono font-bold  text-white bg-neutral-900 hover:bg-black rounded-sm transition-all flex items-center gap-1.5"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>บันทึกเข้าฐานข้อมูล</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */

const ScreeningBanner: React.FC<{ screening: ScreeningResult }> = ({ screening }) => {
  const inScope = screening.is_alcohol_related && screening.is_violence_or_accident;
  return (
    <div
      className={`p-3.5 rounded-sm border text-xs font-sans ${
        inScope
          ? 'bg-neutral-100 border-neutral-300 text-neutral-800'
          : 'bg-neutral-100 border-neutral-300 text-neutral-700'
      }`}
    >
      <div className="flex items-center gap-2 mb-1.5">
        {inScope ? (
          <CheckCircle2 className="w-4 h-4 text-neutral-900 shrink-0" />
        ) : (
          <XCircle className="w-4 h-4 text-neutral-600 shrink-0" />
        )}
        <span className="font-semibold">
          {inScope ? 'อยู่ในขอบเขตของระบบ' : 'ไม่อยู่ในขอบเขตของระบบ'}
        </span>
        <span className="ml-auto font-mono text-xs text-neutral-600">
          AI มั่นใจ {Math.round(screening.confidence * 100)}%
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        <Tag ok={screening.is_alcohol_related}>เกี่ยวข้องกับแอลกอฮอล์</Tag>
        <Tag ok={screening.is_violence_or_accident}>เป็นเหตุรุนแรง/อุบัติเหตุจริง</Tag>
        {screening.alcohol_role && (
          <span className="text-xs font-mono bg-neutral-100 border border-neutral-300 text-neutral-700 px-1.5 py-0.5 rounded-sm">
            {screening.alcohol_role}
          </span>
        )}
      </div>
      <p className="text-[13px] opacity-80 leading-relaxed">{screening.reason}</p>
    </div>
  );
};

const Tag: React.FC<{ ok: boolean; children: React.ReactNode }> = ({ ok, children }) => (
  <span
    className={`text-xs font-mono px-1.5 py-0.5 rounded-sm border ${
      ok
        ? 'bg-neutral-100 text-neutral-800 border-neutral-300'
        : 'bg-neutral-50 text-neutral-600 border-neutral-200'
    }`}
  >
    {ok ? '✓' : '✕'} {children}
  </span>
);

const Label: React.FC<{ icon?: React.ComponentType<{ className?: string }>; children: React.ReactNode }> = ({
  icon: Icon,
  children,
}) => (
  <span className="text-xs  font-mono text-neutral-600 mb-1 flex items-center gap-1">
    {Icon && <Icon className="w-3 h-3 text-neutral-600" />}
    {children}
  </span>
);

const Card: React.FC<{
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}> = ({ label, icon, children }) => (
  <div className="bg-neutral-50 p-3.5 rounded-sm border border-neutral-200">
    <Label icon={icon}>{label}</Label>
    {children}
  </div>
);

const ModeButton: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}> = ({ active, onClick, icon: Icon, children }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded-sm border transition-colors ${
      active
        ? 'bg-neutral-200 text-neutral-900 border-neutral-400'
        : 'bg-neutral-50 text-neutral-600 border-neutral-200 hover:text-neutral-700'
    }`}
  >
    <Icon className="w-3.5 h-3.5" />
    {children}
  </button>
);
