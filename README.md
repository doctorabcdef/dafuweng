# 大富翁 · 环球旅行

支持手机和电脑的中文网页大富翁，2–4 人轮流操作。32 格世界棋盘、20 处国家地产，包含买地、收租、同色地块建房、抵押、赎回、奇遇、监狱与破产胜负。

## 动物角色与游戏效果

- 开局可以从 16 种动物中选择角色；对局中点击玩家头像也能更换，云端会保存选择。旧存档自动显示默认动物，进度继续保留。
- 每次掷骰会播放双骰翻滚和碰撞音效，动物棋子按点数逐格前进；奇遇与监狱转移单独显示。
- 买下地产后，对应国家出现房屋图标；建房升级后显示等级，抵押后图标变灰。
- 右上角“声音开 / 关”控制掷骰、走棋和买房音效，浏览器会记住设置。音效在玩家点击后启用，无须下载音频。
- 动画播放前已保存最终进度，因此动画中刷新仍能恢复完整结果；系统开启减少动态时直接显示结果。

网页地址：<https://doctorabcdef.github.io/dafuweng/>

本仓库的线上版本已接入 Supabase 云存档，新对局默认选择云端。第一次换设备时打开“分享对局”生成的完整链接，之后每台设备直接打开首页就会恢复该设备上次进入的对局。已有本机对局点击“分享对局”即可保留进度转入云端。

## 保存和跨设备续玩

- **本机对局**：每次操作自动保存到当前浏览器，再次打开自动恢复。清除网站数据、无痕模式、换浏览器或设备无法恢复本机存档。
- **云端对局**：需要完成下方 Supabase 配置。每次操作成功写入云端后才更新棋盘；多个设备每 3 秒同步。断网时保留最近确认的画面并暂停操作，恢复后读取最新进度。
- **新设备第一次进入**：在原设备点击“分享对局”，用完整链接在新设备打开。此后该设备直接打开首页也会恢复上次对局，无须再次粘贴链接。
- 已经开始的本机对局也可以续用：配置云端后点击“分享对局”，会将当前进度原样转入云端并生成链接。
- 新对局仅在明确点击“开始新对局”后创建。已有云端对局仍可从原链接进入；开始本机新对局会替换本机存档。

这是朋友之间共享操作的棋盘：所有拿到链接的人都能操作当前回合，没有账号或独占玩家席位。不要公开分享私人对局链接。

## 云端初始化（部署副本时使用）

GitHub Pages 只托管静态网页，不运行数据库。没有配置 Supabase 时网页仍可游玩，但**只能本机保存，尚不能跨设备同步**。

1. 创建或选择一个 [Supabase 项目](https://supabase.com/dashboard)。
2. 在 SQL Editor 执行仓库内完整的 [`supabase/schema.sql`](supabase/schema.sql)。脚本可以重复执行，不会清空已有对局。
3. 在项目连接信息中复制 **Project URL** 和 **publishable key**（`sb_publishable_...`，或旧版 `anon` key）。不需要开启匿名登录、Realtime 或公开读写表权限。
4. 在 GitHub 仓库 **Settings → Secrets and variables → Actions → Variables** 增加两个 Repository variables：

   | 名称 | 值 |
   | --- | --- |
   | `SUPABASE_URL` | `https://你的项目.supabase.co` |
   | `SUPABASE_ANON_KEY` | 公开 publishable key 或旧版 anon key |

5. 在 **Actions → Deploy game to GitHub Pages → Run workflow** 重新部署。这样所有设备自动获得相同云端配置。
6. 打开网页，选择“开始新对局”并选“云端对局”。通过分享链接跨设备加入。

也可以在网页右上角设置中临时填写 URL 和公开密钥进行调试；这种方式需要在每台设备分别填写。推荐使用上面的仓库变量配置。`service_role` 和 `sb_secret_...` 密钥不能放在网页、仓库、对局链接或公开变量里。

数据库使用 256 位随机房间密钥，链接中的密钥只放在 URL fragment；数据库仅保存 SHA-256 哈希。底层表禁止客户端直接访问，仅三个 RPC 允许凭房间密钥操作。保存时锁定该行并检查 revision，版本冲突会读取最新进度并让玩家重新操作。房间链接持有者受信任；规则与骰子在浏览器运行，不具备竞技防作弊能力。创建接口面向公开客户端，生产使用请在 Supabase 控制台关注配额与异常请求。

### 数据库权限审查

线上已验证 `anon` 与 `authenticated` 均无底层表读写权限，云端 RPC 正确拒绝错误密钥和旧版本写入。Supabase Advisor 的“RLS 无策略”和“公开可执行 SECURITY DEFINER”提示属于本应用有意的链接授权设计：私有表默认拒绝所有客户端访问，三个公开 RPC 用完整密钥校验授权，固定 SQL 仅操作对应房间且设置空 `search_path`。请勿为消除提示而给表添加全公开策略。[RLS 提示说明](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)、[匿名 RPC 审查](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)、[已登录角色 RPC 审查](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)。

## 玩法

每位玩家初始资金 ¥15,000。掷两颗骰子前进，路过起点获得 ¥2,000；踩到空地可购买，踩到别人未抵押的地产支付租金。凑齐同色地块后可以建房，最多三级。点自己的地块管理资产；抵押时建筑按半价出售，抵押地块不收租。现金为负时先抵押筹款，或宣布破产。最后一位未破产的玩家获胜。

本版本采用简化聚会规则，无拍卖、交易或 AI 玩家。坐牢最多跳过两回合，也可以掷出双数离开，或在掷骰前支付 ¥500 保释。

## 本地运行与验证

需要 Node.js 24+：

```sh
npm ci
npm start
```

打开 <http://127.0.0.1:4173>。

```sh
npm test
npm run build
npm run test:browser
```

单元测试覆盖规则、存档协议与 PGlite PostgreSQL 数据库权限/版本冲突。浏览器测试覆盖刷新恢复、移动端布局、模拟两设备同步与断网恢复；模拟云端测试不等于实际 Supabase 已部署。Windows 浏览器测试优先使用已安装的 Edge；其他系统先运行 `npx playwright install chromium`。

`npm run build` 生成 `dist/`。GitHub Actions 在推送到 `main` 时运行测试、构建并部署 GitHub Pages。首次启用 Pages 时需在仓库 **Settings → Pages → Source** 选择 **GitHub Actions**。

## 项目结构

- `src/game.js`：可序列化的纯函数游戏规则。
- `src/app.js`：棋盘、自动恢复、分享、同步与冲突处理。
- `src/persistence.js`：安全读取本地存档、房间密钥与云端 RPC。
- `supabase/schema.sql`：云端存档与权限。
- `.github/workflows/pages.yml`：测试与部署。

官方参考：[GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)、[Supabase API 密钥](https://supabase.com/docs/guides/getting-started/api-keys)、[数据库函数权限](https://supabase.com/docs/guides/database/functions)。
