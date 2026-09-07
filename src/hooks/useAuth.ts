import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export type UserRole = 'anon' | 'viewer' | 'editor' | 'admin';

export interface AuthState {
  session: Session | null;
  role: UserRole;
  email: string | null;
  fullName: string | null;
  loading: boolean;
  isAuthenticated: boolean;
  canEdit: boolean;
  isAdmin: boolean;
}

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<UserRole>('anon');
  const [fullName, setFullName] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const loadProfile = useCallback(async (userId: string | undefined) => {
    if (!supabase || !userId) {
      setRole('anon');
      setFullName(null);
      return;
    }
    const { data } = await supabase
      .from('profiles')
      .select('role, full_name')
      .eq('id', userId)
      .maybeSingle();
    setRole(((data?.role as UserRole) ?? 'viewer') as UserRole);
    setFullName(data?.full_name ?? null);
  }, []);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let active = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      await loadProfile(data.session?.user.id);
      if (active) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, next) => {
      if (!active) return;
      setSession(next);
      await loadProfile(next?.user.id);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) throw new Error('ยังไม่ได้ตั้งค่า Supabase');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(translateAuthError(error.message));
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setRole('anon');
    setFullName(null);
  }, []);

  const state: AuthState = {
    session,
    role,
    email: session?.user.email ?? null,
    fullName,
    loading,
    isAuthenticated: Boolean(session),
    canEdit: role === 'editor' || role === 'admin',
    isAdmin: role === 'admin',
  };

  return { ...state, signIn, signOut };
}

function translateAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
  if (/email not confirmed/i.test(message)) return 'อีเมลนี้ยังไม่ได้ยืนยัน';
  if (/rate limit/i.test(message)) return 'พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่';
  return message;
}
