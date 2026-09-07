/**
 * ชั้นเข้าถึงข้อมูล incidents / articles / sources
 * เรียก Supabase ตรงจาก browser โดยมี RLS เป็นตัวคุมสิทธิ์
 */
import { CSV_HEADER_ARRAY, CrimeIncident } from '../types/dataDictionary';
import { requireSupabase, supabase } from './supabase';

export type IncidentStatus = 'pending' | 'approved' | 'rejected';

/** 49 ฟิลด์ + คอลัมน์ระบบ (`id` = seq เพื่อให้เข้ากับสเปก "ลำดับ" และ CSV เดิม) */
export interface IncidentRecord extends CrimeIncident {
  uuid: string;
  status: IncidentStatus;
  alcohol_involved: boolean | null;
  alcohol_role: string | null;
  source_article_id: string | null;
  ai_model: string | null;
  ai_confidence: number | null;
  ai_adjusted_fields: string[] | null;
  duplicate_of: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string | null;
}

/** ฟิลด์ข้อมูล 48 ตัว (ไม่รวม id ที่ฐานข้อมูลออกให้) */
const DATA_COLUMNS = CSV_HEADER_ARRAY.filter((k) => k !== 'id');

const SYSTEM_COLUMNS = [
  'id',
  'seq',
  'status',
  'alcohol_involved',
  'alcohol_role',
  'source_article_id',
  'ai_model',
  'ai_confidence',
  'ai_adjusted_fields',
  'duplicate_of',
  'reviewed_by',
  'reviewed_at',
  'review_note',
  'created_at',
];

const FULL_SELECT = [...SYSTEM_COLUMNS, ...DATA_COLUMNS].join(', ');

const PUBLIC_SELECT = [
  'seq',
  'alcohol_involved',
  'alcohol_role',
  ...DATA_COLUMNS.filter((k) => !k.endsWith('_name') || k === 'news_agency'),
].join(', ');

const EMPTY_NAME_FIELDS = [
  'perpetrator_name',
  'victim_1_name',
  'victim_2_name',
  'victim_3_name',
] as const;

function rowToRecord(row: Record<string, any>, isPublicView: boolean): IncidentRecord {
  const base: Record<string, any> = { ...row };

  base.id = Number(row.seq ?? 0);
  base.uuid = isPublicView ? '' : String(row.id ?? '');
  delete base.seq;

  if (isPublicView) {
    base.status = 'approved';
    for (const field of EMPTY_NAME_FIELDS) base[field] = '';
    base.ai_confidence = null;
    base.ai_adjusted_fields = null;
    base.duplicate_of = null;
    base.source_article_id = null;
  }

  // ให้ฟิลด์ข้อความไม่เป็น null เพื่อให้ฟอร์มและ CSV เดิมทำงานได้เหมือนเดิม
  for (const key of DATA_COLUMNS) {
    if (base[key] === null || base[key] === undefined) {
      const numeric = [
        'perpetrator_age', 'alcohol_level', 'test_duration', 'total_affected',
        'total_death', 'total_injury', 'victim_1_age', 'victim_2_age', 'victim_3_age',
      ];
      base[key] = numeric.includes(key) ? null : '';
    }
  }

  return base as IncidentRecord;
}

export interface ListFilters {
  status?: IncidentStatus | 'ALL';
  province?: string;
  newsType?: string;
  search?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface ListResult {
  records: IncidentRecord[];
  total: number;
  /** true เมื่ออ่านผ่าน view สาธารณะ (ไม่มีชื่อบุคคล) */
  redacted: boolean;
}

/**
 * ผู้ล็อกอินอ่านตาราง incidents ได้ทุกสถานะ
 * ผู้ไม่ล็อกอินถูก RLS ปฏิเสธ จึงอ่านผ่าน view incidents_public แทนโดยอัตโนมัติ
 */
export async function listIncidents(
  filters: ListFilters = {},
  isAuthenticated = false
): Promise<ListResult> {
  const db = requireSupabase();
  const limit = filters.limit ?? 2000;
  const offset = filters.offset ?? 0;
  const useView = !isAuthenticated;

  let query = useView
    ? db.from('incidents_public').select(PUBLIC_SELECT, { count: 'exact' })
    : db.from('incidents').select(FULL_SELECT, { count: 'exact' });

  if (!useView && filters.status && filters.status !== 'ALL') {
    query = query.eq('status', filters.status);
  }
  if (filters.province) query = query.eq('province', filters.province);
  if (filters.newsType) query = query.eq('news_type', filters.newsType);
  if (filters.from) query = query.gte('incident_date', filters.from);
  if (filters.to) query = query.lte('incident_date', filters.to);
  if (filters.search) {
    const term = `%${filters.search}%`;
    query = query.or(
      `news_title.ilike.${term},news_summary.ilike.${term},province.ilike.${term},district.ilike.${term}`
    );
  }

  const { data, error, count } = await query
    .order('incident_date', { ascending: false, nullsFirst: false })
    .order('seq', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw new Error(`โหลดข้อมูลไม่สำเร็จ: ${error.message}`);

  return {
    records: (data ?? []).map((row) => rowToRecord(row as Record<string, any>, useView)),
    total: count ?? 0,
    redacted: useView,
  };
}

function toDbPayload(incident: Partial<CrimeIncident>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const key of DATA_COLUMNS) {
    if (!(key in incident)) continue;
    const value = (incident as any)[key];
    // ฐานข้อมูลเก็บ incident_date เป็น date — สตริงว่างจะทำให้ insert ล้ม
    payload[key] = key === 'incident_date' && !value ? null : value;
  }
  return payload;
}

export async function createIncident(
  incident: CrimeIncident,
  extra: { alcohol_involved?: boolean; alcohol_role?: string | null; status?: IncidentStatus } = {}
): Promise<IncidentRecord> {
  const db = requireSupabase();
  const { data: userData } = await db.auth.getUser();

  const { data, error } = await db
    .from('incidents')
    .insert({
      ...toDbPayload(incident),
      status: extra.status ?? 'approved',
      alcohol_involved: extra.alcohol_involved ?? null,
      alcohol_role: extra.alcohol_role ?? null,
      created_by: userData.user?.id ?? null,
    })
    .select(FULL_SELECT)
    .single();

  if (error) throw new Error(`บันทึกไม่สำเร็จ: ${error.message}`);

  const record = rowToRecord(data as Record<string, any>, false);
  await logRevision(record.uuid, 'create');
  return record;
}

export async function updateIncident(
  uuid: string,
  incident: Partial<CrimeIncident>,
  extra: { alcohol_involved?: boolean; alcohol_role?: string | null } = {}
): Promise<IncidentRecord> {
  const db = requireSupabase();
  const patch: Record<string, unknown> = toDbPayload(incident);
  if (extra.alcohol_involved !== undefined) patch.alcohol_involved = extra.alcohol_involved;
  if (extra.alcohol_role !== undefined) patch.alcohol_role = extra.alcohol_role;

  const { data, error } = await db
    .from('incidents')
    .update(patch)
    .eq('id', uuid)
    .select(FULL_SELECT)
    .single();

  if (error) throw new Error(`แก้ไขไม่สำเร็จ: ${error.message}`);
  await logRevision(uuid, 'update');
  return rowToRecord(data as Record<string, any>, false);
}

export async function setIncidentStatus(
  uuid: string,
  status: IncidentStatus,
  note?: string
): Promise<IncidentRecord> {
  const db = requireSupabase();
  const { data: userData } = await db.auth.getUser();

  const { data, error } = await db
    .from('incidents')
    .update({
      status,
      reviewed_by: userData.user?.id ?? null,
      reviewed_at: new Date().toISOString(),
      review_note: note ?? null,
    })
    .eq('id', uuid)
    .select(FULL_SELECT)
    .single();

  if (error) throw new Error(`เปลี่ยนสถานะไม่สำเร็จ: ${error.message}`);
  await logRevision(uuid, status === 'approved' ? 'approve' : status === 'rejected' ? 'reject' : 'update', note);
  return rowToRecord(data as Record<string, any>, false);
}

export async function deleteIncident(uuid: string): Promise<void> {
  const db = requireSupabase();
  const { error } = await db.from('incidents').delete().eq('id', uuid);
  if (error) throw new Error(`ลบไม่สำเร็จ: ${error.message}`);
}

/**
 * รวมเคสซ้ำ: ต่อ url / news_agency / news_title ของเคสใหม่เข้ากับเคสหลักด้วย ;
 * ตามที่สเปกกำหนดให้ฟิลด์เหล่านี้เป็น multi-value
 */
export async function mergeIntoIncident(
  duplicateUuid: string,
  targetUuid: string
): Promise<IncidentRecord> {
  const db = requireSupabase();

  const { data: rows, error: readError } = await db
    .from('incidents')
    .select('id, url, news_agency, news_title')
    .in('id', [duplicateUuid, targetUuid]);

  if (readError) throw new Error(`อ่านข้อมูลเพื่อรวมไม่สำเร็จ: ${readError.message}`);

  const source = rows?.find((r) => r.id === duplicateUuid);
  const target = rows?.find((r) => r.id === targetUuid);
  if (!source || !target) throw new Error('ไม่พบเคสที่จะรวม');

  const join = (a: string | null, b: string | null): string => {
    const parts = [...String(a ?? '').split(';'), ...String(b ?? '').split(';')]
      .map((s) => s.trim())
      .filter(Boolean);
    return Array.from(new Set(parts)).join(';');
  };

  const { data, error } = await db
    .from('incidents')
    .update({
      url: join(target.url, source.url),
      news_agency: join(target.news_agency, source.news_agency),
      news_title: join(target.news_title, source.news_title),
    })
    .eq('id', targetUuid)
    .select(FULL_SELECT)
    .single();

  if (error) throw new Error(`รวมเคสไม่สำเร็จ: ${error.message}`);

  await db
    .from('incidents')
    .update({ status: 'rejected', duplicate_of: targetUuid, review_note: 'รวมเข้ากับเคสหลักแล้ว' })
    .eq('id', duplicateUuid);

  await logRevision(targetUuid, 'merge', `รวมจากเคส ${duplicateUuid}`);
  return rowToRecord(data as Record<string, any>, false);
}

export async function bulkImport(
  incidents: CrimeIncident[],
  status: IncidentStatus = 'approved'
): Promise<number> {
  const db = requireSupabase();
  const { data: userData } = await db.auth.getUser();

  const rows = incidents.map((incident) => ({
    ...toDbPayload(incident),
    status,
    created_by: userData.user?.id ?? null,
  }));

  let inserted = 0;
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { data, error } = await db
      .from('incidents')
      .insert(rows.slice(i, i + CHUNK))
      .select('id');
    if (error) throw new Error(`นำเข้าล้มเหลวที่แถว ${i + 1}: ${error.message}`);
    inserted += data?.length ?? 0;
  }
  return inserted;
}

async function logRevision(
  incidentId: string,
  action: 'create' | 'update' | 'approve' | 'reject' | 'merge' | 'delete',
  note?: string
): Promise<void> {
  if (!supabase || !incidentId) return;
  const { data: userData } = await supabase.auth.getUser();
  await supabase.from('incident_revisions').insert({
    incident_id: incidentId,
    action,
    changed_by: userData.user?.id ?? null,
    note: note ?? null,
  });
}

/* ------------------------------------------------------------------ */
/* articles / sources                                                  */
/* ------------------------------------------------------------------ */

export interface ArticleRow {
  id: string;
  source_id: string | null;
  url: string | null;
  gnews_link: string | null;
  news_agency: string | null;
  title: string;
  published_at: string | null;
  rss_summary: string | null;
  screen_status: string;
  screen_score: number | null;
  screen_reason: string | null;
  ai_confidence: number | null;
  created_at: string;
}

export async function listArticles(
  status: string,
  limit = 100
): Promise<ArticleRow[]> {
  const db = requireSupabase();
  const { data, error } = await db
    .from('articles')
    .select(
      'id, source_id, url, gnews_link, news_agency, title, published_at, rss_summary, screen_status, screen_score, screen_reason, ai_confidence, created_at'
    )
    .eq('screen_status', status)
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) throw new Error(`โหลดรายการข่าวไม่สำเร็จ: ${error.message}`);
  return (data ?? []) as ArticleRow[];
}

export interface SourceRow {
  id: string;
  name: string;
  kind: 'outlet_rss' | 'google_news' | 'sitemap';
  feed_url: string;
  query: string | null;
  domain: string | null;
  /** regex คัด <loc> ที่เป็นหน้าบทความ (ใช้เฉพาะ kind = sitemap) */
  article_pattern: string | null;
  enabled: boolean;
  has_full_text: boolean;
  poll_priority: number;
  last_polled_at: string | null;
  last_ok_at: string | null;
  last_item_count: number | null;
  consecutive_errors: number;
  last_error: string | null;
}

export async function listSources(): Promise<SourceRow[]> {
  const db = requireSupabase();
  const { data, error } = await db
    .from('sources')
    .select('*')
    .order('kind', { ascending: true })
    .order('poll_priority', { ascending: true });
  if (error) throw new Error(`โหลดแหล่งข่าวไม่สำเร็จ: ${error.message}`);
  return (data ?? []) as SourceRow[];
}

export async function updateSource(id: string, patch: Partial<SourceRow>): Promise<void> {
  const db = requireSupabase();
  const { error } = await db.from('sources').update(patch).eq('id', id);
  if (error) throw new Error(`แก้ไขแหล่งข่าวไม่สำเร็จ: ${error.message}`);
}

export async function createSource(source: Partial<SourceRow>): Promise<void> {
  const db = requireSupabase();
  const { error } = await db.from('sources').insert(source);
  if (error) throw new Error(`เพิ่มแหล่งข่าวไม่สำเร็จ: ${error.message}`);
}

export async function deleteSource(id: string): Promise<void> {
  const db = requireSupabase();
  const { error } = await db.from('sources').delete().eq('id', id);
  if (error) throw new Error(`ลบแหล่งข่าวไม่สำเร็จ: ${error.message}`);
}

export interface IngestRunRow {
  id: string;
  trigger: string;
  started_at: string;
  finished_at: string | null;
  feeds_polled: number;
  feeds_failed: number;
  articles_new: number;
  keyword_passed: number;
  keyword_rejected: number;
  ai_screened: number;
  ai_rejected: number;
  incidents_created: number;
  duplicates_found: number;
  errors: { where: string; message: string }[];
  notes: string | null;
}

export async function listIngestRuns(limit = 20): Promise<IngestRunRow[]> {
  const db = requireSupabase();
  const { data, error } = await db
    .from('ingest_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`โหลดประวัติการดึงข่าวไม่สำเร็จ: ${error.message}`);
  return (data ?? []) as IngestRunRow[];
}

export interface QueueSummary {
  articles: Record<string, number>;
  incidents: Record<string, number>;
  last_run: IngestRunRow | null;
}

export async function fetchQueueSummary(): Promise<QueueSummary> {
  const db = requireSupabase();
  const { data, error } = await db.rpc('queue_summary');
  if (error) throw new Error(`โหลดสรุปคิวไม่สำเร็จ: ${error.message}`);
  return (data ?? { articles: {}, incidents: {}, last_run: null }) as QueueSummary;
}

export async function findDuplicates(
  date: string | null,
  province: string | null,
  title: string
): Promise<{ id: string; seq: number; news_title: string; sim: number }[]> {
  const db = requireSupabase();
  const { data, error } = await db.rpc('find_duplicate_incident', {
    p_date: date || null,
    p_province: province || null,
    p_title: title,
  });
  if (error) return [];
  return (data ?? []) as { id: string; seq: number; news_title: string; sim: number }[];
}

/**
 * ปฏิเสธ lead ที่ชัดเจนว่าไม่เข้าเกณฑ์ (เช่นข่าวสถิติรวม ไม่ใช่เหตุการณ์)
 *
 * เดิมไม่มีทางเอา lead ออกจากคิวได้เลยนอกจากหา URL มาให้ — รายการที่ไม่เกี่ยวข้อง
 * จึงค้างอยู่ตลอดไป เก็บเป็น keyword_reject พร้อมเหตุผล ไม่ลบทิ้ง
 * เพื่อให้ตรวจย้อนหลังและใช้จูนตัวกรองได้
 */
export async function rejectLead(articleId: string, reason: string): Promise<void> {
  const db = requireSupabase();
  const { error } = await db
    .from('articles')
    .update({
      screen_status: 'keyword_reject',
      screen_reason: reason,
      processed_at: new Date().toISOString(),
    })
    .eq('id', articleId);
  if (error) throw new Error(`ปฏิเสธรายการไม่สำเร็จ: ${error.message}`);
}
