import React, { useState } from 'react';
import { CrimeIncident, validateIncident } from '../types/dataDictionary';
import { 
  X, 
  ExternalLink, 
  Copy, 
  Check, 
  Edit3, 
  MapPin,  
  User, 
  Wine, 
  ShieldAlert, 
  Users, 
  FileText,
  AlertCircle,
  CheckCircle2
} from 'lucide-react';

interface IncidentDetailModalProps {
  incident: CrimeIncident | null;
  onClose: () => void;
  /** ไม่ส่งมาเมื่อผู้ใช้ไม่มีสิทธิ์แก้ไข */
  onEdit?: (incident: CrimeIncident) => void;
}

export const IncidentDetailModal: React.FC<IncidentDetailModalProps> = ({
  incident,
  onClose,
  onEdit,
}) => {
  const [copied, setCopied] = useState(false);

  if (!incident) return null;

  const validation = validateIncident(incident);

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(incident, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const urls = incident.url ? incident.url.split(';').map((u) => u.trim()).filter(Boolean) : [];
  const agencies = incident.news_agency ? incident.news_agency.split(';').map((a) => a.trim()).filter(Boolean) : [];

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white border border-neutral-200 rounded-sm w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden my-auto">
        {/* Modal Header */}
        <div className="bg-neutral-50 px-6 py-4 border-b border-neutral-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <span className="px-2.5 py-1 rounded-sm text-xs font-mono font-bold bg-neutral-100 text-neutral-700 border border-neutral-200">
              #{incident.id}
            </span>
            <div>
              <h2 className="text-base font-serif italic text-neutral-900 line-clamp-1">
                {incident.news_title}
              </h2>
              <div className="flex items-center gap-2 mt-0.5 font-mono text-[13px]">
                <span className="text-neutral-700 font-semibold">
                  {incident.news_type || 'ไม่ระบุประเภทข่าว'}
                </span>
                <span className="text-neutral-600">•</span>
                <span className="text-neutral-600">
                  {incident.incident_date || 'ไม่ระบุวันที่'} {incident.incident_time ? `เวลา ${incident.incident_time} น.` : ''}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyJson}
              className="p-2 text-neutral-600 hover:text-white hover:bg-neutral-100 rounded-sm transition-colors text-xs flex items-center gap-1.5"
              title="คัดลอกข้อมูล JSON (49 ฟิลด์)"
            >
              {copied ? <Check className="w-4 h-4 text-neutral-900" /> : <Copy className="w-4 h-4" />}
            </button>
            {onEdit && (
              <button
                onClick={() => {
                  onClose();
                  onEdit(incident);
                }}
                className="p-2 text-neutral-600 hover:text-neutral-800 hover:bg-neutral-100 rounded-sm transition-colors text-xs flex items-center gap-1.5"
                title="แก้ไขข้อมูล"
              >
                <Edit3 className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 text-neutral-600 hover:text-white hover:bg-neutral-100 rounded-sm transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Scrollable Content */}
        <div className="p-6 overflow-y-auto space-y-6 text-xs text-neutral-700">
          {/* Validation Status Notice */}
          <div className="flex items-center justify-between p-3.5 rounded-sm bg-neutral-50 border border-neutral-200 font-mono">
            <div className="flex items-center gap-2">
              {validation.isValid ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-neutral-900" />
                  <span className="font-semibold text-neutral-900">ข้อมูลครบตามเกณฑ์</span>
                </>
              ) : (
                <>
                  <AlertCircle className="w-4 h-4 text-red-700" />
                  <span className="font-semibold text-red-700">
                    SCHEMA WARNINGS ({Object.keys(validation.errors).length}):{' '}
                    {Object.values(validation.errors).join(', ')}
                  </span>
                </>
              )}
            </div>
            <span className="text-xs  text-neutral-600">เหตุการณ์</span>
          </div>

          {/* Section 1: News Meta */}
          <div className="bg-neutral-50 p-4 rounded-sm border border-neutral-200 space-y-3">
            <h3 className="text-xs font-mono font-bold  text-neutral-800 flex items-center gap-2">
              <FileText className="w-4 h-4 text-neutral-600" />
              1. Source & Metadata (Fields 1 - 5)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-neutral-600 block text-xs font-mono ">News Headline (news_title):</span>
                <p className="font-medium text-neutral-900 mt-0.5 font-sans">{incident.news_title}</p>
              </div>
              <div>
                <span className="text-neutral-600 block text-xs font-mono ">Press Agency (news_agency):</span>
                <div className="flex flex-wrap gap-1.5 mt-1 font-mono">
                  {agencies.map((a, i) => (
                    <span key={i} className="bg-neutral-100 text-neutral-700 border border-neutral-200 px-2 py-0.5 rounded-sm text-[13px]">
                      {a}
                    </span>
                  ))}
                </div>
              </div>
              <div className="md:col-span-2">
                <span className="text-neutral-600 block text-xs font-mono ">ลิงก์ข่าว</span>
                <div className="space-y-1 mt-1 font-mono">
                  {urls.map((u, i) => (
                    <a
                      key={i}
                      href={u}
                      target="_blank"
                      rel="noreferrer"
                      className="text-neutral-600 hover:text-neutral-800 underline flex items-center gap-1 break-all"
                    >
                      <ExternalLink className="w-3 h-3 shrink-0" />
                      <span>{u}</span>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Location & Time */}
          <div className="bg-neutral-50 p-4 rounded-sm border border-neutral-200 space-y-3">
            <h3 className="text-xs font-mono font-bold  text-neutral-800 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-neutral-600" />
              2. Temporal & Geospatial (Fields 6 - 12)
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <span className="text-neutral-600 block text-xs font-mono ">Date (incident_date):</span>
                <span className="text-neutral-800 font-mono">{incident.incident_date || '-'}</span>
              </div>
              <div>
                <span className="text-neutral-600 block text-xs font-mono ">Time (incident_time):</span>
                <span className="text-neutral-800 font-mono">{incident.incident_time || '-'}</span>
              </div>
              <div>
                <span className="text-neutral-600 block text-xs font-mono ">จังหวัด</span>
                <span className="text-neutral-800">{incident.province || '-'}</span>
              </div>
              <div>
                <span className="text-neutral-600 block text-xs font-mono ">อำเภอ / ตำบล</span>
                <span className="text-neutral-800">
                  {incident.district || '-'} / {incident.sub_district || '-'}
                </span>
              </div>
              <div className="col-span-2 sm:col-span-4">
                <span className="text-neutral-600 block text-xs font-mono ">Location (incident_location):</span>
                <span className="text-neutral-800">{incident.incident_location || '-'}</span>
                {incident.location_other && (
                  <span className="text-neutral-600 ml-2">({incident.location_other})</span>
                )}
              </div>
            </div>
          </div>

          {/* Section 3 & 4: Perpetrator, Alcohol & Drugs */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Perpetrator */}
            <div className="bg-neutral-50 p-4 rounded-sm border border-neutral-200 space-y-3">
              <h3 className="text-xs font-mono font-bold  text-neutral-800 flex items-center gap-2">
                <User className="w-4 h-4 text-neutral-600" />
                3. Perpetrator (Fields 13 - 18)
              </h3>
              <div className="space-y-2">
                <div>
                  <span className="text-neutral-600 block text-xs font-mono ">Name (perpetrator_name):</span>
                  <span className="font-medium text-neutral-900">{incident.perpetrator_name || 'ไม่ระบุชื่อ'}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-neutral-600 block text-xs font-mono ">เพศ / อายุ</span>
                    <span className="text-neutral-700 font-mono">
                      {incident.perpetrator_gender || '-'} / {incident.perpetrator_age ? `${incident.perpetrator_age}y` : '-'}
                    </span>
                  </div>
                  <div>
                    <span className="text-neutral-600 block text-xs font-mono ">อาชีพ</span>
                    <span className="text-neutral-700">
                      {incident.perpetrator_occupation || '-'} {incident.perpetrator_occupation_detail ? `(${incident.perpetrator_occupation_detail})` : ''}
                    </span>
                  </div>
                </div>
                <div>
                  <span className="text-neutral-600 block text-xs font-mono ">Weapon (perpetrator_weapon):</span>
                  <span className="text-neutral-800 font-mono">{incident.perpetrator_weapon || 'ไม่ระบุ'}</span>
                </div>
              </div>
            </div>

            {/* Alcohol & Drugs */}
            <div className="bg-neutral-50 p-4 rounded-sm border border-neutral-200 space-y-3">
              <h3 className="text-xs font-mono font-bold  text-neutral-800 flex items-center gap-2">
                <Wine className="w-4 h-4 text-neutral-600" />
                4. Substances (Fields 19 - 26)
              </h3>
              <div className="space-y-2 font-mono">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-neutral-600 block text-xs ">วิธีตรวจแอลกอฮอล์</span>
                    <span className="text-neutral-700">{incident.alcohol_test_method || '-'}</span>
                  </div>
                  <div>
                    <span className="text-neutral-600 block text-xs ">ระดับแอลกอฮอล์</span>
                    <span className="text-neutral-900 font-bold">
                      {incident.alcohol_level !== null && incident.alcohol_level !== undefined
                        ? `${incident.alcohol_level} mg%`
                        : incident.alcohol_test_method === 'สังเกตุอาการ'
                        ? 'สังเกตุอาการ (Null)'
                        : '-'}
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-neutral-600 block text-xs ">เครื่องดื่ม / สถานที่ดื่ม</span>
                    <span className="text-neutral-700 font-sans">
                      {incident.beverage_type || '-'} {incident.drinking_location ? `(${incident.drinking_location})` : ''}
                    </span>
                  </div>
                  <div>
                    <span className="text-neutral-600 block text-xs ">ระยะเวลาถึงเวลาตรวจ</span>
                    <span className="text-neutral-700">
                      {incident.test_duration ? `${incident.test_duration} min` : '-'}
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-neutral-200">
                  <div>
                    <span className="text-neutral-600 block text-xs ">กระทำผิดซ้ำ</span>
                    <span className="text-neutral-700">{incident.recidivism || '-'}</span>
                  </div>
                  <div>
                    <span className="text-neutral-600 block text-xs ">ใช้สารเสพติด</span>
                    <span className="text-neutral-700">
                      {incident.drug_use || '-'} {incident.drug_use_detail ? `(${incident.drug_use_detail})` : ''}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Section 5: Damage & Casualties */}
          <div className="bg-neutral-50 p-4 rounded-sm border border-neutral-200 space-y-3">
            <h3 className="text-xs font-mono font-bold  text-neutral-800 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-red-700" />
              5. Casualties & Impact (Fields 27 - 30)
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono">
              <div className="bg-neutral-50 p-3 rounded-sm border border-neutral-200">
                <span className="text-xs text-neutral-600 block ">ผู้ได้รับผลกระทบ</span>
                <span className="text-base font-bold text-neutral-900">{incident.total_affected || 0}</span>
              </div>
              <div className="bg-neutral-50 p-3 rounded-sm border border-neutral-200">
                <span className="text-xs text-red-700 block ">ผู้เสียชีวิต</span>
                <span className="text-base font-bold text-red-700">{incident.total_death || 0}</span>
              </div>
              <div className="bg-neutral-50 p-3 rounded-sm border border-neutral-200">
                <span className="text-xs text-red-700 block ">ผู้บาดเจ็บ</span>
                <span className="text-base font-bold text-red-700">{incident.total_injury || 0}</span>
              </div>
              <div className="bg-neutral-50 p-3 rounded-sm border border-neutral-200">
                <span className="text-xs text-neutral-600 block ">ทรัพย์สินสาธารณะ</span>
                <span className="text-xs text-neutral-700 font-sans line-clamp-1">{incident.public_property_damage || '-'}</span>
              </div>
            </div>
          </div>

          {/* Section 6: Victims 1, 2, 3 */}
          <div className="bg-neutral-50 p-4 rounded-sm border border-neutral-200 space-y-3">
            <h3 className="text-xs font-mono font-bold  text-neutral-800 flex items-center gap-2">
              <Users className="w-4 h-4 text-neutral-600" />
              6. Victim Profiles (Fields 31 - 48)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Victim 1 */}
              <div className="p-3.5 bg-neutral-50 rounded-sm border border-neutral-200 space-y-1 text-xs">
                <div className="font-mono font-bold text-neutral-800 text-xs mb-1">ผู้เสียหายรายที่ 1</div>
                <div>ชื่อ: <span className="text-neutral-800">{incident.victim_1_name || '-'}</span></div>
                <div className="font-mono text-[13px] text-neutral-600">เพศ: {incident.victim_1_gender || '-'} | อายุ: {incident.victim_1_age ? `${incident.victim_1_age} ปี` : '-'}</div>
                <div className="text-neutral-600 text-[13px]">อาชีพ: {incident.victim_1_occupation || '-'}</div>
                <div className="text-neutral-700 text-[13px]">บาดเจ็บ: <span className="text-neutral-900">{incident.victim_1_injury_type || '-'}</span></div>
                <div className="text-neutral-600 text-xs">สัมพันธ์: {incident.victim_1_relation_to_perpetrator || '-'}</div>
              </div>

              {/* Victim 2 */}
              <div className="p-3.5 bg-neutral-50 rounded-sm border border-neutral-200 space-y-1 text-xs">
                <div className="font-mono font-bold text-neutral-800 text-xs mb-1">ผู้เสียหายรายที่ 2</div>
                <div>ชื่อ: <span className="text-neutral-800">{incident.victim_2_name || '-'}</span></div>
                <div className="font-mono text-[13px] text-neutral-600">เพศ: {incident.victim_2_gender || '-'} | อายุ: {incident.victim_2_age ? `${incident.victim_2_age} ปี` : '-'}</div>
                <div className="text-neutral-600 text-[13px]">อาชีพ: {incident.victim_2_occupation || '-'}</div>
                <div className="text-neutral-700 text-[13px]">บาดเจ็บ: <span className="text-neutral-900">{incident.victim_2_injury_type || '-'}</span></div>
                <div className="text-neutral-600 text-xs">สัมพันธ์: {incident.victim_2_relation_to_perpetrator || '-'}</div>
              </div>

              {/* Victim 3 */}
              <div className="p-3.5 bg-neutral-50 rounded-sm border border-neutral-200 space-y-1 text-xs">
                <div className="font-mono font-bold text-neutral-800 text-xs mb-1">ผู้เสียหายรายที่ 3</div>
                <div>ชื่อ: <span className="text-neutral-800">{incident.victim_3_name || '-'}</span></div>
                <div className="font-mono text-[13px] text-neutral-600">เพศ: {incident.victim_3_gender || '-'} | อายุ: {incident.victim_3_age ? `${incident.victim_3_age} ปี` : '-'}</div>
                <div className="text-neutral-600 text-[13px]">อาชีพ: {incident.victim_3_occupation || '-'}</div>
                <div className="text-neutral-700 text-[13px]">บาดเจ็บ: <span className="text-neutral-900">{incident.victim_3_injury_type || '-'}</span></div>
                <div className="text-neutral-600 text-xs">สัมพันธ์: {incident.victim_3_relation_to_perpetrator || '-'}</div>
              </div>
            </div>
          </div>

          {/* Section 7: News Summary */}
          <div className="bg-neutral-50 p-4 rounded-sm border border-neutral-200 space-y-2">
            <h3 className="text-xs font-mono font-bold  text-neutral-800">
              7. Forensic Summary (Field 49: news_summary)
            </h3>
            <p className="text-xs text-neutral-700 leading-relaxed bg-neutral-50 p-3.5 rounded-sm border border-neutral-200 font-sans">
              {incident.news_summary}
            </p>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="bg-neutral-50 px-6 py-3.5 border-t border-neutral-200 flex items-center justify-between shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-mono text-neutral-600 hover:text-neutral-800 bg-neutral-100 hover:bg-neutral-200 border border-neutral-200 rounded-sm transition-colors"
          >
            DISMISS
          </button>

          {onEdit && (
            <button
              onClick={() => {
                onClose();
                onEdit(incident);
              }}
              className="px-4 py-2 text-xs font-mono font-bold  text-white bg-neutral-900 hover:bg-black rounded-sm transition-all flex items-center gap-1.5 shadow-sm"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>แก้ไขข้อมูล</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
