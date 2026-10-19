# SIGNOVA 产品展示页

独立静态页面，可用于个人网站、GitHub Pages 或项目演示。无需构建，无外部 CDN、字体、追踪脚本或数据上传。本目录与主 App 分离，不改变 App 的功能、模型配置或本地记忆。

## 本地预览

在仓库根目录运行自带的静态服务器（支持视频分段读取和拖动进度）：

```powershell
node docs/showcase/serve.mjs
```

打开 `http://127.0.0.1:5194/`。直接打开 `index.html` 也能查看页面与图像，但浏览器对 `file://` 下的媒体清单读取有限制，因此视频请通过 HTTP/HTTPS 预览。

## 视频文件

播放器由 `media.json` 启用。成片使用以下文件：

```json
{
  "video": "promo.mp4",
  "poster": "poster.jpg",
  "captions": "captions.zh-CN.vtt"
}
```

未配置或视频无法播放时，页面保留完整品牌封面，不显示损坏播放器。视频不自动播放，保留原生播放、音量、进度与全屏控件。字幕使用 WebVTT，需与最终视频逐句同步；没有真实字幕文件时将 `captions` 设为 `null`，不要放入空壳字幕。

## 部署

将本目录的**全部内容**作为静态站点根目录上传到已有网站托管服务；所有内部资源都使用相对地址，支持部署到子路径。部署本页不等于部署 SIGNOVA App、模型后端或账号服务。

如仓库采用 GitHub Pages：可选用工作流上传此目录为 Pages artifact。不要直接将仓库根目录或含 `.env`、私有研究数据的目录暴露为站点。GitHub Pages 的启用、仓库发布与域名变更需由项目所有者决定，本次仅提供页面文件。

在个人网站已有案例页中嵌入视频时，可以使用：

```html
<video controls playsinline preload="metadata" poster="/signova/poster.jpg">
  <source src="/signova/promo.mp4" type="video/mp4">
  <track kind="captions" src="/signova/captions.zh-CN.vtt"
         srclang="zh-CN" label="简体中文">
</video>
```

将 `/signova/` 替换为实际部署目录。视频已有画面字幕；额外字幕轨默认关闭，避免两份字幕重叠。

## 页面内容与实现证据

- 首页与故事描述 SIGNOVA 的产品方向：理解现场、自主表达、延续交流。
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
- 41–44 秒使用 NOVA 的独立 ASL Please 动作，源自 StudioGalt CC0 动捕，经项目现有播放器烘焙后在 Blender 渲染。没有复制真人手语视频，也不把该片段当作中文长句的翻译。

## 可访问性与验证

页面含跳转链接、语义标题、图像替代文字、原生视频控制、字幕轨配置、可展开的文字版故事以及 `prefers-reduced-motion` 支持。体验切换使用 ARIA tabs，可用方向键、Home、End 操作。不自动播放音频或视频。

可在本目录运行静态验证：

```powershell
node verify.mjs
```

它检查本地必需资源、媒体清单及脚本语法；视觉、键盘和真实视频播放仍需浏览器确认。
