# 个人主页：按发表年份筛选论文并自动更新

本工程基于本次提供的桌面 `index.html`，自动检索论文并沿用原有论文卡片样式。筛选条件已改为：**LetPub 展示的发表当年中科院升级版大类一区/二区，或当年适用 CCF A/B；会议还须确认为 Full/Regular paper**。两条条件为“或”，满足任一条即可。

## 本次完成结果（2026-10-10）

查询 ORCID、Crossref，取得 23 条可核实作者身份的正式发表记录。按标题及 DOI 排除主页已有论文后，共自动新增 3 篇，主页由原始 12 篇变为 15 篇。本次切换分区依据后，增加了下表第三篇：

| 新增论文 | 发表年 | 等级依据 |
| --- | --- | --- |
| Cobweb Privacy: A Novel Mechanism for Comprehensive Association Privacy Protection in Data Aggregation | 2026 | TDSC，CCF A，2026 版目录 |
| Differentially Private Non-Negative Consistent Release for Large-Scale Hierarchical Trees | 2024 | TDSC，CCF A，2022 版目录 |
| Efficient Vertical Federated Learning Method for Ridge Regression of Large-Scale Samples | 2023 | TETC，LetPub 中科院 2023 年 12 月升级版大类计算机科学二区 |

原有论文条目保持人工维护，包括原有插图、下载链接及等级标注。本次限制适用于自动新增条目。新增插图为明确标注“非论文原图”的通用示意图。

`Distilling Knowledge Based on Curriculum Learning for Temporal Knowledge Graph Embeddings` 已通过 ACM 官方目录确认属于 **Short Research Papers**，因此未按 CCF B 正式长文加入。

其余 10 篇新增候选记录保存于 `data/pending-publications.json`。其中包括需要确认正式长文类型的 KDD 2026 论文，以及缺少发表当年 LetPub 中科院大类分区证据的期刊论文。全部检索结果及判定依据保存在 `data/publications.json`。

## LetPub 分区来源与历史年份

`scripts/letpub-rankings.mjs` 自动按 ISSN 搜索 LetPub、核对完整期刊名、读取公开历史分区表，并保存到 `data/letpub-rankings.json`。已取得当前检索涉及的 7 本期刊的 2023、2025 年升级版大类数据。页面隐藏的分区数字和嵌套小类表不会被计入。

**只用发表年份相同的中科院大类分区。** LetPub 同页展示的 2026 新锐分区、JCR Q1/Q2、CiteScore 和小类分区均不会满足这条条件。当前公开页缺少部分历史年份，不能把 2025 年数据套用于 2026 年，也不能把 2023 年数据套用于 2020、2017 年；这些记录继续待核验。

公开页面不可用或解析不明确时，记录警告并保留已核实的历史缓存；成功读到的对应年度记录会更新，并重新筛选自动卡片。新期刊优先通过 ISSN 和完整期刊名匹配，匹配不唯一或未找到时不推测。可将另行核实的 LetPub 年度证据补入同一文件，例如：

```json
[
  {
    "journal": "期刊完整英文名称",
    "issns": ["1234-5678"],
    "year": 2024,
    "quartile": 2,
    "categoryType": "major",
    "category": "Computer Science",
    "rankingSystem": "CAS",
    "platform": "LetPub",
    "edition": "2024年升级版",
    "verified": true,
    "source": "https://www.letpub.com.cn/对应期刊的年度查询证据地址",
    "checkedAt": "2026-10-10"
  }
]
```

必须核实具体年份、升级版及**大类**分区，来源须为 LetPub 官方域名。新增年度数据后重新同步，符合条件的待核验论文便会自动加入。旧的 `data/xr-rankings.json` 已移除，脚本不再读取它。这里展示的是数据格式，占位示例不参与筛选。

CCF 会议的正式长文证据放在 `data/paper-types.json` 中，以小写 DOI 为键，字段为 `type`（`full`、`regular` 或 `short`）、`verified`、`source`、`evidence`。只有明确核实的 `full` / `regular` 能通过；未来首次遇到的会议论文在类型不明时先待核验。

## 启用每天自动更新

1. 将本工程全部内容提交到 GitHub Pages 仓库默认分支，包含隐藏目录 `.github/workflows`，以及 `scripts`、`data`。保留仓库原有的 `pic` 目录与自定义域名 `CNAME` 文件。当前提供的是单个 HTML，未附带头像文件，工程仍沿用原来的 `pic/scholar.png` 地址及缺图占位逻辑。
2. 在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
3. 确保仓库策略允许工作流写入仓库。工作流声明了 `contents: write`、`pages: write` 和 `id-token: write` 权限。
4. 在 **Actions → Update qualified publications and deploy homepage → Run workflow** 手动运行一次。

工作流每天北京时间 **10:20 左右**执行；GitHub 的定时调度可能延迟。流程会检索、筛选、提交结果并部署 GitHub Pages。尚未上传到 GitHub 或启用工作流时，只打开本地 HTML 不会启动后台定时任务。

## 年份和判定规则

- 作者由 ORCID `0000-0003-4798-082X` 确认，不依靠同名关键词放行。
- Crossref 搜索出版社关联该 ORCID 的作品，ORCID 公开作品列表补充 DOI；支持分页和请求重试，无需 npm 依赖。
- 期刊优先使用已经正式发表的纸本/卷期日期；没有可用卷期日期时使用在线发表日期。预印本及尚未发表的未来日期记录被排除。
- CCF 使用发表年份适用的目录版本。本工程存有从 2022、2026 目录提取的可匹配条目；2023–2025 年使用 2022 版，2026 年使用 2026 版。未匹配条目、缺失年份及 2027 年以后的记录保持待核验，补入适用目录后再放行。
- 等级数据有来源及原 PDF 页码，新增卡片中可点击查看依据。判断逻辑不会根据影响因子、标题、出版社或主页旧标签推测等级。
- 按 DOI 和归一化标题去重，按年份倒序排列，同一年人工精选条目在前。
- 两个检索入口都失败时不修改文件；部分入口失败时保留缓存并记录警告。已有自动记录每次重新判级，资格被撤销后会从自动卡片移除，人工条目保留。

## 第一作者与通讯作者的姓名样式

本人姓名在第一作者或已确认的通讯作者身份下显示为**红色加粗**（`#c62828`），鼠标停留可查看身份。该规则适用于现有人工卡片和未来符合等级要求的自动卡片。其他合作者姓名不受影响；本人作为普通合作者时保留原有深色加粗样式。

- 第一作者：自动检索记录按已核实作者列表顺序判断；现有人工卡片按原作者顺序判断。
- 通讯作者：现有主页中本人姓名带 `*` 且该论文明确标注 `Corresponding Author` 的条目沿用既有标记。不能仅凭末位作者、邮箱或普通星号猜测通讯身份。
- 自动检索源不保证提供通讯身份。新论文须取得明确通讯证据后，在 `data/author-roles.json` 中补充对应 DOI；后续同步会自动应用并保留。支持共同第一作者的明确记录。

```json
[
  {
    "doi": "10.xxxx/真实论文DOI",
    "corresponding": true,
    "verified": true,
    "source": "user-confirmed",
    "evidence": "作者本人确认，或填写出版方通讯作者证据"
  }
]
```

`firstAuthor: true` 可用于已核实的共同第一作者；身份记录也可用完整 `title` 匹配。`verified: false` 不生效。已确认不是通讯作者可使用 `corresponding: false`，显式记录优先于原主页标记。以上占位示例不参与筛选。身份数据只改变姓名样式，不改变 LetPub/CCF 的论文收录条件。

## 本地运行和核验

安装 Node.js 22 或更高版本，在工程目录运行：

```sh
node --test scripts/*.test.mjs
node scripts/sync-publications.mjs --dry-run
node scripts/sync-publications.mjs
```

`--dry-run` 只报告预计变化。`publications.config.json` 可设置排除 DOI（`excludeDois`）。提交更新后的年度等级文件后，工作流也会重新执行筛选。

已经加入的自动卡片如需人工更换插图或维护内容，可删除其 `data-auto-publication` 属性，将其转为人工卡片。

## 来源

- [LetPub TETC 历年大类分区](https://www.letpub.com.cn/index.php?journalid=10210&page=journalapp&view=detail)
- [LetPub 期刊查询](https://www.letpub.com.cn/index.php?page=journalapp)
- [CCF 官方目录及会议论文类型说明](https://www.ccf.org.cn/Academic_Evaluation/By_category/)
- [CCF 2026 正式目录](https://www.ccf.org.cn/ccf/contentcore/resource/download?ID=112CF3BF7E1140ACEB271ADAED12A67ADFABB8FF099E40C2759502A85C8A281F)
- [CCF 2022 目录 PDF 存档](https://shuhaoliu.github.io/assets/sharing/ccf-2022.pdf)
- [ACM CIKM 2024 官方目录](https://www.sigweb.hosting.acm.org/toc/cikm24.html)
- [Crossref 元数据接口](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)
- [GitHub Pages 工作流设置](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
