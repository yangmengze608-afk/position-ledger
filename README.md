# Position Ledger · 公开持仓证据账本

线上站点：**https://position-ledger.vercel.app**

GitHub-backed 的公开持仓追踪站。核心不是“猜现在持有什么”，而是把公开披露拆成事件账本，再由代码推导当前状态。

## 当前架构

- **GitHub = canonical backend / 事实库**
  - `data/events.json`：唯一事实源；记录 `OPEN / ADD / HOLD / REDUCE / EXIT / DENY / HISTORICAL`
  - `data/holdings.json`：从事件账本推导出的当前状态
  - `data/raw_posts.json`：公开源帖子缓存
  - `data/review_queue.json`：待审核的自动分类候选
  - `data/market.json`：GitHub Actions 自动刷新的行情快照
- **Vercel = production frontend hosting**
  - 页面运行时直接读取 GitHub Raw 的 `data/*.json`
  - 前端没有数据库，也不保存第二份持仓事实
- **GitHub Actions = automation engine**
  - 公共 X 内容发现（X syndication → FxEmbed RSS → Nitter fallback）
  - 保守持仓分类
  - 原始证据与镜像证据 reconciliation
  - review PR / fallback issue
  - 行情刷新与数据校验

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
- pending 候选可以由更强规则 B→A 原地升级，但不会降级；
- secondary mirror 与原始 X 同一披露会升级证据，不重复 event；旧来源保存在 `sourceHistory`。

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
- B：语义很强，但不满足自动进入正式账本的证据门槛
- C：推断；不建议自动进入 Live

## 部署

生产站点部署在 Vercel：

```text
https://position-ledger.vercel.app
```

GitHub Pages workflow 保留为**手动备用**。新仓库首次启用 Pages 属于 repository-admin 设置，当前 GitHub Actions token 无权自行完成，因此不再让 Pages 在每次 main push 时制造无意义的失败状态。

## 本地运行

```bash
python3 -m http.server 4173
```

仅用于研究与信息整理，不构成投资建议。
