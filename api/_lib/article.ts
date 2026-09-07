/**
 * ดึงเนื้อข่าวเต็มจากหน้าเว็บ เมื่อฟีดไม่ได้ส่ง content:encoded มา
 * (ไทยรัฐและเดลินิวส์เป็นสองเจ้าที่ต้องใช้เส้นทางนี้)
 *
 * ใช้ Readability + linkedom เพื่อไม่ต้องดูแล selector รายเว็บ
 */
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { fetchText } from './http';
import { stripHtml } from './rss';

export interface ArticleText {
  ok: boolean;
  text: string;
  title: string | null;
  error?: string;
}

const MIN_USABLE_CHARS = 200;

export async function fetchArticleText(url: string, timeoutMs = 20000): Promise<ArticleText> {
  const res = await fetchText(url, { timeoutMs });
  if (!res.ok) {
    return { ok: false, text: '', title: null, error: res.error ?? `HTTP ${res.status}` };
  }

  try {
    const { document } = parseHTML(res.body);
    const article = new Readability(document as any, { charThreshold: 100 }).parse();
    const text = article?.textContent ? stripHtml(article.textContent) : '';

    if (text.length >= MIN_USABLE_CHARS) {
      return { ok: true, text, title: article?.title ?? null };
    }

    // Readability ไม่ผ่าน → ถอย HTML ทั้งหน้ามาเป็นข้อความล้วน
    const fallback = stripHtml(res.body);
    if (fallback.length >= MIN_USABLE_CHARS) {
      return { ok: true, text: fallback.slice(0, 20000), title: article?.title ?? null };
    }

    return {
      ok: false,
      text: '',
      title: null,
      error: `สกัดเนื้อข่าวได้เพียง ${Math.max(text.length, fallback.length)} ตัวอักษร (ต่ำกว่าเกณฑ์ ${MIN_USABLE_CHARS})`,
    };
  } catch (err: any) {
    return { ok: false, text: '', title: null, error: `อ่านหน้าเว็บล้มเหลว: ${err?.message ?? err}` };
  }
}
