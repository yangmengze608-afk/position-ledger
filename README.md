# Position Ledger · 公开持仓证据账本

GitHub-backed 的公开持仓追踪站。核心不是“猜现在持有什么”，而是把公开披露拆成事件账本，再由代码推导当前状态。

## 架构

- `data/events.json`：唯一事实源；记录 `OPEN / ADD / HOLD / REDUCE / EXIT / DENY / HISTORICAL`
- `scripts/rebuild_holdings.py`：从事件账本生成 `data/holdings.json`
- `data/market.json`：行情快照，由 GitHub Actions 定时更新
- `index.html + app.js + styles.css`：纯静态前端，无框架运行时依赖
- `.github/workflows/`：数据校验、行情刷新、GitHub Pages 部署

## 状态纪律

- `live`：最近可靠证据明确支持当前在持
- `unconfirmed`：只能证明历史上建过仓，不能证明现在仍持有
- `archive`：明确 EXIT
- `denial`：明确 DENY
- 长期没提不会自动推断为 EXIT

## GitHub 后端

`config.js` 已预设：

- owner: `yangmengze608-afk`
- repo: `position-ledger`
- branch: `main`

前端优先从 GitHub Raw 读取 `data/*.json`；远端读取失败时自动回退到同站点静态数据。

## 新增事件

编辑 `data/events.json` 后运行：

```bash
python3 scripts/rebuild_holdings.py
python3 scripts/validate_data.py
```

## 置信度

- A：第一手原文直接说买入 / 持有 / 卖出 / 没持有
- B：语义很强，但不是直接账户状态句
- C：推断；不建议自动进入 Live

## 当前种子数据

当前只加入少量公开披露作为结构种子，并严格区分“明确当前在持 / 历史建仓 / 明确否认”。现阶段证据链接使用公开镜像页作为过渡，下一阶段应逐条替换为原始 X 帖子 URL。

## 本地运行

```bash
python3 -m http.server 4173
```

仅用于研究与信息整理，不构成投资建议。
