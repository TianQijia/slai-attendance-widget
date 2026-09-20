// Safari owns the school session. This adapter reads only same-origin pages;
// no session URL, student identifier or raw page is sent to Userscripts storage.
function makeSafariHost({ storage, ownerDocument, makeReader, version, onSchoolMode }) {
  const { codedError, diagnoseError } = globalThis.__slaiErrors;
  const clean = input => globalThis.__slaiState.sanitizeState({ ...input, nextRefreshAt: null });
  const portal = 'https://stu.slai.edu.cn/';
  const authOrigin = 'https://sts.slai.edu.cn';
  const listeners = new Set();
  const event = { addListener() {}, removeListener() {} };
  let state = clean({});
  let initialized = false;
  let active = false;
  let frame = null;
  let frameError = null;
  let rejectNavigation = null;
  let generation = 0;

  async function read(key, fallback) {
    if (typeof storage.getValue !== 'function') throw codedError('IOS_USERSCRIPTS_UNAVAILABLE', { stage: 'read_cache', operation: 'storage_get' });
    try { return await storage.getValue(key, fallback); }
    catch (cause) { throw codedError('STORAGE_READ_FAILED', { stage: 'read_cache', operation: 'storage_get' }, cause); }
  }
  async function write(key, value) {
    if (typeof storage.setValue !== 'function') throw codedError('IOS_USERSCRIPTS_UNAVAILABLE', { stage: 'save_state', operation: 'storage_set' });
    try { await storage.setValue(key, value); }
    catch (cause) { throw codedError('STORAGE_WRITE_FAILED', { stage: 'save_state', operation: 'storage_set' }, cause); }
  }
  function broadcast() {
    for (const fn of listeners) fn({ type: 'attendance-state', state });
  }
  async function load() {
    if (!initialized) { state = clean(await read('attendance-state-v5', {})); initialized = true; }
    return state;
  }
  function fail(error) {
    if (!active || frameError) return;
    frameError = error;
    rejectNavigation?.(error);
  }
  function closeFrame() {
    generation++;
    rejectNavigation?.(frameError || codedError('TAB_CLOSED'));
    rejectNavigation = null;
    frame?.remove();
    frame = null;
  }
  function checkFrame() {
    if (frameError) throw frameError;
    if (!active || !frame?.isConnected) throw codedError('TAB_CLOSED');
    try {
      const target = frame.contentWindow;
      const url = target.location.href;
      if (new URL(url).origin === authOrigin) throw codedError('AUTH_EXPIRED');
      if (new URL(url).origin !== new URL(portal).origin) throw codedError('PORTAL_URL');
      return { id: 1, url, status: target.document.readyState === 'complete' ? 'complete' : 'loading' };
    } catch (cause) {
      if (typeof cause?.code === 'string') throw cause;
      throw codedError('IOS_FRAME_ACCESS_DENIED', {}, cause);
    }
  }
  // A login redirect is the ONLY cross-origin message supported. Source and
  // origin must both identify our current collector, never an arbitrary frame.
  window.addEventListener('message', event => {
    if (event.isTrusted && active && frame && event.source === frame.contentWindow && event.origin === authOrigin &&
        event.data?.type === 'slai-login-required' && event.data?.version === 1) {
      fail(codedError('AUTH_EXPIRED'));
    }
  });
  ownerDocument.addEventListener('securitypolicyviolation', event => {
    if (active && ['frame-src', 'child-src'].includes(event.effectiveDirective) && frame &&
        (event.blockedURI === frame.src || event.blockedURI === new URL(portal).origin)) {
      fail(codedError('IOS_FRAME_BLOCKED', { operation: 'navigate' }));
    }
  });
  function interrupt() { if (active) fail(codedError('IOS_COLLECTION_INTERRUPTED')); }
  ownerDocument.addEventListener('visibilitychange', () => { if (ownerDocument.hidden) interrupt(); });
  window.addEventListener('pagehide', interrupt);

  async function navigate(url) {
    if (frameError) throw frameError;
    let parsed;
    try { parsed = new URL(url); } catch { throw codedError('PORTAL_URL'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port ||
        !['stu.slai.edu.cn', 'sts.slai.edu.cn'].includes(parsed.hostname)) throw codedError('PORTAL_URL');
    if (parsed.origin === authOrigin) throw codedError('AUTH_EXPIRED');
    closeFrame();
    const ownGeneration = generation;
    const next = ownerDocument.createElement('iframe');
    next.title = '学校考勤采集';
    next.setAttribute('aria-hidden', 'true');
    next.tabIndex = -1;
    // Keep layout/visibility available for the shared reader's table checks.
    next.style.cssText = 'position:fixed;left:-10000px;top:0;width:1280px;height:900px;border:0;opacity:0;pointer-events:none;';
    frame = next;
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = (error, tab) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (rejectNavigation === cancel) rejectNavigation = null;
        if (error) { frameError = error; reject(error); } else resolve(tab);
      };
      const cancel = error => finish(error);
      rejectNavigation = cancel;
      const timer = setTimeout(() => finish(codedError('PAGE_TIMEOUT', { operation: 'navigate', timeoutMs: 30000 })), 30000);
      next.addEventListener('error', () => finish(codedError('IOS_FRAME_LOAD_FAILED', { operation: 'navigate' })));
      next.addEventListener('load', async () => {
        if (ownGeneration !== generation || finished) return;
        // Allow the login marker or Safari's later CSP event to identify the
        // observed failure before reporting an inaccessible/unsupported page.
        try { finish(null, checkFrame()); }
        catch (cause) {
          if (['IOS_FRAME_ACCESS_DENIED', 'PORTAL_URL'].includes(cause.code)) await new Promise(resolve => setTimeout(resolve, 300));
          finish(frameError || cause);
        }
      }, { once: true });
      next.src = url;
      ownerDocument.body.append(next);
    });
  }
  const host = {
    getState: load,
    async saveState(input) {
      const next = clean(input);
      try { await write('attendance-state-v5', next); }
      catch (error) {
        // Keep the last persisted snapshot reliable if saving the new one fails.
        state = clean({ ...state, status: 'error', diagnostic: diagnoseError(error) });
        broadcast();
        throw error;
      }
      state = next;
      broadcast();
    },
    async schoolMode() { return (await read('school-mode', false)) === true; },
    async setSchoolMode(enabled) {
      if (active) throw codedError('IOS_BUSY');
      await write('school-mode', enabled === true);
      onSchoolMode(enabled === true);
    }
  };
  const chrome = {
    storage: { local: {
      get: async () => ({ desktopView: await read('desktop-view', 'calendar') }),
      set: values => write('desktop-view', values.desktopView === 'list' ? 'list' : 'calendar')
    } },
    tabs: {
      onUpdated: event, onRemoved: event,
      create: options => navigate(options.url),
      update: (_id, options) => navigate(options.url),
      get: async () => checkFrame(),
      remove: async () => closeFrame()
    },
    scripting: { async executeScript(options) {
      checkFrame();
      if (options.files) return [];
      const method = options.args?.[0];
      if (!['findAttendanceUrl', 'extractAttendance', 'extractSwipePage', 'setSwipePageSize', 'advanceSwipePage'].includes(method)) throw codedError('SCRIPT_PERMISSION');
      try { return [{ result: makeReader(frame.contentWindow)[method]() }]; }
      catch (cause) {
        if (cause?.name === 'SecurityError') throw codedError('IOS_FRAME_ACCESS_DENIED', {}, cause);
        throw cause;
      }
    } },
    runtime: {
      getManifest: () => ({ version }),
      onMessage: { addListener: fn => listeners.add(fn) },
      async sendMessage(message) {
        if (message.type === 'get-state') return { ok: true, state: await load() };
        if (message.type === 'refresh') {
          if (active) throw codedError('IOS_BUSY');
          await load();
          if (ownerDocument.hidden) throw codedError('IOS_COLLECTION_INTERRUPTED');
          active = true;
          frameError = null;
          try {
            // Persist a frozen snapshot before querying: closing Safari can
            // terminate scripts before pagehide's diagnostic write completes.
            await host.saveState({ ...state, status: 'loading', diagnostic: null });
            await host.refresh();
            return { ok: true, state };
          }
          finally { closeFrame(); active = false; }
        }
        if (message.type === 'login' || message.type === 'open-portal') {
          await host.setSchoolMode(true);
          if (message.type === 'login') window.location.assign(portal);
          return { ok: true };
        }
        if (message.type === 'clear-cache') {
          if (active) throw codedError('IOS_BUSY');
          await host.saveState({});
          return { ok: true, state };
        }
        throw codedError('UNEXPECTED_ERROR');
      }
    }
  };
  return { host, chrome };
}
