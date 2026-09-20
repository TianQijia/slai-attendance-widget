# iPhone / iPad · Safari 考勤面板

使用免费的 [Userscripts](https://apps.apple.com/cn/app/userscripts/id1463298887) Safari 扩展运行，无需 Apple 开发者会员或每周重新签名。建议 iOS / iPadOS 16.4 或更新版本。它是 Safari 内的面板，不是桌面小组件。

下载 [v1.5.1 安装 ZIP](https://github.com/TianQijia/slai-attendance-widget/releases/download/v1.5.1/slai-attendance-safari-v1.5.1.zip)，或单独下载 [slai-attendance-safari.user.js](https://github.com/TianQijia/slai-attendance-widget/releases/download/v1.5.1/slai-attendance-safari.user.js)。[发布页](https://github.com/TianQijia/slai-attendance-widget/releases/tag/v1.5.1)附有 SHA-256 校验文件。

## 安装

**首次登录前，必须为学生系统和登录站点分别开启“请求桌面网站”。** 学校默认的手机登录页面无法正常使用；脚本不会替你切换 Safari 的这项设置。

1. 在 iPhone 安装并打开 **Userscripts**。记住它显示的脚本目录；如果要求选择目录，可在“文件”里新建 `Userscripts` 文件夹。
2. 把随包的 **slai-attendance-safari.user.js** 保存到这个目录。不要改成 `.txt`，也不要粘贴到地址栏。下载 ZIP 时先在“文件”里点它解压，再移动脚本。
3. 在“设置 → App → Safari → 扩展”（旧版系统为“设置 → Safari → 扩展”）启用 Userscripts。只需允许它访问 **stu.slai.edu.cn** 和 **sts.slai.edu.cn**。
4. 用 Safari 的**普通浏览标签页**打开 [学校学生系统](https://stu.slai.edu.cn/)。点地址栏的页面菜单 → Userscripts，让扩展重新扫描脚本，确认“SLAI 考勤 · Safari 手动版”已启用，然后重新载入学校页面。
5. 在学生系统 **stu.slai.edu.cn**，点 Safari 地址栏的**页面菜单 → 更多（…）→ 请求桌面网站**。点“去登录”后，如果跳转到登录站点 **sts.slai.edu.cn**，也要为它请求桌面网站，再输入账号登录。这是两个站点的设置，只设置其中一个不够。
6. 登录后回到学生系统，右下角会显示“返回考勤并刷新”；点它读取考勤。已经登录时也可以直接点面板右上角的刷新按钮。

如果打开学生系统后已经跳到了登录站点，先在当前登录页请求桌面网站，再从 [学校首页](https://stu.slai.edu.cn/) 重新进入，确认学生系统也已请求桌面网站。此前用手机模式登录出错时，同样设置两个站点后从学校首页重新开始。

登录站点只显示学校自己的登录页。完成登录并回到学生系统后，才会出现返回面板的按钮。书签请保存学校首页地址，不要保存带会话或查询参数的地址。Safari 菜单位置可参考 [Apple 的 iOS 27 使用手册](https://support.apple.com/zh-cn/guide/iphone/iphb3100d149/27/ios/27)。

## 更新

将新版 `slai-attendance-safari.user.js` 放回原来的 Userscripts 目录并替换同名文件，重新扫描脚本后刷新学校网页。保留一个已启用的考勤脚本，避免新旧副本同时运行；原来的学校登录、考勤缓存及桌面网站设置可继续使用。

## 日常使用

- 打开学校首页即可进入面板，使用上次保存在本机的考勤结果；**打开页面不会自动采集**。
- 点刷新或“返回考勤并刷新”才读取学校记录。读取时保持 Safari 当前标签页在前台。
- 串行翻页，间隔 1.5 秒，每个考勤日合计最多 50 页。数据多时需要等待；本版没有 30 分钟后台刷新。
- 沿用安卓版的 05:00 切日、6 小时目标、日历、列表和时段显示。界面计时只在本机计算；完整快照超过 35 分钟后暂停估算。
- 右上角的学校入口会收起面板，方便操作学校页面。Cookie 由 Safari 按学校规则保存，学校会话失效仍需要重新登录。
- “清除本机考勤缓存”只清除此脚本保存的结果；要退出学校账号，请进入学校页面使用其退出入口。不要用清缓存代替退出登录。

## 停用与恢复

1. 在 Safari 的页面菜单 → Userscripts 中，关闭 **“SLAI 考勤 · Safari 手动版”**。
2. **重新载入已打开的学校网页，或关闭这些旧标签页**，让已经加载的脚本停止运行。仅关闭开关不会移除旧页面上已经运行的面板。

也可以在“设置 → App → Safari → 扩展 → Userscripts”中关闭整个扩展；这会同时停用其他 Userscripts 脚本。

停用不会退出学校账号、清除本机考勤缓存或修改“请求桌面网站”设置。需要清除考勤结果时，可先在面板内点“清除本机考勤缓存”；需要退出账号时，使用学校页面的退出入口。

以后重新启用脚本并载入学校首页即可恢复使用，仍然只在手动点击时采集。

## 排错与数据

失败时可以展开、复制排错信息。报告包含稳定错误代码、失败阶段、页码和已读取条数等已观测信息，不包含账号、Cookie、会话地址、姓名、原始页面和异常堆栈。自动复制不可用时会显示可长按选择的文本框。

`AUTH_EXPIRED` 表示采集页已确认跳转登录站点。`IOS_FRAME_ACCESS_DENIED` 只表示 Safari 无法读取内嵌页面，不能凭此确定是登录、网络还是学校页面策略。`IOS_FRAME_BLOCKED` 表示观察到了页面安全策略阻止内嵌采集。`IOS_COLLECTION_INTERRUPTED` 表示页面离开前台，需手动重试。

本机缓存仅包含经过清洗的考勤日期、时长、必要进出时间、界面偏好和固定诊断字段。脚本不读取或导出 Cookie、密码，也不使用外部服务。Userscripts 自己管理本机存储；不同 Safari 标签页共用这个脚本的缓存。

本版已用虚构学校页面完成 Chromium / WebKit 和最终 ZIP 安装验证，并经过 iPhone 试用。试用确认学校登录需要请求桌面网站；学校登录会话的有效期仍由学校控制。

## 开发与复验

运行 `npm run build:ios` 生成 `dist/ios-v<版本>/` 内的脚本、安装 ZIP 和 SHA256SUMS。ZIP 仅包含脚本、安装说明和许可声明。运行 `npm run test:ios` 使用 Chromium 和 WebKit 检查虚构学校登录、分页、缓存、错误链和移动端界面；`npm run test:install` 还会从最终 iOS ZIP 中取出脚本进行安装验证。

Userscripts 的功能与授权方式见其 [官方文档](https://github.com/quoid/userscripts/tree/release/4.x.x)。
