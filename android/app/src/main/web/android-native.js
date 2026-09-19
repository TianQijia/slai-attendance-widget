(() => {
  let serial = 0;
  const pending = new Map();
  globalThis.__slaiNative = (operation, args = {}) => new Promise((resolve, reject) => {
    const id = String(++serial);
    const timeoutMs = operation === 'school.navigate' ? 35000 : 7000;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(globalThis.__slaiErrors.codedError('ANDROID_NATIVE_TIMEOUT', { timeoutMs }));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timeout });
    try { SlaiNative.postMessage(JSON.stringify({ id, operation, args })); }
    catch {
      clearTimeout(timeout); pending.delete(id);
      reject(globalThis.__slaiErrors.codedError('ANDROID_BRIDGE_UNAVAILABLE'));
    }
  });
  if (globalThis.SlaiNative) SlaiNative.onmessage = event => {
    let response;
    try { response = JSON.parse(event.data); } catch { return; }
    const item = pending.get(response.id);
    if (!item) return;
    pending.delete(response.id); clearTimeout(item.timeout);
    if (response.ok) item.resolve(response.value);
    else item.reject(globalThis.__slaiErrors.codedError(response.code, response.details));
  };
})();
