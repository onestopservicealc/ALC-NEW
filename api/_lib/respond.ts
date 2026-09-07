import type { VercelResponse } from '@vercel/node';

export function fail(res: VercelResponse, err: unknown): void {
  const status = (err as any)?.statusCode ?? 500;
  const message = (err as any)?.message ?? 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
  if (status >= 500) console.error('[api]', err);
  res.status(status).json({ error: String(message) });
}

export function methodNotAllowed(res: VercelResponse, allowed: string[]): void {
  res.setHeader('Allow', allowed.join(', '));
  res.status(405).json({ error: `รองรับเฉพาะเมธอด ${allowed.join(', ')}` });
}
