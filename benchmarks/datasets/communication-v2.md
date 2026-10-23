# SIGNOVA Communication v2 冻结合成评测集

这是一次开发迭代后新增的 **60 条 AI 辅助构建的冻结合成场景与预设标签**，尚未经独立人工复核。它不是独立人工盲测、人工 gold 标准、公开标准测试集或真实用户采样。rationale 仅解释预设标签的意图。

## 冻结记录

- 文件：`communication-v2.jsonl`，每行一个完整样本，UTF-8、LF。
- 固定评测时刻：`2026-10-23T00:00:00Z`，由 runner 显式注入。
- SHA-256：`7b167c456400341b0de015cff9e2d1adb702e9a868f4edc8d80264d4ee901b24`。
- 本批构建过程中没有读取评测结果、模型输出或当前生产源代码，也没有运行生产解析器以选择题目或修改标签。
- 标签在本批模型调用之前冻结；后续修订应创建新版本，保留本版本与原始结果。
- 全部事项、材料、场景资料与发言重新合成；不复用 v1 的完整发言或事项标题。不含真实个人资料、录音、病历或账户数据。

## 样本组成

| 领域 | 数量 |
|---|---:|
| school | 15 |
| bank | 15 |
| public_service | 15 |
| hospital_administration | 15 |

| 类别 | 数量 |
|---|---:|
| explicit | 12 |
| context_reference | 8 |
| ambiguous | 8 |
| unrelated | 8 |
| correction | 8 |
| negation | 4 |
| conditional | 4 |
| version_scope | 8 |

共 53 条中文为主、7 条英文。英文包含两条明确议题介绍、一条承接上下文的问句和四条无关发言。中文日期覆盖本周/下周、之前/之后、上午/下午/早上/晚上/中午及具体月日等表达。

决策标签：resolved 40、ambiguous 8、none 8、disabled 4。
草稿标签：required 22、forbidden 30、optional 8。
每例最多 5 条原始事项，低于 6 条上限；4 例含同编号新旧版本和另一个模拟档案。4 例记忆隔离中，2 例明确新建提醒、2 例只有疑问。

## Schema 与标签契约

每行字段与 v1 一致：

```text
{
  id, split: "test", domain, category, text, knowledge,
  context: [string], profile: "personal" | "visitor",
  memoryEnabled: boolean, selectedTaskId: null | string,
  tasks: [{
    id, profile, title, action, deadline, status,
    source, updatedAt
  }],
  expected: {
    decision: "resolved" | "ambiguous" | "none" | "disabled",
    taskId: null | string,
    draft: "required" | "forbidden" | "optional",
    deadline: null | string
  },
  rationale
}
```

`text`、`knowledge`、`context`、`profile`、`memoryEnabled`、`selectedTaskId` 与 `tasks` 是可用输入。`expected` 和 `rationale` 仅用于评分与复核，不得进入被测模型 prompt 或用于候选筛选。rationale 不代表标签已独立验证。

- `decision` 衡量是否引用已保存事项，不等同于是否生成行动。取消某项或询问某项仍可为 resolved，同时 draft 为 forbidden。
- resolved 的 taskId 属于当前个人档案同编号的最新有效记录；ambiguous、none、disabled 的 taskId 为 null。
- memoryEnabled=false 或 profile=visitor 时，引用决策为 disabled，旧个人事项不应发送或绑定；用户本轮明确另建提醒时，仍可为 required，生成不绑定旧编号的新草稿。
- required 表示本轮明确安排或更正；forbidden 禁止新增/继续办理行动，包括未满足条件、询问、取消及未消歧；optional 为议题介绍或沿用现有安排。结构化取消事件应另列指标，不当作继续办理草稿。
- expected.deadline 是本轮应写入的新期限，保留原文周次、前后和时段；未指定新日期则为 null。允许等义规范“之前/前”“之后/后”“星期/周”，同时保留本周/下周、前/后及具体时段。仅匹配相同星期不算保留时间约束。
- 最新版本检查还应对照实际进入 prompt 的记录内容，不能只匹配同一个事项编号。

## 公平对照与报告

直接模型与 Agent 使用相同模型、参数、输出 schema、原始场景输入和许可范围。两组都执行相同的档案隔离和最新版本前处理；直接模型可获得全部合法最新事项，Agent 按自身策略选择和约束。一组不应获得额外答案字段或隐含标签。

总体与各类别应同时报告关联准确率、召回、错误绑定、额外澄清、草稿产生精确率/召回、更新目标和日期正确率。性能另统计真实请求成功率、P50/P95、Token、调用数与失败重试。保留全部失败及原始响应，不按看到的分数筛题。

## 局限

本批是在一次已知开发迭代后生成的第二批合成数据。虽然没有查看当前结果、模型输出或生产代码，生成者仍带有历史项目与任务契约上下文，不能称独立隐藏测试。领域内有模板亲缘性，样本并非独立随机用户事件，预设标签仍需独立人工复核。

这里只衡量文本通信中的引用与结构化草稿行为，不衡量真实语音识别、手语语言准确率、数字人动作、诊疗质量、实际机构政策或端到端翻译延迟。英文覆盖有限。银行与医院均为虚构行政情景，不提供专业业务建议。

## 离线校验

运行 `node --test test/benchmark-dataset-v2.test.mjs`。校验只检查结构、配比、哈希、输入隔离、日期表达及与 v1 的完整发言/事项标题不重复；不调用模型或生产解析器，也不因成绩调整数据。通过校验不等于标签已经独立人工审核。
