import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CrimeIncident } from '../types/dataDictionary';
import {
  IncidentRecord,
  IncidentStatus,
  bulkImport,
  createIncident,
  deleteIncident,
  listIncidents,
  setIncidentStatus,
  updateIncident,
} from '../lib/incidentsRepo';

export interface UseIncidentsResult {
  /** เคสที่อนุมัติแล้ว — ใช้ในแดชบอร์ดและฐานข้อมูลเหตุการณ์ */
  approved: IncidentRecord[];
  /** เคสรอตรวจสอบ — ใช้ในคิวตรวจสอบ */
  pending: IncidentRecord[];
  rejected: IncidentRecord[];
  all: IncidentRecord[];
  loading: boolean;
  error: string | null;
  /** เวลาที่โหลดข้อมูลสำเร็จครั้งล่าสุด — ใช้บอกผู้อ่านว่าตัวเลขเป็นของเมื่อไหร่ */
  loadedAt: Date | null;
  redacted: boolean;
  refresh: () => Promise<void>;
  /**
   * บันทึกเคส
   * @param opts.status สถานะที่ต้องการ — ข้อมูลที่มาจาก AI ต้องเป็น 'pending' เพื่อให้ผ่านคิวตรวจสอบ
   *                    ส่วนฟอร์มที่คนกรอกเองถือว่าตรวจแล้ว จึงเป็น 'approved' ได้
   * @param opts.alcohol_involved / alcohol_role คอลัมน์ระบบที่ต้องส่งต่อ ไม่งั้นจะถูกเขียนทับเป็น null
   */
  save: (
    incident: CrimeIncident,
    uuid?: string,
    opts?: { status?: IncidentStatus; alcohol_involved?: boolean; alcohol_role?: string | null }
  ) => Promise<IncidentRecord>;
  changeStatus: (uuid: string, status: IncidentStatus, note?: string) => Promise<void>;
  remove: (uuid: string) => Promise<void>;
  importMany: (incidents: CrimeIncident[], status?: IncidentStatus) => Promise<number>;
}

export function useIncidents(isAuthenticated: boolean, ready: boolean): UseIncidentsResult {
  const [all, setAll] = useState<IncidentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [redacted, setRedacted] = useState(false);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    if (!ready) return;
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      /**
       * ต้องมีเพดานเวลา ไม่ใช่รอไปเรื่อยๆ
       *
       * ทดสอบด้วยการตัดการเชื่อมต่อแล้วพบว่า promise ของ supabase-js ไม่ settle เลย
       * หน้าจอจึงค้างที่ "กำลังโหลดข้อมูลจากฐานข้อมูล..." ตลอดไป
       * ผู้ใช้ไม่มีทางรู้ว่าเกิดอะไรขึ้นและไม่มีปุ่มให้ลองใหม่
       */
      const result = await withTimeout(
        listIncidents({ status: 'ALL' }, isAuthenticated),
        intFromEnv('VITE_LOAD_TIMEOUT_MS', 20_000)
      );
      if (id !== requestId.current) return; // มีคำขอใหม่กว่าแล้ว
      setAll(result.records);
      setRedacted(result.redacted);
      setLoadedAt(new Date());
    } catch (err: any) {
      if (id !== requestId.current) return;
      setError(err?.message ?? 'โหลดข้อมูลไม่สำเร็จ');
      setAll([]);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [isAuthenticated, ready]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (
      incident: CrimeIncident,
      uuid?: string,
      opts: { status?: IncidentStatus; alcohol_involved?: boolean; alcohol_role?: string | null } = {}
    ) => {
      const extra = {
        ...(opts.alcohol_involved !== undefined ? { alcohol_involved: opts.alcohol_involved } : {}),
        ...(opts.alcohol_role !== undefined ? { alcohol_role: opts.alcohol_role } : {}),
      };
      const record = uuid
        ? await updateIncident(uuid, incident, extra)
        : await createIncident(incident, { ...extra, status: opts.status ?? 'approved' });
      setAll((prev) => {
        const without = prev.filter((r) => r.uuid !== record.uuid);
        return [record, ...without];
      });
      return record;
    },
    []
  );

  const changeStatus = useCallback(async (uuid: string, status: IncidentStatus, note?: string) => {
    const record = await setIncidentStatus(uuid, status, note);
    setAll((prev) => prev.map((r) => (r.uuid === record.uuid ? record : r)));
  }, []);

  const remove = useCallback(async (uuid: string) => {
    await deleteIncident(uuid);
    setAll((prev) => prev.filter((r) => r.uuid !== uuid));
  }, []);

  const importMany = useCallback(
    async (incidents: CrimeIncident[], status: IncidentStatus = 'approved') => {
      const count = await bulkImport(incidents, status);
      await refresh();
      return count;
    },
    [refresh]
  );

  const approved = useMemo(() => all.filter((r) => r.status === 'approved'), [all]);
  const pending = useMemo(() => all.filter((r) => r.status === 'pending'), [all]);
  const rejected = useMemo(() => all.filter((r) => r.status === 'rejected'), [all]);

  return {
    approved,
    pending,
    rejected,
    all,
    loading,
    error,
    loadedAt,
    redacted,
    refresh,
    save,
    changeStatus,
    remove,
    importMany,
  };
}

/** อ่านค่าตัวเลขจาก env ของ Vite (ตั้งค่าได้ ไม่ต้องแก้โค้ด) */
function intFromEnv(key: string, fallback: number): number {
  const raw = (import.meta.env as Record<string, string | undefined>)[key];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** ล้มเลิกการรอเมื่อเกินเวลา — กันหน้าจอค้างเมื่อเครือข่ายหลุด */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `เชื่อมต่อฐานข้อมูลไม่ได้ภายใน ${Math.round(ms / 1000)} วินาที — ตรวจการเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่`
          )
        ),
      ms
    );
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}
