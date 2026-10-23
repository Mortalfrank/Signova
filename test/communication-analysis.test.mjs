import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareCommunication, constrainModelResult, currentDeadline } from '../public/communication-analysis.js';
import { commitMemory } from '../public/core.js';

const internship = { id:'internship',profile:'personal',title:'实习申请',action:'补交实习证明',deadline:'周三',source:'请周三提交实习证明。',status:'pending',updatedAt:'2026-10-01',history:[{deadline:'周二',source:'private-history'}] };
const transcript = { id:'transcript',profile:'personal',title:'成绩单申请',action:'领取成绩单',deadline:'周四',source:'周四领取成绩单',status:'pending',updatedAt:'2026-10-02',history:[] };
const prepare = (text, extra={}) => prepareCommunication({text,tasks:[internship,transcript],profile:'personal',enabled:true,now:'2026-10-22',...extra});

test('model drafts from questions are removed while raw speech and reference remain unchanged', () => {
  const {resolution,result}=prepare('实习证明可以换成扫描件吗？');
  const source='实习证明可以换成扫描件吗？';
  const constrained=constrainModelResult({mode:'model',draft:{source,action:'换成扫描件',deadline:null},suggestedTaskId:internship.id,replies:['请确认是否接受扫描件。','格式要求是什么？']},resolution,result);
  assert.equal(constrained.draft,null);
  assert.equal(constrained.suggestedTaskId,null);
  assert.equal(constrained.memoryResolution.selectedTaskId,internship.id);
  assert.equal(source,'实习证明可以换成扫描件吗？');
  const statement=constrainModelResult({mode:'model',draft:{source:'实习证明请换成扫描件。',action:'换成扫描件'},suggestedTaskId:internship.id,replies:[]},resolution,result);
  assert.equal(statement.draft.action,'换成扫描件');
});

test('explicit current reference resolves a local candidate without changing source text',()=>{
  const text='上次的实习证明，改成周五前补上。';
  const {resolution,result}=prepare(text);
  assert.equal(resolution.selectedTaskId,internship.id);
  assert.equal(result.suggestedTaskId,internship.id);
  assert.equal(result.draft.source,text);
  assert.equal(result.draft.deadline,'周五前');
  assert.equal(result.draft.title,null);
  assert.doesNotMatch(JSON.stringify(result),/private-history|周二/);
});
test('unanchored pronouns ask for a choice and never create a task',()=>{
  const {result}=prepare('上次那份改成周五。');
  assert.equal(result.memoryResolution.status,'ambiguous');
  assert.equal(result.draft,null);
  assert.equal(result.suggestedTaskId,null);
  assert.equal(result.memoryResolution.candidates.length,2);
});
test('conversation anchor supplies meaning but never replaces current date',()=>{
  const {result}=prepare('改成周五，其他不变。',{context:['请补交实习证明。']});
  assert.equal(result.suggestedTaskId,internship.id);
  assert.equal(result.draft.deadline,'周五');
  assert.equal(result.memoryResolution.selected.deadline,'周三');
});
test('cancelled, conditional and question requests have no actionable memory update',()=>{
  for(const text of ['实习证明不用补交了。','如果实习证明还缺，就周五补上。','上次实习证明是否要补交？']){
    const {result}=prepare(text);
    assert.equal(result.draft,null,text);
  }
});
test('confirmed saving updates the same task and retains the previous version',()=>{
  const before=structuredClone([internship,transcript]);
  const {result}=prepare('实习证明改为周五。');
  const draft={title:result.draft.title??internship.title,action:result.draft.action??internship.action,deadline:result.draft.deadline,source:result.draft.source};
  const after=commitMemory(before,draft,{profile:'personal',taskId:result.suggestedTaskId,now:'2026-10-22',id:'unused'});
  assert.equal(after.length,2);assert.equal(after[0].id,internship.id);
  assert.equal(after[0].deadline,'周五');assert.equal(after[0].history.at(-1).deadline,'周三');
  assert.deepEqual(before,[internship,transcript]);
});
test('memory permission and visitor mode prevent personal context',()=>{
  for(const extra of [{enabled:false},{profile:'visitor'}]){
    const {resolution,result}=prepare('上次实习证明改为周五。',extra);
    assert.equal(resolution.status,'disabled');assert.equal(resolution.memories.length,0);
    assert.equal(result.memoryResolution.selected,null);
  }
});
test('ambiguous decision blocks a fabricated model binding',()=>{
  const {resolution,result}=prepare('上次那份改到周五。');
  const fabricated={mode:'model',draft:{deadline:'周五'},suggestedTaskId:internship.id,replies:['是实习证明吗？','在哪里交？']};
  assert.strictEqual(constrainModelResult(fabricated,resolution,result),result);
});
test('conflicting model target is cleared and user is asked to clarify',()=>{
  const {resolution,result}=prepare('实习证明改为周五。');
  const constrained=constrainModelResult({mode:'model',draft:{deadline:'周五'},suggestedTaskId:transcript.id,replies:[]},resolution,result);
  assert.equal(constrained.draft,null);assert.equal(constrained.suggestedTaskId,null);
  assert.match(constrained.replies[0],/哪一件/);
});
test('date extraction preserves self correction and explicitly negated dates',()=>{
  assert.equal(currentDeadline('周三，不对，改成周五，不是周三。'),'周五');
  assert.equal(currentDeadline('不是周三，是周五前。'),'周五前');
  assert.equal(currentDeadline('请在10月28日补上。'),'10月28日');
});
test('a new explicit subject beats a previously selected task',()=>{
  const {resolution,result}=prepare('成绩单改为周五领取。',{selectedTaskId:internship.id,context:['请补交实习证明。']});
  assert.equal(resolution.selectedTaskId,transcript.id);
  assert.equal(result.suggestedTaskId,transcript.id);
});
test('oversized or empty speech is rejected without truncating its meaning',()=>{
  for(const text of ['', ' ', '字'.repeat(4001)])assert.throws(()=>prepare(text),RangeError);
});
test('rule draft does not invent a resubmission when the speaker only said submit',()=>{
  assert.equal(prepare('请提交实习证明。',{enabled:false}).result.draft.action,'提交实习证明');
  assert.equal(prepare('请补交实习证明。',{enabled:false}).result.draft.action,'补交实习证明');
});
