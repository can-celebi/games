/**
 * Game Data Collector
 * Collects interaction data and commits to GitHub repo as JSONL.
 *
 * Auto-save triggers:
 *   - At 30 seconds (snapshot)
 *   - At 60 seconds (snapshot)
 *   - On page unload / back button
 *   - On explicit GameData.save(result) from game code (choice, win, etc.)
 */
(function () {
  const REPO_OWNER = 'can-celebi';
  const REPO_NAME = 'games';
  const _k = 'Z2l0aHViX3BhdF8xMUFOWkFDN1EwTnp4bWJWYVhqV3hTX3' +
    'dOOUw3YllJcmZPc3RsbzlIaGFESkhYcXpKZUFVSzZhUUR4MG01UUlCZExKRFZDSlFBUHhvVU5MTkNt';
  const TOKEN = atob(_k);
  const API_BASE = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents`;

  const SESSION_ID = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
  const PAGE_LOAD_TIME = performance.now();
  const LOAD_TIMESTAMP = new Date().toISOString();

  let gameName = '';
  let saveCount = 0;  // track how many saves this session
  let saving = false; // prevent concurrent saves

  // Data arrays
  const mouseTrail = [];
  const keyEvents = [];
  const customEvents = [];

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

    // Auto-save at 30s and 60s
    setTimeout(function () { save({ trigger: 'auto_30s' }); }, 30000);
    setTimeout(function () { save({ trigger: 'auto_60s' }); }, 60000);

    // Save on page unload (back button, navigation away)
    window.addEventListener('beforeunload', function () {
      saveBeacon({ trigger: 'unload' });
    });

    // Also handle visibility change (mobile tab switch / app switch)
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') {
        saveBeacon({ trigger: 'hidden' });
      }
    });

    // Intercept back button clicks
    document.querySelectorAll('a[href*="index.html"]').forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        var href = link.getAttribute('href');
        save({ trigger: 'back_button' }).then(function () {
          window.location.href = href;
        }).catch(function () {
          window.location.href = href;
        });
      });
    });
  }

  function logEvent(type, detail) {
    customEvents.push({ t: t(), type, ...(detail || {}) });
  }

  function buildRecord(result) {
    return {
      id: SESSION_ID,
      save_number: ++saveCount,
      timestamp: LOAD_TIMESTAMP,
      game: gameName,
      duration_ms: Math.round(performance.now() - PAGE_LOAD_TIME),
      is_mobile: ('ontouchstart' in window) || (navigator.maxTouchPoints > 0),
      user_agent: navigator.userAgent,
      screen: { w: screen.width, h: screen.height },
      result: result || null,
      mouse: mouseTrail.slice(),
      keys: keyEvents.length > 0 ? keyEvents.slice() : undefined,
      events: customEvents.length > 0 ? customEvents.slice() : undefined
    };
  }

  // Beacon-based save for unload (non-blocking, fire-and-forget)
  function saveBeacon(result) {
    var record = buildRecord(result);
    var line = JSON.stringify(record) + '\n';
    // Use sendBeacon to a simple endpoint — but GitHub API doesn't support it directly
    // Fallback: store in localStorage for next visit
    try {
      var stored = JSON.parse(localStorage.getItem('game_data_fallback') || '[]');
      stored.push(record);
      localStorage.setItem('game_data_fallback', JSON.stringify(stored));
    } catch (e) {}
  }

  async function save(result) {
    if (saving) return false;
    saving = true;

    var record = buildRecord(result);
    var line = JSON.stringify(record) + '\n';
    var filePath = 'data/' + gameName + '.jsonl';

    try {
      // Also flush any localStorage fallback data
      var fallback = [];
      try {
        fallback = JSON.parse(localStorage.getItem('game_data_fallback') || '[]');
        if (fallback.length > 0) localStorage.removeItem('game_data_fallback');
      } catch (e) {}

      var extraLines = fallback.map(function (r) { return JSON.stringify(r) + '\n'; }).join('');

      var existingContent = '';
      var sha = null;

      var getResp = await fetch(API_BASE + '/' + filePath, {
        headers: { 'Authorization': 'Bearer ' + TOKEN, 'Accept': 'application/vnd.github.v3+json' }
      });

      if (getResp.ok) {
        var fileData = await getResp.json();
        sha = fileData.sha;
        existingContent = atob(fileData.content.replace(/\n/g, ''));
      }

      var newContent = existingContent + extraLines + line;

      var putBody = {
        message: 'data: ' + gameName + ' ' + SESSION_ID.slice(0, 8),
        content: btoa(unescape(encodeURIComponent(newContent))),
        committer: { name: 'Game Data Bot', email: 'data@games.bot' }
      };
      if (sha) putBody.sha = sha;

      var putResp = await fetch(API_BASE + '/' + filePath, {
        method: 'PUT',
        headers: {
          'Authorization': 'Bearer ' + TOKEN,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(putBody)
      });

      if (putResp.ok) {
        console.log('[data-collector] Saved (#' + saveCount + ')');
        saving = false;
        return true;
      } else {
        var err = await putResp.json();
        console.warn('[data-collector] Save failed:', putResp.status, err.message);
        if (putResp.status === 409) {
          console.log('[data-collector] Conflict, retrying...');
          saving = false;
          return await save(result);
        }
      }
    } catch (e) {
      console.warn('[data-collector] Error:', e.message);
      try {
        var stored = JSON.parse(localStorage.getItem('game_data_fallback') || '[]');
        stored.push(record);
        localStorage.setItem('game_data_fallback', JSON.stringify(stored));
      } catch (e2) {}
    }
    saving = false;
    return false;
  }

  window.GameData = { init, logEvent, save, SESSION_ID };
})();
