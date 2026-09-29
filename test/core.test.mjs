import test from 'node:test';
import assert from 'node:assert/strict';
import {demoAnalyze,commitMemory,visibleTasks,replyForTask} from '../public/core.js';
import {createServer} from '../server.mjs';
test('更正日期排除被否定的旧日期',()=>{
  assert.equal(demoAnalyze('更正一下，截止时间改为周五，不是周三。').draft.deadline,'周五');
  assert.equal(demoAnalyze('不是周三，是周五。').draft.deadline,'周五');
});
test('访客不能写入或看到个人记忆',()=>{
  assert.throws(()=>commitMemory([],{title:'实习',action:'补交证明'},{profile:'visitor'}));
  assert.deepEqual(visibleTasks([{profile:'personal'}],'visitor'),[]);
});
test('否定和条件不能自动变成需要补交的任务',()=>{
  for(const t of ['不需要补交实习证明','无需提交实习证明','如果没有交实习证明，请补交','是否需要实习证明？']) assert.equal(demoAnalyze(t).draft.action,'');
});
test('更正保持同一事项与旧版本，回复使用最新日期',()=>{
  let items=commitMemory([],{title:'实习申请',action:'补交实习证明',deadline:'周三',source:'周三前补交'},{profile:'personal',id:'a'});
  items=commitMemory(items,{title:'实习申请',action:'补交实习证明',deadline:'周五',source:'改为周五'},{profile:'personal',taskId:'a'});
  assert.equal(items.length,1);assert.equal(items[0].history[0].deadline,'周三');
  assert.match(replyForTask(items[0]),/周五/);assert.doesNotMatch(replyForTask(items[0]),/周三/);
  assert.throws(()=>commitMemory(items,{title:'x',action:'y'},{profile:'other',taskId:'a'}));
});
test('HTTP 服务提供页面，拒绝跨站请求和非法输入，不返回密钥',async()=>{
  const server=createServer({env:{AI_PROVIDER:'dashscope',AI_API_KEY:'unit-test-key',AI_MODEL:'test-model'},fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({replies:['请再说明一下。','请问下一步呢？'],draft:null,suggestedTaskId:null,memoryNote:'测试'})}}]}),{status:200})});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${server.address().port}`;
  try{
    const page=await fetch(url);assert.equal(page.status,200);assert.match(await page.text(),/SIGNOVA/);
    const cross=await fetch(url+'/api/analyze',{method:'POST',headers:{Origin:'https://example.com'},body:'{}'});assert.equal(cross.status,403);
    const invalid=await fetch(url+'/api/analyze',{method:'POST',body:'{}'});assert.equal(invalid.status,400);
    const valid=await fetch(url+'/api/analyze',{method:'POST',body:JSON.stringify({text:'周五前补交实习证明'})});assert.equal(valid.status,200);assert.ok((await valid.json()).replies.length>=2);
    assert.equal((await fetch(url+'/.env')).status,404);
  }finally{await new Promise(r=>server.close(r));}
});
