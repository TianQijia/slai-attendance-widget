(() => {
  const validId = value => typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
  const instant = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
  const pending = value => value?.status === "queued" || value?.status === "running";
  function sanitizeRefresh(value) {
    if (!value || value.schemaVersion !== 1 || typeof value.available !== "boolean") return null;
    const result = { schemaVersion: 1, available: value.available, cooldownUntil: instant(value.cooldownUntil) ? value.cooldownUntil : null, request: null };
    if (value.request) {
      const r = value.request;
      if (!validId(r.id) || !["queued", "running", "succeeded", "failed"].includes(r.status) || !instant(r.requestedAt)) return null;
      result.request = { id: r.id, status: r.status, requestedAt: r.requestedAt, startedAt: instant(r.startedAt) ? r.startedAt : null, finishedAt: instant(r.finishedAt) ? r.finishedAt : null, diagnostic: globalThis.__slaiErrors.sanitizeDiagnostic(r.diagnostic) };
    }
    return result;
  }
  globalThis.__slaiRefresh = { validId, pending, sanitizeRefresh };
})();
