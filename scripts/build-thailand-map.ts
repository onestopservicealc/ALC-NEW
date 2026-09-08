/**
 * สร้างข้อมูลรูปร่างจังหวัดสำหรับแผนที่ในหน้าภาพรวมสถิติ
 *
 * ทำไมต้องแปลงล่วงหน้าแทนที่จะฉายพิกัดตอนรัน:
 * การฉายพิกัดต้องใช้ `d3-geo` ซึ่งไม่มีในโปรเจกต์ และการอ่าน GeoJSON ดิบ 1.6 MB
 * ทุกครั้งที่เปิดหน้าเว็บก็สิ้นเปลืองเปล่าๆ ทั้งที่รูปร่างจังหวัดไม่เคยเปลี่ยน
 * สคริปต์นี้จึงฉายพิกัดและย่อรูปทรงครั้งเดียว เก็บผลเป็นสตริง SVG path
 * ฝั่งเว็บจึงแค่เอาไปใส่ `<path d={...} />` ไม่ต้องพึ่งไลบรารีใดเลย
 *
 * ต้องต่ออินเทอร์เน็ต จึง **ไม่ได้อยู่ในขั้นตอน build ปกติ** — รันเมื่อจะปรับความละเอียด
 * หรือเมื่อขอบเขตจังหวัดเปลี่ยน แล้ว commit ไฟล์ผลลัพธ์ลง git
 *
 *   npm run build:map
 *   npm run build:map -- --tolerance 1.0    ละเอียดขึ้น (ไฟล์ใหญ่ขึ้น)
 */
import { writeFileSync } from 'node:fs';
import { THAI_PROVINCES } from '../src/data/thaiProvinces.js';

/**
 * แหล่งข้อมูลขอบเขตจังหวัด — เลือกไฟล์นี้เพราะมี `pro_th` เป็นชื่อไทย
 * ตรงกับ THAI_PROVINCES ครบ 77 จาก 77 จึงไม่ต้องมีตารางเทียบชื่อ
 * และมีบึงกาฬแยกจากหนองคายแล้ว (ไฟล์แผนที่ไทยเก่าหลายไฟล์ยังรวมกันอยู่ เหลือ 76 จังหวัด)
 */
const SOURCE =
  'https://raw.githubusercontent.com/chingchai/OpenGISData-Thailand/master/provinces.geojson';

/** ความกว้างของ viewBox — ความสูงคำนวณจากอัตราส่วนจริงของประเทศ */
const WIDTH = 1000;

/**
 * ระยะที่ยอมให้รูปทรงเพี้ยนได้ตอนย่อ (หน่วยเดียวกับ viewBox)
 * วัดแล้ว: 1.0 ได้ ~104 KB · 1.5 ได้ ~70 KB · 2.5 ได้ ~42 KB
 * 1.5 คือจุดที่ยังเห็นรูปร่างจังหวัดชัดในขนาดการ์ดแดชบอร์ดโดยไฟล์ไม่ใหญ่เกินไป
 */
const DEFAULT_TOLERANCE = 1.5;

type Ring = [number, number][];

interface Feature {
  properties: Record<string, string>;
  geometry: { type: string; coordinates: unknown };
}

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** ดึงวงรอบทั้งหมดออกจาก Polygon หรือ MultiPolygon ให้เป็นรายการเดียว */
function ringsOf(geometry: Feature['geometry']): Ring[] {
  // Polygon เก็บเป็น Ring[] ส่วน MultiPolygon เก็บเป็น Ring[][] — ทำให้เป็นชั้นเดียวกันก่อน
  const polygons =
    geometry.type === 'Polygon'
      ? [geometry.coordinates as Ring[]]
      : (geometry.coordinates as Ring[][]);
  return polygons.flat();
}

/** Web Mercator — ใช้เพราะเป็นระบบเดียวกับแผนที่ออนไลน์ทั่วไป คนไทยจึงคุ้นรูปร่างนี้ */
function mercator(lon: number, lat: number): [number, number] {
  return [lon, (Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 180 / 2)) * 180) / Math.PI];
}

/** ระยะจากจุดถึงเส้นตรง ใช้ตัดสินว่าจุดนั้นสำคัญพอจะเก็บไว้ไหม */
function perpendicular(p: [number, number], a: [number, number], b: [number, number]): number {
  const [x, y] = p;
  const [x1, y1] = a;
  const [x2, y2] = b;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(x - x1, y - y1);
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

/**
 * ย่อจำนวนจุดด้วย Douglas-Peucker
 * เขียนแบบวนลูปไม่ใช้ recursion เพราะบางจังหวัดมีชายฝั่งเป็นหมื่นจุด เรียกซ้ำลึกจน stack ล้น
 */
function simplify(points: Ring, tolerance: number): Ring {
  if (points.length < 3) return points;

  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let maxDist = 0;
    let index = 0;
    for (let i = first + 1; i < last; i++) {
      const d = perpendicular(points[i], points[first], points[last]);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (maxDist > tolerance && index > 0) {
      keep[index] = true;
      stack.push([first, index], [index, last]);
    }
  }

  return points.filter((_, i) => keep[i]);
}

async function main() {
  const tolerance = arg('tolerance', DEFAULT_TOLERANCE);
  console.log(`\nดึงขอบเขตจังหวัดจาก ${new URL(SOURCE).host}...`);

  const res = await fetch(SOURCE);
  if (!res.ok) {
    console.error(`✕ ดึงข้อมูลไม่สำเร็จ (HTTP ${res.status})`);
    process.exit(1);
  }
  const geo = (await res.json()) as { features: Feature[] };
  const features = geo.features ?? [];
  console.log(`ได้ ${features.length} จังหวัด · ย่อรูปทรงที่ tolerance ${tolerance}`);

  /* ---- หาขอบเขตพิกัดเพื่อกำหนด viewBox ---- */
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const f of features) {
    for (const ring of ringsOf(f.geometry)) {
      for (const [lon, lat] of ring) {
        const [x, y] = mercator(lon, lat);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const height = Math.round((WIDTH * (maxY - minY)) / (maxX - minX));

  /* ---- แปลงแต่ละจังหวัดเป็น path ---- */
  const shapes: { name: string; d: string }[] = [];
  for (const f of features) {
    const name = String(f.properties.pro_th ?? '').trim();
    const parts: string[] = [];

    for (const ring of ringsOf(f.geometry)) {
      const projected = ring.map(([lon, lat]) => {
        const [mx, my] = mercator(lon, lat);
        return [
          ((mx - minX) / (maxX - minX)) * WIDTH,
          ((maxY - my) / (maxY - minY)) * height,
        ] as [number, number];
      });
      const small = simplify(projected, tolerance);
      // เหลือน้อยกว่า 3 จุดวาดเป็นรูปปิดไม่ได้ — เป็นเกาะจิ๋วที่ย่อจนหายไป
      if (small.length < 3) continue;
      parts.push(`M${small.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}Z`);
    }

    if (parts.length) shapes.push({ name, d: parts.join('') });
  }

  /* ---- ตรวจก่อนเขียน กันไฟล์ต้นทางเปลี่ยนแล้วเราไม่รู้ตัว ---- */
  const names = new Set(shapes.map((s) => s.name));
  const missing = THAI_PROVINCES.filter((p) => !names.has(p));
  const extra = [...names].filter((n) => !THAI_PROVINCES.includes(n));

  if (missing.length || extra.length || shapes.length !== 77) {
    console.error(`\n✕ ข้อมูลไม่ตรงกับรายชื่อ 77 จังหวัดของระบบ — ไม่เขียนไฟล์`);
    if (shapes.length !== 77) console.error(`  ได้ ${shapes.length} จังหวัด ควรเป็น 77`);
    if (missing.length) console.error(`  ขาด: ${missing.join(', ')}`);
    if (extra.length) console.error(`  เกินมา: ${extra.join(', ')}`);
    process.exit(1);
  }

  /* ---- เขียนไฟล์ ---- */
  // เรียงตามรายชื่อของระบบ ไม่ใช่ลำดับในไฟล์ต้นทาง เพื่อให้ diff อ่านง่ายเมื่อสร้างใหม่
  const ordered = THAI_PROVINCES.map((p) => shapes.find((s) => s.name === p)!);
  const body = ordered.map((s) => `  { name: '${s.name}', d: '${s.d}' },`).join('\n');

  const out = `/**
 * รูปร่าง 77 จังหวัดเป็น SVG path ที่ฉายพิกัดไว้แล้ว
 *
 * ไฟล์นี้สร้างด้วย \`npm run build:map\` — **ห้ามแก้ด้วยมือ**
 * ที่มา: ${SOURCE}
 * ฉายแบบ Web Mercator · ย่อด้วย Douglas-Peucker ที่ tolerance ${tolerance}
 *
 * เก็บเป็นสตริงสำเร็จรูปเพื่อให้ฝั่งเว็บไม่ต้องพึ่ง d3-geo หรือไลบรารีแผนที่ใดๆ
 */

/** ขนาดกรอบที่ path ทั้งหมดอ้างอิง — ต้องใส่ให้ตรงกับ viewBox ของ <svg> */
export const MAP_VIEWBOX = { width: ${WIDTH}, height: ${height} } as const;

export interface ProvinceShape {
  /** ชื่อจังหวัดภาษาไทย ตรงกับ THAI_PROVINCES ทุกตัวอักษร ใช้เป็นกุญแจจับคู่ข้อมูล */
  name: string;
  /** ค่า d ของ <path> */
  d: string;
}

export const PROVINCE_SHAPES: ProvinceShape[] = [
${body}
];
`;

  const path = 'src/data/thailandProvinceShapes.ts';
  writeFileSync(path, out, 'utf8');

  const kb = (out.length / 1024).toFixed(1);
  console.log(`\n✓ ครบ 77 จังหวัด ชื่อตรงกับ THAI_PROVINCES ทั้งหมด`);
  console.log(`✓ เขียน ${path} แล้ว · ${kb} KB · viewBox 0 0 ${WIDTH} ${height}`);
}

void main();
