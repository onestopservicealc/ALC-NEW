/**
 * ปลายทางของ "ปุ่มจับข่าว" — หน้าต่างเล็กที่เปิดขึ้นจากหน้าเว็บสำนักข่าว
 *
 * ทำไมต้องมีหน้านี้แทนที่จะให้ bookmarklet ยิง API ตรง:
 * bookmarklet ทำงานอยู่บนโดเมนของสำนักข่าว จึงอ่าน session ของเราไม่ได้
 * (คนละ origin) ถ้าจะยิง API ตรงต้องฝัง token ไว้ในบุ๊กมาร์ก = สร้างกุญแจใบใหม่ที่รั่วได้
 *
 * หน้านี้อยู่บนโดเมนของเราเอง จึงมี session อยู่แล้ว — bookmarklet แค่ส่ง
 * URL กับเนื้อข่าวมาทาง postMessage ไม่ต้องมี token ไม่ต้องตั้ง CORS
 *
 * ความปลอดภัย: ข้อความที่รับมาถือเป็น "ข้อมูล" ไม่ใช่คำสั่ง — ส่งต่อให้ AI สกัด
 * แล้วเข้าคิวรอเจ้าหน้าที่ตรวจเหมือนทุกช่องทาง ไม่มีทางลัดไปหน้าสาธารณะ
 */
import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Wine } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { LoginPanel } from '../components/LoginPanel';
import { callApi } from '../lib/supabase';

/** เนื้อข่าวยาวสุดที่รับ — กันหน้าเว็บที่ยัดข้อความมหาศาลมาให้ */
const MAX_TEXT = 60_000;

interface CapturePayload {
  url: string;
  title: string;
  text: string;
}

type Phase =
  | { kind: 'waiting' }
  | { kind: 'need_login' }
  | { kind: 'working'; payload: CapturePayload }
  | { kind: 'done'; message: string; seq?: number }
  | { kind: 'error'; message: string; payload?: CapturePayload };

function isPayload(value: unknown): value is CapturePayload {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.url === 'string' &&
    /^https?:\/\//i.test(v.url) &&
    typeof v.text === 'string' &&
    typeof v.title === 'string'
  );
}

export const CapturePage: React.FC = () => {
  const auth = useAuth();
  const [phase, setPhase] = useState<Phase>({ kind: 'waiting' });
  const [showLogin, setShowLogin] = useState(false);
  const pendingRef = useRef<CapturePayload | null>(null);
  const sentRef = useRef(false);

  /* ---- รับข้อมูลจาก bookmarklet ---- */
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // ผู้ส่งต้องเป็นหน้าต่างที่เปิดเราขึ้นมาเท่านั้น
      // (origin เป็นของสำนักข่าวซึ่งมีได้หลายโดเมน จึงไม่ใช้ whitelist origin)
      if (e.source !== window.opener) return;
      const data = (e.data as { type?: string; payload?: unknown }) ?? {};
      if (data.type !== 'อ่านข่าวนี้' || !isPayload(data.payload)) return;

      pendingRef.current = {
        url: data.payload.url,
        title: data.payload.title.slice(0, 500),
        text: data.payload.text.slice(0, MAX_TEXT),
      };
      setPhase((p) => (p.kind === 'waiting' ? { kind: 'waiting' } : p));
    };

    window.addEventListener('message', onMessage);
    // บอก bookmarklet ว่าพร้อมรับแล้ว (ต้องหลังจากติด listener เสมอ)
    window.opener?.postMessage({ type: 'พร้อมรับข่าว' }, '*');

    return () => window.removeEventListener('message', onMessage);
  }, []);

  /* ---- ส่งให้ AI เมื่อได้ทั้งข้อมูลและสิทธิ์ ---- */
  useEffect(() => {
    if (auth.loading || sentRef.current) return;

    const poll = window.setInterval(() => {
      const payload = pendingRef.current;
      if (!payload) return;

      if (!auth.canEdit) {
        window.clearInterval(poll);
        setPhase({ kind: 'need_login' });
        return;
      }

      window.clearInterval(poll);
      sentRef.current = true;
      setPhase({ kind: 'working', payload });
      void send(payload);
    }, 150);

    return () => window.clearInterval(poll);
  }, [auth.loading, auth.canEdit]);

  const send = async (payload: CapturePayload) => {
    try {
      if (payload.text.trim().length < 200) {
        setPhase({
          kind: 'error',
          message: `อ่านเนื้อข่าวจากหน้านี้ได้แค่ ${payload.text.trim().length} ตัวอักษร — เปิดหน้าบทความให้ขึ้นครบก่อนแล้วกดใหม่`,
          payload,
        });
        return;
      }

      const result = await callApi<{
        seq?: number;
        data?: unknown;
        duplicate?: boolean;
        message?: string;
      }>('/api/ai/extract-url', {
        url: payload.url,
        newsText: payload.text,
        newsTitle: payload.title,
        // ยังไม่รู้ว่าตรงกับ lead ไหน ให้เซิร์ฟเวอร์เดาจากโดเมน+พาดหัว
        matchLead: true,
      });

      if (result.duplicate) {
        setPhase({ kind: 'done', message: result.message ?? 'ข่าวนี้มีอยู่ในระบบแล้ว' });
      } else if (!result.data) {
        setPhase({ kind: 'done', message: result.message ?? 'ข่าวนี้ไม่เข้าเกณฑ์ของระบบ' });
      } else {
        setPhase({
          kind: 'done',
          seq: result.seq,
          message: `บันทึกเป็นเคส #${result.seq} เข้าคิวรอตรวจสอบแล้ว`,
        });
      }
    } catch (err: any) {
      setPhase({ kind: 'error', message: String(err?.message ?? 'บันทึกไม่สำเร็จ'), payload });
    }
  };

  const retry = () => {
    const payload = pendingRef.current;
    if (!payload) return;
    sentRef.current = true;
    setPhase({ kind: 'working', payload });
    void send(payload);
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-800 p-5 font-sans">
      <div className="flex items-center gap-2 mb-5 pb-3 border-b border-neutral-200">
        <Wine className="w-4 h-4 text-red-700" />
        <span className="text-xs font-mono  text-neutral-600">จับข่าวเข้าระบบ</span>
      </div>

      {phase.kind === 'waiting' && (
        <Status icon={<Loader2 className="w-5 h-5 animate-spin text-red-700" />} title="กำลังอ่านหน้าข่าว...">
          ถ้าค้างอยู่นานเกินไป แปลว่าเปิดหน้านี้ตรงๆ ไม่ได้กดจากปุ่มบนหน้าข่าว
        </Status>
      )}

      {phase.kind === 'need_login' && (
        <>
          <Status icon={<AlertCircle className="w-5 h-5 text-red-700" />} title="ต้องเข้าสู่ระบบก่อน">
            {auth.isAuthenticated
              ? 'บัญชีนี้เป็นสิทธิ์ผู้อ่าน จึงบันทึกข่าวไม่ได้ — ต้องใช้บัญชีเจ้าหน้าที่บันทึกข้อมูล'
              : 'เข้าสู่ระบบในหน้าต่างนี้แล้วกดปุ่มจับข่าวใหม่อีกครั้ง'}
          </Status>
          {!auth.isAuthenticated && (
            <button
              onClick={() => setShowLogin(true)}
              className="mt-4 w-full px-4 py-2.5 bg-neutral-900 hover:bg-black text-white text-xs font-mono font-bold  rounded-sm"
            >
              เข้าสู่ระบบ
            </button>
          )}
          <LoginPanel
            open={showLogin}
            onClose={() => setShowLogin(false)}
            onSignIn={async (email, password) => {
              await auth.signIn(email, password);
              setShowLogin(false);
              sentRef.current = false;
              setPhase({ kind: 'waiting' });
            }}
          />
        </>
      )}

      {phase.kind === 'working' && (
        <Status icon={<Loader2 className="w-5 h-5 animate-spin text-red-700" />} title="กำลังให้ AI สกัดข้อมูล...">
          <span className="block truncate text-neutral-600">{phase.payload.title}</span>
          <span className="block mt-1">เนื้อข่าว {phase.payload.text.length.toLocaleString('th-TH')} ตัวอักษร · ปกติ 5-15 วินาที</span>
        </Status>
      )}

      {phase.kind === 'done' && (
        <>
          <Status icon={<CheckCircle2 className="w-5 h-5 text-neutral-900" />} title="เรียบร้อย">
            {phase.message}
          </Status>
          <button
            onClick={() => window.close()}
            className="mt-4 w-full px-4 py-2.5 bg-neutral-900 hover:bg-black text-white text-xs font-mono font-bold  rounded-sm"
          >
            ปิดหน้าต่าง
          </button>
        </>
      )}

      {phase.kind === 'error' && (
        <>
          <Status icon={<AlertCircle className="w-5 h-5 text-red-700" />} title="บันทึกไม่สำเร็จ">
            {phase.message}
          </Status>
          <button
            onClick={retry}
            className="mt-4 w-full px-4 py-2.5 border border-neutral-300 hover:border-neutral-400 text-neutral-800 text-xs font-mono  rounded-sm"
          >
            ลองใหม่
          </button>
        </>
      )}
    </div>
  );
};

const Status: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({
  icon,
  title,
  children,
}) => (
  <div className="flex items-start gap-3">
    <span className="mt-0.5 shrink-0">{icon}</span>
    <div className="min-w-0">
      <p className="text-sm text-neutral-900">{title}</p>
      <div className="mt-1 text-[13px] text-neutral-600 leading-relaxed">{children}</div>
    </div>
  </div>
);
