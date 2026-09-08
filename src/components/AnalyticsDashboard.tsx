import React, { useState, useMemo, lazy, Suspense } from 'react';
import { CrimeIncident } from '../types/dataDictionary';
import { deriveAlcoholInvolved, normalizeProvince } from '../lib/normalize';
import { 
  Users, 
  Flame, 
  HeartCrack, 
  Wine, 
  Pill, 
  RefreshCw, 
  TrendingUp, 
  Clock, 
  MapPin, 
  ShieldAlert,
  AlertTriangle,
  Layers,
  BarChart3,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  CartesianGrid,
} from 'recharts';
import type { PieLabelRenderProps } from 'recharts';

/** เรคคอร์ดจากฐานข้อมูลมีคอลัมน์ระบบเพิ่ม แต่แดชบอร์ดใช้เฉพาะสองตัวนี้ */
type AnalyticsIncident = CrimeIncident & {
  alcohol_involved?: boolean | null;
  alcohol_role?: string | null;
  news_agency?: string;
};

interface AnalyticsDashboardProps {
  incidents: AnalyticsIncident[];
  onSelectIncident?: (incident: CrimeIncident) => void;
  onNavigateToForm: () => void;
  /** ผู้ใช้มีสิทธิ์บันทึกข้อมูลไหม — ถ้าไม่มีต้องไม่แสดงปุ่มที่กดแล้วถูกเด้งกลับ */
  canEdit?: boolean;
  /** ช่วงวันที่ของข้อมูลและเวลาที่โหลด — บอกที่มาให้ผู้อ่านทั่วไป */
  updatedAt?: Date | null;
}

/**
 * แผนที่โหลดแยกก้อน เพราะข้อมูลรูปร่าง 77 จังหวัดหนัก ~73 KB
 * ไม่ควรถ่วงการโหลดครั้งแรกของทุกคน รวมถึงผู้เข้าชมหน้าสาธารณะที่อาจไม่เลื่อนลงมาถึง
 */
const ThailandMap = lazy(() =>
  import('./ThailandMap').then((m) => ({ default: m.ThailandMap }))
);
const ThailandMapLegend = lazy(() =>
  import('./ThailandMap').then((m) => ({ default: m.ThailandMapLegend }))
);

/** เกณฑ์ตามกฎหมายไทย: ผู้ขับขี่ทั่วไปห้ามเกิน 50 มก.% */
const LEGAL_BAC_LIMIT = 50;

/**
 * กลุ่มอายุผู้ก่อเหตุ/ผู้เสียหาย
 * เก็บเป็น min/max แล้วใช้ .find() แทน if-else ซ้อน — รูปแบบเดียวกับ bacDistribution
 * ทำให้เพิ่มหรือขยับช่วงได้ที่เดียวโดยไม่ต้องไล่แก้เงื่อนไขหลายที่
 */
const AGE_BUCKETS = [
  { name: 'ต่ำกว่า 20', min: 0, max: 19 },
  { name: '20-29', min: 20, max: 29 },
  { name: '30-39', min: 30, max: 39 },
  { name: '40-49', min: 40, max: 49 },
  { name: '50-59', min: 50, max: 59 },
  { name: '60 ขึ้นไป', min: 60, max: Infinity },
] as const;

/**
 * สีกราฟ — ไล่เฉดเทาถึงดำ และใช้แดงเป็นตัวเน้นค่าที่ต้องสนใจเท่านั้น
 * ไล่จากเข้มไปอ่อนเพื่อให้อ่านลำดับได้แม้พิมพ์ขาวดำหรือผู้ใช้ตาบอดสี
 *
 * ข้อยกเว้นคือแผนที่รายจังหวัด (ThailandMap.tsx) ที่ไล่เฉดแดงโทนเดียว
 * ซึ่งยังคงเจตนาเดิมไว้ เพราะการไล่ความเข้มในโทนเดียวอ่านลำดับได้เหมือนกัน
 * ต่างจาก heat map หลายสีที่บอกลำดับไม่ได้
 */
const COLORS = ['#18181b', '#52525b', '#71717a', '#a1a1aa', '#c4c4c8', '#d92d20', '#e4e4e7', '#f0f0f1'];
/** คำอธิบายกราฟ — บังคับสีเข้มไม่ให้ไปใช้สีของแท่งกราฟที่อ่อนเกินไป */
const LEGEND_STYLE = { fontSize: '13px', paddingTop: '10px' } as const;
/** Recharts ระบายสีข้อความ legend ตามสีของ series (เทาอ่อนได้ 1.74:1 ซึ่งอ่านไม่ออก) จึงห่อสีเอง */
const legendLabel = (value: string) => <span style={{ color: '#18181b' }}>{value}</span>;

/**
 * ป้ายชิ้นพาย — บังคับสีข้อความให้เข้มเสมอ
 *
 * Recharts ระบายสีป้ายตามสีของชิ้น เหมือนที่ทำกับ legend ชิ้นที่เป็นเทาอ่อน
 * (เช่นกลุ่ม "ไม่ระบุ") จึงได้ข้อความจางจนอ่านไม่ออกบนพื้นขาว
 * และ `npm run check:a11y` จับไม่ได้เพราะมันอ่าน CSS `color` ส่วน SVG ใช้ `fill`
 */
const pieLabel = (props: PieLabelRenderProps) => {
  // Recharts ประกาศทุก prop เป็น optional จึงต้องมีค่าตั้งต้นกันคำนวณพลาดเป็น NaN
  const cx = Number(props.cx ?? 0);
  const cy = Number(props.cy ?? 0);
  const outerRadius = Number(props.outerRadius ?? 0);
  const midAngle = props.midAngle ?? 0;
  const { percent, name } = props;

  const rad = Math.PI / 180;
  const r = outerRadius + 16;
  const x = cx + r * Math.cos(-midAngle * rad);
  const y = cy + r * Math.sin(-midAngle * rad);
  return (
    <text
      x={x}
      y={y}
      fill="#18181b"
      fontSize={12}
      textAnchor={x > cx ? 'start' : 'end'}
      dominantBaseline="central"
    >
      {`${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
    </text>
  );
};

/** กล่องข้อมูลเมื่อชี้กราฟ — พื้นขาว ตัวอักษรใหญ่พออ่านได้ */
const TOOLTIP_STYLE = {
  backgroundColor: '#ffffff',
  borderColor: '#c9c9cf',
  borderRadius: '4px',
  color: '#18181b',
  fontSize: '13px',
  fontFamily: 'Sarabun, sans-serif',
  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
} as const;

/** สีสำหรับค่าที่ต้องเน้น (ผู้เสียชีวิต เกินกฎหมาย) */
const ACCENT = '#d92d20';
const INK = '#18181b';
const MUTED = '#a1a1aa';

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({
  incidents,
  onNavigateToForm,
  canEdit = false,
  updatedAt = null,
}) => {
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>('ALL');
  const [selectedProvinceFilter, setSelectedProvinceFilter] = useState<string>('ALL');
  /** แผนที่ระบายได้ทีละค่า จึงมีปุ่มสลับเพื่อไม่ให้เสียข้อมูลที่กราฟแท่งเดิมแสดงพร้อมกันได้ */
  const [mapMetric, setMapMetric] = useState<'count' | 'deaths'>('count');

  // Filtered dataset
  const filteredIncidents = useMemo(() => {
    return incidents.filter((inc) => {
      if (selectedTypeFilter !== 'ALL' && inc.news_type !== selectedTypeFilter) return false;
      if (selectedProvinceFilter !== 'ALL' && inc.province !== selectedProvinceFilter) return false;
      return true;
    });
  }, [incidents, selectedTypeFilter, selectedProvinceFilter]);

  // Key KPI Calculations
  const stats = useMemo(() => {
    const total = filteredIncidents.length;
    let deaths = 0;
    let injuries = 0;
    let alcoholCount = 0;
    let drugCount = 0;
    let recidivismCount = 0;
    let totalAlcoholLevel = 0;
    let measuredAlcoholCount = 0;
    let overLimitCount = 0;

    filteredIncidents.forEach((inc) => {
      deaths += inc.total_death || 0;
      injuries += inc.total_injury || 0;
      
      // ใช้ค่า alcohol_involved ที่บันทึกไว้ตอนสกัด/ตรวจสอบ
      // เดิมนับจาก `beverage_type` มีค่า ซึ่งพังเพราะฟอร์มตั้งดีฟอลต์ให้ทุกเรคคอร์ด
      const hasAlcohol =
        inc.alcohol_involved !== null && inc.alcohol_involved !== undefined
          ? inc.alcohol_involved
          : deriveAlcoholInvolved(inc);
      if (hasAlcohol) alcoholCount++;
      if (hasAlcohol && inc.alcohol_level !== null && inc.alcohol_level > LEGAL_BAC_LIMIT) {
        overLimitCount++;
      }

      if (inc.drug_use === 'ใช่') drugCount++;
      if (inc.recidivism === 'ใช่') recidivismCount++;

      if (inc.alcohol_level !== null && inc.alcohol_level > 0) {
        totalAlcoholLevel += inc.alcohol_level;
        measuredAlcoholCount++;
      }
    });

    const avgAlcohol = measuredAlcoholCount > 0 ? Math.round(totalAlcoholLevel / measuredAlcoholCount) : 0;

    return {
      total,
      deaths,
      injuries,
      totalCasualties: deaths + injuries,
      alcoholCount,
      alcoholRate: total > 0 ? Math.round((alcoholCount / total) * 100) : 0,
      overLimitCount,
      measuredAlcoholCount,
      overLimitRate:
        measuredAlcoholCount > 0 ? Math.round((overLimitCount / measuredAlcoholCount) * 100) : 0,
      drugRate: total > 0 ? Math.round((drugCount / total) * 100) : 0,
      recidivismRate: total > 0 ? Math.round((recidivismCount / total) * 100) : 0,
      avgAlcohol,
    };
  }, [filteredIncidents]);

  // Chart 1: Crime Types Distribution
  const crimeTypeData = useMemo(() => {
    const map: Record<string, { count: number; deaths: number; injuries: number }> = {};
    filteredIncidents.forEach((inc) => {
      const type = inc.news_type || 'ไม่ระบุ';
      if (!map[type]) map[type] = { count: 0, deaths: 0, injuries: 0 };
      map[type].count++;
      map[type].deaths += inc.total_death || 0;
      map[type].injuries += inc.total_injury || 0;
    });

    return Object.entries(map).map(([name, val]) => ({
      name,
      จำนวนเหตุการณ์: val.count,
      ผู้เสียชีวิต: val.deaths,
      ผู้บาดเจ็บ: val.injuries,
    }));
  }, [filteredIncidents]);

  // Chart 2: Incident Locations
  const locationData = useMemo(() => {
    const map: Record<string, number> = {};
    filteredIncidents.forEach((inc) => {
      const loc = inc.incident_location || 'ไม่ระบุ';
      map[loc] = (map[loc] || 0) + 1;
    });
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredIncidents]);

  // Chart 3: Weapon Breakdown
  const weaponData = useMemo(() => {
    const map: Record<string, number> = {};
    filteredIncidents.forEach((inc) => {
      const w = inc.perpetrator_weapon || 'ไม่ระบุ';
      map[w] = (map[w] || 0) + 1;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [filteredIncidents]);

  // Chart 4: Hourly Distribution
  const hourlyData = useMemo(() => {
    // นับผู้เสียชีวิตควบคู่กับจำนวนเหตุการณ์ เพื่อให้เห็นว่าช่วงเวลาไหนรุนแรงกว่ากัน
    // ไม่ใช่แค่เกิดบ่อยกว่ากัน — รูปแบบเดียวกับ weekdayData
    const hours: Record<string, { เหตุการณ์: number; เสียชีวิต: number }> = {};
    for (let i = 0; i < 24; i += 2) {
      const label = `${String(i).padStart(2, '0')}:00-${String(i + 1).padStart(2, '0')}:59`;
      hours[label] = { เหตุการณ์: 0, เสียชีวิต: 0 };
    }

    filteredIncidents.forEach((inc) => {
      if (inc.incident_time) {
        const hourNum = parseInt(inc.incident_time.split(':')[0], 10);
        if (!isNaN(hourNum)) {
          const binStart = Math.floor(hourNum / 2) * 2;
          const label = `${String(binStart).padStart(2, '0')}:00-${String(binStart + 1).padStart(2, '0')}:59`;
          if (hours[label] !== undefined) {
            hours[label]['เหตุการณ์']++;
            hours[label]['เสียชีวิต'] += inc.total_death || 0;
          }
        }
      }
    });

    return Object.entries(hours).map(([hour, v]) => ({ hour, ...v }));
  }, [filteredIncidents]);

  /**
   * ข้อมูลรายจังหวัดสำหรับแผนที่
   *
   * ตั้งใจ **ไม่กรองด้วย selectedProvinceFilter** ต่างจากกราฟอื่นในหน้านี้
   * เพราะถ้ากรอง แผนที่จะเหลือจังหวัดเดียวและอีก 76 จังหวัดเป็นศูนย์ ซึ่งไร้ประโยชน์
   * จังหวัดที่เลือกจะถูกเน้นด้วยเส้นขอบแทน แผนที่จึงเป็นตัวควบคุมตัวกรอง ไม่ใช่ถูกควบคุม
   *
   * ใช้ normalizeProvince ก่อนนับทุกครั้ง เพราะเส้นทางนำเข้า CSV ไม่ผ่านการ normalize
   * จึงมีสตริงที่ไม่ตรงกับรายชื่อ 77 จังหวัดหลุดเข้าฐานข้อมูลได้
   */
  const provinceMetrics = useMemo(() => {
    const byProvince: Record<string, { count: number; deaths: number }> = {};
    let unknown = 0;

    incidents.forEach((inc) => {
      if (selectedTypeFilter !== 'ALL' && inc.news_type !== selectedTypeFilter) return;
      const name = normalizeProvince(inc.province);
      if (!name) {
        unknown++;
        return;
      }
      if (!byProvince[name]) byProvince[name] = { count: 0, deaths: 0 };
      byProvince[name].count++;
      byProvince[name].deaths += inc.total_death || 0;
    });

    const counts: Record<string, number> = {};
    const deaths: Record<string, number> = {};
    for (const [name, v] of Object.entries(byProvince)) {
      counts[name] = v.count;
      deaths[name] = v.deaths;
    }

    const top = Object.entries(byProvince)
      .map(([name, v]) => ({ name, count: v.count, deaths: v.deaths }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return { counts, deaths, unknown, top, provinceCount: Object.keys(byProvince).length };
  }, [incidents, selectedTypeFilter]);

  // Chart 6: Beverage Types
  const beverageData = useMemo(() => {
    const map: Record<string, number> = {};
    filteredIncidents.forEach((inc) => {
      if (inc.beverage_type) {
        map[inc.beverage_type] = (map[inc.beverage_type] || 0) + 1;
      }
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [filteredIncidents]);

  // Age Demographic Distribution
  const ageDemographics = useMemo(() => {
    const buckets = AGE_BUCKETS.map((b) => ({ ...b, perp: 0, vic: 0 }));
    const find = (age: number) => buckets.find((b) => age >= b.min && age <= b.max);
    let perpUnknown = 0;

    filteredIncidents.forEach((inc) => {
      // อายุผู้ก่อเหตุ — null คือ "ไม่ทราบ" จริง ต้องนับไว้ ไม่ใช่ทิ้ง
      // (ปัจจุบัน 11 จาก 13 เคสไม่มีอายุ ถ้าซ่อนไว้กราฟจะดูเหมือนผู้ก่อเหตุทั้งหมดอายุ 60+)
      const pAge = inc.perpetrator_age;
      const pBucket = pAge === null || pAge === undefined ? undefined : find(pAge);
      if (pBucket) pBucket.perp++;
      else perpUnknown++;

      // อายุผู้เสียหาย — ช่องที่ว่างมักแปลว่า "ไม่มีเหยื่อคนที่ 2/3" ไม่ใช่ "ไม่ทราบอายุ"
      // จึงข้ามไป ไม่นับเข้าแท่งไม่ระบุ แท่งนั้นจึงมีเฉพาะผู้ก่อเหตุโดยตั้งใจ
      [inc.victim_1_age, inc.victim_2_age, inc.victim_3_age].forEach((vAge) => {
        if (vAge === null || vAge === undefined) return;
        const vBucket = find(vAge);
        if (vBucket) vBucket.vic++;
      });
    });

    return [
      ...buckets.map((b) => ({ group: b.name, ผู้ก่อเหตุ: b.perp, ผู้เสียหาย: b.vic })),
      { group: 'ไม่ระบุ', ผู้ก่อเหตุ: perpUnknown, ผู้เสียหาย: 0 },
    ];
  }, [filteredIncidents]);

  // ระดับแอลกอฮอล์เทียบเกณฑ์กฎหมาย 50 mg%
  const bacDistribution = useMemo(() => {
    // overLimit กำหนดตายตัวต่อกลุ่ม ห้ามคำนวณจาก b.min > LEGAL_BAC_LIMIT
    // เพราะกลุ่ม 50-100 มี min = 50 ซึ่ง 50 > 50 เป็นเท็จ แท่งจะไม่ถูกเน้นสีทั้งที่ค่าส่วนใหญ่เกินเกณฑ์
    const buckets = [
      { name: 'ต่ำกว่า 50', min: 0, max: 49, count: 0, overLimit: false },
      { name: '50-100', min: 50, max: 100, count: 0, overLimit: true },
      { name: '101-150', min: 101, max: 150, count: 0, overLimit: true },
      { name: '151-200', min: 151, max: 200, count: 0, overLimit: true },
      { name: 'มากกว่า 200', min: 201, max: Infinity, count: 0, overLimit: true },
    ];
    // เดิมทิ้งเคสที่ไม่มีผลตรวจไปเฉยๆ ทำให้กราฟดูเหมือนทุกเคสถูกตรวจหมด
    // ทั้งที่ส่วนใหญ่ไม่มีค่า — ต้องนับไว้แล้วแสดงเป็นแท่งของตัวเอง
    let unmeasured = 0;
    filteredIncidents.forEach((inc) => {
      const level = inc.alcohol_level;
      if (level === null || level === undefined) {
        unmeasured++;
        return;
      }
      const bucket = buckets.find((b) => level >= b.min && level <= b.max);
      if (bucket) bucket.count++;
    });
    return [
      ...buckets.map((b) => ({ name: b.name, 'จำนวนเคส': b.count, overLimit: b.overLimit })),
      { name: 'ไม่ตรวจ/ไม่ระบุ', 'จำนวนเคส': unmeasured, overLimit: false },
    ];
  }, [filteredIncidents]);

  /**
   * ประวัติการกระทำความผิดซ้ำ
   *
   * ค่าว่างของคอลัมน์นี้เป็นสตริงว่าง ไม่ใช่ null เพราะ rowToRecord แปลงให้ตั้งแต่ชั้น repo
   * และคอลัมน์ไม่มี CHECK constraint จึงมีค่านอก vocab ได้ — ทุกอย่างที่ไม่ใช่ ใช่/ไม่ใช่ จึงเข้าไม่ระบุ
   *
   * กำหนดสีตามความหมายแทนการไล่ตาม index เพราะ .filter() ด้านล่างทำให้ลำดับเลื่อนได้
   */
  const recidivismData = useMemo(() => {
    let yes = 0;
    let no = 0;
    let unknown = 0;
    filteredIncidents.forEach((inc) => {
      if (inc.recidivism === 'ใช่') yes++;
      else if (inc.recidivism === 'ไม่ใช่') no++;
      else unknown++;
    });
    return [
      { name: 'ใช่', value: yes, fill: ACCENT },
      { name: 'ไม่ใช่', value: no, fill: '#71717a' },
      { name: 'ไม่ระบุ', value: unknown, fill: '#d4d4d8' },
    ].filter((d) => d.value > 0);
  }, [filteredIncidents]);

  // การกระจายตามวันในสัปดาห์ (คาดว่ากระจุกช่วงสุดสัปดาห์)
  const weekdayData = useMemo(() => {
    const names = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
    const counts = names.map((name) => ({ name, 'เหตุการณ์': 0, 'เสียชีวิต': 0 }));
    filteredIncidents.forEach((inc) => {
      if (!inc.incident_date) return;
      const d = new Date(inc.incident_date);
      if (Number.isNaN(d.getTime())) return;
      counts[d.getDay()]['เหตุการณ์']++;
      counts[d.getDay()]['เสียชีวิต'] += inc.total_death || 0;
    });
    // เริ่มที่วันจันทร์ให้อ่านง่ายกว่า
    return [...counts.slice(1), counts[0]];
  }, [filteredIncidents]);

  // บทบาทของแอลกอฮอล์ในเหตุการณ์
  const alcoholRoleData = useMemo(() => {
    const map: Record<string, number> = {};
    filteredIncidents.forEach((inc) => {
      const role = inc.alcohol_role || 'ไม่ระบุ';
      map[role] = (map[role] || 0) + 1;
    });
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredIncidents]);

  // สำนักข่าวที่เป็นแหล่งข้อมูล (ดูความหลากหลายของแหล่ง)
  const agencyData = useMemo(() => {
    const map: Record<string, number> = {};
    filteredIncidents.forEach((inc) => {
      // ฟิลด์นี้เป็น multi-value คั่นด้วย ; เมื่อข่าวเดียวกันมาจากหลายสำนัก
      String(inc.news_agency || 'ไม่ระบุ')
        .split(';')
        .map((a) => a.trim())
        .filter(Boolean)
        .forEach((agency) => {
          map[agency] = (map[agency] || 0) + 1;
        });
    });
    return Object.entries(map)
      .map(([name, value]) => ({ name, 'จำนวนข่าว': value }))
      .sort((a, b) => b['จำนวนข่าว'] - a['จำนวนข่าว'])
      .slice(0, 8);
  }, [filteredIncidents]);

  const uniqueProvinces = useMemo(() => {
    const list = Array.from(new Set(incidents.map((i) => i.province).filter(Boolean)));
    return list.sort();
  }, [incidents]);

  /** ช่วงวันที่ของข้อมูลที่กำลังแสดง — ใช้บอกที่มาให้ผู้อ่าน */
  const dataPeriod = useMemo(() => {
    const dates = incidents
      .map((i) => i.incident_date)
      .filter((d): d is string => Boolean(d))
      .sort();
    if (dates.length === 0) return null;
    const fmt = (iso: string) => {
      const d = new Date(iso);
      return isNaN(d.getTime())
        ? iso
        : d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
    };
    return { from: fmt(dates[0]), to: fmt(dates[dates.length - 1]) };
  }, [incidents]);

  /**
   * ยังไม่มีเคสที่ผ่านการตรวจสอบ
   *
   * ต้องบอกตรงๆ ไม่ใช่เรนเดอร์แดชบอร์ดที่ทุกช่องเป็น 0 —
   * "0 เหตุการณ์ · 0 ผู้เสียชีวิต · 0%" อ่านได้ว่า "ไม่มีเหตุเกิดขึ้นในประเทศไทย"
   * ซึ่งคนละความหมายกับ "ยังไม่มีข้อมูลที่ตรวจสอบเสร็จ"
   */
  if (incidents.length === 0) {
    return (
      <div className="py-20 max-w-lg mx-auto text-center">
        <div className="inline-flex p-3 rounded-sm bg-neutral-100 border border-neutral-200 mb-4">
          <BarChart3 className="w-6 h-6 text-neutral-600" />
        </div>
        <h2 className="font-serif text-xl text-neutral-900">ยังไม่มีเคสที่ผ่านการตรวจสอบ</h2>
        <p className="mt-2.5 text-xs text-neutral-600 font-sans leading-relaxed">
          ระบบดึงข่าวและคัดกรองอยู่ตามปกติ แต่ยังไม่มีเคสที่เจ้าหน้าที่ตรวจสอบและอนุมัติ
          จึงยังคำนวณสถิติไม่ได้
          <br />
          <span className="text-neutral-600">
            ตัวเลขบนหน้านี้จะปรากฏเมื่อมีเคสที่ผ่านการตรวจสอบแล้วอย่างน้อย 1 เคส
          </span>
        </p>
        {canEdit && (
          <button
            onClick={onNavigateToForm}
            className="mt-5 inline-flex items-center gap-2 px-4 py-2.5 bg-neutral-900 hover:bg-black text-white text-xs font-mono font-bold  rounded-sm"
          >
            + เพิ่มรายงานข่าวเข้าสู่ระบบ
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Top Filter & Control Bar */}
      <div className="bg-white border border-neutral-200 rounded-sm p-6 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl text-neutral-900 font-semibold">
            สถิติความรุนแรงและอุบัติเหตุจากแอลกอฮอล์
          </h2>
          {/* ที่มาและช่วงเวลาของข้อมูล — เดิมไม่มีบอกเลยว่าตัวเลขนี้ครอบคลุมช่วงไหน */}
          <p className="text-[13px] text-neutral-600 mt-1.5 font-sans">
            {dataPeriod
              ? `ข้อมูลช่วง ${dataPeriod.from} ถึง ${dataPeriod.to} · รวม ${incidents.length.toLocaleString('th-TH')} เคส`
              : `รวม ${incidents.length.toLocaleString('th-TH')} เคส`}
            {updatedAt && ` · อัปเดตเมื่อ ${updatedAt.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label className="block text-xs tracking-wider uppercase font-mono text-neutral-600 mb-1">ประเภทเหตุการณ์</label>
            <select
              value={selectedTypeFilter}
              onChange={(e) => setSelectedTypeFilter(e.target.value)}
              className="bg-neutral-50 border border-neutral-200 text-neutral-800 text-xs rounded-sm px-3 py-1.5 focus:border-neutral-400 focus:outline-none font-mono"
            >
              <option value="ALL">ทุกประเภทเหตุการณ์</option>
              <option value="อุบัติเหตุเมาขับ">อุบัติเหตุเมาขับ</option>
              <option value="ทำร้ายร่างกายผู้อื่น">ทำร้ายร่างกายผู้อื่น</option>
              <option value="ทำร้ายตนเอง">ทำร้ายตนเอง</option>
              <option value="ข่มขืน ล่วงละเมิด">ข่มขืน ล่วงละเมิด</option>
              <option value="ทำลายทรัพย์สิน">ทำลายทรัพย์สิน</option>
            </select>
          </div>

          <div>
            <label className="block text-xs tracking-wider uppercase font-mono text-neutral-600 mb-1">จังหวัด</label>
            <select
              value={selectedProvinceFilter}
              onChange={(e) => setSelectedProvinceFilter(e.target.value)}
              className="bg-neutral-50 border border-neutral-200 text-neutral-800 text-xs rounded-sm px-3 py-1.5 focus:border-neutral-400 focus:outline-none font-mono"
            >
              <option value="ALL">ทุกจังหวัด</option>
              {uniqueProvinces.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          {(selectedTypeFilter !== 'ALL' || selectedProvinceFilter !== 'ALL') && (
            <button
              onClick={() => {
                setSelectedTypeFilter('ALL');
                setSelectedProvinceFilter('ALL');
              }}
              className="mt-5 text-xs text-neutral-600 hover:text-white underline font-mono"
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards Row */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        {/* Total Incidents */}
        <div className="bg-white border border-neutral-200 rounded-sm p-4 flex flex-col justify-between hover:border-neutral-300 transition-colors">
          <div className="flex items-center justify-between text-neutral-600">
            <span className="text-xs tracking-wider uppercase font-mono">เหตุการณ์ทั้งหมด</span>
            <ShieldAlert className="w-3.5 h-3.5 text-neutral-600" />
          </div>
          <div className="mt-2">
            <span className="text-2xl font-serif text-neutral-900 font-semibold">{stats.total}</span>
            <span className="text-xs text-neutral-600 ml-1 font-mono">เหตุการณ์</span>
          </div>
          <div className="mt-1 text-xs font-mono text-neutral-600">ที่ผ่านการตรวจสอบ</div>
        </div>

        {/* Deaths */}
        <div className="bg-white border border-neutral-200 rounded-sm p-4 flex flex-col justify-between hover:border-neutral-300 transition-colors">
          <div className="flex items-center justify-between text-neutral-600">
            <span className="text-xs tracking-wider uppercase font-mono">ผู้เสียชีวิต</span>
            <Flame className="w-3.5 h-3.5 text-red-700" />
          </div>
          <div className="mt-2">
            <span className="text-2xl font-serif text-red-700 font-semibold">{stats.deaths}</span>
            <span className="text-xs text-neutral-600 ml-1 font-mono">ราย</span>
          </div>
          <div className="mt-1 text-xs font-mono text-neutral-600">เฉลี่ย {(stats.deaths / (stats.total || 1)).toFixed(2)} รายต่อเหตุการณ์</div>
        </div>

        {/* Injuries */}
        <div className="bg-white border border-neutral-200 rounded-sm p-4 flex flex-col justify-between hover:border-neutral-300 transition-colors">
          <div className="flex items-center justify-between text-neutral-600">
            <span className="text-xs tracking-wider uppercase font-mono">ผู้บาดเจ็บ</span>
            <HeartCrack className="w-3.5 h-3.5 text-red-700" />
          </div>
          <div className="mt-2">
            <span className="text-2xl font-serif text-red-700 font-semibold">{stats.injuries}</span>
            <span className="text-xs text-neutral-600 ml-1 font-mono">ราย</span>
          </div>
          <div className="mt-1 text-xs font-mono text-neutral-600">บาดเจ็บเล็กน้อยถึงสาหัส</div>
        </div>

        {/* เกี่ยวข้องกับแอลกอฮอล์ */}
        <div className="bg-white border border-neutral-200 rounded-sm p-4 flex flex-col justify-between hover:border-neutral-300 transition-colors">
          <div className="flex items-center justify-between text-neutral-600">
            <span className="text-xs tracking-wider uppercase font-mono">เกี่ยวข้องกับแอลกอฮอล์</span>
            <Wine className="w-3.5 h-3.5 text-neutral-600" />
          </div>
          <div className="mt-2">
            <span className="text-2xl font-serif text-neutral-800 font-semibold">{stats.alcoholRate}%</span>
            <span className="text-xs text-neutral-600 ml-1 font-mono">({stats.alcoholCount})</span>
          </div>
          <div className="mt-1 text-xs font-mono text-neutral-600">
            เฉลี่ย {stats.avgAlcohol} mg% จาก {stats.measuredAlcoholCount} เคสที่มีผลตรวจ
          </div>
        </div>

        {/* Drug Involved % */}
        <div className="bg-white border border-neutral-200 rounded-sm p-4 flex flex-col justify-between hover:border-neutral-300 transition-colors">
          <div className="flex items-center justify-between text-neutral-600">
            <span className="text-xs tracking-wider uppercase font-mono">มีสารเสพติดร่วม</span>
            <Pill className="w-3.5 h-3.5 text-neutral-600" />
          </div>
          <div className="mt-2">
            <span className="text-2xl font-serif text-neutral-800 font-semibold">{stats.drugRate}%</span>
          </div>
          <div className="mt-1 text-xs font-mono text-neutral-600">ของเหตุการณ์ทั้งหมด</div>
        </div>

        {/* Recidivism % */}
        <div className="bg-white border border-neutral-200 rounded-sm p-4 flex flex-col justify-between hover:border-neutral-300 transition-colors">
          <div className="flex items-center justify-between text-neutral-600">
            <span className="text-xs tracking-wider uppercase font-mono">เคยกระทำผิดซ้ำ</span>
            <RefreshCw className="w-3.5 h-3.5 text-neutral-600" />
          </div>
          <div className="mt-2">
            <span className="text-2xl font-serif text-neutral-800 font-semibold">{stats.recidivismRate}%</span>
          </div>
          <div className="mt-1 text-xs font-mono text-neutral-600">ของเหตุการณ์ทั้งหมด</div>
        </div>
      </div>

      {/* Main Charts Grid 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Crime Type Breakdown */}
        <div className="bg-white border border-neutral-200 rounded-sm p-5 shadow-md">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-neutral-800">
              ประเภทเหตุการณ์และความสูญเสีย
            </h3>
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={crimeTypeData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
                <XAxis dataKey="name" stroke="#a1a1aa" tick={{ fontSize: 12 }} angle={-15} textAnchor="end" interval={0} />
                <YAxis stroke="#a1a1aa" tick={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                />
                <Legend wrapperStyle={LEGEND_STYLE} formatter={legendLabel} />
                <Bar dataKey="จำนวนเหตุการณ์" fill="#71717a" radius={[2, 2, 0, 0]} />
                <Bar dataKey="ผู้เสียชีวิต" fill="#d92d20" radius={[2, 2, 0, 0]} />
                <Bar dataKey="ผู้บาดเจ็บ" fill="#c4c4c8" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Hourly Distribution Timeline */}
        <div className="bg-white border border-neutral-200 rounded-sm p-5 shadow-md">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-neutral-800 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-neutral-600" />
              ช่วงเวลาที่เกิดเหตุ
            </h3>
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={hourlyData} margin={{ top: 10, right: 15, left: -20, bottom: 32 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
                <XAxis dataKey="hour" stroke="#a1a1aa" tick={{ fontSize: 12 }} angle={-35} textAnchor="end" interval={0} />
                <YAxis stroke="#a1a1aa" tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                />
                <Legend wrapperStyle={LEGEND_STYLE} formatter={legendLabel} />
                {/* สีเดิมของเส้นนี้คือ #e4e4e7 ซึ่งเกือบขาว มองแทบไม่เห็นบนพื้นขาว
                    เปลี่ยนเป็นเทากลางตามที่กราฟอื่นในไฟล์ใช้กับซีรีส์นับจำนวน */}
                <Line type="monotone" dataKey="เหตุการณ์" stroke={MUTED} strokeWidth={2} dot={{ r: 3, fill: '#ffffff' }} activeDot={{ r: 5 }} />
                <Line type="monotone" dataKey="เสียชีวิต" stroke={ACCENT} strokeWidth={2} dot={{ r: 3, fill: '#ffffff' }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Main Charts Grid 2 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Incident Locations */}
        <div className="bg-white border border-neutral-200 rounded-sm p-5 shadow-md">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-neutral-800">สถานที่เกิดเหตุ</h3>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={locationData.slice(0, 6)} margin={{ top: 5, right: 20, left: 35, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" horizontal={false} />
                <XAxis type="number" stroke="#a1a1aa" tick={{ fontSize: 12 }} allowDecimals={false} />
                <YAxis dataKey="name" type="category" stroke="#a1a1aa" tick={{ fontSize: 12 }} width={90} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                />
                <Bar dataKey="value" name="จำนวน" fill="#52525b" radius={[0, 2, 2, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Weapons Used */}
        <div className="bg-white border border-neutral-200 rounded-sm p-5 shadow-md">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-neutral-800">อาวุธและยานพาหนะ</h3>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={weaponData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={75}
                  innerRadius={35}
                  paddingAngle={3}
                  label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {weaponData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Beverage Types */}
        <div className="bg-white border border-neutral-200 rounded-sm p-5 shadow-md">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-neutral-800">ประเภทเครื่องดื่ม</h3>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={beverageData.length > 0 ? beverageData : [{ name: 'ไม่มีข้อมูล', value: 1 }]}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={75}
                  innerRadius={35}
                  paddingAngle={3}
                  label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {beverageData.map((_, index) => (
                    <Cell key={`cell-bev-${index}`} fill={['#d4d4d8', '#a1a1aa', '#71717a', '#52525b'][index % 4]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Main Charts Grid 3: Demographics & Province Hotspots */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Age Demographics Comparison */}
        <div className="bg-white border border-neutral-200 rounded-sm p-5 shadow-md">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-neutral-800 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-neutral-600" />
              ช่วงอายุ: ผู้ก่อเหตุเทียบผู้เสียหาย
            </h3>
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ageDemographics} margin={{ top: 10, right: 15, left: -20, bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
                <XAxis dataKey="group" stroke="#a1a1aa" tick={{ fontSize: 12 }} angle={-20} textAnchor="end" interval={0} />
                <YAxis stroke="#a1a1aa" tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                />
                <Legend wrapperStyle={LEGEND_STYLE} formatter={legendLabel} />
                <Bar dataKey="ผู้ก่อเหตุ" fill="#d92d20" radius={[2, 2, 0, 0]} />
                <Bar dataKey="ผู้เสียหาย" fill="#18181b" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* แผนที่ความหนาแน่นรายจังหวัด — กินเต็มแถวเพราะแผนที่ไทยเป็นแนวตั้ง
            ถ้าอยู่ในคอลัมน์ครึ่งเดียวจะได้แผนที่แคบจนดูไม่รู้เรื่อง */}
        <div className="bg-white border border-neutral-200 rounded-sm p-5 shadow-md lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h3 className="text-sm font-semibold text-neutral-800 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-neutral-600" />
              ความหนาแน่นเหตุการณ์รายจังหวัด
            </h3>
            <div className="flex items-center gap-1">
              {([
                ['count', 'จำนวนเหตุการณ์'],
                ['deaths', 'ผู้เสียชีวิต'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setMapMetric(key)}
                  className={`text-[13px] font-mono px-2.5 py-1 rounded-sm border ${
                    mapMetric === key
                      ? 'bg-neutral-900 text-white border-neutral-900'
                      : 'text-neutral-700 border-neutral-300 hover:bg-neutral-100'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col md:flex-row gap-6">
            {/* แผนที่ไทยสูงประมาณ 1.84 เท่าของความกว้าง ความสูงจึงเป็นตัวกำหนดขนาดที่เห็น
                กว้างกว่านี้ไม่ช่วยให้ใหญ่ขึ้น เพราะ preserveAspectRatio จะจัดกึ่งกลางแล้วเหลือที่ว่างข้างๆ */}
            <div className="h-[560px] w-full md:w-[330px] shrink-0">
              <Suspense
                fallback={
                  <div className="h-full w-full flex items-center justify-center text-[13px] font-mono text-neutral-600">
                    กำลังโหลดแผนที่...
                  </div>
                }
              >
                <ThailandMap
                  data={mapMetric === 'count' ? provinceMetrics.counts : provinceMetrics.deaths}
                  metricLabel={mapMetric === 'count' ? 'เหตุการณ์' : 'ผู้เสียชีวิต'}
                  selected={selectedProvinceFilter === 'ALL' ? null : selectedProvinceFilter}
                  onSelect={(name) =>
                    // กดจังหวัดเดิมซ้ำ = ล้างตัวกรอง ผู้ใช้จึงไม่ติดอยู่กับจังหวัดเดียว
                    setSelectedProvinceFilter((cur) => (cur === name ? 'ALL' : name))
                  }
                />
              </Suspense>
            </div>

            <div className="flex-1 max-w-2xl space-y-5">
              <Suspense fallback={null}>
                <ThailandMapLegend
                  data={mapMetric === 'count' ? provinceMetrics.counts : provinceMetrics.deaths}
                  metricLabel={mapMetric === 'count' ? 'จำนวนเหตุการณ์' : 'ผู้เสียชีวิต'}
                />
              </Suspense>

              <div>
                <p className="text-[13px] font-mono text-neutral-600 mb-2">5 จังหวัดที่พบมากที่สุด</p>
                {provinceMetrics.top.length === 0 ? (
                  <p className="text-[13px] font-sans text-neutral-600">ยังไม่มีข้อมูล</p>
                ) : (
                  <ol className="space-y-1.5">
                    {provinceMetrics.top.map((p, i) => (
                      <li key={p.name} className="flex items-baseline gap-2 text-[13px] font-sans">
                        <span className="font-mono text-neutral-600 w-4 shrink-0">{i + 1}.</span>
                        <button
                          onClick={() =>
                            setSelectedProvinceFilter((cur) => (cur === p.name ? 'ALL' : p.name))
                          }
                          className="text-neutral-900 hover:text-red-700 underline-offset-2 hover:underline text-left"
                        >
                          {p.name}
                        </button>
                        <span className="ml-auto font-mono text-neutral-700 shrink-0">
                          {p.count} เหตุการณ์ · เสียชีวิต {p.deaths}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              {/* เคสที่ไม่รู้จังหวัดวาดบนแผนที่ไม่ได้ ต้องบอกไว้ ไม่ให้หายเงียบ */}
              <p className="text-[13px] font-sans text-neutral-600">
                มีข้อมูล {provinceMetrics.provinceCount} จังหวัด จากทั้งหมด 77 จังหวัด
                {provinceMetrics.unknown > 0 && (
                  <span className="block mt-0.5">
                    อีก {provinceMetrics.unknown} เคสไม่ระบุจังหวัด จึงไม่ปรากฏบนแผนที่
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* กราฟเฉพาะมิติแอลกอฮอล์ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-neutral-200 rounded-sm p-5 shadow-md">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold text-neutral-800 flex items-center gap-1.5">
              <Wine className="w-3.5 h-3.5 text-neutral-600" />
              ระดับแอลกอฮอล์ที่ตรวจได้ (mg%)
            </h3>
          </div>
          <p className="text-xs font-mono text-neutral-600 mb-3">
            เกณฑ์ตามกฎหมายไทย: ผู้ขับขี่ทั่วไปห้ามเกิน {LEGAL_BAC_LIMIT} mg% ·{' '}
            <span className="text-red-700">
              {stats.overLimitRate}% ของเคสที่มีผลตรวจเกินเกณฑ์
            </span>
            <span className="block mt-0.5">
              แท่ง &quot;ไม่ตรวจ/ไม่ระบุ&quot; รวมกรณีที่ประเมินด้วยการสังเกตอาการ ซึ่งไม่มีค่าตัวเลขตามนิยาม
            </span>
          </p>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bacDistribution} margin={{ top: 10, right: 15, left: -20, bottom: 28 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
                <XAxis dataKey="name" stroke="#a1a1aa" tick={{ fontSize: 12 }} angle={-20} textAnchor="end" interval={0} />
                <YAxis stroke="#a1a1aa" tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                />
                <Bar dataKey="จำนวนเคส" radius={[2, 2, 0, 0]}>
                  {bacDistribution.map((entry, index) => (
                    <Cell key={`bac-${index}`} fill={entry.overLimit ? '#f43f5e' : '#a1a1aa'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white border border-neutral-200 rounded-sm p-5 shadow-md">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-neutral-800 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-neutral-600" />
              การกระจายตามวันในสัปดาห์
            </h3>
          </div>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weekdayData} margin={{ top: 10, right: 15, left: -20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
                <XAxis dataKey="name" stroke="#a1a1aa" tick={{ fontSize: 12 }} />
                <YAxis stroke="#a1a1aa" tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                />
                <Legend wrapperStyle={LEGEND_STYLE} formatter={legendLabel} />
                <Bar dataKey="เหตุการณ์" fill="#71717a" radius={[2, 2, 0, 0]} />
                <Bar dataKey="เสียชีวิต" fill="#d92d20" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ประวัติการกระทำความผิดซ้ำ */}
        <div className="bg-white border border-neutral-200 rounded-sm p-5 shadow-md">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold text-neutral-800 flex items-center gap-1.5">
              <RefreshCw className="w-3.5 h-3.5 text-neutral-600" />
              ประวัติการกระทำความผิดซ้ำ
            </h3>
          </div>
          <p className="text-xs font-mono text-neutral-600 mb-3">
            ระบุแล้ว {stats.total - (recidivismData.find((d) => d.name === 'ไม่ระบุ')?.value ?? 0)} จาก{' '}
            {stats.total} เคส
          </p>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={recidivismData.length > 0 ? recidivismData : [{ name: 'ไม่มีข้อมูล', value: 1, fill: '#e4e4e7' }]}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={75}
                  innerRadius={35}
                  paddingAngle={3}
                  label={pieLabel}
                  labelLine={false}
                >
                  {(recidivismData.length > 0 ? recidivismData : [{ name: 'ไม่มีข้อมูล', value: 1, fill: '#e4e4e7' }]).map(
                    (entry, index) => (
                      <Cell key={`recid-${index}`} fill={entry.fill} />
                    )
                  )}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white border border-neutral-200 rounded-sm p-5 shadow-md">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-neutral-800 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-neutral-600" />
              บทบาทของแอลกอฮอล์ในเหตุการณ์
            </h3>
          </div>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={alcoholRoleData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={75}
                  innerRadius={35}
                  paddingAngle={3}
                  label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {alcoholRoleData.map((_, index) => (
                    <Cell key={`role-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white border border-neutral-200 rounded-sm p-5 shadow-md">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-neutral-800 flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-neutral-600" />
              แหล่งข่าวที่เป็นที่มาของข้อมูล
            </h3>
          </div>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={agencyData} margin={{ top: 5, right: 20, left: 45, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" horizontal={false} />
                <XAxis type="number" stroke="#a1a1aa" tick={{ fontSize: 12 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" stroke="#a1a1aa" tick={{ fontSize: 12 }} width={90} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                />
                <Bar dataKey="จำนวนข่าว" fill="#52525b" radius={[0, 2, 2, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Intelligence & Policy Insights Panel */}
      <div className="bg-white border border-neutral-200 rounded-sm p-6 shadow-xl">
        <div className="flex items-start gap-4">
          <div className="p-2.5 rounded-sm bg-neutral-100 border border-neutral-300 text-neutral-700 shrink-0">
            <AlertTriangle className="w-5 h-5 text-red-700" />
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs  font-mono uppercase text-neutral-600">สรุปผล</span>
              <span className="w-1 h-1 rounded-full bg-neutral-300" />
              <span className="text-xs font-mono text-neutral-600">ข้อสังเกตจากข้อมูล</span>
            </div>
            <h3 className="font-serif text-lg text-neutral-900 font-semibold tracking-wide">
              ข้อค้นพบเชิงสถิติจากฐานข้อมูลปัจจุบัน
            </h3>
            <p className="text-xs sm:text-sm text-neutral-600 leading-relaxed font-sans">
              • <strong className="text-neutral-800">สัดส่วนที่เกี่ยวข้องกับแอลกอฮอล์</strong>: จาก{' '}
              {stats.total} เหตุการณ์ที่ผ่านการตรวจสอบ มี{' '}
              <span className="text-neutral-800 font-mono font-semibold">{stats.alcoholCount} เคส ({stats.alcoholRate}%)</span>{' '}
              ที่ยืนยันว่ามีแอลกอฮอล์เกี่ยวข้อง<br />
              • <strong className="text-neutral-800">ระดับแอลกอฮอล์เทียบเกณฑ์กฎหมาย</strong>: ในเคสที่มีผลตรวจเป็นตัวเลข{' '}
              {stats.measuredAlcoholCount} เคส มี{' '}
              <span className="text-red-700 font-mono font-semibold">{stats.overLimitCount} เคส ({stats.overLimitRate}%)</span>{' '}
              ที่เกิน {LEGAL_BAC_LIMIT} mg% · ค่าเฉลี่ย{' '}
              <span className="text-neutral-800 font-mono font-semibold">{stats.avgAlcohol} mg%</span><br />
              • <strong className="text-neutral-800">การกระทำผิดซ้ำ</strong>: อัตราการกระทำผิดซ้ำอยู่ที่{' '}
              <span className="text-neutral-800 font-mono font-semibold">{stats.recidivismRate}%</span>{' '}
              และมีการใช้ยาเสพติดร่วมด้วย{' '}
              <span className="text-neutral-800 font-mono font-semibold">{stats.drugRate}%</span>
            </p>
            <p className="text-[13px] text-neutral-600 font-sans pt-1">
              ตัวเลขทั้งหมดคำนวณจากเคสที่เจ้าหน้าที่ตรวจสอบและอนุมัติแล้วเท่านั้น
              จึงเป็นสถิติจากข่าวที่รายงาน ไม่ใช่จำนวนเหตุการณ์ที่เกิดขึ้นจริงทั้งหมด
            </p>
            {/* ปุ่มนี้ต้องไม่โผล่ให้คนที่กดแล้วถูกเด้งกลับหน้าสถิติโดยไม่มีคำอธิบาย */}
            {canEdit && (
              <div className="pt-2 flex flex-wrap gap-2">
                <button
                  onClick={onNavigateToForm}
                  className="text-xs bg-neutral-900 hover:bg-black text-white font-bold  px-4 py-2 rounded-sm transition-all inline-flex items-center gap-1.5 shadow-sm"
                >
                  <span>+ เพิ่มรายงานข่าวเข้าสู่ระบบสถิติ</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

