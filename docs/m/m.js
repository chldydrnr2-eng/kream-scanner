/* 킥스캔 휴대폰 보기 (보기 전용)
   - PC 킥스캔이 올린 요약(ks_snap 표: summary · sales · stock · market)을 같은 킥스캔 계정으로 로그인해서 읽어요.
   - 서버 주소 · 공개 키는 사이트 맨 위 shop.json 의 supa.url · supa.anon 에서 읽어요.
   - 자동 로그인용 refresh token 만 이 기기(localStorage)에 두고, access token 은 메모리에만 둬요.
   - PC 등록 확인(ks_check)은 부르지 않아요 — 휴대폰이 PC 등록 수를 잡아먹지 않게. */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var won = function (n) { return n == null || isNaN(n) ? '–' : Math.round(n).toLocaleString('ko-KR') + '원'; };
  var wonS = function (n) { return n == null || isNaN(n) ? '–' : (n < 0 ? '−' : n > 0 ? '+' : '') + Math.abs(Math.round(n)).toLocaleString('ko-KR') + '원'; };
  var man = function (n) { if (n == null || isNaN(n)) return '–'; var a = Math.abs(n), s = n < 0 ? '−' : ''; return a >= 1e8 ? s + (a / 1e8).toFixed(a >= 1e9 ? 0 : 1).replace(/\.0$/, '') + '억원' : a >= 1e4 ? s + Math.round(a / 1e4).toLocaleString('ko-KR') + '만원' : s + Math.round(a).toLocaleString('ko-KR') + '원'; };
  var cls = function (n) { return n == null ? '' : n > 0 ? 'pos' : n < 0 ? 'neg' : ''; };
  var LS = { get: function (k) { try { return localStorage.getItem('ksm:' + k); } catch (e) { return null; } }, set: function (k, v) { try { if (v == null || v === '') localStorage.removeItem('ksm:' + k); else localStorage.setItem('ksm:' + k, v); } catch (e) {} } };
  var ROOT = location.href.replace(/[?#].*$/, '').replace(/m\/(index\.html)?$/, '');
  var CFG = null, ACCESS = '', ACCESS_EXP = 0, EMAIL = '', DATA = null, LOADED_AT = 0, BUSY = false;
  var UI = { tab: LS.get('tab') || 'sum', sales: { seg: 'done', ch: '', per: '30', q: '', n: 50 }, stock: { q: '', n: 60 }, mkt: { seg: 'mine', q: '' } };
  // 11/25: 알림을 눌러 들어오면 ?t=drop 처럼 그 탭으로
  try { var qt = new URLSearchParams(location.search).get('t'); if (qt) { UI.tab = qt; LS.set('tab', qt); if (history.replaceState) history.replaceState(null, '', location.pathname); } } catch (e) {}
  if (['sum', 'scan', 'stock', 'sales', 'set', 'mkt', 'drop'].indexOf(UI.tab) < 0) UI.tab = 'sum';
  var VIEWS = {};   // 11/22 현장 앱(m2.js)이 더하는 화면: scan · stock · set

  // ---------- 서버 ----------
  function loadCfg() {
    if (CFG) return Promise.resolve(CFG);
    return fetch(ROOT + 'shop.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }).then(function (j) {
      var s = (j && j.supa) || {}, url = String(s.url || '').trim().replace(/\/+$/, ''), anon = String(s.anon || '').trim();
      if (!/^https:\/\/[^\s/]+$/.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url)) url = '';
      CFG = url && anon ? { url: url, anon: anon } : { missing: true };
      return CFG;
    });
  }
  function authHeaders(tok) {
    var h = { apikey: CFG.anon, 'content-type': 'application/json' };
    if (tok) h.authorization = 'Bearer ' + tok; else if (/^eyJ/.test(CFG.anon)) h.authorization = 'Bearer ' + CFG.anon;
    return h;
  }
  function call(method, path, body, tok) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null, t = ctl ? setTimeout(function () { ctl.abort(); }, 15000) : 0;
    return fetch(CFG.url + path, { method: method, headers: authHeaders(tok), body: body == null ? undefined : JSON.stringify(body), signal: ctl ? ctl.signal : undefined, cache: 'no-store' })
      .then(function (r) { clearTimeout(t); return r.text().then(function (x) { var j = null; try { j = x ? JSON.parse(x) : null; } catch (e) {} return { ok: r.ok, status: r.status, j: j, t: x }; }); })
      .catch(function (e) { clearTimeout(t); throw new Error('net'); });
  }
  function keep(j) {
    ACCESS = j.access_token; ACCESS_EXP = Date.now() + ((+j.expires_in || 3600) - 60) * 1000;
    if (j.user && j.user.email) EMAIL = j.user.email;
    if (LS.get('auto') !== '0' && j.refresh_token) LS.set('rt', j.refresh_token);
  }
  function refresh() {
    var rt = LS.get('rt'); if (!rt) return Promise.resolve(false);
    return call('POST', '/auth/v1/token?grant_type=refresh_token', { refresh_token: rt }).then(function (r) {
      if (r.ok && r.j && r.j.access_token) { keep(r.j); return true; }
      if (r.status >= 400 && r.status < 500) LS.set('rt', '');
      return false;
    });
  }
  function token() { return ACCESS && Date.now() < ACCESS_EXP ? Promise.resolve(ACCESS) : refresh().then(function (ok) { return ok ? ACCESS : ''; }); }
  var AUTH_WHY = { invalid_credentials: '이메일 또는 비밀번호가 맞지 않아요', email_not_confirmed: '가입 확인 메일의 링크를 먼저 눌러 주세요', over_request_rate_limit: '잠시 뒤에 다시 해 주세요 (요청이 너무 많아요)', over_email_send_rate_limit: '메일을 너무 자주 보냈어요. 잠시 뒤에 다시 해 주세요', user_banned: '쓸 수 없는 계정이에요' };
  function authMsg(r, def) { var c = r.j && (r.j.error_code || r.j.code); return AUTH_WHY[c] || (r.status === 400 ? '이메일 또는 비밀번호가 맞지 않아요' : r.status === 429 ? AUTH_WHY.over_request_rate_limit : def); }

  // ---------- 화면 전환 ----------
  function show(which) {
    $('#login').hidden = which !== 'login'; $('#app').hidden = which !== 'app';
    $('#tabs').hidden = which !== 'app'; $('#topBtns').hidden = which !== 'app';
    if (which !== 'app') { $('#menu').hidden = true; $('#upd').textContent = '휴대폰 보기'; $('#upd').className = ''; }
  }
  function loginScreen(msg, ok) {
    show('login');
    var em = LS.get('email'); if (em && !$('#lEmail').value) $('#lEmail').value = em;
    $('#lRemember').checked = LS.get('remember') !== '0'; $('#lAuto').checked = LS.get('auto') !== '0';
    var m = $('#lMsg'); m.textContent = msg || ''; m.className = 'msg' + (ok ? ' ok' : '');
  }
  function fatal(t) { show('login'); $('#loginForm').hidden = true; var m = document.createElement('div'); m.className = 'empty'; m.innerHTML = '<b>지금은 열 수 없어요</b>' + esc(t); $('#login').appendChild(m); }

  // ---------- 데이터 ----------
  function load(quiet) {
    if (BUSY) return Promise.resolve(); BUSY = true;
    var rb = $('#btnRefresh'); rb.classList.add('spin'); rb.disabled = true;
    return token().then(function (tok) {
      if (!tok) { DATA = null; loginScreen(LS.get('email') ? '다시 로그인해 주세요' : ''); return; }
      return call('GET', '/rest/v1/ks_snap?select=kind,data,updated_at', null, tok).then(function (r) {
        if (r.status === 401) { ACCESS = ''; return refresh().then(function (ok) { return ok ? call('GET', '/rest/v1/ks_snap?select=kind,data,updated_at', null, ACCESS) : r; }); }
        return r;
      }).then(function (r) {
        if (!r) return;
        if (r.status === 401) { DATA = null; loginScreen('다시 로그인해 주세요'); return; }
        if (r.status === 404 || /PGRST205|42P01/.test(r.t || '')) { DATA = { notReady: true }; }
        else if (!r.ok || !Array.isArray(r.j)) { banner('불러오지 못했어요. 잠시 뒤에 새로고침해 주세요 (서버 응답 ' + r.status + ')'); return; }
        else { DATA = {}; r.j.forEach(function (row) { if (row && row.kind) DATA[row.kind] = Object.assign({}, row.data || {}, { _up: row.updated_at }); }); }
        LOADED_AT = Date.now(); banner(''); show('app'); render();
        if (window.KSM && KSM.onLoad) KSM.onLoad(tok);
      });
    }).catch(function () { if (DATA) banner('인터넷 연결을 확인해 주세요 — 마지막으로 불러온 내용을 보여 줘요'); else if (!$('#app').hidden) banner('인터넷 연결을 확인해 주세요'); else loginScreen('인터넷 연결을 확인해 주세요'); })
      .then(function () { BUSY = false; rb.classList.remove('spin'); rb.disabled = false; });
  }
  function banner(t, info) { var b = $('#banner'); b.hidden = !t; b.textContent = t || ''; b.className = 'banner' + (info ? ' info' : ''); }
  function ago(t) {
    if (!t) return ''; var m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return '방금'; if (m < 60) return m + '분 전'; if (m < 1440) return Math.floor(m / 60) + '시간 전';
    var d = new Date(t); return (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
  }
  var KIND_OF = { sum: 'summary', sales: 'sales', stock: 'stock', mkt: 'market' };
  function stamp() {
    var u = $('#upd'), k = DATA && DATA[KIND_OF[UI.tab]], all = DATA ? ['summary', 'sales', 'stock', 'market'].map(function (x) { return DATA[x] && +DATA[x].at || 0; }) : [];
    var t = (k && +k.at) || Math.max.apply(null, all.concat([0]));
    u.textContent = t ? '마지막 갱신 ' + ago(t) + ' (PC 기준)' : 'PC에서 아직 안 올라왔어요';
    u.className = t && Date.now() - t > 24 * 3600e3 ? 'old' : '';
  }
  var NONE = '<div class="empty"><b>아직 올라온 내용이 없어요</b>PC 킥스캔에서 이 계정으로 로그인해 한 번 켜 두면 여기 나와요.<br>(설정의 \'휴대폰 보기에 올리기\'가 켜져 있어야 해요)</div>';

  function render() {
    document.querySelectorAll('#tabs button').forEach(function (b) { b.setAttribute('aria-current', String(b.dataset.t === UI.tab)); });
    stamp();
    var v = $('#view');
    if (VIEWS[UI.tab]) { v.innerHTML = VIEWS[UI.tab](); if (VIEWS[UI.tab].after) VIEWS[UI.tab].after(); return; }
    if (!DATA) { v.innerHTML = ''; return; }
    if (DATA.notReady) { v.innerHTML = '<div class="empty"><b>서버 준비 중이에요</b>판매자가 휴대폰 보기 서버를 아직 준비하지 않았어요. 준비되면 PC 킥스캔이 저절로 올려요.</div>'; return; }
    v.innerHTML = UI.tab === 'sales' ? vSales() : UI.tab === 'stock' ? vStock() : UI.tab === 'mkt' ? vMkt() : vSum();
  }

  // ---------- 요약 ----------
  function vSum() {
    var S = DATA.summary; if (!S) return NONE;
    var M = S.month, P = S.prev, h = '';
    if (S.bizN > 1 && S.biz) h += '<p class="banner info">' + esc(S.biz) + ' 기준이에요 (PC에서 지금 고른 사업자)</p>';
    if (M) {
      var d = P ? M.margin - P.margin : null;
      h += '<div class="hero"><div class="lbl">' + (+M.m.slice(5)) + '월 판매 마진</div><div class="big">' + esc(wonS(M.margin)) + '</div>' +
        '<div class="row"><span>판매 ' + M.sold + '개</span><span>매출 ' + esc(won(M.rev)) + '</span></div>' +
        (P ? '<div class="cmp">지난달(' + (+P.m.slice(5)) + '월) 마진 ' + esc(wonS(P.margin)) + ' · ' + (d >= 0 ? '▲ ' : '▼ ') + esc(won(Math.abs(d))) + '</div>' : '') + '</div>';
      h += '<div class="grid2">' +
        kc('오늘 판매', (S.today ? S.today.sold : 0) + '개', S.today && S.today.rev ? won(S.today.rev) : '') +
        kc('이번 주 판매', (S.week ? S.week.sold : 0) + '개', '월요일부터') +
        kc('재고', (S.stock ? S.stock.qty : 0) + '개', S.stock ? S.stock.skus + '종' : '') +
        kc('재고 자산', man(S.stock ? S.stock.value : 0), '매입가 기준') + '</div>';
      h += '<h2 class="sec">' + (+M.m.slice(5)) + '월 · ' + (P ? (+P.m.slice(5)) + '월' : '') + ' 실적</h2><div class="box"><dl class="kv">' +
        row2('판매', M.sold + '개', P && P.sold + '개') + row2('매출', won(M.rev), P && won(P.rev)) + row2('수수료', won(M.fees), P && won(P.fees)) +
        row2('매입', won(M.buy), P && won(P.buy)) + '<dt>판매 마진</dt><dd><b class="' + cls(M.margin) + '">' + esc(wonS(M.margin)) + '</b>' + (P ? '<br><span class="small sub">지난달 ' + esc(wonS(P.margin)) + '</span>' : '') + '</dd></dl>' +
        '<p class="note">판매 마진 = 판매 − 수수료 − 매입원가 − 택배비</p></div>';
    } else h += '<div class="empty"><b>재고관리 기록이 없어요</b>PC 킥스캔 재고관리에 입고 · 출고를 넣으면 실적이 나와요.</div>';
    var tasks = [];
    if (S.pending) tasks.push(['크림 진행 중 (정산 전)', S.pending + '건', 'warn']);
    if (S.unrec) tasks.push(['재고 미등록 크림 판매', S.unrec + '건', 'bad']);
    if (S.pre) tasks.push(['우선출고 정산 대기', S.pre + '건', 'warn']);
    if (tasks.length) h += '<h2 class="sec">확인할 것</h2><div class="box"><dl class="kv">' + tasks.map(function (t) { return '<dt>' + esc(t[0]) + '</dt><dd><span class="pill ' + t[2] + '">' + esc(t[1]) + '</span></dd>'; }).join('') + '</dl></div>';
    if (S.months && S.months.length) {
      var mx = Math.max.apply(null, S.months.map(function (m) { return Math.abs(m.margin); }).concat([1]));
      h += '<h2 class="sec">최근 6개월 마진</h2><div class="box"><div class="bars" role="img" aria-label="최근 6개월 판매 마진">' + S.months.map(function (m) {
        return '<div class="bar"><em>' + esc(man(m.margin)) + '</em><i class="' + (m.margin < 0 ? 'n' : '') + '" style="height:' + Math.max(2, Math.round(Math.abs(m.margin) / mx * 78)) + '%"></i><small>' + (+m.m.slice(5)) + '월</small></div>';
      }).join('') + '</div></div>';
    }
    return h + '<p class="foot">PC 킥스캔이 켜져 있을 때 바뀐 내용이 올라와요.</p>';
  }
  function kc(l, v, s) { return '<div class="kc"><span>' + esc(l) + '</span><b>' + esc(v) + '</b>' + (s ? '<small>' + esc(s) + '</small>' : '') + '</div>'; }
  function row2(l, a, b) { return '<dt>' + esc(l) + '</dt><dd>' + esc(a) + (b ? '<br><span class="small sub">지난달 ' + esc(b) + '</span>' : '') + '</dd>'; }

  // ---------- 판매 ----------
  function dayStr(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function perRange(p) {
    var t = new Date(), to = dayStr(t);
    if (p === '7' || p === '30' || p === '90') { var a = new Date(); a.setDate(a.getDate() - (+p - 1)); return [dayStr(a), to]; }
    if (p === 'm') return [to.slice(0, 8) + '01', to];
    if (p === 'pm') { var x = new Date(t.getFullYear(), t.getMonth() - 1, 1), y = new Date(t.getFullYear(), t.getMonth(), 0); return [dayStr(x), dayStr(y)]; }
    return ['', ''];
  }
  function hit(r, q) { q = String(q || '').trim().toLowerCase(); if (!q) return true; var k = q.replace(/[^0-9a-z]/g, ''); var s = (r.n + ' ' + r.c + ' ' + r.sz + ' ' + (r.ch || '')).toLowerCase(); return s.indexOf(q) >= 0 || (k.length >= 3 && String(r.c || '').toLowerCase().replace(/[^0-9a-z]/g, '').indexOf(k) >= 0); }
  function vSales() {
    var D = DATA.sales; if (!D) return NONE;
    var U = UI.sales, rows = D.rows || [], pend = D.pending || [], unrec = D.unrec || [];
    var chs = []; rows.forEach(function (r) { if (r.ch && chs.indexOf(r.ch) < 0) chs.push(r.ch); });
    var rg = perRange(U.per), inR = function (r) { var d = String(r.d || '').slice(0, 10); return !rg[0] || (d >= rg[0] && d <= rg[1]); };
    var h = '<div class="seg" role="group">' + [['done', '판매 내역'], ['pend', '진행 중 ' + pend.length], ['unrec', '재고 미등록 ' + unrec.length]].map(function (s) { return '<button type="button" data-seg="sales" data-v="' + s[0] + '" aria-pressed="' + (U.seg === s[0]) + '">' + esc(s[1]) + '</button>'; }).join('') + '</div>';
    h += '<div class="filters">' + (U.seg === 'done' ? '<select data-k="sales.ch" aria-label="판매처"><option value="">판매처 전체</option>' + chs.map(function (c) { return '<option' + (c === U.ch ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' : '') +
      '<select data-k="sales.per" aria-label="기간"' + (U.seg !== 'done' ? ' style="grid-column:1/-1"' : '') + '>' + [['7', '최근 7일'], ['30', '최근 30일'], ['90', '최근 90일'], ['m', '이번 달'], ['pm', '지난달'], ['', '전체']].map(function (p) { return '<option value="' + p[0] + '"' + (p[0] === U.per ? ' selected' : '') + '>' + p[1] + '</option>'; }).join('') + '</select>' +
      '<input type="search" class="q" data-k="sales.q" placeholder="상품명 · 모델번호 · 사이즈" value="' + esc(U.q) + '" aria-label="검색"></div>';
    var L, body = '';
    if (U.seg === 'pend') {
      L = pend.filter(function (r) { return inR(r) && hit(r, U.q); });
      h += '<div class="tot"><span><b>' + L.length + '</b>건</span><span>예상 정산 <b>' + esc(won(L.reduce(function (s, r) { return s + (+r.pay || 0); }, 0))) + '</b></span>' + (D.pendingAt ? '<span>' + esc(ago(D.pendingAt)) + ' 기준</span>' : '') + '</div>';
      body = L.slice(0, U.n).map(function (r) { return '<div class="it"><div class="h"><span>' + esc(String(r.d).slice(0, 10)) + ' 체결</span><span class="pill warn">' + esc(r.st || '진행 중') + '</span></div><div class="n">' + esc(r.n) + '</div><div class="c">' + esc([r.c, r.sz].filter(Boolean).join(' · ')) + '</div><div class="f"><span class="sub">판매가 ' + esc(won(r.p)) + '</span><span>예상 정산 <b>' + esc(r.pay ? won(r.pay) : '–') + '</b></span></div></div>'; }).join('');
      if (!pend.length) body = '<div class="empty">진행 중(체결 뒤 정산 전)인 크림 판매가 없어요.<br>PC의 \'판매 · 구매 내역\'에서 정산을 불러오면 같이 올라와요.</div>';
    } else if (U.seg === 'unrec') {
      L = unrec.filter(function (r) { return inR(r) && hit(r, U.q); });
      h += '<div class="tot"><span><b>' + L.length + '</b>건</span><span>PC 재고관리에 상품을 등록하면 판매 내역으로 옮겨져요</span></div>';
      body = L.slice(0, U.n).map(function (r) { return '<div class="it"><div class="h"><span>' + esc(String(r.d).slice(0, 10)) + ' · ' + esc(r.k || '크림') + '</span><span class="pill bad">재고 미등록</span></div><div class="n">' + esc(r.n) + '</div><div class="c">' + esc([r.c, r.sz].filter(Boolean).join(' · ')) + '</div><div class="f"><span class="sub">판매가 ' + esc(won(r.p)) + '</span><span>정산 <b>' + esc(r.pay ? won(r.pay) : '–') + '</b></span></div>' + (r.why ? '<div class="why">' + esc(r.why) + '</div>' : '') + '</div>'; }).join('');
      if (!unrec.length) body = '<div class="empty">재고관리에 못 넣은 크림 판매가 없어요.</div>';
    } else {
      L = rows.filter(function (r) { return inR(r) && (!U.ch || r.ch === U.ch) && hit(r, U.q); });
      var q = 0, rev = 0, mg = 0, mgN = 0; L.forEach(function (r) { q += +r.q || 0; rev += (+r.p || 0) * (+r.q || 0); if (r.m != null) { mg += r.m; mgN++; } });
      h += '<div class="tot"><span><b>' + L.length + '</b>건 · ' + q + '개</span><span>매출 <b>' + esc(won(rev)) + '</b></span><span>마진 <b class="' + cls(mg) + '">' + esc(mgN ? wonS(mg) : '–') + '</b></span></div>';
      body = L.slice(0, U.n).map(function (r) {
        var pc = r.st === '정산완료' ? 'ok' : r.st === '반품' ? 'bad' : 'warn';
        return '<div class="it"><div class="h"><span>' + esc(String(r.d).slice(0, 10)) + ' · <b>' + esc(r.ch) + '</b> ' + esc(r.k) + '</span><span class="pill ' + pc + '">' + esc(r.st) + '</span></div><div class="n">' + esc(r.n) + '</div><div class="c">' + esc([r.c, r.sz, r.q > 1 ? r.q + '개' : ''].filter(Boolean).join(' · ')) + '</div>' +
          '<div class="f"><span class="sub">' + (r.p ? '판매 ' + esc(won(r.p)) : '판매가 미정') + (r.cost ? ' · 매입 ' + esc(won(r.cost)) : '') + '</span><span>마진 <b class="' + cls(r.m) + '">' + esc(r.m == null ? '–' : wonS(r.m)) + '</b></span></div></div>';
      }).join('');
      if (!rows.length) body = '<div class="empty">아직 판매 기록이 없어요.<br>PC 재고관리의 출고 · 크림 정산이 여기에 나와요.</div>';
      else if (D.total > rows.length) h += '<p class="note" style="margin:0 0 8px">최근 ' + rows.length + '건만 보여요 (전체 ' + D.total + '건은 PC에서)</p>';
    }
    if (L && !L.length && body.indexOf('empty') < 0) body = '<div class="empty">조건에 맞는 내역이 없어요.</div>';
    return h + '<div class="list">' + body + '</div>' + (L && L.length > U.n ? '<button type="button" class="ghost more" data-more="sales">더 보기 (' + (L.length - U.n) + '건 더)</button>' : '');
  }

  // ---------- 재고 ----------
  function vStock() {
    var D = DATA.stock; if (!D) return NONE;
    var U = UI.stock, rows = D.rows || [];
    if (!rows.length) return '<div class="empty"><b>지금 남은 재고가 없어요</b>PC 재고관리에 입고하면 여기 나와요.</div>';
    var by = [], idx = {};
    rows.forEach(function (r) { var k = r.n + '|' + r.c; if (!(k in idx)) { idx[k] = by.length; by.push({ n: r.n, c: r.c, b: r.b, q: 0, v: 0, s: [] }); } var g = by[idx[k]]; g.q += +r.q || 0; g.v += +r.v || 0; g.s.push(r); });
    var L = by.filter(function (g) { return hit({ n: g.n, c: g.c, sz: g.s.map(function (x) { return x.sz; }).join(' '), ch: g.b }, U.q); });
    L.sort(function (a, b) { return b.v - a.v; });
    var tq = 0, tv = 0; by.forEach(function (g) { tq += g.q; tv += g.v; });
    var h = '<div class="filters"><input type="search" class="q" data-k="stock.q" placeholder="상품명 · 모델번호 · 브랜드 · 사이즈" value="' + esc(U.q) + '" aria-label="검색"></div>';
    h += '<div class="tot"><span><b>' + by.length + '</b>종 · <b>' + tq + '</b>개</span><span>재고 자산 <b>' + esc(won(tv)) + '</b></span><span>재고 자산 큰 순서</span></div>';
    if (D.total > rows.length) h += '<p class="note" style="margin:0 0 8px">' + rows.length + '줄까지만 올라왔어요 (전체 ' + D.total + '줄은 PC에서)</p>';
    h += '<div class="list">' + (L.length ? L.slice(0, U.n).map(function (g) {
      var avg = g.q ? g.v / g.q : 0;
      return '<div class="it"><div class="n">' + esc(g.n) + '</div><div class="c">' + esc([g.c, g.b].filter(Boolean).join(' · ')) + '</div><div class="f"><span class="sub">평균 매입 ' + esc(won(avg)) + '</span><span><b>' + g.q + '개</b> · ' + esc(man(g.v)) + '</span></div>' +
        '<div class="sizes">' + g.s.map(function (x) { return '<span>' + esc(x.sz || '-') + ' <b>×' + x.q + '</b>' + (g.s.length > 1 && x.avg && Math.abs(x.avg - avg) > 1 ? ' <span class="sub">' + esc(man(x.avg)) + '</span>' : '') + '</span>'; }).join('') + '</div></div>';
    }).join('') : '<div class="empty">조건에 맞는 재고가 없어요.</div>') + '</div>';
    return h + (L.length > U.n ? '<button type="button" class="ghost more" data-more="stock">더 보기 (' + (L.length - U.n) + '종 더)</button>' : '');
  }

  // ---------- 시세 · 찾기 ----------
  var GRADE = { go: ['남음', 'ok'], near: ['비슷', 'warn'], pricey: ['비쌈', 'bad'], none: ['매입처 없음', ''] };
  function vMkt() {
    var D = DATA.market; if (!D) return NONE;
    var U = UI.mkt, mine = D.mine || [], F = D.find;
    var h = '<div class="seg" role="group">' + [['mine', '내 상품 ' + mine.length], ['find', '최근 찾기' + (F ? ' ' + (F.items || []).length : '')]].map(function (s) { return '<button type="button" data-seg="mkt" data-v="' + s[0] + '" aria-pressed="' + (U.seg === s[0]) + '">' + esc(s[1]) + '</button>'; }).join('') + '</div>';
    h += '<div class="filters"><input type="search" class="q" data-k="mkt.q" placeholder="상품명 · 모델번호" value="' + esc(U.q) + '" aria-label="검색"></div>';
    var body;
    if (U.seg === 'find') {
      if (!F || !(F.items || []).length) return h + '<div class="empty"><b>최근 찾기 결과가 없어요</b>PC의 \'아이템 찾기 · 랭킹 분석\'을 돌리면 상위 50개가 여기 나와요.</div>';
      var FL = F.items.filter(function (r) { return hit(r, U.q); });
      h += '<div class="tot"><span>' + esc(F.what || '찾기') + ' · ' + esc(F.stage || '') + '</span><span>' + esc(ago(F.at)) + '</span><span>상위 ' + F.items.length + '개' + (F.total > F.items.length ? ' / 전체 ' + F.total + '개' : '') + '</span></div>';
      body = FL.map(function (r) {
        var g = GRADE[r.g] || GRADE.none;
        return '<div class="it"><div class="h"><span>7일 거래 ' + (r.e7 != null ? r.e7 + '건' : '–') + '</span><span class="pill ' + g[1] + '">' + g[0] + '</span></div><div class="n">' + esc(r.n) + '</div><div class="c">' + esc(r.c || '') + '</div>' +
          '<div class="f"><span class="sub">크림 정산 ' + esc(won(r.settle)) + (r.src ? '<br>' + esc(r.src) + ' ' + esc(won(r.buy)) : '') + '</span><span>마진 <b class="' + cls(r.m) + '">' + esc(r.m == null ? '–' : wonS(r.m)) + '</b></span></div></div>';
      }).join('') || '<div class="empty">조건에 맞는 상품이 없어요.</div>';
      return h + '<div class="list">' + body + '</div>';
    }
    if (!mine.length) return h + '<div class="empty"><b>내 상품이 없어요</b>PC의 \'내 상품 시세 · 마진\'에 상품을 넣고 수집하면 여기 나와요.</div>';
    var ML = mine.filter(function (r) { return hit(r, U.q); });
    body = ML.map(function (r) {
      var vk = r.vk === 'ok' ? 'ok' : r.vk === 'bad' ? 'bad' : r.vk ? 'warn' : '';
      return '<div class="it"><div class="h"><span>' + (r.at ? esc(ago(r.at)) + ' 수집' : '수집 전') + (r.e7 != null ? ' · 7일 ' + r.e7 + '건' : '') + '</span>' + (r.vd ? '<span class="pill ' + vk + '">' + esc(r.vd) + '</span>' : '') + '</div><div class="n">' + esc(r.n) + '</div><div class="c">' + esc(r.c || '') + '</div>' +
        (r.err ? '<div class="why">' + esc(r.err) + '</div>' : '<div class="f"><span class="sub">판매가 ' + esc(won(r.sell)) + ' · 정산 ' + esc(won(r.settle)) + (r.cost ? '<br>매입가 ' + esc(won(r.cost)) : '<br>매입가 없음') + '</span><span>마진 <b class="' + cls(r.m) + '">' + esc(r.m == null ? '–' : wonS(r.m)) + '</b></span></div>') + '</div>';
    }).join('') || '<div class="empty">조건에 맞는 상품이 없어요.</div>';
    return h + '<div class="list">' + body + '</div>';
  }

  // ---------- 이벤트 ----------
  function setK(k, v) { var p = k.split('.'); UI[p[0]][p[1]] = v; if (p[0] === 'sales') UI.sales.n = 50; if (p[0] === 'stock') UI.stock.n = 60; }
  $('#view').addEventListener('click', function (e) {
    var s = e.target.closest('[data-seg]'); if (s) { UI[s.dataset.seg].seg = s.dataset.v; UI.sales.n = 50; render(); return; }
    var m = e.target.closest('[data-more]'); if (m) { UI[m.dataset.more].n += 60; render(); }
  });
  $('#view').addEventListener('change', function (e) { var el = e.target.closest('select[data-k]'); if (el) { setK(el.dataset.k, el.value); render(); } });
  var qT = null;
  $('#view').addEventListener('input', function (e) {
    var el = e.target.closest('input[data-k]'); if (!el) return;
    setK(el.dataset.k, el.value); clearTimeout(qT);
    qT = setTimeout(function () { var k = el.dataset.k, pos = el.selectionStart; render(); var n = document.querySelector('input[data-k="' + k + '"]'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (x) {} } }, 250);
  });
  $('#tabs').addEventListener('click', function (e) { var b = e.target.closest('[data-t]'); if (!b) return; UI.tab = b.dataset.t; LS.set('tab', UI.tab); render(); window.scrollTo(0, 0); });
  $('#btnRefresh').addEventListener('click', function () { load(); });
  $('#btnMenu').addEventListener('click', function () { var m = $('#menu'); m.hidden = !m.hidden; $('#btnMenu').setAttribute('aria-expanded', String(!m.hidden)); $('#menuMail').textContent = EMAIL || LS.get('email') || ''; });
  $('#btnLogout').addEventListener('click', function () {
    var tok = ACCESS; if (tok && CFG && CFG.url) call('POST', '/auth/v1/logout?scope=local', {}, tok).catch(function () {});
    ACCESS = ''; ACCESS_EXP = 0; DATA = null; LS.set('rt', ''); $('#lPw').value = ''; $('#view').innerHTML = '';
    loginScreen('로그아웃했어요', true);
  });
  $('#loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var em = $('#lEmail').value.trim(), pw = $('#lPw').value, btn = $('#lBtn'), msg = $('#lMsg');
    if (!em || !pw) { msg.className = 'msg'; msg.textContent = '이메일과 비밀번호를 넣어 주세요'; return; }
    LS.set('remember', $('#lRemember').checked ? '1' : '0'); LS.set('auto', $('#lAuto').checked ? '1' : '0');
    LS.set('email', $('#lRemember').checked ? em : '');
    btn.disabled = true; btn.textContent = '로그인 중…'; msg.textContent = '';
    loadCfg().then(function () {
      if (CFG.missing) throw new Error('cfg');
      return call('POST', '/auth/v1/token?grant_type=password', { email: em, password: pw });
    }).then(function (r) {
      if (!(r.ok && r.j && r.j.access_token)) { msg.className = 'msg'; msg.textContent = authMsg(r, '로그인 서버에 연결이 안 돼요. 잠시 뒤에 다시 해 주세요'); return; }
      EMAIL = em; keep(r.j); if (!$('#lAuto').checked) LS.set('rt', ''); $('#lPw').value = ''; return load();
    }).catch(function (er) { msg.className = 'msg'; msg.textContent = er && er.message === 'cfg' ? '서버 설정이 아직 안 됐어요. 판매자에게 문의해 주세요' : '인터넷 연결을 확인해 주세요'; })
      .then(function () { btn.disabled = false; btn.textContent = '로그인'; });
  });
  $('#lForgot').addEventListener('click', function () {
    var em = $('#lEmail').value.trim(), msg = $('#lMsg');
    if (!/^\S+@\S+\.\S+$/.test(em)) { msg.className = 'msg'; msg.textContent = '위 칸에 가입한 이메일을 넣고 다시 눌러 주세요'; $('#lEmail').focus(); return; }
    loadCfg().then(function () {
      if (CFG.missing) throw new Error('cfg');
      return call('POST', '/auth/v1/recover?redirect_to=' + encodeURIComponent(ROOT + 'reset/?k=' + encodeURIComponent(CFG.anon)), { email: em });
    }).then(function (r) {
      msg.className = 'msg' + (r.ok ? ' ok' : ''); msg.textContent = r.ok ? '비밀번호 재설정 메일을 보냈어요. 메일의 링크를 눌러 새 비밀번호를 정해 주세요' : authMsg(r, '메일을 보내지 못했어요. 잠시 뒤에 다시 해 주세요');
    }).catch(function (er) { msg.className = 'msg'; msg.textContent = er && er.message === 'cfg' ? '서버 설정이 아직 안 됐어요. 판매자에게 문의해 주세요' : '인터넷 연결을 확인해 주세요'; });
  });
  // 다시 앱으로 돌아오면(1분 넘게 지났을 때) 새로 불러와요
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && DATA && Date.now() - LOADED_AT > 60000) load(true); });
  setInterval(function () { if (DATA) stamp(); }, 30000);

  // 11/22: 현장 앱(m2.js)이 쓰는 다리
  window.KSM = { call: call, token: token, render: render, banner: banner, esc: esc, won: won, wonS: wonS, man: man, ago: ago, LS: LS, UI: UI, VIEWS: VIEWS, vMkt: function () { return DATA && DATA.market ? vMkt() : NONE; }, vSum: function () { return DATA && DATA.summary ? vSum() : NONE; }, vStockOld: function () { return DATA && DATA.stock ? vStock() : NONE; }, data: function () { return DATA; }, email: function () { return EMAIL || LS.get('email') || ''; }, cfg: function () { return CFG; } };

  // ---------- 시작 ----------
  loadCfg().then(function (c) {
    if (c.missing) return fatal('서버 설정(shop.json 의 supa.url · supa.anon)이 아직 비어 있어요. 판매자에게 문의해 주세요.');
    if (LS.get('rt') && LS.get('auto') !== '0') { show('app'); $('#view').innerHTML = '<div class="empty">불러오는 중…</div>'; return load(); }
    loginScreen('');
  });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname))) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();
