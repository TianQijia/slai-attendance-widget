(() => {
  function setReportText(element, text, status) {
    // Replacing identical text destroys a mobile browser's selection.
    if (element.textContent === text) return;
    element.textContent = text;
    if (status) status.textContent = "";
  }

  async function copyReport(element, status, successText) {
    const text = element.textContent;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = successText;
      return;
    } catch { /* HTTP and browser permissions can disable the Clipboard API. */ }

    // A native text field supports the iOS selection menu. Keep this snapshot
    // separate from live reports so polling cannot erase a user's selection.
    const dialog = document.createElement("dialog");
    dialog.className = "manual-copy";
    dialog.setAttribute("aria-label", "手动复制报告");
    const label = document.createElement("label");
    label.textContent = "手动复制本次报告";
    const field = document.createElement("textarea");
    field.readOnly = true;
    field.rows = 10;
    field.value = text;
    field.setAttribute("aria-label", "可手动复制的报告");
    label.append(field);
    const hint = document.createElement("p");
    hint.textContent = "自动复制不可用。请长按文本框，选择“全选／复制”；电脑可按 Ctrl+C 或 ⌘C。";
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "关闭手动复制";
    close.addEventListener("click", () => dialog.close());
    dialog.append(label, hint, close);
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();
    field.focus({ preventScroll: true });
    field.select();
    field.setSelectionRange(0, text.length);
    status.textContent = "自动复制未获允许，请在文本框中手动复制报告。";
  }

  globalThis.__slaiReports = { setReportText, copyReport };
})();
