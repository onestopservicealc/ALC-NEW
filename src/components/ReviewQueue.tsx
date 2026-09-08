import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCheck,
  ClipboardPaste,
  Copy,
  ExternalLink,
  Inbox,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  ThumbsDown,
  Wine,
} from 'lucide-react';
import { CrimeIncident, validateIncident } from '../types/dataDictionary';
import { IncidentForm } from './IncidentForm';
import {
  ArticleRow,
  IncidentRecord,
  listArticles,
  mergeIntoIncident,
  rejectLead,
} from '../lib/incidentsRepo';
import { callApi } from '../lib/supabase';

interface ReviewQueueProps {
  pending: IncidentRecord[];
  approved: IncidentRecord[];
  /** เคสที่ถูกปฏิเสธไว้ — เดิมคำนวณไว้แล้วแต่ไม่มีหน้าจอไหนแสดง ผิดพลาดแล้วกู้ไม่ได้ */
  rejected: IncidentRecord[];
  loading: boolean;
  canEdit: boolean;
  onApprove: (uuid: string, note?: string) => Promise<void>;
  onReject: (uuid: string, note?: string) => Promise<void>;
  /** ส่งเคสที่ปฏิเสธไปแล้วกลับเข้าคิวตรวจสอบ */
  onRestore: (uuid: string, note?: string) => Promise<void>;
  onSaveEdits: (incident: CrimeIncident, uuid: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onToast: (message: string, type?: 'success' | 'info') => void;
}

type QueueTab = 'pending' | 'needs_url' | 'rejected';

export const ReviewQueue: React.FC<ReviewQueueProps> = ({
  pending,
  approved,
  rejected,
  loading,
  canEdit,
  onApprove,
  onReject,
  onRestore,
  onSaveEdits,
  onRefresh,
  onToast,
}) => {
  const [tab, setTab] = useState<QueueTab>('pending');
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [confidenceFilter, setConfidenceFilter] = useState<'ALL' | 'LOW' | 'HIGH'>('ALL');
  const [onlyDuplicates, setOnlyDuplicates] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejectingUuid, setRejectingUuid] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  /** ค่าที่ผู้ตรวจกรอกค้างในฟอร์ม (ยังไม่กดบันทึก) — ต้องบันทึกให้ก่อนอนุมัติ */
  const [draft, setDraft] = useState<{ data: CrimeIncident; dirty: boolean } | null>(null);
  /** นับว่าตรวจไปกี่เคสในรอบนี้ ผู้ตรวจจะได้เห็นความคืบหน้า */
  const [reviewed, setReviewed] = useState(0);

  const filtered = useMemo(() => {
    return pending.filter((item) => {
      if (onlyDuplicates && !item.duplicate_of) return false;
      if (confidenceFilter === 'LOW' && (item.ai_confidence ?? 1) >= 0.75) return false;
      if (confidenceFilter === 'HIGH' && (item.ai_confidence ?? 0) < 0.75) return false;
      if (search) {
        const q = search.toLowerCase();
        const haystack = `${item.news_title} ${item.news_summary} ${item.province} ${item.news_agency}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [pending, search, confidenceFilter, onlyDuplicates]);

  const selected = useMemo(
    () => filtered.find((i) => i.uuid === selectedUuid) ?? filtered[0] ?? null,
    [filtered, selectedUuid]
  );

  /**
   * เคสที่ระบบสงสัยว่าซ้ำกัน
   *
   * เดิมค้นจาก `approved` เท่านั้น — แต่คู่ซ้ำที่ไหลเข้ามาในรอบดึงข่าวเดียวกันจะยัง `pending`
   * ทั้งคู่ ปุ่มรวมเคสจึงไม่เคยขึ้นในกรณีที่พบบ่อยที่สุด ผู้ตรวจอนุมัติซ้ำได้ทั้งสองใบ
   */
  const duplicateTarget = useMemo(() => {
    if (!selected?.duplicate_of) return null;
    return (
      approved.find((a) => a.uuid === selected.duplicate_of) ??
      pending.find((p) => p.uuid === selected.duplicate_of) ??
      null
    );
  }, [selected, approved, pending]);

  /** ข้อมูลยังไม่ครบตามเกณฑ์ → ห้ามอนุมัติเข้าสถิติ */
  const blockingErrors = useMemo(() => {
    const source = draft?.data ?? selected;
    if (!source) return [] as string[];
    const result = validateIncident(source as CrimeIncident);
    return result.isValid ? [] : Object.entries(result.errors).map(([f, m]) => `${f}: ${m}`);
  }, [draft, selected]);

  /**
   * เคสถัดไปที่ควรเด้งไปหลังจัดการเคสปัจจุบันเสร็จ
   *
   * ต้องคำนวณ **ก่อน** ลงมือ เพราะพอสถานะเปลี่ยน รายการจะถูกกรองใหม่และหาตำแหน่งเดิมไม่ได้
   */
  const nextUuidAfter = (uuid: string): string | null => {
    const i = filtered.findIndex((x) => x.uuid === uuid);
    if (i === -1) return null;
    return filtered[i + 1]?.uuid ?? filtered[i - 1]?.uuid ?? null;
  };

  const handleApprove = async (uuid: string) => {
    if (blockingErrors.length > 0) {
      onToast(`ข้อมูลยังไม่ครบ ${blockingErrors.length} จุด — แก้ในฟอร์มด้านล่างก่อนอนุมัติ`, 'info');
      return;
    }

    const next = nextUuidAfter(uuid);
    setBusy(uuid);
    try {
      /**
       * ถ้าผู้ตรวจแก้ค่าไว้แต่ยังไม่กดบันทึก ต้องบันทึกให้ก่อนเปลี่ยนสถานะ
       *
       * เดิมปุ่มนี้เรียกแค่ onApprove ซึ่งเปลี่ยนสถานะอย่างเดียว ค่าที่แก้ไว้จึงหายเงียบ
       * ทั้งที่การแก้ค่าที่ AI สกัดมาผิดคือเนื้องานหลักของการตรวจ
       */
      if (draft?.dirty) {
        await onSaveEdits(draft.data, uuid);
      }
      await onApprove(uuid);
      onToast(draft?.dirty ? 'บันทึกการแก้ไขและอนุมัติเข้าฐานสถิติแล้ว' : 'อนุมัติเข้าฐานสถิติเรียบร้อย');
      setReviewed((n) => n + 1);
      setDraft(null);
      setSelectedUuid(next);
    } catch (err: any) {
      onToast(err?.message ?? 'อนุมัติไม่สำเร็จ', 'info');
    } finally {
      setBusy(null);
    }
  };

  const handleReject = async () => {
    if (!rejectingUuid) return;
    setBusy(rejectingUuid);
    try {
      const next = nextUuidAfter(rejectingUuid);
      await onReject(rejectingUuid, rejectNote.trim() || undefined);
      onToast('ปฏิเสธข่าวนี้แล้ว — ดูและกู้คืนได้ในแท็บ "ปฏิเสธแล้ว"', 'info');
      setRejectingUuid(null);
      setRejectNote('');
      setReviewed((n) => n + 1);
      setDraft(null);
      setSelectedUuid(next);
    } catch (err: any) {
      onToast(err?.message ?? 'ปฏิเสธไม่สำเร็จ', 'info');
    } finally {
      setBusy(null);
    }
  };

  const handleMerge = async () => {
    if (!selected?.duplicate_of) return;
    setBusy(selected.uuid);
    try {
      await mergeIntoIncident(selected.uuid, selected.duplicate_of);
      await onRefresh();
      onToast('รวมเข้ากับเคสหลักเรียบร้อย');
      setSelectedUuid(null);
    } catch (err: any) {
      onToast(err?.message ?? 'รวมเคสไม่สำเร็จ', 'info');
    } finally {
      setBusy(null);
    }
  };

  const handleSave = async (data: CrimeIncident) => {
    if (!selected) return;
    setBusy(selected.uuid);
    try {
      await onSaveEdits(data, selected.uuid);
      onToast('บันทึกการแก้ไขแล้ว (ยังอยู่ในคิว รอกดอนุมัติ)');
    } catch (err: any) {
      onToast(err?.message ?? 'บันทึกไม่สำเร็จ', 'info');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <header className="bg-white border border-neutral-200 rounded-sm p-5 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-sm bg-neutral-100 border border-neutral-300">
              <ClipboardCheck className="w-5 h-5 text-red-700" />
            </div>
            <div>
              <span className="text-xs  font-mono uppercase text-neutral-600">
                ตรวจสอบโดยเจ้าหน้าที่ก่อนเข้าสถิติ
              </span>
              <h2 className="font-serif text-2xl text-neutral-900 italic tracking-wide">
                คิวตรวจสอบข่าวก่อนเข้าสถิติ
              </h2>
              <p className="text-xs text-neutral-600 mt-1 font-sans">
                ข่าวที่ระบบดึงและสกัดมาอัตโนมัติจะพักอยู่ที่นี่ จนกว่าเจ้าหน้าที่จะตรวจสอบและอนุมัติ
              </p>
            </div>
          </div>

          <button
            onClick={() => void onRefresh()}
            className="flex items-center gap-1.5 text-xs font-mono text-neutral-700 bg-neutral-50 hover:bg-neutral-100 border border-neutral-200 px-3 py-2 rounded-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>โหลดใหม่</span>
          </button>
        </div>

        <div className="mt-4 pt-4 border-t border-neutral-200 flex flex-wrap gap-2">
          <TabButton active={tab === 'pending'} onClick={() => setTab('pending')}>
            รอตรวจสอบ ({pending.length})
          </TabButton>
          <TabButton active={tab === 'needs_url'} onClick={() => setTab('needs_url')}>
            ต้องยืนยันลิงก์
          </TabButton>
          <TabButton active={tab === 'rejected'} onClick={() => setTab('rejected')}>
            ปฏิเสธแล้ว ({rejected.length})
          </TabButton>

          {/* ความคืบหน้าของรอบตรวจนี้ — เดิมผู้ตรวจไม่รู้ว่าทำไปเท่าไหร่และเหลืออีกเท่าไหร่ */}
          {tab === 'pending' && reviewed > 0 && (
            <div className="ml-auto flex items-center gap-2 text-xs font-mono">
              <span className="text-neutral-900">ตรวจแล้ว {reviewed}</span>
              <span className="text-neutral-600">·</span>
              <span className="text-neutral-600">เหลือ {pending.length}</span>
              <div className="h-1 w-24 bg-neutral-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-neutral-900 transition-all"
                  style={{ width: `${(reviewed / Math.max(reviewed + pending.length, 1)) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </header>

      {!canEdit && (
        <div className="p-3.5 bg-neutral-100 border border-red-200 rounded-sm text-xs text-red-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>บัญชีของคุณมีสิทธิ์ระดับดูอย่างเดียว จึงตรวจสอบและอนุมัติข้อมูลไม่ได้</span>
        </div>
      )}

      {tab === 'rejected' ? (
        <RejectedPanel
          rejected={rejected}
          canEdit={canEdit}
          onRestore={onRestore}
          onToast={onToast}
        />
      ) : tab === 'needs_url' ? (
        <NeedsUrlPanel canEdit={canEdit} onToast={onToast} onRefresh={onRefresh} />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)] gap-4">
          {/* ---- รายการรอตรวจ ---- */}
          <div className="bg-white border border-neutral-200 rounded-sm shadow-xl flex flex-col max-h-[80vh]">
            <div className="p-3 border-b border-neutral-200 space-y-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-neutral-600 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="ค้นหาพาดหัว จังหวัด สำนักข่าว..."
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-sm pl-8 pr-3 py-2 text-xs text-neutral-800 focus:outline-none focus:border-neutral-400 font-sans"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(['ALL', 'LOW', 'HIGH'] as const).map((level) => (
                  <button
                    key={level}
                    onClick={() => setConfidenceFilter(level)}
                    className={`text-xs font-mono px-2 py-1 rounded-sm border transition-colors ${
                      confidenceFilter === level
                        ? 'bg-neutral-200 text-neutral-900 border-neutral-400'
                        : 'bg-neutral-50 text-neutral-600 border-neutral-200 hover:text-neutral-700'
                    }`}
                  >
                    {level === 'ALL' ? 'ทุกระดับ' : level === 'LOW' ? 'AI มั่นใจต่ำ' : 'AI มั่นใจสูง'}
                  </button>
                ))}
                <button
                  onClick={() => setOnlyDuplicates((v) => !v)}
                  className={`text-xs font-mono px-2 py-1 rounded-sm border transition-colors ${
                    onlyDuplicates
                      ? 'bg-neutral-200 text-neutral-900 border-neutral-400'
                      : 'bg-neutral-50 text-neutral-600 border-neutral-200 hover:text-neutral-700'
                  }`}
                >
                  เฉพาะที่สงสัยว่าซ้ำ
                </button>
              </div>
            </div>

            <div className="overflow-y-auto flex-1">
              {loading && filtered.length === 0 && (
                <div className="p-8 text-center text-neutral-600 text-xs font-mono flex flex-col items-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  กำลังโหลดคิว...
                </div>
              )}

              {!loading && filtered.length === 0 && (
                <div className="p-10 text-center text-neutral-600 space-y-2">
                  <Inbox className="w-8 h-8 mx-auto text-neutral-300" />
                  <p className="text-xs font-sans">
                    {pending.length === 0
                      ? 'ไม่มีข่าวรอตรวจสอบ — ระบบจะเติมคิวให้เองในรอบดึงข่าวถัดไป'
                      : 'ไม่มีรายการที่ตรงกับตัวกรอง'}
                  </p>
                </div>
              )}

              {filtered.map((item) => {
                const isActive = selected?.uuid === item.uuid;
                const confidence = item.ai_confidence ?? null;
                return (
                  <button
                    key={item.uuid}
                    onClick={() => setSelectedUuid(item.uuid)}
                    className={`w-full text-left px-3.5 py-3 border-b border-neutral-200 transition-colors ${
                      isActive ? 'bg-neutral-100' : 'hover:bg-neutral-50'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${
                          confidence === null
                            ? 'bg-neutral-300'
                            : confidence >= 0.75
                              ? 'bg-neutral-900'
                              : 'bg-neutral-900'
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-neutral-900 font-sans leading-snug line-clamp-2">
                          {item.news_title || '(ไม่มีพาดหัว)'}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-mono text-neutral-600">
                          <span>{item.news_agency || 'ไม่ทราบสำนัก'}</span>
                          <span>·</span>
                          <span>{item.incident_date || 'ไม่ระบุวัน'}</span>
                          {item.province && (
                            <>
                              <span>·</span>
                              <span>{item.province}</span>
                            </>
                          )}
                          {confidence !== null && (
                            <span className={confidence >= 0.75 ? 'text-neutral-900' : 'text-red-700'}>
                              AI {Math.round(confidence * 100)}%
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {item.duplicate_of && (
                            <Badge tone="amber">
                              <Copy className="w-2.5 h-2.5" /> อาจซ้ำ
                            </Badge>
                          )}
                          {item.ai_adjusted_fields && item.ai_adjusted_fields.length > 0 && (
                            <Badge tone="zinc">ดัดค่า {item.ai_adjusted_fields.length} ฟิลด์</Badge>
                          )}
                          {item.alcohol_role && (
                            <Badge tone="zinc">
                              <Wine className="w-2.5 h-2.5" /> {item.alcohol_role}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ---- แผงตรวจสอบ ---- */}
          <div className="space-y-4 min-w-0">
            {!selected ? (
              <div className="bg-white border border-neutral-200 rounded-sm p-12 text-center text-neutral-600">
                <ClipboardCheck className="w-8 h-8 mx-auto text-neutral-300 mb-3" />
                <p className="text-xs font-sans">เลือกข่าวจากรายการทางซ้ายเพื่อเริ่มตรวจสอบ</p>
              </div>
            ) : (
              <>
                <div className="bg-white border border-neutral-200 rounded-sm p-5 shadow-xl space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-serif text-lg text-neutral-900 leading-snug">
                        {selected.news_title}
                      </h3>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px] font-mono text-neutral-600">
                        <span>{selected.news_agency}</span>
                        {selected.url && (
                          <a
                            href={selected.url.split(';')[0]}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-neutral-700 hover:text-white underline underline-offset-2"
                          >
                            เปิดข่าวต้นทาง <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </div>
                    <span className="text-xs font-mono text-neutral-600">
                      รับเข้าระบบ {selected.created_at?.slice(0, 16).replace('T', ' ')}
                    </span>
                  </div>

                  <p className="text-xs text-neutral-700 leading-relaxed font-sans bg-neutral-50 border border-neutral-200 rounded-sm p-3.5">
                    {selected.news_summary || '(ไม่มีสรุปข่าว)'}
                  </p>

                  {duplicateTarget && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-sm text-xs text-red-700 font-sans">
                      <div className="flex items-start gap-2">
                        <Copy className="w-3.5 h-3.5 shrink-0 mt-0.5 text-red-700" />
                        <div className="min-w-0">
                          <p className="font-semibold">คล้ายกับเคส #{duplicateTarget.id} ที่อนุมัติไว้แล้ว</p>
                          <p className="mt-0.5 text-red-700 line-clamp-2">{duplicateTarget.news_title}</p>
                          <button
                            onClick={() => void handleMerge()}
                            disabled={!canEdit || busy === selected.uuid}
                            className="mt-2 text-[13px] font-mono bg-red-100 hover:bg-red-100 disabled:opacity-40 border border-red-200 px-2.5 py-1 rounded-sm"
                          >
                            รวมเข้ากับเคส #{duplicateTarget.id}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-neutral-200">
                    <button
                      onClick={() => void handleApprove(selected.uuid)}
                      disabled={!canEdit || busy === selected.uuid || blockingErrors.length > 0}
                      title={
                        blockingErrors.length > 0
                          ? `ข้อมูลยังไม่ครบ: ${blockingErrors.join(' · ')}`
                          : undefined
                      }
                      className="px-4 py-2 text-xs font-mono font-bold  text-white bg-neutral-900 hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed rounded-sm flex items-center gap-1.5"
                    >
                      {busy === selected.uuid ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      )}
                      {/* บอกให้ชัดว่าจะบันทึกค่าที่แก้ไว้ไปด้วย ไม่ใช่อนุมัติของเดิม */}
                      <span>{draft?.dirty ? 'บันทึกแล้วอนุมัติ' : 'อนุมัติเข้าสถิติ'}</span>
                    </button>

                    <button
                      onClick={() => {
                        setRejectingUuid(selected.uuid);
                        setRejectNote('');
                      }}
                      disabled={!canEdit || busy === selected.uuid}
                      className="px-3.5 py-2 text-xs font-mono text-red-700 bg-neutral-50 hover:bg-red-50 border border-red-200 disabled:opacity-40 rounded-sm flex items-center gap-1.5"
                    >
                      <ThumbsDown className="w-3.5 h-3.5" />
                      <span>ปฏิเสธ</span>
                    </button>

                    <span className="text-[13px] font-sans ml-auto text-right">
                      {blockingErrors.length > 0 ? (
                        <span className="text-red-700">
                          ข้อมูลยังไม่ครบ {blockingErrors.length} จุด — ดูจุดสีแดงบนหมวดด้านล่าง
                        </span>
                      ) : draft?.dirty ? (
                        <span className="text-red-700">มีการแก้ไขที่ยังไม่บันทึก — กดอนุมัติจะบันทึกให้ด้วย</span>
                      ) : (
                        <span className="text-neutral-600">แก้ไขข้อมูลด้านล่างก่อนกดอนุมัติได้</span>
                      )}
                    </span>
                  </div>

                  {rejectingUuid === selected.uuid && (
                    <div className="p-3 bg-neutral-50 border border-red-200 rounded-sm space-y-2">
                      <label className="block text-xs uppercase font-mono tracking-wider text-neutral-600">
                        เหตุผลที่ปฏิเสธ (บันทึกไว้เพื่อจูนระบบคัดกรอง)
                      </label>
                      <input
                        value={rejectNote}
                        onChange={(e) => setRejectNote(e.target.value)}
                        placeholder="เช่น ไม่เกี่ยวกับแอลกอฮอล์ / เป็นข่าวเก่า / ข้อมูลไม่พอ"
                        className="w-full bg-white border border-neutral-200 rounded-sm px-3 py-2 text-xs text-neutral-800 focus:outline-none focus:border-neutral-400 font-sans"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => void handleReject()}
                          className="px-3 py-1.5 text-[13px] font-mono bg-red-100 hover:bg-red-600 text-red-700 rounded-sm"
                        >
                          ยืนยันการปฏิเสธ
                        </button>
                        <button
                          onClick={() => setRejectingUuid(null)}
                          className="px-3 py-1.5 text-[13px] font-mono text-neutral-600 hover:text-neutral-800"
                        >
                          ยกเลิก
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <IncidentForm
                  key={selected.uuid}
                  initialData={selected}
                  isEditing
                  saveLabel="บันทึกการแก้ไข"
                  highlightFields={selected.ai_adjusted_fields ?? undefined}
                  onSave={(data) => void handleSave(data)}
                  onCancel={() => setSelectedUuid(null)}
                  onDraftChange={(data, dirty) => setDraft({ data, dirty })}
                />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* แท็บย่อย: lead จาก Google News ที่ยังไม่มี URL ต้นทาง                 */
/* ------------------------------------------------------------------ */

/** นับวินาทีที่ผ่านไป ใช้บอกผู้ใช้ว่าระบบยังทำงานอยู่ ไม่ได้ค้าง */
const useElapsed = (active: boolean): number => {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) {
      setSeconds(0);
      return;
    }
    const started = Date.now();
    const id = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return seconds;
};

interface ResolveResponse {
  /** URL ต้นทางที่ถอดได้ — null แปลว่าถอดไม่ได้ ซึ่งเป็นผลลัพธ์ปกติ ไม่ใช่ error */
  url: string | null;
  reason?: string | null;
  cached?: boolean;
}

interface AttachResponse {
  duplicate?: boolean;
  articleId?: string;
  message?: string;
  /** URL ที่บันทึกจริง — ทางถอดอัตโนมัติมีแต่เซิร์ฟเวอร์ที่รู้ค่านี้ */
  url?: string;
  /** true เมื่อเซิร์ฟเวอร์ถอดลิงก์ Google News ให้เอง ไม่ใช่เจ้าหน้าที่วางมา */
  autoResolved?: boolean;
}

interface ExtractUrlResponse {
  data: unknown;
  message?: string;
  seq?: number;
  duplicate?: boolean;
  duplicateSeq?: number | null;
  error?: string;
  canPasteText?: boolean;
}

/**
 * เคสที่ถูกปฏิเสธไว้ + ทางกู้คืน
 *
 * เดิม `useIncidents` คำนวณ `rejected` ไว้แล้วแต่ไม่มีคอมโพเนนต์ไหนใช้ —
 * ปฏิเสธผิดหนึ่งครั้งแล้วเคสนั้นหายจากทุกหน้าจอถาวร ไม่มีทางหาหรือย้อนกลับ
 * สำหรับเครื่องมือที่งานหลักคือการตัดสิน การกดผิดต้องแก้ได้
 */
const RejectedPanel: React.FC<{
  rejected: IncidentRecord[];
  canEdit: boolean;
  onRestore: (uuid: string, note?: string) => Promise<void>;
  onToast: (message: string, type?: 'success' | 'info') => void;
}> = ({ rejected, canEdit, onRestore, onToast }) => {
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return rejected;
    const q = search.toLowerCase();
    return rejected.filter((r) =>
      `${r.news_title} ${r.news_summary} ${r.province} ${r.news_agency} ${r.review_note ?? ''}`
        .toLowerCase()
        .includes(q)
    );
  }, [rejected, search]);

  const restore = async (uuid: string) => {
    setBusy(uuid);
    try {
      await onRestore(uuid, 'กู้คืนกลับเข้าคิวตรวจสอบ');
      onToast('ส่งกลับเข้าคิวรอตรวจสอบแล้ว');
    } catch (err: any) {
      onToast(err?.message ?? 'กู้คืนไม่สำเร็จ', 'info');
    } finally {
      setBusy(null);
    }
  };

  if (rejected.length === 0) {
    return (
      <div className="bg-white border border-neutral-200 rounded-sm p-10 text-center text-neutral-600">
        <ThumbsDown className="w-8 h-8 mx-auto text-neutral-300 mb-3" />
        <p className="text-sm text-neutral-700 font-sans">ยังไม่มีเคสที่ถูกปฏิเสธ</p>
        <p className="mt-1 text-xs text-neutral-600 font-sans">
          เคสที่กดปฏิเสธจะมาอยู่ที่นี่ และส่งกลับเข้าคิวได้ถ้ากดผิด
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-neutral-200 rounded-sm shadow-xl">
      <div className="px-5 py-3 border-b border-neutral-200 flex flex-wrap items-center gap-3">
        <ThumbsDown className="w-4 h-4 text-red-700 shrink-0" />
        <span className="text-xs font-mono text-neutral-700">ปฏิเสธแล้ว {rejected.length} เคส</span>
        <div className="relative ml-auto min-w-0 flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 text-neutral-600 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาพาดหัว จังหวัด เหตุผล..."
            className="w-full bg-neutral-50 border border-neutral-200 rounded-sm pl-8 pr-3 py-1.5 text-xs text-neutral-800 focus:outline-none focus:border-neutral-400 font-sans"
          />
        </div>
      </div>

      <ul className="divide-y divide-neutral-200 max-h-[70vh] overflow-y-auto">
        {filtered.map((item) => (
          <li key={item.uuid} className="px-5 py-3.5 flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-neutral-900 font-sans leading-snug">
                {item.news_title || '(ไม่มีพาดหัว)'}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-mono text-neutral-600">
                <span>#{item.id}</span>
                <span>·</span>
                <span>{item.news_agency || 'ไม่ทราบสำนัก'}</span>
                {item.incident_date && (
                  <>
                    <span>·</span>
                    <span>{item.incident_date}</span>
                  </>
                )}
                {item.province && (
                  <>
                    <span>·</span>
                    <span>{item.province}</span>
                  </>
                )}
              </div>
              {item.review_note && (
                <p className="mt-1.5 text-[13px] text-red-700 font-sans">
                  เหตุผลที่ปฏิเสธ: {item.review_note}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {item.url && (
                <a
                  href={item.url.split(';')[0]}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[13px] font-mono text-neutral-600 hover:text-neutral-800 inline-flex items-center gap-1"
                >
                  ข่าวต้นทาง <ExternalLink className="w-3 h-3" />
                </a>
              )}
              <button
                onClick={() => void restore(item.uuid)}
                disabled={!canEdit || busy === item.uuid}
                className="text-[13px] font-mono text-neutral-800 hover:text-neutral-800 border border-neutral-300 hover:bg-neutral-100 px-2.5 py-1.5 rounded-sm disabled:opacity-40 inline-flex items-center gap-1.5"
              >
                {busy === item.uuid ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <RefreshCw className="w-3 h-3" />
                )}
                ส่งกลับเข้าคิว
              </button>
            </div>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="px-5 py-8 text-center text-xs text-neutral-600 font-sans">
            ไม่มีรายการที่ตรงกับคำค้น
          </li>
        )}
      </ul>
    </div>
  );
};

/**
 * สถานะของงานสกัดที่ปล่อยไว้เบื้องหลัง 1 รายการ
 * เก็บ title ไว้ด้วยเพื่อให้ผู้ใช้รู้ว่าผลลัพธ์ที่เด้งมาเป็นของข่าวไหน
 * (ตอนผลกลับมาผู้ใช้อาจเลื่อนไปข่าวที่ 5 แล้ว)
 */
interface BackgroundJob {
  articleId: string;
  title: string;
  url: string;
  newsAgency: string | null;
  state: 'running' | 'done' | 'failed';
  message: string;
  /** แถวเดิมในคิว — เก็บไว้เผื่อสำนักบล็อกการดึงหน้าเว็บ จะได้เอากลับเข้าคิวให้คนวางเนื้อข่าว */
  row: ArticleRow;
}

/** ยิงงานสกัดพร้อมกันได้กี่ราย — กัน rate limit ต่อนาทีของ Gemini */
const EXTRACT_CONCURRENCY = 2;

/**
 * ยืนยันลิงก์แบบทีละข่าว
 *
 * Google News ให้พาดหัวและชื่อสำนักข่าว แต่เข้ารหัสลิงก์ไว้ เดิมจึงต้องให้เจ้าหน้าที่
 * เปิดข่าว คัดลอก URL แล้วกลับมาวางทีละข่าว — คิว 73 รายการกินเวลาครึ่งชั่วโมง
 *
 * ตอนนี้เซิร์ฟเวอร์ถอดลิงก์เองได้แล้ว (`api/_lib/gnews.ts`) งานจึงเหลือขั้นเดียว:
 * **กดปุ่ม "ยืนยันข่าวนี้"** ไม่ต้องกรอกอะไร ไม่ต้องเปิดข่าวด้วยซ้ำ
 *
 * ทางถอยยังต้องมี เพราะการถอดพึ่ง endpoint ภายในของ Google ที่พังได้ทุกเมื่อ —
 * ถ้าถอดไม่สำเร็จ ช่องกรอก URL จะโผล่มาพร้อมเหตุผล และรับค่าได้ 3 ทาง
 * (วางแล้วส่งทันที · กดปุ่มให้หยิบจากคลิปบอร์ด · พิมพ์แล้วกด Enter)
 * ทุกทางไปจบที่ submitUrl เหมือนกัน เสร็จแล้วเลื่อนไปข่าวถัดไปเอง
 */
const NeedsUrlPanel: React.FC<{
  canEdit: boolean;
  onToast: (message: string, type?: 'success' | 'info') => void;
  onRefresh: () => Promise<void>;
}> = ({ canEdit, onToast, onRefresh }) => {
  const [rows, setRows] = useState<ArticleRow[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** busy เฉพาะจังหวะบันทึกลิงก์ (~200 ms) ไม่ใช่รอ AI แล้ว */
  const [busy, setBusy] = useState(false);
  /** ตั้งเมื่อสำนักข่าวบล็อกการดึงหน้าเว็บ — เก็บ URL ที่ผู้ใช้ให้ไว้แล้วขอเนื้อข่าวแทน */
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);
  const [done, setDone] = useState(0);
  const [jobs, setJobs] = useState<BackgroundJob[]>([]);
  /**
   * ค่าที่อยู่ในช่องกรอก — ต้องเป็น controlled เพราะมีปุ่มยืนยันที่ต้องอ่านค่าไปใช้
   * เดิมช่องผูกกับ onPaste อย่างเดียว พิมพ์แล้วกด Enter จึงไม่เกิดอะไรขึ้นเลย
   */
  const [urlValue, setUrlValue] = useState('');
  const [textValue, setTextValue] = useState('');
  /** กำลังขออ่านคลิปบอร์ด — แยกจาก busy เพราะยังไม่ได้ยิง API และต้องไม่ปิดช่องกรอก */
  const [reading, setReading] = useState(false);
  /**
   * ตั้งเมื่อเซิร์ฟเวอร์ถอดลิงก์ Google News ของข่าวนี้ไม่สำเร็จ
   * ปกติเจ้าหน้าที่ไม่ต้องเห็นช่องกรอก URL เลย — จะโผล่มาเฉพาะตอนที่ต้องใช้คนช่วยจริงๆ
   */
  const [manualUrl, setManualUrl] = useState(false);
  /**
   * ผลการถอดลิงก์ของข่าวที่แสดงอยู่ ทำล่วงหน้าตั้งแต่ข่าวขึ้นจอ
   *
   * ทำไมต้องล่วงหน้า: เจ้าหน้าที่ใช้เวลาอ่านพาดหัวอยู่แล้ว เอาช่วงนั้นมาถอดลิงก์เสีย
   * พอกดปุ่มจึงบันทึกได้ทันทีโดยไม่ต้องรอ และได้เห็น URL ก่อนยืนยันว่าถูกข่าวจริง
   */
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  /** เหตุผลที่ถอดไม่ได้ — ต้องบอกผู้ใช้ ไม่ใช่โยนช่องกรอกใส่หน้าเฉยๆ */
  const [resolveReason, setResolveReason] = useState<string | null>(null);
  /** ผลการไล่ตรวจทีละขั้น ใช้ตอนถอดลิงก์พังแล้วต้องรู้ว่าพังตรงไหน */
  const [diag, setDiag] = useState<string[] | null>(null);
  /**
   * นับวินาทีเฉพาะทางเนื้อข่าว ซึ่งเป็นทางเดียวที่ยังต้องยืนรอ AI (5-15 วินาที)
   * ทาง URL ไม่ต้องรอเพราะสกัดเบื้องหลัง
   */
  const elapsed = useElapsed(busy && blockedUrl !== null);

  const urlInput = useRef<HTMLInputElement>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);

  /**
   * คิวงานสกัดที่รอยิง — เก็บใน ref เพราะตัว worker อ่านค่าล่าสุดตอนทำงาน
   * ถ้าเก็บใน state จะได้ค่าที่ค้างอยู่ตอน closure ถูกสร้าง
   */
  const queueRef = useRef<BackgroundJob[]>([]);
  const runningRef = useRef(0);
  const aliveRef = useRef(true);
  /**
   * กันกดปุ่มยืนยันรัวจนยิง attach ซ้ำ
   * ต้องเป็น ref ไม่ใช่ state — สองคลิกใน tick เดียวกันอ่าน state ตัวเดิมได้ทั้งคู่แล้วผ่านทั้งคู่
   */
  const confirmLock = useRef(false);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const current = rows[index] ?? null;
  const total = rows.length;
  const running = jobs.filter((j) => j.state === 'running').length;

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listArticles('needs_url', 200);
      setRows(list);
      setIndex(0);
    } catch (err: any) {
      setError(err?.message ?? 'โหลดรายการไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // ข่าวที่มี URL ติดมาแล้วคือข่าวที่เคยยืนยันลิงก์ไปแล้วแต่สำนักบล็อกการดึงหน้าเว็บ
  // ข้ามขั้นขอ URL ไปขอเนื้อข่าวเลย ไม่ต้องให้ผู้ใช้ไปหา URL เดิมมาวางซ้ำ
  useEffect(() => {
    setBlockedUrl(current?.url ?? null);
    // ค่าที่ค้างจากข่าวก่อนหน้าห้ามไหลไปข่าวถัดไป — จะกลายเป็นบันทึก URL ผิดข่าว
    // ครอบคลุมทุกทางที่เปลี่ยนข่าว ทั้ง consumeCurrent, skip, การเอากลับเข้าคิว
    // และข่าวสุดท้าย (current?.id เปลี่ยนจาก string เป็น undefined effect ก็ยังทำงาน)
    setUrlValue('');
    setTextValue('');
    // ข่าวใหม่ต้องได้ลองถอดอัตโนมัติเสมอ ไม่ใช่ติดโหมดวางเองมาจากข่าวก่อนหน้า
    setManualUrl(false);
    setResolvedUrl(null);
    setResolveReason(null);
  }, [current?.id]);

  // โฟกัสช่องที่ต้องใช้ทันทีที่เปลี่ยนข่าว ผู้ใช้จึงกด Cmd+V ได้เลยหลังสลับแท็บกลับมา
  //
  // ต้องผูกกับ id ของข่าวปัจจุบัน ไม่ใช่ index — ตอนโหลดครั้งแรก index เป็น 0 อยู่แล้ว
  // และไม่เปลี่ยนเมื่อข้อมูลมาถึง effect จึงไม่ทำงานซ้ำ ช่องกรอกเลยไม่เคยถูกโฟกัส
  useEffect(() => {
    if (busy || !current) return;
    if (blockedUrl) textInput.current?.focus();
    else if (manualUrl) urlInput.current?.focus();
  }, [current?.id, busy, blockedUrl, manualUrl]);

  /**
   * ถอดลิงก์ล่วงหน้าทันทีที่ข่าวขึ้นจอ
   *
   * เรียก action:'resolve' ล่วงหน้า ไม่ใช่ทำตอนกดปุ่ม เพราะ 2 เหตุผล:
   *   1. เจ้าหน้าที่ได้เห็น URL ก่อนกดยืนยัน จึงตรวจได้ว่าเป็นข่าวเดียวกันจริง
   *   2. ถ้าถอดไม่ได้ หน้าจอเปิดช่องให้วางเองตั้งแต่ยังไม่กด ไม่ใช่กดแล้วค่อยเจอปัญหา
   *
   * endpoint นั้นอ่านอย่างเดียว เรียกซ้ำได้ ถ้าล้มก็แค่ถอยไปทางวางเอง ไม่กระทบข้อมูล
   */
  useEffect(() => {
    if (!current || blockedUrl) return;
    let cancelled = false;
    const leadId = current.id;

    setResolving(true);

    // หน่วงสั้นๆ ก่อนยิง — เจ้าหน้าที่กด "ข้าม" รัวๆ ได้ ถ้ายิงทุกข่าวที่ผ่านตา
    // จะกลายเป็นการถล่ม Google โดยไม่จำเป็นและเพิ่มโอกาสโดนบล็อก
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const r = await callApi<ResolveResponse>('/api/leads/attach', {
            articleId: leadId,
            action: 'resolve',
          });
          if (cancelled) return;
          if (r.url) {
            setResolvedUrl(r.url);
          } else {
            setResolvedUrl(null);
            setResolveReason(r.reason ?? 'ถอดลิงก์ไม่สำเร็จ');
            setManualUrl(true);
          }
        } catch (err: any) {
          // ถอดไม่ได้ไม่ใช่เรื่องคอขาดบาดตาย — เปิดทางให้คนทำต่อ แต่ต้องบอกด้วยว่าเพราะอะไร
          if (!cancelled) {
            setResolvedUrl(null);
            setResolveReason(String(err?.message ?? 'ติดต่อเซิร์ฟเวอร์ไม่สำเร็จ'));
            setManualUrl(true);
          }
        } finally {
          if (!cancelled) setResolving(false);
        }
      })();
    }, 400);

    // ข่าวเปลี่ยนก่อนผลกลับมา = ทิ้งผลเก่า ห้ามเอา URL ของข่าวก่อนหน้ามาแปะข่าวใหม่
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [current?.id, blockedUrl]);

  const updateJob = (articleId: string, patch: Partial<BackgroundJob>) => {
    if (!aliveRef.current) return;
    setJobs((prev) => prev.map((j) => (j.articleId === articleId ? { ...j, ...patch } : j)));
  };

  /* ---------------- คิวงานสกัดเบื้องหลัง ---------------- */

  /**
   * ยิงงานสกัดทีละ EXTRACT_CONCURRENCY ราย
   *
   * ข้อมูลถูกบันทึกไปแล้วตั้งแต่ตอน attach — ขั้นนี้แค่เร่งให้เห็นผลเร็วขึ้น
   * ถ้าล้มเหลวหรือผู้ใช้ปิดแท็บ pipeline รอบถัดไปก็เก็บงานนี้ต่อได้เอง
   */
  const pump = () => {
    while (runningRef.current < EXTRACT_CONCURRENCY && queueRef.current.length > 0) {
      const job = queueRef.current.shift()!;
      runningRef.current++;
      void (async () => {
        try {
          const result = await callApi<ExtractUrlResponse>('/api/ai/extract-url', {
            url: job.url,
            articleId: job.articleId,
            newsAgency: job.newsAgency,
          });

          if (result.duplicate) {
            updateJob(job.articleId, { state: 'done', message: result.message ?? 'ซ้ำกับเคสที่มีอยู่' });
          } else if (!result.data) {
            updateJob(job.articleId, {
              state: 'done',
              message: result.message ?? 'ไม่เข้าเกณฑ์ — ตัดออกแล้ว',
            });
          } else {
            updateJob(job.articleId, {
              state: 'done',
              message: `บันทึกเป็นเคส #${result.seq}${result.duplicateSeq ? ` (สงสัยซ้ำกับ #${result.duplicateSeq})` : ''}`,
            });
            void onRefresh();
          }
        } catch (err: any) {
          const message = String(err?.message ?? 'สกัดข้อมูลไม่สำเร็จ');
          // 4 จาก 7 สำนักบล็อกการดึงหน้าบทความจากเซิร์ฟเวอร์ (ไม่ใช่เพราะ User-Agent —
          // UA เบราว์เซอร์ก็ 403 เท่ากัน) ทางออกคือให้ผู้ใช้วางเนื้อข่าวแทน
          const blocked = /403|ดึงเนื้อข่าวไม่สำเร็จ|สั้นเกินไป/.test(message);
          updateJob(job.articleId, {
            state: 'failed',
            message: blocked ? 'สำนักนี้บล็อกการดึงหน้าเว็บ — ต้องวางเนื้อข่าว' : message,
          });
          // ต้องเอากลับเข้าคิวให้คนจัดการ ห้ามหายเงียบ
          if (blocked && aliveRef.current) {
            setRows((prev) => (prev.some((r) => r.id === job.row.id) ? prev : [...prev, job.row]));
          }
        } finally {
          runningRef.current--;
          pump();
        }
      })();
    }
  };

  /* ---------------- การกระทำของผู้ใช้ ---------------- */

  /** ข้ามไปข่าวถัดไปโดยไม่ตัดสิน — ยังอยู่ในคิว */
  const skip = () => {
    setBlockedUrl(null);
    setIndex((i) => Math.min(i + 1, total));
  };

  /** เอาข่าวปัจจุบันออกจากรายการในจอ แล้วอยู่ที่ตำแหน่งเดิม (ข่าวถัดไปเลื่อนขึ้นมา) */
  const consumeCurrent = () => {
    setBlockedUrl(null);
    setDone((d) => d + 1);
    setRows((prev) => prev.filter((_, i) => i !== index));
    setIndex((i) => Math.min(i, Math.max(total - 2, 0)));
  };

  /**
   * ยืนยัน lead ปัจจุบัน แล้วไปข่าวถัดไปทันที
   *
   * URL มาได้ 2 ทาง: ถอดล่วงหน้าไว้แล้ว (ทางหลัก) หรือเจ้าหน้าที่วางเอง (ทางถอย)
   * ทั้งสองทางมาถึงตรงนี้พร้อม URL แล้วเสมอ — endpoint นี้จึงแค่เขียนฐานข้อมูล ~200 ms
   * ไม่ต่อเน็ตออกนอก ไม่มีทางค้าง การสกัดของ AI (5-15 วินาที) ทำเบื้องหลัง
   */
  const submitUrl = async (value: string) => {
    if (!current || busy) return;

    const trimmed = value.trim();
    {
      if (!trimmed) return;
      // ด่านตรวจอยู่ตรงนี้ที่เดียว ทั้งการวาง การกด Enter และการกดปุ่มยืนยันจึงเจอเกณฑ์เดียวกัน
      if (!/^https?:\/\//i.test(trimmed)) {
        // เลี่ยงคำว่า "ที่วางมา" เพราะตอนนี้ค่ามาได้ทั้งจากการพิมพ์ การวาง และคลิปบอร์ด
        onToast('ยังไม่ใช่ URL — ต้องขึ้นต้นด้วย http:// หรือ https://', 'info');
        urlInput.current?.focus();
        return;
      }
      // ดักตั้งแต่ฝั่งเบราว์เซอร์ — /api/leads/attach ปฏิเสธลิงก์นี้อยู่แล้ว ไม่ต้องเสียรอบเดินทาง
      // และเป็นเคสที่เกิดง่ายมาก เพราะผู้ใช้เพิ่งกดเปิดลิงก์ Google News มาหมาดๆ
      if (/^https?:\/\/news\.google\.com\//i.test(trimmed)) {
        onToast(
          'นี่คือลิงก์ Google News ซึ่ง Google เข้ารหัสไว้ ใช้ดึงเนื้อข่าวไม่ได้ — กดเปิดข่าวต้นทางแล้วคัดลอก URL ของสำนักข่าวมาแทน',
          'info'
        );
        urlInput.current?.focus();
        return;
      }
    }

    const lead = current;
    setBusy(true);
    try {
      const attached = await callApi<AttachResponse>('/api/leads/attach', {
        url: trimmed,
        articleId: lead.id,
      });

      consumeCurrent();

      if (attached.duplicate) {
        onToast(attached.message ?? 'ข่าวนี้มีในระบบแล้ว จึงไม่บันทึกซ้ำ', 'info');
        return;
      }

      // ลิงก์ถูกบันทึกแล้ว งานที่เหลือทำเบื้องหลัง — ผู้ใช้ไปข่าวถัดไปได้เลย
      const job: BackgroundJob = {
        articleId: attached.articleId ?? lead.id,
        title: lead.title,
        // เชื่อ URL ที่เซิร์ฟเวอร์ตอบกลับก่อน เพราะทางถอดอัตโนมัติมีแต่ฝั่งนั้นที่รู้
        url: attached.url ?? trimmed,
        newsAgency: lead.news_agency,
        state: 'running',
        message: 'กำลังสกัด',
        row: lead,
      };
      setJobs((prev) => [...prev, job]);
      queueRef.current.push(job);
      pump();
    } catch (err: any) {
      // เซิร์ฟเวอร์ถอดลิงก์ไม่ได้ — เปิดช่องให้เจ้าหน้าที่วาง URL เอง ห้ามปล่อยให้ตัน
      if (err?.payload?.needsManualUrl) {
        setManualUrl(true);
        onToast(String(err?.message ?? 'ถอดลิงก์อัตโนมัติไม่สำเร็จ'), 'info');
        return;
      }
      onToast(String(err?.message ?? 'บันทึกลิงก์ไม่สำเร็จ'), 'info');
    } finally {
      setBusy(false);
    }
  };

  /** สำนักที่บล็อก — ผู้ใช้วางเนื้อข่าวมาเอง ทางนี้ต้องรอ AI เพราะไม่มีที่เก็บเนื้อข่าวไว้ก่อน */
  const submitText = async (value: string) => {
    if (!current || busy || !blockedUrl) return;
    const trimmed = value.trim();
    if (trimmed.length < 200) {
      onToast(`เนื้อข่าวสั้นเกินไป (${trimmed.length} ตัวอักษร) — ต้องอย่างน้อย 200 ตัวอักษร`, 'info');
      textInput.current?.focus();
      return;
    }

    setBusy(true);
    try {
      const result = await callApi<ExtractUrlResponse>('/api/ai/extract-url', {
        url: blockedUrl,
        newsText: trimmed,
        articleId: current.id,
        newsAgency: current.news_agency,
      });

      if (result.duplicate) onToast(result.message ?? 'ข่าวนี้มีในระบบแล้ว', 'info');
      else if (!result.data) onToast(result.message ?? 'ข่าวนี้ไม่เข้าเกณฑ์ — ตัดออกจากคิวแล้ว', 'info');
      else {
        onToast(`บันทึกเป็นเคส #${result.seq} เข้าคิวตรวจสอบแล้ว`);
        await onRefresh();
      }
      consumeCurrent();
    } catch (err: any) {
      onToast(String(err?.message ?? 'สกัดข้อมูลไม่สำเร็จ'), 'info');
    } finally {
      setBusy(false);
    }
  };

  /**
   * หาค่าที่จะยืนยัน — ใช้สิ่งที่อยู่ในช่องก่อน ถ้าช่องว่างจึงไปหยิบจากคลิปบอร์ดให้เอง
   *
   * นี่คือหัวใจของ "กดยืนยันได้เลยไม่ต้องวาง" — ผู้ใช้คัดลอก URL จากแท็บข่าว
   * แล้วกลับมากดปุ่มได้เลย ไม่ต้องคลิกช่องกรอกและไม่ต้องกด Cmd+V
   *
   * readText() ต้องถูกเรียกก่อน await อื่นเสมอ — Safari ให้สิทธิ์เฉพาะ task เดียวกับที่ผู้ใช้กดปุ่ม
   * ถ้ามี await คั่นก่อนหน้าจะถือว่าหมด user gesture แล้วปฏิเสธ
   *
   * คืน null = อ่านไม่ได้ (แจ้งเหตุผลและคืนโฟกัสให้ผู้ใช้วางเองแล้ว ผู้เรียกไม่ต้องแจ้งซ้ำ)
   */
  const valueToConfirm = async (
    typed: string,
    what: 'ลิงก์' | 'เนื้อข่าว',
    focusBack: () => void
  ): Promise<string | null> => {
    const trimmed = typed.trim();
    if (trimmed) return trimmed;

    // navigator.clipboard มีเฉพาะ secure context (https หรือ localhost)
    if (typeof navigator.clipboard?.readText !== 'function') {
      onToast(
        `เบราว์เซอร์นี้อ่านคลิปบอร์ดให้ไม่ได้ — กด Cmd+V (Ctrl+V) วาง${what}ในช่องแล้วกดยืนยันอีกครั้ง`,
        'info'
      );
      focusBack();
      return null;
    }

    try {
      const fromClipboard = (await navigator.clipboard.readText()).trim();
      if (!fromClipboard) {
        onToast(`คลิปบอร์ดว่าง — คัดลอก${what}จากหน้าข่าวก่อน แล้วกดยืนยันอีกครั้ง`, 'info');
        focusBack();
        return null;
      }
      return fromClipboard;
    } catch {
      // ผู้ใช้ไม่อนุญาต หรือเบราว์เซอร์ไม่รองรับ readText — ทางเดิมคือวางเองยังใช้ได้เสมอ
      onToast(
        `เบราว์เซอร์ไม่อนุญาตให้อ่านคลิปบอร์ด — กด Cmd+V (Ctrl+V) วาง${what}ในช่องแล้วกดยืนยันอีกครั้ง`,
        'info'
      );
      focusBack();
      return null;
    }
  };

  /**
   * ไล่ตรวจทีละขั้นว่าเซิร์ฟเวอร์พังตรงไหน
   *
   * มีไว้เพราะเมื่อฟังก์ชันตายบนแพลตฟอร์ม เราได้แค่ 500 เปล่าที่ไม่บอกอะไร
   * และคนใช้งานเข้าไปอ่าน log ของ Vercel ไม่ได้ ปุ่มนี้ยิงทีละขั้นแล้วรายงานว่า
   * ขั้นแรกที่ไม่ตอบกลับคือขั้นไหน ซึ่งชี้จุดพังได้ตรงๆ
   */
  const runDiagnostics = async () => {
    if (!current) return;
    setDiag(['กำลังตรวจ...']);
    const lines: string[] = [];
    try {
      const r = await callApi<ResolveResponse>('/api/leads/attach', {
        articleId: current.id,
        action: 'resolve',
      });
      lines.push('✓ เซิร์ฟเวอร์ตอบกลับได้ปกติ');
      lines.push(r.url ? `✓ ถอดลิงก์สำเร็จ: ${r.url}` : `✕ ถอดไม่สำเร็จ — ${r.reason ?? 'ไม่ทราบสาเหตุ'}`);
    } catch (err: any) {
      lines.push(`✕ เซิร์ฟเวอร์ล้มเหลว — ${String(err?.message ?? err)}`);
      lines.push('↑ ส่งข้อความนี้ให้ผู้ดูแลระบบ');
    }
    setDiag(lines);
  };

  /**
   * ปุ่มหลัก — ยืนยันข่าวนี้โดยไม่ต้องกรอกอะไรเลย
   *
   * URL ถูกถอดไว้ล่วงหน้าตั้งแต่ข่าวขึ้นจอแล้ว ตรงนี้จึงแค่บันทึก ไม่ต้องรอเน็ต
   * ถ้ายังถอดไม่เสร็จก็รอจนกว่าจะรู้ผล ดีกว่าบันทึกมั่วหรือเด้ง error ใส่หน้า
   */
  const confirmLead = async () => {
    if (confirmLock.current || busy || !current) return;
    if (!resolvedUrl) {
      onToast(
        resolving ? 'กำลังถอดลิงก์อยู่ รอสักครู่แล้วกดใหม่' : 'ยังไม่มีลิงก์ให้ยืนยัน',
        'info'
      );
      return;
    }
    confirmLock.current = true;
    try {
      await submitUrl(resolvedUrl);
    } finally {
      confirmLock.current = false;
    }
  };

  /**
   * ปุ่มยืนยันในโหมดวางเอง — ใช้ค่าที่พิมพ์หรือวางไว้ ถ้าช่องว่างจะไปหยิบจากคลิปบอร์ดให้เอง
   *
   * ห้ามปิดปุ่มตอนช่องว่าง — ช่องว่างคือกรณีที่ปุ่มนี้มีไว้ทำงานโดยเฉพาะ
   */
  const confirmUrl = async () => {
    if (confirmLock.current || busy || !current) return;
    confirmLock.current = true;
    setReading(true);
    try {
      const value = await valueToConfirm(urlValue, 'ลิงก์', () => urlInput.current?.focus());
      if (value === null) return;
      // โชว์สิ่งที่หยิบมาจากคลิปบอร์ด ถ้าผิดจะได้แก้ต่อได้เลย ไม่ต้องเดาว่าระบบเห็นอะไร
      setUrlValue(value);
      await submitUrl(value);
    } finally {
      setReading(false);
      confirmLock.current = false;
    }
  };

  /** ปุ่มยืนยันเนื้อข่าว (เฉพาะสำนักที่บล็อกการดึงหน้าเว็บ) — เกณฑ์ 200 ตัวอักษรอยู่ใน submitText */
  const confirmText = async () => {
    if (confirmLock.current || busy || !current || !blockedUrl) return;
    confirmLock.current = true;
    setReading(true);
    try {
      const value = await valueToConfirm(textValue, 'เนื้อข่าว', () => textInput.current?.focus());
      if (value === null) return;
      setTextValue(value);
      await submitText(value);
    } finally {
      setReading(false);
      confirmLock.current = false;
    }
  };

  const reject = async () => {
    if (!current) return;
    setBusy(true);
    try {
      await rejectLead(current.id, 'เจ้าหน้าที่ตัดสินว่าไม่เข้าเกณฑ์');
      onToast('ตัดออกจากคิวแล้ว', 'info');
      consumeCurrent();
    } catch (err: any) {
      onToast(err?.message ?? 'ตัดออกไม่สำเร็จ', 'info');
    } finally {
      setBusy(false);
    }
  };

  /* ---------------- สถานะพิเศษ ---------------- */

  if (loading) {
    return (
      <div className="bg-white border border-neutral-200 rounded-sm p-10 text-center text-neutral-600 text-xs font-mono">
        <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
        กำลังโหลด...
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white border border-red-200 rounded-sm p-5 text-xs text-red-700">{error}</div>
    );
  }

  if (!current) {
    return (
      <div className="space-y-3">
        <div className="bg-white border border-neutral-200 rounded-sm p-10 text-center text-neutral-600">
          <CheckCircle2 className="w-8 h-8 mx-auto text-neutral-900 mb-3" />
          <p className="text-sm text-neutral-700 font-sans">
            {done > 0 ? `จัดการครบแล้ว ${done} รายการ` : 'ไม่มีข่าวที่ต้องยืนยันลิงก์'}
          </p>
          {running > 0 && (
            <p className="mt-2 text-[13px] font-mono text-red-700">
              ยังสกัดอยู่เบื้องหลัง {running} รายการ — ปิดหน้านี้ได้ ระบบทำต่อเอง
            </p>
          )}
          <button
            onClick={() => void load()}
            className="mt-4 text-xs font-mono text-neutral-600 hover:text-neutral-800 border border-neutral-200 px-3 py-1.5 rounded-sm"
          >
            โหลดใหม่
          </button>
        </div>
        <JobStrip jobs={jobs} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="bg-white border border-neutral-200 rounded-sm shadow-xl">
        {/* แถบความคืบหน้า */}
        <div className="px-5 py-3 border-b border-neutral-200 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Link2 className="w-4 h-4 text-red-700 shrink-0" />
            <span className="text-xs font-mono text-neutral-700">
              ยืนยันลิงก์ {index + 1} / {total}
            </span>
            <div className="flex-1 h-1 bg-neutral-200 rounded-full overflow-hidden max-w-[240px]">
              <div
                className="h-full bg-neutral-900 transition-all"
                style={{ width: `${total ? ((index + 1) / total) * 100 : 0}%` }}
              />
            </div>
            {done > 0 && <span className="text-xs font-mono text-neutral-900">เสร็จแล้ว {done}</span>}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={skip}
              disabled={busy}
              className="text-[13px] font-mono text-neutral-600 hover:text-neutral-800 border border-neutral-200 px-2.5 py-1.5 rounded-sm disabled:opacity-40"
            >
              ข้าม
            </button>
            <button
              onClick={() => void reject()}
              disabled={!canEdit || busy}
              className="text-[13px] font-mono text-red-700 hover:text-red-700 border border-red-200 px-2.5 py-1.5 rounded-sm disabled:opacity-40"
            >
              ไม่เกี่ยวข้อง
            </button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* พาดหัวและที่มา */}
          <div>
            <h3 className="font-serif text-lg text-neutral-900 leading-snug">{current.title}</h3>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px] font-mono text-neutral-600">
              <span>{current.news_agency || 'ไม่ทราบสำนัก'}</span>
              <span>·</span>
              <span>{current.published_at?.slice(0, 10) ?? 'ไม่ระบุวัน'}</span>
              {current.screen_score !== null && <span>· คะแนนคัดกรอง {current.screen_score}</span>}
            </div>
          </div>

          {/* การกระทำหลัก — ยืนยันได้เลย ไม่ต้องกรอกอะไร */}
          <div className="flex flex-wrap items-center gap-2">
            {!blockedUrl && !manualUrl && (
              <button
                onClick={() => void confirmLead()}
                disabled={!canEdit || busy || resolving || !resolvedUrl}
                className="px-6 py-3 rounded-sm bg-neutral-900 hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-mono font-bold transition-all shadow-md flex items-center gap-2"
              >
                {busy || resolving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                )}
                <span>ยืนยันข่าวนี้</span>
              </button>
            )}
            {current.gnews_link && (
              <a
                href={current.gnews_link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-3 border border-neutral-300 hover:border-neutral-400 hover:bg-neutral-100 text-neutral-800 text-xs font-mono rounded-sm transition-all"
              >
                เปิดข่าวต้นทาง
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>

          {/* คำอธิบายทางหลัก — ไม่ต้องมีช่องกรอกใดๆ ให้เห็น */}
          {!blockedUrl && !manualUrl && (
            <div className="space-y-2">
              {/* โชว์ URL ที่ถอดได้ก่อนกดยืนยัน — เจ้าหน้าที่จะได้ตรวจว่าเป็นข่าวเดียวกันจริง */}
              {resolving ? (
                <p className="text-[13px] font-mono text-neutral-600 flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  กำลังถอดลิงก์ต้นทาง...
                </p>
              ) : resolvedUrl ? (
                <p className="text-[13px] font-mono text-neutral-600 break-all">
                  ลิงก์ที่จะบันทึก:{' '}
                  <a
                    href={resolvedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-red-700/80 hover:text-red-700 underline"
                  >
                    {resolvedUrl}
                  </a>
                </p>
              ) : null}
              <p className="text-[13px] text-neutral-600 font-sans">
                ระบบถอดลิงก์ Google News เป็น URL ของสำนักข่าวต้นทางให้ตั้งแต่ข่าวขึ้นจอ
                กดยืนยันได้เลยไม่ต้องคัดลอกอะไร แล้วไปข่าวถัดไปทันที ไม่ต้องรอ AI
              </p>
            </div>
          )}

          {/* ช่องรับ URL หรือเนื้อข่าว */}
          {blockedUrl ? (
            <div className="space-y-2">
              <label className="block text-[13px] font-sans text-red-700">
                สำนักนี้บล็อกการดึงหน้าเว็บจากเซิร์ฟเวอร์ — คัดลอกเนื้อข่าวจากหน้าที่เปิดไว้มาวางที่นี่
                หรือคัดลอกแล้วกด “ยืนยันเนื้อข่าว” ระบบจะหยิบจากคลิปบอร์ดให้เอง
                <span className="block text-neutral-600 font-mono mt-0.5 truncate">URL ที่จะบันทึก: {blockedUrl}</span>
              </label>
              <textarea
                ref={textInput}
                rows={7}
                value={textValue}
                disabled={busy}
                onChange={(e) => setTextValue(e.target.value)}
                onPaste={(e) => {
                  const text = e.clipboardData.getData('text');
                  if (text.trim().length > 200) {
                    e.preventDefault();
                    // เก็บไว้ให้เห็นด้วย เผื่อสกัดไม่สำเร็จจะได้ไม่ต้องกลับไปคัดลอกใหม่
                    setTextValue(text.trim());
                    void submitText(text);
                  }
                }}
                placeholder="วางเนื้อข่าวที่นี่ (Cmd+V) แล้วระบบทำต่อเอง"
                className="w-full bg-neutral-50 border border-red-200 rounded-sm p-3.5 text-xs text-neutral-900 placeholder-neutral-400 focus:outline-none focus:border-red-400 leading-relaxed font-sans disabled:opacity-50"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => void confirmText()}
                  disabled={!canEdit || busy || reading}
                  title="ยังไม่ได้วางก็กดได้ — ระบบจะหยิบเนื้อข่าวที่คัดลอกไว้จากคลิปบอร์ดให้เอง"
                  className="shrink-0 px-5 py-2.5 rounded-sm bg-neutral-900 hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-mono font-bold transition-all shadow-md flex items-center gap-2"
                >
                  {busy || reading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ClipboardPaste className="w-3.5 h-3.5" />
                  )}
                  <span>ยืนยันเนื้อข่าว</span>
                </button>
                <span className="text-[13px] font-mono text-neutral-600">
                  {busy
                    ? `กำลังสกัดข้อมูล... ${elapsed} วินาที (ทางนี้ต้องรอ AI)`
                    : `${textValue.trim().length} / 200 ตัวอักษร`}
                </span>
                <button
                  onClick={() => {
                    setBlockedUrl(null);
                    setTextValue('');
                  }}
                  className="ml-auto text-[13px] font-mono text-neutral-600 hover:text-neutral-700"
                >
                  ← กลับไปวาง URL
                </button>
              </div>
            </div>
          ) : manualUrl ? (
            <div className="space-y-2">
              <p className="text-[13px] font-sans text-red-700">
                ถอดลิงก์อัตโนมัติของข่าวนี้ไม่สำเร็จ — กดเปิดข่าวต้นทางแล้วเอา URL ของสำนักข่าวมาให้ระบบ
                {resolveReason && (
                  <span className="block text-neutral-600 font-mono mt-0.5">สาเหตุ: {resolveReason}</span>
                )}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={urlInput}
                  type="url"
                  value={urlValue}
                  disabled={busy}
                  onChange={(e) => setUrlValue(e.target.value)}
                  onKeyDown={(e) => {
                    // มีปุ่มแล้วต้องรับ Enter ด้วย — ช่องกรอกที่กด Enter แล้วเงียบคือบั๊ก
                    // isComposing กันไม่ให้ Enter ที่ใช้ยืนยันคำภาษาไทยจาก IME ไปสั่งบันทึก
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void confirmUrl();
                    }
                  }}
                  onPaste={(e) => {
                    // ทางลัดเดิม: วางแล้วส่งทันทีโดยไม่ต้องกดปุ่ม เร็วที่สุดสำหรับคนที่ชินแล้ว
                    const text = e.clipboardData.getData('text');
                    if (/^https?:\/\//i.test(text.trim())) {
                      e.preventDefault();
                      // เก็บไว้ให้เห็นด้วย เผื่อบันทึกไม่สำเร็จจะได้ไม่ต้องกลับไปคัดลอกใหม่
                      setUrlValue(text.trim());
                      void submitUrl(text);
                    }
                  }}
                  placeholder="วาง URL ของข่าวที่นี่ (Cmd+V) หรือพิมพ์แล้วกด Enter"
                  className="flex-1 min-w-[240px] bg-neutral-50 border border-neutral-300 rounded-sm px-4 py-3.5 text-xs text-neutral-900 placeholder-neutral-400 focus:outline-none focus:border-red-500 font-mono disabled:opacity-50"
                />
                <button
                  onClick={() => void confirmUrl()}
                  disabled={!canEdit || busy || reading}
                  title="ยังไม่ได้วางก็กดได้ — ระบบจะหยิบลิงก์ที่คัดลอกไว้จากคลิปบอร์ดให้เอง"
                  className="shrink-0 px-5 py-3.5 rounded-sm bg-neutral-900 hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-mono font-bold transition-all shadow-md flex items-center gap-2"
                >
                  {busy || reading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ClipboardPaste className="w-3.5 h-3.5" />
                  )}
                  <span>ยืนยันลิงก์นี้</span>
                </button>
              </div>
              <p className="text-[13px] text-neutral-600 font-sans">
                กดเปิดข่าวด้านบน คัดลอก URL แล้วกลับมากด “ยืนยันลิงก์นี้” ได้เลย ไม่ต้องวาง —
                ระบบหยิบจากคลิปบอร์ดให้เอง แล้วไปข่าวถัดไปทันที ไม่ต้องรอ AI
              </p>
              <p className="text-[13px] text-neutral-600 font-sans">
                เร็วกว่านี้ได้อีก:{' '}
                <a
                  href="#/bookmarklet"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-red-700/80 hover:text-red-700 underline"
                >
                  ติดตั้งปุ่มจับข่าว
                </a>{' '}
                ไว้บนแถบบุ๊กมาร์ก แล้วกดครั้งเดียวจากหน้าข่าวได้เลย ไม่ต้องคัดลอก-สลับแท็บ-วาง
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => setManualUrl(false)}
                  className="text-[13px] font-mono text-neutral-600 hover:text-neutral-700"
                >
                  ← ลองถอดลิงก์อัตโนมัติอีกครั้ง
                </button>
                <button
                  onClick={() => void runDiagnostics()}
                  className="text-[13px] font-mono text-neutral-600 hover:text-neutral-800 border border-neutral-300 px-2.5 py-1 rounded-sm"
                >
                  ตรวจหาสาเหตุ
                </button>
              </div>
              {diag && (
                <pre className="mt-1 bg-neutral-50 border border-neutral-200 rounded-sm p-3 text-[12px] font-mono text-neutral-800 whitespace-pre-wrap break-all">
                  {diag.join('\n')}
                </pre>
              )}
            </div>
          ) : null}
        </div>
      </div>

      <JobStrip jobs={jobs} />
    </div>
  );
};

/**
 * แถบผลงานเบื้องหลัง
 *
 * จำเป็นเพราะผู้ใช้ไม่ได้รอผลทีละรายการอีกแล้ว ถ้าไม่มีที่แสดงผล
 * จะไม่มีทางรู้ว่าข่าวไหนสกัดสำเร็จ ข่าวไหนโดนสำนักบล็อก
 */
const JobStrip: React.FC<{ jobs: BackgroundJob[] }> = ({ jobs }) => {
  if (jobs.length === 0) return null;

  // ใหม่สุดอยู่บน และแสดงพอประมาณ ไม่ให้ยาวจนบังคิว
  const shown = [...jobs].reverse().slice(0, 8);
  const running = jobs.filter((j) => j.state === 'running').length;

  return (
    <div className="bg-white border border-neutral-200 rounded-sm">
      <div className="px-4 py-2 border-b border-neutral-200 flex items-center gap-2">
        {running > 0 ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-red-700" />
        ) : (
          <CheckCircle2 className="w-3.5 h-3.5 text-neutral-900" />
        )}
        <span className="text-[13px] font-mono text-neutral-600">
          งานเบื้องหลัง — กำลังสกัด {running} · เสร็จแล้ว {jobs.filter((j) => j.state === 'done').length}
          {jobs.some((j) => j.state === 'failed') &&
            ` · ต้องจัดการเอง ${jobs.filter((j) => j.state === 'failed').length}`}
        </span>
      </div>
      <ul className="divide-y divide-neutral-200">
        {shown.map((job) => (
          <li key={job.articleId} className="px-4 py-2 flex items-start gap-2.5 text-[13px]">
            <span className="mt-0.5 shrink-0">
              {job.state === 'running' && <Loader2 className="w-3 h-3 animate-spin text-red-700" />}
              {job.state === 'done' && <CheckCircle2 className="w-3 h-3 text-neutral-900" />}
              {job.state === 'failed' && <AlertCircle className="w-3 h-3 text-red-700" />}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block truncate text-neutral-600 font-sans">{job.title}</span>
              <span
                className={`block font-mono ${
                  job.state === 'failed'
                    ? 'text-red-700'
                    : job.state === 'done'
                      ? 'text-neutral-900'
                      : 'text-neutral-600'
                }`}
              >
                {job.message}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

/* ------------------------------------------------------------------ */

const TabButton: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({
  active,
  onClick,
  children,
}) => (
  <button
    onClick={onClick}
    className={`text-xs font-mono px-3 py-1.5 rounded-sm border transition-colors ${
      active
        ? 'bg-neutral-200 text-neutral-900 border-neutral-400'
        : 'bg-neutral-50 text-neutral-600 border-neutral-200 hover:text-neutral-700'
    }`}
  >
    {children}
  </button>
);

const Badge: React.FC<{ tone: 'amber' | 'zinc'; children: React.ReactNode }> = ({ tone, children }) => (
  <span
    className={`inline-flex items-center gap-1 text-[13px] font-mono px-1.5 py-0.5 rounded-sm border ${
      tone === 'amber'
        ? 'bg-red-50 text-red-700 border-red-200'
        : 'bg-neutral-100 text-neutral-600 border-neutral-200'
    }`}
  >
    {children}
  </span>
);
