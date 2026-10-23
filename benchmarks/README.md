# SIGNOVA Agent × Qwen 可复现评测工程

本工程测量：在同一个 Qwen 模型与相同可用资料上，SIGNOVA 的检索、上下文指代、本地澄清和结果约束，如何影响结构化输出、用量与文本处理耗时。结果由真实模型调用生成，逐题输出和失败保留，可离线重新评分。

## 快速开始

在仓库根目录使用 Node.js 22+：

```powershell
npm ci
# 只检查冻结数据、实验计划和代码指纹，不调用模型：
npm run bench:qwen:dry
# 真实运行最新 v2 主对照：读取本机 .env；最多 180 次模型请求，不自动重试
npm run bench:qwen
# 离线重新计算报告，不调用模型：
npm run bench:qwen:report
# 核对数据/源码指纹、完整逐题记录，并离线重算统计：
npm run bench:qwen:verify
# 无网络、无密钥、无费用的回归：
node --test test/benchmark-arms.test.mjs test/benchmark-dataset.test.mjs test/benchmark-dataset-v2.test.mjs test/benchmark-metrics.test.mjs test/benchmark-runner.test.mjs
```

模型配置沿用 `.env.example` 中的 `AI_API_KEY` / `DASHSCOPE_API_KEY`、`AI_MODEL`、`AI_BASE_URL`、`AI_ENABLE_THINKING`。密钥只在本机保管，不进入 JSONL、报告或请求日志。实验始终使用虚构资料，不读取浏览器事项或真实个人记录。

`npm run bench:qwen` 默认运行 v2 三组主对照，输出 `benchmarks/results/qwen-agent-v2/`。已有目录不会覆盖，`--resume` 保留每条成功与失败观测；改变输入、模型配置、端点、指标或源代码后，需使用新的输出目录。要改参数，直接使用下列 CLI（避免重复传入同名选项）：

```powershell
node --env-file-if-exists=.env benchmarks/run.mjs --dataset benchmarks/datasets/communication-v2.jsonl --out benchmarks/results/my-run --arms qwen-direct,qwen-keyword,signova-agent --concurrency 2 --max-model-calls 180
node --env-file-if-exists=.env benchmarks/run.mjs --dataset benchmarks/datasets/communication-v2.jsonl --out benchmarks/results/my-run --arms qwen-direct,qwen-keyword,signova-agent --concurrency 2 --max-model-calls 180 --resume
node benchmarks/report.mjs --run benchmarks/results/my-run
```

供应商别名可能更新、托管模型可能有非确定性；复现是同协议重测与离线复算，不保证重新请求逐字相同。运行中止时，供应商可能已计费但未返回日志的请求应另外核对，不将日志中的调用数当作完整账单。

## 五组实验

| ID | 输入与执行 | 用途 |
|---|---|---|
| `qwen-direct` | 明确的系统任务指令 + 全部合法最新记录 + 当前发言 + 近期对话 + 本人选择；一次 Qwen 调用 | 强直接调用基线 |
| `qwen-keyword` | 同模型、同契约，先执行旧 `memoryContext` 关键词排序 | 普通检索基线；本数据合法记录不超过 6 条，因此主要区别是排序，不是强截断 |
| `signova-agent` | 生产 `prepareCommunication` → 歧义时本地澄清 → 相关记录送同一 Qwen → 生产 `constrainModelResult` | 完整 Agent |
| `agent-no-context` | 完整流程同时去掉解析器与模型的近期对话，保留当前发言和本人选择 | 近期对话消融 |
| `agent-no-gate` | 保留解析与检索及 referenceDecision 提示，移除本地提前澄清和结果后约束，每题都调用模型 | 本地硬门控/后约束消融；不是移除全部歧义知识 |

所有组共同执行权限过滤、当前档案过滤和最新版本选择，且资料均在生产接口 6 条上限以内。这些共同前处理不记作新算法收益。所有模型调用使用相同系统提示、评测观测字段、温度 0、非思考模式配置及输出上限；实验按固定种子打乱题目与组顺序，避免永远先跑某一组。

评测经生产 `analyzeWithModel` 的注入 fetch 边界观察请求与响应，额外要求 `benchmarkReference` 字段用于区分“引用了哪个事项”和“是否生成行动”。该契约对所有组相同，不含标签。完整 Agent 的引用决策来自生产解析器；基线及无硬门控组由模型填写观测字段。

## 冻结集与评分

数据：[communication-v1.jsonl](datasets/communication-v1.jsonl)，60 条 AI 辅助构建、预先标注的虚构场景，四领域各 15 条。构建与标签先于首次模型调用，未按分数删题或改标签；尚未经独立人工复核。详细组成与日期标注见 [数据说明](datasets/README.md)。

另有 [communication-v2.jsonl](datasets/communication-v2.jsonl) 和 [v2 数据说明](datasets/communication-v2.md)：在 v1 开发问题修复后重新构建的 60 条新合成场景。数据作者未查看 v1 模型输出或当前算法源码；仍不是外部独立人工金标准。两批合计 120 条。v1 用于五组初测及消融；v2 用于修复后的三组主对照，结果分开报告，不拿跨数据集分数差当作算法提升。[迭代记录](../docs/benchmarks/iteration-notes.md)。

主指标为 **结构化关联与日期通过率**，内部字段名 `taskSuccess`。每例需同时满足：

1. 引用状态和事项 ID 与预设标签一致。
2. 草稿存在性满足 required / forbidden / optional 标签。
3. 要求生成草稿或实际产生可选草稿时，建议更新对象正确。
4. 标签指定当前期限时，期限相符；只规范周/星期和前/之前等有限等价，不忽略前后及周次差异。

该指标不评估 `action` 材料内容、回复自然度、手语译文、动作、听障用户理解度或实际办理成功率。所有 API/解析错误计为失败，保留在总分母；可另按领域、类别、错误绑定与过度澄清复核。

取消与未满足条件题的标签依据 SIGNOVA 当前“先澄清，不直接执行状态变更或条件任务”的草稿契约；支持结构化取消或条件任务的其他产品也可能有合理的不同输出。关闭记忆仅关闭旧事项关联；v1 的四个隔离样本均为问句，v2 已增加两个关闭记忆后提出明确新任务的样本，详见各自数据说明。未来扩展这些能力时应另建数据版本复核标签。

用量使用供应商响应 `usage` 的实际输入、输出和总 Token。未调用模型的本地澄清计 0；缺失 usage 保留未知，另报缺失数。只比较已知用量的配对样本。缓存用量字段保留，Token 总数并非实际账单金额。

延迟从本机文本输入至结构化候选，报告均值、nearest-rank P50/P95，另报模型调用段和调用数。它不含采音、ASR、手语生成或渲染。单轮并发测量受网络、服务负载与前缀缓存影响，不作为供应商 SLA 或真实端到端翻译提速。

通过率差采用同题配对，2000 次固定种子案例 bootstrap 给出区间；当前场景存在模板/领域相关性，区间仅描述这批合成案例，不外推真实用户总体。没有按场景族独立划分的训练集/盲测集，也没有模型权重训练。

## 结果与证据文件

- `manifest.json`：运行前冻结的数据 SHA-256、源码指纹、模型/端点摘要和实验配置。
- `traces.jsonl`：逐题逐组请求消息、模型原始输出、生产校验结果、用量、耗时、失败及评分；无鉴权头或密钥。
- `summary.json`：全量统计、分类统计、配对比较及限制。
- `report.md`：GitHub 可阅读的表格、失败清单与口径。
- `report.html`：离线可打开的指标卡片和逐题展开页面，无远程脚本。
- [最新主报告 v2](../docs/benchmarks/qwen-agent-v2.md) · [首轮与消融 v1](../docs/benchmarks/qwen-agent-v1.md)：由脚本生成，保留改善和退化的全部结果。
- [公开研究依据](../docs/benchmarks/research-basis.md)：vivo、百度和公开流式研究的参考关系及复现范围。

本轮不运行百度/vivo闭源产品，没有声称修改其算法实现，也没有将本项目结构化事项指标与其手语可懂率、赛事分数直接比较。简历及 GitHub 应引用本工程实际测得的指标和数据范围。

当前两轮完整结果及简历表达边界见 [结论与失败归因](../docs/benchmarks/conclusions.md)。v2 显示输入 Token 减少 17.4%、模型调用减少 13.3%，同时结构化通过由直接 Qwen 的 95% 降为 Agent 的 85%；因此不能只摘用效率数字来声称质量相同或整体更强。
