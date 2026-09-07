import React from 'react';
import {
  ArrowDownUp,
  BarChart3,
  BookOpen,
  ClipboardCheck,
  LogIn,
  LogOut,
  Plus,
  PlusCircle,
  Rss,
  ShieldCheck,
  Sparkles,
  Table,
  Wine,
} from 'lucide-react';

export type ActiveTab =
  | 'analytics'
  | 'records'
  | 'review_queue'
  | 'form'
  | 'ai_parser'
  | 'sources'
  | 'dictionary'
  | 'import_export';

interface NavbarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  totalRecords: number;
  pendingCount: number;
  onNewIncident: () => void;
  isAuthenticated: boolean;
  canEdit: boolean;
  isAdmin: boolean;
  userLabel: string | null;
  roleLabel: string;
  onSignIn: () => void;
  onSignOut: () => void;
}

interface TabDef {
  id: ActiveTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  iconClass?: string;
  /** ต้องล็อกอินและมีสิทธิ์ระดับใดจึงจะเห็น */
  requires?: 'auth' | 'editor' | 'admin';
  badge?: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  totalRecords,
  pendingCount,
  onNewIncident,
  isAuthenticated,
  canEdit,
  isAdmin,
  userLabel,
  roleLabel,
  onSignIn,
  onSignOut,
}) => {
  const tabs: TabDef[] = [
    { id: 'analytics', label: 'ภาพรวมสถิติ', icon: BarChart3 },
    { id: 'records', label: `ฐานข้อมูลเหตุการณ์ (${totalRecords})`, icon: Table },
    {
      id: 'review_queue',
      label: 'คิวตรวจสอบข่าว',
      icon: ClipboardCheck,
      iconClass: 'text-red-700',
      requires: 'auth',
      badge: pendingCount,
    },
    { id: 'form', label: 'ฟอร์มบันทึก 49 ฟิลด์', icon: PlusCircle, requires: 'editor' },
    {
      id: 'ai_parser',
      label: 'AI สกัดข่าว',
      icon: Sparkles,
      iconClass: 'text-red-700',
      requires: 'editor',
    },
    { id: 'sources', label: 'แหล่งข่าว & การดึงข้อมูล', icon: Rss, requires: 'auth' },
    { id: 'dictionary', label: 'พจนานุกรมข้อมูล', icon: BookOpen },
    { id: 'import_export', label: 'นำเข้า / ส่งออก', icon: ArrowDownUp },
  ];

  const visibleTabs = tabs.filter((tab) => {
    if (!tab.requires) return true;
    if (tab.requires === 'auth') return isAuthenticated;
    if (tab.requires === 'editor') return canEdit;
    return isAdmin;
  });

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-neutral-200 text-neutral-700 shadow-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20 gap-4">
          {/*
            ชื่อระบบเป็นภาษาไทยและอ่านได้ทันที
            เดิมเป็น "ALCOHOL_INCIDENT_WATCH" กับคำบรรยายไทยที่ถูกยืดระยะตัวอักษร (tracking .15em)
            และบังคับ uppercase — ภาษาไทยไม่มีตัวพิมพ์ใหญ่ ผลคือได้แต่ความอ่านยาก
          */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 bg-neutral-900 rounded-sm flex items-center justify-center shrink-0">
              <Wine className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg text-neutral-900 font-semibold truncate leading-tight">
                ระบบเฝ้าระวังข่าวแอลกอฮอล์
              </h1>
              <p className="text-xs text-neutral-600 mt-0.5 truncate">
                ความรุนแรงและอุบัติเหตุที่เกี่ยวข้องกับเครื่องดื่มแอลกอฮอล์
              </p>
            </div>
          </div>

          {/* สถานะและปุ่มหลัก */}
          <div className="flex items-center gap-3 sm:gap-4 shrink-0">
            <div className="text-right hidden lg:block">
              <span className="block text-xs tracking-wider text-neutral-600 uppercase font-mono">
                เหตุการณ์ที่อนุมัติแล้ว
              </span>
              <span className="text-sm font-serif text-neutral-800 font-medium">{totalRecords} เคส</span>
            </div>

            {isAuthenticated && pendingCount > 0 && (
              <>
                <div className="h-8 w-px bg-neutral-200 hidden lg:block" />
                <button
                  onClick={() => setActiveTab('review_queue')}
                  className="text-right hidden sm:block group"
                >
                  <span className="block text-xs tracking-wider text-neutral-600 uppercase font-mono">
                    รอตรวจสอบ
                  </span>
                  <span className="text-sm font-serif text-red-700 font-medium group-hover:text-red-700">
                    {pendingCount} รายการ
                  </span>
                </button>
              </>
            )}

            {isAuthenticated ? (
              <div className="flex items-center gap-2">
                <div className="text-right hidden md:block">
                  <span className="block text-xs font-mono text-neutral-600 truncate max-w-[160px]">
                    {userLabel}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs font-mono text-neutral-900">
                    <ShieldCheck className="w-3 h-3" />
                    {roleLabel}
                  </span>
                </div>
                {canEdit && (
                  <button
                    onClick={onNewIncident}
                    className="inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 bg-neutral-900 hover:bg-black text-white text-xs font-bold  rounded-sm transition-all"
                  >
                    <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                    <span className="hidden sm:inline">บันทึกเหตุการณ์</span>
                  </button>
                )}
                <button
                  onClick={onSignOut}
                  title="ออกจากระบบ"
                  className="p-2 text-neutral-600 hover:text-neutral-800 border border-neutral-200 rounded-sm"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={onSignIn}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-neutral-900 hover:bg-black text-white text-xs font-bold  rounded-sm transition-all"
              >
                <LogIn className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>เข้าสู่ระบบเจ้าหน้าที่</span>
              </button>
            )}
          </div>
        </div>

        {/* แท็บ */}
        <nav className="flex space-x-1 overflow-x-auto py-1.5 scrollbar-none text-xs border-t border-neutral-200/80">
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center space-x-2 px-3.5 py-2 rounded-sm font-medium whitespace-nowrap transition-all ${
                  isActive
                    ? 'bg-neutral-900 text-white border-b-2 border-neutral-900 shadow-sm'
                    : 'text-neutral-600 hover:text-neutral-800 hover:bg-neutral-50'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${tab.iconClass ?? 'text-neutral-600'}`} />
                <span>{tab.label}</span>
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className="ml-0.5 text-xs font-mono bg-red-600 text-white px-1.5 py-0.5 rounded-sm font-bold">
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
};
