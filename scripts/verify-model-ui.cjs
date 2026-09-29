const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const {createServer}=await import('../server.mjs');
 const server=createServer({env:{}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const calls=[];let fail=false,empty=false,delay=false,release;
  await page.route('**/api/status',r=>r.fulfill({json:{model:{configured:true,model:'mock-qwen'},asr:{configured:false}}}));
  await page.route('**/api/analyze',async r=>{
   const data=r.request().postDataJSON();calls.push(data);
   if(delay)await new Promise(resolve=>{release=resolve;});
   if(fail)return r.fulfill({status:502,json:{error:'模型密钥无效，请检查配置'}});
   const correction=data.text.includes('改');
   try{await r.fulfill({json:{mode:'model',replies:['请确认最新截止时间。','请问还需要其他材料吗？'],draft:empty?null:{title:correction?null:'实习申请',action:correction?null:'补交实习证明',deadline:correction?'周五':'周三',source:data.text,correction},suggestedTaskId:correction?(data.memories[0]?.id||null):null,memoryNote:'请核对从原话提取的候选事项。',evidence:''}});}catch{}
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('.bottom-nav [data-view="knowledge"]').click();
  await page.locator('#model-enabled').check();await page.locator('#memory-enabled').check();
  await page.locator('.bottom-nav [data-view="talk"]').click();
  async function utter(text){await page.locator('[data-action="input"]').click();await page.locator('#utterance').fill(text);await page.locator('#utterance-form button').click();}
  await utter('请在周三前补交实习证明。');
  await page.getByText('模型回复与事项提取',{exact:true}).waitFor();
  await page.locator('[data-action="save"]').click();assert.equal(await page.locator('#memory-action').inputValue(),'补交实习证明');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('signova-demo-v1')||'{}').tasks?.length||0),0);
  await page.locator('#memory-form button[type=submit]').click();
  await page.locator('.bottom-nav [data-view="talk"]').click();
  await utter('改成周五，其他要求不变。');await page.getByText('模型回复与事项提取',{exact:true}).waitFor();
  assert.equal(calls[1].memories.length,1);assert.equal(calls[1].memories[0].deadline,'周三');assert.ok(!('history' in calls[1].memories[0]));
  await page.locator('[data-action="save"]').click();assert.ok(await page.locator('#memory-target').inputValue());assert.equal(await page.locator('#memory-action').inputValue(),'补交实习证明');assert.equal(await page.locator('#memory-deadline').inputValue(),'周五');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('signova-demo-v1')).tasks[0].deadline),'周三');
  await page.locator('#memory-form button[type=submit]').click();
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('signova-demo-v1')).tasks);assert.equal(saved.length,1);assert.equal(saved[0].deadline,'周五');assert.equal(saved[0].history[0].deadline,'周三');
  await page.locator('.bottom-nav [data-view="knowledge"]').click();await page.locator('#memory-enabled').uncheck();await page.locator('.bottom-nav [data-view="talk"]').click();
  fail=true;await utter('测试服务故障');await page.getByText(/当前为规则示例，可修改文字后重试/).waitFor();assert.deepEqual(calls.at(-1).memories,[]);
  fail=false;empty=true;await utter('谢谢你');await page.getByText('模型回复与事项提取',{exact:true}).waitFor();await page.locator('[data-action="save"]').click();assert.equal(await page.locator('#memory-action').inputValue(),'');await page.locator('dialog [data-action="close"]').first().click();
  empty=false;delay=true;await utter('正在处理的旧档案内容');await page.waitForFunction(()=>document.body.innerText.includes('正在调用模型'));
  await page.locator('[data-action="profile"]').click();await page.locator('[data-profile="visitor"]').click();release();
  await page.getByText('校园演示',{exact:true}).waitFor();await page.locator('.bottom-nav [data-view="tasks"]').click();assert.equal(await page.locator('.task-card').count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
  console.log('MODEL UI PASS: consent, mock model requests, explicit save, correction merge, history, safe fallback, empty extraction, profile-switch cancellation.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
