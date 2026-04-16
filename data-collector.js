/**
 * Game Data Collector
 * Collects interaction data and commits to GitHub repo as JSONL.
 */
(function () {
  const REPO_OWNER = 'can-celebi';
  const REPO_NAME = 'games';
  const _k = 'Z2l0aHViX3BhdF8xMUFOWkFDN1EwTnp4bWJWYVhqV3hTX3' +
    'dOOUw3YllJcmZPc3RsbzlIaGFESkhYcXpKZUFVSzZhUUR4MG01UUlCZExKRFZDSlFBUHhvVU5MTkNt';
  const TOKEN = atob(_k);
  const API_BASE = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents`;

  // Unique session ID + load time
  const SESSION_ID = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
  const PAGE_LOAD_TIME = performance.now();
  const LOAD_TIMESTAMP = new Date().toISOString();

  let gameName = '';

  // Data arrays
  const mouseTrail = [];   // { t, x, y }
  const keyEvents = [];    // { t, key, dir } dir = 'down' | 'up'
  const customEvents = []; // { t, type, ...detail }

  // Mouse/touch sampling (throttled to ~60fps = 16ms)
  let lastMouseT = 0;
  const MOUSE_THROTTLE = 16;

  function t() { return Math.round(performance.now() - PAGE_LOAD_TIME); }

  function onPointerMove(e) {
    const now = performance.now();
    if (now - lastMouseT < MOUSE_THROTTLE) return;
    lastMouseT = now;
    mouseTrail.push({ t: t(), x: Math.round(e.clientX), y: Math.round(e.clientY) });
  }

  function onTouchMove(e) {
    const now = performance.now();
    if (now - lastMouseT < MOUSE_THROTTLE) return;
    lastMouseT = now;
    const touch = e.touches[0];
    if (touch) mouseTrail.push({ t: t(), x: Math.round(touch.clientX), y: Math.round(touch.clientY) });
  }

  function onKeyDown(e) {
    keyEvents.push({ t: t(), key: e.key, dir: 'down' });
  }

  function onKeyUp(e) {
    keyEvents.push({ t: t(), key: e.key, dir: 'up' });
  }

  function init(name, opts) {
    gameName = name;
    opts = opts || {};

    // Always track mouse/touch
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchstart', function (e) {
      const touch = e.touches[0];
      if (touch) mouseTrail.push({ t: t(), x: Math.round(touch.clientX), y: Math.round(touch.clientY) });
    }, { passive: true });

    // Track keys if requested
    if (opts.trackKeys) {
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
    }
  }

  function logEvent(type, detail) {
    customEvents.push({ t: t(), type, ...(detail || {}) });
  }

  async function save(result) {
    const record = {
      id: SESSION_ID,
      timestamp: LOAD_TIMESTAMP,
      game: gameName,
      duration_ms: Math.round(performance.now() - PAGE_LOAD_TIME),
      is_mobile: ('ontouchstart' in window) || (navigator.maxTouchPoints > 0),
      user_agent: navigator.userAgent,
      screen: { w: screen.width, h: screen.height },
      result: result || null,
      mouse: mouseTrail,
      keys: keyEvents.length > 0 ? keyEvents : undefined,
      events: customEvents.length > 0 ? customEvents : undefined
    };

    const line = JSON.stringify(record) + '\n';
    const filePath = `data/${gameName}.jsonl`;

    try {
      let existingContent = '';
      let sha = null;

      const getResp = await fetch(`${API_BASE}/${filePath}`, {
        headers: { 'Authorization': `Bearer ${TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
      });

      if (getResp.ok) {
        const fileData = await getResp.json();
        sha = fileData.sha;
        existingContent = atob(fileData.content.replace(/\n/g, ''));
      }

      const newContent = existingContent + line;

      const putBody = {
        message: `data: ${gameName} ${SESSION_ID.slice(0, 8)}`,
        content: btoa(unescape(encodeURIComponent(newContent))),
        committer: { name: 'Game Data Bot', email: 'data@games.bot' }
      };
      if (sha) putBody.sha = sha;

      const putResp = await fetch(`${API_BASE}/${filePath}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(putBody)
      });

      if (putResp.ok) {
        console.log('[data-collector] Saved successfully');
        return true;
      } else {
        const err = await putResp.json();
        console.warn('[data-collector] Save failed:', putResp.status, err.message);
        if (putResp.status === 409) {
          console.log('[data-collector] Conflict, retrying...');
          return await save(result);
        }
      }
    } catch (e) {
      console.warn('[data-collector] Error:', e.message);
      const stored = JSON.parse(localStorage.getItem('game_data_fallback') || '[]');
      stored.push(record);
      localStorage.setItem('game_data_fallback', JSON.stringify(stored));
    }
    return false;
  }

  window.GameData = { init, logEvent, save, SESSION_ID };
})();
