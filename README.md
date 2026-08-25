# Position Ledger · 公开持仓证据账本

正式站点：**https://yangmengze608-afk.github.io/position-ledger/**

GitHub 原生的公开持仓追踪站。核心不是“猜现在持有什么”，而是把公开披露拆成事件账本，再由代码推导当前状态。

## 当前架构

- **GitHub = canonical backend / 事实库**
  - `data/events.json`：唯一事实源；记录 `OPEN / ADD / HOLD / REDUCE / EXIT / DENY / HISTORICAL`
  - `data/holdings.json`：从事件账本推导出的当前状态
  - `data/raw_posts.json`：公开源帖子缓存
  - `data/review_queue.json`：待审核的自动分类候选
  - `data/resolutions.json`：需要人工实体判断时的可审计裁决记录
  - `data/market.json`：GitHub Actions 自动刷新的行情、正确前一交易日收盘与披露价格锚点
- **GitHub Pages = production frontend hosting**
  - 正式站点与 `main` 仓库一一对应
  - 不再把 Vercel 作为 production host
- **GitHub Actions = automation engine**
  - 公共 X 内容发现（X syndication → FxEmbed RSS → Nitter fallback）
  - 保守持仓分类
  - 原始证据与镜像证据 reconciliation
  - review PR / fallback issue
  - 人工 resolution 应用
  - 行情刷新、披露后表现计算与数据校验
  - GitHub Pages 自动发布

## 状态纪律

- `live`：最近可靠证据明确支持当前在持
- `unconfirmed`：只能证明历史上建过仓，不能证明现在仍持有
- `archive`：明确 EXIT
- `denial`：明确 DENY
- 长期没提不会自动推断为 EXIT

## 自动发现纪律

自动化可以发现和**提议**事件，但不能自动把持仓 claim 合并进 canonical ledger。

高置信度事件进入 `bot/position-discovery` review branch；人工合并 PR 才算批准。仓库若阻止 GitHub Actions 自动创建 PR，workflow 会降级为 review issue，而不是静默丢失审核请求。

当前分类器额外处理：

- ticker-local evidence binding，避免把远处的 “I have” 错绑到其他 ticker；
- 明确多股票操作列表，例如 `I added to the following stocks:`；
- 亚洲数字证券代码通过经过核验的 security alias catalog 解析；
- 公司名称与原帖数字代码冲突时 fail closed，不能自动晋级；
- pending 候选可以由更强规则 B→A 原地升级，但不会降级；
- secondary mirror 与原始 X 同一披露会升级证据，不重复 event；旧来源保存在 `sourceHistory`。

## 人工实体裁决

对于“持仓动作很明确，但证券身份有冲突”的案例，使用 `data/resolutions.json` 记录：

- accept / reject
- 最终 ticker
- 置信度
- 理由
- 外部核验来源
- 裁决时间

`scripts/apply_resolutions.py` 会幂等地将批准项写入 canonical events、更新 review queue，并重建 holdings。

Walsin 是首个实际案例：原帖写 `Walsin (2494)`，官方材料确认 Walsin Technology 为 `2492.TW`，因此人工解析为 `2492 · ADD · B`，同时保留原始 `2494` mismatch 审计痕迹。

## 行情与“披露后表现”

`data/market.json` 不保存投资者成本价。它保存：

- 当前市场价
- 正确的前一有效交易日收盘
- 首次公开披露锚点
- 最近持仓动作锚点
- 从这些公开市场锚点到当前价格的表现

“披露后 +X%”表示**公开披露日期对应交易日调整后收盘价 → 当前价**，不是 Serenity 的真实成本收益率。

披露发生在周末或休市日时，锚点使用下一有效交易日；日期按对应交易所时区匹配。

## GitHub 后端

前端配置指向：

- owner: `yangmengze608-afk`
- repo: `position-ledger`
- branch: `main`
- data: `data/*.json`

## 新增事件

手工编辑 `data/events.json` 后运行：

```bash
python3 scripts/rebuild_holdings.py
python3 scripts/validate_data.py
```

## 置信度

- A：第一手原文直接说买入 / 持有 / 加仓 / 减仓 / 卖出 / 没持有
- B：语义很强但需要额外实体解析，或不满足自动晋级门槛
- C：推断；不自动进入 Live

## 部署

生产站点由 `.github/workflows/deploy-pages.yml` 发布到 GitHub Pages：

```text
https://yangmengze608-afk.github.io/position-ledger/
```

`main` 的前端或 `data/**` 更新都会触发 Pages 发布，因此线上版本与 GitHub canonical repository 保持同步。

## 本地运行

```bash
python3 -m http.server 4173
```

仅用于研究与信息整理，不构成投资建议。
