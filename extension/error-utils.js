(() => {
  // Only fixed text and allowlisted structural facts may reach storage or UI.
  const failures = {
    IOS_USERSCRIPTS_UNAVAILABLE: ["没有取得 Userscripts 的本机存储接口", "请用 Userscripts 导入完整 .user.js 文件，确认脚本已启用且允许访问学校两个域名；不要作为书签脚本运行。"],
    IOS_FRAME_ACCESS_DENIED: ["Safari 不允许读取当前内嵌学校页面，具体跳转原因无法读取", "打开学校页面核对登录状态；确认 Userscripts 获准访问学生系统和登录站点。仍失败时请复制排错信息。"],
    IOS_FRAME_BLOCKED: ["当前页面的安全策略阻止了内嵌采集页", "请复制排错信息反馈；当前 Safari 采集方式需要学校页面允许同源内嵌。"],
    IOS_FRAME_LOAD_FAILED: ["Safari 对内嵌学校页面触发了加载错误事件", "打开学校系统查看浏览器提示，再手动刷新；该事件没有提供具体网络或登录原因。"],
    IOS_COLLECTION_INTERRUPTED: ["Safari 页面离开前台，本次手动采集已中断", "保持此标签页在前台，点击刷新重新读取；上次完整快照仍保留。"],
    IOS_BUSY: ["已有一次学校采集正在进行", "等待本次采集完成后再操作。"],
    ANDROID_WEBVIEW_UNAVAILABLE: ["Android 内置浏览器不可用或缺少所需功能", "安装或更新 Android System WebView / Chrome，然后重新打开应用。"],
    ANDROID_BRIDGE_UNAVAILABLE: ["安卓界面未能连接本机采集组件", "关闭应用后重新打开；若仍失败，请复制排错信息。"],
    ANDROID_NATIVE_TIMEOUT: ["等待安卓本机组件响应超时", "关闭应用后重新打开，再手动刷新；超时不能确定学校网络状态。"],
    ANDROID_READER_TIMEOUT: ["内置浏览器未在等待上限内返回页面读取结果", "打开学校页面核对加载情况，返回后手动刷新。"],
    ANDROID_BUSY: ["已有一次学校采集正在进行", "等待本次采集完成后，再登录、退出或刷新。"],
    ANDROID_COLLECTION_INTERRUPTED: ["应用离开前台，本次手动采集已中断", "保持应用在前台，点击刷新重新读取；上次完整快照仍保留。"],
    ANDROID_DNS_FAILED: ["内置浏览器报告学校域名解析失败", "检查手机网络能否打开学校网站，然后手动刷新。"],
    ANDROID_CONNECT_FAILED: ["内置浏览器未能建立到学校页面的连接", "检查手机网络及学校网站是否可访问，然后手动刷新。"],
    ANDROID_TLS_FAILED: ["内置浏览器报告学校 HTTPS 证书或握手错误", "检查手机日期时间与学校网站证书；应用不会忽略证书错误。"],
    ANDROID_HTTP_FAILED: ["学校页面返回了错误 HTTP 状态", "根据报告中的 HTTP 状态码，在学校网站核对服务状态后重试。"],
    ANDROID_RENDERER_GONE: ["Android 内置浏览器的页面进程已结束", "关闭应用后重新打开，再手动刷新；上次完整缓存仍保留。"],
    INVALID_SCHEMA: ["收到的数据不符合允许的状态格式", "更新到相同版本后重试；若仍失败，请复制排错信息反馈。"],
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
    SWIPE_SCRIPT_URL: ["下一页控件依赖当前采集器不支持的脚本链接", "请在学校页面手动核对记录并复制排错信息反馈，以便适配该分页控件；本次未执行脚本链接。"],
    SWIPE_LIMIT: ["当前考勤日所需明细合计超过 50 页", "先在学校系统核对当天记录范围，再反馈排错信息。"],
    ATTENDANCE_DAY_CHANGED: ["读取期间跨过05:00，旧考勤日结果未作为新一天成功保存", "点击刷新，重新读取新考勤日；旧日未闭合区间不计入新一天。"],
    SWIPE_URL: ["明细页跳转到了不支持的页面", "打开学校记录页检查跳转情况，再刷新。"],
    SCRIPT_PERMISSION: ["浏览器拒绝扩展读取学校页面", "在扩展管理中检查学校站点访问权限，再重新加载扩展。"],
    SCRIPT_CONTEXT_LOST: ["读取脚本的页面环境因跳转而失效", "等待学校页面稳定后刷新；若反复发生，请反馈排错信息。"],
    PAGE_NETWORK_ERROR: ["浏览器报告学校页面加载错误", "打开学校系统查看浏览器的具体网络或证书提示，再重试。"],
    STORAGE_READ_FAILED: ["浏览器未能读取本机考勤缓存", "重新打开小组件后重试；若仍失败，请反馈排错信息。"],
    STORAGE_WRITE_FAILED: ["浏览器未能保存本次考勤结果", "重新打开小组件后重试；本次结果尚未成功保存。"],
    SCHEDULE_FAILED: ["浏览器未能设置下一次自动刷新", "重新加载扩展后检查刷新提示。"],
    WIDGET_DISCONNECTED: ["小窗与扩展后台的连接已断开", "关闭小窗，在扩展管理中重新加载扩展，再打开小窗。"],
    READ_FAILED: ["发生尚未分类的异常，直接原因尚未识别", "复制包含失败阶段和异常类型的排错信息反馈。"],
    UNEXPECTED_ERROR: ["发生尚未分类的异常，直接原因尚未识别", "复制包含失败阶段和异常类型的排错信息反馈。"]
  };
  const stages = {
    open_portal: "打开学校首页", find_attendance: "查找考勤入口",
    open_summary: "打开月度汇总", read_summary: "读取月度汇总",
    open_swipes: "打开今日明细", read_swipes: "读取明细分页",
    advance_swipes: "切换下一页明细", save_state: "保存考勤结果",
    read_cache: "读取本机缓存", widget_request: "界面请求本机组件", unknown: "阶段尚未记录"
  };
  const operations = {
    create_tab: "创建采集页", get_tab: "获取采集页", navigate: "等待页面加载",
    inject_reader: "注入读取脚本", read_page: "运行页面读取脚本", advance_page: "点击分页控件", set_page_size: "设置每页 90 条",
    storage_get: "读取本机存储", storage_set: "写入本机存储", schedule: "设置刷新计划",
    get_state: "获取考勤状态", refresh: "请求刷新", login: "打开登录页", open_portal: "打开学校系统", logout: "退出学校账号"
  };
  const methods = ["findAttendanceUrl", "extractAttendance", "extractSwipePage", "setSwipePageSize", "advanceSwipePage"];
  const errorNames = ["Error", "TypeError", "ReferenceError", "RangeError", "SyntaxError", "DOMException", "TimeoutError", "SecurityError", "QuotaExceededError"];
  const networkCodes = ["ERR_NAME_NOT_RESOLVED", "ERR_CONNECTION_TIMED_OUT", "ERR_CONNECTION_RESET", "ERR_CONNECTION_REFUSED", "ERR_INTERNET_DISCONNECTED", "ERR_NETWORK_CHANGED", "ERR_CERT_AUTHORITY_INVALID", "ERR_CERT_DATE_INVALID", "ERR_CERT_COMMON_NAME_INVALID", "ERR_SSL_PROTOCOL_ERROR", "ERR_TUNNEL_CONNECTION_FAILED", "ERR_PROXY_CONNECTION_FAILED"];
  const systemCodes = { EACCES: "操作系统拒绝访问", EPERM: "操作系统不允许此操作", ENOSPC: "存储空间不足", EIO: "操作系统报告输入输出错误", EADDRINUSE: "地址已被占用", EADDRNOTAVAIL: "此地址当前不可用", EMFILE: "此进程已打开过多文件", ENFILE: "系统已打开过多文件", ENOENT: "所需文件或目录不存在", ECONNREFUSED: "连接被拒绝", ECONNRESET: "连接被重置", ETIMEDOUT: "连接超时", EHOSTUNREACH: "目标主机不可达", ENETUNREACH: "目标网络不可达" };
  systemCodes.EEXIST = "路径已被现有文件或目录占用";
  systemCodes.ENOTDIR = "路径中的一项不是目录";
  const numericFields = { page: [1, 51], currentPage: [1, 10000], rowsRead: [0, 1000000], pageRowCount: [0, 1000000], expectedTotal: [0, 1000000], actualTotal: [0, 1000000], timeoutMs: [0, 1200000], httpStatus: [100, 599], port: [1, 65535], retryAfterSeconds: [0, 60] };
  const tableStates = { loading: "表格仍显示加载标记", empty: "已确认空表", rows: "已识别明细行", unrecognized: "存在表格，但未识别到明细行或有效空表标记", missing: "尚未出现表格" };

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
    if (Object.hasOwn(tableStates, input.tableState)) result.tableState = input.tableState;
    for (const field of ['queryDate', 'filterStartDate', 'filterEndDate']) {
      const value = input[field];
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
          Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value) result[field] = value;
    }
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
    if (d.code === "ANDROID_HTTP_FAILED" && d.httpStatus) reason = `学校页面返回 HTTP ${d.httpStatus}`;
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
    if (/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(version)) lines.push(`应用版本：${version}`);
    if (d.occurredAt) lines.push(`发生时间：${d.occurredAt}`);
    lines.push(`错误代码：${d.code}`, `失败阶段：${description.stage}`, `直接原因：${description.reason}`);
    if (d.operation) lines.push(`失败操作：${operations[d.operation]}`);
    if (d.readerMethod) lines.push(`读取方法：${d.readerMethod}`);
    if (d.errorName) lines.push(`异常类型：${d.errorName}`);
    if (d.queryDate) lines.push(`正在查询：${d.queryDate}`);
    if (d.filterStartDate) lines.push(`页面开始日期：${d.filterStartDate}`);
    if (d.filterEndDate) lines.push(`页面结束日期：${d.filterEndDate}`);
    if (d.tableState) lines.push(`表格状态：${tableStates[d.tableState]}`);
    if (d.page !== undefined) lines.push(`目标页：第 ${d.page} 页`);
    if (d.currentPage !== undefined) lines.push(`页面当前显示：第 ${d.currentPage} 页`);
    if (d.rowsRead !== undefined) lines.push(`已读取：${d.rowsRead} 条`);
    if (d.pageRowCount !== undefined) lines.push(`当前页已识别：${d.pageRowCount} 条`);
    if (d.expectedTotal !== undefined) lines.push(`预期总数：${d.expectedTotal} 条`);
    if (d.actualTotal !== undefined) lines.push(`页面总数：${d.actualTotal} 条`);
    if (d.timeoutMs !== undefined) lines.push(`等待上限：${d.timeoutMs / 1000} 秒`);
    if (d.httpStatus !== undefined) lines.push(`HTTP 状态：${d.httpStatus}`);
    if (d.port !== undefined) lines.push(`服务端口：${d.port}`);
    if (d.retryAfterSeconds !== undefined) lines.push(`重试间隔：${d.retryAfterSeconds} 秒`);
    if (status === "partial") lines.push("当前结果：历史采用学校汇总；今日仅保留上次完整结果，实时估算已暂停");
    else if (status === "auth") lines.push("当前结果：等待登录，学校采集已暂停");
    else if (status === "error") lines.push("当前结果：本次读取未成功更新");
    lines.push(`建议操作：${description.action}`);
    return lines.join("\n");
  }

  function codedError(code, details = {}, cause) {
    return Object.assign(new Error(Object.hasOwn(failures, code) ? code : "UNEXPECTED_ERROR"), { code, details, name: errorNames.includes(cause?.name) ? cause.name : "Error" });
  }
  globalThis.__slaiErrors = { codedError, diagnoseError, sanitizeDiagnostic, describeDiagnostic, diagnosticReport };
})();
