/* 킥스캔 현장 앱 — 발매 (11/25 · 줍픽 발매 탭 + 앱 알림)
   - 슈프라이즈 공개 발매 정보(진행 중 응모 · 선착순 / 발매 예정)를 폰이 직접 받아 보여요 — PC 가 꺼져 있어도 목록은 보여요
   - [알림 켜기]: 이 폰을 알림 받을 곳으로 서버 문서(ks_doc job 'push-…')에 올려요. 새 발매가 올라오면 켜져 있는 PC 킥스캔이 보내요
     (안드로이드 크롬 · 아이폰은 사파리 › 홈 화면에 추가한 앱에서만 — iOS 16.4+) */
(function () {
  'use strict';
  if (!window.KSM) return;
  var K = window.KSM, esc = K.esc, LS = K.LS, UI = K.UI;
  var API = 'https://api.shoeprize.com/api/v2';
  var DR = { at: 0, rel: null, up: null, err: '', busy: false, tab: LS.get('drTab') === 'up' ? 'up' : 'rel', kr: LS.get('drKr') === '1', msg: '', pushBusy: false };
  var ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  var pushSup = function () { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; };
  var pushIsOn = function () { return LS.get('pushOn') === '1' && window.Notification && Notification.permission === 'granted'; };

  function get(u) { return fetch(API + u, { headers: { Accept: 'application/json' }, cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('응답 ' + r.status); return r.json(); }); }
  function kst() { return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); }
  function load(force) {
    if (DR.busy || (!force && DR.at && Date.now() - DR.at < 10 * 60e3)) return;
    DR.busy = true;
    Promise.all([get('/releases/?is_end=false&ordering=end_time,-id&page_size=100&page=1'), get('/products/?first_release_date_gte=' + kst() + '&ordering=first_release_date&is_uncertain_date=false&is_active=true&is_official=true&page_size=60&page=1')])
      .then(function (R) { DR.rel = R[0].results || []; DR.up = R[1].results || []; DR.at = Date.now(); DR.err = ''; })
      .catch(function () { DR.err = '발매 정보를 못 받았어요 — 인터넷을 확인하고 다시 눌러 주세요'; })
      .then(function () { DR.busy = false; if (UI.tab === 'drop') K.render(); });
  }
  var hm = function (t) { var d = new Date(t); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); };
  function price(x) { var p = +x.salePrice || 0; if (!p) return ''; return /KRW/i.test(x.salePriceCurrency || '') ? K.won(p) : (x.salePriceCurrencySymbol || '') + p.toLocaleString('en-US'); }
  function when(x) {
    var now = Date.now(), s = +x.startTimestamp || 0, e = +x.endTimestamp || 0;
    if (s > now) return '<span class="sub">' + hm(s) + ' 시작</span>';
    if (e && !x.isUndefinedEndTime) return '<span class="' + (e - now < 864e5 ? 'drp-due' : 'sub') + '">' + (e - now < 864e5 ? '오늘 ' : '') + hm(e) + ' 마감</span>';
    return '<span class="sub">' + esc(x.dateInfo || '진행 중') + '</span>';
  }
  var link = function (p) { return p && p.permalink ? 'https://www.shoeprize.com/product/' + p.permalink : ''; };
  var kream = function (c) { return 'https://kream.co.kr/search?keyword=' + encodeURIComponent(String(c || '').split('/')[0]); };
  function head(p) {
    return '<div class="drp-top">' + (p.thumb ? '<img src="' + esc(p.thumb) + '" alt="" loading="lazy">' : '<span></span>') + '<div><span class="drp-brand">' + esc(p.brandName || '') + '</span><b>' + esc(p.name || p.nameEn || '') + '</b>' + (p.code ? '<span class="sub">' + esc(p.code) + '</span>' : '') + '</div></div>';
  }
  function vRel() {
    var now = Date.now(), G = {}, order = [];
    (DR.rel || []).forEach(function (x) {
      if (DR.kr && !x.isDomesticSite) return;
      if (x.endTimestamp && !x.isUndefinedEndTime && +x.endTimestamp < now) return;
      var k = (x.product && x.product.id) || x.id; if (!G[k]) { G[k] = []; order.push(k); } G[k].push(x);
    });
    var key = function (x) { return (+x.startTimestamp > now ? +x.startTimestamp : +x.endTimestamp) || 9e15; };
    var L = order.map(function (k) { return G[k].sort(function (a, b) { return key(a) - key(b); }); }).sort(function (a, b) { return key(a[0]) - key(b[0]); });
    if (!L.length) return '<div class="empty">' + (DR.kr ? '지금 진행 중인 국내 응모가 없어요' : '지금 진행 중인 응모가 없어요') + '</div>';
    return L.map(function (S) {
      var p = S[0].product || {};
      return '<div class="box drp-card">' + head(p) + '<div class="drp-sites">' + S.slice(0, 5).map(function (x) {
        var m = x.releaseMarket || {};
        return '<div class="drp-site"><b>' + esc(m.name || '응모처') + '</b><span class="pill">' + (x.type === 1 ? '추첨' : '선착순') + '</span><span class="pill' + (x.isDomesticSite ? ' ok' : '') + '">' + esc(x.isDomesticSite ? '국내' : (x.region || '해외')) + '</span>' + when(x) + (x.url ? '<a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + (x.type === 1 ? '응모' : '구매') + ' ↗</a>' : '') + '</div>';
      }).join('') + (S.length > 5 ? '<p class="note">외 ' + (S.length - 5) + '곳</p>' : '') + '</div><div class="drp-foot"><b>' + esc(price(S[0])) + '</b>' + (p.code ? '<a href="' + esc(kream(p.code)) + '" target="_blank" rel="noopener">크림 시세 ↗</a>' : '') + (link(p) ? '<a href="' + esc(link(p)) + '" target="_blank" rel="noopener">슈프라이즈 ↗</a>' : '') + '</div></div>';
    }).join('');
  }
  function vUp() {
    var L = (DR.up || []).slice().sort(function (a, b) { return String(a.releaseDate || '').localeCompare(String(b.releaseDate || '')); });
    if (!L.length) return '<div class="empty">발매 예정 상품이 없어요</div>';
    var t = kst();
    return L.map(function (p) {
      var d = p.releaseDate ? Math.round((new Date(p.releaseDate + 'T00:00:00') - new Date(t + 'T00:00:00')) / 864e5) : null;
      var pr = +p.releasePrice ? (/KRW/i.test(p.currency || '') ? K.won(Math.round(+p.releasePrice)) : (p.price || '')) : (p.price || '–');
      return '<div class="box drp-card">' + head(p) + '<dl class="kv"><dt>발매일</dt><dd>' + (p.releaseDate ? esc(p.releaseDate.slice(5).replace('-', '/')) + (d != null && d >= 0 ? ' <span class="' + (d <= 1 ? 'drp-due' : 'sub') + '">' + (d === 0 ? '오늘' : d === 1 ? '내일' : 'D-' + d) + '</span>' : '') : '미정') + '</dd><dt>발매가</dt><dd>' + esc(pr) + '</dd><dt>응모처</dt><dd>' + (+p.releaseSiteCount ? p.releaseSiteCount + '곳' : '아직 없음') + '</dd></dl><div class="drp-foot">' + (p.code ? '<a href="' + esc(kream(p.code)) + '" target="_blank" rel="noopener">크림 시세 ↗</a>' : '') + (link(p) ? '<a href="' + esc(link(p)) + '" target="_blank" rel="noopener">슈프라이즈 ↗</a>' : '') + '</div></div>';
    }).join('');
  }
  function pushBox() {
    var h = '<div class="box drp-push">';
    if (!pushSup()) h += '<b>새 발매 알림</b><p class="note">' + (ios && !standalone ? '아이폰은 사파리 › 공유 › <b>홈 화면에 추가</b>한 뒤, 홈 화면의 킥스캔 앱에서 알림을 켤 수 있어요.' : '이 브라우저는 알림을 받을 수 없어요 — 안드로이드는 크롬에서 열어 주세요.') + '</p>';
    else {
      var on = pushIsOn();
      h += '<div class="sc-row"><span class="drp-pt"><b>새 발매 알림</b><span class="sub">' + (on ? '이 폰으로 받는 중 · PC 킥스캔이 켜져 있을 때 와요' : '새 응모 · 발매 예정이 올라오면 이 폰으로 알려요') + '</span></span><button type="button" class="' + (on ? 'ghost' : 'primary') + '" data-dr="' + (on ? 'off' : 'on') + '"' + (DR.pushBusy ? ' disabled' : '') + '>' + (on ? '알림 끄기' : '알림 켜기') + '</button></div>';
    }
    if (DR.msg) h += '<p class="note">' + esc(DR.msg) + '</p>';
    return h + '</div>';
  }
  K.VIEWS.drop = function () {
    load(false);
    var relN = 0; if (DR.rel) { var seen = {}; DR.rel.forEach(function (x) { if (!DR.kr || x.isDomesticSite) seen[(x.product && x.product.id) || x.id] = 1; }); relN = Object.keys(seen).length; }
    var body = DR.err && !DR.rel ? '<div class="empty">' + esc(DR.err) + '</div>' : !DR.rel ? '<div class="empty">발매 정보를 받는 중이에요…</div>' : (DR.tab === 'up' ? vUp() : vRel());
    return pushBox() + '<div class="seg"><button type="button" data-dr="tab" data-v="rel" aria-pressed="' + (DR.tab !== 'up') + '">진행 중 응모' + (DR.rel ? ' ' + relN : '') + '</button><button type="button" data-dr="tab" data-v="up" aria-pressed="' + (DR.tab === 'up') + '">발매 예정' + (DR.up ? ' ' + DR.up.length : '') + '</button></div>'
      + '<div class="sc-row drp-bar">' + (DR.tab !== 'up' ? '<button type="button" class="chip' + (DR.kr ? ' on' : '') + '" data-dr="kr">국내만</button>' : '') + '<span class="sub">' + (DR.at ? K.ago(DR.at) + ' · 슈프라이즈' : '') + '</span><button type="button" class="linkbtn" data-dr="reload"' + (DR.busy ? ' disabled' : '') + '>' + (DR.busy ? '받는 중…' : '새로 받기') + '</button></div>' + body;
  };

  // ---------- 알림 켜기 · 끄기 ----------
  function b64u(s) { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; var b = atob(s), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
  function same(buf, pub) { if (!buf) return false; var a = new Uint8Array(buf), b = b64u(pub); if (a.length !== b.length) return false; for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }
  function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  function pubKey() {
    return K.token().then(function (tok) {
      if (!tok) throw new Error('먼저 킥스캔 계정으로 로그인해 주세요');
      return K.call('GET', '/rest/v1/ks_doc?select=data&kind=eq.job&id=eq.pushkey', null, tok);
    }).then(function (r) {
      var d = r.ok && r.j && r.j[0] && r.j[0].data;
      if (!d || !d.pub) throw new Error('PC 킥스캔을 최신 버전으로 업데이트해서 켜 두면 알림을 켤 수 있어요 (PC 가 알림 열쇠를 아직 안 만들었어요)');
      return d.pub;
    });
  }
  function putSub(id, data) {
    return K.token().then(function (tok) { return K.call('POST', '/rest/v1/rpc/ks_doc_put', { p_docs: [{ kind: 'job', id: id, data: data, by: 'phone', at: new Date().toISOString() }] }, tok); })
      .then(function (r) { if (!r.ok) throw new Error('서버에 저장하지 못했어요 (' + r.status + ')'); });
  }
  function turnOn() {
    DR.pushBusy = true; DR.msg = '알림 허락을 기다려요…'; K.render();
    var ask = Notification.requestPermission();   // 아이폰: 누른 순간 바로 불러야 해요
    Promise.resolve(ask).then(function (p) {
      if (p !== 'granted') throw new Error('알림이 허락되지 않았어요 — 폰 설정 › 알림에서 킥스캔(또는 크롬)을 허용해 주세요');
      return Promise.all([pubKey(), navigator.serviceWorker.ready]);
    }).then(function (x) {
      var pub = x[0], reg = x[1];
      return reg.pushManager.getSubscription().then(function (old) {
        if (old && old.options && same(old.options.applicationServerKey, pub)) return old;
        return (old ? old.unsubscribe() : Promise.resolve()).then(function () { return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(pub) }); });
      });
    }).then(function (sub) {
      var j = sub.toJSON(), id = 'push-' + hash(j.endpoint || '');
      LS.set('pushId', id);
      return putSub(id, { type: 'push', sub: { endpoint: j.endpoint, keys: j.keys }, ua: navigator.userAgent.slice(0, 80), on: true, kinds: { drop: 1, event: 1 }, status: 'done', at: Date.now() });
    }).then(function () { LS.set('pushOn', '1'); DR.msg = '알림을 켰어요 — PC 발매 탭 › 알림 설정에서 시험 알림을 보내 볼 수 있어요 (PC 가 1분 안에 받아요)'; })
      .catch(function (e) { DR.msg = String((e && e.message) || e); })
      .then(function () { DR.pushBusy = false; K.render(); });
  }
  function turnOff() {
    DR.pushBusy = true; K.render();
    navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
      var id = LS.get('pushId');
      return (sub ? sub.unsubscribe() : Promise.resolve()).then(function () { if (id) return putSub(id, { type: 'push', on: false, status: 'done', at: Date.now() }); });
    }).catch(function () {}).then(function () { LS.set('pushOn', ''); DR.msg = '알림을 껐어요'; DR.pushBusy = false; K.render(); });
  }
  document.getElementById('view').addEventListener('click', function (e) {
    var b = e.target.closest('[data-dr]'); if (!b) return;
    var a = b.dataset.dr;
    if (a === 'tab') { DR.tab = b.dataset.v; LS.set('drTab', DR.tab); }
    else if (a === 'kr') { DR.kr = !DR.kr; LS.set('drKr', DR.kr ? '1' : ''); }
    else if (a === 'reload') { load(true); }
    else if (a === 'on') return turnOn();
    else if (a === 'off') return turnOff();
    K.render();
  });
})();
