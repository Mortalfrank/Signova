# 宣传片素材与署名

## 配乐

配乐：**Better Times are Coming** — Alejandro Magaña (A. M.)，来自 [Mixkit](https://mixkit.co/free-stock-music/tag/technology/)，曲目编号 173。

授权：[Mixkit Stock Music Free License](https://mixkit.co/license/modal/musicFree/)，核对日期：2026-10-19。用于本片与画面同步的背景音乐；成片可在 GitHub 项目页、个人网站及社交平台展示。另见 [Mixkit User Terms](https://mixkit.co/terms/)。

当前版本仅使用原背景音乐，画面与原中文字幕保持不变。

音乐未转为本仓库的开源许可证。原始曲目、试听和独立音轨只作制作材料，不作为音乐素材库公开分发。公开视频请使用已合成的 MP4；需要重新制作时，按上述来源重新获取音乐。

许可核对存档与下载记录保留在本地制作工程，不包含在公开展示包中；公开来源及许可链接见上文。

## 历史中文旁白

旧版七段中文旁白由阿里云百炼 Qwen TTS 生成，使用 `qwen3-tts-flash` 模型与 Serena 系统音色，并制作逐句同步字幕。当前纯音乐版已移除旁白，保留原中文字幕；此处仅记录历史制作来源。接口说明见 [Qwen-TTS 官方 API 文档](https://help.aliyun.com/zh/model-studio/qwen-tts-api)。

## NOVA AI 动作画面与驱动参考

新版采用 SIGNOVA 既有 NOVA IP 图片，调用阿里云百炼万相 `wan2.2-animate-move` 的专业模式（`wan-pro`）生成动作视频。制作方式为图片角色与驱动参考视频输入，详见 [万相图生动作官方 API 文档](https://help.aliyun.com/zh/model-studio/wan-animate-move-api)。该生成画面用于品牌 IP 动作可视化，不作为中文整句手语翻译质量验收的证据。

驱动参考采用 [StudioGalt / Sign Language Mocap Archive](https://github.com/StudioGalt/Sign-Language-Mocap-Archive) 的 ASL **Please** 动捕，经本项目骨骼重定向后在本地参考角色上渲染为视频，仅用作万相模型输入。源数据为 `SG ASL Please 2024-10-13 No Mesh Mixamo.fbx`，授权为 [CC0 1.0](https://github.com/StudioGalt/Sign-Language-Mocap-Archive/blob/eb9046596fffcc6e92ee91d021372961f3d4fcaa/LICENSE)。最终片呈现原 IP 图片驱动的 AI 生成结果，驱动参考视频及其 3D 模型外观不进入成片。

来源固定于提交 `eb9046596fffcc6e92ee91d021372961f3d4fcaa`；具体下载与哈希记录保留在本地研究资料中；公开来源及固定版本见上述链接。驱动源动作的语种为美国手语 ASL。

上述阿里云链接用于说明生成服务与接口；本文不另行推定或授予服务提供方的素材许可，也不把 CC0 动捕许可扩展为 NOVA 形象或 AI 生成画面的统一许可。

## 角色与界面

- **NOVA 品牌形象**：采用 SIGNOVA 项目既有的、由用户提供并确认使用的 IP 图片；参考用角色模型仅用于内部驱动视频制作，不作为新版成片的角色外观。
- **界面画面**：采集于本地运行的 SIGNOVA App，使用校园办事演示内容；剪辑和手机展示框由本宣传片工程制作。
- 角色形象、界面截图与项目代码分别管理；引用第三方动捕的 CC0 许可不改变 NOVA 原有形象素材的权利归属。

## 字体

字体文件仅用于本地工程排版与视频渲染，不随个人网站或 GitHub 展示页分发；视频中的文字以画面形式输出。发布展示页时使用浏览器系统字体，不复制制作工程中的字体文件。
