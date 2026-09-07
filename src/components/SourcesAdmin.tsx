import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  Map,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Rss,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  IngestRunRow,
  QueueSummary,
  SourceRow,
  createSource,
  deleteSource,
  fetchQueueSummary,
  listIngestRuns,
  listSources,
  updateSource,
} from '../lib/incidentsRepo';
import { callApi } from '../lib/supabase';

interface SourcesAdminProps {
  canEdit: boolean;
  isAdmin: boolean;
  onToast: (message: string, type?: 'success' | 'info') => void;
}

interface IngestSummaryResponse {
  success: boolean;
  summary: {
    feeds_polled: number;
    feeds_failed: number;
    articles_new: number;
    keyword_passed: number;
    keyword_rejected: number;
    ai_screened: number;
    ai_rejected: number;
    incidents_created: number;
    duplicates_found: number;
    elapsed_ms: number;
    stopped_reason: string;
    errors: { where: string; message: string }[];
  };
}

/**
 * ป้ายชื่อสถานะในคิวข่าวดิบ
 *
 * ต้องครบทุกค่าใน CHECK constraint ของ `articles.screen_status` —
 * ถ้าตกค่าไหน จำนวนของสถานะนั้นจะไม่ปรากฏบนหน้าจอเลย
 * (เคยตก `needs_fetch` ที่เพิ่มใน migration 0008 ทำให้ 411 แถวหายไปจากสายตา)
 */
const STATUS_LABELS: Record<string, string> = {
  new: 'รอคัดกรอง',
  needs_fetch: 'รอดึงหน้าเว็บ',
  keyword_pass: 'ผ่านคัดกรอง รอ AI',
  needs_url: 'รอยืนยันลิงก์',
  extracted: 'สกัดแล้ว',
  keyword_reject: 'ไม่ผ่านคัดกรอง',
  ai_reject: 'AI ตัดออก',
  fetch_failed: 'ดึงเนื้อข่าวไม่ได้',
};

/** สถานะที่เป็น "งานค้างรอระบบทำต่อ" — ใช้คิดเวลาที่จะระบายหมด */
const BACKLOG_STATUSES = ['new', 'needs_fetch', 'keyword_pass'] as const;

/** เพดานต่อรอบตามค่าเริ่มต้นใน api/_lib/ingest.ts — ใช้ประมาณเวลาระบายคิว */
const PER_TICK = { new: 500, needs_fetch: 150, keyword_pass: 40 };
const TICKS_PER_DAY = 8;

/** ประมาณว่าอีกกี่วันคิวจะหมด จากอัตราที่ตั้งไว้จริง */
function estimateDrainDays(articles: Record<string, number>): number {
  let worst = 0;
  for (const st of BACKLOG_STATUSES) {
    const n = articles[st] ?? 0;
    if (n === 0) continue;
    worst = Math.max(worst, n / (PER_TICK[st] * TICKS_PER_DAY));
  }
  return worst;
}

export const SourcesAdmin: React.FC<SourcesAdminProps> = ({ canEdit, isAdmin, onToast }) => {
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [runs, setRuns] = useState<IngestRunRow[]>([]);
  const [summary, setSummary] = useState<QueueSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<IngestSummaryResponse['summary'] | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({
    name: '',
    feed_url: '',
    kind: 'outlet_rss' as SourceRow['kind'],
    article_pattern: '',
  });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, r, q] = await Promise.all([listSources(), listIngestRuns(10), fetchQueueSummary()]);
      setSources(s);
      setRuns(r);
      setSummary(q);
    } catch (err: any) {
      setError(err?.message ?? 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleRunIngest = async (sourceIds?: string[]) => {
    setRunning(true);
    try {
      const res = await callApi<IngestSummaryResponse>('/api/ingest/run', {
        sourceIds,
        maxArticles: sourceIds ? 5 : undefined,
      });
      setLastRun(res.summary);
      onToast(
        `ดึงข่าวเสร็จ: ข่าวใหม่ ${res.summary.articles_new} · ผ่านคัดกรอง ${res.summary.keyword_passed} · เข้าคิว ${res.summary.incidents_created}`
      );
      await load();
    } catch (err: any) {
      onToast(err?.message ?? 'ดึงข่าวไม่สำเร็จ', 'info');
    } finally {
      setRunning(false);
    }
  };

  const handleToggle = async (source: SourceRow) => {
    try {
      await updateSource(source.id, { enabled: !source.enabled });
      setSources((prev) =>
        prev.map((s) => (s.id === source.id ? { ...s, enabled: !s.enabled } : s))
      );
    } catch (err: any) {
      onToast(err?.message ?? 'แก้ไขไม่สำเร็จ', 'info');
    }
  };

  const handleDelete = async (source: SourceRow) => {
    if (!window.confirm(`ลบแหล่งข่าว "${source.name}" ออกจากระบบ?`)) return;
    try {
      await deleteSource(source.id);
      setSources((prev) => prev.filter((s) => s.id !== source.id));
      onToast('ลบแหล่งข่าวแล้ว', 'info');
    } catch (err: any) {
      onToast(err?.message ?? 'ลบไม่สำเร็จ', 'info');
    }
  };

  const handleAdd = async () => {
    if (!draft.name.trim() || !draft.feed_url.trim()) return;
    try {
      let domain: string | null = null;
      try {
        domain = new URL(draft.feed_url).host.replace(/^www\./, '');
      } catch {
        /* ปล่อยเป็น null ถ้า URL ไม่ถูกต้อง — ระบบจะรายงานตอนดึงฟีด */
      }
      await createSource({
        name: draft.name.trim(),
        feed_url: draft.feed_url.trim(),
        kind: draft.kind,
        // article_pattern ใช้เฉพาะ sitemap — ชนิดอื่นต้องเป็น null ไม่ใช่สตริงว่าง
        article_pattern: draft.kind === 'sitemap' ? draft.article_pattern.trim() || null : null,
        domain,
        enabled: true,
        // sitemap ต้องดึงหน้าเว็บหลายร้อยหน้าต่อรอบ ให้ทำทีหลังฟีดที่ได้ผลเร็ว
        poll_priority: draft.kind === 'sitemap' ? 200 : 50,
      });
      setDraft({ name: '', feed_url: '', kind: 'outlet_rss', article_pattern: '' });
      setShowAdd(false);
      onToast('เพิ่มแหล่งข่าวแล้ว — กดทดสอบเพื่อดูว่าฟีดใช้ได้จริง');
      await load();
    } catch (err: any) {
      onToast(err?.message ?? 'เพิ่มไม่สำเร็จ', 'info');
    }
  };

  const outletSources = sources.filter((s) => s.kind === 'outlet_rss');
  const gnewsSources = sources.filter((s) => s.kind === 'google_news');
  /**
   * แหล่งข่าวชนิด sitemap
   *
   * เดิมกรองแค่สองชนิดข้างบน แหล่งชนิดนี้จึงไม่ปรากฏในหน้าจอเลย —
   * ทั้งที่ช่อง 7 (500 หน้า/วัน) กับ Thai PBS เป็นต้นทางที่ให้ข่าวครบที่สุด
   * ผู้ดูแลดูสถานะ ปิดใช้งาน หรือทดสอบไม่ได้
   */
  const sitemapSources = sources.filter((s) => s.kind === 'sitemap');

  /**
   * cron ยังทำงานอยู่ไหม
   *
   * หน้าจอเดิมประกาศว่า "ดึงข่าวอัตโนมัติทุก ~3 ชั่วโมง" เป็นข้อความคงที่
   * ถ้า cron ตายไปหลายวันก็ยังขึ้นข้อความเดิม ไม่มีใครรู้
   */
  const lastOkAt = sources
    .filter((x) => x.enabled && x.last_ok_at)
    .map((x) => new Date(x.last_ok_at as string).getTime())
    .reduce((a, b) => Math.max(a, b), 0);
  const hoursSinceOk = lastOkAt > 0 ? (Date.now() - lastOkAt) / 3_600_000 : null;
  const cronStale = hoursSinceOk !== null && hoursSinceOk > 6;

  return (
    <div className="space-y-5">
      <header className="bg-white border border-neutral-200 rounded-sm p-5 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-sm bg-neutral-100 border border-neutral-300">
              <Rss className="w-5 h-5 text-neutral-900" />
            </div>
            <div>
              <span className="text-xs  font-mono uppercase text-neutral-600">
                ดึงข่าวอัตโนมัติจากแหล่งข่าว
              </span>
              <h2 className="font-serif text-2xl text-neutral-900 italic tracking-wide">
                แหล่งข่าวและการดึงข้อมูล
              </h2>
              <p className="text-xs text-neutral-600 mt-1 font-sans">
                ระบบดึงข่าวอัตโนมัติทุก ~3 ชั่วโมง (Vercel Cron 8 รอบต่อวัน) กดปุ่มด้านขวาเพื่อสั่งดึงทันที
              </p>
              {/* สถานะจริงของการดึงอัตโนมัติ ไม่ใช่คำโฆษณา */}
              {hoursSinceOk !== null && (
                <p
                  className={`text-[13px] mt-1 font-sans flex items-center gap-1.5 ${
                    cronStale ? 'text-red-700' : 'text-neutral-700'
                  }`}
                >
                  {cronStale ? (
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  )}
                  {cronStale
                    ? `ดึงข่าวสำเร็จครั้งล่าสุดเมื่อ ${
                        hoursSinceOk < 48
                          ? `${Math.round(hoursSinceOk)} ชั่วโมงที่แล้ว`
                          : `${Math.round(hoursSinceOk / 24)} วันที่แล้ว`
                      } — การดึงอัตโนมัติอาจหยุดทำงาน ควรตรวจ cron และคีย์ที่ตั้งไว้`
                    : `ดึงข่าวสำเร็จครั้งล่าสุดเมื่อ ${
                        hoursSinceOk < 1 ? 'ไม่ถึงชั่วโมงที่แล้ว' : `${Math.round(hoursSinceOk)} ชั่วโมงที่แล้ว`
                      }`}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => void load()}
              className="flex items-center gap-1.5 text-xs font-mono text-neutral-700 bg-neutral-50 hover:bg-neutral-100 border border-neutral-200 px-3 py-2 rounded-sm"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>โหลดใหม่</span>
            </button>
            <button
              onClick={() => void handleRunIngest()}
              disabled={!canEdit || running}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-mono font-bold  text-white bg-neutral-900 hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed rounded-sm"
            >
              {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              <span>{running ? 'กำลังดึงข่าว...' : 'ดึงข่าวเดี๋ยวนี้'}</span>
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="p-3.5 bg-neutral-100 border border-red-200 rounded-sm text-xs text-red-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* สรุปคิว */}
      {summary && (
        <>
          {/*
            งานค้างและเวลาที่คาดว่าจะระบายหมด

            เดิมหน้าจอแสดงแค่ตัวเลขดิบ ผู้ดูแลเห็น "รอคัดกรอง 14,032" แล้วไม่มีทางรู้ว่า
            จะรอ 3 วันหรือ 3 เดือน และไม่มีทางเร่งได้จากหน้าจอ
          */}
          {(() => {
            const backlog = BACKLOG_STATUSES.reduce((n, st) => n + (summary.articles[st] ?? 0), 0);
            if (backlog === 0) return null;
            const days = estimateDrainDays(summary.articles);
            const eta =
              days < 1 ? 'ไม่ถึง 1 วัน' : days < 2 ? 'ประมาณ 1-2 วัน' : `ประมาณ ${Math.ceil(days)} วัน`;
            return (
              <div className="bg-white border border-red-200 rounded-sm p-4 flex flex-wrap items-center gap-x-5 gap-y-2">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-red-700 shrink-0" />
                  <span className="text-xs font-sans text-neutral-800">
                    งานค้างรอระบบทำต่อ{' '}
                    <span className="font-mono text-red-700">{backlog.toLocaleString('th-TH')}</span> รายการ
                  </span>
                </div>
                <span className="text-xs font-sans text-neutral-600">
                  ที่อัตราปัจจุบัน ({PER_TICK.new}/รอบ × {TICKS_PER_DAY} รอบต่อวัน) จะหมดใน{' '}
                  <span className="text-neutral-800">{eta}</span>
                </span>
                <span className="text-[13px] font-sans text-neutral-600 w-full">
                  เร่งได้ด้วยการกดปุ่มดึงข่าวซ้ำหลายครั้ง — ขั้นคัดกรองด้วยคำสำคัญไม่มีค่าใช้จ่าย
                  ส่วนขั้น AI จำกัดด้วยโควตารายวัน
                </span>
              </div>
            );
          })()}

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            {Object.entries(STATUS_LABELS).map(([key, label]) => {
              const n = summary.articles[key] ?? 0;
              const isBacklog = (BACKLOG_STATUSES as readonly string[]).includes(key);
              return (
                <div
                  key={key}
                  className={`bg-white border rounded-sm p-3 ${
                    isBacklog && n > 0 ? 'border-red-200' : 'border-neutral-200'
                  }`}
                >
                  <span className="block text-[13px] uppercase font-mono tracking-wider text-neutral-600">
                    {label}
                  </span>
                  <span
                    className={`text-lg font-serif ${
                      isBacklog && n > 0 ? 'text-red-700' : 'text-neutral-900'
                    }`}
                  >
                    {n.toLocaleString('th-TH')}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {lastRun && (
        <div className="bg-white border border-neutral-200 rounded-sm p-4 text-xs font-mono text-neutral-700 space-y-1.5">
          <div className="flex items-center gap-2 text-neutral-900">
            <CheckCircle2 className="w-4 h-4 text-neutral-900" />
            <span className="font-bold ">ผลการดึงข่าวรอบล่าสุด</span>
            <span className="text-neutral-600">({Math.round(lastRun.elapsed_ms / 1000)} วินาที)</span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-neutral-600">
            <span>ฟีดที่ดึงสำเร็จ {lastRun.feeds_polled}</span>
            <span className={lastRun.feeds_failed > 0 ? 'text-red-700' : ''}>
              ฟีดที่ล้มเหลว {lastRun.feeds_failed}
            </span>
            <span>ข่าวใหม่ {lastRun.articles_new}</span>
            <span>ผ่านคัดกรอง {lastRun.keyword_passed}</span>
            <span>ตัดออกด้วย keyword {lastRun.keyword_rejected}</span>
            <span>ส่งให้ AI {lastRun.ai_screened}</span>
            <span>AI ตัดออก {lastRun.ai_rejected}</span>
            <span className="text-neutral-900">เข้าคิวตรวจสอบ {lastRun.incidents_created}</span>
            <span>สงสัยซ้ำ {lastRun.duplicates_found}</span>
          </div>
          <p className="text-neutral-600">{lastRun.stopped_reason}</p>
          {lastRun.errors.length > 0 && (
            <details className="text-red-700">
              <summary className="cursor-pointer">ข้อผิดพลาด {lastRun.errors.length} รายการ</summary>
              <ul className="mt-1 space-y-0.5 text-neutral-600 list-disc list-inside">
                {lastRun.errors.slice(0, 15).map((e, i) => (
                  <li key={i}>
                    <span className="text-red-700">{e.where}</span>: {e.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <SourceTable
        title="RSS สำนักข่าวโดยตรง"
        subtitle="ได้ URL จริงและเนื้อข่าวเต็ม — เป็นเชื้อเพลิงหลักของการสกัด 49 ฟิลด์"
        sources={outletSources}
        isAdmin={isAdmin}
        canEdit={canEdit}
        running={running}
        onToggle={handleToggle}
        onDelete={handleDelete}
        onTest={(id) => void handleRunIngest([id])}
      />

      <SourceTable
        title="Sitemap สำนักข่าว"
        subtitle="สำนักที่ไม่มี RSS แต่มี sitemap — ระบบไล่ดึงหน้าบทความเอง ได้ข่าวครบทุกเรื่องพร้อมเนื้อเต็ม"
        icon={Map}
        sources={sitemapSources}
        isAdmin={isAdmin}
        canEdit={canEdit}
        running={running}
        onToggle={handleToggle}
        onDelete={handleDelete}
        onTest={(id) => void handleRunIngest([id])}
      />

      <SourceTable
        title="Google News (ตัวจับสัญญาณ)"
        subtitle="ได้พาดหัวและชื่อสำนักข่าว แต่ Google เข้ารหัสลิงก์ไว้ — รายการจะเข้าแท็บ “ต้องยืนยันลิงก์”"
        sources={gnewsSources}
        isAdmin={isAdmin}
        canEdit={canEdit}
        running={running}
        onToggle={handleToggle}
        onDelete={handleDelete}
        onTest={(id) => void handleRunIngest([id])}
      />

      {isAdmin && (
        <div className="bg-white border border-neutral-200 rounded-sm p-4">
          {showAdd ? (
            <div className="space-y-3">
              <h4 className="text-xs font-mono font-bold  text-neutral-800">
                เพิ่มแหล่งข่าวใหม่
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder="ชื่อสำนักข่าว"
                  className="bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-2 text-xs text-neutral-800 focus:outline-none focus:border-neutral-400 font-sans"
                />
                {/* เดิมชนิดถูกล็อกเป็น outlet_rss เพิ่มแหล่ง sitemap ต้องเข้าไปเขียน SQL เอง */}
                <select
                  value={draft.kind}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, kind: e.target.value as SourceRow['kind'] }))
                  }
                  className="bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-2 text-xs text-neutral-800 focus:outline-none focus:border-neutral-400 font-sans"
                >
                  <option value="outlet_rss">RSS สำนักข่าวโดยตรง</option>
                  <option value="sitemap">Sitemap สำนักข่าว</option>
                  <option value="google_news">Google News (ตัวจับสัญญาณ)</option>
                </select>
                <input
                  value={draft.feed_url}
                  onChange={(e) => setDraft((d) => ({ ...d, feed_url: e.target.value }))}
                  placeholder={
                    draft.kind === 'sitemap'
                      ? 'https://example.co.th/sitemap.xml'
                      : 'https://example.co.th/feed'
                  }
                  className="bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-2 text-xs text-neutral-800 focus:outline-none focus:border-neutral-400 font-mono"
                />
              </div>

              {draft.kind === 'sitemap' && (
                <div>
                  <label className="block text-xs uppercase font-mono tracking-wider text-neutral-600 mb-1">
                    รูปแบบ URL ของหน้าบทความ (regex)
                  </label>
                  <input
                    value={draft.article_pattern}
                    onChange={(e) => setDraft((d) => ({ ...d, article_pattern: e.target.value }))}
                    placeholder="/detail/[0-9]+"
                    className="w-full bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-2 text-xs text-neutral-800 focus:outline-none focus:border-neutral-400 font-mono"
                  />
                  <p className="mt-1 text-[13px] text-neutral-600 font-sans">
                    sitemap มีทั้งหน้าบทความและหน้าหมวด — ใส่รูปแบบนี้เพื่อคัดเฉพาะหน้าบทความ
                    เช่น ช่อง 7 ใช้ <span className="font-mono text-neutral-600">/detail/[0-9]+</span> ·
                    Thai PBS ใช้ <span className="font-mono text-neutral-600">/news/content/[0-9]+</span> ·
                    เว้นว่างได้ แต่ระบบจะไปดึงหน้าหมวดปนมาด้วย
                  </p>
                </div>
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void handleAdd()}
                  className="px-3 py-1.5 text-[13px] font-mono bg-neutral-900 hover:bg-black text-white rounded-sm font-bold "
                >
                  เพิ่ม
                </button>
                <button
                  onClick={() => setShowAdd(false)}
                  className="px-3 py-1.5 text-[13px] font-mono text-neutral-600 hover:text-neutral-800"
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 text-xs font-mono text-neutral-700 hover:text-white"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>เพิ่มแหล่งข่าวใหม่</span>
            </button>
          )}
        </div>
      )}

      {/* ประวัติการดึงข่าว */}
      <div className="bg-white border border-neutral-200 rounded-sm shadow-xl">
        <div className="px-5 py-3 border-b border-neutral-200 flex items-center gap-2">
          <Radio className="w-3.5 h-3.5 text-neutral-600" />
          <h3 className="text-xs font-mono font-bold  text-neutral-800">
            ประวัติการดึงข่าว
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead className="text-xs  text-neutral-600 border-b border-neutral-200">
              <tr>
                <th className="text-left px-4 py-2">เริ่ม</th>
                <th className="text-left px-4 py-2">ประเภท</th>
                <th className="text-right px-4 py-2">ฟีด</th>
                <th className="text-right px-4 py-2">ข่าวใหม่</th>
                <th className="text-right px-4 py-2">ผ่านกรอง</th>
                <th className="text-right px-4 py-2">AI</th>
                <th className="text-right px-4 py-2">เข้าคิว</th>
                <th className="text-right px-4 py-2">ข้อผิดพลาด</th>
                <th className="text-left px-4 py-2">หมายเหตุ</th>
              </tr>
            </thead>
            <tbody className="text-neutral-700">
              {runs.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-neutral-600 font-sans">
                    ยังไม่เคยดึงข่าว
                  </td>
                </tr>
              )}
              {runs.map((run) => (
                <tr key={run.id} className="border-b border-neutral-200">
                  <td className="px-4 py-2 text-neutral-600">
                    {run.started_at.slice(0, 16).replace('T', ' ')}
                  </td>
                  <td className="px-4 py-2 text-neutral-600">
                    {run.trigger === 'cron' ? 'อัตโนมัติ' : 'สั่งเอง'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {run.feeds_polled}
                    {run.feeds_failed > 0 && <span className="text-red-700"> / ล้ม {run.feeds_failed}</span>}
                  </td>
                  <td className="px-4 py-2 text-right">{run.articles_new}</td>
                  <td className="px-4 py-2 text-right">{run.keyword_passed}</td>
                  <td className="px-4 py-2 text-right">
                    {run.ai_screened}
                    {run.ai_rejected > 0 && <span className="text-neutral-600"> (ตัด {run.ai_rejected})</span>}
                  </td>
                  <td className="px-4 py-2 text-right text-neutral-900">{run.incidents_created}</td>
                  {/*
                    error ของแต่ละรอบถูกเก็บลง ingest_runs และโหลดมาถึงเบราว์เซอร์อยู่แล้ว
                    แต่เดิมไม่มีคอลัมน์แสดง — ปัญหาที่เกิดซ้ำทุกวันจึงไม่มีใครเห็น
                  */}
                  <td className="px-4 py-2 text-right">
                    {run.errors?.length ? (
                      <details className="text-left inline-block">
                        <summary className="cursor-pointer text-red-700 hover:text-red-700 list-none">
                          {run.errors.length} รายการ
                        </summary>
                        <ul className="mt-1 space-y-0.5 text-xs text-neutral-600 font-sans max-w-sm">
                          {run.errors.slice(0, 8).map((e, i) => (
                            <li key={i} className="break-words">
                              <span className="text-red-700 font-mono">{e.where}</span> — {e.message}
                            </li>
                          ))}
                          {run.errors.length > 8 && (
                            <li className="text-neutral-600">… อีก {run.errors.length - 8} รายการ</li>
                          )}
                        </ul>
                      </details>
                    ) : (
                      <span className="text-neutral-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-neutral-600 font-sans max-w-xs truncate">
                    {/*
                      รอบที่ไม่มี finished_at อาจถูก Vercel ตัดจบไปแล้ว (เพดาน 300 วินาที)
                      แสดงว่า "กำลังทำงาน" ตลอดไปทำให้เข้าใจผิดว่าระบบยังเดินอยู่
                    */}
                    {run.notes ??
                      (run.finished_at
                        ? ''
                        : Date.now() - new Date(run.started_at).getTime() > 10 * 60_000
                          ? 'ไม่จบ (น่าจะถูกตัดจบเพราะหมดเวลา)'
                          : 'กำลังทำงาน')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const SourceTable: React.FC<{
  title: string;
  subtitle: string;
  sources: SourceRow[];
  isAdmin: boolean;
  canEdit: boolean;
  running: boolean;
  icon?: React.ComponentType<{ className?: string }>;
  onToggle: (source: SourceRow) => void;
  onDelete: (source: SourceRow) => void;
  onTest: (id: string) => void;
}> = ({ title, subtitle, sources, isAdmin, canEdit, running, icon: Icon, onToggle, onDelete, onTest }) => (
  <div className="bg-white border border-neutral-200 rounded-sm shadow-xl">
    <div className="px-5 py-3 border-b border-neutral-200">
      <h3 className="text-xs font-mono font-bold  text-neutral-800 flex items-center gap-1.5">
        {Icon && <Icon className="w-3.5 h-3.5 text-neutral-600" />}
        {title} <span className="text-neutral-600">({sources.length})</span>
      </h3>
      <p className="text-[13px] text-neutral-600 mt-0.5 font-sans">{subtitle}</p>
    </div>

    <div className="divide-y divide-neutral-200">
      {sources.map((source) => {
        const unhealthy = source.consecutive_errors >= 3;
        return (
          <div key={source.id} className="px-5 py-3 flex flex-wrap items-center gap-3">
            <button
              onClick={() => isAdmin && onToggle(source)}
              disabled={!isAdmin}
              title={source.enabled ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
              className={`shrink-0 ${isAdmin ? 'cursor-pointer' : 'cursor-default'}`}
            >
              {source.enabled ? (
                <CheckCircle2 className={`w-4 h-4 ${unhealthy ? 'text-red-700' : 'text-neutral-900'}`} />
              ) : (
                <XCircle className="w-4 h-4 text-neutral-600" />
              )}
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-xs font-sans ${source.enabled ? 'text-neutral-900' : 'text-neutral-600'}`}>
                  {source.name}
                </span>
                {source.has_full_text && (
                  <span className="text-[13px] font-mono bg-neutral-100 text-neutral-900 border border-neutral-300 px-1.5 py-0.5 rounded-sm">
                    เนื้อข่าวเต็มในฟีด
                  </span>
                )}
                {unhealthy && (
                  <span className="text-[13px] font-mono bg-red-50 text-red-700 border border-red-200 px-1.5 py-0.5 rounded-sm">
                    ผิดพลาดติดกัน {source.consecutive_errors} ครั้ง
                  </span>
                )}
              </div>
              <p className="text-xs font-mono text-neutral-600 truncate">{source.feed_url}</p>
              <p className="text-xs font-mono text-neutral-600">
                {source.last_ok_at
                  ? `ดึงสำเร็จล่าสุด ${source.last_ok_at.slice(0, 16).replace('T', ' ')} · ${source.last_item_count ?? 0} รายการ`
                  : 'ยังไม่เคยดึงสำเร็จ'}
                {source.last_error && <span className="text-red-700"> · {source.last_error}</span>}
              </p>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => onTest(source.id)}
                disabled={!canEdit || running}
                className="text-xs font-mono text-neutral-700 bg-neutral-50 hover:bg-neutral-100 border border-neutral-200 px-2.5 py-1.5 rounded-sm disabled:opacity-40"
              >
                ทดสอบฟีด
              </button>
              {isAdmin && (
                <button
                  onClick={() => onDelete(source)}
                  className="text-neutral-600 hover:text-red-700 p-1.5"
                  title="ลบแหล่งข่าว"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  </div>
);
