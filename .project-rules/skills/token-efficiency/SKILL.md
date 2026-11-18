---
name: token-efficiency
description: 降低 AI 编程 Agent 的 token 与上下文消耗而不降低质量门禁。在开始或续接编码会话、规划多文件任务、执行测试与门禁、或用户询问 token 用量 / 成本 / 上下文优化时使用；也适用于 /token-efficiency 显式调用。Reduce AI coding-agent token consumption - context handoff, targeted reads, two-tier verification, one-shot generation, output discipline, model and cache strategy. Use when starting or continuing a session, planning multi-file work, running tests, or discussing token / cost / context optimization.
---

# Token Efficiency — AI 编程 Agent 省 token 纪律

工具无关。适用于 Claude Code、opencode、Cursor、Cline、Codex、WorkBuddy 等任何带文件读取与命令执行能力的编程 Agent。

## 铁律

**优化重复上下文与无效重试，绝不削减质量门禁。** 测试、覆盖率、类型检查、代码评审、验收清单、异常场景记录一律照跑。省的是流程开销，不是正确性。

## 何时启用

- 开始或续接一个编码会话、接手一个多文件任务
- 准备跑测试 / lint / 门禁，或刚遇到失败要重试
- 用户问 token 用量、成本、上下文窗口、会话过长
- 显式调用 `/token-efficiency`

## 1. 会话交接卡（最大杠杆，约 −25~35%）

- 每个工作单元（里程碑 / 特性 / 一轮重构）结束写一张 **≤500 行**的交接卡：改动文件、已定决策、未决项、下一步、已知坑。
- 新会话只读「交接卡 + 变更日志 + 本次目标文件」，**不重读全仓**。
- 会话超过约 50 轮、或上下文接近上限时，开新会话并写交接卡；无限长的会话里，历史重发成本会反超重新读仓库。
- 落点任选其一，保持单一来源：项目的 `HANDOFF.md`、`CHANGELOG.md`、记忆/日志目录、`AGENTS.md` 的交接小节。宿主若有 handoff / compact 类能力，优先复用。
- 交接卡只写增量，**不复制** spec、计划、ADR、commit、diff 里已有的内容，引用路径即可。

## 2. 禁读清单（约 −10~15%）

永远不要把下列内容整份放进上下文：

| 类别 | 典型文件 |
| --- | --- |
| 依赖锁文件 | `pnpm-lock.yaml`、`package-lock.json`、`yarn.lock`、`Cargo.lock`、`go.sum`、`uv.lock` |
| 生成物 / 缓存 | `dist/`、`build/`、`out/`、`coverage/`、`node_modules/`、`target/`、`.next/`、`test-results/`、大快照 |
| 二进制资产 | 模型、图片、音视频、`binaries/`、安装包 |
| 已被收敛的原始规则源 | 已汇总进 `AGENTS.md` / `CLAUDE.md` 的原始规则目录，不重复灌 |

锁文件常占全仓文本量的 1/4，误读一次的成本相当于几十次精准读取。用全仓 `Read`、递归 dump、无过滤的目录列举同样禁止。

## 3. 精准读取协议（约 −10~15%）

固定三步，**不要跳过前两步直接读整文件**：

1. `Glob` / 文件名检索 → 定位候选文件。
2. `Grep` 带行号、小 context（`-n`，`-C 2~5`）→ 定位符号与相关行。
3. `Read` 用 `offset` / `limit` 只读片段；长规范文档只读相关章节。

只带本次任务必需的契约、类型、配置片段。禁止「顺手看一下」式读取；禁止把整个大文件反复读入不同轮次。

## 4. 两级验证（约 −20~30%）

| 阶段 | 做法 |
| --- | --- |
| 开发期 | 只跑受影响的单文件 / 单包测试、定向类型检查；格式问题用 `lint --fix` / formatter 一次修完 |
| 提交前 | 完整门禁（lint + typecheck + test + audit + 边界检查）**只跑一次** |

失败时先读错误摘要、定向修复，不要立刻全量重跑。反复全量跑门禁是 token 消耗翻倍的首要原因。命令用宿主项目的实际脚本替换占位符，不臆造命令。

## 5. 一次成型（约 −15~25%）

- 先产出**字段级清单 / 验收清单**（输入项、按钮集、错误分支、验收断言），确认后再一次性生成代码 + 测试 + schema + 文档。
- 批量编辑、批量提交，避免逐文件小改往返。
- 重复骨架（三态、错误码、任务模板、异常清单、目录骨架）抽成**模板或脚手架脚本**，Agent 只写差异部分。
- 跨模块复用的逻辑上提到公共包，减少每个新功能的净新增行数。

## 6. 输出纪律（约 −5~10%）

- 只输出 diff、关键结论、未决项、表格；**不复述文件全文**、不重复粘贴规范全文（引用路径即可）。
- 报告用表格 / 短列表，一段一意。
- 长材料放 `references/` 按需加载（渐进式披露）：`SKILL.md` 自身也应保持精简，本文件即遵循此原则。

## 7. 模型与缓存

- 按难度选模型：检索、格式化、重命名、机械迁移用轻量模型；架构决策、跨包重构、疑难排错用强模型。
- 保持 system / 规范前缀稳定以命中提示缓存；避免每轮改写提示开头。
- 大范围探索交给子 Agent / 隔离上下文，只回传结论，不把探索过程带进主会话。

## 8. 反模式（明确禁止）

- 把仓库全量塞进上下文；每个任务开新会话且不带交接卡。
- 测试一失败就重跑全套门禁；靠反复重试代替阅读错误信息。
- 让 Agent 复述大文件、逐文件手工改格式。
- 为省 token 砍测试、覆盖率、验收清单或人工目视。

## 9. 每轮自检

- [ ] 本轮只读了必要文件，锁文件 / 生成物未入上下文？
- [ ] 沿用了交接卡或已有会话，没有重读全仓？
- [ ] 用的是定向验证，完整门禁留到提交前一次？
- [ ] 先有清单再一次成型，而非边问边改？
- [ ] 输出只有 diff + 结论 + 未决项？
- [ ] 质量门禁一项没打折？

## 10. 可复制的任务指令模板

```
遵循项目现有规则文件，不重复粘贴其全文。
范围：仅 <目标文件>；禁读 <锁文件> / <构建产物> / <生成物> / <大二进制> / <已收敛的原始规则目录>。
定位流程：文件名检索 → 带行号的内容检索 → 按 offset/limit 读片段。
先产出 <字段级清单 / 验收清单>，确认后一次性生成 代码 + 测试 + schema + 文档。
验证：开发期只跑 <定向测试 / 定向类型检查 / lint --fix>；提交前跑一次 <完整门禁>。
输出：只给 diff、关键结论、未决项，不复述文件全文。
```

## 11. 度量（可选）

粗估口径：`净交付行数 × 12~15 token/行 × 15~35（会话放大倍数）`。放大倍数来自代码重写、工具回显、测试日志与上下文重发。

跟踪三个指标即可：每个工作单元的**净新增行**、**全量门禁次数**、**失败重试次数**。优化目标是这三个数下降，而不是少写代码。

## 12. 兼容与安装

本文件遵循 Agent Skills 开放标准（`name` + `description` frontmatter，`name` 与目录名一致）。

| 工具 | 生效方式 |
| --- | --- |
| Claude Code | 放在 `~/.claude/skills/token-efficiency/SKILL.md`（用户级）或 `<repo>/.claude/skills/token-efficiency/SKILL.md`（项目级）；自动按 description 加载，或 `/token-efficiency` |
| opencode V1 | 自动扫描 `~/.claude/skills/`（Claude 兼容）、`~/.config/opencode/skills/`、`.opencode/skills/`、`.agents/skills/`；通过 `skill` 工具按需加载 |
| Cursor / Cline / Codex / WorkBuddy 等 | 把正文复制进 `AGENTS.md` / `CLAUDE.md` / `.cursor/rules/*.md` / 用户级规则文件；opencode 也可用 `opencode.json` 的 `instructions` 引用 |

**只保留一份同名 skill**：opencode 会扫描多个目录，同名重复会导致发现冲突。项目级共享时，删掉用户级副本或反过来。

验证：Claude Code 用 `/doctor`（含指令文件重复审计）；opencode 确认 skill 出现在 `<available_skills>` 列表里。
