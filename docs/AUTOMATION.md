# V2 自动持仓发现流水线

## 目标

把公开 X 内容变成一个**可审计的候选事件 PR**，而不是让模型直接改正式持仓。

```text
X public timeline
  -> raw_posts.json
  -> conservative rules
  -> review_queue.json
  -> optional LLM review
  -> high-confidence proposed events
  -> rebuild holdings.json
  -> GitHub PR
  -> HUMAN MERGE
  -> main becomes canonical state
```

## 数据边界

- `data/raw_posts.json`：只存已经发现的公开原帖最小字段，避免每次点赞数变化制造无意义 diff。
- `data/review_queue.json`：候选披露与证据，`pending` 不会进入正式账本。
- `data/events.json`：唯一正式事件账本。自动化只能在 bot PR 中提议修改。
- `data/holdings.json`：由 `events.json` 生成，禁止人工维护。

## 免费默认采集

默认使用 X 的公开 syndication timeline endpoint。它无需登录，但属于非正式公开端点，可能限流或改变结构。因此采集器是可替换层；后面的分类、审计和 PR 审核不依赖它。

Serenity 配置在 `data/source_accounts.json`，当前 handle 为 `aleabitoreddit`，并启用 replies，因为很多明确持仓披露发生在回复里。

## 分类策略

规则层只自动提议强第一人称表达，例如：

- `I bought ...` -> OPEN
- `I added ...` -> ADD
- `I still have/hold ...` -> HOLD
- `I trimmed/sold some ...` -> REDUCE
- `I sold/exited/no longer hold ...` -> EXIT
- `I don't hold ...` -> DENY

单纯看好、讨论、研究、推荐 ticker 不算持仓。

## AI 层（可选）

GitHub Models 已退休，所以 V2 不依赖它。若要启用模型复核：

Repository Secret:
- `LLM_API_KEY`

Repository Variables:
- `LLM_MODEL`（必须）
- `LLM_BASE_URL`（可选，默认 `https://api.openai.com/v1`）

AI 只复核模糊候选；即使模型判定为明确持仓，也仍然只能写进 PR，不会自动 merge。

## 审核纪律

`discover-positions.yml` 每小时第 17 分运行一次。如果已有 `bot/position-discovery` PR 未处理，本轮直接跳过，避免堆叠重复 PR。

**Merge PR = 人工批准。** 这是 V2 的关键安全边界。
