export const DEFAULT_KNOWLEDGE='校园实习申请指南（演示资料）\n实习证明：由实习单位出具的证明材料。\n提交地点：学生服务中心 2 号窗口。\n办理时间：工作日 09:00–17:00。\n最终材料要求和截止时间以工作人员最新确认为准。';
export const SCENES=[
  {title:'校园实习说明会',text:'请在周三前提交实习证明。',label:'说明材料'},
  {title:'校园服务窗口',text:'还需要补交实习证明，请到学生服务中心 2 号窗口提交。',label:'窗口咨询'},
  {title:'校园服务窗口',text:'更正一下，截止时间改为周五，不是周三。',label:'更正日期'}
];
export function normalize(s){return String(s||'').replace(/[\s，。！？、,.!?]/g,'');}
export function demoAnalyze(text, knowledge='') {
  const dates=[...text.matchAll(/(?:周|星期)[一二三四五六日天]/g)].map(m=>({value:m[0],index:m.index}));
  const affirmative=dates.filter(d=>!/(不是|并非|不在|不要在)\s*$/.test(text.slice(Math.max(0,d.index-5),d.index)));
  const deadline=affirmative.at(-1)?.value||'';
  const correction=/更正|改为|改成|调整为|不是/.test(text);
  const material=/实习证明/.test(text)?'实习证明':'';
  const uncertainTask=/不需要|不用|无需|不必|取消|如果|假如|是否|要不要/.test(text);
  return {
    replies:correction?['我确认一下，最新截止时间是'+(deadline||'什么时候')+'，对吗？','其他材料要求有变化吗？','请再说明一下更新后的要求。']:material?['请问在哪里提交？','最晚什么时候提交？','请再说明一下材料要求。']:['请再解释一下。','我确认一下您的意思。','下一步需要做什么？'],
    draft:{title:'实习申请',action:material&&!uncertainTask?'补交实习证明':'',deadline,source:text,correction},
    evidence:material?(knowledge.split('\n').find(line=>line.includes(material))||'').slice(0,200):'',
    mode:'demo'
  };
}
export function commitMemory(items,draft,{profile,taskId,now=new Date().toISOString(),id=globalThis.crypto.randomUUID()}={}) {
  if(!profile || profile==='visitor') throw new Error('访客不能保存跨次记忆');
  if(!draft.title?.trim()||!draft.action?.trim())throw new Error('请填写事项名称和待办内容');
  const old=taskId?items.find(x=>x.id===taskId&&x.profile===profile):null;
  if(taskId&&!old)throw new Error('事项不存在或不属于当前档案');
  const item={id:old?.id||id,profile,title:draft.title.trim(),action:draft.action.trim(),deadline:draft.deadline?.trim()||'',status:old?.status||'pending',source:draft.source||'用户手动输入',updatedAt:now,history:old?[...old.history,{action:old.action,deadline:old.deadline,source:old.source,updatedAt:old.updatedAt}]:[]};
  return [item,...items.filter(x=>x.id!==item.id)];
}
export function replyForTask(task){return task.status==='done'?'我想咨询一下这件事项的后续安排。':`我来继续办理${task.title}，上次记录的待办是${task.action}${task.deadline?`，截止时间是${task.deadline}`:''}。`;}
export function visibleTasks(items,profile){return profile==='visitor'?[]:items.filter(x=>x.profile===profile);}
