/**
 * ทดสอบหน้าสถิติสาธารณะในเบราว์เซอร์จริง (มุมผู้ใช้ที่ไม่ล็อกอิน)
 *
 * ครอบสามสถานะที่เดิมแยกกันไม่ออกและเคยทำให้หน้าสาธารณะพังเงียบ:
 *   กำลังโหลด / โหลดไม่สำเร็จ / ไม่มีข้อมูล
 * เดิมทั้งสามกรณีแสดงแดชบอร์ดที่ทุกช่องเป็น 0 ซึ่งอ่านได้ว่า "ไม่มีเหตุเกิดขึ้น"
 *
 * และตรวจจอมือถือ 375px ว่าไม่ต้องเลื่อนแนวนอน (เจ้าหน้าที่ภูมิภาคใช้มือถือ)
 *
 * ไม่แตะข้อมูลใดๆ — อ่านอย่างเดียว
 *
 *   npm run e2e:public
 */
import './_env';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
const APP='http://localhost:3000';
const admin=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
let pass=0,fail=0;const bad:string[]=[];
const chk=(ok:boolean,l:string,d='')=>{ok?pass++:(fail++,bad.push(l));console.log(`  ${ok?'✓':'✕'} ${l}${d?`  — ${d}`:''}`)};
async function main(){
  const { count: approvedCount } = await admin.from('incidents')
    .select('*',{count:'exact',head:true}).eq('status','approved');
  console.log(`เคสที่อนุมัติแล้วในระบบ: ${approvedCount}\n`);

  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    // --- ผู้ใช้ทั่วไป (ไม่ล็อกอิน) บนจอเดสก์ท็อป ---
    const ctx=await browser.newContext({viewport:{width:1440,height:900}});
    const page=await ctx.newPage();
    await page.goto(APP,{waitUntil:'networkidle'});
    await page.waitForTimeout(3000);
    const b=await page.locator('body').innerText();

    if((approvedCount??0)===0){
      chk(/ยังไม่มีเคสที่ผ่านการตรวจสอบ/.test(b),'ไม่มีข้อมูล → บอกตรงๆ ไม่ใช่แสดงเลข 0');
      chk(!/0 เหตุการณ์|Total Cases[\s\S]{0,40}\b0\b/.test(b),'ไม่แสดงเลข 0 เป็นผลการวิเคราะห์');
    } else {
      chk(/ข้อมูลช่วง/.test(b),'บอกช่วงวันที่ของข้อมูล');
      chk(/อัปเดตเมื่อ/.test(b),'บอกเวลาที่อัปเดตล่าสุด');
    }
    chk(!/เพิ่มรายงานข่าวเข้าสู่ระบบสถิติ/.test(b),'ไม่ล็อกอินต้องไม่เห็นปุ่มเพิ่มรายงาน');
    chk(/ตัดชื่อผู้ก่อเหตุและชื่อเหยื่อออกแล้ว/.test(b),'แจ้งว่ากำลังดูข้อมูลที่ปิดชื่อไว้');

    // --- มือถือ 375px: ตารางต้องไม่ต้องเลื่อนแนวนอน ---
    const m=await browser.newContext({viewport:{width:375,height:812}});
    const mp=await m.newPage();
    await mp.goto(APP,{waitUntil:'networkidle'});
    await mp.waitForTimeout(2500);
    await mp.getByRole('button',{name:/ฐานข้อมูลเหตุการณ์/}).first().click();
    await mp.waitForTimeout(2000);
    const overflow=await mp.evaluate(()=>({
      body: document.body.scrollWidth - document.body.clientWidth,
      cards: document.querySelectorAll('ul.lg\\:hidden > li').length,
      tableVisible: !!document.querySelector('table')?.checkVisibility?.(),
    }));
    chk(overflow.body<=2,'จอ 375px ไม่ต้องเลื่อนแนวนอน',`เกิน ${overflow.body}px`);
    chk(!overflow.tableVisible,'ตารางกว้างถูกซ่อนบนจอแคบ');
    console.log(`     (การ์ดบนจอแคบ ${overflow.cards} ใบ)`);

    // --- โหลดไม่สำเร็จ: ต้องขึ้นการ์ดผิดพลาด + ปุ่มลองใหม่ ---
    const e=await browser.newContext({viewport:{width:1440,height:900}});
    const ep=await e.newPage();
    await ep.route('**/rest/v1/**', r=>r.abort('failed'));
    await ep.goto(APP,{waitUntil:'domcontentloaded'});
    await ep.waitForTimeout(24000);
    const eb=await ep.locator('body').innerText();
    chk(/โหลดข้อมูลไม่สำเร็จ/.test(eb),'ต่อฐานข้อมูลไม่ได้ → ขึ้นการ์ดผิดพลาด');
    chk(/โหลดใหม่/.test(eb),'มีปุ่มลองใหม่');
    chk(!/ข้อค้นพบเชิงสถิติ/.test(eb),'ไม่เรนเดอร์แดชบอร์ดทับตอนโหลดไม่สำเร็จ');
  } finally {
    await browser.close();
    console.log(`\nสรุป: ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
    if(bad.length) console.log(bad.map(x=>'  ✕ '+x).join('\n'));
  }
}
void main();
