# 电波手机音乐服务

SillyTavern 服务端插件，与电波手机扩展 v1.3.5+ 配套。把网易云音乐、QQ 音乐与酷狗音乐的登录、账号资料、歌单与播放地址接口放到酒馆内运行，无需单独部署三台 API 服务、开放端口或配置跨域。

## 安装

需要 Node.js 22+、Git，以及可安装服务端插件的 SillyTavern。托管酒馆需由管理员安装。
在 **SillyTavern 根目录**打开终端执行：

```sh
git clone https://github.com/colerith/Electric-Phone-Music.git plugins/Electric-Phone-Music
node plugins/Electric-Phone-Music/install.mjs
```

安装器安装锁定的依赖、备份 config.yaml 并开启 `enableServerPlugins`。**随后重启酒馆服务器**。前端「音乐设置 → 我的音乐账号」会自动检测，可选择平台扫码；已有自定义服务不会被覆盖，可点击「使用酒馆音乐插件」切换。

仅刷新网页不会载入新服务端插件。前端扩展无法替用户修改服务器配置，因此首次仍需这一步安装；此后无需维护独立音乐服务进程。

## 更新和卸载

在插件目录执行 `git pull --ff-only`，再运行 `node install.mjs` 并重启酒馆。卸载时移出本插件目录并重启，其他服务端插件不受影响。

## 能力与存储

- 三个平台：扫码登录、恢复当前浏览器登录、账号资料、个人歌单、曲目分页、平台允许的播放地址。
- 网易云与酷狗提供会员信息读取；QQ 上游未提供独立会员查询时显示「会员状态暂无法确认」，不推断已开通会员。
- 平台 cookie/会话仍保存在前端当前浏览器；不写入聊天备份。QQ 的会话加密密钥按酒馆用户存储于 `data/<用户>/electric-phone-music/session-secret`，用于重启后继续校验登录。
- 请求继承酒馆认证和 CSRF 保护；只开放前端所需的固定路径，不接受代理目标地址，不提供任意转发和修改歌单接口，不把平台 cookie 设置为酒馆 cookie，不记录登录凭据。
- 不绕过会员、版权或地区限制；平台接口调整、风控或网络问题可能影响登录和播放。

## 开发

```sh
npm ci --ignore-scripts
npm test
```

插件 ID：`electric-phone-music`。检测：`GET /api/plugins/electric-phone-music/health`。账号接口均为同源 `POST /api/plugins/electric-phone-music/{netease|qq|kugou}/...`，表单参数与对应 SDK 一致。

测试覆盖固定路由与依赖契约、用户隔离、拒绝任意代理参数、并发限制、Cookie 传递及错误脱敏。真实会员/私人歌单验证需要账号持有者扫码。

## 致谢

依赖并保留各自许可证：

- [NeteaseCloudMusicApiEnhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced)，MIT，4.41.1。
- [QQ Music API](https://github.com/yakult-green-tea/qq-music-api)，MIT，3.1.3；使用不启动额外端口的 serverless 入口及 MQTT 适配。
- [KuGouMusicApi](https://github.com/MakcRe/KuGouMusicApi)，MIT，1.6.0。
- [ws](https://github.com/websockets/ws)，MIT。

SillyTavern 插件部署约定：[官方文档](https://github.com/SillyTavern/SillyTavern-Docs/blob/main/For_Contributors/Server-Plugins.md)。

## v0.2.0 歌词补充

新增同源 POST `/lyrics`，仅接收歌曲来源、ID、标题、歌手。参考 [Folia](https://github.com/chthollyphile/folia-major) 的多来源回退、匹配校验和缓存思路独立实现：优先获取原平台歌词，支持网易云、QQ、酷狗及 [AMLL TTML DB](https://github.com/Steve-xmh/amll-ttml-db)。跨平台候选必须同时匹配歌名与歌手；没有可信匹配时返回空结果。包含超时、有限缓存与并发限制，不提供任意 URL 代理。前端会把 TTML 转为内置播放器的逐行时间轴，不包含 Folia 的逐字动效。

平台歌单由前端自动分页同步到浏览器 IndexedDB，与手动歌单分开管理。它们不属于聊天备份，清理浏览器缓存后可从音乐账号重新同步。

### v0.3.0

歌词接口新增翻译与音译文本；网易云、QQ 音乐和 AMLL 提供的附加轨按各自时间戳返回。前端开关按需加载；没有附加文本的歌曲保留原歌词。
