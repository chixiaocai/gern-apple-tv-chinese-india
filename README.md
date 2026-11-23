# Apple TV 中文封面（Egern）

## 印度区动态版

先在 Egern 停用旧的 Apple TV 封面模块，再到「工具 → 模块 → ＋」添加远程模块。

```
https://raw.githubusercontent.com/chixiaocai/gern-apple-tv-chinese-india/main/AppleTV-Chinese-India-Dynamic.yaml
```

开启 HTTPS 解密并信任 Egern 的证书。彻底退出再打开 Apple TV，测试首页和影片详情。日志搜索 `AppleTV-ZH-DYNAMIC`。

动态版按相同影片 ID 从 Apple 台湾、香港和新加坡区匹配展示文字和封面。原始片库和播放权益继续由 Apple TV 提供。首页的地区推荐可能不同，脚本也会尝试查询首个影片的详情。查询超时或没有匹配资料时沿用原始显示。继续观看等个性化列表可能仍显示原样。

## 印度区静态版 v2

在 Egern「工具 → 模块 → ＋」选择远程，粘贴下面的地址并启用。使用旧版 Apple TV 封面模块时，请先停用旧版。

```
https://raw.githubusercontent.com/chixiaocai/gern-apple-tv-chinese-india/main/AppleTV-Chinese-India-Static.yaml
```

开启 HTTPS 解密，确认系统已信任 Egern 的证书，然后重开 Apple TV。测试《身而為人：茱蒂休曼》。日志中搜索 `AppleTV-ZH-IN-STATIC v2`。若看不到日志，可在 Egern 的 MITM「包含」里手动加入 `uts-api.itunes.apple.com`，保存后重开 Apple TV。

脚本用内置对照表替换部分剧集和电影的展示资料。已加入《身而為人：茱蒂休曼》的中文标题、横版图、竖版海报和首页片名图层，以及《12 12 12》的中文简介。后者在台湾和印度区采用同一个片名和封面。处理响应时无额外网络查询，图片由 Apple TV App 从 Apple CDN 下载。安装时 Egern 会从 GitHub 下载脚本。若 Apple TV 卡在加载画面，停用本模块并重开 App。
