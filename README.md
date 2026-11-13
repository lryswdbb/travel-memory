# 我们的旅行记忆 🌍

一个把旅行照片按地理位置归档的互动网站：从星际穿梭动画抵达一颗**可拖拽旋转、
滚轮缩放的卫星视角地球**，在可点击的地图上一级一级下钻（世界 → 国家 → 省/州 → 城市/县），
为每个地点收藏照片；照片按拍摄日期排成时间线，还有足迹统计总览页。
照片墙背景自动换成当地的标志性景观。

支持**用户名 + 密码注册登录 + 云端共享房间**：创建房间、设定房间密码，
家人输同一密码加入后，大家在同一张地图上共同积累旅行记忆；
所有照片还能用**走马灯**模式浏览——自动滚动、鼠标拖拽甩动、按日期筛选。
不登录也完全可用（个人模式，照片存本机）。

## 运行

方式一（推荐）：
```bash
node server.js
# 打开 http://localhost:8000
```

方式二：直接双击 `index.html`
（地图数据已全部本地化，可离线运行；仅照片墙的地标背景图需要联网，
失败时自动回退为渐变背景，不影响使用。）

## 玩法

1. **封面** —— 「点击进入」开始星际旅行（动画中点击画面或按空格/回车可跳过）
2. **抵达地球** —— 穿梭结束后停在一颗卫星实拍质感的地球上：**按住拖动旋转、滚轮（或双指捏合）缩放**，
   松手后带惯性滑行；点「进入地图」或双击画面进入地图
3. **世界地图** —— 点击 **中国** / **美国** 进入省州/州县下钻；点击其他国家
   （日本/法国/泰国/加拿大…约 210 国）进入该国**省/州级地图**；无省级数据的迷你国家直接进照片墙
4. **中国** —— 点击省份进入该省城市地图，再点击城市进入照片墙
5. **美国** —— 点击州进入县（County）地图，再点击县进入照片墙
6. **其他国家** —— 点击省/州板块进入照片墙；悬停和照片墙标题显示中文名（如 Kyoto · 京都府）
7. **照片墙** —— 「+ 添加照片」或直接把图片拖进页面上传；照片按拍摄日期分成月份时间线，
   左上角有日期角标；点击照片看大图，**←/→ 键或两侧按钮翻页**，✕ 删除，✎ 改备注/日期；
   <br>**实况照片 (LIVE)** —— 一次选中同名的 `IMG_1234.JPG` + `IMG_1234.MOV`（iPhone 导出实况照片的
   标准形式），会自动配对成一张实况记忆：卡片左上角显示 LIVE 角标，桌面**鼠标悬停即播放**、
   移开回到静图，手机上**点 LIVE 角标**播放/暂停，点开大图则自动循环播放
   <br>**存入位置** —— 照片按「地图当前停在哪一层」归档。上传弹窗顶部会明确显示「存入位置」，
   位置不对请先返回地图点到正确的地方再上传
   <br>**GPS 自动归位** —— 照片自带 GPS 坐标时（手机拍的多数都有），上传会先读出拍摄地，
   弹窗里提示「识别到拍摄地是 山东 · 青岛市」，默认按拍摄地归档；
   一次选中多个地方的照片，会**按各自 GPS 分别存进对应地点**。不想用时选「还是存到当前位置」即可
   <br>**导出备份 ⬇** —— 照片墙的 ⬇ 打开导出：把照片按「地点/日期_备注.jpg」整理好，
   连同 `backup.json`（地点、备注、拍摄日期）打包成一个 ZIP 下载，或逐个文件保存。
   清缓存、换设备、云端额度用尽时，这份备份能把记忆找回来
   <br>**整理位置 ⇄** —— 已经归错地点的照片不用重新上传：点照片墙的 ⇄ 打开「整理照片位置」，
   从下拉框里选一个已有照片的地点（或手动填 key），整个地点的照片会搬过去。
   搬家只改归属、不动文件，地图金色高亮和足迹统计会跟着刷新
8. **足迹** —— 地图页右上「足迹」进入统计总览：照片/国家/省份/城市计数、点亮的世界地图、记忆最多的地方排行
9. **走马灯 🎞** —— 地图页或照片墙点 🎞：三行照片错速自动滚动；
   **鼠标按住拖动**可拉动，快速甩动松手带惯性滑行；悬停暂停；点击照片进大图；
   上方筛选 **全部 / 今天 / 本周 / 本月 / 有日期**，或选一个具体日期直接跳转
10. **登录 / 房间** —— 需先按下面「云端配置」完成一次性设置。封面「登录 / 房间」：
    输入用户名 + 密码 → 「创建账号并开始使用」；登录后地图右上角房间栏解锁：
    创建房间（房主设密码）或搜索加入（输房间密码）；进房后地图与照片墙
    自动切换为房间共享数据，成员上传照片**实时同步**给彼此
11. 已有照片的地区在地图上会以 **金色** 高亮，tooltip 显示照片数量
12. 手机上同样可用：地图点按、照片墙单列时间线、地球双指缩放、走马灯两行滚动

## 云端配置（Supabase，一次性）

个人模式**不需要**任何配置即可使用。要启用登录与共享房间，按以下步骤设置一个免费的
[Supabase](https://supabase.com) 项目（建议选新加坡区域，大陆一般可直连）：

1. **建项目**：Dashboard → New project → 区域选 Singapore。建好后到
   **Project Settings → API**，复制 `Project URL` 和 `anon public` key，
   填入 `js/config.js` 里的两个占位符。（anon key 是公开密钥，可安全提交，数据安全靠 RLS）
2. **关闭邮箱确认（关键）**：**Authentication → Sign In / Up → Email**，
   把 **Confirm email** 开关**关掉**并保存。
   本站用「用户名 + 密码」注册登录（用户名内部派生成账号，不发任何邮件），
   开着邮箱确认会导致注册后拿不到会话、无法登录。
3. **回调地址**：**Authentication → URL Configuration**，Site URL 填你的 Pages 域名
   （如 `https://<用户名>.github.io/travel-memory/`），Redirect URLs 再加一条 `http://localhost:8000` 便于本地测试。
4. **建表**：**SQL Editor** → New query → 把 `supabase/schema.sql` 全文粘贴 → Run。
   这一步创建 rooms / room_members / photos 三张表、行级安全策略、
   四个 RPC 函数、Realtime 发布，以及私有存储桶 `room-photos`。
   <br>**已有项目升级**：如果之前已经跑过旧版 schema，改跑 `supabase/migrate_live_photo.sql`
   （给 photos 加 `video_path` 列、放行视频上传、注销时连带删视频），不要重复跑整个 schema。

完成后刷新网站，房间栏就会出现「登录 ▾」。Supabase 客户端已**自托管**在 `assets/supabase.min.js`
（不再依赖 jsdelivr，大陆网络更稳）；仅当该文件缺失时才会回退到 CDN。
配置未填或云端连不上时，网站退回纯个人模式，并在页面底部提示「⚠ 云端未连接」，
房间照片不会丢，联网后刷新即可。

## 数据存储

- **个人模式**：照片本体存在浏览器 **IndexedDB**（本地，不上传任何服务器），上传时自动压缩到最长边 1600px
- **实况照片**：静态帧与普通照片一样压缩成 JPEG；动态部分（MOV/MP4）**原样保存**，不做转码。
  单个视频上限 60MB，超出则退化为普通照片。iPhone 的实况视频多是 HEVC 编码，
  Chrome/Android 可能解不了——解不了时卡片自动回退成静图，不会报错
- **房间模式**：照片上传到 Supabase 私有存储桶（每张压缩后约 300KB，免费 1GB ≈ 3000+ 张），
  实况视频另存为 `<room_id>/<photo_id>.mp4`（体积通常是照片的 1~2 倍）；
  元数据（地点/日期/备注/上传者/视频路径）存 Postgres；成员浏览时经权限校验下载，并缓存在本机 IndexedDB
- 房间密码只保存 SHA-256(随机盐+密码) 的哈希在服务端，比对在数据库函数内完成，任何人（包括站长）都拿不到明文
- 「哪些地点有记忆」的索引存在 localStorage，用于地图高亮
- 清空浏览器数据 = 清空个人照片（房间照片在云端不受影响），重要照片请自行备份原图
- 想更省云端空间：把 `js/gallery.js` 里 `shrink()` 的 `MAX = 1600` 调小（如 1280），单张体积约减半

## 目录结构

```
travel-memory/
├── index.html            # 单页应用入口（封面/穿梭+地球/地图/照片墙/足迹/登录/走马灯 七个场景）
├── server.js             # 本地静态服务器
├── css/style.css
├── js/
│   ├── main.js           # 流程控制 + 封面星空
│   ├── config.js         # Supabase URL / anon key（云端配置时填写）
│   ├── warp.js           # 星际穿梭 + 抵达态可交互地球（three.js：拖拽旋转/滚轮缩放）
│   ├── map.js            # 多级地图（echarts：世界/中国省市/美国州县/全球省州）
│   ├── gallery.js        # 照片墙 + 日期时间线 + 大图翻页 + IndexedDB 存储 + 上传压缩 + 实况照片配对/播放 + 后端抽象
│   ├── auth.js           # 用户名 + 密码登录（Supabase，用户名派生账号，无邮件依赖）
│   ├── rooms.js          # 云端房间：创建/加入/退出、房间栏、照片云同步（Realtime + 轮询兜底）
│   ├── carousel.js       # 照片走马灯：三行错速滚动、拖拽甩动、日期筛选
│   ├── stats.js          # 足迹统计总览页
│   ├── exif.js           # 读照片 EXIF 里的 GPS 坐标（纯前端，无依赖）
│   ├── geolocate.js      # 坐标 → 地点 key（点在多边形内判定，与地图层级一致）
│   ├── export.js         # 导出备份：打包 ZIP / 逐文件下载 + backup.json
│   └── landmarks.js      # 各地标图片清单（Wikimedia Commons）
├── supabase/
│   ├── schema.sql        # 云端数据库结构（新项目一次性运行）
│   └── migrate_live_photo.sql  # 已有项目升级到实况照片支持的迁移脚本
├── assets/               # three.js / echarts / topojson 库 + 地球贴图
├── data/js/              # 全部地图边界数据（已转成 .js，双击 html 也能用）
│   └── prov_<iso>.js     # 全球 239 国省/州边界（map.js 按需懒加载；prov_index.js 为名称索引）
└── tools/                # 本地开发/测试脚本（headless 冒烟测试与截图，不参与产品运行）
    ├── build_provinces.js # Natural Earth → prov_*.js 一次性构建脚本
    ├── test_live_photo.js # 实况照片冒烟测试（node tools/test_live_photo.js）
    ├── test_move_photos.js # 照片整理（搬家）冒烟测试（node tools/test_move_photos.js）
    ├── test_export.js     # 导出备份测试：ZIP 结构/CRC/backup.json（node tools/test_export.js）
    ├── test_gps.js        # GPS 读取与自动归位测试（node tools/test_gps.js）
    ├── test_scene_and_source.js # 场景切换 / 数据来源 / 云端掉线提示（node tools/test_scene_and_source.js）
    └── cleanup_diag_accounts.js # 清理测试用临时账号与房间（node tools/cleanup_diag_accounts.js <用户名...>）
```

## 数据来源

- 世界/中国边界：Apache ECharts 4 地图数据、阿里云 DataV.GeoAtlas（省市县级）
- 美国州/县边界：us-atlas（TopoJSON）
- 全球各国省/州边界：Natural Earth 10m admin-1（`tools/build_provinces.js` 一次性构建为
  `data/js/prov_<iso>.js` 懒加载文件 + `prov_index.js` 索引，原始 zip 在 `data/raw/` 不入库）
- 地标照片：Wikimedia Commons（`Special:FilePath` 直链）
- 地球贴图：three.js 官方示例纹理

## 部署到 GitHub Pages

全站是纯静态资源、无构建步骤、无绝对路径引用，天然适合 Pages：

1. 在 GitHub 新建仓库（如 `travel-memory`），把本目录推上去：
   ```bash
   git init && git add -A && git commit -m "travel memory site"
   git branch -M main
   git remote add origin https://github.com/<你的用户名>/travel-memory.git
   git push -u origin main
   ```
2. 仓库 **Settings → Pages → Source** 选 `Deploy from a branch`，分支 `main`、目录 `/ (root)`
3. 几分钟后访问 `https://<你的用户名>.github.io/travel-memory/`

注意：个人模式的照片只存在**访问者自己浏览器**的 IndexedDB 里，Pages 上不保存任何数据——
每台设备/浏览器看到的都是各自的空起点，互不同步；
想要多人共享，请完成上面的「云端配置」并使用房间功能。

## 已知限制

- 地图下钻层级：中国到「市/区」级，美国到「县」级，其余约 210 个国家到「省/州」级
  （Natural Earth 10m admin-1 数据，点击时按需懒加载单国文件）。少数迷你国家/地区
  （梵蒂冈、摩纳哥等）无省级数据，点击直接进国家照片墙。
  想更新某国数据：跑 `node tools/build_provinces.js` 重新生成（数据源见下）。
- 外国省/州的照片墙标题、store key 用英文名（如 `prov:JP:Kyoto`），tooltip 和照片墙
  标题会显示 Natural Earth 自带的中文名（京都府）；若未来数据源改名，旧照片 key 不变。
- 地标图在 `js/landmarks.js` 中按地区维护，可自行增删（填 Wikimedia 文件名即可）。
- **个人照片与房间照片是两套独立数据**：房间里的照片存在云端（Supabase），个人模式的照片
  只存在当前浏览器。照片墙标题下方有来源标识（🏠 共享房间 / 📱 本机个人照片），
  看清再操作——在个人模式下删照片不会影响房间里的照片，反之亦然。
- 云端依赖自托管的 `assets/supabase.min.js`（早期版本走 jsdelivr CDN，大陆常被墙）。
  万一该文件缺失或云端连不上，会降级为个人模式，页面底部显示「⚠ 云端未连接」，
  **房间照片不会丢**，联网后刷新即可看到。
- GPS 自动归位依赖照片里的 EXIF 坐标：微信/QQ 转发过的图片通常已被抹掉 GPS，
  截图同样没有；这类照片仍按「当前位置」归档，可用 ⇄ 整理位置手动搬。
- 导出的 ZIP 不压缩（照片本身已是压缩格式），体积≈原图总和；批量导出大相册时会占内存，
  建议分地点导出。
- 进站后恢复上次所在房间需要 1~2 秒，这段时间照片墙显示「正在连接房间…」而不会先闪出个人照片。
