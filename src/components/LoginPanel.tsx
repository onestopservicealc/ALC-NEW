import React, { useState } from 'react';
import { AlertCircle, KeyRound, LogIn, ShieldCheck, X } from 'lucide-react';

interface LoginPanelProps {
  open: boolean;
  onClose: () => void;
  onSignIn: (email: string, password: string) => Promise<void>;
}

export const LoginPanel: React.FC<LoginPanelProps> = ({ open, onClose, onSignIn }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await onSignIn(email.trim(), password);
      setEmail('');
      setPassword('');
      onClose();
    } catch (err: any) {
      setError(err?.message ?? 'เข้าสู่ระบบไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm bg-white border border-neutral-200 rounded-sm shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-neutral-900" />
            <h2 className="font-serif text-base text-neutral-900">เข้าสู่ระบบเจ้าหน้าที่</h2>
          </div>
          <button onClick={onClose} className="text-neutral-600 hover:text-neutral-800" aria-label="ปิด">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <p className="text-[13px] text-neutral-600 leading-relaxed font-sans">
            หน้าสถิติสาธารณะดูได้โดยไม่ต้องเข้าสู่ระบบ — การเข้าสู่ระบบใช้สำหรับบันทึก
            ตรวจสอบ และอนุมัติข้อมูล บัญชีผู้ใช้ออกให้โดยผู้ดูแลระบบเท่านั้น
          </p>

          <div>
            <label className="block text-xs uppercase font-mono tracking-wider text-neutral-600 mb-1">
              อีเมล
            </label>
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-2 text-xs text-neutral-900 focus:outline-none focus:border-neutral-400 font-mono"
              placeholder="name@ddc.mail.go.th"
            />
          </div>

          <div>
            <label className="block text-xs uppercase font-mono tracking-wider text-neutral-600 mb-1">
              รหัสผ่าน
            </label>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-2 text-xs text-neutral-900 focus:outline-none focus:border-neutral-400 font-mono"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="p-2.5 bg-neutral-100 border border-red-200 rounded-sm text-[13px] text-red-700 flex items-start gap-2">
              <AlertCircle className="w-3.5 h-3.5 text-red-700 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !email || !password}
            className="w-full px-4 py-2.5 rounded-sm bg-neutral-900 hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-mono font-bold  transition-all flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <KeyRound className="w-3.5 h-3.5 animate-pulse" />
                <span>กำลังตรวจสอบ...</span>
              </>
            ) : (
              <>
                <LogIn className="w-3.5 h-3.5" />
                <span>เข้าสู่ระบบ</span>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
