/**
 * ทำให้ `npm run dev` เสิร์ฟ /api/* ได้เอง โดยไม่ต้องใช้ Vercel CLI
 *
 * ตอนพัฒนา Vite เสิร์ฟเฉพาะไฟล์หน้าเว็บ ส่วน /api/* จะได้ 404
 * ทางแก้มาตรฐานคือ `vercel dev` แต่ต้องติดตั้ง CLI + login + link project ก่อน
 * ปลั๊กอินนี้ตัดขั้นตอนนั้นออก โดยโหลดไฟล์ใน api/ ผ่าน pipeline ของ Vite เอง
 * แล้วแปลง req/res ของ Node ให้เข้ากับรูปแบบที่ Vercel Functions คาดหวัง
 *
 * ตอน deploy จริง Vercel จะเสิร์ฟ api/ ให้เองตามปกติ ปลั๊กอินนี้ไม่ถูกใช้
 * (ทำงานเฉพาะใน configureServer ซึ่งมีแค่ตอน dev)
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, ViteDevServer } from 'vite';

/** เติมเมธอดที่ Vercel Functions ใช้ (res.status().json()) ให้ ServerResponse ของ Node */
function decorateResponse(res: ServerResponse) {
  const target = res as ServerResponse & {
    status: (code: number) => typeof target;
    json: (body: unknown) => void;
    send: (body: unknown) => void;
  };

  target.status = (code: number) => {
    target.statusCode = code;
    return target;
  };
  target.json = (body: unknown) => {
    if (!target.headersSent) target.setHeader('Content-Type', 'application/json; charset=utf-8');
    target.end(JSON.stringify(body));
  };
  target.send = (body: unknown) => {
    if (typeof body === 'object' && body !== null) return target.json(body);
    target.end(String(body ?? ''));
  };

  return target;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    return raw; // ปล่อยเป็นข้อความดิบ ให้ handler ตัดสินใจเอง
  }
}

/** /api/ai/extract-news → <root>/api/ai/extract-news.ts */
function resolveHandlerFile(root: string, pathname: string): string | null {
  const relative = pathname.replace(/^\/+/, '').split('?')[0];
  if (!relative.startsWith('api/')) return null;
  // กัน path traversal (../) ไม่ให้หลุดออกนอกโฟลเดอร์ api
  const apiRoot = path.join(root, 'api');
  for (const candidate of [`${relative}.ts`, path.join(relative, 'index.ts')]) {
    const full = path.join(root, candidate);
    if (full.startsWith(apiRoot) && existsSync(full)) return full;
  }
  return null;
}

export function apiDevServer(): Plugin {
  return {
    name: 'local-api-dev-server',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith('/api/')) return next();

        const root = server.config.root;
        const [pathname, search = ''] = url.split('?');
        const file = resolveHandlerFile(root, pathname);

        if (!file) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(
            JSON.stringify({
              error: `ไม่พบไฟล์สำหรับ ${pathname} — คาดว่าจะอยู่ที่ api${pathname.replace('/api', '')}.ts`,
            })
          );
          return;
        }

        try {
          const mod = await server.ssrLoadModule(file);
          const handler = mod.default;
          if (typeof handler !== 'function') {
            throw new Error(`${path.relative(root, file)} ไม่ได้ export default เป็นฟังก์ชัน`);
          }

          const decorated = decorateResponse(res);
          (req as any).body = await readJsonBody(req);
          (req as any).query = Object.fromEntries(new URLSearchParams(search));
          (req as any).cookies = {};

          await handler(req, decorated);
        } catch (err: any) {
          // แสดง stack ที่ map กลับไปหา source จริง ช่วยดีบักได้ตรงจุด
          server.ssrFixStacktrace?.(err);
          console.error(`[api] ${pathname} ล้มเหลว:`, err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: String(err?.message ?? err) }));
          }
        }
      });
    },
  };
}
