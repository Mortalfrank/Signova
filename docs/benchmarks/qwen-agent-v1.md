# SIGNOVA × Qwen：冻结合成集对照与消融

模型：`qwen3.7-plus`；输入集：60 条 AI 辅助构建、预先标注的虚构场景；每组每题 1 次；温度 0；并发 2；状态：**完整**。

比较对象为同一模型与同一系统任务契约。直接 Qwen 可访问全部合法最新记录、近期对话和本人选择；各组共享档案权限与版本前处理。Agent 的区别是检索、指代策略、本地澄清和输出约束。标签与标准答案未发送给模型。

**主指标是结构化关联与日期通过率**：引用状态/事项编号、草稿存在性、更新对象及明确日期均符合预设标签。它不评估回复措辞、材料行动内容、手语翻译或真实用户任务完成。

| 实验组 | 结构化通过 | 引用判断符合 | 错误绑定 | 明确日期匹配 | 模型调用 | 已知输入 Token | 已知总 Token | usage 缺失 | 观测结束 P50 ms | P95 ms | 失败观测 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 直接 Qwen（完整合法上下文） | 95.0% (57/60) | 96.7% (58/60) | 1/60 | 100.0% (20/20) | 60/60 | 99812 | 110723 | 0 | 3787.5 | 4635.3 | 0 |
| Qwen + 旧关键词检索 | 95.0% (57/60) | 96.7% (58/60) | 1/60 | 95.0% (19/20) | 60/60 | 99812 | 110584 | 0 | 3761.9 | 4438.0 | 0 |
| SIGNOVA 完整 Agent | 91.7% (55/60) | 93.3% (56/60) | 0/60 | 100.0% (20/20) | 54/60 | 85680 | 94846 | 0 | 3670.0 | 4366.0 | 0 |
| 消融：移除近期对话 | 78.3% (47/60) | 80.0% (48/60) | 0/60 | 60.0% (12/20) | 46/60 | 72744 | 80501 | 0 | 3525.7 | 4549.8 | 0 |
| 消融：移除本地硬门控与后约束 | 91.7% (55/60) | 93.3% (56/60) | 0/60 | 100.0% (20/20) | 60/60 | 95309 | 105647 | 0 | 3731.4 | 4397.2 | 1 |

## 相对直接 Qwen 的配对结果

| 实验组 | 共同样本 | 通过率差（百分点） | 样本配对 bootstrap 95% 区间 | 输入 Token 均值降幅 | 总 Token 均值降幅 | 全观测结束均时降幅（含失败） |
|---|---:|---:|---:|---:|---:|---:|
| Qwen + 旧关键词检索 | 60 | 0.0 | [-5.0, 5.0] | 0.0% (n=60) | 0.1% (n=60) | 1.5% (n=60) |
| SIGNOVA 完整 Agent | 60 | -3.3 | [-11.7, 5.0] | 14.2% (n=60) | 14.3% (n=60) | 15.3% (n=60) |
| 消融：移除近期对话 | 60 | -16.7 | [-26.7, -8.3] | 27.1% (n=60) | 27.3% (n=60) | 27.7% (n=60) |
| 消融：移除本地硬门控与后约束 | 60 | -3.3 | [-11.7, 5.0] | 4.5% (n=60) | 4.6% (n=60) | 5.2% (n=60) |

## 共同成功样本的文本处理时间

以下只比较同一道题两组均满足结构化通过条件的观测，另列样本数；这是条件子集分析，不替代全量质量结果。耗时含本地澄清，不含采音、ASR 或动作渲染。

| 实验组 | 两组共同成功 N | 直接 Qwen 均时 ms | 实验组均时 ms | 均时降幅 |
|---|---:|---:|---:|---:|
| Qwen + 旧关键词检索 | 56 | 3781.2 | 3754.8 | 0.7% (n=56) |
| SIGNOVA 完整 Agent | 53 | 3786.4 | 3190.0 | 15.8% (n=53) |
| 消融：移除近期对话 | 47 | 3728.2 | 3133.1 | 16.0% (n=47) |
| 消融：移除本地硬门控与后约束 | 53 | 3772.6 | 3570.9 | 5.3% (n=53) |

负数表示变差；所有失败仍保留在分母。缺少 usage 的请求不被伪装成零 Token，已知用量按对应已观测请求汇总；各组缺失 usage 数见 summary.json。本地澄清明确计为零模型调用、零 Token，并计入系统耗时。

上述区间只描述这组相关合成样本的案例重采样，不代表真实用户总体置信度；每题单轮测量也不足以证明服务性能显著差异。

## 各类场景

| 场景类别 | 直接 Qwen（完整合法上下文） | Qwen + 旧关键词检索 | SIGNOVA 完整 Agent | 消融：移除近期对话 | 消融：移除本地硬门控与后约束 |
|---|---:|---:|---:|---:|---:|
| explicit | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) |
| context_reference | 75.0% (6/8) | 75.0% (6/8) | 75.0% (6/8) | 12.5% (1/8) | 75.0% (6/8) |
| ambiguous | 100.0% (8/8) | 100.0% (8/8) | 75.0% (6/8) | 75.0% (6/8) | 87.5% (7/8) |
| unrelated | 100.0% (8/8) | 100.0% (8/8) | 100.0% (8/8) | 100.0% (8/8) | 100.0% (8/8) |
| correction | 87.5% (7/8) | 87.5% (7/8) | 87.5% (7/8) | 50.0% (4/8) | 87.5% (7/8) |
| negation | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 75.0% (3/4) |
| conditional | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| version_scope | 100.0% (8/8) | 100.0% (8/8) | 100.0% (8/8) | 100.0% (8/8) | 100.0% (8/8) |

## 失败样本（完整保留）

| 组 | ID | 输入 | 预设引用/更新/日期 | 实际结果 |
|---|---|---|---|---|
| agent-no-gate | comm-v1-042 | 停车优惠资格复核暂停，不用再提交车辆照片。 | {"decision":"resolved","taskId":"p-parking","draft":"forbidden","deadline":null} | MODEL_OUTPUT |
| agent-no-gate | comm-v1-050 | 上次的凭证可以改成电子版吗？ | {"decision":"resolved","taskId":"h-booking","draft":"forbidden","deadline":null} | {"decision":"resolved","taskId":"h-booking","draft":{"title":"预约凭证变更","action":"将预约凭证变更为电子版","deadline":"周二","source":"上次的凭证可以改成电子版吗？","correction":true},"suggestedTaskId":"h-booking"} |
| signova-agent | comm-v1-050 | 上次的凭证可以改成电子版吗？ | {"decision":"resolved","taskId":"h-booking","draft":"forbidden","deadline":null} | {"decision":"resolved","taskId":"h-booking","draft":{"title":null,"action":"将预约凭证变更为电子版","deadline":null,"source":"上次的凭证可以改成电子版吗？","correction":true},"suggestedTaskId":"h-booking"} |
| qwen-keyword | comm-v1-050 | 上次的凭证可以改成电子版吗？ | {"decision":"resolved","taskId":"h-booking","draft":"forbidden","deadline":null} | {"decision":"resolved","taskId":"h-booking","draft":{"title":null,"action":"向预约服务台提交新的联系方式（电子版）","deadline":null,"source":"上次的凭证可以改成电子版吗？","correction":true},"suggestedTaskId":"h-booking"} |
| agent-no-context | comm-v1-050 | 上次的凭证可以改成电子版吗？ | {"decision":"resolved","taskId":"h-booking","draft":"forbidden","deadline":null} | {"decision":"resolved","taskId":"h-booking","draft":{"title":"预约凭证变更","action":"向预约服务台提交新的联系方式（改为电子版）","deadline":"周二","source":"上次的凭证可以改成电子版吗？","correction":true},"suggestedTaskId":"h-booking"} |
| qwen-direct | comm-v1-050 | 上次的凭证可以改成电子版吗？ | {"decision":"resolved","taskId":"h-booking","draft":"forbidden","deadline":null} | {"decision":"resolved","taskId":"h-booking","draft":{"title":null,"action":"提交电子版预约凭证","deadline":null,"source":"上次的凭证可以改成电子版吗？","correction":true},"suggestedTaskId":"h-booking"} |
| agent-no-context | comm-v1-007 | 那张卡的领取时间能确认吗？ | {"decision":"ambiguous","taskId":null,"draft":"forbidden","deadline":null} | {"decision":"none","taskId":null,"draft":null,"suggestedTaskId":null} |
| signova-agent | comm-v1-007 | 那张卡的领取时间能确认吗？ | {"decision":"ambiguous","taskId":null,"draft":"forbidden","deadline":null} | {"decision":"none","taskId":null,"draft":null,"suggestedTaskId":null} |
| agent-no-gate | comm-v1-007 | 那张卡的领取时间能确认吗？ | {"decision":"ambiguous","taskId":null,"draft":"forbidden","deadline":null} | {"decision":"none","taskId":null,"draft":null,"suggestedTaskId":null} |
| agent-no-context | comm-v1-004 | 那项请改成周三前完成，材料照旧。 | {"decision":"resolved","taskId":"s-award","draft":"required","deadline":"周三前"} | {"decision":"ambiguous","taskId":null,"draft":null,"suggestedTaskId":null} |
| agent-no-context | comm-v1-019 | 这件改为周一之前补齐，其他字段不变。 | {"decision":"resolved","taskId":"b-address","draft":"required","deadline":"周一之前"} | {"decision":"ambiguous","taskId":null,"draft":null,"suggestedTaskId":null} |
| agent-no-context | comm-v1-020 | When can I collect it? | {"decision":"resolved","taskId":"b-card","draft":"forbidden","deadline":null} | {"decision":"ambiguous","taskId":null,"draft":null,"suggestedTaskId":null} |
| qwen-direct | comm-v1-020 | When can I collect it? | {"decision":"resolved","taskId":"b-card","draft":"forbidden","deadline":null} | {"decision":"ambiguous","taskId":null,"draft":null,"suggestedTaskId":null} |
| agent-no-context | comm-v1-049 | 那件的办理时间改到周五，其他资料保持原样。 | {"decision":"resolved","taskId":"h-invoice","draft":"required","deadline":"周五"} | {"decision":"ambiguous","taskId":null,"draft":null,"suggestedTaskId":null} |
| qwen-keyword | comm-v1-049 | 那件的办理时间改到周五，其他资料保持原样。 | {"decision":"resolved","taskId":"h-invoice","draft":"required","deadline":"周五"} | {"decision":"ambiguous","taskId":null,"draft":null,"suggestedTaskId":null} |
| agent-no-context | comm-v1-041 | 更正一下，改为周五前，之前说的周二不算。 | {"decision":"resolved","taskId":"p-parking","draft":"required","deadline":"周五前"} | {"decision":"ambiguous","taskId":null,"draft":null,"suggestedTaskId":null} |
| agent-no-context | comm-v1-034 | 那件延期到周四，证件要求不变。 | {"decision":"resolved","taskId":"p-residence","draft":"required","deadline":"周四"} | {"decision":"ambiguous","taskId":null,"draft":null,"suggestedTaskId":null} |
| signova-agent | comm-v1-005 | 那张卡已经做好了吗？ | {"decision":"resolved","taskId":"s-access","draft":"forbidden","deadline":null} | {"decision":"none","taskId":null,"draft":null,"suggestedTaskId":null} |
| agent-no-context | comm-v1-005 | 那张卡已经做好了吗？ | {"decision":"resolved","taskId":"s-access","draft":"forbidden","deadline":null} | {"decision":"none","taskId":null,"draft":null,"suggestedTaskId":null} |
| agent-no-gate | comm-v1-005 | 那张卡已经做好了吗？ | {"decision":"resolved","taskId":"s-access","draft":"forbidden","deadline":null} | {"decision":"none","taskId":null,"draft":null,"suggestedTaskId":null} |
| agent-no-context | comm-v1-026 | 刚刚的日期记反了，应当是周二，不是周四。 | {"decision":"resolved","taskId":"b-address","draft":"required","deadline":"周二"} | {"decision":"ambiguous","taskId":null,"draft":null,"suggestedTaskId":null} |
| qwen-keyword | comm-v1-026 | 刚刚的日期记反了，应当是周二，不是周四。 | {"decision":"resolved","taskId":"b-address","draft":"required","deadline":"周二"} | {"decision":"resolved","taskId":"b-statement","draft":{"title":null,"action":null,"deadline":"周二","source":"刚刚的日期记反了，应当是周二，不是周四。","correction":true},"suggestedTaskId":"b-statement"} |
| qwen-direct | comm-v1-026 | 刚刚的日期记反了，应当是周二，不是周四。 | {"decision":"resolved","taskId":"b-address","draft":"required","deadline":"周二"} | {"decision":"resolved","taskId":"b-statement","draft":{"title":null,"action":null,"deadline":"周二","source":"刚刚的日期记反了，应当是周二，不是周四。","correction":true},"suggestedTaskId":"b-statement"} |
| agent-no-context | comm-v1-022 | 上回那项需要重新预约吗？ | {"decision":"ambiguous","taskId":null,"draft":"forbidden","deadline":null} | {"decision":"none","taskId":null,"draft":null,"suggestedTaskId":null} |
| signova-agent | comm-v1-022 | 上回那项需要重新预约吗？ | {"decision":"ambiguous","taskId":null,"draft":"forbidden","deadline":null} | {"decision":"none","taskId":null,"draft":null,"suggestedTaskId":null} |
| agent-no-context | comm-v1-011 | 刚才说错了，周一前交，周四那版作废。 | {"decision":"resolved","taskId":"s-award","draft":"required","deadline":"周一前"} | {"decision":"none","taskId":null,"draft":null,"suggestedTaskId":null} |
| agent-no-gate | comm-v1-011 | 刚才说错了，周一前交，周四那版作废。 | {"decision":"resolved","taskId":"s-award","draft":"required","deadline":"周一前"} | {"decision":"none","taskId":null,"draft":{"title":"提交奖学金申请材料","action":"提交奖学金申请材料","deadline":"周一前","source":"刚才说错了，周一前交，周四那版作废。","correction":false},"suggestedTaskId":null} |
| signova-agent | comm-v1-011 | 刚才说错了，周一前交，周四那版作废。 | {"decision":"resolved","taskId":"s-award","draft":"required","deadline":"周一前"} | {"decision":"none","taskId":null,"draft":{"title":"提交奖学金申请材料","action":"提交奖学金申请材料","deadline":"周一前","source":"刚才说错了，周一前交，周四那版作废。","correction":false},"suggestedTaskId":null} |
| agent-no-context | comm-v1-056 | 不是周三，最终改为周五来窗口。 | {"decision":"resolved","taskId":"h-booking","draft":"required","deadline":"周五"} | {"decision":"ambiguous","taskId":null,"draft":null,"suggestedTaskId":null} |

## 数据来源与可复现范围

- 数据集 SHA-256：`1eff6ec5559a8e1bf054df0b7125a0f0e9ffadf269a9533194559103eeae2f1d`。
- 冻结协议指纹：`a6871b1fdb8f31b92a29bcb909413d44e36ede07dced5fbf2702d666984f5078`；开始：2026-10-23T04:05:53.537Z。
- 所有场景和标签由本次 AI 辅助开发流程构建；未经独立人工复核，不是公开标准榜单或独立盲测。新样本在首次模型调用前冻结，没有按本轮成绩删题或更改标签。
- 模型为供应商别名，返回 model 字段逐请求保留；温度 0 也不保证再次调用逐字一致。
- 耗时从本机文本输入至结构化候选，不含采音、ASR、手语生成与渲染；并发、网络与供应商前缀缓存影响耗时和计费，缓存 Token 逐请求保留。
- 本地硬门控消融仍保留检索和 referenceDecision 提示，仅移除本地提前澄清与结果约束；近期对话消融同时移除解析器和模型的近期对话输入。
- 请求不自动重试；授权、配额、配置或调用预算错误会停止继续派发，保留已有结果；未完成运行不作为全量结论。
- 百度/vivo 的公开工作用于研究参考，本实验没有运行其闭源产品或原始系统，不产生跨厂商性能结论。

详细 JSON 和逐请求数据见运行目录中的 `summary.json`、`manifest.json`、`traces.jsonl`；可用 `npm run bench:qwen:report` 离线重算本报告。
