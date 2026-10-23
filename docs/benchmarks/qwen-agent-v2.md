# SIGNOVA × Qwen：冻结合成集对照与消融

模型：`qwen3.7-plus`；输入集：60 条 AI 辅助构建、预先标注的虚构场景；每组每题 1 次；温度 0；并发 2；状态：**完整**。

比较对象为同一模型与同一系统任务契约。直接 Qwen 可访问全部合法最新记录、近期对话和本人选择；各组共享档案权限与版本前处理。Agent 的区别是检索、指代策略、本地澄清和输出约束。标签与标准答案未发送给模型。

**主指标是结构化关联与日期通过率**：引用状态/事项编号、草稿存在性、更新对象及明确日期均符合预设标签。它不评估回复措辞、材料行动内容、手语翻译或真实用户任务完成。

| 实验组 | 结构化通过 | 引用判断符合 | 错误绑定 | 明确日期匹配 | 模型调用 | 已知输入 Token | 已知总 Token | usage 缺失 | 观测结束 P50 ms | P95 ms | 失败观测 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 直接 Qwen（完整合法上下文） | 95.0% (57/60) | 96.7% (58/60) | 0/60 | 90.9% (20/22) | 60/60 | 100921 | 112073 | 0 | 3872.4 | 4582.6 | 0 |
| Qwen + 旧关键词检索 | 91.7% (55/60) | 93.3% (56/60) | 0/60 | 90.9% (20/22) | 60/60 | 100921 | 112060 | 0 | 3862.6 | 4657.6 | 0 |
| SIGNOVA 完整 Agent | 85.0% (51/60) | 88.3% (53/60) | 0/60 | 90.9% (20/22) | 52/60 | 83351 | 92528 | 0 | 3709.3 | 4517.7 | 0 |

## 相对直接 Qwen 的配对结果

| 实验组 | 共同样本 | 通过率差（百分点） | 样本配对 bootstrap 95% 区间 | 输入 Token 均值降幅 | 总 Token 均值降幅 | 全观测结束均时降幅（含失败） |
|---|---:|---:|---:|---:|---:|---:|
| Qwen + 旧关键词检索 | 60 | -3.3 | [-8.3, 0.0] | 0.0% (n=60) | 0.0% (n=60) | -0.5% (n=60) |
| SIGNOVA 完整 Agent | 60 | -10.0 | [-20.0, -1.7] | 17.4% (n=60) | 17.4% (n=60) | 16.8% (n=60) |

## 共同成功样本的文本处理时间

以下只比较同一道题两组均满足结构化通过条件的观测，另列样本数；这是条件子集分析，不替代全量质量结果。耗时含本地澄清，不含采音、ASR 或动作渲染。

| 实验组 | 两组共同成功 N | 直接 Qwen 均时 ms | 实验组均时 ms | 均时降幅 |
|---|---:|---:|---:|---:|
| Qwen + 旧关键词检索 | 55 | 3893.2 | 3920.3 | -0.7% (n=55) |
| SIGNOVA 完整 Agent | 50 | 3885.8 | 3288.7 | 15.4% (n=50) |

负数表示变差；所有失败仍保留在分母。缺少 usage 的请求不被伪装成零 Token，已知用量按对应已观测请求汇总；各组缺失 usage 数见 summary.json。本地澄清明确计为零模型调用、零 Token，并计入系统耗时。

上述区间只描述这组相关合成样本的案例重采样，不代表真实用户总体置信度；每题单轮测量也不足以证明服务性能显著差异。

## 各类场景

| 场景类别 | 直接 Qwen（完整合法上下文） | Qwen + 旧关键词检索 | SIGNOVA 完整 Agent |
|---|---:|---:|---:|
| explicit | 100.0% (12/12) | 91.7% (11/12) | 83.3% (10/12) |
| context_reference | 75.0% (6/8) | 75.0% (6/8) | 75.0% (6/8) |
| ambiguous | 100.0% (8/8) | 100.0% (8/8) | 75.0% (6/8) |
| unrelated | 100.0% (8/8) | 100.0% (8/8) | 100.0% (8/8) |
| correction | 100.0% (8/8) | 100.0% (8/8) | 87.5% (7/8) |
| negation | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| conditional | 100.0% (4/4) | 100.0% (4/4) | 75.0% (3/4) |
| version_scope | 87.5% (7/8) | 75.0% (6/8) | 87.5% (7/8) |

## 失败样本（完整保留）

| 组 | ID | 输入 | 预设引用/更新/日期 | 实际结果 |
|---|---|---|---|---|
| signova-agent | comm-v2-048 | Let us walk through the document photocopy reservation process. | {"decision":"resolved","taskId":"h2-copy","draft":"optional","deadline":null} | {"decision":"none","taskId":null,"draft":null,"suggestedTaskId":null} |
| qwen-keyword | comm-v2-048 | Let us walk through the document photocopy reservation process. | {"decision":"resolved","taskId":"h2-copy","draft":"optional","deadline":null} | {"decision":"none","taskId":null,"draft":null,"suggestedTaskId":null} |
| qwen-keyword | comm-v2-059 | 探视通行证登记沿用最近核对过的那版。 | {"decision":"resolved","taskId":"h2-visit","draft":"optional","deadline":null} | {"decision":"ambiguous","taskId":null,"draft":null,"suggestedTaskId":null} |
| qwen-direct | comm-v2-015 | 新建一条提醒：下周一上午去实验楼参加安全培训。 | {"decision":"disabled","taskId":null,"draft":"required","deadline":"下周一上午"} | {"decision":"disabled","taskId":null,"draft":null,"suggestedTaskId":null} |
| qwen-keyword | comm-v2-015 | 新建一条提醒：下周一上午去实验楼参加安全培训。 | {"decision":"disabled","taskId":null,"draft":"required","deadline":"下周一上午"} | {"decision":"disabled","taskId":null,"draft":null,"suggestedTaskId":null} |
| signova-agent | comm-v2-015 | 新建一条提醒：下周一上午去实验楼参加安全培训。 | {"decision":"disabled","taskId":null,"draft":"required","deadline":"下周一上午"} | {"decision":"disabled","taskId":null,"draft":null,"suggestedTaskId":null} |
| qwen-direct | comm-v2-019 | 那份补齐的时间就定下周五之前，别的先不变。 | {"decision":"resolved","taskId":"b2-deposit","draft":"required","deadline":"下周五之前"} | {"decision":"ambiguous","taskId":null,"draft":null,"suggestedTaskId":null} |
| qwen-keyword | comm-v2-019 | 那份补齐的时间就定下周五之前，别的先不变。 | {"decision":"resolved","taskId":"b2-deposit","draft":"required","deadline":"下周五之前"} | {"decision":"ambiguous","taskId":null,"draft":null,"suggestedTaskId":null} |
| signova-agent | comm-v2-020 | Do I need to come in person for that? | {"decision":"resolved","taskId":"b2-sms","draft":"forbidden","deadline":null} | {"decision":"ambiguous","taskId":null,"draft":null,"suggestedTaskId":null} |
| qwen-direct | comm-v2-020 | Do I need to come in person for that? | {"decision":"resolved","taskId":"b2-sms","draft":"forbidden","deadline":null} | {"decision":"ambiguous","taskId":null,"draft":null,"suggestedTaskId":null} |
| qwen-keyword | comm-v2-020 | Do I need to come in person for that? | {"decision":"resolved","taskId":"b2-sms","draft":"forbidden","deadline":null} | {"decision":"ambiguous","taskId":null,"draft":null,"suggestedTaskId":null} |
| signova-agent | comm-v2-049 | 那个改到下周三下午来，说明材料不变。 | {"decision":"resolved","taskId":"h2-visit","draft":"required","deadline":"下周三下午"} | {"decision":"ambiguous","taskId":null,"draft":null,"suggestedTaskId":null} |
| signova-agent | comm-v2-037 | 那一单现在还缺啥？ | {"decision":"ambiguous","taskId":null,"draft":"forbidden","deadline":null} | {"decision":"none","taskId":null,"draft":null,"suggestedTaskId":null} |
| signova-agent | comm-v2-058 | 院区停车票核销要等服务台盖章后再提交凭条；章还没盖。 | {"decision":"resolved","taskId":"h2-parking","draft":"forbidden","deadline":null} | {"decision":"resolved","taskId":"h2-parking","draft":{"title":null,"action":"等服务台盖章后提交停车凭条","deadline":null,"source":"院区停车票核销要等服务台盖章后再提交凭条；章还没盖。","correction":true},"suggestedTaskId":"h2-parking"} |
| signova-agent | comm-v2-022 | 之前办的那单，柜台有结果了吗？ | {"decision":"ambiguous","taskId":null,"draft":"forbidden","deadline":null} | {"decision":"none","taskId":null,"draft":null,"suggestedTaskId":null} |
| signova-agent | comm-v2-018 | Next on the agenda is registered mobile number verification. | {"decision":"resolved","taskId":"b2-phone","draft":"optional","deadline":null} | {"decision":"none","taskId":null,"draft":null,"suggestedTaskId":null} |
| signova-agent | comm-v2-056 | 11月8日那天不行，往后一天，11月9日中午前我过去。 | {"decision":"resolved","taskId":"h2-parking","draft":"required","deadline":"11月9日中午前"} | {"decision":"none","taskId":null,"draft":{"title":"递交停车票核销凭条","action":"递交停车票核销凭条","deadline":"11月9日中午前","source":"11月8日那天不行，往后一天，11月9日中午前我过去。","correction":false},"suggestedTaskId":null} |

## 数据来源与可复现范围

- 数据集 SHA-256：`7b167c456400341b0de015cff9e2d1adb702e9a868f4edc8d80264d4ee901b24`。
- 冻结协议指纹：`add8a0417e64a52b35518d3e1d72a286a2afb0596c5c0e053df8412b43ab3be3`；开始：2026-10-23T04:25:27.237Z。
- 所有场景和标签由本次 AI 辅助开发流程构建；未经独立人工复核，不是公开标准榜单或独立盲测。新样本在首次模型调用前冻结，没有按本轮成绩删题或更改标签。
- 模型为供应商别名，返回 model 字段逐请求保留；温度 0 也不保证再次调用逐字一致。
- 耗时从本机文本输入至结构化候选，不含采音、ASR、手语生成与渲染；并发、网络与供应商前缀缓存影响耗时和计费，缓存 Token 逐请求保留。
- 本地硬门控消融仍保留检索和 referenceDecision 提示，仅移除本地提前澄清与结果约束；近期对话消融同时移除解析器和模型的近期对话输入。
- 请求不自动重试；授权、配额、配置或调用预算错误会停止继续派发，保留已有结果；未完成运行不作为全量结论。
- 百度/vivo 的公开工作用于研究参考，本实验没有运行其闭源产品或原始系统，不产生跨厂商性能结论。

详细 JSON 和逐请求数据见运行目录中的 `summary.json`、`manifest.json`、`traces.jsonl`；可用 `npm run bench:qwen:report` 离线重算本报告。
