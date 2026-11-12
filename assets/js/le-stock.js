/* LocalEditor stock photos. Keys stay in localStorage. Nothing here is logged. */
(function (global) {
  'use strict';

  var LE = global.LE = global.LE || {};
  var STORE = 'le-stock-keys';
  var MAX_FETCH = 12 * 1024 * 1024;
  var SKIP_BYTES = 1.5 * 1024 * 1024;
  var BIG_FILE = 4e6;
  var TOKEN_SKEW = 5 * 60 * 1000;
  var cooldown = {};
  var tokenFlight = null;
  var lastLimit = null;
  var quotas = {};
  var lastError = {};
  var UTM = 'utm_source=localeditor&utm_medium=referral';
  var UNSPLASH_API = 'https://api.unsplash.com/';

  function emptyKeys() {
    return {
      pixabay: '',
      pexels: '',
      unsplash: '',
      openverse: { clientId: '', clientSecret: '', token: '', tokenExp: 0, email: '' }
    };
  }

  function keys() {
    var raw = null;
    try { raw = JSON.parse(global.localStorage.getItem(STORE) || '{}'); } catch (e) { raw = null; }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyKeys();
    var ov = raw.openverse && typeof raw.openverse === 'object' ? raw.openverse : {};
    return {
      pixabay: typeof raw.pixabay === 'string' ? raw.pixabay : '',
      pexels: typeof raw.pexels === 'string' ? raw.pexels : '',
      unsplash: typeof raw.unsplash === 'string' ? raw.unsplash : '',
      openverse: {
        clientId: typeof ov.clientId === 'string' ? ov.clientId : '',
        clientSecret: typeof ov.clientSecret === 'string' ? ov.clientSecret : '',
        token: typeof ov.token === 'string' ? ov.token : '',
        tokenExp: Number(ov.tokenExp) || 0,
        email: typeof ov.email === 'string' ? ov.email : ''
      }
    };
  }

  function setKeys(partial) {
    var cur = keys();
    partial = partial || {};
    if (partial.pixabay != null) cur.pixabay = String(partial.pixabay);
    if (partial.pexels != null) cur.pexels = String(partial.pexels);
    if (partial.unsplash != null) cur.unsplash = String(partial.unsplash);
    if (partial.openverse && typeof partial.openverse === 'object') {
      var o = partial.openverse;
      if (o.clientId != null) cur.openverse.clientId = String(o.clientId);
      if (o.clientSecret != null) cur.openverse.clientSecret = String(o.clientSecret);
      if (o.token != null) cur.openverse.token = String(o.token);
      if (o.tokenExp != null) cur.openverse.tokenExp = Number(o.tokenExp) || 0;
      if (o.email != null) cur.openverse.email = String(o.email);
    }
    try {
      global.localStorage.setItem(STORE, JSON.stringify(cur));
    } catch (e2) {
      throw new Error('This browser blocked saving the stock keys.');
    }
    return keys();
  }

  var PROVIDER_META = {
    pixabay: {
      id: 'pixabay', name: 'Pixabay', needsKey: true, keyLabel: 'API key',
      keyHelpUrl: 'https://pixabay.com/api/docs/',
      keyHint: 'Free: sign in to Pixabay and copy the key shown in the API documentation.',
      creditText: 'Photos from Pixabay', creditUrl: 'https://pixabay.com/',
      termsUrl: 'https://pixabay.com/service/license-summary/',
      supports: { orientation: true, page: true }
    },
    pexels: {
      id: 'pexels', name: 'Pexels', needsKey: true, keyLabel: 'API key',
      keyHelpUrl: 'https://www.pexels.com/api/new/',
      keyHint: 'Free: sign in to Pexels, request API access, and copy the key.',
      creditText: 'Photos provided by Pexels', creditUrl: 'https://www.pexels.com/',
      termsUrl: 'https://www.pexels.com/api/documentation/#guidelines',
      supports: { orientation: true, page: true }
    },
    openverse: {
      id: 'openverse', name: 'Openverse', needsKey: false, keyLabel: 'Client ID and secret (optional)',
      keyHelpUrl: 'https://api.openverse.org/v1/#tag/auth',
      keyHint: 'No key needed to search; register this device for a higher request limit.',
      creditText: 'Images from Openverse', creditUrl: 'https://openverse.org/',
      termsUrl: 'https://docs.openverse.org/terms_of_service.html',
      supports: { orientation: true, page: true }
    },
    unsplash: {
      id: 'unsplash', name: 'Unsplash', needsKey: true, keyLabel: 'Access Key',
      keyHelpUrl: 'https://unsplash.com/oauth/applications',
      keyHint: 'Free: create an Unsplash developer app and paste its Access Key, never the Secret key.',
      creditText: 'Photos from Unsplash', creditUrl: 'https://unsplash.com/?' + UTM,
      termsUrl: 'https://unsplash.com/api-terms',
      supports: { orientation: true, page: true }
    }
  };
  var PROVIDER_ORDER = ['pixabay', 'pexels', 'openverse', 'unsplash'];

  function hasKeyFor(id) {
    var k = keys();
    if (id === 'openverse') return !!(k.openverse.clientId && k.openverse.clientSecret) || !!k.openverse.token;
    return !!rawKey(k[id]);
  }

  function statusFor(id) {
    var meta = PROVIDER_META[id];
    if (meta.needsKey && !hasKeyFor(id)) return 'needs-key';
    if (coolingLeft(id)) return 'rate-limited';
    if (lastError[id]) return 'error';
    return 'ok';
  }

  function providers() {
    return PROVIDER_ORDER.map(function (id) {
      var m = PROVIDER_META[id];
      return {
        id: m.id,
        name: m.name,
        needsKey: m.needsKey,
        hasKey: hasKeyFor(id),
        keyLabel: m.keyLabel,
        keyHelpUrl: m.keyHelpUrl,
        keyHint: m.keyHint,
        creditText: m.creditText,
        creditUrl: m.creditUrl,
        termsUrl: m.termsUrl,
        supports: { orientation: m.supports.orientation, page: m.supports.page },
        status: statusFor(id)
      };
    });
  }

  function quota(provider) {
    var q = quotas[provider];
    return q ? { limit: q.limit, remaining: q.remaining, at: q.at } : null;
  }

  function defaultMax() {
    var n = 1600;
    try {
      if (LE.perf && typeof LE.perf.previewMax === 'function') n = LE.perf.previewMax();
      else if (LE.perf && typeof LE.perf.level === 'function') {
        var level = LE.perf.level();
        if (level && typeof level === 'object' && isFinite(Number(level.previewMax))) n = Number(level.previewMax);
        else if (level === 'high') n = 2400;
        else if (level === 'mid') n = 1600;
        else if (level === 'low') n = 1000;
      }
    } catch (e) { n = 1600; }
    n = Number(n);
    if (!isFinite(n) || n < 64) n = 1600;
    return Math.round(n);
  }

  function clampInt(v, a, b, d) {
    v = parseInt(v, 10);
    if (!isFinite(v)) v = d;
    if (v < a) return a;
    if (v > b) return b;
    return v;
  }

  function rawKey(value) {
    var k = String(value || '').replace(/^\s+|\s+$/g, '');
    if (/^bearer\s+/i.test(k)) k = k.replace(/^bearer\s+/i, '');
    return k;
  }

  function fileBytes(n) {
    if (n == null || n === '') return 0;
    n = Number(n);
    if (!isFinite(n) || n <= 0) return 0;
    return n;
  }

  function coolingLeft(provider) {
    var until = cooldown[provider] || 0;
    if (until > Date.now()) return Math.ceil((until - Date.now()) / 1000);
    return 0;
  }

  function retryMs(header) {
    if (!header) return 60000;
    var n = Number(header);
    if (isFinite(n) && n >= 0) return Math.min(3600, n) * 1000;
    var t = Date.parse(header);
    if (isFinite(t)) return Math.max(1000, Math.min(3600000, t - Date.now()));
    return 60000;
  }

  function clearCredential(provider) {
    if (provider === 'pixabay') setKeys({ pixabay: '' });
    else if (provider === 'pexels') setKeys({ pexels: '' });
    else if (provider === 'unsplash') setKeys({ unsplash: '' });
    else if (provider === 'openverse') setKeys({ openverse: { token: '', tokenExp: 0 } });
  }

  function httpError(provider, status, headers) {
    var retryAfter = headers && headers.get ? headers.get('retry-after') : '';
    if (status === 401) {
      clearCredential(provider);
      var denied = new Error(provider === 'openverse'
        ? 'Openverse rejected the saved token. Try the search again.'
        : 'That key was rejected. Enter it again.');
      denied.status = 401;
      denied.provider = provider;
      return denied;
    }
    if (status === 429) {
      var ms = retryMs(retryAfter);
      cooldown[provider] = Date.now() + ms;
      var limited = new Error('Too many ' + provider + ' requests. Try again in ' + Math.ceil(ms / 1000) + 's.');
      limited.status = 429;
      limited.provider = provider;
      limited.retryAfter = Math.ceil(ms / 1000);
      return limited;
    }
    var err = new Error('Could not reach ' + provider + '.');
    err.status = status || 0;
    err.provider = provider;
    return err;
  }

  function noteLimit(headers) {
    if (!headers || !headers.get) return lastLimit;
    var names = [
      'x-ratelimit-limit-anon_burst',
      'x-ratelimit-available-anon_burst',
      'x-ratelimit-limit-anon_sustained',
      'x-ratelimit-available-anon_sustained',
      'x-ratelimit-limit',
      'x-ratelimit-remaining',
      'x-ratelimit-available',
      'retry-after'
    ];
    var out = { at: Date.now() };
    var any = false;
    for (var i = 0; i < names.length; i++) {
      var v = headers.get(names[i]);
      if (v) { out[names[i]] = v; any = true; }
    }
    if (any) lastLimit = out;
    return lastLimit;
  }

  function noteQuota(provider, headers) {
    if (!provider || !headers || !headers.get) return;
    var rem = headers.get('x-ratelimit-remaining');
    var lim = headers.get('x-ratelimit-limit');
    var r = rem == null || rem === '' ? NaN : Number(rem);
    var l = lim == null || lim === '' ? NaN : Number(lim);
    if (!isFinite(r) && !isFinite(l)) return;
    quotas[provider] = {
      limit: isFinite(l) ? l : (quotas[provider] ? quotas[provider].limit : null),
      remaining: isFinite(r) ? r : null,
      at: Date.now()
    };
  }

  function readJson(res) {
    return res.text().then(function (text) {
      var data = null;
      if (text) {
        try { data = JSON.parse(text); } catch (e) { data = null; }
      }
      noteLimit(res.headers);
      return { status: res.status, ok: res.ok, headers: res.headers, data: data };
    });
  }

  function detailOf(data) {
    if (!data || typeof data !== 'object') return '';
    var d = data.msg || data.detail || data.message || '';
    if (Array.isArray(d)) d = d[0];
    if (typeof d !== 'string') return '';
    if (/client_secret|access_token|client_id/i.test(d)) return '';
    return d.slice(0, 280);
  }

  function apiFetch(url, opts) {
    opts = opts || {};
    return fetch(url, {
      method: opts.method || 'GET',
      headers: opts.headers || { Accept: 'application/json' },
      body: opts.body || null,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store'
    }).then(readJson).then(function (out) {
      noteQuota(opts.provider, out.headers);
      return out;
    });
  }

  function orientParam(provider, value) {
    var v = String(value || '').toLowerCase();
    if (!v || v === 'all') return '';
    if (provider === 'pixabay') {
      if (v === 'landscape' || v === 'horizontal') return 'horizontal';
      if (v === 'portrait' || v === 'vertical') return 'vertical';
      return '';
    }
    if (provider === 'pexels') {
      if (v === 'horizontal' || v === 'landscape') return 'landscape';
      if (v === 'vertical' || v === 'portrait') return 'portrait';
      if (v === 'square') return 'square';
      return '';
    }
    if (provider === 'unsplash') {
      if (v === 'horizontal' || v === 'landscape' || v === 'wide') return 'landscape';
      if (v === 'vertical' || v === 'portrait' || v === 'tall') return 'portrait';
      if (v === 'square' || v === 'squarish') return 'squarish';
      return '';
    }
    if (v === 'horizontal' || v === 'landscape' || v === 'wide') return 'wide';
    if (v === 'vertical' || v === 'portrait' || v === 'tall') return 'tall';
    if (v === 'square') return 'square';
    return '';
  }

  function guard(provider) {
    var left = coolingLeft(provider);
    if (!left) return null;
    var err = new Error(provider + ' is cooling down. Try again in ' + left + 's.');
    err.status = 429;
    err.provider = provider;
    err.retryAfter = left;
    return err;
  }

  function mapPixabay(data, page) {
    var list = data && data.hits ? data.hits : [];
    var hits = [];
    for (var i = 0; i < list.length; i++) {
      var h = list[i];
      if (!h || (!h.largeImageURL && !h.webformatURL)) continue;
      var user = h.user || '';
      hits.push({
        id: String(h.id),
        provider: 'pixabay',
        thumb: h.webformatURL || h.previewURL || '',
        importUrl: h.largeImageURL || h.webformatURL || '',
        w: h.imageWidth || h.webformatWidth || 0,
        h: h.imageHeight || h.webformatHeight || 0,
        photographer: user,
        pageUrl: h.pageURL || '',
        license: 'Pixabay Content License',
        attribution: user ? ('Photo by ' + user + ' on Pixabay') : 'Photo on Pixabay',
        filesize: fileBytes(h.imageSize) || null
      });
    }
    return { hits: hits, page: page, total: (data && (data.totalHits || data.total)) || hits.length, limit: lastLimit };
  }

  function mapPexels(data, page) {
    var list = data && data.photos ? data.photos : [];
    var hits = [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var src = p && p.src ? p.src : {};
      if (!src.large2x && !src.large && !src.medium) continue;
      var who = p.photographer || '';
      hits.push({
        id: String(p.id),
        provider: 'pexels',
        thumb: src.medium || src.small || '',
        importUrl: src.large2x || src.large || '',
        w: p.width || 0,
        h: p.height || 0,
        photographer: who,
        pageUrl: p.url || '',
        license: 'Pexels License',
        attribution: who ? ('Photo by ' + who + ' on Pexels') : 'Photo on Pexels',
        filesize: null
      });
    }
    return { hits: hits, page: page, total: (data && data.total_results) || hits.length, limit: lastLimit };
  }

  function withUtm(url) {
    url = String(url || '');
    if (!url) return '';
    if (url.indexOf('utm_source=') >= 0) return url;
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + UTM;
  }

  function unsplashSized(raw, maxEdge) {
    var u;
    try { u = new URL(raw); } catch (e) { return String(raw || ''); }
    ['w', 'h', 'fit', 'q', 'fm', 'dpr', 'crop'].forEach(function (k) { u.searchParams.delete(k); });
    u.searchParams.set('w', String(maxEdge));
    u.searchParams.set('fit', 'max');
    u.searchParams.set('q', '80');
    u.searchParams.set('fm', 'jpg');
    return u.toString();
  }

  function mapUnsplash(data, page) {
    var list = data && data.results ? data.results : [];
    var edge = defaultMax();
    var hits = [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var urls = p && p.urls ? p.urls : {};
      if (!p || (!urls.raw && !urls.regular && !urls.small)) continue;
      var user = p.user || {};
      var who = user.name || '';
      var links = p.links || {};
      hits.push({
        id: String(p.id),
        provider: 'unsplash',
        thumb: urls.small || urls.thumb || '',
        importUrl: urls.raw ? unsplashSized(urls.raw, edge) : (urls.regular || urls.small || ''),
        w: p.width || 0,
        h: p.height || 0,
        photographer: who,
        photographerUrl: withUtm(user.links && user.links.html),
        pageUrl: withUtm(links.html),
        license: 'Unsplash License',
        attribution: who ? ('Photo by ' + who + ' on Unsplash') : 'Photo on Unsplash',
        filesize: null,
        downloadLocation: links.download_location || ''
      });
    }
    return { hits: hits, page: page, total: (data && data.total) || hits.length, limit: lastLimit };
  }

  function ccLicense(v) {
    var s = String(v || '').toLowerCase().replace(/^\s+|\s+$/g, '');
    if (s.slice(0, 3) === 'cc-') s = s.slice(3);
    if (s.slice(0, 3) === 'cc ') s = s.slice(3).replace(/\s+/g, '-');
    if (s === '0') s = 'cc0';
    if (s === 'cc0' || s === 'pdm' || s === 'by' || s === 'by-sa' || s === 'by-nd' || s === 'by-nc' || s === 'by-nc-sa' || s === 'by-nc-nd') return s;
    return '';
  }

  function mapOpenverse(data, page) {
    var list = data && data.results ? data.results : [];
    var hits = [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || r.mature === true || (!r.thumbnail && !r.url)) continue;
      var license = ccLicense(r.license);
      if (!license) continue;
      var who = r.creator || '';
      hits.push({
        id: String(r.id),
        provider: 'openverse',
        thumb: r.thumbnail || '',
        importUrl: r.url || '',
        w: r.width || 0,
        h: r.height || 0,
        photographer: who,
        pageUrl: r.foreign_landing_url || r.detail_url || '',
        license: license,
        attribution: r.attribution || (who ? ('Photo by ' + who + ' (' + license + ')') : ('Openverse photo (' + license + ')')),
        filesize: fileBytes(r.filesize) || null
      });
    }
    return {
      hits: hits,
      page: (data && data.page) || page,
      total: data && data.result_count != null ? data.result_count : hits.length,
      limit: lastLimit
    };
  }

  function searchPixabay(q, page, per, orientation) {
    var key = rawKey(keys().pixabay);
    if (!key) {
      var missing = new Error('Add a Pixabay key to search Pixabay.');
      missing.status = 401;
      missing.provider = 'pixabay';
      return Promise.reject(missing);
    }
    var url = 'https://pixabay.com/api/?key=' + encodeURIComponent(key) +
      '&q=' + encodeURIComponent(q) +
      '&image_type=photo&safesearch=true&per_page=' + per + '&page=' + page;
    if (orientation) url += '&orientation=' + encodeURIComponent(orientation);
    return apiFetch(url).then(function (res) {
      var badKey = res.data && typeof res.data.error === 'string' && /key/i.test(res.data.error);
      if (res.status === 401 || badKey) throw httpError('pixabay', 401, res.headers);
      if (res.status === 429) throw httpError('pixabay', 429, res.headers);
      if (!res.ok || !res.data) throw httpError('pixabay', res.status, res.headers);
      return mapPixabay(res.data, page);
    });
  }

  function searchPexels(q, page, per, orientation) {
    var key = rawKey(keys().pexels);
    if (!key) {
      var missing = new Error('Add a Pexels key to search Pexels.');
      missing.status = 401;
      missing.provider = 'pexels';
      return Promise.reject(missing);
    }
    var url = 'https://api.pexels.com/v1/search?query=' + encodeURIComponent(q) + '&per_page=' + per + '&page=' + page;
    if (orientation) url += '&orientation=' + encodeURIComponent(orientation);
    return apiFetch(url, { headers: { Accept: 'application/json', Authorization: key } }).then(function (res) {
      if (res.status === 401 || res.status === 403) throw httpError('pexels', 401, res.headers);
      if (res.status === 429) throw httpError('pexels', 429, res.headers);
      if (!res.ok || !res.data) throw httpError('pexels', res.status, res.headers);
      return mapPexels(res.data, page);
    });
  }

  function unsplashAuth(key) {
    return { Accept: 'application/json', 'Accept-Version': 'v1', Authorization: 'Client-ID ' + key };
  }

  function searchUnsplash(q, page, per, orientation) {
    var key = rawKey(keys().unsplash);
    if (!key) {
      var missing = new Error('Add an Unsplash Access Key to search Unsplash.');
      missing.status = 401;
      missing.provider = 'unsplash';
      return Promise.reject(missing);
    }
    var url = UNSPLASH_API + 'search/photos?query=' + encodeURIComponent(q) +
      '&page=' + page + '&per_page=' + per + '&content_filter=high';
    if (orientation) url += '&orientation=' + encodeURIComponent(orientation);
    return apiFetch(url, { headers: unsplashAuth(key), provider: 'unsplash' }).then(function (res) {
      var remaining = res.headers && res.headers.get ? res.headers.get('x-ratelimit-remaining') : null;
      var bodyText = res.data ? JSON.stringify(res.data.errors || res.data.error || '') : '';
      if (res.status === 429 || (res.status === 403 && (remaining === '0' || /rate limit/i.test(bodyText)))) {
        var hasRetry = res.headers && res.headers.get && res.headers.get('retry-after');
        if (!hasRetry) {
          cooldown.unsplash = Date.now() + 3600000;
          var limited = new Error('Unsplash hourly limit reached. Try again later.');
          limited.status = 429;
          limited.provider = 'unsplash';
          limited.retryAfter = 3600;
          throw limited;
        }
        throw httpError('unsplash', 429, res.headers);
      }
      if (res.status === 401 || res.status === 403) throw httpError('unsplash', 401, res.headers);
      if (!res.ok || !res.data) throw httpError('unsplash', res.status, res.headers);
      return mapUnsplash(res.data, page);
    });
  }

  function bearer() {
    var o = keys().openverse;
    if (o.token && o.tokenExp && (o.tokenExp - Date.now()) > TOKEN_SKEW) return Promise.resolve(o.token);
    if (o.clientId && o.clientSecret) {
      return tokenOpenverse().catch(function () {
        var again = keys().openverse;
        if (again.token && again.tokenExp && (again.tokenExp - Date.now()) > TOKEN_SKEW) return again.token;
        return '';
      });
    }
    return Promise.resolve('');
  }

  function searchOpenverse(q, page, per, aspect, tried) {
    return bearer().then(function (token) {
      var url = 'https://api.openverse.org/v1/images/?q=' + encodeURIComponent(q) +
        '&page=' + page + '&page_size=' + per + '&mature=false';
      if (aspect) url += '&aspect_ratio=' + encodeURIComponent(aspect);
      var headers = { Accept: 'application/json' };
      if (token) headers.Authorization = 'Bearer ' + token;
      return apiFetch(url, { headers: headers }).then(function (res) {
        if (res.status === 401 && token && !tried) {
          clearCredential('openverse');
          return searchOpenverse(q, page, per, aspect, true);
        }
        if (res.status === 401) throw httpError('openverse', 401, res.headers);
        if (res.status === 429) throw httpError('openverse', 429, res.headers);
        if (!res.ok || !res.data) throw httpError('openverse', res.status, res.headers);
        return mapOpenverse(res.data, page);
      });
    });
  }

  function search(q, opts) {
    opts = opts || {};
    var provider = opts.provider || 'openverse';
    if (!PROVIDER_META[provider]) {
      return Promise.reject(new Error('Unknown photo source.'));
    }
    var blocked = guard(provider);
    if (blocked) return Promise.reject(blocked);
    q = String(q || '').replace(/^\s+|\s+$/g, '').slice(0, 200);
    if (!q && provider !== 'openverse') return Promise.reject(new Error('Enter a search term.'));
    var page = clampInt(opts.page, 1, 500, 1);
    var per = clampInt(opts.perPage, 1, provider === 'openverse' ? 20 : (provider === 'unsplash' ? 30 : 80), 20);
    if (provider === 'pixabay') per = clampInt(per, 3, 200, 20);
    var orientation = orientParam(provider, opts.orientation);
    var run;
    if (provider === 'pixabay') run = searchPixabay(q, page, per, orientation);
    else if (provider === 'pexels') run = searchPexels(q, page, per, orientation);
    else if (provider === 'unsplash') run = searchUnsplash(q, page, per, orientation);
    else run = searchOpenverse(q, page, per, orientation, false);
    return run.then(function (out) {
      delete lastError[provider];
      return out;
    }, function (err) {
      if (err && err.status !== 401 && err.status !== 429) lastError[provider] = true;
      throw err;
    });
  }

  function registerOpenverse(info) {
    info = info || {};
    var name = String(info.name || 'LocalEditor on this device').slice(0, 200);
    var description = String(info.description || 'Private photo studio on this device. Searches Openverse and keeps images locally.').slice(0, 500);
    var email = String(info.email || '').replace(/^\s+|\s+$/g, '');
    if (!email || email.indexOf('@') < 1 || email.indexOf('.', email.indexOf('@')) < 0) {
      return Promise.reject(new Error('Enter the email Openverse should verify.'));
    }
    return apiFetch('https://api.openverse.org/v1/auth_tokens/register/', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, description: description, email: email })
    }).then(function (res) {
      if (res.status === 429) throw httpError('openverse', 429, res.headers);
      var data = res.data || {};
      var clientId = data.client_id || data.clientId || '';
      var clientSecret = data.client_secret || data.clientSecret || '';
      if (!res.ok || !clientId || !clientSecret) {
        var why = detailOf(data) || 'Openverse could not register this device.';
        var err = new Error(why);
        err.status = res.status || 0;
        err.provider = 'openverse';
        throw err;
      }
      setKeys({
        openverse: {
          clientId: String(clientId),
          clientSecret: String(clientSecret),
          email: email,
          token: '',
          tokenExp: 0
        }
      });
      return {
        ok: true,
        name: name,
        email: email,
        message: detailOf(data) || 'Check your email to verify this app. Until then, search stays on the anonymous limit.'
      };
    });
  }

  function tokenOpenverse() {
    var o = keys().openverse;
    if (o.token && o.tokenExp && (o.tokenExp - Date.now()) > TOKEN_SKEW) return Promise.resolve(o.token);
    if (!o.clientId || !o.clientSecret) return Promise.resolve('');
    if (tokenFlight) return tokenFlight;
    var body = 'grant_type=client_credentials' +
      '&client_id=' + encodeURIComponent(o.clientId) +
      '&client_secret=' + encodeURIComponent(o.clientSecret);
    tokenFlight = apiFetch('https://api.openverse.org/v1/auth_tokens/token/', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body
    }).then(function (res) {
      tokenFlight = null;
      if (res.status === 401 || res.status === 403) {
        clearCredential('openverse');
        var denied = new Error(detailOf(res.data) || 'Openverse has not accepted this registration yet. Verify the email, then try again.');
        denied.status = res.status;
        denied.provider = 'openverse';
        throw denied;
      }
      if (res.status === 429) throw httpError('openverse', 429, res.headers);
      var token = res.data && (res.data.access_token || res.data.accessToken);
      if (!res.ok || !token) {
        var err = new Error(detailOf(res.data) || 'Could not get an Openverse token.');
        err.status = res.status || 0;
        err.provider = 'openverse';
        throw err;
      }
      var secs = Number(res.data.expires_in);
      if (!isFinite(secs) || secs < 60) secs = 36000;
      setKeys({ openverse: { token: String(token), tokenExp: Date.now() + secs * 1000 } });
      return String(token);
    }, function (err) {
      tokenFlight = null;
      throw err;
    });
    return tokenFlight;
  }

  function rateLimit() {
    return bearer().then(function (token) {
      var headers = { Accept: 'application/json' };
      if (token) headers.Authorization = 'Bearer ' + token;
      return apiFetch('https://api.openverse.org/v1/rate_limit/', { headers: headers }).then(function (res) {
        if (res.status === 401) {
          if (token) clearCredential('openverse');
          return {
            ok: false,
            status: 401,
            anonymous: !token,
            message: token
              ? 'Openverse rejected the saved token.'
              : 'Anonymous Openverse searches do not include this endpoint. Limits are on each search response.',
            headers: lastLimit,
            requestsThisMinute: null,
            requestsToday: null,
            model: ''
          };
        }
        if (res.status === 429) throw httpError('openverse', 429, res.headers);
        if (!res.ok || !res.data) throw httpError('openverse', res.status, res.headers);
        var data = res.data;
        return {
          ok: true,
          status: res.status,
          anonymous: !token,
          message: '',
          headers: lastLimit,
          requestsThisMinute: data.requests_this_minute == null ? null : data.requests_this_minute,
          requestsToday: data.requests_today == null ? null : data.requests_today,
          model: data.rate_limit_model || ''
        };
      });
    });
  }

  function looksOriginal(url) {
    var u;
    try { u = new URL(url); } catch (e) { return false; }
    if (u.hostname !== 'upload.wikimedia.org') return false;
    var path = u.pathname || '';
    if (path.indexOf('/thumb/') >= 0) return false;
    if (path.indexOf('px-') >= 0) return false;
    return true;
  }

  function wikimediaFile(url) {
    var u;
    try { u = new URL(url, 'https://commons.wikimedia.org'); } catch (e) { return ''; }
    if (u.hostname !== 'upload.wikimedia.org' && u.hostname !== 'commons.wikimedia.org') return '';
    var path = u.pathname || '';
    try { path = decodeURIComponent(path); } catch (e2) {}
    var parts = path.split('/');
    var last = parts[parts.length - 1] || '';
    last = last.replace(/^\d+px-/i, '');
    if (!last || last.length > 240) return '';
    if (!/\.[A-Za-z0-9]{1,8}$/.test(last)) return '';
    return last;
  }

  function sizedImportUrl(hit, maxEdge) {
    hit = hit || {};
    maxEdge = Math.round(Number(maxEdge) || defaultMax());
    if (!isFinite(maxEdge) || maxEdge < 64) maxEdge = defaultMax();
    var url = String(hit.importUrl || hit.url || '');
    if (hit.provider === 'pixabay' || hit.provider === 'pexels') return url;
    if (hit.provider === 'unsplash' || /^https:\/\/images\.unsplash\.com\//.test(url)) return unsplashSized(url, maxEdge);
    var size = fileBytes(hit.filesize);
    var original = looksOriginal(url);
    if (!size && original && hit.thumb) return hit.thumb;
    if (size > BIG_FILE || original) {
      var name = wikimediaFile(url);
      if (name) return 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(name) + '?width=' + maxEdge;
    }
    if (!size && original && hit.thumb) return hit.thumb;
    return url;
  }

  function readLimited(res, maxBytes) {
    var type = String(res.headers.get('content-type') || 'application/octet-stream').split(';')[0].replace(/^\s+|\s+$/g, '');
    if (!type) type = 'application/octet-stream';
    if (!res.body || !res.body.getReader) {
      return res.blob().then(function (blob) {
        if (blob.size > maxBytes) {
          var big = new Error('That photo is too large to import.');
          big.code = 'too-big';
          throw big;
        }
        return type === 'application/octet-stream' ? blob : new Blob([blob], { type: type });
      });
    }
    var reader = res.body.getReader();
    var chunks = [];
    var received = 0;
    function pump() {
      return reader.read().then(function (step) {
        if (step.done) return new Blob(chunks, { type: type });
        received += step.value.byteLength || step.value.length || 0;
        if (received > maxBytes) {
          try { reader.cancel(); } catch (e) {}
          var big = new Error('That photo is too large to import.');
          big.code = 'too-big';
          throw big;
        }
        chunks.push(step.value);
        return pump();
      });
    }
    return pump();
  }

  function pull(url, maxBytes) {
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    return fetch(url, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      if (!res.ok) {
        if (res.body && res.body.cancel) { try { res.body.cancel(); } catch (e) {} }
        var err = new Error('Could not download that photo.');
        err.status = res.status;
        throw err;
      }
      var len = Number(res.headers.get('content-length'));
      if (isFinite(len) && len > maxBytes) {
        if (ctrl) { try { ctrl.abort(); } catch (e2) {} }
        if (res.body && res.body.cancel) { try { res.body.cancel(); } catch (e3) {} }
        var big = new Error('That photo is too large to import.');
        big.code = 'too-big';
        big.status = 413;
        throw big;
      }
      return readLimited(res, maxBytes);
    });
  }

  function fetchBlob(url, opts) {
    opts = opts || {};
    var maxBytes = Number(opts.maxBytes == null ? MAX_FETCH : opts.maxBytes);
    if (!isFinite(maxBytes) || maxBytes < 1024) maxBytes = MAX_FETCH;
    var fallback = opts.fallback || '';
    if (!url) return Promise.reject(new Error('That photo has no file to import.'));
    return pull(String(url), maxBytes).catch(function (err) {
      if (fallback && fallback !== url) return pull(String(fallback), maxBytes);
      throw err;
    });
  }

  function tryBitmap(src) {
    return new Promise(function (resolve, reject) {
      var pending;
      try { pending = createImageBitmap(src, { imageOrientation: 'from-image' }); }
      catch (e) {
        try { pending = createImageBitmap(src); }
        catch (e2) { reject(e2); return; }
      }
      Promise.resolve(pending).then(resolve, function () {
        try { Promise.resolve(createImageBitmap(src)).then(resolve, reject); }
        catch (e3) { reject(e3); }
      });
    });
  }

  function loadImageEl(src, bytes, type) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(src);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve({
          source: img,
          width: img.naturalWidth || img.width,
          height: img.naturalHeight || img.height,
          bytes: bytes,
          type: type,
          close: function () {}
        });
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('Could not read that photo.'));
      };
      img.src = url;
    });
  }

  function measure(src) {
    if (!src) return Promise.reject(new Error('Could not read that photo.'));
    if (typeof src.getContext === 'function' && src.width && src.height) {
      return Promise.resolve({
        source: src,
        width: src.width | 0,
        height: src.height | 0,
        bytes: 0,
        type: '',
        close: function () {}
      });
    }
    if (typeof ImageBitmap !== 'undefined' && src instanceof ImageBitmap) {
      return Promise.resolve({
        source: src,
        width: src.width,
        height: src.height,
        bytes: 0,
        type: '',
        close: function () { if (src.close) src.close(); }
      });
    }
    var bytes = src.size || 0;
    var type = String(src.type || '').toLowerCase();
    if (typeof createImageBitmap === 'function') {
      return tryBitmap(src).then(function (bmp) {
        return {
          source: bmp,
          width: bmp.width,
          height: bmp.height,
          bytes: bytes,
          type: type,
          close: function () { if (bmp.close) bmp.close(); }
        };
      }).catch(function () { return loadImageEl(src, bytes, type); });
    }
    return loadImageEl(src, bytes, type);
  }

  function hasAlpha(ctx, w, h) {
    var data;
    try { data = ctx.getImageData(0, 0, w, h).data; } catch (e) { return false; }
    var step = w * h > 1500000 ? 16 : 4;
    for (var i = 3; i < data.length; i += step) {
      if (data[i] < 250) return true;
    }
    return false;
  }

  function canvasBlob(canvas, type, quality) {
    if (LE.toBlob) return LE.toBlob(canvas, type, quality);
    return new Promise(function (resolve, reject) {
      if (!canvas.toBlob) { reject(new Error('Could not compress that photo.')); return; }
      canvas.toBlob(function (blob) {
        if (!blob) reject(new Error('Could not compress that photo.'));
        else resolve(blob);
      }, type, quality);
    });
  }

  function compress(src, opts) {
    opts = opts || {};
    var maxEdge = opts.maxEdge == null ? defaultMax() : Math.round(Number(opts.maxEdge));
    if (!isFinite(maxEdge) || maxEdge < 64) maxEdge = defaultMax();
    var quality = opts.quality == null ? 0.82 : Number(opts.quality);
    if (!isFinite(quality)) quality = 0.82;
    quality = Math.max(0.05, Math.min(1, quality));
    return measure(src).then(function (info) {
      var edge = Math.max(info.width, info.height);
      var jpeg = info.type === 'image/jpeg' || info.type === 'image/jpg' || info.type === 'image/pjpeg';
      if (jpeg && edge <= maxEdge && info.bytes && info.bytes <= SKIP_BYTES && src && typeof src.size === 'number') {
        info.close();
        return { blob: src, width: info.width, height: info.height, type: 'image/jpeg' };
      }
      var scale = edge > maxEdge ? maxEdge / edge : 1;
      var tw = Math.max(1, Math.round(info.width * scale));
      var th = Math.max(1, Math.round(info.height * scale));
      if (tw > 8192 || th > 8192) {
        var fit = Math.min(8192 / tw, 8192 / th);
        tw = Math.max(1, Math.round(tw * fit));
        th = Math.max(1, Math.round(th * fit));
      }
      var canvas = global.document.createElement('canvas');
      canvas.width = tw;
      canvas.height = th;
      var ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(info.source, 0, 0, tw, th);
      info.close();
      var alpha = hasAlpha(ctx, tw, th);
      var type = alpha ? 'image/png' : 'image/jpeg';
      return canvasBlob(canvas, type, alpha ? undefined : quality).then(function (blob) {
        return { blob: blob, width: tw, height: th, type: type };
      });
    });
  }

  function sourceOf(hit) {
    var out = {
      provider: String(hit.provider || ''),
      photographer: String(hit.photographer || ''),
      pageUrl: String(hit.pageUrl || ''),
      license: String(hit.license || ''),
      attribution: String(hit.attribution || '')
    };
    if (hit.photographerUrl) out.photographerUrl = String(hit.photographerUrl);
    return out;
  }

  function fileBase(hit) {
    var base = String(hit.photographer || hit.provider || 'photo').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
    return (base || 'photo').slice(0, 48);
  }

  /* Unsplash API guideline: report a real download. Fire and forget; never breaks the import. */
  function pingDownload(hit) {
    try {
      if (!hit || hit.provider !== 'unsplash' || !hit.downloadLocation) return;
      var loc = String(hit.downloadLocation);
      if (loc.indexOf(UNSPLASH_API) !== 0) return;
      var key = rawKey(keys().unsplash);
      if (!key) return;
      var p = fetch(loc, {
        method: 'GET',
        headers: unsplashAuth(key),
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store'
      });
      if (p && p.then) p.then(function (res) {
        if (res && res.body && res.body.cancel) { try { res.body.cancel(); } catch (e) {} }
      }, function () {});
    } catch (e2) {}
  }

  function importHit(hit) {
    hit = hit || {};
    var maxEdge = defaultMax();
    var primary = sizedImportUrl(hit, maxEdge);
    var thumb = hit.thumb && hit.thumb !== primary ? hit.thumb : '';
    if (!primary && thumb) { primary = thumb; thumb = ''; }
    if (!primary) return Promise.reject(new Error('That photo has no file to import.'));
    return fetchBlob(primary, { maxBytes: MAX_FETCH, fallback: thumb }).then(function (blob) {
      return compress(blob, { maxEdge: maxEdge, quality: 0.82 });
    }).then(function (out) {
      var type = out.type || 'image/jpeg';
      var file = new File([out.blob], fileBase(hit) + (type === 'image/png' ? '.png' : '.jpg'), { type: type, lastModified: Date.now() });
      var source = sourceOf(hit);
      file.source = source;
      file.width = out.width;
      file.height = out.height;
      pingDownload(hit);
      return { file: file, blob: file, width: out.width, height: out.height, type: type, source: source };
    });
  }

  LE.stock = {
    providers: providers,
    quota: quota,
    keys: keys,
    setKeys: setKeys,
    search: search,
    registerOpenverse: registerOpenverse,
    tokenOpenverse: tokenOpenverse,
    rateLimit: rateLimit,
    sizedImportUrl: sizedImportUrl,
    fetchBlob: fetchBlob,
    compress: compress,
    importHit: importHit
  };
})(window);
