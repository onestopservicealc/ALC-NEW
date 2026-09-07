import React, { useState, useMemo } from 'react';
import { CrimeIncident, validateIncident } from '../types/dataDictionary';
import { exportToCSV, downloadFile } from '../utils/dataHelper';
import { 
  Search, 
  Download, 
  Eye, 
  Edit3, 
  Trash2, 
  Copy,  
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Wine,
  Pill,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

interface RecordListProps {
  incidents: CrimeIncident[];
  onViewIncident: (incident: CrimeIncident) => void;
  onEditIncident: (incident: CrimeIncident) => void;
  onDeleteIncident: (id: number) => void;
  onDuplicateIncident: (incident: CrimeIncident) => void;
  onNewIncident: () => void;
  /** true เมื่อผู้ใช้ไม่มีสิทธิ์แก้ไข — ซ่อนปุ่มแก้ไข/ลบ/คัดลอก */
  readOnly?: boolean;
}

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  pending: { label: 'รอตรวจสอบ', className: 'bg-red-50 text-red-700 border-red-200' },
  approved: { label: 'อนุมัติแล้ว', className: 'bg-neutral-100 text-neutral-800 border-neutral-300' },
  rejected: { label: 'ปฏิเสธแล้ว', className: 'bg-red-50 text-red-700 border-red-200' },
};

const StatusBadge: React.FC<{ status?: string }> = ({ status }) => {
  const style = status ? STATUS_STYLE[status] : undefined;
  if (!style) return <span className="text-xs font-mono text-neutral-600">—</span>;
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap px-2 py-0.5 rounded-sm text-xs border ${style.className}`}
    >
      {style.label}
    </span>
  );
};

export const RecordList: React.FC<RecordListProps> = ({
  incidents,
  onViewIncident,
  onEditIncident,
  onDeleteIncident,
  onDuplicateIncident,
  onNewIncident,
  readOnly = false,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [provinceFilter, setProvinceFilter] = useState('ALL');
  const [alcoholFilter, setAlcoholFilter] = useState('ALL');
  const [drugFilter, setDrugFilter] = useState('ALL');
  /** ตัวกรองสถานะ — จำเป็นเมื่อเจ้าหน้าที่เห็นทุกสถานะในตารางนี้ */
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 8;

  // Filter incidents
  const filteredIncidents = useMemo(() => {
    return incidents.filter((item) => {
      // Search term
      if (searchTerm) {
        const query = searchTerm.toLowerCase();
        const matchTitle = item.news_title?.toLowerCase().includes(query);
        const matchAgency = item.news_agency?.toLowerCase().includes(query);
        const matchSummary = item.news_summary?.toLowerCase().includes(query);
        const matchPerp = item.perpetrator_name?.toLowerCase().includes(query);
        const matchProvince = item.province?.toLowerCase().includes(query);
        const matchDistrict = item.district?.toLowerCase().includes(query);
        const matchVictim1 = item.victim_1_name?.toLowerCase().includes(query);
        const matchId = String(item.id) === query;

        if (
          !matchTitle &&
          !matchAgency &&
          !matchSummary &&
          !matchPerp &&
          !matchProvince &&
          !matchDistrict &&
          !matchVictim1 &&
          !matchId
        ) {
          return false;
        }
      }

      // Type filter
      if (typeFilter !== 'ALL' && item.news_type !== typeFilter) return false;
      // Province filter
      if (provinceFilter !== 'ALL' && item.province !== provinceFilter) return false;
      // Alcohol filter
      if (alcoholFilter === 'YES' && !item.alcohol_level && item.alcohol_test_method !== 'สังเกตุอาการ' && !item.drinking_location) return false;
      if (alcoholFilter === 'NO' && (item.alcohol_level || item.alcohol_test_method === 'สังเกตุอาการ' || item.drinking_location)) return false;
      // Drug filter
      if (drugFilter !== 'ALL' && item.drug_use !== drugFilter) return false;
      // Status filter
      if (statusFilter !== 'ALL' && (item as { status?: string }).status !== statusFilter) return false;

      return true;
    });
  }, [incidents, searchTerm, typeFilter, provinceFilter, alcoholFilter, drugFilter, statusFilter]);

  /** มีสถานะติดมาไหม — ผู้ไม่ล็อกอินอ่านผ่าน view ที่กรองเหลือเฉพาะที่อนุมัติแล้ว จึงไม่มี */
  const hasStatus = useMemo(
    () => incidents.some((i) => Boolean((i as { status?: string }).status)),
    [incidents]
  );

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = { pending: 0, approved: 0, rejected: 0 };
    for (const i of incidents) {
      const st = (i as { status?: string }).status;
      if (st && st in c) c[st]++;
    }
    return c;
  }, [incidents]);

  // Pagination
  const totalPages = Math.ceil(filteredIncidents.length / pageSize) || 1;
  // ชุดข้อมูลหดลงจนหน้าปัจจุบันเกินขอบ → ดึงกลับ ไม่งั้นตารางว่างทั้งที่มีข้อมูล
  const page = Math.min(currentPage, totalPages);
  const paginatedIncidents = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredIncidents.slice(start, start + pageSize);
  }, [filteredIncidents, page, pageSize]);

  const uniqueProvinces = useMemo(() => {
    return Array.from(new Set(incidents.map((i) => i.province).filter(Boolean))).sort();
  }, [incidents]);

  const handleExportFiltered = () => {
    const csvContent = exportToCSV(filteredIncidents);
    const dateStr = new Date().toISOString().split('T')[0];
    downloadFile(csvContent, `crime_data_dictionary_${dateStr}.csv`);
  };

  return (
    <div className="space-y-4">
      {/* Top Header and Actions */}
      <div className="bg-white border border-neutral-200 rounded-sm p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xl">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs  font-mono uppercase text-neutral-600">ฐานข้อมูล</span>
            <span className="w-1 h-1 rounded-full bg-neutral-300" />
            <span className="text-xs font-mono text-neutral-600">ข้อมูล 49 ฟิลด์ต่อเหตุการณ์</span>
          </div>
          <h2 className="font-serif text-2xl text-neutral-900 italic tracking-wide">
            ฐานข้อมูลเหตุการณ์
          </h2>
          <p className="text-xs text-neutral-600 mt-1 font-sans">
            รายการบันทึกเหตุการณ์ความรุนแรง {filteredIncidents.length} จากทั้งหมด {incidents.length} คดี
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={handleExportFiltered}
            className="inline-flex items-center space-x-1.5 bg-neutral-50 hover:bg-neutral-100 text-neutral-700 border border-neutral-200 px-3.5 py-2 rounded-sm text-xs font-mono transition-colors"
            title="ส่งออกตามมาตรฐาน 49 ฟิลด์พร้อม UTF-8 BOM สำหรับ Excel"
          >
            <Download className="w-3.5 h-3.5 text-neutral-600" />
            <span>ส่งออก CSV</span>
          </button>

          <button
            onClick={onNewIncident}
            className="inline-flex items-center space-x-1.5 bg-neutral-900 hover:bg-black text-white px-4 py-2 rounded-sm text-xs font-mono font-bold tracking-wider uppercase transition-all shadow-sm"
          >
            <span>+ เพิ่มเหตุการณ์</span>
          </button>
        </div>
      </div>

      {/* Search and Filters Filterbar */}
      <div className="bg-white border border-neutral-200 rounded-sm p-4 space-y-3 shadow-md">
        <div className="flex flex-col md:flex-row gap-3">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-neutral-600" />
            <input
              type="text"
              placeholder="ค้นหาพาดหัวข่าว จังหวัด สำนักข่าว หรือเลขลำดับหวัด, อำเภอ..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full bg-neutral-50 border border-neutral-200 rounded-sm pl-9 pr-4 py-2 text-xs text-neutral-900 placeholder-neutral-400 focus:outline-none focus:border-neutral-400 font-sans"
            />
          </div>

          {/* Type Filter */}
          <div className="w-full md:w-48">
            <select
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-2 text-xs text-neutral-700 focus:outline-none focus:border-neutral-400 font-mono"
            >
              <option value="ALL">ทุกประเภท</option>
              <option value="อุบัติเหตุเมาขับ">อุบัติเหตุเมาขับ</option>
              <option value="ทำร้ายร่างกายผู้อื่น">ทำร้ายร่างกายผู้อื่น</option>
              <option value="ทำร้ายตนเอง">ทำร้ายตนเอง</option>
              <option value="ข่มขืน ล่วงละเมิด">ข่มขืน ล่วงละเมิด</option>
              <option value="ทำลายทรัพย์สิน">ทำลายทรัพย์สิน</option>
            </select>
          </div>

          {/* Status Filter — เฉพาะเจ้าหน้าที่ที่เห็นทุกสถานะ */}
          {hasStatus && (
            <div className="w-full md:w-44">
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-2 text-xs text-neutral-700 focus:outline-none focus:border-neutral-400 font-sans"
              >
                <option value="ALL">ทุกสถานะ ({incidents.length})</option>
                <option value="pending">รอตรวจสอบ ({statusCounts.pending})</option>
                <option value="approved">อนุมัติแล้ว ({statusCounts.approved})</option>
                <option value="rejected">ปฏิเสธแล้ว ({statusCounts.rejected})</option>
              </select>
            </div>
          )}

          {/* Province Filter */}
          <div className="w-full md:w-40">
            <select
              value={provinceFilter}
              onChange={(e) => {
                setProvinceFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-2 text-xs text-neutral-700 focus:outline-none focus:border-neutral-400 font-mono"
            >
              <option value="ALL">ทุกจังหวัด</option>
              {uniqueProvinces.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          {/* Alcohol Filter */}
          <div className="w-full md:w-36">
            <select
              value={alcoholFilter}
              onChange={(e) => {
                setAlcoholFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-2 text-xs text-neutral-700 focus:outline-none focus:border-neutral-400 font-mono"
            >
              <option value="ALL">แอลกอฮอล์: ทั้งหมด</option>
              <option value="YES">มีแอลกอฮอล์</option>
              <option value="NO">ไม่มีแอลกอฮอล์</option>
            </select>
          </div>

          {/* Drug filter */}
          <div className="w-full md:w-36">
            <select
              value={drugFilter}
              onChange={(e) => {
                setDrugFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-2 text-xs text-neutral-700 focus:outline-none focus:border-neutral-400 font-mono"
            >
              <option value="ALL">สารเสพติด: ทั้งหมด</option>
              <option value="ใช่">มีสารเสพติด</option>
              <option value="ไม่ใช่">ไม่มีสารเสพติด</option>
            </select>
          </div>
        </div>
      </div>

      {/* Records Table */}
      <div className="bg-white border border-neutral-200 rounded-sm overflow-hidden shadow-xl">
        {/*
          จอแคบ: ตารางนี้กว้างเกิน 700px ต้องเลื่อนแนวนอนกว่าจะถึงปุ่มดูรายละเอียด
          เจ้าหน้าที่ภูมิภาคใช้มือถือ จึงเปลี่ยนเป็นการ์ดบนจอเล็ก
        */}
        <ul className="lg:hidden divide-y divide-neutral-200">
          {paginatedIncidents.length === 0 ? (
            <li className="py-12 text-center text-neutral-600 text-xs font-sans">
              ไม่พบรายการที่ตรงกับตัวกรอง
            </li>
          ) : (
            paginatedIncidents.map((incident) => (
              <li key={incident.id} className="p-4 space-y-2">
                <div className="flex items-start gap-2">
                  <span className="font-mono text-xs text-neutral-600 mt-0.5 shrink-0">
                    {String(incident.id).padStart(3, '0')}
                  </span>
                  <p className="text-xs text-neutral-900 font-sans leading-snug flex-1 min-w-0">
                    {incident.news_title || '(ไม่มีพาดหัว)'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-mono text-neutral-600 pl-7">
                  {hasStatus && <StatusBadge status={(incident as { status?: string }).status} />}
                  <span>{incident.news_agency || 'ไม่ทราบสำนัก'}</span>
                  {incident.incident_date && (
                    <>
                      <span>·</span>
                      <span>{incident.incident_date}</span>
                    </>
                  )}
                  {incident.province && (
                    <>
                      <span>·</span>
                      <span>{incident.province}</span>
                    </>
                  )}
                  {incident.total_death ? (
                    <>
                      <span>·</span>
                      <span className="text-red-700">เสียชีวิต {incident.total_death}</span>
                    </>
                  ) : null}
                  {incident.total_injury ? (
                    <>
                      <span>·</span>
                      <span className="text-red-700">บาดเจ็บ {incident.total_injury}</span>
                    </>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-2 pl-7 pt-0.5">
                  <button
                    onClick={() => onViewIncident(incident)}
                    className="text-[13px] font-mono text-neutral-800 border border-neutral-300 hover:bg-neutral-200 px-2.5 py-1.5 rounded-sm inline-flex items-center gap-1.5"
                  >
                    <Eye className="w-3 h-3" />
                    ดูรายละเอียด
                  </button>
                  {!readOnly && (
                    <button
                      onClick={() => onEditIncident(incident)}
                      className="text-[13px] font-mono text-neutral-600 hover:text-neutral-800 border border-neutral-200 px-2.5 py-1.5 rounded-sm inline-flex items-center gap-1.5"
                    >
                      <Edit3 className="w-3 h-3" />
                      แก้ไข
                    </button>
                  )}
                  {incident.url && (
                    <a
                      href={incident.url.split(';')[0]}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[13px] font-mono text-neutral-600 hover:text-neutral-800 inline-flex items-center gap-1"
                    >
                      ข่าวต้นทาง <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </li>
            ))
          )}
        </ul>

        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-neutral-50 text-neutral-600 border-b border-neutral-200  font-mono text-xs">
              <tr>
                <th className="py-3 px-3 w-12 text-center font-bold">ลำดับ</th>
                {hasStatus && <th className="py-3 px-3 min-w-[90px]">สถานะ</th>}
                <th className="py-3 px-3 min-w-[120px]">ประเภท</th>
                <th className="py-3 px-3 min-w-[240px]">พาดหัวข่าวและสำนักข่าว</th>
                <th className="py-3 px-3 min-w-[140px]">วันที่และสถานที่</th>
                <th className="py-3 px-3 min-w-[150px]">ผู้ก่อเหตุและอาวุธ</th>
                <th className="py-3 px-3 min-w-[130px]">แอลกอฮอล์ / สารเสพติด</th>
                <th className="py-3 px-3 min-w-[100px] text-center">ผู้เสียหาย</th>
                <th className="py-3 px-3 min-w-[90px] text-center">ความครบถ้วน</th>
                <th className="py-3 px-3 min-w-[120px] text-right">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 text-neutral-700">
              {paginatedIncidents.length === 0 ? (
                <tr>
                  <td colSpan={hasStatus ? 10 : 9} className="py-12 text-center text-neutral-600">
                    <p className="text-sm font-serif italic">ไม่พบข้อมูลที่ตรงกับเงื่อนไขการค้นหา</p>
                    <button
                      onClick={() => {
                        setSearchTerm('');
                        setTypeFilter('ALL');
                        setProvinceFilter('ALL');
                        setAlcoholFilter('ALL');
                        setDrugFilter('ALL');
                      }}
                      className="mt-2 text-xs text-neutral-600 underline hover:text-neutral-800 font-mono"
                    >
                      Clear all filters
                    </button>
                  </td>
                </tr>
              ) : (
                paginatedIncidents.map((incident) => {
                  const validation = validateIncident(incident);
                  return (
                    <tr key={incident.id} className="hover:bg-neutral-50 transition-colors">
                      {/* ID */}
                      <td className="py-3 px-3 text-center font-mono font-bold text-neutral-600">
                        {String(incident.id).padStart(3, '0')}
                      </td>

                      {/* สถานะการตรวจสอบ — ตารางนี้แสดงทุกสถานะให้เจ้าหน้าที่แล้ว */}
                      {hasStatus && (
                        <td className="py-3 px-3">
                          <StatusBadge status={(incident as { status?: string }).status} />
                        </td>
                      )}

                      {/* Crime Type */}
                      <td className="py-3 px-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-mono font-medium border ${
                            incident.news_type === 'อุบัติเหตุเมาขับ'
                              ? 'bg-red-50 text-red-700 border-red-200'
                              : incident.news_type === 'ทำร้ายร่างกายผู้อื่น'
                              ? 'bg-red-50 text-red-700 border-red-200'
                              : incident.news_type === 'ทำร้ายตนเอง'
                              ? 'bg-neutral-100 text-neutral-700 border-neutral-300'
                              : incident.news_type === 'ข่มขืน ล่วงละเมิด'
                              ? 'bg-pink-950/40 text-pink-300 border-pink-900/60'
                              : 'bg-neutral-100 text-neutral-700 border-neutral-200'
                          }`}
                        >
                          {incident.news_type || 'ไม่ระบุ'}
                        </span>
                      </td>

                      {/* News Title & Agency */}
                      <td className="py-3 px-3">
                        <div className="font-medium text-neutral-800 line-clamp-2 leading-snug" title={incident.news_title}>
                          {incident.news_title}
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-[13px] text-neutral-600 font-mono">
                          <span className="text-neutral-700 font-semibold">{incident.news_agency}</span>
                          {incident.url && (
                            <a
                              href={incident.url.split(';')[0]}
                              target="_blank"
                              rel="noreferrer"
                              className="text-neutral-600 hover:text-neutral-800 inline-flex items-center gap-0.5"
                              title="เปิดลิงก์ข่าว"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      </td>

                      {/* Date & Location */}
                      <td className="py-3 px-3">
                        <div className="text-neutral-700 font-mono text-[13px]">
                          {incident.incident_date || '-'} {incident.incident_time ? `(${incident.incident_time} น.)` : ''}
                        </div>
                        <div className="text-[13px] text-neutral-600 mt-0.5">
                          {incident.province || 'ไม่ระบุ จว.'} {incident.district ? `· ${incident.district}` : ''}
                        </div>
                        {incident.incident_location && (
                          <div className="text-xs text-neutral-600 truncate max-w-[130px]">
                            {incident.incident_location}
                          </div>
                        )}
                      </td>

                      {/* Perpetrator & Weapon */}
                      <td className="py-3 px-3">
                        <div className="text-neutral-800 font-medium truncate max-w-[140px]">
                          {incident.perpetrator_name || 'ไม่ระบุชื่อ'}
                        </div>
                        <div className="text-[13px] text-neutral-600 flex items-center gap-1.5 mt-0.5 font-mono">
                          <span>{incident.perpetrator_gender || '-'}</span>
                          {incident.perpetrator_age && <span>{incident.perpetrator_age}y</span>}
                          {incident.perpetrator_weapon && (
                            <span className="text-neutral-700 bg-neutral-100 border border-neutral-200 px-1 rounded-sm text-xs">
                              {incident.perpetrator_weapon}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Alcohol / Drugs */}
                      <td className="py-3 px-3">
                        {incident.alcohol_test_method === 'สังเกตุอาการ' ? (
                          <div className="flex items-center gap-1 text-neutral-600 text-[13px] font-mono">
                            <Wine className="w-3 h-3 text-neutral-600" />
                            <span>สังเกตุอาการ</span>
                          </div>
                        ) : incident.alcohol_level !== null && incident.alcohol_level !== undefined ? (
                          <div className="flex items-center gap-1 text-neutral-800 text-[13px] font-mono font-semibold">
                            <Wine className="w-3 h-3 text-neutral-600" />
                            <span>{incident.alcohol_level} mg%</span>
                          </div>
                        ) : (
                          <span className="text-neutral-600 text-[13px] font-mono">-</span>
                        )}

                        {incident.drug_use === 'ใช่' && (
                          <div className="flex items-center gap-1 text-neutral-700 text-xs mt-0.5 font-mono">
                            <Pill className="w-3 h-3 text-neutral-600" />
                            <span>สารเสพติด</span>
                          </div>
                        )}
                      </td>

                      {/* Casualties */}
                      <td className="py-3 px-3 text-center font-mono">
                        <div className="flex items-center justify-center gap-2 text-xs">
                          {incident.total_death ? (
                            <span className="font-bold text-red-700" title="ผู้เสียชีวิต">
                              💀 {incident.total_death}
                            </span>
                          ) : (
                            <span className="text-neutral-600">-</span>
                          )}
                          {incident.total_injury ? (
                            <span className="font-semibold text-red-700" title="ผู้บาดเจ็บ">
                              🩹 {incident.total_injury}
                            </span>
                          ) : null}
                        </div>
                      </td>

                      {/* Validation Status Badge */}
                      <td className="py-3 px-3 text-center">
                        {validation.isValid ? (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-xs font-mono font-medium bg-neutral-100 text-neutral-900 border border-neutral-300"
                            title="ข้อมูลครบถ้วน ถูกต้องตาม Data Dictionary"
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            Valid
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-xs font-mono font-medium bg-neutral-100 text-red-700 border border-red-200"
                            title={Object.values(validation.errors).join(', ')}
                          >
                            <AlertCircle className="w-3 h-3" />
                            Invalid
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end space-x-1">
                          <button
                            onClick={() => onViewIncident(incident)}
                            className="p-1.5 text-neutral-600 hover:text-white hover:bg-neutral-200 rounded-sm transition-colors"
                            title="ดูรายละเอียด 49 ฟิลด์"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          {!readOnly && (
                            <>
                              <button
                                onClick={() => onEditIncident(incident)}
                                className="p-1.5 text-neutral-600 hover:text-red-700 hover:bg-neutral-200 rounded-sm transition-colors"
                                title="แก้ไขข้อมูล"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => onDuplicateIncident(incident)}
                                className="p-1.5 text-neutral-600 hover:text-neutral-800 hover:bg-neutral-200 rounded-sm transition-colors"
                                title="คัดลอกสร้างใหม่"
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => {
                                  if (confirm(`คุณต้องการลบเหตุการณ์ลำดับที่ ${incident.id} หรือไม่?`)) {
                                    onDeleteIncident(incident.id);
                                  }
                                }}
                                className="p-1.5 text-neutral-600 hover:text-red-700 hover:bg-neutral-200 rounded-sm transition-colors"
                                title="ลบเหตุการณ์"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="bg-neutral-50 px-4 py-3 border-t border-neutral-200 flex items-center justify-between text-xs text-neutral-600 font-mono">
          <div>
            {/* ไม่มีข้อมูลต้องไม่แสดง "1 - 0 of 0" ซึ่งอ่านไม่ได้ความ */}
            {filteredIncidents.length === 0
              ? 'ไม่มีรายการที่ตรงกับตัวกรอง'
              : `หน้า ${page} จาก ${totalPages} · แสดงรายการที่ ${(page - 1) * pageSize + 1}-${Math.min(
                  page * pageSize,
                  filteredIncidents.length
                )} จาก ${filteredIncidents.length}`}
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setCurrentPage(Math.max(page - 1, 1))}
              disabled={page === 1}
              className="p-1.5 rounded-sm border border-neutral-200 bg-white text-neutral-600 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-neutral-200 hover:text-neutral-800 transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="font-semibold text-neutral-800 px-2 font-mono">{page}</span>
            <button
              onClick={() => setCurrentPage(Math.min(page + 1, totalPages))}
              disabled={page === totalPages}
              className="p-1.5 rounded-sm border border-neutral-200 bg-white text-neutral-600 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-neutral-200 hover:text-neutral-800 transition-colors"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
