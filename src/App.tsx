import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Database, Loader2 } from 'lucide-react';

import { CrimeIncident, createEmptyIncident } from './types/dataDictionary';
import { isSupabaseConfigured } from './lib/supabase';
import { IncidentRecord } from './lib/incidentsRepo';
import { useAuth } from './hooks/useAuth';
import { useIncidents } from './hooks/useIncidents';

import { Navbar, ActiveTab } from './components/Navbar';
import { AnalyticsDashboard } from './components/AnalyticsDashboard';
import { RecordList } from './components/RecordList';
import { IncidentForm } from './components/IncidentForm';
import { AiNewsParser } from './components/AiNewsParser';
import { DataDictionaryView } from './components/DataDictionaryView';
import { DataImportExport } from './components/DataImportExport';
import { IncidentDetailModal } from './components/IncidentDetailModal';
import { ReviewQueue } from './components/ReviewQueue';
import { SourcesAdmin } from './components/SourcesAdmin';
import { LoginPanel } from './components/LoginPanel';

const ROLE_LABELS: Record<string, string> = {
  anon: 'ผู้เยี่ยมชม',
  viewer: 'ผู้อ่าน',
  editor: 'เจ้าหน้าที่บันทึกข้อมูล',
  admin: 'ผู้ดูแลระบบ',
};

/**
 * ค่าเริ่มต้นของฟอร์ม — เว้นฟิลด์ที่สื่อข้อเท็จจริงไว้ว่าง
 * (เดิมตั้งดีฟอลต์ beverage_type = 'สุราขาว/สุราสี' ให้ทุกเรคคอร์ด
 *  ทำให้สถิติ "เกี่ยวข้องกับแอลกอฮอล์" พองเป็น ~100%)
 */
function newIncidentDraft(): CrimeIncident {
  return {
    ...createEmptyIncident(0),
    news_type: 'อุบัติเหตุเมาขับ',
    incident_date: new Date().toISOString().split('T')[0],
    incident_time: '',
    province: '',
  };
}

export function App() {
  const auth = useAuth();
  const incidents = useIncidents(auth.isAuthenticated, !auth.loading && isSupabaseConfigured);

  const [activeTab, setActiveTab] = useState<ActiveTab>('analytics');
  const [selectedIncident, setSelectedIncident] = useState<IncidentRecord | null>(null);
  const [formIncident, setFormIncident] = useState<CrimeIncident>(newIncidentDraft);
  const [editingUuid, setEditingUuid] = useState<string | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'info' } | null>(null);

  const showToast = (text: string, type: 'success' | 'info' = 'success') => {
    setToast({ text, type });
    window.setTimeout(() => setToast(null), 4000);
  };

  // ออกจากแท็บที่ไม่มีสิทธิ์เข้าถึงเมื่อผู้ใช้ออกจากระบบ
  useEffect(() => {
    const restricted: ActiveTab[] = ['review_queue', 'form', 'ai_parser', 'sources'];
    if (restricted.includes(activeTab) && !auth.isAuthenticated) setActiveTab('analytics');
    if ((activeTab === 'form' || activeTab === 'ai_parser') && !auth.canEdit && auth.isAuthenticated) {
      setActiveTab('analytics');
    }
  }, [activeTab, auth.isAuthenticated, auth.canEdit]);

  /* ---------------- handlers ---------------- */

  const handleStartNewIncident = () => {
    setFormIncident(newIncidentDraft());
    setEditingUuid(null);
    setActiveTab('form');
  };

  const handleEditIncident = (incident: CrimeIncident) => {
    const record = incident as IncidentRecord;
    setFormIncident(record);
    setEditingUuid(record.uuid || null);
    setActiveTab('form');
    setSelectedIncident(null);
  };

  const handleSaveForm = async (data: CrimeIncident) => {
    try {
      const record = await incidents.save(data, editingUuid ?? undefined);
      showToast(
        editingUuid
          ? `บันทึกการแก้ไขเหตุการณ์ #${record.id} สำเร็จ`
          : `บันทึกเหตุการณ์ใหม่ #${record.id} สำเร็จ`
      );
      setEditingUuid(null);
      setActiveTab('records');
    } catch (err: any) {
      showToast(err?.message ?? 'บันทึกไม่สำเร็จ', 'info');
    }
  };

  const handleDeleteIncident = async (id: number) => {
    const record = incidents.all.find((r) => r.id === id);
    if (!record?.uuid) return;
    try {
      await incidents.remove(record.uuid);
      showToast(`ลบเหตุการณ์ลำดับที่ ${id} เรียบร้อยแล้ว`, 'info');
    } catch (err: any) {
      showToast(err?.message ?? 'ลบไม่สำเร็จ', 'info');
    }
  };

  const handleDuplicateIncident = async (incident: CrimeIncident) => {
    try {
      const record = await incidents.save({
        ...incident,
        news_title: `${incident.news_title} (สำเนา)`,
      });
      showToast(`คัดลอกเป็นเหตุการณ์ใหม่ #${record.id} สำเร็จ`);
    } catch (err: any) {
      showToast(err?.message ?? 'คัดลอกไม่สำเร็จ', 'info');
    }
  };

  /**
   * บันทึกผลที่ AI สกัดมา
   *
   * ต้องเข้าคิวเป็น 'pending' ไม่ใช่ 'approved' — เดิมบันทึกเป็นอนุมัติแล้วทันที
   * ทำให้ข้อมูลจาก AI เข้าสถิติโดยไม่ผ่านสายตาคน ขัดกับหลักการของระบบ
   */
  const handleSaveExtractedFromAi = async (
    data: CrimeIncident & { alcohol_involved?: boolean; alcohol_role?: string | null }
  ) => {
    try {
      const record = await incidents.save(data, undefined, {
        status: 'pending',
        alcohol_involved: data.alcohol_involved,
        alcohol_role: data.alcohol_role ?? null,
      });
      showToast(`บันทึกเคส #${record.id} เข้าคิวตรวจสอบแล้ว — กดอนุมัติเพื่อให้นับในสถิติ`);
      setActiveTab('review_queue');
    } catch (err: any) {
      showToast(err?.message ?? 'บันทึกไม่สำเร็จ', 'info');
    }
  };

  /**
   * คืนจำนวนที่บันทึกสำเร็จและ **โยน error ต่อ** — ผู้เรียก (การย้ายข้อมูลจาก localStorage)
   * ต้องรู้ผลก่อนตัดสินใจลบข้อมูลต้นทาง
   */
  const handleImportData = async (newIncidents: CrimeIncident[]): Promise<number> => {
    try {
      const count = await incidents.importMany(newIncidents);
      showToast(`นำเข้าข้อมูล ${count} รายการเข้าสู่ฐานข้อมูลแล้ว`);
      return count;
    } catch (err: any) {
      showToast(err?.message ?? 'นำเข้าไม่สำเร็จ', 'info');
      throw err;
    }
  };

  const pendingCount = incidents.pending.length;
  /**
   * ชุดข้อมูลของแท็บ "ฐานข้อมูลเหตุการณ์" และ "นำเข้า/ส่งออก"
   *
   * เดิมสลับข้างกัน: คนล็อกอินได้ `approved` (เห็นน้อยกว่า) ส่วนคนไม่ล็อกอินได้ `all`
   * เจ้าหน้าที่จึงมองไม่เห็นเคสที่รอตรวจและเคสที่ปฏิเสธไว้เลย ทั้งที่เป็นงานของตัวเอง
   *
   * ที่ถูกคือ: เจ้าหน้าที่เห็นทุกสถานะ (RLS ให้สิทธิ์อยู่แล้ว) ·
   * ผู้ไม่ล็อกอินอ่านผ่าน view `incidents_public` ซึ่งกรองเหลือเฉพาะที่อนุมัติอยู่แล้ว
   */
  const recordsForDisplay = useMemo(
    () => (auth.isAuthenticated ? incidents.all : incidents.approved),
    [auth.isAuthenticated, incidents.all, incidents.approved]
  );

  /* ---------------- หน้าจอตั้งค่า ---------------- */

  if (!isSupabaseConfigured) {
    return <SetupScreen />;
  }

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-700 flex flex-col font-sans selection:bg-neutral-900 selection:text-black">
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 max-w-md bg-white border border-neutral-300 text-neutral-900 px-4 py-3 rounded-sm shadow-2xl flex items-start gap-2 text-xs font-mono">
          <span
            className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${
              toast.type === 'success' ? 'bg-neutral-900' : 'bg-neutral-900'
            }`}
          />
          <span className="font-medium">{toast.text}</span>
        </div>
      )}

      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        totalRecords={incidents.approved.length}
        pendingCount={pendingCount}
        onNewIncident={handleStartNewIncident}
        isAuthenticated={auth.isAuthenticated}
        canEdit={auth.canEdit}
        isAdmin={auth.isAdmin}
        userLabel={auth.fullName ?? auth.email}
        roleLabel={ROLE_LABELS[auth.role] ?? auth.role}
        onSignIn={() => setShowLogin(true)}
        onSignOut={() => void auth.signOut()}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/*
          โหลดไม่สำเร็จและยังไม่มีข้อมูลเลย = ต้องไม่เรนเดอร์แดชบอร์ดต่อ
          เดิมแบนเนอร์นี้ขึ้นคู่กับแดชบอร์ดที่แสดงเลข 0 ทุกช่อง ผู้ใช้ทั่วไปอ่านได้ว่า
          "ไม่มีเหตุการณ์เกิดขึ้น" ทั้งที่ความจริงคือระบบต่อฐานข้อมูลไม่ได้
        */}
        {incidents.error && incidents.all.length === 0 ? (
          <div className="py-20 max-w-lg mx-auto text-center">
            <div className="inline-flex p-3 rounded-sm bg-red-50 border border-red-200 mb-4">
              <AlertTriangle className="w-6 h-6 text-red-700" />
            </div>
            <h2 className="font-serif text-xl text-neutral-900">โหลดข้อมูลไม่สำเร็จ</h2>
            <p className="mt-2 text-xs text-neutral-600 font-sans leading-relaxed">
              ระบบเชื่อมต่อฐานข้อมูลไม่ได้ในขณะนี้ — ตัวเลขสถิติจึงยังแสดงไม่ได้
              <br />
              ถ้าเพิ่งเปิดหน้านี้ครั้งแรก ลองกดโหลดใหม่อีกครั้ง
            </p>
            <p className="mt-3 text-[13px] text-red-700 font-mono break-words">{incidents.error}</p>
            <button
              onClick={() => void incidents.refresh()}
              className="mt-5 inline-flex items-center gap-2 px-4 py-2.5 bg-neutral-900 hover:bg-black text-white text-xs font-mono font-bold  rounded-sm"
            >
              โหลดใหม่
            </button>
          </div>
        ) : (
        <>
        {incidents.error && (
          <div className="mb-4 p-3.5 bg-neutral-100 border border-red-200 rounded-sm text-xs text-red-700 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">อัปเดตข้อมูลล่าสุดไม่สำเร็จ — ตัวเลขที่เห็นอาจไม่ใช่ค่าปัจจุบัน</p>
              <p className="text-red-700 mt-0.5 break-words">{incidents.error}</p>
            </div>
            <button
              onClick={() => void incidents.refresh()}
              className="shrink-0 text-[13px] font-mono text-red-700 hover:text-white border border-red-200 px-2.5 py-1 rounded-sm"
            >
              ลองใหม่
            </button>
          </div>
        )}

        {incidents.redacted && !auth.isAuthenticated && (
          <div className="mb-4 p-3 bg-white border border-neutral-200 rounded-sm text-[13px] text-neutral-600 font-sans flex items-center gap-2">
            <Database className="w-3.5 h-3.5 text-neutral-600 shrink-0" />
            <span>
              คุณกำลังดูข้อมูลสาธารณะที่ตัดชื่อผู้ก่อเหตุและชื่อเหยื่อออกแล้ว
              และแสดงเฉพาะเคสที่ผ่านการตรวจสอบ — เจ้าหน้าที่เข้าสู่ระบบเพื่อดูข้อมูลเต็ม
            </span>
          </div>
        )}

        {/*
          ระหว่างโหลดครั้งแรกต้องไม่แสดงแดชบอร์ดเลข 0 ควบคู่ไปด้วย
          เดิมสองบล็อกนี้เป็นพี่น้องกัน ผู้ใช้จึงเห็นสปินเนอร์กับ "0 เหตุการณ์" พร้อมกัน
        */}
        {incidents.loading && incidents.all.length === 0 ? (
          <div className="py-24 text-center text-neutral-600 text-xs font-mono flex flex-col items-center gap-3">
            <Loader2 className="w-6 h-6 animate-spin" />
            กำลังโหลดข้อมูลจากฐานข้อมูล...
          </div>
        ) : (
        <>

        {activeTab === 'analytics' && (
          <AnalyticsDashboard
            incidents={incidents.approved}
            onNavigateToForm={handleStartNewIncident}
            onSelectIncident={(inc) => setSelectedIncident(inc as IncidentRecord)}
            canEdit={auth.canEdit}
            updatedAt={incidents.loadedAt}
          />
        )}

        {activeTab === 'records' && (
          <RecordList
            incidents={recordsForDisplay}
            onViewIncident={(inc) => setSelectedIncident(inc as IncidentRecord)}
            onEditIncident={handleEditIncident}
            onDeleteIncident={(id) => void handleDeleteIncident(id)}
            onDuplicateIncident={(inc) => void handleDuplicateIncident(inc)}
            onNewIncident={handleStartNewIncident}
            readOnly={!auth.canEdit}
          />
        )}

        {activeTab === 'review_queue' && (
          <ReviewQueue
            pending={incidents.pending}
            approved={incidents.approved}
            rejected={incidents.rejected}
            loading={incidents.loading}
            canEdit={auth.canEdit}
            onApprove={(uuid, note) => incidents.changeStatus(uuid, 'approved', note)}
            onReject={(uuid, note) => incidents.changeStatus(uuid, 'rejected', note)}
            onRestore={(uuid, note) => incidents.changeStatus(uuid, 'pending', note)}
            onSaveEdits={async (data, uuid) => {
              await incidents.save(data, uuid);
            }}
            onRefresh={incidents.refresh}
            onToast={showToast}
          />
        )}

        {activeTab === 'form' && (
          <IncidentForm
            initialData={formIncident}
            isEditing={Boolean(editingUuid)}
            onSave={(data) => void handleSaveForm(data)}
            onCancel={() => {
              setEditingUuid(null);
              setActiveTab('records');
            }}
          />
        )}

        {activeTab === 'ai_parser' && (
          <AiNewsParser
            onSaveExtracted={(data) => void handleSaveExtractedFromAi(data)}
            onOpenInForm={(data) => {
              setFormIncident(data);
              setEditingUuid(null);
              setActiveTab('form');
            }}
          />
        )}

        {activeTab === 'sources' && (
          <SourcesAdmin canEdit={auth.canEdit} isAdmin={auth.isAdmin} onToast={showToast} />
        )}

        {activeTab === 'dictionary' && <DataDictionaryView />}

        {activeTab === 'import_export' && (
          <DataImportExport
            incidents={recordsForDisplay}
            canEdit={auth.canEdit}
            onImportData={handleImportData}
            onToast={showToast}
          />
        )}
        </>
        )}
        </>
        )}
      </main>

      <IncidentDetailModal
        incident={selectedIncident}
        onClose={() => setSelectedIncident(null)}
        onEdit={auth.canEdit ? handleEditIncident : undefined}
      />

      <LoginPanel open={showLogin} onClose={() => setShowLogin(false)} onSignIn={auth.signIn} />

      {/*
        ท้ายเว็บ: เดิมโฆษณา "SUPABASE CONNECTED" เป็นสีเขียวแบบฮาร์ดโค้ด
        แม้ตอนที่โหลดข้อมูลล้มเหลว — เป็นข้อมูลที่ไม่จริงและผู้ใช้ทั่วไปก็ไม่ได้ประโยชน์
        เปลี่ยนเป็นข้อความที่บอกที่มาของข้อมูลจริงๆ
      */}
      <footer className="border-t border-neutral-200 bg-white py-5 text-center text-xs text-neutral-600">
        <div className="max-w-7xl mx-auto px-4 space-y-1">
          <p>
            ข้อมูลรวบรวมจากข่าวที่เผยแพร่ต่อสาธารณะ และผ่านการตรวจสอบโดยเจ้าหน้าที่ก่อนนับเป็นสถิติ
          </p>
          <p className="text-neutral-600">
            เป็นสถิติจากข่าวที่มีการรายงาน ไม่ใช่จำนวนเหตุการณ์ที่เกิดขึ้นจริงทั้งหมด
          </p>
        </div>
      </footer>
    </div>
  );
}

/** แสดงเมื่อยังไม่ได้ตั้งค่า env ของ Supabase */
const SetupScreen: React.FC = () => (
  <div className="min-h-screen bg-neutral-50 text-neutral-700 flex items-center justify-center p-6 font-sans">
    <div className="max-w-lg w-full bg-white border border-neutral-200 rounded-sm p-6 space-y-4">
      <div className="flex items-center gap-2.5">
        <Database className="w-5 h-5 text-red-700" />
        <h1 className="font-serif text-xl text-neutral-900">ยังไม่ได้เชื่อมต่อฐานข้อมูล</h1>
      </div>
      <p className="text-xs text-neutral-600 leading-relaxed">
        ระบบต้องการตัวแปรสภาพแวดล้อมของ Supabase จึงจะทำงานได้ ตั้งค่าสองตัวนี้ในไฟล์
        <code className="mx-1 px-1.5 py-0.5 bg-neutral-100 border border-neutral-200 rounded-sm font-mono text-[13px]">
          .env.local
        </code>
        (ตอนพัฒนา) หรือใน Project Settings → Environment Variables ของ Vercel (ตอน deploy)
      </p>
      <pre className="bg-neutral-50 border border-neutral-200 rounded-sm p-3.5 text-[13px] font-mono text-neutral-700 overflow-x-auto">
{`VITE_SUPABASE_URL="https://xxxx.supabase.co"
VITE_SUPABASE_ANON_KEY="eyJhbGciOi..."`}
      </pre>
      <p className="text-[13px] text-neutral-600 leading-relaxed">
        จากนั้นรัน migration ใน <span className="font-mono">supabase/migrations/</span> ตามลำดับ
        และตั้งค่าฝั่งเซิร์ฟเวอร์ (SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY, CRON_SECRET)
        — รายละเอียดทั้งหมดอยู่ใน README.md
      </p>
    </div>
  </div>
);

export default App;
