(() => {
  const labels = {
    config: "本机配对配置", addresses: "局域网地址", selected: "已选网络地址",
    loopback: "本机查看接口", write: "本机写入端口", lan: "本机访问局域网接口",
    browser: "当前浏览器到服务", extension: "扩展联系", data: "今日完整数据",
    profile: "Windows 网络类型", firewall: "系统应用防火墙", rule: "此程序的放行规则", peer: "跨设备访问"
  };
  // Every report string is fixed text; observed fields below are numbers only.
  const catalog = {
    NET_CONFIG_READY: ["pass", "本机配对配置格式有效。", "使用连接信息页配对扩展。"],
    NET_CONFIG_MISSING: ["warn", "尚未找到本机配对配置。", "先运行 start 启动器，再进行配对。"],
    NET_CONFIG_INVALID: ["fail", "本机配对配置未能读取或验证。", "检查用户数据目录权限，查看附带的错误代码。"],
    NET_LAN_FOUND: ["pass", "找到了私有局域网 IPv4 地址。", "有多个地址时，在启动器选择手机所在网络。"],
    NET_LAN_NONE: ["warn", "没有找到私有局域网 IPv4 地址。", "连接 Wi-Fi 后重新启动服务。"],
    NET_ADDRESS_READY: ["pass", "已选择的地址仍属于本机当前网络。", "使用本机连接信息页中的查看链接。"],
    NET_ADDRESS_MISSING: ["warn", "尚未保存局域网地址选择。", "运行 start 启动器选择当前网络。"],
    NET_ADDRESS_CHANGED: ["fail", "已保存的局域网地址已不属于本机当前网络。", "先运行 stop，再运行 start，使用新生成的查看链接。"],
    NET_ADDRESS_INVALID: ["fail", "已保存的网络选择未能读取或验证。", "运行启动器重新选择网络；若持续失败，反馈此报告。"],
    NET_HTTP_OK: ["pass", "已收到此伴随服务的有效响应。", "继续检查扩展联系与今日数据。"],
    NET_WRITE_READY: ["pass", "写入端口已响应，并按预期拒绝 GET；检测没有写入数据。", "实际上传结果以扩展的手机查看连接状态为准。"],
    NET_REQUEST_FAILED: ["fail", "这次请求未取得预期响应。", "根据附带的拒绝连接、超时或 HTTP 状态检查服务；这些结果不能单独证明校园网拦截。"],
    NET_SKIPPED: ["info", "缺少前置条件，此项未检测。", "先处理配对配置、地址选择或本机查看接口的问题，再运行检测。"],
    NET_EXTENSION_RECENT: ["pass", "扩展在 150 秒内联系过本次服务进程。", "保持 Chrome 与伴随服务运行。"],
    NET_EXTENSION_NEVER: ["warn", "本次服务进程尚未收到扩展联系。", "打开 Chrome，启用手机查看并配对；服务重启后等待最多一分钟再检测。"],
    NET_EXTENSION_OLD: ["warn", "扩展超过 150 秒未联系。", "检查 Chrome 是否运行及扩展手机查看区的连接排错信息。"],
    NET_DATA_FRESH: ["pass", "存在当天完整快照，且未超过 35 分钟。", "今天按完整明细估算，历史按学校累计显示。"],
    NET_DATA_MISSING: ["warn", "尚无当天完整快照。", "在电脑扩展中完成学校登录和完整同步；此结果不说明网络被阻止。"],
    NET_DATA_OLD: ["warn", "当天完整快照超过 35 分钟未更新。", "在电脑扩展中检查学校同步；当前应显示冻结结果。"],
    NET_DATA_FROZEN: ["warn", "学校采集状态尚未恢复为完整成功。", "查看扩展里的学校采集诊断；已有完整快照保持冻结。"],
    NET_PROFILE_PRIVATE: ["pass", "所选地址对应专用网络。", "随包规则适用于该网络类型；仍需手机实际访问验证。"],
    NET_PROFILE_PUBLIC: ["warn", "所选地址对应公用网络，随包的专用网络放行规则不适用。", "可用自己的可信热点做对照；在校园网使用时按管理员允许的方式配置访问。"],
    NET_PROFILE_DOMAIN: ["warn", "所选地址对应域网络，随包的专用网络放行规则不适用。", "检查单位管理策略，必要时联系网络管理员。"],
    NET_PROFILE_UNKNOWN: ["info", "未能确认所选地址对应的网络类型。", "在 Windows 设置中查看当前连接的网络类型。"],
    NET_FIREWALL_ON: ["info", "系统应用防火墙已启用。", "检查此程序的放行规则，并用手机实际访问。"],
    NET_FIREWALL_OFF: ["info", "检测到系统应用防火墙未启用。", "检测不会更改此设置；校园网隔离及其他过滤规则仍需另行确认。"],
    NET_FIREWALL_BLOCK_ALL: ["warn", "系统配置为阻止所有入站连接。", "在系统防火墙设置中检查该选项，或联系管理员；检测不会自动修改它。"],
    NET_FIREWALL_UNKNOWN: ["info", "未能读取系统防火墙状态。", "查看附带诊断，并在系统防火墙设置中手动确认。"],
    NET_RULE_READY: ["pass", "检测到了此程序的应用放行规则。", "规则存在不保证校园网或其他规则允许手机访问，仍需跨设备实测。"],
    NET_RULE_MISSING: ["warn", "未找到此程序的显式放行规则。", "Windows 在可信专用网络可运行随包 allow-private-network.ps1；Mac 在系统防火墙选项检查随包 Node。未列出规则不等于已被阻止。"],
    NET_RULE_BLOCKED: ["warn", "此程序的规则被禁用或明确阻止连接。", "在系统防火墙中检查此程序的规则。"],
    NET_RULE_PROGRAM: ["warn", "已有规则指向另一个程序路径。", "检查是否移动或更换过软件目录，更新该程序对应的放行规则。"],
    NET_RULE_SCOPE: ["warn", "已有规则的端口、网络范围或方向与随包规则不一致。", "检查规则是否针对本程序、专用网络、本子网和 TCP 32100。"],
    NET_RULE_UNKNOWN: ["info", "未能确认此程序的应用放行规则。", "在系统防火墙中手动查看此程序，或反馈附带的检测代码。"],
    NET_PEER_UNVERIFIED: ["info", "本机自测无法确认手机到电脑是否可达，也无法据此认定校园网开启了设备隔离。", "手机连接同一网络，打开新查看链接并点“网络检测”。若页面打不开，复制这份电脑报告，并说明浏览器显示的现象。可用自己的热点做对照。"],
    NET_BROWSER_OK: ["pass", "当前浏览器已成功读取服务。", "这次结果只证明当前浏览器到此服务可达。"],
    NET_UNKNOWN: ["info", "检测结果未被识别。", "反馈此报告及使用的软件版本。"]
  };
  const numbers = { port: [1, 65535], httpStatus: [100, 599], timeoutMs: [0, 300000], elapsedMs: [0, 300000], ageSeconds: [0, 315360000], addressCount: [0, 1000] };
  const numberLabels = { port: "端口", httpStatus: "HTTP 状态", timeoutMs: "等待上限（毫秒）", elapsedMs: "请求耗时（毫秒）", ageSeconds: "距上次更新（秒）", addressCount: "候选地址数" };
  function sanitizeReport(input) {
    const output = { schemaVersion: 1, version: /^\d+\.\d+\.\d+$/.test(input?.version) ? input.version : "1.2.0",
      platform: ["darwin", "win32", "browser"].includes(input?.platform) ? input.platform : "other", checks: [] };
    const date = input?.createdAt;
    if (typeof date === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(date) && Number.isFinite(Date.parse(date))) output.createdAt = date;
    for (const check of (Array.isArray(input?.checks) ? input.checks : []).slice(0, 20)) {
      if (!check || !Object.hasOwn(labels, check.id)) continue;
      const next = { id: check.id, code: Object.hasOwn(catalog, check.code) ? check.code : "NET_UNKNOWN" };
      for (const [key, [min, max]] of Object.entries(numbers)) if (Number.isSafeInteger(check[key]) && check[key] >= min && check[key] <= max) next[key] = check[key];
      const diagnostic = globalThis.__slaiErrors.sanitizeDiagnostic(check.diagnostic);
      if (diagnostic) next.diagnostic = diagnostic;
      output.checks.push(next);
    }
    return output;
  }
  function reportText(input) {
    const report = sanitizeReport(input);
    const lines = ["SLAI 网络检测 · 脱敏报告", `软件版本：${report.version}`, `设备平台：${({ darwin: "macOS", win32: "Windows", browser: "查看浏览器", other: "其他" })[report.platform]}`];
    if (report.createdAt) lines.push(`检测时间：${report.createdAt}`);
    for (const check of report.checks) {
      const [level, reason, action] = catalog[check.code];
      lines.push("", `[${({ pass: "通过", warn: "需检查", fail: "未通过", info: "说明" })[level]}] ${labels[check.id]}`, `检测代码：${check.code}`, `检测阶段：${labels[check.id]}`, `直接观测：${reason}`);
      for (const key of Object.keys(numbers)) if (check[key] !== undefined) lines.push(`${numberLabels[key]}：${check[key]}`);
      if (check.diagnostic) lines.push(globalThis.__slaiErrors.diagnosticReport(check.diagnostic));
      lines.push(`下一步：${action}`);
    }
    return lines.join("\n");
  }
  function freshnessChecks(envelope) {
    const time = Date.parse(envelope?.serverTime);
    const age = value => Number.isFinite(Date.parse(value)) && Number.isFinite(time) ? Math.max(0, Math.floor((time - Date.parse(value)) / 1000)) : null;
    const contactAge = age(envelope?.lastSeenAt);
    const extension = { id: "extension", code: contactAge === null ? "NET_EXTENSION_NEVER" : contactAge > 150 ? "NET_EXTENSION_OLD" : "NET_EXTENSION_RECENT" };
    if (contactAge !== null) extension.ageSeconds = contactAge;
    const snapshot = envelope?.state?.lastCompleteToday;
    const dataAge = age(snapshot?.updatedAt);
    const today = Number.isFinite(time) ? globalThis.__slaiTime.localDateKey(new Date(time)) : "";
    const data = { id: "data", code: !snapshot || snapshot.date !== today || dataAge === null ? "NET_DATA_MISSING" : dataAge > 2100 ? "NET_DATA_OLD" : envelope.state.status !== "ok" ? "NET_DATA_FROZEN" : "NET_DATA_FRESH" };
    const detail = globalThis.__slaiErrors.sanitizeDiagnostic(envelope?.diagnostic || envelope?.state?.diagnostic);
    if (detail) data.diagnostic = detail;
    if (dataAge !== null) data.ageSeconds = dataAge;
    return [extension, data];
  }
  globalThis.__slaiNetwork = { sanitizeReport, reportText, freshnessChecks };
  if (typeof module !== "undefined") module.exports = globalThis.__slaiNetwork;
})();
