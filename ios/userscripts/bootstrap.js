function bootSafari({ markup, css, storage, makeReader, mountView, version }) {
  const ownerDocument = window.document;
  if (ownerDocument.getElementById('slai-safari-panel')) return;
  const element = ownerDocument.createElement('aside');
  element.id = 'slai-safari-panel';
  element.setAttribute('aria-label', 'SLAI 考勤面板');
  const shadow = element.attachShadow({ mode: 'open' });
  // Constructed stylesheets work in Safari 16.4+ without inline page scripts.
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    shadow.adoptedStyleSheets = [sheet];
  } catch {
    const style = ownerDocument.createElement('style');
    style.textContent = css;
    shadow.append(style);
  }
  const body = ownerDocument.createElement('div');
  body.className = 'slai-body desktop';
  body.innerHTML = markup;
  shadow.append(body);
  const returnButton = ownerDocument.createElement('button');
  returnButton.id = 'returnPanel';
  returnButton.textContent = '返回考勤并刷新';
  returnButton.type = 'button';
  shadow.append(returnButton);
  ownerDocument.documentElement.append(element);

  let viewport = ownerDocument.querySelector('meta[name="viewport"]');
  const originalViewport = viewport?.getAttribute('content');
  const viewportExisted = !!viewport;
  function placeSchoolButton() {
    const visible = window.visualViewport;
    const scale = visible?.scale || 1;
    element.style.setProperty('--school-control-scale', String(1 / scale));
    element.style.setProperty('--school-control-left', `${(visible?.offsetLeft || 0) + (visible?.width || window.innerWidth) - 12 / scale}px`);
    element.style.setProperty('--school-control-top', `${(visible?.offsetTop || 0) + (visible?.height || window.innerHeight) - 16 / scale}px`);
  }
  window.visualViewport?.addEventListener('resize', placeSchoolButton);
  window.visualViewport?.addEventListener('scroll', placeSchoolButton);
  function onSchoolMode(enabled) {
    element.classList.toggle('school-mode', enabled);
    if (enabled) {
      if (viewportExisted) viewport.setAttribute('content', originalViewport || '');
      else viewport?.remove();
    } else {
      if (!viewport?.isConnected) {
        viewport = ownerDocument.createElement('meta');
        viewport.name = 'viewport';
        ownerDocument.head.append(viewport);
      }
      viewport.content = 'width=device-width, initial-scale=1, viewport-fit=cover';
    }
    placeSchoolButton();
  }
  onSchoolMode(false);
  // The shared view sees only its own UI; school markup remains unmodified.
  const document = {
    body, documentElement: element,
    get activeElement() { return shadow.activeElement; },
    getElementById: id => shadow.getElementById(id),
    querySelector: selector => shadow.querySelector(selector),
    querySelectorAll: selector => shadow.querySelectorAll(selector),
    createElement: tag => ownerDocument.createElement(tag)
  };
  const { host, chrome } = makeSafariHost({ storage, ownerDocument, makeReader, version, onSchoolMode });
  globalThis.chrome = chrome;
  host.refresh = makeCollector(chrome, host.getState, host.saveState);
  mountView({ document, chrome, host, ownerDocument, onSchoolMode });
}
