# Apple TV 中文封面（印度区・Egern 静态版）

在 Egern「工具 → 模块 → ＋」选择远程，粘贴下面的地址并启用。使用旧版 Apple TV 封面模块时，请先停用旧版。

```
https://raw.githubusercontent.com/chixiaocai/gern-apple-tv-chinese-india/main/AppleTV-Chinese-India-Static.yaml
```

开启 HTTPS 解密，确认系统已信任 Egern 的证书，然后重开 Apple TV。测试《人生切割術》《末日地堡》《泰德拉索》或《基地》。日志中搜索 `AppleTV-ZH-IN-STATIC`。

脚本用内置对照表替换这四部剧的横版封面和片名。处理响应时无额外网络查询，图片由 Apple TV App 从 Apple CDN 下载。安装时 Egern 会从 GitHub 下载脚本。若 Apple TV 卡在加载画面，停用本模块并重开 App。
