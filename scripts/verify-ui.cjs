const assert=require('node:assert/strict');
const fs=require('node:fs');
const accessKey=(process.env.SIGNOVA_ACCESS_KEY||'').trim();
(async()=>{
 if(!accessKey)throw new Error('缺少 SIGNOVA_ACCESS_KEY。请设置环境变量，或在项目目录运行 node --env-file-if-exists=.env scripts/verify-ui.cjs；Key 必须与运行中的服务一致。');
 const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
 const baseUrl=new URL(process.env.BASE_URL||'http://127.0.0.1:5178').origin;
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 fs.mkdirSync('test-results',{recursive:true});
 try{
  await page.goto(baseUrl);
  await page.locator('#experience-key').fill(accessKey);
  const [unlockResponse]=await Promise.all([
   page.waitForResponse(response=>new URL(response.url()).pathname==='/api/access/unlock'&&response.request().method()==='POST'),
   page.locator('#unlock-form button[type="submit"]').click()
  ]);
  assert.equal(unlockResponse.status(),200,'体验 Key 解锁失败，请检查 SIGNOVA_ACCESS_KEY 是否与运行中的服务一致。');
  await page.waitForURL(url=>url.pathname==='/app');
  await page.locator('.avatar img').waitFor();
  await page.screenshot({path:'test-results/01-mobile-live.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('[data-action="save"]').click();
  await page.locator('#memory-form button[type=submit]').click();
  assert.match(await page.locator('#detail-reply').inputValue(),/周三/);
  await page.locator('.bottom-nav [data-view="talk"]').click();
  await page.locator('[data-action="scene"]').click();
  await page.locator('[data-action="run-scene"][data-index="2"]').click();
  await page.locator('[data-action="save"]').click();
  const id=await page.locator('#memory-target option').nth(1).getAttribute('value');
  await page.locator('#memory-target').selectOption(id);
  assert.equal(await page.locator('#memory-action').inputValue(),'补交实习证明');
  await page.locator('#memory-form button[type=submit]').click();
  assert.match(await page.locator('#detail-reply').inputValue(),/周五/);
  assert.doesNotMatch(await page.locator('#detail-reply').inputValue(),/周三/);
  await page.locator('summary').click();
  assert.match(await page.locator('.history-item').innerText(),/周三/);
  await page.screenshot({path:'test-results/02-memory-correction.png',fullPage:true});
  await page.reload();
  await page.locator('.bottom-nav [data-view="tasks"]').click();
  assert.equal(await page.locator('.task-card').count(),1);
  await page.locator('.task-card').click();
  await page.locator('#detail-reply').fill('请问材料交到哪里？');
  await page.locator('[data-action="confirm-detail"]').click();
  await page.locator('[data-action="show-reply"]').click();
  assert.equal(await page.locator('.jumbo').innerText(),'请问材料交到哪里？');
  await page.locator('dialog [data-action="close"]').last().click();
  await page.locator('[data-action="toggle-done"]').click();
  assert.match(await page.locator('#detail-reply').inputValue(),/后续安排/);
  await page.locator('[data-action="profile"]').click();
  await page.locator('[data-action="set-profile"][data-profile="visitor"]').click();
  await page.locator('.bottom-nav [data-view="tasks"]').click();
  assert.equal(await page.locator('.task-card').count(),0);
  await page.locator('.bottom-nav [data-view="knowledge"]').click();
  await page.locator('#knowledge-text').fill('实习证明：测试资料 <img src=x onerror=alert(1)>');
  await page.locator('[data-action="save-knowledge"]').click();
  await page.locator('.bottom-nav [data-view="live"]').click();
  assert.equal(await page.locator('img[src="x"]').count(),0);
  await page.evaluate(()=>localStorage.clear());
  await page.reload();
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:'test-results/03-desktop-preview.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('UI PASS: mobile layout, save/correct memory, history, persistence, reply confirmation, done status, visitor isolation, escaped content; no browser errors.');
 }finally{await browser.close();}
})().catch(e=>{const message=e instanceof Error?(e.stack||e.message):String(e);console.error(accessKey?message.split(accessKey).join('[REDACTED]'):message);process.exitCode=1;});
