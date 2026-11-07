# ICPC / CCPC 中国队史档案

把 ICPC 中国区域赛、EC-Final 与 CCPC 的历年参赛队伍汇总成一个可检索的静态网页：**学校、队名、队员、过题数、罚时、名次**，支持按赛季/赛事筛选、关键词搜索，以及单支队伍的生涯回看。

当前收录 **156 场比赛、47,036 条参赛记录、1,877 所学校**（ICPC 107 场 + CCPC 49 场，2009–2026）。

数据来自 [xcpcio/board-data](https://github.com/xcpcio/board-data)（MIT）。

## 在线页面

直接用浏览器打开 `docs/index.html`，或起一个静态服务器（浏览器对本地 `fetch` 有 CORS 限制，推荐后者）：

```bash
python -m http.server 8000 --directory docs
# 打开 http://localhost:8000
```

页面有三个视图：

- **队伍战绩**：按赛季/赛事筛选，搜索学校/队名/队员（空格分隔多关键词），点击任意一行查看该队的完整参赛历史。
- **学校总览**：各校出场次数、参赛队伍数、历史最佳名次。
- **队伍生涯**：按出场次数/最佳名次/累计过题排序，看哪支队伍参赛最久。

## 项目结构

```
scripts/
  fetch_data.py      从 xcpcio/board-data 拉取原始榜单 JSON（带缓存、重试、大小校验）
  build_dataset.py   计算名次/罚时，聚合成前端用的精简数据
  targets.json       要抓取的赛事列表
docs/
  index.html         页面
  style.css
  app.js             纯原生 JS，无构建步骤、无依赖
  data/              index.json（索引）+ rows-<赛季>.json（按季懒加载）+ careers.json（点开标签才下载）
raw/                 原始数据缓存（不入库，约 90 MB）
```

## 用法

```bash
# 1. 抓取原始数据（首次约 90MB，之后走缓存秒级完成）
python scripts/fetch_data.py

# 2. 生成前端数据
python scripts/build_dataset.py

# 3. 本地预览
python -m http.server 8000 --directory docs
```

## 数据口径

- **名次**：按 ICPC 规则重算 —— 过题数降序、罚时升序，同题同罚时并列。
- **过题数**：该队在该场比赛中 `ACCEPTED` 的不同题目数。
- **罚时**：每题首次通过的分钟数 + 20 × 通过前的错误提交次数，求和。
- **时间戳单位**：上游数据混用秒（早期）与毫秒（2020 后），构建脚本按最大值自动判别。
- **学校名**：新赛站存放在独立的 `organizations.json`，用 `organization_id` 关联；缺失学校或队名的记录会被丢弃（约 0.1%）。
- **非正式队伍**（打星、企业队等）保留并标注「非正式」。
- 世界总决赛不在收录范围（上游学校字段普遍缺失，且不属于中国赛区）。

## 已知限制

- 覆盖受上游数据限制：以 2009 年至今的中国赛站为主，早期赛站官方榜单多为 PDF/图片，未被收录。
- 同一队伍不同年份可能改名，页面按「学校 + 队名」聚合生涯，因此改名会拆成两条记录。
- 部分赛站缺少 run 数据，该场队伍过题数会显示为 0。

## 实现备注

本机环境访问 `github.com`（443）不稳定、`raw.githubusercontent.com` 与 `cdn.jsdelivr.net` 被重置，因此抓取走 `api.github.com` 的 **git blobs API**（`/contents` 对超过 1MB 的文件会返回空内容，不可用）。

## 许可

代码 MIT。数据来自 [xcpcio/board-data](https://github.com/xcpcio/board-data)，同样以 MIT 发布（Copyright © 2020-present XCPCIO），原始榜单版权归各赛事主办方所有。转载或再分发请保留出处与许可声明。
