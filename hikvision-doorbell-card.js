/**
 * hikvision-doorbell-card
 * Fermax-style doorbell card for Hikvision video intercoms integrated in Home Assistant
 * via the Hikvision Doorbell add-on + Frigate/go2rtc restream.
 *
 * - Live video (webrtc/mse through go2rtc) with call controls
 * - Big centered call + unlock (lock) buttons that stay visible during a call
 * - Ring popup (answer/reject) driven by the call-state sensor
 * - Call History list with per-ring snapshot thumbnails (click to zoom)
 *
 * Config (data): see README.md
 */

const TAG = 'hikvision-doorbell-card';

const PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="54" height="38"><rect width="54" height="38" fill="#26262a"/><g fill="none" stroke="#55555c" stroke-width="1.6"><rect x="8" y="12" width="24" height="16" rx="2"/><path d="M32 17l9-4v12l-9-4z"/><circle cx="20" cy="20" r="3.4"/></g></svg>');

class HikvisionDoorbellCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass = null;
    this._cfg = null;
    this._lastCall = null;
    this._rows = [];
    this._centerTimer = null;
  }

  static getStubConfig() {
    return {
      title: 'Front Door',
      camera_entity: 'camera.hikvision_outdoor',
      stream_name: 'hik_outdoor',
      call_entity: 'sensor.outdoor_call_state',
      door_entity: 'script.hikvision_pulse_door_1',
      answer_script: 'script.hikvision_answer_and_stop_ringing',
      relays: ['switch.outdoor_door_1_relay'],
      media_dir: 'outdoor',
      depth: 12
    };
  }

  setConfig(cfg) {
    if (!cfg || !cfg.call_entity) throw new Error('hikvision-doorbell-card: call_entity required');
    if (!cfg.camera_entity) throw new Error('hikvision-doorbell-card: camera_entity required');
    this._cfg = Object.assign({
      title: 'Front Door',
      stream_name: '',
      relays: [],
      ringing_entity: '',
      door_entity: '',
      answer_script: '',
      snapshot_prefix: 'porteiro_',
      media_dir: 'outdoor',
      depth: 12,
      button_size: 48,
      max_width: 470
    }, cfg);
    if (!this.shadowRoot.hasChildNodes()) this._build();
    this._applySizing();
  }

  getCardSize() { return 12; }

  set hass(hass) {
    if (!this._cfg) return;
    this._hass = hass;
    if (this._acc) this._acc.hass = hass;
    const cs = hass.states[this._cfg.call_entity];
    const cur = cs ? cs.state : null;
    if (this._lastCall === null || cur !== this._lastCall) {
      this._lastCall = cur;
      this._loadHistory();
    }
  }

  connectedCallback() {
    // Center the ACC menu buttons (ACC schema only supports left/right/top/bottom)
    this._centerTimer = setInterval(() => {
      try {
        const menu = this._acc && this._acc.shadowRoot && this._acc.shadowRoot.querySelector('advanced-camera-card-menu');
        const m = menu && menu.shadowRoot;
        const matching = m && m.querySelector('div.matching');
        if (matching) {
          matching.style.width = '100%';
          if (matching.style.justifyContent !== 'center') matching.style.justifyContent = 'center';
        }
      } catch (e) {}
    }, 1500);
  }

  disconnectedCallback() {
    if (this._centerTimer) clearInterval(this._centerTimer);
  }

  _applySizing() {
    const wrap = this.shadowRoot.querySelector('.wrap');
    if (wrap) wrap.style.maxWidth = this._cfg.max_width + 'px';
  }

  _build() {
    const cfg = this._cfg;
    const css = ':host { display: block; } ' +
      '.wrap { width: 100%; margin: 0 auto; background: #161618; border-radius: 10px; overflow: hidden; position: relative; } ' +
      '.video { background: #111; } ' +
      '.caption { text-align: center; color: #9e9ea3; font-size: 13px; padding: 6px 0 10px; background: #26262a; } ' +
      '.header { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px 8px; } ' +
      '.header div { color: #9e9ea3; font-size: 14px; font-weight: 600; } ' +
      '.header button { background: none; border: none; color: #9e9ea3; cursor: pointer; font-size: 16px; padding: 2px 6px; } ' +
      '.header button:hover { color: #fff; } ' +
      '.rows { padding: 0 8px 12px; } ' +
      '.row { display: flex; align-items: center; gap: 12px; padding: 8px 6px; border-radius: 10px; background: #1f1f23; margin-bottom: 4px; } ' +
      '.row .ic { width: 38px; height: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex: none; background: #d32f2f22; color: #ef5350; } ' +
      '.row .ic.ans { background: #43a04722; color: #66bb6a; } ' +
      '.row .info { flex: 1; min-width: 0; } ' +
      '.row .name { color: #fff; font-size: 14px; font-weight: 600; } ' +
      '.row .when { color: #9e9ea3; font-size: 12px; margin-top: 2px; } ' +
      '.row img { width: 54px; height: 38px; object-fit: cover; border-radius: 6px; flex: none; background: #26262a; display: none; cursor: zoom-in; } ' +
      '.row img.loading { opacity: 0.25; } ' +
      '.lightbox { position: fixed; inset: 0; background: rgba(0,0,0,0.85); display: none; align-items: center; justify-content: center; z-index: 99999; } ' +
      '.lightbox.open { display: flex; } ' +
      '.lightbox img { max-width: 94vw; max-height: 92vh; object-fit: contain; border-radius: 8px; box-shadow: 0 8px 40px #000; } ' +
      '.lightbox .cap { position: fixed; bottom: 18px; left: 0; right: 0; text-align: center; color: #bbb; font-size: 13px; } ' +
      '.empty { color: #9e9ea3; padding: 14px; text-align: center; font-size: 13px; } ' +
      'ha-icon { display: inline-flex; }';
    const style = document.createElement('style');
    style.textContent = css;
    this.shadowRoot.appendChild(style);

    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.style.maxWidth = cfg.max_width + 'px';

    const video = document.createElement('div');
    video.className = 'video';

    const caption = document.createElement('div');
    caption.className = 'caption';
    caption.textContent = cfg.title + ' \u00b7 live';

    const header = document.createElement('div');
    header.className = 'header';
    const h1 = document.createElement('div'); h1.textContent = 'Call History';
    const refresh = document.createElement('button');
    refresh.setAttribute('title', 'Refresh'); refresh.textContent = '\u21bb';
    refresh.addEventListener('click', () => this._loadHistory());
    header.appendChild(h1); header.appendChild(refresh);

    this._rowsEl = document.createElement('div');
    this._rowsEl.className = 'rows';

    wrap.appendChild(video);
    wrap.appendChild(caption);
    wrap.appendChild(header);
    wrap.appendChild(this._rowsEl);

    // Lightbox (position:fixed escapes the wrap clipping)
    this._lb = document.createElement('div'); this._lb.className = 'lightbox';
    this._lbImg = document.createElement('img');
    this._lbCap = document.createElement('div'); this._lbCap.className = 'cap';
    this._lb.appendChild(this._lbImg); this._lb.appendChild(this._lbCap);
    this._lb.addEventListener('click', () => this._lb.classList.remove('open'));
    this._lb.addEventListener('keydown', (e) => { if (e.key === 'Escape') this._lb.classList.remove('open'); });
    this.shadowRoot.appendChild(this._lb);
    this.shadowRoot.appendChild(wrap);

    const buildAcc = () => {
      try {
        video.textContent = '';
        this._acc = document.createElement('advanced-camera-card');
        if (this._hass) this._acc.hass = this._hass;
        const buttons = {
          iris: { enabled: false }, call: { enabled: true, icon: 'mdi:video' },
          mute: { enabled: false }, microphone: { enabled: false },
          snapshots: { enabled: false }, recordings: { enabled: false },
          info: { enabled: false }, camera_ui: { enabled: false }, cameras: { enabled: false },
          substreams: { enabled: false }, display_mode: { enabled: false },
          gallery: { enabled: false }, download: { enabled: false }, fullscreen: { enabled: false },
          live: { enabled: false }, timeline: { enabled: false }, images: { enabled: false },
          record: { enabled: false }, snapshot: { enabled: false }, clip: { enabled: false },
          clips: { enabled: false }, media_player: { enabled: false }
        };
        const accCfg = {
          type: 'custom:advanced-camera-card',
          cameras: [{
            camera_entity: cfg.camera_entity,
            live_provider: 'go2rtc',
            go2rtc: { modes: ['webrtc', 'mse'], stream: cfg.stream_name },
            title: cfg.title
          }],
          live: {
            show_image_during_load: true,
            microphone: { auto_unmute: ['call'] },
            controls: { call: { lock: false } }
          },
          view: {
            theme: { themes: ['dark'] },
            triggers: { actions: { trigger: 'call', untrigger: 'call' }, interaction_mode: 'all' }
          },
          menu: {
            style: 'outside', position: 'bottom', button_size: cfg.button_size, auto_hide: [],
            buttons: buttons
          },
          dimensions: { aspect_ratio_mode: 'static', aspect_ratio: '145:100' }
        };
        if (cfg.answer_script) {
          accCfg.automations = [{
            triggers: [{ trigger: 'call', to: 'answered' }],
            actions: [{ action: 'perform-action', perform_action: 'script.turn_on', target: { entity_id: cfg.answer_script } }]
          }];
        }
        if (cfg.door_entity) {
          accCfg.elements = [{
            type: 'custom:advanced-camera-card-menu-icon',
            icon: 'mdi:lock', priority: 40, permanent: true,
            style: { color: '#c857e6' }, title: 'Open door',
            tap_action: { action: 'perform-action', perform_action: 'script.turn_on', target: { entity_id: cfg.door_entity } }
          }];
        }
        this._acc.setConfig(accCfg);
        video.appendChild(this._acc);
      } catch (e) { console.error('hikvision-doorbell-card: ACC error', e); }
    };
    if (customElements.get('advanced-camera-card')) buildAcc();
    else customElements.whenDefined('advanced-camera-card').then(buildAcc);
  }

  _tsStem(ms) {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return this._cfg.snapshot_prefix + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes());
  }

  async _loadHistory() {
    const h = this._hass, cfg = this._cfg;
    if (!h || !this._rowsEl) return;
    let data = null;
    try {
      data = await h.connection.sendMessagePromise({
        type: 'history/history_during_period',
        start_time: new Date(Date.now() - 7 * 86400000).toISOString(),
        end_time: new Date().toISOString(),
        entity_ids: [cfg.call_entity].concat(cfg.relays || []),
        no_attributes: true, minimal_response: true, significant_changes_only: false
      });
    } catch (e) { data = null; }
    const rows = [];
    if (data) {
      const calls = data[cfg.call_entity] || [];
      const relOn = [];
      for (const relay of (cfg.relays || [])) {
        for (const s of (data[relay] || [])) if (s.s === 'on') relOn.push(s.lu);
      }
      for (let i = 0; i < calls.length; i++) {
        const s = calls[i];
        if (s.s !== 'ring') continue;
        const startMs = s.lu * 1000;
        let endMs = Date.now();
        if (i + 1 < calls.length) endMs = calls[i + 1].lu * 1000;
        let answered = false;
        for (const t of relOn) { const tm = t * 1000; if (tm >= startMs - 2000 && tm <= endMs + 2000) { answered = true; break; } }
        for (let j = i + 1; j < calls.length; j++) {
          const s2 = calls[j];
          const tm = s2.lu * 1000;
          if (tm > endMs) break;
          if (s2.s === 'onCall') { answered = true; break; }
        }
        rows.push({ startMs: startMs, endMs: endMs, answered: answered });
      }
    }
    rows.sort((a, b) => b.startMs - a.startMs);
    this._rows = rows.slice(0, cfg.depth || 12);
    this._renderRows();
  }

  async _loadThumb(stem) {
    const h = this._hass;
    if (!h) return null;
    try {
      const resp = await h.fetchWithAuth('/media/local/' + this._cfg.media_dir + '/' + stem + '.jpg');
      if (!resp.ok) return null;
      const blob = await resp.blob();
      if (!blob || blob.size <= 100) return null;
      const url = URL.createObjectURL(blob);
      try {
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        if (!canvas.width || !canvas.height) return url;
        canvas.getContext('2d').drawImage(img, 0, 0);
        return canvas.toDataURL('image/jpeg', 0.7);
      } catch (e) {
        return url; // fallback: blob URL in case data-URL conversion fails in some WebViews
      }
    } catch (e) { return null; }
  }

  _zoom(src, label) {
    this._lbImg.src = src;
    this._lbCap.textContent = label + ' \u00b7 click anywhere to close';
    this._lb.classList.add('open');
  }

  _renderRows() {
    const el = this._rowsEl;
    el.textContent = '';
    if (!this._rows.length) {
      const d = document.createElement('div'); d.className = 'empty'; d.textContent = 'No calls yet';
      el.appendChild(d); return;
    }
    const fmtRel = (ms) => {
      const s = Math.floor((Date.now() - ms) / 1000);
      if (s < 3600) return Math.max(1, Math.floor(s / 60)) + 'm ago';
      if (s < 86400) return Math.floor(s / 3600) + 'h ago';
      return Math.floor(s / 86400) + 'd ago';
    };
    const fmtClock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const fmtDate = (ms) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });
    const title = this._cfg.title;
    for (const r of this._rows) {
      const row = document.createElement('div'); row.className = 'row';
      const ic = document.createElement('div'); ic.className = 'ic' + (r.answered ? ' ans' : '');
      const icon = document.createElement('ha-icon');
      icon.setAttribute('icon', r.answered ? 'mdi:phone-incoming' : 'mdi:phone-missed');
      ic.appendChild(icon);
      const info = document.createElement('div'); info.className = 'info';
      const name = document.createElement('div'); name.className = 'name'; name.textContent = title;
      const when = document.createElement('div'); when.className = 'when';
      when.textContent = fmtRel(r.startMs) + ' \u00b7 ' + fmtDate(r.startMs) + ' \u00b7 ' + fmtClock(r.startMs);
      info.appendChild(name); info.appendChild(when);
      const img = document.createElement('img');
      img.src = PLACEHOLDER; img.style.display = 'block'; img.classList.add('loading');
      const label = fmtDate(r.startMs) + ' \u00b7 ' + fmtClock(r.startMs);
      img.addEventListener('click', () => { if (img.src && !img.classList.contains('loading')) this._zoom(img.src, label); });
      row.appendChild(ic); row.appendChild(info); row.appendChild(img);
      const self = this;
      (async function () {
        const cands = [self._tsStem(r.startMs), self._tsStem(r.startMs + 60000), self._tsStem(r.startMs - 60000)];
        for (const stem of cands) {
          const src = await self._loadThumb(stem);
          if (src) {
            img.src = src; img.classList.remove('loading'); img.style.display = 'block';
            break;
          }
        }
        img.classList.remove('loading');
      })();
      el.appendChild(row);
    }
  }
}

if (!customElements.get(TAG)) customElements.define(TAG, HikvisionDoorbellCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: TAG,
  name: 'Hikvision Doorbell Card',
  description: 'Fermax-style doorbell card for Hikvision video intercoms: live video, call controls, unlock, call history with thumbnails.'
});

console.info('%c hikvision-doorbell-card v1.0.0 ', 'color:#fff;background:#591;padding:1px 3px;border-radius:3px');
