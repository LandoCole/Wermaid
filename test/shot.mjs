import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: +process.env.W||1400, height: +process.env.H||900 }, colorScheme: process.env.DARK ? 'dark':'light' });
p.on('pageerror', e=>console.log('PAGEERR', e.message));
p.on('console', m=>{ if(m.type()==='error') console.log('CONSOLE', m.text().slice(0,300)); });
await p.goto('http://127.0.0.1:8765/'+process.argv[2]);
await p.waitForFunction(()=>window.RESULTS || window.READY, null, {timeout:30000});
await p.waitForTimeout(500);
await p.screenshot({ path: process.argv[3], fullPage: !!process.env.FULL });
await b.close();
