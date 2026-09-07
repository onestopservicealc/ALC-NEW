/**
 * หน้าติดตั้ง "ปุ่มจับข่าว"
 *
 * โค้ดของปุ่มสร้างจาก window.location.origin ตอนแสดงผล ปุ่มที่ลากไปจึงชี้กลับมาที่
 * เซิร์ฟเวอร์ตัวเดียวกับที่เปิดหน้านี้เสมอ (ใช้ได้ทั้ง localhost และของจริงบน Vercel)
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, MousePointerClick, Wine } from 'lucide-react';

/**
 * โค้ดของ bookmarklet
 *
 * ทำงานบนหน้าเว็บสำนักข่าว จึงอ่าน session ของระบบไม่ได้ (คนละ origin)
 * หน้าที่ของมันมีแค่: เปิดหน้าต่างของเรา รอสัญญาณว่าพร้อม แล้วส่ง URL + เนื้อข่าวไปให้
 * targetOrigin ระบุเป็นโดเมนของเราเสมอ เนื้อข่าวจึงไม่หลุดไปที่อื่นแม้หน้าเว็บจะแทรกแซง
 */
function buildBookmarklet(origin: string): string {
  const source = `(function(){
    var APP=${JSON.stringify(origin)};
    var w=window.open(APP+'/#/capture','capture','width=430,height=470');
    if(!w){alert('เบราว์เซอร์บล็อกป๊อปอัป — อนุญาตป๊อปอัปของเว็บนี้ก่อน แล้วกดใหม่');return;}
    var el=document.querySelector('article')||document.body;
    var payload={
      url:location.href,
      title:(document.title||'').slice(0,500),
      text:((el&&el.innerText)||'').replace(/\\n{3,}/g,'\\n\\n').slice(0,60000)
    };
    var sent=false;
    function onMsg(e){
      if(e.source!==w)return;
      if(e.data&&e.data.type==='พร้อมรับข่าว'&&!sent){sent=true;w.postMessage({type:'อ่านข่าวนี้',payload:payload},APP);}
    }
    window.addEventListener('message',onMsg);
    setTimeout(function(){window.removeEventListener('message',onMsg);},30000);
  })()`;

  // ย่อให้เหลือบรรทัดเดียว — บุ๊กมาร์กเก็บขึ้นบรรทัดใหม่ไม่ได้
  const oneLine = source.replace(/\s*\n\s*/g, '');
  return `javascript:${encodeURIComponent(oneLine)}`;
}

export const BookmarkletPage: React.FC = () => {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const href = useMemo(() => buildBookmarklet(origin), [origin]);
  const [copied, setCopied] = useState(false);
  const linkRef = useRef<HTMLAnchorElement>(null);

  /**
   * ต้องใส่ href ด้วย setAttribute ไม่ใช่ผ่าน JSX
   *
   * React 19 ปฏิเสธ URL ที่ขึ้นต้นด้วย javascript: ใน prop href เพื่อกัน XSS
   * (ขึ้น "React has blocked a javascript: URL as a security precaution")
   * ปุ่มที่ลากไปวางจึงกลายเป็นบุ๊กมาร์กเปล่าที่กดแล้วไม่เกิดอะไรขึ้น
   *
   * ที่นี่โค้ดสร้างจาก window.location.origin ของเราเอง ไม่ได้มาจากผู้ใช้ จึงไม่ใช่ช่องทาง XSS
   */
  useEffect(() => {
    linkRef.current?.setAttribute('href', href);
  }, [href]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-800 font-sans">
      <div className="max-w-2xl mx-auto px-6 py-10">
        <div className="flex items-center gap-2 mb-8 pb-4 border-b border-neutral-200">
          <Wine className="w-4 h-4 text-red-700" />
          <span className="text-xs font-mono  text-neutral-600">
            ติดตั้งปุ่มจับข่าว
          </span>
        </div>

        <h1 className="font-serif text-2xl text-neutral-900 leading-snug">
          บันทึกข่าวจากหน้าเว็บสำนักข่าวด้วยคลิกเดียว
        </h1>
        <p className="mt-3 text-sm text-neutral-600 leading-relaxed">
          แทนที่จะคัดลอก URL แล้วสลับแท็บกลับมาวาง — เปิดหน้าข่าวแล้วกดปุ่มนี้ครั้งเดียว
          ระบบจะได้ทั้งลิงก์และเนื้อข่าวไปพร้อมกัน
        </p>

        <div className="mt-6 p-4 bg-neutral-100 border border-neutral-300/40 rounded-sm">
          <p className="text-xs text-neutral-800 leading-relaxed">
            <strong className="font-bold">ข้อดีที่สำคัญ:</strong> สำนักข่าวหลายเจ้าบล็อกไม่ให้เซิร์ฟเวอร์ของเรา
            ดึงหน้าบทความ (ทดสอบแล้วพบ 4 จาก 7 เจ้า) แต่เบราว์เซอร์ของคุณเปิดหน้านั้นอยู่แล้ว
            วิธีนี้จึงใช้ได้กับทุกสำนัก ไม่ต้องมาคัดลอกเนื้อข่าวเองอีก
          </p>
        </div>

        {/* ---- ขั้นตอนติดตั้ง ---- */}
        <ol className="mt-8 space-y-6">
          <Step n={1} title="เปิดแถบบุ๊กมาร์กของเบราว์เซอร์">
            <span className="font-mono text-neutral-600">Chrome / Edge:</span> กด{' '}
            <Key>Cmd</Key>+<Key>Shift</Key>+<Key>B</Key> (Windows ใช้ <Key>Ctrl</Key>+<Key>Shift</Key>+
            <Key>B</Key>)
          </Step>

          <Step n={2} title="ลากปุ่มด้านล่างขึ้นไปวางบนแถบบุ๊กมาร์ก">
            <div className="mt-3">
              <a
                ref={linkRef}
                onClick={(e) => e.preventDefault()}
                draggable
                className="inline-flex items-center gap-2 px-5 py-3 bg-neutral-900 hover:bg-black text-white text-xs font-mono font-bold  rounded-sm cursor-grab active:cursor-grabbing select-none"
                title="ลากปุ่มนี้ขึ้นไปวางบนแถบบุ๊กมาร์ก"
              >
                <MousePointerClick className="w-3.5 h-3.5" />
                จับข่าวเข้าระบบ
              </a>
            </div>
            <p className="mt-2.5 text-[13px] text-neutral-600">
              กดปุ่มนี้ตรงๆ ไม่มีผล — ต้อง<strong className="text-neutral-700">ลาก</strong>ขึ้นไปวางบนแถบบุ๊กมาร์ก
              ถ้าลากไม่ได้ ให้{' '}
              <button onClick={() => void copy()} className="text-red-700 hover:text-red-700 underline">
                คัดลอกโค้ด
              </button>{' '}
              แล้วสร้างบุ๊กมาร์กใหม่เองโดยวางโค้ดลงในช่อง URL
              {copied && (
                <span className="ml-2 inline-flex items-center gap-1 text-neutral-900">
                  <Check className="w-3 h-3" />
                  คัดลอกแล้ว
                </span>
              )}
            </p>
          </Step>

          <Step n={3} title="เปิดหน้าข่าวที่ต้องการ แล้วกดปุ่มบนแถบบุ๊กมาร์ก">
            หน้าต่างเล็กจะเด้งขึ้นมาบอกผล — บันทึกเป็นเคสอะไร หรือไม่เข้าเกณฑ์เพราะอะไร
            จากนั้นปิดหน้าต่างแล้วไปข่าวถัดไปได้เลย
          </Step>
        </ol>

        {/* ---- ข้อควรรู้ ---- */}
        <div className="mt-10 pt-6 border-t border-neutral-200">
          <h2 className="text-xs font-mono  text-neutral-600">ข้อควรรู้</h2>
          <ul className="mt-3 space-y-2 text-[13px] text-neutral-600 leading-relaxed">
            <li>
              · ต้องเข้าสู่ระบบด้วยบัญชีเจ้าหน้าที่บันทึกข้อมูลก่อน ถ้ายังไม่ได้เข้า
              หน้าต่างที่เด้งขึ้นมาจะให้เข้าสู่ระบบตรงนั้น
            </li>
            <li>
              · ครั้งแรกเบราว์เซอร์อาจบล็อกป๊อปอัป ให้กดอนุญาตป๊อปอัปของเว็บนั้นแล้วกดปุ่มใหม่
            </li>
            <li>
              · บางเว็บตั้งค่าความปลอดภัย (CSP) ที่ทำให้ปุ่มบนแถบบุ๊กมาร์กไม่ทำงาน
              กรณีนั้นให้กลับไปใช้วิธีคัดลอก URL มาวางในคิว "ต้องยืนยันลิงก์" ตามเดิม
            </li>
            <li>
              · ข่าวที่จับเข้ามายัง<strong className="text-neutral-600">ต้องผ่านการตรวจสอบและอนุมัติ</strong>
              เหมือนทุกช่องทาง ไม่ได้ขึ้นหน้าสถิติสาธารณะทันที
            </li>
          </ul>
        </div>

        <div className="mt-8">
          <a href="/" className="text-xs font-mono text-neutral-600 hover:text-neutral-800">
            ← กลับหน้าหลัก
          </a>
        </div>
      </div>
    </div>
  );
};

const Step: React.FC<{ n: number; title: string; children: React.ReactNode }> = ({
  n,
  title,
  children,
}) => (
  <li className="flex gap-4">
    <span className="shrink-0 w-7 h-7 rounded-full border border-neutral-300 flex items-center justify-center text-xs font-mono text-neutral-600">
      {n}
    </span>
    <div className="min-w-0 flex-1">
      <p className="text-sm text-neutral-800">{title}</p>
      <div className="mt-1 text-[13px] text-neutral-600 leading-relaxed">{children}</div>
    </div>
  </li>
);

const Key: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="px-1.5 py-0.5 bg-neutral-100 border border-neutral-300 rounded text-xs font-mono text-neutral-700">
    {children}
  </kbd>
);
