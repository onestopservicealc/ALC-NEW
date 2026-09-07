/**
 * ทดสอบงานตรวจเคสรายวันในเบราว์เซอร์จริง
 *
 * ครอบสิ่งที่อ่านโค้ดแล้วพิสูจน์ไม่ได้ และเป็นจุดที่เคยเสียข้อมูลจริง:
 *  - แก้ค่าในฟอร์มแล้วกดอนุมัติ → ค่าที่แก้ต้องถูกบันทึก (เดิมหายเงียบ)
 *  - อนุมัติ/ปฏิเสธแล้วต้องเด้งไปเคสถัดไป ไม่ใช่ขึ้นหน้าว่าง
 *  - ปฏิเสธแล้วต้องหาเจอและกู้คืนได้ (เดิมหายจากทุกหน้าจอถาวร)
 *  - แท็บหมวดต้องมีจุดเตือนตรงหมวดที่ AI ดัดค่า
 *
 * ใช้เคสที่มีคำนำหน้า [UXTEST] เท่านั้น และลบทิ้งทุกครั้ง — ไม่แตะข้อมูลจริง
 *
 *   npm run e2e:review
 */
import './_env';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
const APP='http://localhost:3000';
const admin=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
const PW='Ux!'+Date.now(), EMAIL=`ux-${Date.now()}@example.com`;
let pass=0,fail=0; const bad:string[]=[];
const chk=(ok:boolean,l:string,d='')=>{ok?pass++:(fail++,bad.push(l));console.log(`  ${ok?'✓':'✕'} ${l}${d?`  — ${d}`:''}`)};

async function main(){
  const { data:u } = await admin.auth.admin.createUser({email:EMAIL,password:PW,email_confirm:true});
  await admin.from('profiles').upsert({id:u.user!.id,role:'admin'},{onConflict:'id'});
  const stamp=Date.now();
  // เคสทดสอบ 2 ใบ: ใบแรกใช้ทดสอบแก้ค่าแล้วอนุมัติ ใบที่สองใช้ทดสอบปฏิเสธ+กู้คืน
  const mk=(n:number)=>({
    news_type:'อุบัติเหตุเมาขับ', url:`https://example.test/ux/${stamp}/${n}`,
    news_agency:'สำนักข่าวทดสอบ', news_title:`[UXTEST] เคสทดสอบที่ ${n} เมาแล้วขับชนเสาไฟ`,
    news_summary:`[UXTEST] รายการทดสอบ ไม่ใช่ข่าวจริง หมายเลข ${n}`,
    incident_date:'2026-09-01', province:'ขอนแก่น', status:'pending',
    total_affected:1,total_death:0,total_injury:1,
    ai_model:'ux-fixture', ai_confidence:0.9, ai_adjusted_fields:['alcohol_test_method'],
  });
  const { data:incs } = await admin.from('incidents').insert([mk(1),mk(2)]).select('id,seq,uuid:id');
  console.log(`สร้างเคสทดสอบ: ${(incs??[]).map(i=>'#'+i.seq).join(', ')}`);

  const browser=await chromium.launch({channel:'chrome',headless:true});
  const ctx=await browser.newContext();
  try{
    const page=await ctx.newPage();
    await page.goto(APP,{waitUntil:'networkidle'});
    await page.getByRole('button',{name:/เข้าสู่ระบบ/}).first().click();
    await page.locator('input[type="email"]').fill(EMAIL);
    await page.locator('input[type="password"]').fill(PW);
    await page.getByRole('button',{name:/^เข้าสู่ระบบ$/}).last().click();
    await page.waitForTimeout(3500);

    await page.getByRole('button',{name:/คิวตรวจสอบข่าว/}).first().click();
    await page.waitForTimeout(2000);

    // เลือกเคสทดสอบใบแรก
    await page.getByText(/\[UXTEST\] เคสทดสอบที่ 1/).first().click();
    await page.waitForTimeout(1200);
    const body1=await page.locator('body').innerText();
    chk(/อนุมัติเข้าสถิติ/.test(body1),'ปุ่มอนุมัติขึ้นตามปกติ');

    // จุดเตือนบนแท็บหมวด 4 (ai_adjusted_fields = alcohol_test_method)
    // ใช้ data-flag ไม่ใช่คลาสสี เพื่อให้เทสต์ไม่พังเมื่อเปลี่ยนธีม
    const dots=await page.locator('button:has-text("แอลกอฮอล์") span[data-flag="adjusted"]').count();
    chk(dots>0,'แท็บหมวดที่ AI ดัดค่ามีจุดเตือน',`พบ ${dots} จุด`);

    // แก้ค่าในฟอร์มแล้วดูว่าปุ่มเปลี่ยนข้อความ
    await page.getByRole('button',{name:/3\. ผู้ก่อเหตุ/}).click();
    await page.waitForTimeout(400);
    const ageBox=page.locator('input[type="number"]').first();
    await ageBox.fill('47');
    await page.waitForTimeout(600);
    const body2=await page.locator('body').innerText();
    chk(/บันทึกแล้วอนุมัติ/.test(body2),'แก้ค่าแล้วปุ่มเปลี่ยนเป็น "บันทึกแล้วอนุมัติ"');
    chk(/ยังไม่บันทึก/.test(body2),'มีคำเตือนว่ามีการแก้ที่ยังไม่บันทึก');

    // กดอนุมัติ → ต้องบันทึกค่าที่แก้ไปด้วย และเด้งไปเคสถัดไป
    await page.getByRole('button',{name:/บันทึกแล้วอนุมัติ/}).click();
    await page.waitForTimeout(4000);
    const body3=await page.locator('body').innerText();
    chk(/ตรวจแล้ว 1/.test(body3),'แถบความคืบหน้าขึ้น "ตรวจแล้ว 1"');
    chk(/\[UXTEST\] เคสทดสอบที่ 2/.test(body3),'เด้งไปเคสถัดไปเอง ไม่ขึ้นหน้าว่าง');

    const { data:after } = await admin.from('incidents')
      .select('seq,status,perpetrator_age').eq('url',`https://example.test/ux/${stamp}/1`).single();
    chk(after!.status==='approved','เคสถูกอนุมัติ');
    chk(after!.perpetrator_age===47,'**ค่าที่แก้ในฟอร์มถูกบันทึกไปด้วย**',`perpetrator_age = ${after!.perpetrator_age}`);

    // ปฏิเสธเคสที่ 2 แล้วกู้คืน
    await page.getByRole('button',{name:/^ปฏิเสธ$/}).click();
    await page.waitForTimeout(500);
    await page.getByPlaceholder(/ไม่เกี่ยวกับแอลกอฮอล์/).fill('[UXTEST] ทดสอบการปฏิเสธ');
    await page.getByRole('button',{name:/ยืนยันการปฏิเสธ/}).click();
    await page.waitForTimeout(3000);

    await page.getByRole('button',{name:/ปฏิเสธแล้ว \(/}).click();
    await page.waitForTimeout(1500);
    // ใช้ locator ไม่ใช่ body.innerText() เพราะรายการอยู่ในกล่องที่เลื่อนได้
    // innerText จะไม่คืนข้อความที่เลื่อนพ้นพื้นที่มองเห็นออกไป
    const row=page.locator('li').filter({hasText:'[UXTEST] เคสทดสอบที่ 2'});
    chk(await row.count()>0,'เคสที่ปฏิเสธปรากฏในแท็บ "ปฏิเสธแล้ว"',`พบ ${await row.count()} แถว`);
    chk(/ทดสอบการปฏิเสธ/.test(await row.first().textContent()??''),'แสดงเหตุผลที่ปฏิเสธ');

    await row.first().getByRole('button',{name:/ส่งกลับเข้าคิว/}).click();
    await page.waitForTimeout(3000);
    const { data:restored } = await admin.from('incidents')
      .select('status').eq('url',`https://example.test/ux/${stamp}/2`).single();
    chk(restored!.status==='pending','**กู้คืนกลับเข้าคิวได้**',`status = ${restored!.status}`);

    // แท็บฐานข้อมูล: เจ้าหน้าที่ต้องเห็นทุกสถานะ + ตัวกรอง
    await page.getByRole('button',{name:/ฐานข้อมูลเหตุการณ์/}).first().click();
    await page.waitForTimeout(2000);
    const body5=await page.locator('body').innerText();
    chk(/ทุกสถานะ \(/.test(body5),'มีตัวกรองสถานะในแท็บฐานข้อมูล');
    chk(/รอตรวจสอบ \(|อนุมัติแล้ว \(/.test(body5),'ตัวกรองแสดงจำนวนแยกตามสถานะ');
  } finally {
    await browser.close();
    await admin.from('incidents').delete().like('news_title','[UXTEST]%');
    const { data:left } = await admin.from('incidents').select('id').like('news_title','[UXTEST]%');
    if(left?.length){
      const anon=createClient(process.env.SUPABASE_URL!,process.env.VITE_SUPABASE_ANON_KEY!,{auth:{persistSession:false}});
      const { data:s2 } = await anon.auth.signInWithPassword({email:EMAIL,password:PW});
      const ud=createClient(process.env.SUPABASE_URL!,process.env.VITE_SUPABASE_ANON_KEY!,
        {auth:{persistSession:false},global:{headers:{Authorization:`Bearer ${s2!.session!.access_token}`}}});
      for(const r of left){ await admin.from('incident_revisions').delete().eq('incident_id',r.id); await ud.from('incidents').delete().eq('id',r.id); }
    }
    await admin.auth.admin.deleteUser(u.user!.id);
    const { data:final } = await admin.from('incidents').select('seq').like('news_title','[UXTEST]%');
    console.log(`\nเก็บกวาด: เคสทดสอบที่ยังค้าง ${final?.length ?? 0}`);
    console.log(`สรุป: ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
    if(bad.length) console.log('ไม่ผ่าน:\n'+bad.map(b=>'  ✕ '+b).join('\n'));
  }
}
void main();
