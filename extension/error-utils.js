(() => {
  // Only fixed text and allowlisted structural facts may reach storage or UI.
  const failures = {
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
    open_portal: "打开学校首页", find_attendance: "查找考勤入口",
    open_summary: "打开月度汇总", read_summary: "读取月度汇总",
    open_swipes: "打开今日明细", read_swipes: "读取明细分页",
    advance_swipes: "切换下一页明细", save_state: "保存考勤结果",
    read_cache: "读取本机缓存", widget_request: "小窗联系扩展后台", unknown: "阶段尚未记录"
  };
  const operations = {
    create_tab: "创建采集页", get_tab: "获取采集页", navigate: "等待页面加载",
    inject_reader: "注入读取脚本", read_page: "运行页面读取脚本", advance_page: "点击分页控件",
    storage_get: "读取本机存储", storage_set: "写入本机存储", schedule: "设置刷新计划",
    get_state: "获取小窗状态", refresh: "请求刷新", login: "打开登录页", open_portal: "打开学校系统"
  };
  const methods = ["findAttendanceUrl", "extractAttendance", "extractSwipePage", "advanceSwipePage"];
  const errorNames = ["Error", "TypeError", "ReferenceError", "RangeError", "SyntaxError", "DOMException", "TimeoutError"];
  const networkCodes = ["ERR_NAME_NOT_RESOLVED", "ERR_CONNECTION_TIMED_OUT", "ERR_CONNECTION_RESET", "ERR_CONNECTION_REFUSED", "ERR_INTERNET_DISCONNECTED", "ERR_NETWORK_CHANGED", "ERR_CERT_AUTHORITY_INVALID", "ERR_CERT_DATE_INVALID", "ERR_CERT_COMMON_NAME_INVALID", "ERR_SSL_PROTOCOL_ERROR", "ERR_TUNNEL_CONNECTION_FAILED", "ERR_PROXY_CONNECTION_FAILED"];
  const numericFields = { page: [1, 51], currentPage: [1, 10000], rowsRead: [0, 1000000], expectedTotal: [0, 1000000], actualTotal: [0, 1000000], timeoutMs: [0, 300000] };

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
    return sanitizeDiagnostic({ ...context, ...error?.details, code, networkCode, errorName: error?.name, occurredAt: new Date().toISOString() });
  }

  function describeDiagnostic(input) {
    const d = sanitizeDiagnostic(input);
    if (!d) return null;
    let [reason, action] = failures[d.code];
    if (d.code === "SWIPE_TIMEOUT" && d.page) reason = `第 ${d.page} 页明细加载超时`;
    if (d.code === "SWIPE_NEXT" && d.page) reason = `无法切换到第 ${d.page} 页明细`;
    if (d.code === "SWIPE_CHANGED" && d.expectedTotal !== undefined && d.actualTotal !== undefined) reason = `明细总数从 ${d.expectedTotal} 条变为 ${d.actualTotal} 条`;
    if (d.code === "SWIPE_INCOMPLETE" && d.rowsRead !== undefined && d.expectedTotal !== undefined) reason = `今日明细条数不齐：已读 ${d.rowsRead} / ${d.expectedTotal} 条`;
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
    if (status === "partial") lines.push("当前结果：仅显示学校汇总，实时估算已暂停");
    else if (status === "auth") lines.push("当前结果：等待登录，自动刷新已暂停");
    else if (status === "error") lines.push("当前结果：本次读取未成功更新");
    lines.push(`建议操作：${description.action}`);
    return lines.join("\n");
  }

  globalThis.__slaiErrors = { diagnoseError, sanitizeDiagnostic, describeDiagnostic, diagnosticReport };
})();
