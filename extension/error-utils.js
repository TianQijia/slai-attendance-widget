(() => {
  // Only fixed text and allowlisted structural facts may reach storage or UI.
  const failures = {
    REFRESH_CHANNEL_UNAVAILABLE: ["电脑扩展尚未连接手机刷新通道", "确认电脑 Chrome 和扩展正在运行；更新后在扩展管理页重新加载扩展，再检查手机查看设置。"],
    REFRESH_CHANNEL_LOST: ["刷新过程中与电脑扩展的连接已断开，结果尚未确认", "重新连接查看服务，检查电脑扩展的采集状态；本次请求不会自动重新执行。"],
    REFRESH_CHANNEL_BUSY: ["已有另一个扩展连接了手机刷新通道", "仅保留本人需要使用的那个 Chrome 扩展实例，关闭重复配对的实例后重试。"],
    REFRESH_CHANNEL_FAILED: ["未能建立或保持本机刷新连接，直接原因尚未识别", "确认伴随服务与扩展均已更新并运行，检查手机查看设置及本机权限。"],
    REFRESH_ACK_TIMEOUT: ["等待上限内未收到电脑扩展的刷新确认", "检查电脑扩展是否运行；先查看最新结果再决定是否重试。"],
    REFRESH_RESULT_TIMEOUT: ["等待上限内未收到学校采集的完成结果", "查看电脑扩展的采集进度及排错信息；这不表示学校采集已经停止。"],
    REFRESH_RESULT_UNKNOWN: ["扩展未提供可确认的学校刷新结果", "查看电脑扩展的排错信息，重新连接查看结果。"],
    REFRESH_COOLDOWN: ["距离上一次手机刷新请求时间过短", "等待报告中的重试间隔后，再点击刷新学校数据。"],
    REFRESH_SEND_TIMEOUT: ["手机刷新请求超过 3 秒，尚未确认是否送达", "先等待页面读取执行状态；再次点击会沿用同一请求，避免重复抓取。"],
    REFRESH_SEND_FAILED: ["未能确认手机刷新请求是否送达，直接原因尚未识别", "检查查看服务连接，再读取执行状态或重试。"],
    REFRESH_UNSUPPORTED: ["当前服务没有提供手机刷新入口", "更新伴随服务和 Chrome 扩展后，再使用手机刷新。"],
    REFRESH_SERVER_RESTARTED: ["服务进程已更换，无法确认上一次手机刷新结果", "查看电脑端最新采集结果；需要再次抓取时手动点击刷新。"],
    NET_PROBE_FAILED: ["网络检测请求未能完成", "检查附带的系统错误代码；原因未知时先确认本机服务，再用另一台设备测试。"],
    NET_PROBE_TIMEOUT: ["网络检测请求超过等待上限", "确认伴随服务正在运行；超时本身不能确定是防火墙或校园网隔离。"],
    NET_HTTP_FAILED: ["检测接口返回了非预期 HTTP 状态", "根据 HTTP 状态码检查配对配置和软件版本。"],
    NET_RESPONSE_INVALID: ["检测接口响应与此伴随服务协议不符", "检查端口是否为当前版本伴随服务占用。"],
    NET_INSPECT_FAILED: ["未能读取操作系统网络或防火墙状态", "在系统设置中手动检查；若系统限制查询，反馈此报告给管理员。"],
    NET_INSPECT_PERMISSION: ["操作系统拒绝了网络或防火墙状态查询权限", "在系统设置中手动查看，或将此报告交给管理员；检测没有更改系统设置。"],
    NET_INSPECT_UNAVAILABLE: ["此系统未提供检测所需的网络查询命令", "在系统设置中手动查看网络类型与防火墙规则，并反馈系统版本。"],
    NET_REPORT_WRITE_FAILED: ["未能保存网络检测报告", "检查用户数据目录权限与磁盘空间；终端仍可查看脱敏报告。"],
    BRIDGE_PERMISSION: ["浏览器未授予本机连接权限", "在手机查看设置中重新启用并允许本机权限。"],
    BRIDGE_TOKEN: ["本机配对码不正确", "打开伴随服务的连接信息，重新复制配对码。"],
    BRIDGE_TIMEOUT: ["本机服务在等待上限内未完成响应", "确认伴随服务正在运行，再重试连接。"],
    BRIDGE_UNREACHABLE: ["未能连接本机服务，直接原因尚未识别", "运行伴随服务启动器，检查连接信息和端口状态。"],
    BRIDGE_HTTP: ["本机服务返回了非成功状态", "查看 HTTP 状态码及服务排错信息后重试。"],
    BRIDGE_SETTINGS: ["无法保存或读取手机查看设置", "重新加载扩展并重新配对；考勤缓存不受此次连接失败影响。"],
    INVALID_SCHEMA: ["收到的数据不符合允许的状态格式", "确保扩展和伴随服务使用同一版本。"],
    BODY_TOO_LARGE: ["请求超过 256 KiB 上限", "停止重试该请求，复制排错信息反馈。"],
    REQUEST_TIMEOUT: ["请求数据未在等待上限内传输完成", "检查本机连接后重试。"],
    METHOD_NOT_ALLOWED: ["此入口不接受该请求方法", "查看端仅支持 GET；扩展写入必须使用本机写入端口。"],
    ACCESS_DENIED: ["查看令牌无效或缺失", "从本机连接信息重新打开手机查看链接。"],
    VIEW_TOKEN_MISSING: ["当前页面没有保存查看权限", "粘贴电脑连接信息中的完整手机查看链接；仅输入 IP 地址无法恢复权限。自己的设备可勾选记住查看权限。"],
    VIEW_TOKEN_REJECTED: ["服务已响应，但拒绝了此查看令牌", "从电脑连接信息重新取得手机查看链接；请勿使用本机配对码。"],
    VIEW_LINK_INVALID: ["输入内容不是完整有效的手机查看链接", "复制电脑连接信息中的手机查看链接，保留 #token= 后的内容，再粘贴到本页。"],
    VIEW_LINK_ORIGIN: ["查看链接的服务地址与本页不同", "直接在浏览器打开电脑提供的完整手机查看链接；本页不会把令牌发送到其他地址。"],
    VIEW_STORAGE_UNAVAILABLE: ["浏览器未能读写查看权限存储", "当前页面仍可使用有效链接连接；关闭页面后请重新打开完整查看链接，或允许此站点存储。"],
    ORIGIN_DENIED: ["请求来源或主机不在允许范围", "使用启动器显示的地址，不要通过其他网页转发写入。"],
    PORT_IN_USE: ["服务端口已被其他进程占用", "先查看或停止已有伴随服务；不要关闭不认识的进程。"],
    LISTEN_FAILED: ["操作系统未能监听服务地址", "确认已连接局域网，重新运行启动器选择当前地址。"],
    LAN_UNAVAILABLE: ["未找到可用的私有局域网 IPv4 地址", "连接同一 Wi-Fi 后重新启动；目前仅可在本机访问。"],
    LAN_SELECTION: ["存在多个可用局域网地址，需要选择", "运行启动器，选择手机所在网络的地址。"],
    CACHE_READ_FAILED: ["未能读取或验证伴随服务缓存", "检查用户数据目录权限；损坏缓存可通过重置后重新同步恢复。"],
    CACHE_WRITE_FAILED: ["未能原子保存伴随服务状态", "检查用户数据目录是否可写及磁盘空间，再重试。"],
    CONFIG_FAILED: ["未能读取或保存伴随服务配置", "检查用户数据目录权限，使用连接信息工具重试。"],
    VIEW_UNREACHABLE: ["查看页未能取得服务响应，直接原因尚未识别", "检查电脑上的伴随服务和同 Wi-Fi 连接，再重新连接。"],
    VIEW_TIMEOUT: ["查看页请求超过 3 秒等待上限", "检查服务是否运行、电脑是否可访问，再重新连接。"],
    SOURCE_STALE: ["扩展超过 150 秒未联系本次服务进程", "在电脑上确认 Chrome 和扩展运行，并检查手机查看连接状态。"],
    DATA_STALE: ["今日完整数据超过 35 分钟未更新", "在电脑端检查学校同步状态；当前显示冻结的完整快照。"],
    AUTOSTART_FAILED: ["系统未能设置登录后自动启动", "检查本机启动设置权限，再运行自动启动工具。"],
    STOP_FAILED: ["未能停止已记录的服务实例", "查看连接信息，确认服务状态后重试。"],
    AUTH_EXPIRED: ["学校页面已跳转到登录页", "点击“去登录”，完成登录后重新读取。"],
    TAB_CLOSED: ["采集标签页已关闭或不存在", "点击刷新，重新创建采集页；读取期间请勿关闭它。"],
    PAGE_TIMEOUT: ["学校页面加载超时", "打开学校系统检查是否能加载，再点击刷新。"],
    PORTAL_URL: ["学校系统跳转到了不支持的页面", "打开学校系统，确认能进入学生首页后再刷新。"],
    ATTENDANCE_LINK_MISSING: ["首页未找到“学生考勤统计查询”入口", "在学校首页检查该菜单是否存在；若存在，请复制排错信息反馈。"],
    SUMMARY_MISSING: ["汇总页已打开，但没有识别到每日考勤表", "打开学校考勤统计页检查月份及每日表格；若表格正常，请反馈排错信息。"],
    STUDENT_NUMBER_MISSING: ["汇总页未识别到查询明细所需的学号", "检查学校汇总页是否正常显示本人信息；反馈时只需复制排错信息。"],
    SWIPE_ROUTE_MISSING: ["未能从汇总入口确定今日明细页面", "复制排错信息反馈，以便适配学校新的页面地址。"],
    SWIPE_TIMEOUT: ["今日明细或翻页加载超时", "打开学校记录页检查能否翻页，再刷新；若持续超时，请反馈排错信息。"],
    SWIPE_DUPLICATE: ["学校返回了重复或不连续的明细页", "稍后重新刷新；若仍停在同一页，请反馈排错信息。"],
    SWIPE_CHANGED: ["翻页期间记录总数发生变化", "稍后刷新，从第一页重新读取完整记录。"],
    SWIPE_INCOMPLETE: ["今日明细条数不齐", "核对学校记录页的总条数和下一页按钮，再复制排错信息反馈。"],
    SWIPE_NEXT: ["无法点击下一页明细", "检查学校记录页能否手动翻页，再复制排错信息反馈。"],
    SWIPE_LIMIT: ["今日明细超过 50 页", "先在学校系统核对当天记录范围，再反馈排错信息。"],
    SWIPE_URL: ["明细页跳转到了不支持的页面", "打开学校记录页检查跳转情况，再刷新。"],
    SCRIPT_PERMISSION: ["浏览器拒绝扩展读取学校页面", "在扩展管理中检查学校站点访问权限，再重新加载扩展。"],
    SCRIPT_CONTEXT_LOST: ["读取脚本的页面环境因跳转而失效", "等待学校页面稳定后刷新；若反复发生，请反馈排错信息。"],
    PAGE_NETWORK_ERROR: ["浏览器报告学校页面加载错误", "打开学校系统查看浏览器的具体网络或证书提示，再重试。"],
    STORAGE_READ_FAILED: ["浏览器未能读取本机考勤缓存", "重新加载扩展后重试；若仍失败，请反馈排错信息。"],
    STORAGE_WRITE_FAILED: ["浏览器未能保存本次考勤结果", "重新加载扩展后重试；本次结果尚未成功保存。"],
    SCHEDULE_FAILED: ["浏览器未能设置下一次自动刷新", "重新加载扩展后检查刷新提示。"],
    WIDGET_DISCONNECTED: ["小窗与扩展后台的连接已断开", "关闭小窗，在扩展管理中重新加载扩展，再打开小窗。"],
    READ_FAILED: ["发生尚未分类的异常，直接原因尚未识别", "复制包含失败阶段和异常类型的排错信息反馈。"],
    UNEXPECTED_ERROR: ["发生尚未分类的异常，直接原因尚未识别", "复制包含失败阶段和异常类型的排错信息反馈。"]
  };
  const stages = {
    network_probe: "检测本机网络接口", network_inspect: "读取系统网络配置", network_report: "保存网络检测报告",
    bridge_settings: "设置本机连接", bridge_push: "扩展推送本机状态", companion_start: "启动伴随服务",
    companion_read: "读取服务缓存", companion_write: "保存服务缓存", companion_request: "处理本机请求",
    viewer_fetch: "手机读取状态", viewer_access: "读取或保存查看权限", remote_refresh: "手机请求学校刷新", autostart: "设置登录后启动",
    open_portal: "打开学校首页", find_attendance: "查找考勤入口",
    open_summary: "打开月度汇总", read_summary: "读取月度汇总",
    open_swipes: "打开今日明细", read_swipes: "读取明细分页",
    advance_swipes: "切换下一页明细", save_state: "保存考勤结果",
    read_cache: "读取本机缓存", widget_request: "小窗联系扩展后台", unknown: "阶段尚未记录"
  };
  const operations = {
    bridge_push: "发送脱敏缓存", configure_bridge: "保存配对设置", http_request: "请求本地服务", listen: "监听端口", persist: "原子保存缓存",
    create_tab: "创建采集页", get_tab: "获取采集页", navigate: "等待页面加载",
    inject_reader: "注入读取脚本", read_page: "运行页面读取脚本", advance_page: "点击分页控件",
    storage_get: "读取本机存储", storage_set: "写入本机存储", schedule: "设置刷新计划",
    read_link: "读取手机查看链接",
    get_state: "获取小窗状态", refresh: "请求刷新", login: "打开登录页", open_portal: "打开学校系统"
  };
  const methods = ["findAttendanceUrl", "extractAttendance", "extractSwipePage", "advanceSwipePage"];
  const errorNames = ["Error", "TypeError", "ReferenceError", "RangeError", "SyntaxError", "DOMException", "TimeoutError", "SecurityError", "QuotaExceededError"];
  const networkCodes = ["ERR_NAME_NOT_RESOLVED", "ERR_CONNECTION_TIMED_OUT", "ERR_CONNECTION_RESET", "ERR_CONNECTION_REFUSED", "ERR_INTERNET_DISCONNECTED", "ERR_NETWORK_CHANGED", "ERR_CERT_AUTHORITY_INVALID", "ERR_CERT_DATE_INVALID", "ERR_CERT_COMMON_NAME_INVALID", "ERR_SSL_PROTOCOL_ERROR", "ERR_TUNNEL_CONNECTION_FAILED", "ERR_PROXY_CONNECTION_FAILED"];
  const systemCodes = { EACCES: "操作系统拒绝访问", EPERM: "操作系统不允许此操作", ENOSPC: "存储空间不足", EIO: "操作系统报告输入输出错误", EADDRINUSE: "地址已被占用", EADDRNOTAVAIL: "此地址当前不可用", EMFILE: "此进程已打开过多文件", ENFILE: "系统已打开过多文件", ENOENT: "所需文件或目录不存在", ECONNREFUSED: "连接被拒绝", ECONNRESET: "连接被重置", ETIMEDOUT: "连接超时", EHOSTUNREACH: "目标主机不可达", ENETUNREACH: "目标网络不可达" };
  systemCodes.EEXIST = "路径已被现有文件或目录占用";
  systemCodes.ENOTDIR = "路径中的一项不是目录";
  const numericFields = { page: [1, 51], currentPage: [1, 10000], rowsRead: [0, 1000000], expectedTotal: [0, 1000000], actualTotal: [0, 1000000], timeoutMs: [0, 1200000], httpStatus: [100, 599], port: [1, 65535], retryAfterSeconds: [0, 60] };

  function sanitizeDiagnostic(input) {
    if (!input || typeof input !== "object") return null;
    const result = {
      code: Object.hasOwn(failures, input.code) ? input.code : "UNEXPECTED_ERROR",
      stage: Object.hasOwn(stages, input.stage) ? input.stage : "unknown"
    };
    if (Object.hasOwn(operations, input.operation)) result.operation = input.operation;
    if (methods.includes(input.readerMethod)) result.readerMethod = input.readerMethod;
    if (errorNames.includes(input.errorName)) result.errorName = input.errorName;
    if (networkCodes.includes(input.networkCode)) result.networkCode = input.networkCode;
    if (Object.hasOwn(systemCodes, input.systemCode)) result.systemCode = input.systemCode;
    if (typeof input.occurredAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(input.occurredAt) && Number.isFinite(Date.parse(input.occurredAt))) result.occurredAt = input.occurredAt;
    for (const [key, [min, max]] of Object.entries(numericFields)) {
      if (Number.isSafeInteger(input[key]) && input[key] >= min && input[key] <= max) result[key] = input[key];
    }
    return result;
  }

  function diagnoseError(error, context = {}) {
    // Classify the raw browser exception in memory; never retain its message/stack.
    const message = typeof error?.message === "string" ? error.message : "";
    let code = Object.hasOwn(failures, error?.code) ? error.code : "UNEXPECTED_ERROR";
    const networkCode = networkCodes.find(value => message.includes(`net::${value}`));
    if (code === "UNEXPECTED_ERROR") {
      if (/No tab with id|Invalid tab ID|tab (?:was |has been )?closed/i.test(message)) code = "TAB_CLOSED";
      else if (/Cannot access contents|Missing host permission|Cannot access a chrome/i.test(message)) code = "SCRIPT_PERMISSION";
      else if (networkCode || /showing error page/i.test(message)) code = "PAGE_NETWORK_ERROR";
      else if (/Execution context was destroyed|Frame with ID .* was removed|No frame with id/i.test(message)) code = "SCRIPT_CONTEXT_LOST";
      else if (/Receiving end does not exist|message (?:port|channel) closed|Extension context invalidated|Could not establish connection/i.test(message)) code = "WIDGET_DISCONNECTED";
    }
    return sanitizeDiagnostic({ ...context, ...error?.details, code, networkCode, systemCode: error?.details?.systemCode || (Object.hasOwn(systemCodes, error?.code) ? error.code : undefined), errorName: error?.name, occurredAt: new Date().toISOString() });
  }

  function describeDiagnostic(input) {
    const d = sanitizeDiagnostic(input);
    if (!d) return null;
    let [reason, action] = failures[d.code];
    if (d.code === "SWIPE_TIMEOUT" && d.page) reason = `第 ${d.page} 页明细加载超时`;
    if (d.code === "SWIPE_NEXT" && d.page) reason = `无法切换到第 ${d.page} 页明细`;
    if (d.code === "SWIPE_CHANGED" && d.expectedTotal !== undefined && d.actualTotal !== undefined) reason = `明细总数从 ${d.expectedTotal} 条变为 ${d.actualTotal} 条`;
    if (d.code === "SWIPE_INCOMPLETE" && d.rowsRead !== undefined && d.expectedTotal !== undefined) reason = `今日明细条数不齐：已读 ${d.rowsRead} / ${d.expectedTotal} 条`;
    if (d.systemCode) reason += `（${systemCodes[d.systemCode]}，${d.systemCode}）`;
    if (d.networkCode) reason += `（${d.networkCode}）`;
    return { reason, action, stage: stages[d.stage] };
  }

  function diagnosticReport(input, { version = "", status = "" } = {}) {
    const d = sanitizeDiagnostic(input);
    if (!d) return "";
    const description = describeDiagnostic(d);
    const lines = ["SLAI 考勤小组件 · 排错信息"];
    if (/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(version)) lines.push(`扩展版本：${version}`);
    if (d.occurredAt) lines.push(`发生时间：${d.occurredAt}`);
    lines.push(`错误代码：${d.code}`, `失败阶段：${description.stage}`, `直接原因：${description.reason}`);
    if (d.operation) lines.push(`失败操作：${operations[d.operation]}`);
    if (d.readerMethod) lines.push(`读取方法：${d.readerMethod}`);
    if (d.errorName) lines.push(`异常类型：${d.errorName}`);
    if (d.page !== undefined) lines.push(`目标页：第 ${d.page} 页`);
    if (d.currentPage !== undefined) lines.push(`页面当前显示：第 ${d.currentPage} 页`);
    if (d.rowsRead !== undefined) lines.push(`已读取：${d.rowsRead} 条`);
    if (d.expectedTotal !== undefined) lines.push(`预期总数：${d.expectedTotal} 条`);
    if (d.actualTotal !== undefined) lines.push(`页面总数：${d.actualTotal} 条`);
    if (d.timeoutMs !== undefined) lines.push(`等待上限：${d.timeoutMs / 1000} 秒`);
    if (d.httpStatus !== undefined) lines.push(`HTTP 状态：${d.httpStatus}`);
    if (d.port !== undefined) lines.push(`服务端口：${d.port}`);
    if (d.retryAfterSeconds !== undefined) lines.push(`重试间隔：${d.retryAfterSeconds} 秒`);
    if (status === "partial") lines.push("当前结果：历史采用学校汇总；今日仅保留上次完整结果，实时估算已暂停");
    else if (status === "auth") lines.push("当前结果：等待登录，自动刷新已暂停");
    else if (status === "error") lines.push("当前结果：本次读取未成功更新");
    lines.push(`建议操作：${description.action}`);
    return lines.join("\n");
  }

  function codedError(code, details = {}, cause) {
    return Object.assign(new Error(Object.hasOwn(failures, code) ? code : "UNEXPECTED_ERROR"), { code, details, name: errorNames.includes(cause?.name) ? cause.name : "Error" });
  }
  globalThis.__slaiErrors = { codedError, diagnoseError, sanitizeDiagnostic, describeDiagnostic, diagnosticReport };
})();
