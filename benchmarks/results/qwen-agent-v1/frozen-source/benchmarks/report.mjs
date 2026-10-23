import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { aggregateArm, pairedComparison, scoreCase } from './lib/metrics.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const arg = process.argv.indexOf('--run');
const directory = resolve(root, arg < 0 ? 'benchmarks/results/qwen-agent-v1' : process.argv[arg + 1]);
const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8'));
const datasetBytes = readFileSync(resolve(root, manifest.dataset));
const hash = value => createHash('sha256').update(value).digest('hex');
if (hash(datasetBytes) !== manifest.datasetSha256) throw new Error('Dataset no longer matches frozen run.');
if (hash(readFileSync(resolve(root, 'benchmarks/lib/metrics.mjs'))) !== manifest.sourceSha256['benchmarks/lib/metrics.mjs']) throw new Error('Scoring implementation changed; use a separately versioned rescore, not the frozen report.');
const samples = datasetBytes.toString('utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
const byId = new Map(samples.map(sample => [sample.id, sample]));
const traces = readFileSync(resolve(directory, 'traces.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
const seen = new Set();
for (const row of traces) {
  const key = `${row.sampleId}/${row.arm}`;
  if (!byId.has(row.sampleId) || !manifest.arms.includes(row.arm) || seen.has(key)) throw new Error('Unknown or duplicate trace.');
  seen.add(key);
}
const rows = arm => traces.filter(row => row.arm === arm).map(row => ({ ...row, sample: byId.get(row.sampleId) }));
const summary = Object.fromEntries(manifest.arms.map(arm => [arm, aggregateArm(rows(arm))]));
const allComplete = traces.length === samples.length * manifest.arms.length;
const comparisons = Object.fromEntries(manifest.arms.filter(arm => arm !== 'qwen-direct' && rows(arm).length && rows('qwen-direct').length).map(arm => [arm, pairedComparison(rows('qwen-direct'), rows(arm))]));
const successfulComparisons = {};
for (const arm of Object.keys(comparisons)) {
  const left = rows('qwen-direct').filter(row => !row.error && scoreCase(row.sample, row.output).taskSuccess);
  const right = rows(arm).filter(row => !row.error && scoreCase(row.sample, row.output).taskSuccess);
  if (left.some(row => right.some(other => other.sample.id === row.sample.id))) successfulComparisons[arm] = pairedComparison(left, right);
}
const names = { 'qwen-direct': '直接 Qwen（完整合法上下文）', 'qwen-keyword': 'Qwen + 旧关键词检索', 'signova-agent': 'SIGNOVA 完整 Agent', 'agent-no-context': '消融：移除近期对话', 'agent-no-gate': '消融：移除本地硬门控与后约束' };
const pct = value => value == null ? '—' : `${(value * 100).toFixed(1)}%`;
const num = value => value == null ? '—' : value.toFixed(1);
const rate = (success, count) => `${pct(count ? success / count : null)} (${success}/${count})`;
const lines = [
  '# SIGNOVA × Qwen：冻结合成集对照与消融', '',
  `模型：\`${manifest.model.model}\`；输入集：${samples.length} 条 AI 辅助构建、预先标注的虚构场景；每组每题 1 次；温度 0；并发 ${manifest.concurrency}；状态：**${allComplete ? '完整' : '未完成，以下仅为已观测子集'}**。`, '',
  '比较对象为同一模型与同一系统任务契约。直接 Qwen 可访问全部合法最新记录、近期对话和本人选择；各组共享档案权限与版本前处理。Agent 的区别是检索、指代策略、本地澄清和输出约束。标签与标准答案未发送给模型。', '',
  '**主指标是结构化关联与日期通过率**：引用状态/事项编号、草稿存在性、更新对象及明确日期均符合预设标签。它不评估回复措辞、材料行动内容、手语翻译或真实用户任务完成。', '',
  '| 实验组 | 结构化通过 | 引用判断符合 | 错误绑定 | 明确日期匹配 | 模型调用 | 已知输入 Token | 已知总 Token | usage 缺失 | 观测结束 P50 ms | P95 ms | 失败观测 |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|'
];
for (const arm of manifest.arms) {
  const s = summary[arm], c = s.counts;
  lines.push(`| ${names[arm]} | ${rate(c.successfulCases, c.cases)} | ${rate(c.decisionCorrectCases, c.cases)} | ${c.wrongBindingCases}/${c.cases} | ${rate(c.deadlineCorrectCases, c.deadlineApplicableCases)} | ${c.modelCalledCases}/${c.cases} | ${s.tokens.prompt_tokens.total} | ${s.tokens.total_tokens.total} | ${s.missingUsageCount} | ${num(s.latency.totalMs.p50)} | ${num(s.latency.totalMs.p95)} | ${c.errorCases} |`);
}
lines.push('', '## 相对直接 Qwen 的配对结果', '', '| 实验组 | 共同样本 | 通过率差（百分点） | 样本配对 bootstrap 95% 区间 | 输入 Token 均值降幅 | 总 Token 均值降幅 | 全观测结束均时降幅（含失败） |', '|---|---:|---:|---:|---:|---:|---:|');
const reduction = metric => metric.reductionPct == null ? '—' : `${num(metric.reductionPct)}% (n=${metric.matchedCases})`;
for (const [arm, comparison] of Object.entries(comparisons)) {
  const ci = comparison.taskSuccess.bootstrap95CiPp;
  lines.push(`| ${names[arm]} | ${comparison.pairedCases} | ${num(comparison.taskSuccess.improvementPp)} | [${num(ci[0])}, ${num(ci[1])}] | ${reduction(comparison.tokens.prompt_tokens)} | ${reduction(comparison.tokens.total_tokens)} | ${reduction(comparison.latency.totalMs)} |`);
}
lines.push('', '## 共同成功样本的文本处理时间', '', '以下只比较同一道题两组均满足结构化通过条件的观测，另列样本数；这是条件子集分析，不替代全量质量结果。耗时含本地澄清，不含采音、ASR 或动作渲染。', '', '| 实验组 | 两组共同成功 N | 直接 Qwen 均时 ms | 实验组均时 ms | 均时降幅 |', '|---|---:|---:|---:|---:|');
for (const [arm, comparison] of Object.entries(successfulComparisons)) lines.push(`| ${names[arm]} | ${comparison.pairedCases} | ${num(comparison.latency.totalMs.baselineMean)} | ${num(comparison.latency.totalMs.candidateMean)} | ${reduction(comparison.latency.totalMs)} |`);
lines.push('', '负数表示变差；所有失败仍保留在分母。缺少 usage 的请求不被伪装成零 Token，已知用量按对应已观测请求汇总；各组缺失 usage 数见 summary.json。本地澄清明确计为零模型调用、零 Token，并计入系统耗时。', '',
  '上述区间只描述这组相关合成样本的案例重采样，不代表真实用户总体置信度；每题单轮测量也不足以证明服务性能显著差异。', '',
  '## 各类场景', '', '| 场景类别 | ' + manifest.arms.map(arm => names[arm]).join(' | ') + ' |', '|---|' + manifest.arms.map(() => '---:|').join(''));
for (const category of [...new Set(samples.map(sample => sample.category))]) {
  lines.push('| ' + category + ' | ' + manifest.arms.map(arm => { const s = aggregateArm(rows(arm).filter(row => row.sample.category === category)); return rate(s.counts.successfulCases, s.counts.cases); }).join(' | ') + ' |');
}
lines.push('', '## 失败样本（完整保留）', '', '| 组 | ID | 输入 | 预设引用/更新/日期 | 实际结果 |', '|---|---|---|---|---|');
const md = value => String(value).replaceAll('|', '\\|').replace(/[\r\n]/g, ' ');
for (const row of traces) {
  const sample = byId.get(row.sampleId);
  const score = scoreCase(sample, row.error ? null : row.output);
  if (!score.taskSuccess) lines.push(`| ${row.arm} | ${sample.id} | ${md(sample.text)} | ${md(JSON.stringify(sample.expected))} | ${md(row.error || JSON.stringify(row.output))} |`);
}
lines.push('', '## 数据来源与可复现范围', '',
  `- 数据集 SHA-256：\`${manifest.datasetSha256}\`。`,
  `- 冻结协议指纹：\`${manifest.fingerprint}\`；开始：${manifest.frozenAt}。`,
  '- 所有场景和标签由本次 AI 辅助开发流程构建；未经独立人工复核，不是公开标准榜单或独立盲测。新样本在首次模型调用前冻结，没有按本轮成绩删题或更改标签。',
  '- 模型为供应商别名，返回 model 字段逐请求保留；温度 0 也不保证再次调用逐字一致。',
  '- 耗时从本机文本输入至结构化候选，不含采音、ASR、手语生成与渲染；并发、网络与供应商前缀缓存影响耗时和计费，缓存 Token 逐请求保留。',
  '- 本地硬门控消融仍保留检索和 referenceDecision 提示，仅移除本地提前澄清与结果约束；近期对话消融同时移除解析器和模型的近期对话输入。',
  '- 请求不自动重试；授权、配额、配置或调用预算错误会停止继续派发，保留已有结果；未完成运行不作为全量结论。',
  '- 百度/vivo 的公开工作用于研究参考，本实验没有运行其闭源产品或原始系统，不产生跨厂商性能结论。',
  '', '详细 JSON 和逐请求数据见运行目录中的 `summary.json`、`manifest.json`、`traces.jsonl`；可用 `npm run bench:qwen:report` 离线重算本报告。', '');
const markdown = lines.join('\n');
writeFileSync(resolve(directory, 'report.md'), markdown);
mkdirSync(resolve(root, 'docs/benchmarks'), { recursive: true });
writeFileSync(resolve(root, 'docs/benchmarks/qwen-agent-v1.md'), markdown);

const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const cards = manifest.arms.map(arm => { const s = summary[arm]; return `<article><h2>${escape(names[arm])}</h2><strong>${pct(s.rates.taskSuccess)}</strong><p>结构化关联与日期通过率 · ${s.counts.successfulCases}/${s.counts.cases}</p><div class="bar"><i style="width:${(s.rates.taskSuccess || 0) * 100}%"></i></div><dl><dt>模型调用</dt><dd>${s.counts.modelCalledCases}</dd><dt>已知输入 Token</dt><dd>${s.tokens.prompt_tokens.total}</dd><dt>usage 缺失</dt><dd>${s.missingUsageCount}</dd><dt>观测结束 P50 / P95</dt><dd>${num(s.latency.totalMs.p50)} / ${num(s.latency.totalMs.p95)} ms</dd><dt>错误绑定</dt><dd>${s.counts.wrongBindingCases}</dd></dl></article>`; }).join('');
const cases = samples.map(sample => `<details><summary>${escape(sample.id)} · ${escape(sample.domain)} · ${escape(sample.text)}</summary><pre>${escape(JSON.stringify({ expected: sample.expected, rationale: sample.rationale, results: Object.fromEntries(traces.filter(row => row.sampleId === sample.id).map(row => [row.arm, { error: row.error, output: row.output, usage: row.usage, timing: row.timing, pass: scoreCase(sample, row.error ? null : row.output).taskSuccess }])) }, null, 2))}</pre></details>`).join('');
writeFileSync(resolve(directory, 'report.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SIGNOVA · Qwen Agent 评测</title><style>body{margin:0;background:#f4f7fb;color:#192942;font:15px/1.7 system-ui,sans-serif}main{max-width:1280px;margin:auto;padding:40px 24px}h1{font-size:32px;line-height:1.3}header p{max-width:900px;color:#56667d}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin:30px 0}article{background:white;border:1px solid #dce5f0;border-radius:16px;padding:20px}h2{font-size:16px}strong{font-size:36px;color:#2467d5}article p{font-size:12px;color:#66758b}.bar{height:6px;background:#edf2f8;border-radius:4px;overflow:hidden}.bar i{display:block;height:100%;background:#3979e4}dl{display:grid;grid-template-columns:1fr auto;font-size:13px}dd{margin:0}details{margin:10px 0;background:white;padding:14px;border-radius:10px;border:1px solid #dce5f0}summary{cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.6 ui-monospace,monospace}.note{background:#e8effa;padding:20px;border-radius:12px}</style><main><header><p>SIGNOVA / REPRODUCIBLE EVALUATION</p><h1>同一个 Qwen，比较不同交流处理策略</h1><p>${samples.length} 条冻结合成场景 · ${escape(manifest.model.model)} · ${manifest.arms.length} 组 · ${allComplete ? '全量完成' : '未完成'}</p></header><div class="note">主指标只检查结构化引用、草稿存在性、更新对象和明确日期。样本及标签由 AI 辅助构建，尚未经独立人工复核。延迟仅含文本处理；本实验不比较百度/vivo产品，也不评估手语语言质量。</div><section class="grid">${cards}</section><h2>逐题结果与预设标签</h2>${cases}<p>协议 ${escape(manifest.fingerprint)}<br>数据集 ${escape(manifest.datasetSha256)}</p></main></html>`);
console.log(JSON.stringify({ markdown: relative(root, resolve(root, 'docs/benchmarks/qwen-agent-v1.md')), html: relative(root, resolve(directory, 'report.html')), complete: allComplete, observed: traces.length }));
