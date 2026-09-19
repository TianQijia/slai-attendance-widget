(() => {
  if (location.origin !== 'https://stu.slai.edu.cn' || window.top !== window || globalThis.__slaiSchoolViewport) return;
  globalThis.__slaiSchoolViewport = true;
  // The desktop portal sets user-scalable=no on a phone-width viewport. Give
  // its fixed-width layout room, then let WebView fit it and allow user zoom.
  const content = 'width=1280, minimum-scale=0.1, maximum-scale=5, user-scalable=yes';
  function repair() {
    if (!document.head) return;
    let metas = [...document.querySelectorAll('meta[name="viewport" i]')];
    if (!metas.length) {
      const meta = document.createElement('meta');
      meta.name = 'viewport';
      document.head.append(meta);
      metas = [meta];
    }
    for (const meta of metas) if (meta.content !== content) meta.content = content;
  }
  new MutationObserver(repair).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['name', 'content'] });
  repair();
})();
