# SIGNOVA 产品展示页

独立静态页面，可用于个人网站、GitHub Pages 或项目演示。无需构建，无外部 CDN、字体、追踪脚本或数据上传。本目录与主 App 分离，不改变 App 的功能、模型配置或本地记忆。

**[在线查看产品展示页](https://mortalfrank.github.io/Signova/) · [在线播放品牌片](https://mortalfrank.github.io/Signova/#film)**。访客点击播放按钮即可观看，无需下载项目或视频文件。

## 本地预览

在仓库根目录运行自带的静态服务器（支持视频分段读取和拖动进度）：

```powershell
node docs/showcase/serve.mjs
```

打开 `http://127.0.0.1:5194/`。直接打开 `index.html` 也能查看页面与图像，但浏览器对 `file://` 下的媒体清单读取有限制，因此视频请通过 HTTP/HTTPS 预览。

## 视频文件

新版采用 60 秒品牌叙事：跟随一位听障学生办理校园事务，明确 SIGNOVA 面向聋人及听障用户，依次呈现看见现场信息、自主表达、确认并接续事项，落到平等参与生活。品牌主张为“让沟通可见，让参与平等”，情感句为“每一种表达，都值得被认真回应”。校园故事属于产品情境示意。

当前版本仅保留原背景音乐，画面与原中文字幕保持不变。声音和 AI 动作画面的制作来源见 [素材许可说明](LICENSES.md)。

播放器由 `media.json` 启用。成片使用以下文件：

```json
{
  "video": "promo-music-only.mp4",
  "poster": "poster.jpg",
  "captions": "captions.zh-CN.vtt"
}
```

未配置或视频无法播放时，页面保留完整品牌封面，不显示损坏播放器。视频不自动播放，保留原生播放、音量、进度与全屏控件。字幕使用 WebVTT，需与最终视频逐句同步；没有真实字幕文件时将 `captions` 设为 `null`，不要放入空壳字幕。

## 部署

将本目录的**全部内容**作为静态站点根目录上传到已有网站托管服务；所有内部资源都使用相对地址，支持部署到子路径。部署本页不等于部署 SIGNOVA App、模型后端或账号服务。

本仓库使用 GitHub Actions 发布到 `https://mortalfrank.github.io/Signova/`。工作流为 [showcase-pages.yml](../../.github/workflows/showcase-pages.yml)：当 `main` 分支的展示页目录或工作流更新时，先执行静态校验，再将本目录作为站点根目录发布；也支持在 Actions 页面手动运行。Pages 的构建来源设为 GitHub Actions。

发布范围仅为 `docs/showcase/`，包含页面、图片、视频和素材说明。App、模型配置和后端服务分别部署。README 封面链接到网页的 `#film` 播放区；MP4 原文件保留为独立下载入口。

在个人网站已有案例页中嵌入视频时，可以使用：

```html
<video controls playsinline preload="metadata" poster="/signova/poster.jpg">
  <source src="/signova/promo-music-only.mp4" type="video/mp4">
  <track kind="captions" src="/signova/captions.zh-CN.vtt"
         srclang="zh-CN" label="简体中文">
</video>
```

将 `/signova/` 替换为实际部署目录。视频已有画面字幕；额外字幕轨默认关闭，避免两份字幕重叠。

## 页面内容与实现证据

- 首页与故事描述 SIGNOVA 面向聋人及听障用户的产品方向：理解现场、自主表达、确认并接续事项，让沟通可见、让参与平等。
- 技术段根据 `model.mjs`、`public/model-context.js`、`public/core.js`、动作组件和 2026-10-19 进展记录撰写。
- 体验区截图来自 2026-10-19 的实际 App 操作，使用虚构校园资料：`mobile-live.png` 对应文字输入后的真实模型响应，`mobile-talk.png` 对应选择模型候选回复的滚动视图，`mobile-memory.png` 对应日期更正为周五后刷新页面继续办理。截图完整保留实际界面内容；继续办理页仍明确标有规则回复来源，不把它描述为模型生成。截图不代表整句手语翻译。
- 日期更正卡片是**交互逻辑示意**，页面已明确标注；不是伪造运行截图。
- “实现说明与研究方向”集中说明动作范围、模型启用条件、本地记忆和同步范围。
- 不含虚构用户数、客户、翻译准确率、下载入口、线上 App 链接或自研基础模型宣传。
- 仓库链接指向 `Mortalfrank/Signova` 的 `main` 分支。若公开版本与当前代码不同，应先同步对应实现，再对外引用代码文件链接。

## 素材与版权

- `assets/nova.png` 复制自项目 `public/assets/nova.png`，为基于用户 NOVA IP 参考图生成的品牌素材；详见仓库根 `ASSETS.md`。此图是品牌姿态，不代表已核验的手语表达。
- `assets/mobile-*.png` 为本项目真实浏览器截图，当前来源为 `宣传片/SIGNOVA宣传片/工程/public/screens/03-model.png`、`04-reply.png`、`10-continue.png`。无第三方用户资料。
- 星形图标为本次编写的 SVG 几何图形；排版使用系统字体，无远程字体文件。
- 配乐为 Mixkit 的 Better Times are Coming，采用与画面同步的成片展示，详见 [素材许可说明](LICENSES.md)。不要单独分发原始配乐、试听或工程独立音轨。
- 当前版本采用纯音乐音轨，保留原中文字幕与时间轴；历史中文旁白制作来源见素材许可说明。
- 新版的 NOVA 动作画面采用原 IP 图片与万相 `wan2.2-animate-move` 专业模式（`wan-pro`）图生动作。驱动参考源自 StudioGalt CC0 的独立 ASL Please 动捕，经本地骨骼重定向并渲染为模型输入视频；该参考视频和参考用 3D 模型外观不出现在最终片中。AI 生成结果用于品牌 IP 动作可视化，不作为中文整句手语翻译质量验收的证据，详见 [素材许可说明](LICENSES.md)。

## 可访问性与验证

页面含跳转链接、语义标题、图像替代文字、原生视频控制、字幕轨配置、可展开的文字版故事以及 `prefers-reduced-motion` 支持。体验切换使用 ARIA tabs，可用方向键、Home、End 操作。不自动播放音频或视频。

可在本目录运行静态验证：

```powershell
node verify.mjs
```

它检查本地必需资源、媒体清单及脚本语法；视觉、键盘和真实视频播放仍需浏览器确认。
