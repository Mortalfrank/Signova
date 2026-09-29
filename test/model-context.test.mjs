import test from 'node:test';
import assert from 'node:assert/strict';
import {memoryContext,draftForTask} from '../public/model-context.js';

test('仅显式允许时发送本人最新事项，访客和历史版本均不发送',()=>{
 const records=[{id:'a',profile:'personal',title:'实习申请',action:'提交证明',deadline:'周三',status:'pending',history:[{source:'private history'}],updatedAt:'2026-09-29'}, {id:'b',profile:'other',title:'other',action:'private'}];
 assert.deepEqual(memoryContext(records,'personal',false,'实习'),[]);
 assert.deepEqual(memoryContext(records,'visitor',true,'实习'),[]);
 const sent=memoryContext(records,'personal',true,'实习');assert.equal(sent.length,1);assert.equal(sent[0].id,'a');assert.ok(!('history' in sent[0]));assert.ok(!('profile' in sent[0]));
});

test('局部更正只更新明确字段，null保留旧值，空串允许清除日期',()=>{
 const old={title:'实习',action:'提交证明',deadline:'周三'};
 assert.deepEqual(draftForTask({title:null,action:null,deadline:'周五',source:'改为周五'},old),{title:'实习',action:'提交证明',deadline:'周五',source:'改为周五'});
 assert.equal(draftForTask({deadline:''},old).deadline,'');
 assert.equal(draftForTask(null,null).action,'');
});
