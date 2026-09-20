(() => {
  const call = globalThis.__slaiNative;
  const listeners = new Set();
  const event = { addListener() {}, removeListener() {} };
  const clean = input => globalThis.__slaiState.sanitizeState({ ...input, nextRefreshAt: null });
  const host = globalThis.__slaiAndroidHost = {
    async getState() { return clean(await call('state.read')); },
    async saveState(input) {
      const state = clean(input);
      await call('state.write', { state });
      for (const fn of listeners) fn({ type: 'attendance-state', state });
    }
  };
  globalThis.chrome = {
    storage: { local: {
      get: async () => ({ desktopView: await call('view.read') }),
      set: values => call('view.write', { view: values.desktopView })
    } },
    tabs: {
      onUpdated: event, onRemoved: event,
      create: options => call('school.navigate', { url: options.url }),
      update: (_id, options) => call('school.navigate', { url: options.url }),
      get: () => call('school.state'),
      remove: () => call('school.close')
    },
    scripting: { executeScript: async options => options.files ? [] : [{ result: await call('school.read', { method: options.args[0] }) }] },
    runtime: {
      getManifest: () => ({ version: document.querySelector('meta[name="slai-version"]').content }),
      onMessage: { addListener: fn => listeners.add(fn) },
      async sendMessage(message) {
        if (message.type === 'get-state') return { ok: true, state: await host.getState() };
        if (message.type === 'refresh') {
          await call('collection.begin');
          try { await host.refresh(); return { ok: true, state: await host.getState() }; }
          finally { await call('collection.end'); }
        }
        if (message.type === 'login' || message.type === 'open-portal') {
          await call('school.show'); return { ok: true };
        }
        if (message.type === 'logout') {
          await call('school.logout');
          return { ok: true, state: await host.getState() };
        }
        throw globalThis.__slaiErrors.codedError('ANDROID_BRIDGE_UNAVAILABLE');
      }
    }
  };
})();
