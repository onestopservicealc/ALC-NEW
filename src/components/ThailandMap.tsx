/**
 * แผนที่ประเทศไทยระบายสีตามความหนาแน่นของข้อมูลรายจังหวัด
 *
 * แยกเป็นไฟล์ของตัวเองเพื่อให้ lazy-load ได้ — ข้อมูลรูปร่างจังหวัดหนัก ~73 KB
 * ซึ่งไม่ควรไปถ่วงการโหลดครั้งแรกของทุกคนรวมถึงหน้าสาธารณะ
 * (bundle หลักเป็นก้อนเดียวเกินเพดานเตือนของ Vite อยู่แล้ว)
 *
 * ไม่ใช้ไลบรารีแผนที่ใดๆ เพราะพิกัดถูกฉายไว้ล่วงหน้าแล้วโดย `npm run build:map`
 * ที่นี่จึงเหลือแค่เอาสตริง path ไปวาดและเลือกสี
 */
import React, { useMemo, useState } from 'react';
import { MAP_VIEWBOX, PROVINCE_SHAPES } from '../data/thailandProvinceShapes';

/**
 * ไล่โทนแดงโทนเดียว อ่อน → เข้ม
 *
 * ใช้โทนเดียวไล่ความเข้มแทนสเกลหลายสีแบบ heat map เพราะอ่านลำดับได้
 * ทั้งตอนพิมพ์ขาวดำและสำหรับผู้ใช้ตาบอดสี ซึ่งเป็นเกณฑ์เดียวกับที่ใช้กับกราฟอื่นในระบบ
 */
const RAMP = ['#fde3e0', '#f9b4ad', '#f2796d', '#e14434', '#a81b0f'];

/** เทา = ไม่มีเคสเลย ต้องต่างจาก "มีเคสน้อย" ให้ชัด ไม่ใช่แดงจางสุด */
const NO_DATA = '#d4d4d8';

/** กล่องข้อมูลเมื่อชี้ — ลอกค่าจาก TOOLTIP_STYLE ของแดชบอร์ดให้หน้าตาเหมือนกราฟอื่น */
const TOOLTIP: React.CSSProperties = {
  backgroundColor: '#ffffff',
  border: '1px solid #c9c9cf',
  borderRadius: '4px',
  color: '#18181b',
  fontSize: '13px',
  fontFamily: 'Sarabun, sans-serif',
  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
  padding: '6px 10px',
};

export interface ThailandMapProps {
  /** ชื่อจังหวัด (ภาษาไทย) → ค่าที่จะเอามาระบายสี */
  data: Record<string, number>;
  /** ชื่อค่าที่กำลังแสดง ใช้ในกล่องข้อมูลและคำอธิบายสี เช่น "เหตุการณ์" */
  metricLabel: string;
  /** จังหวัดที่ถูกเลือกอยู่ — วาดเส้นขอบเน้นให้เห็นว่ากรองอยู่ที่ไหน */
  selected?: string | null;
  onSelect?: (province: string) => void;
}

/**
 * แบ่งค่าเป็น 5 ระดับ
 *
 * แบ่งตามช่วงค่าจริงที่มี ไม่ใช่ค่าคงที่ตายตัว เพราะจำนวนเคสต่อจังหวัดโตขึ้นเรื่อยๆ
 * ถ้าใช้ขอบเขตตายตัว วันหนึ่งทุกจังหวัดจะไปกองอยู่ระดับเข้มสุดจนแผนที่ไม่บอกอะไร
 */
function useThresholds(data: Record<string, number>) {
  return useMemo(() => {
    const values = Object.values(data).filter((v) => v > 0);
    if (values.length === 0) return [];
    const max = Math.max(...values);
    // ระดับละเท่าๆ กันจาก 1 ถึงค่าสูงสุด — ค่าน้อยสุด (1 เคส) ต้องได้สีอ่อนสุดเสมอ
    const step = max / RAMP.length;
    return RAMP.map((_, i) => Math.max(1, Math.round(step * (i + 1))));
  }, [data]);
}

export const ThailandMap: React.FC<ThailandMapProps> = ({
  data,
  metricLabel,
  selected = null,
  onSelect,
}) => {
  const [hover, setHover] = useState<{ name: string; value: number; x: number; y: number } | null>(
    null
  );
  const thresholds = useThresholds(data);

  const colorOf = (value: number) => {
    if (!value) return NO_DATA;
    const idx = thresholds.findIndex((t) => value <= t);
    return RAMP[idx === -1 ? RAMP.length - 1 : idx];
  };

  return (
    <div className="relative h-full w-full">
      <svg
        viewBox={`0 0 ${MAP_VIEWBOX.width} ${MAP_VIEWBOX.height}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full"
        role="img"
        aria-label={`แผนที่ประเทศไทยแสดง${metricLabel}รายจังหวัด`}
      >
        {PROVINCE_SHAPES.map((shape) => {
          const value = data[shape.name] ?? 0;
          const isSelected = selected === shape.name;
          return (
            <path
              key={shape.name}
              d={shape.d}
              fill={colorOf(value)}
              stroke={isSelected ? '#18181b' : '#ffffff'}
              strokeWidth={isSelected ? 3 : 0.5}
              className="cursor-pointer transition-opacity hover:opacity-70"
              onMouseMove={(e) => {
                const box = e.currentTarget.ownerSVGElement?.parentElement?.getBoundingClientRect();
                setHover({
                  name: shape.name,
                  value,
                  x: e.clientX - (box?.left ?? 0),
                  y: e.clientY - (box?.top ?? 0),
                });
              }}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect?.(shape.name)}
            />
          );
        })}
      </svg>

      {/* กล่องข้อมูลเป็น HTML ไม่ใช่ <text> ใน SVG เพราะ npm run check:a11y
          อ่าน CSS color แต่ SVG ใช้ fill จึงตรวจความคมชัดของข้อความใน SVG ไม่ได้ */}
      {hover && (
        <div
          style={{
            ...TOOLTIP,
            position: 'absolute',
            left: hover.x + 12,
            top: hover.y + 12,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 10,
          }}
        >
          <span className="font-semibold">{hover.name}</span>
          <span className="ml-2 text-neutral-700">
            {hover.value > 0 ? `${metricLabel} ${hover.value.toLocaleString('th-TH')}` : 'ไม่มีข้อมูล'}
          </span>
        </div>
      )}
    </div>
  );
};

/**
 * แถบคำอธิบายสี
 *
 * แยก export เพราะแดชบอร์ดวางไว้คนละที่กับตัวแผนที่ (ข้างขวา ไม่ใช่ใต้แผนที่)
 * เพื่อใช้พื้นที่แนวนอนที่เหลือจากแผนที่ซึ่งเป็นแนวตั้ง
 */
export const ThailandMapLegend: React.FC<{ data: Record<string, number>; metricLabel: string }> = ({
  data,
  metricLabel,
}) => {
  const thresholds = useThresholds(data);
  if (thresholds.length === 0) {
    return <p className="text-[13px] font-mono text-neutral-600">ยังไม่มีข้อมูลรายจังหวัด</p>;
  }

  return (
    <div>
      <p className="text-[13px] font-mono text-neutral-600 mb-1.5">{metricLabel} (จังหวัด)</p>
      <div className="flex items-center gap-1">
        <span className="text-[13px] font-mono text-neutral-600">น้อย</span>
        {RAMP.map((c, i) => (
          <span
            key={c}
            className="h-3.5 w-6 rounded-[2px]"
            style={{ backgroundColor: c }}
            title={`ถึง ${thresholds[i]}`}
          />
        ))}
        <span className="text-[13px] font-mono text-neutral-600">มาก</span>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className="h-3.5 w-6 rounded-[2px]" style={{ backgroundColor: NO_DATA }} />
        <span className="text-[13px] font-mono text-neutral-600">ไม่มีเคส</span>
      </div>
    </div>
  );
};

export default ThailandMap;
