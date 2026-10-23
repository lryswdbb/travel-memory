# 我们的旅行记忆 🌍

一个把旅行照片按地理位置归档的互动网站：从星际穿梭动画抵达一颗**可拖拽旋转、
滚轮缩放的卫星视角地球**，在可点击的地图上一级一级下钻（世界 → 国家 → 省/州 → 城市/县），
为每个地点收藏照片；照片按拍摄日期排成时间线，还有足迹统计总览页。
照片墙背景自动换成当地的标志性景观。

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
3. **世界地图** —— 点击任意国家直接进入它的照片墙；点击 **中国** / **美国** 进入下一级
4. **中国** —— 点击省份进入该省城市地图，再点击城市进入照片墙
5. **美国** —— 点击州进入县（County）地图，再点击县进入照片墙
6. **照片墙** —— 「+ 添加照片」或直接把图片拖进页面上传；照片按拍摄日期分成月份时间线，
   左上角有日期角标；点击照片看大图，**←/→ 键或两侧按钮翻页**，✕ 删除，✎ 改备注/日期
7. **足迹** —— 地图页右上「足迹」进入统计总览：照片/国家/省份/城市计数、点亮的世界地图、记忆最多的地方排行
8. 已有照片的地区在地图上会以 **金色** 高亮，tooltip 显示照片数量
9. 手机上同样可用：地图点按、照片墙单列时间线、地球双指缩放

## 数据存储

- 照片本体存在浏览器 **IndexedDB**（本地，不上传任何服务器），上传时自动压缩到最长边 1600px
- 「哪些地点有记忆」的索引存在 localStorage，用于地图高亮
- 清空浏览器数据 = 清空照片，重要照片请自行备份原图

## 目录结构

```
travel-memory/
├── index.html            # 单页应用入口（封面/穿梭+地球/地图/照片墙/足迹 五个场景）
├── server.js             # 本地静态服务器
├── css/style.css
├── js/
│   ├── main.js           # 流程控制 + 封面星空
│   ├── warp.js           # 星际穿梭 + 抵达态可交互地球（three.js：拖拽旋转/滚轮缩放）
│   ├── map.js            # 多级地图（echarts：世界/中国省市/美国州县）
│   ├── gallery.js        # 照片墙 + 日期时间线 + 大图翻页 + IndexedDB 存储 + 上传压缩
│   ├── stats.js          # 足迹统计总览页
│   └── landmarks.js      # 各地标图片清单（Wikimedia Commons）
├── assets/               # three.js / echarts / topojson 库 + 地球贴图
├── data/js/              # 全部地图边界数据（已转成 .js，双击 html 也能用）
└── tools/                # 本地开发/测试脚本（headless 冒烟测试与截图，不参与产品运行）
```

## 数据来源

- 世界/中国边界：Apache ECharts 4 地图数据、阿里云 DataV.GeoAtlas（省市县级）
- 美国州/县边界：us-atlas（TopoJSON）
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

注意：照片只存在**访问者自己浏览器**的 IndexedDB 里，Pages 上不保存任何数据——
每台设备/浏览器看到的都是各自的空起点，互不同步。

## 已知限制

- 中国下钻到「市/区」级；美国下钻到「县」级；其他国家暂无下级细分数据，
  点击国家直接进入照片墙。想加某个国家的省级地图，把 GeoJSON 放进
  `data/js/` 并在 `js/map.js` 里仿照 `renderChinaCities` 加一个分支即可。
- 地标图在 `js/landmarks.js` 中按地区维护，可自行增删（填 Wikimedia 文件名即可）。
