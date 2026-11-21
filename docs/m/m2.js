/* 킥스캔 현장 앱 (지시서 C-4 · 줍픽 현장 앱) — m.js 의 다리(window.KSM)를 써요
   서버 ks_doc(docs/supabase/sync-setup.sql) 에서 PC 가 올린 상품 · 입고(남은 수량) · 거래처 · 결제수단 · PC 신호를 받아요.
   - 스캔: 오늘 매장 · 할인율(하루 한 번) → 카메라 바코드(EAN-13 · UPC-A · Code128, 안 되면 직접 입력) → 판정 → [매입 등록]
   - 판정: 태그가 → 할인 반영 매입가 · 사이즈별 KREAM 최저 판매가 · 즉시 판매가 · 30일 거래 · 예상 수익 · 이미 보유 중 · 내 매입 기록
   - 시세: 폰은 KREAM 에 직접 가지 않아요 — 조회 요청(job)을 넣으면 켜져 있는 PC 킥스캔이 조회해서 올려요. PC 가 꺼져 있으면 알려요.
   - 매입 등록(phone_buy)은 PC 재고에 1분 안에 들어가요. 오프라인이면 이 기기에 모아 두었다가 연결되면 올려요.
   - 처음 보는 바코드는 품번 · 사이즈를 한 번 고르면 barcode 로 저장해 다음부터 바로 찾아요. */
(function () {
  'use strict';
  if (!window.KSM) return;
  var K = window.KSM, esc = K.esc, won = K.won, wonS = K.wonS, LS = K.LS, UI = K.UI;
  var $ = function (s) { return document.querySelector(s); };
  var DOC = { item: {}, lot: {}, partner: {}, pay: {}, pc: {}, job: {}, phone_buy: {}, barcode: {}, short: {} }, DOC_AT = null, DOC_OK = null, DOC_ERR = '';
  var SC = { q: '', hit: null, tag: '', sizes: null, job: null, jobT: 0, size: '', qty: 1, cost: '', payId: '', msg: '', cam: false, stream: null, newBc: '' };
  var ST = { f: 'all', q: '' };
  var today = function () { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); };
  var ckey = function (s) { return String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, ''); };
  var uid = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };
  function rpc(fn, args) {
    return K.token().then(function (tok) {
      if (!tok) throw new Error('login');
      return K.call('POST', '/rest/v1/rpc/' + fn, args || {}, tok);
    }).then(function (r) {
      if (r.status === 404 || /PGRST202|PGRST205|42P01|42883/.test(r.t || '')) { var e = new Error('notReady'); e.notReady = true; throw e; }
      if (!r.ok) throw new Error('서버 응답 ' + r.status);
      return r.j;
    });
  }
  // 서버 문서 받기 (처음엔 전부, 그다음엔 바뀐 것만)
  function docsLoad() {
    var kinds = ['item', 'lot', 'partner', 'pay', 'pc', 'job', 'phone_buy', 'barcode', 'short'], got = 0;
    function page() {
      return rpc('ks_doc_get', { p_since: DOC_AT, p_kinds: kinds, p_limit: 2000 }).then(function (rows) {
        rows = rows || [];
        rows.forEach(function (r) { var M = DOC[r.kind]; if (!M) return; if (r.deleted) delete M[r.id]; else M[r.id] = Object.assign({}, r.data || {}, { _id: r.id, _up: r.updated_at, _by: r.by }); DOC_AT = r.updated_at; });
        got += rows.length;
        if (rows.length >= 2000) return page();
      });
    }
    return page().then(function () { DOC_OK = true; DOC_ERR = ''; return got; }).catch(function (e) { DOC_OK = e.notReady ? false : DOC_OK; DOC_ERR = e.notReady ? '서버 준비 전이에요 — PC 판매자가 동기화 표를 만들면 바로 써요' : e.message === 'login' ? '다시 로그인해 주세요' : '서버에 연결하지 못했어요'; });
  }
  function put(docs) { return rpc('ks_doc_put', { p_docs: docs.map(function (d) { return { kind: d.kind, id: d.id, data: d.data, by: 'phone', at: new Date().toISOString() }; }) }); }
  // 오프라인 대기열
  function outbox() { try { return JSON.parse(LS.get('outbox') || '[]'); } catch (e) { return []; } }
  function flush() { var Q = outbox(); if (!Q.length) return Promise.resolve(0); return put(Q).then(function () { LS.set('outbox', ''); return Q.length; }).catch(function () { return 0; }); }
  function send(docs) { return put(docs).catch(function () { var Q = outbox().concat(docs); LS.set('outbox', JSON.stringify(Q.slice(-200))); throw new Error('offline'); }); }

  var pcDoc = function () { return DOC.pc.main || null; };
  var pcOn = function () { var p = pcDoc(); return !!(p && p.at && Date.now() - p.at < 5 * 60e3); };
  function feeOf(p) { var f = (pcDoc() && pcDoc().fee) || { rate: 6, base: 2500, max: 300000 }; if (!p) return 0; return Math.floor(Math.min((p * f.rate / 100 + f.base) * 1.1, f.max) / 10) * 10; }
  function day() { try { var d = JSON.parse(LS.get('day') || 'null'); return d && d.date === today() ? d : null; } catch (e) { return null; } }
  function stores() { return Object.keys(DOC.partner).map(function (k) { return DOC.partner[k]; }).filter(function (p) { return p.kind === 'buy'; }).sort(function (a, b) { return (b.store ? 1 : 0) - (a.store ? 1 : 0) || String(a.name).localeCompare(String(b.name)); }); }
  function itemByCode(code) { var k = ckey(code); if (!k) return null; for (var id in DOC.item) { var it = DOC.item[id]; if (String(it.code || '').split('/').some(function (c) { return ckey(c) === k; })) return it; } return null; }
  // 바코드는 14자리로 맞춰 비교해요 — 매장 스캐너 UPC-A 12자리 · EAN-13 · 공식몰 GTIN-14 가 같은 상품이에요
  function bcKey(s) { var d = String(s || '').replace(/\D/g, ''); return d.length >= 8 && d.length <= 14 ? ('00000000000000' + d).slice(-14) : ''; }
  K.bcKey = bcKey;
  function findBarcode(bc) {
    bc = bcKey(bc); if (!bc) return null;
    for (var id in DOC.item) { var it = DOC.item[id], B = it.barcodes || {}; for (var s in B) if (bcKey(B[s]) === bc) return { it: it, size: s }; }
    for (var j in DOC.barcode) { var b = DOC.barcode[j]; if (bcKey(b.barcode) === bc) return { it: itemByCode(b.code) || { code: b.code, name: b.name || b.code }, size: b.size }; }
    return null;
  }
  function lotsOf(it) { var L = []; for (var id in DOC.lot) { var l = DOC.lot[id]; if (l.itemId === it._id) L.push(l); } return L.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); }); }
  function dday(s) { if (!s) return null; return Math.round((new Date(s + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 864e5); }

  // ---------- 스캔 ----------
  function vScan() {
    if (DOC_OK === false) return '<div class="empty"><b>서버 준비 전이에요</b>' + esc(DOC_ERR) + '</div>';
    var D = day(), S = stores(), h = '';
    h += '<div class="box sc-day"><div class="sc-row"><b>오늘 매장</b>' + (D ? '<span>' + esc(D.store) + ' · 할인 ' + (+D.disc || 0) + '%</span><button type="button" class="linkbtn" data-sc="dayEdit">다른 매장 ›</button>' : '<span class="sub">하루 한 번 골라 주세요</span>') + '</div>' +
      (!D || SC.dayEdit ? '<div class="sc-dayf"><select data-sc-k="store"><option value="">매장 고르기</option>' + S.map(function (p) { return '<option value="' + esc(p._id) + '"' + (D && D.storeId === p._id ? ' selected' : '') + '>' + esc(p.name) + (p.lastDisc != null ? ' · 지난 할인 ' + p.lastDisc + '%' : '') + '</option>'; }).join('') + '<option value="_new">+ 직접 입력</option></select><input type="text" data-sc-k="storeNew" placeholder="매장 이름" hidden><input type="number" inputmode="decimal" data-sc-k="disc" placeholder="오늘 할인율 %" value="' + (D ? +D.disc || '' : '') + '"><button type="button" class="primary" data-sc="daySave">이 매장으로 스캔</button></div>' : '') + '</div>';
    if (!D) return h;
    h += '<div class="sc-bar"><button type="button" class="primary wide" data-sc="cam">' + (SC.cam ? '카메라 끄기' : '카메라로 바코드 스캔') + '</button></div>' +
      (SC.cam ? '<div class="sc-cam"><video id="scVideo" playsinline muted></video><div class="sc-frame"></div></div>' : '') +
      '<div class="filters sc-q"><input type="search" data-sc-k="q" placeholder="바코드 또는 품번 — 예: DD1391-100" value="' + esc(SC.q) + '" inputmode="text" autocomplete="off"><button type="button" class="ghost" data-sc="find">찾기</button></div>';
    if (SC.msg) h += '<p class="banner info">' + esc(SC.msg) + '</p>';
    if (!SC.hit || SC.ocr) h += vOcr();
    if (SC.hit) h += vJudge();
    return h + '<p class="foot">' + (pcOn() ? 'PC 킥스캔이 켜져 있어요 — 시세 조회 · 매입 반영이 1분 안에 돼요' : 'PC 킥스캔이 꺼져 있으면 시세 조회는 PC 가 켜진 뒤에 돼요. 매입 등록은 지금 해 두면 PC 가 켜질 때 들어가요') + '</p>';
  }
  function vJudge() {
    var H = SC.hit, it = H.it, D = day(), disc = D ? +D.disc || 0 : 0;
    var tag = +SC.tag || 0, cost = SC.cost !== '' ? +SC.cost : tag ? Math.round(tag * (1 - disc / 100) / 10) * 10 : 0;
    var own = it._id ? lotsOf(it) : [], left = own.filter(function (l) { return +l.left > 0; });
    var J = SC.job, sizes = J && J.status === 'done' ? J.sizes || {} : null, ship = (pcDoc() && pcDoc().fee && pcDoc().fee.ship) || 0;
    var h = '<div class="box sc-j"><div class="sc-jh"><div><b>' + esc(it.name || it.code) + '</b><div class="c">' + esc(it.code || '') + (H.size ? ' · 스캔 사이즈 <b>' + esc(H.size) + '</b>' : '') + '</div></div>' + (it.img ? '<img src="' + esc(it.img) + '" alt="">' : '') + '</div>';
    if (H.official) h += '<p class="note">나이키 공식몰 바코드 — 품번 · 사이즈를 공식 정보로 찾았어요</p>';
    if (H.shared) h += '<p class="note">공유 바코드 — 킥스캔 사용자 ' + H.shared + '명이 확인한 품번 · 사이즈예요</p>';
    if (H.bc && !H.learned && !H.shared && !H.official && (!findBarcode(H.bc) || H.src === 'ocr')) { var lz = String(SC.size || H.size || ''); h += '<div class="box sc-learn"><b>바코드 ' + esc(H.bc) + '</b><span class="sub"> = ' + esc(String(it.code || '').split('/')[0]) + ' · ' + (lz ? esc(lz) : '사이즈를 골라 주세요') + '</span><button type="button" class="ghost wide" data-sc="learn"' + (lz ? '' : ' disabled') + '>이 바코드 기억하기</button></div>'; }
    if (left.length) h += '<p class="banner">이미 보유 중 — ' + left.map(function (l) { return esc(l.size) + ' ' + l.left + '개'; }).join(' · ') + '</p>';
    h += '<div class="sc-calc"><label>태그가<input type="number" inputmode="numeric" data-sc-k="tag" value="' + esc(SC.tag) + '" placeholder="원"></label><span>× (1 − ' + disc + '%)</span><label>매입가<input type="number" inputmode="numeric" data-sc-k="cost" value="' + (cost || '') + '" placeholder="원"></label></div>';
    if (!J) h += '<button type="button" class="ghost wide" data-sc="quote">KREAM 시세 조회 (PC 가 조회해요)</button>';
    else if (J.status === 'wait') h += '<p class="banner info">' + (pcOn() ? 'PC 킥스캔이 KREAM 을 조회하는 중이에요… (보통 10~30초)' : 'PC 의 킥스캔이 꺼져 있어요 — 켜지면 바로 조회해서 여기 보여 드려요') + '</p>';
    else if (J.status === 'fail') h += '<p class="banner">시세를 못 받았어요: ' + esc(J.why || '') + '</p><button type="button" class="ghost wide" data-sc="quote">다시 조회</button>';
    if (sizes) {
      var keys = Object.keys(sizes).sort(function (a, b) { return (parseFloat(a) || 0) - (parseFloat(b) || 0) || a.localeCompare(b); });
      h += '<table class="sc-t"><thead><tr><th>사이즈</th><th>최저 판매가</th><th>즉시 판매</th><th>30일</th><th>예상 수익</th></tr></thead><tbody>' + keys.map(function (s) {
        var x = sizes[s], p = x.ask || x.d14 || 0, pf = p && cost ? p - feeOf(p) - ship - cost : null, mine = H.size && String(H.size) === String(s);
        return '<tr class="' + (mine ? 'on' : '') + '" data-sc="pick" data-v="' + esc(s) + '"><td><b>' + esc(s) + '</b></td><td>' + esc(x.ask ? won(x.ask) : '–') + '</td><td>' + esc(x.bid ? won(x.bid) : '–') + '</td><td>' + (x.n30 || 0) + '</td><td class="' + (pf == null ? '' : pf > 0 ? 'pos' : 'neg') + '">' + esc(pf == null ? '–' : wonS(pf)) + '</td></tr>';
      }).join('') + '</tbody></table><p class="note">예상 수익 = KREAM 최저 판매가 − 수수료 − 발송비 − 매입가 · ' + esc(K.ago(J.at)) + ' 조회</p>';
    }
    if (own.length) h += '<p class="note">내 매입 기록: ' + own.slice(0, 3).map(function (l) { return esc(l.date) + ' ' + esc(l.size) + ' ' + won(l.cost); }).join(' · ') + '</p>';
    // 매입 등록
    var szs = sizes ? Object.keys(sizes) : (it.sizes || []);
    h += '<div class="sc-buy"><b>매입 등록</b><div class="sc-calc"><label>사이즈<input list="scSizes" data-sc-k="size" value="' + esc(SC.size || H.size || '') + '" placeholder="예: 270"></label><datalist id="scSizes">' + szs.map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') + '</datalist><label>수량<input type="number" inputmode="numeric" min="1" data-sc-k="qty" value="' + (SC.qty || 1) + '"></label></div>' +
      '<select data-sc-k="pay"><option value="">결제 카드 (선택)</option>' + Object.keys(DOC.pay).map(function (k) { var p = DOC.pay[k]; return '<option value="' + esc(p._id) + '"' + (SC.payId === p._id ? ' selected' : '') + '>' + esc(p.name + (p.issuer ? ' (' + p.issuer + ')' : '') + (p.last4 ? ' ' + p.last4 : '')) + '</option>'; }).join('') + '</select>' +
      '<button type="button" class="primary wide" data-sc="buy">' + (cost ? won(cost) + ' × ' + (SC.qty || 1) + '개 매입 등록' : '매입가를 넣어 주세요') + '</button><button type="button" class="ghost wide" data-sc="short">공매도 — 사기 전에 KREAM 에 이 사이즈 판매 입찰 걸기</button><p class="note">반품 기한은 PC 가 매장 · 브랜드로 자동으로 잡아요 (나이키 · 조던 13일, 아디다스 15일, 그 밖 14일).</p></div>';
    return h + '</div>';
  }
  function scFind(q) {
    q = String(q || '').trim(); if (!q) return;
    SC.q = q; SC.job = null; SC.tag = ''; SC.cost = ''; SC.size = ''; SC.qty = 1; SC.msg = '';
    var b = /^\d{8,14}$/.test(q) ? findBarcode(q) : null;
    if (b) { SC.hit = { it: b.it, size: b.size, bc: q }; SC.newBc = ''; }
    else {
      var it = itemByCode(q);
      if (it) SC.hit = { it: it, size: '', bc: '' };
      else if (/^\d{8,14}$/.test(q)) { SC.hit = null; SC.newBc = q; SC.ocr = null; SC.msg = '공유 바코드에서 찾는 중이에요…'; K.render(); return bcShared(q); }
      else SC.hit = { it: { code: q.toUpperCase(), name: q.toUpperCase() }, size: '', bc: '' };
      if (SC.hit && SC.newBc) SC.hit.bc = SC.newBc;
    }
    K.render();
    if (SC.hit) scQuote();
  }
  // ---------- 공유 바코드 (서버 ks_bc_get / ks_bc_put · 킥스캔 사용자 모두가 같이 써요) ----------
  var NEW_BC_MSG = '처음 보는 바코드예요 — [태그 사진으로 품번 읽기]를 누르거나 품번을 넣어 찾아 주세요. 한 번 기억하면 다음부터(다른 킥스캔 사용자도) 바로 찾아요';
  // 공식 바코드 조각 파일(../bc/n/<3자리>.json — 나이키 공식몰 카탈로그에서 만든 것): { n: [상품명…], b: { 14자리: [품번, 사이즈, 이름 번호] } }
  var BCF = {};
  function bcStatic(k) {
    var s = k.slice(-4, -1);
    if (!BCF[s]) BCF[s] = fetch('../bc/n/' + s + '.json', { cache: 'force-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    return BCF[s].then(function (j) { var x = j && j.b && j.b[k]; return x ? { code: x[0], size: x[1], name: (j.n || [])[x[2]] || '', brand: '나이키', votes: 0, official: true } : null; });
  }
  function bcShared(q) {
    var k = bcKey(q);
    return bcStatic(k).then(function (hit) { return hit ? [hit] : rpc('ks_bc_get', { p_barcodes: [k] }); }).then(function (rows) {
      if (SC.newBc !== q) return;
      var r = rows && rows[0];
      if (!r || !r.code) { SC.msg = NEW_BC_MSG; return K.render(); }
      var it = itemByCode(r.code) || { code: r.code, name: r.name || r.code, brand: r.brand || '' };
      DOC.barcode['bc' + q] = { _id: 'bc' + q, barcode: q, code: r.code, name: r.name || '', size: r.size || '', shared: true };
      SC.hit = { it: it, size: r.size || '', bc: q, shared: r.official ? 0 : (+r.votes || 1), official: !!r.official }; SC.newBc = ''; SC.msg = ''; K.render(); scQuote();
    }).catch(function () { if (SC.newBc === q) { SC.msg = NEW_BC_MSG; K.render(); } });
  }
  function bcVote(bc, it, size, src) {
    if (!bc || !it || !it.code || !size) return;
    rpc('ks_bc_put', { p_rows: [{ barcode: bcKey(bc), code: String(it.code).split('/')[0], size: String(size), name: it.name || '', brand: it.brand || '', src: src || 'phone' }] }).catch(function () {});
  }
  function bcLearn(H, size, src) {
    var it = H.it, code = String(it.code || '').split('/')[0];
    if (!H.bc || !code || !size) return false;
    var d = { barcode: H.bc, code: code, name: it.name || '', size: String(size) };
    if (!findBarcode(H.bc) || (DOC.barcode['bc' + H.bc] || {}).shared || H.src === 'ocr') { DOC.barcode['bc' + H.bc] = Object.assign({ _id: 'bc' + H.bc }, d); send([{ kind: 'barcode', id: 'bc' + H.bc, data: d }]).catch(function () {}); }
    bcVote(H.bc, it, size, src || H.src); H.size = String(size); H.learned = true; SC.newBc = '';
    return true;
  }
  // ---------- 태그 글자 인식 (품번 · 사이즈) — 사진 한 장을 이 휴대폰 안에서 읽어요(사진은 어디에도 안 올려요) ----------
  var TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js', OCRW = null;
  function loadJs(src) { return new Promise(function (ok, no) { if (window.Tesseract) return ok(); var e = document.createElement('script'); e.src = src; e.onload = function () { ok(); }; e.onerror = function () { no(new Error('글자 인식 도구를 못 불러왔어요 — 인터넷을 확인해 주세요')); }; document.head.appendChild(e); }); }
  function imgCanvas(file) {
    return new Promise(function (ok, no) {
      var u = URL.createObjectURL(file), im = new Image();
      im.onload = function () { var W = Math.min(1800, im.naturalWidth || 1800), k = W / (im.naturalWidth || W), c = document.createElement('canvas'); c.width = W; c.height = Math.round((im.naturalHeight || W) * k); var x = c.getContext('2d'); x.filter = 'grayscale(1) contrast(1.5)'; x.drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(u); ok(c); };
      im.onerror = function () { URL.revokeObjectURL(u); no(new Error('사진을 못 열었어요')); };
      im.src = u;
    });
  }
  function ocrWorker() {
    if (!OCRW) {
      OCRW = loadJs(TESS_URL).then(function () { return window.Tesseract.createWorker('eng'); })
        .then(function (w) { return w.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-./: ' }).then(function () { return w; }); });
      OCRW.catch(function () { OCRW = null; });
    }
    return OCRW;
  }
  // 태그 글자 → 품번 후보 · 한국 사이즈(mm). 나이키 DD1391-100 · 옛 314192-117 · 아디다스 ART IF1234 · 뉴발란스 U9060GRY
  function tagParse(txt) {
    var T = String(txt || '').toUpperCase().replace(/[|]/g, 'I'), C = [], m, re;
    function add(c, w) { c = String(c).replace(/\s+/g, ''); if (c.length < 5) return; for (var i = 0; i < C.length; i++) if (C[i].c === c) { C[i].w += w; return; } C.push({ c: c, w: w }); }
    re = /\b([A-Z]{2}\d{4})\s*[-–]\s*(\d{3})\b/g; while ((m = re.exec(T))) add(m[1] + '-' + m[2], 10);
    // 띄어쓰기만 있으면: 뒤 숫자가 사이즈 꼴(220~320)이면 아디다스 품번 + 사이즈일 수 있어 둘 다 후보로
    re = /\b([A-Z]{2}\d{4})\s+(\d{3})\b/g; while ((m = re.exec(T))) { if (/^(2[2-9][05]|3[0-2][05])$/.test(m[2])) { add(m[1], 5); add(m[1] + '-' + m[2], 4); } else add(m[1] + '-' + m[2], 8); }
    re = /\b(\d{6})\s*[-–]\s*(\d{3})\b/g; while ((m = re.exec(T))) add(m[1] + '-' + m[2], 6);
    re = /ART\.?\s*(?:NO\.?)?\s*[:#]?\s*([A-Z]{1,2}\d{4,5})\b/g; while ((m = re.exec(T))) add(m[1], 10);
    re = /\b([A-Z]{2}\d{4})\b(?!\s*[-–]?\s*\d{3}\b)/g; while ((m = re.exec(T))) add(m[1], 3);
    re = /\b([MUW][A-Z]{0,2}\d{3,4}[A-Z]{2,4}\d?)\b/g; while ((m = re.exec(T))) add(m[1], 4);
    for (var i = 0; i < C.length; i++) if (itemByCode(C[i].c)) C[i].w += 20;
    C.sort(function (a, b) { return b.w - a.w; });
    var size = '', s;
    re = /(?:KR|KOR|MM)\s*[:.]?\s*(2[2-9]\d|3[0-2]\d)\b/; if ((s = re.exec(T))) size = s[1];
    if (!size) { re = /\bCM\s*[:.]?\s*(2[2-9]|3[0-2])(?:[.,](5))?\b/; if ((s = re.exec(T))) size = String(+s[1] * 10 + (s[2] ? 5 : 0)); }
    if (!size) { re = /\b(2[2-9][05]|3[0-2][05])\b/g; var all = []; while ((s = re.exec(T))) if (all.indexOf(s[1]) < 0) all.push(s[1]); if (all.length === 1) size = all[0]; }
    return { codes: C.slice(0, 5).map(function (x) { return x.c; }), size: size };
  }
  K.tagParse = tagParse;
  // 카메라로 8초 넘게 바코드를 못 읽으면 화면 한 장의 글자(품번)를 읽어 봐요 — 찾으면 카메라를 끄고 후보를 보여 줘요 (줍픽 «8초 넘으면 택 글자 인식»)
  function camOcr(v) {
    var c = document.createElement('canvas'), w = v.videoWidth, h = v.videoHeight; if (!w || !h) return;
    var k = Math.min(1, 1600 / w); c.width = Math.round(w * k); c.height = Math.round(h * k);
    var x = c.getContext('2d'); x.filter = 'grayscale(1) contrast(1.5)'; x.drawImage(v, 0, 0, c.width, c.height);
    SC.camOcrBusy = true;
    ocrWorker().then(function (wk) { return wk.recognize(c); }).then(function (r) {
      SC.camOcrBusy = false; if (!SC.cam) return;
      var P = tagParse((r && r.data && r.data.text) || ''); if (!P.codes.length) return;
      camStop(); SC.hit = null; SC.newBc = ''; SC.ocr = { codes: P.codes, size: P.size, cam: true }; SC.msg = '바코드를 못 읽어서 화면의 태그 글자를 읽었어요 — 맞는 품번을 눌러 주세요'; K.render();
    }).catch(function () { SC.camOcrBusy = false; });
  }
  function ocrRun(file) {
    SC.ocr = { busy: true }; SC.msg = ''; K.render();
    var t0 = Date.now();
    (file && file.getContext ? Promise.resolve(file) : imgCanvas(file)).then(function (c) { return ocrWorker().then(function (w) { return w.recognize(c); }); }).then(function (r) {
      var txt = (r && r.data && r.data.text) || '', P = tagParse(txt);
      SC.ocr = { codes: P.codes, size: P.size, ms: Date.now() - t0 };
      if (!P.codes.length) SC.ocr.err = '품번을 못 찾았어요 — 태그의 품번 · 사이즈 부분을 가까이, 흔들리지 않게 찍어 주세요';
      K.render();
    }).catch(function (e) { SC.ocr = { err: (e && e.message) || '글자를 못 읽었어요' }; K.render(); });
  }
  K.ocrRun = ocrRun;
  function vOcr() {
    var O = SC.ocr, h = '<div class="sc-bar"><button type="button" class="' + (SC.newBc ? 'primary' : 'ghost') + ' wide" data-sc="ocr"' + (O && O.busy ? ' disabled' : '') + '>' + (O && O.busy ? '태그 글자 읽는 중…' : '태그 사진으로 품번 읽기') + '</button><input type="file" id="scTagFile" accept="image/*" capture="environment" hidden></div>';
    if (O && O.busy) h += '<p class="note">처음 한 번은 글자 인식 도구를 받느라 조금 걸려요</p>';
    if (O && O.err) h += '<p class="banner">' + esc(O.err) + '</p>';
    if (O && O.codes && O.codes.length) h += '<div class="box"><b>태그에서 읽은 품번</b> <span class="sub">눌러서 고르세요' + (O.size ? ' · 사이즈 ' + esc(O.size) : '') + '</span><div class="sc-chips">' +
      O.codes.map(function (c) { var it = itemByCode(c); return '<button type="button" class="chip' + (it ? ' on' : '') + '" data-sc="ocrPick" data-v="' + esc(c) + '">' + esc(c) + (it ? ' · 내 상품' : '') + '</button>'; }).join('') + '</div></div>';
    return h;
  }
  function scQuote() {
    var it = SC.hit.it, code = String(it.code || '').split('/')[0]; if (!code) return;
    // 같은 품번을 6시간 안에 조회한 결과가 있으면 다시 쓰기
    var best = null; for (var id in DOC.job) { var j = DOC.job[id]; if (ckey(j.code) === ckey(code) && j.status === 'done' && Date.now() - (j.at || 0) < 6 * 3600e3 && (!best || j.at > best.at)) best = j; }
    if (best) { SC.job = best; K.render(); return; }
    var id = 'q' + uid(); SC.job = { _id: id, code: code, status: 'wait', at: Date.now() };
    send([{ kind: 'job', id: id, data: { type: 'quote', code: code, name: it.name || '', status: 'wait', at: Date.now() } }]).catch(function () { SC.msg = '인터넷이 끊겨 있어요 — 연결되면 조회 요청을 보내요'; });
    SC.jobT = Date.now(); K.render(); poll();
  }
  var pollT = null;
  function poll() {
    clearTimeout(pollT);
    if (!SC.job || SC.job.status !== 'wait' || Date.now() - SC.jobT > 10 * 60e3) return;
    pollT = setTimeout(function () {
      rpc('ks_doc_get', { p_since: null, p_kinds: ['job'], p_limit: 50 }).then(function (rows) {
        (rows || []).forEach(function (r) { if (!r.deleted) DOC.job[r.id] = Object.assign({}, r.data || {}, { _id: r.id }); });
        var j = DOC.job[SC.job._id]; if (j && j.status !== 'wait') { SC.job = j; if (UI.tab === 'scan') K.render(); return; }
        poll();
      }).catch(poll);
    }, 3000);
  }
  function scBuy() {
    var H = SC.hit, it = H.it, D = day(), disc = D ? +D.disc || 0 : 0, tag = +SC.tag || 0;
    var cost = SC.cost !== '' ? +SC.cost : tag ? Math.round(tag * (1 - disc / 100) / 10) * 10 : 0, size = String(SC.size || H.size || '').trim(), qty = Math.max(1, +SC.qty || 1);
    if (!size) { SC.msg = '사이즈를 골라 주세요'; return K.render(); }
    if (!(cost > 0)) { SC.msg = '매입가(또는 태그가)를 넣어 주세요'; return K.render(); }
    var id = 'b' + uid(), docs = [{ kind: 'phone_buy', id: id, data: { code: String(it.code || '').split('/')[0], name: it.name || '', brand: it.brand || '', size: size, qty: qty, cost: cost, tag: tag || null, disc: disc, date: today(), store: D ? D.store : '', storeId: D ? D.storeId : '', payId: SC.payId || '', barcode: H.bc || '', at: Date.now() } }];
    if (H.bc && !findBarcode(H.bc)) docs.push({ kind: 'barcode', id: 'bc' + H.bc, data: { barcode: H.bc, code: String(it.code || '').split('/')[0], name: it.name || '', size: size } });
    if (H.bc) bcVote(H.bc, it, size, H.src || 'phone');
    send(docs).then(function () { SC.msg = '매입을 등록했어요 — PC 재고에 1분 안에 들어가요 (' + size + ' × ' + qty + ' · ' + won(cost) + ')'; })
      .catch(function () { SC.msg = '인터넷이 끊겨 이 휴대폰에 모아 뒀어요 — 연결되면 바로 올려요'; })
      .then(function () { DOC.phone_buy[id] = Object.assign({}, docs[0].data, { _id: id }); SC.hit = null; SC.q = ''; SC.newBc = ''; SC.ocr = null; K.render(); });
  }
  // 카메라 바코드 (안드로이드 크롬 등 BarcodeDetector 가 있는 브라우저)
  // 아이폰 사파리 등 BarcodeDetector 가 없는 브라우저: ZXing(공개 바코드 인식기)으로 같은 꼴의 detect(video) 를 만들어요
  var ZX_URL = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js', ZXD = null;
  function zxDetector() {
    if (ZXD) return ZXD;
    ZXD = new Promise(function (ok, no) {
      if (window.ZXing) return ok();
      var e = document.createElement('script'); e.src = ZX_URL; e.onload = function () { ok(); }; e.onerror = function () { no(new Error('바코드 인식기를 못 불러왔어요 — 인터넷을 확인해 주세요')); }; document.head.appendChild(e);
    }).then(function () {
      var Z = window.ZXing, hints = new Map(), rd = new Z.MultiFormatReader();
      hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_E, Z.BarcodeFormat.CODE_128]);
      hints.set(Z.DecodeHintType.TRY_HARDER, true); rd.setHints(hints);
      var cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
      return { detect: function (v) {
        return new Promise(function (ok) {
          var w = v.videoWidth || v.width, h = v.videoHeight || v.height; if (!w || !h) return ok([]);
          var k = Math.min(1, 1280 / w); cv.width = Math.round(w * k); cv.height = Math.round(h * k); cx.drawImage(v, 0, 0, cv.width, cv.height);
          var px = cx.getImageData(0, 0, cv.width, cv.height).data, lum = new Uint8ClampedArray(cv.width * cv.height);
          for (var i = 0, j = 0; j < lum.length; i += 4, j++) lum[j] = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
          try { var r = rd.decodeWithState(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.RGBLuminanceSource(lum, cv.width, cv.height)))); ok([{ rawValue: r.getText() }]); } catch (e) { ok([]); }
        });
      } };
    });
    ZXD.catch(function () { ZXD = null; });
    return ZXD;
  }
  K.zxDetector = zxDetector;
  function camDetector() {
    if ('BarcodeDetector' in window) { try { return Promise.resolve(new window.BarcodeDetector({ formats: ['ean_13', 'upc_a', 'code_128', 'ean_8', 'upc_e'] })); } catch (e) { try { return Promise.resolve(new window.BarcodeDetector()); } catch (x) {} } }
    return zxDetector();
  }
  function camStart() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { SC.cam = false; SC.msg = '이 브라우저는 카메라를 쓸 수 없어요 — 바코드 숫자나 품번을 아래 칸에 넣어 주세요'; return K.render(); }
    var det = null;
    camDetector().then(function (d) { det = d; return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } }); }, function (e) { throw Object.assign(e, { noDet: true }); }).then(function (s) {
      SC.stream = s; var v = $('#scVideo'); if (!v) return camStop(); v.srcObject = s; v.play();
      var t0 = Date.now(), tries = 0;
      var tick = function () {
        if (!SC.cam || !SC.stream) return;
        if (!SC.camOcrBusy && tries < 3 && Date.now() - t0 > 8000 * (tries + 1)) { tries++; camOcr(v); }
        det.detect(v).then(function (L) { if (L && L.length) { var c = L[0].rawValue; try { navigator.vibrate && navigator.vibrate(60); } catch (e) {} camStop(); scFind(c); } else setTimeout(tick, 250); }).catch(function () { setTimeout(tick, 400); });
      };
      tick();
    }).catch(function (e) { SC.cam = false; SC.msg = e && e.noDet ? e.message + ' — 바코드 숫자나 품번을 아래 칸에 넣어 주세요' : '카메라를 쓸 수 없어요 — 브라우저 설정에서 카메라 권한을 허용해 주세요'; K.render(); });
  }
  function camStop() { SC.cam = false; if (SC.stream) { SC.stream.getTracks().forEach(function (t) { t.stop(); }); SC.stream = null; } }

  // ---------- 재고 (서버 입고 기준: D-day · 지금 여기 · 보유 · 오늘 매입 합계) ----------
  function vStock2() {
    if (DOC_OK !== true || !Object.keys(DOC.lot).length) return K.VIEWS._stockOld ? K.VIEWS._stockOld() : '<div class="empty"><b>재고가 아직 안 올라왔어요</b>PC 킥스캔 판매처 연동 › 서버 동기화 [서버로 옮기기]를 한 번 눌러 주세요.</div>';
    var D = day(), lots = Object.keys(DOC.lot).map(function (k) { return DOC.lot[k]; }), t = today();
    var todayBuy = lots.filter(function (l) { return l.date === t; }).reduce(function (s, l) { return s + (+l.cost || 0) * (+l.qty || 0); }, 0)
      + Object.keys(DOC.phone_buy).map(function (k) { return DOC.phone_buy[k]; }).filter(function (b) { return !b.done && b.date === t; }).reduce(function (s, b) { return s + (+b.cost || 0) * (+b.qty || 0); }, 0);
    var L = lots.filter(function (l) { return +l.left > 0; });
    if (ST.f === 'here' && D) L = L.filter(function (l) { return l.partnerId === D.storeId; });
    var q = ST.q.trim().toLowerCase();
    var by = {}; L.forEach(function (l) { var it = DOC.item[l.itemId] || {}; if (q && (it.name + ' ' + it.code + ' ' + l.size).toLowerCase().indexOf(q) < 0) return; var g = by[l.itemId] = by[l.itemId] || { it: it, q: 0, v: 0, due: null, s: {} }; g.q += +l.left; g.v += (+l.left) * (+l.cost || 0); g.s[l.size] = (g.s[l.size] || 0) + (+l.left); var d = dday(l.returnDue); if (d != null && d >= 0 && (g.due == null || d < g.due)) g.due = d; });
    var G = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return (a.due == null ? 999 : a.due) - (b.due == null ? 999 : b.due); });
    var h = '<div class="seg" role="group"><button type="button" data-st="all" aria-pressed="' + (ST.f === 'all') + '">보유</button><button type="button" data-st="here" aria-pressed="' + (ST.f === 'here') + '"' + (D ? '' : ' disabled') + '>지금 여기' + (D ? ' (' + esc(D.store) + ')' : '') + '</button></div>';
    h += '<div class="filters"><input type="search" class="q" data-st-k="q" placeholder="상품명 · 품번 · 사이즈" value="' + esc(ST.q) + '"></div>';
    h += '<div class="tot"><span><b>' + G.length + '</b>종 · <b>' + G.reduce(function (s, g) { return s + g.q; }, 0) + '</b>개</span><span>오늘 매입 <b>' + esc(won(todayBuy)) + '</b></span></div>';
    return h + '<div class="list">' + (G.map(function (g) { return '<div class="it"><div class="h"><span>' + esc(g.it.code || '') + '</span>' + (g.due != null ? '<span class="pill ' + (g.due <= 3 ? 'bad' : 'warn') + '">반품 D-' + g.due + '</span>' : '') + '</div><div class="n">' + esc(g.it.name || g.it.code || '') + '</div><div class="f"><span class="sub">평균 매입 ' + esc(won(g.q ? g.v / g.q : 0)) + '</span><span><b>' + g.q + '개</b></span></div><div class="sizes">' + Object.keys(g.s).map(function (s) { return '<span>' + esc(s) + ' <b>×' + g.s[s] + '</b></span>'; }).join('') + '</div></div>'; }).join('') || '<div class="empty">조건에 맞는 재고가 없어요</div>') + '</div>';
  }
  // ---------- 설정 ----------
  function vSet() {
    var D = day(), ob = outbox().length;
    return '<div class="box"><dl class="kv"><dt>계정</dt><dd>' + esc(K.email()) + '</dd><dt>오늘 매장</dt><dd>' + (D ? esc(D.store) + ' · 할인 ' + (+D.disc || 0) + '%' : '안 고름') + '</dd><dt>PC 킥스캔</dt><dd>' + (pcOn() ? '켜져 있어요' : pcDoc() && pcDoc().at ? K.ago(pcDoc().at) + ' 마지막 신호' : '아직 신호 없음') + '</dd><dt>서버</dt><dd>' + (DOC_OK === true ? '연결됨' : esc(DOC_ERR || '확인 중')) + '</dd>' + (ob ? '<dt>올리기 대기</dt><dd>' + ob + '건 (연결되면 올려요)</dd>' : '') + '</dl></div>' +
      '<div class="box"><button type="button" class="ghost wide" data-sc="run">PC 에서 상품 소싱 실행</button>' + (SC.runMsg ? '<p class="note">' + esc(SC.runMsg) + '</p>' : '') + '<button type="button" class="ghost wide" data-sc="dayEdit2">오늘 매장 · 할인율 바꾸기</button><button type="button" class="ghost wide" data-sc="mkt">시세 · 찾기 보기 (PC 요약)</button></div>' +
      '<div class="box"><p class="note"><b>앱처럼 쓰기</b> — 안드로이드 크롬: 메뉴 › 홈 화면에 추가 · 아이폰 사파리: 공유 › 홈 화면에 추가. 카메라 바코드 인식은 안드로이드 크롬에서 돼요(아이폰은 바코드 숫자를 입력해요).</p><p class="note">알림(반품 기한 · 수익 알림)은 지금은 PC 킥스캔 알림 종으로 와요 — 폰 푸시 알림은 준비 중이에요.</p></div>';
  }
  K.VIEWS._stockOld = K.vStockOld;
  K.VIEWS.scan = vScan;
  K.VIEWS.stock = vStock2;
  K.VIEWS.set = vSet;
  K.VIEWS.mkt = function () { return K.vMkt(); };
  K.VIEWS.scan.after = function () { if (SC.cam && !SC.stream) camStart(); };
  // 홈 위에 반품 기한 임박 (전날 · 당일)
  var sum0 = null;
  K.onLoad = function () { docsLoad().then(function () { return flush(); }).then(function () { if (['scan', 'stock', 'set', 'sum'].indexOf(UI.tab) >= 0) K.render(); }); };
  K.VIEWS.sum = function () {
    var h = K.vSum(), due = [];
    if (DOC_OK === true) for (var id in DOC.lot) { var l = DOC.lot[id], d = dday(l.returnDue); if (+l.left > 0 && d != null && d >= 0 && d <= 1) due.push(l); }
    var sh = Object.keys(DOC.short).map(function (k) { return DOC.short[k]; }).filter(function (x) { return x.status === '매입 필요'; });
    var shH = sh.length ? '<div class="box"><b>매입할 공매도 ' + sh.length + '개</b>' + sh.slice(0, 6).map(function (x) { return '<div class="sc-row"><span>' + esc(x.name || x.code) + ' · ' + esc(x.size) + '</span><span class="sub">' + esc(x.from || '') + (x.cost ? ' ' + won(x.cost) : '') + '</span><button type="button" class="linkbtn" data-sc="shortBuy" data-v="' + esc(x.code) + '" data-sz="' + esc(x.size) + '">매입 등록 ›</button></div>'; }).join('') + '</div>' : '';
    return shH + (due.length ? '<p class="banner">반품 기한 ' + (due.some(function (l) { return dday(l.returnDue) === 0; }) ? '오늘' : '내일') + ' 마감 ' + due.length + '건 — 재고 탭에서 확인하세요</p>' : '') + h;
  };

  // ---------- 이벤트 ----------
  document.getElementById('view').addEventListener('click', function (e) {
    var b = e.target.closest('[data-sc]'); var s = e.target.closest('[data-st]');
    if (s) { ST.f = s.dataset.st; return K.render(); }
    if (!b) return; var a = b.dataset.sc;
    if (a === 'dayEdit' || a === 'dayEdit2') { SC.dayEdit = true; UI.tab = 'scan'; return K.render(); }
    if (a === 'daySave') {
      var sel = document.querySelector('[data-sc-k=store]'), nw = document.querySelector('[data-sc-k=storeNew]'), disc = +(document.querySelector('[data-sc-k=disc]') || {}).value || 0;
      var sid = sel ? sel.value : '', name = sid === '_new' ? (nw ? nw.value.trim() : '') : sid && DOC.partner[sid] ? DOC.partner[sid].name : '';
      if (!name) { SC.msg = '매장을 골라 주세요'; return K.render(); }
      var d = { date: today(), store: name, storeId: sid === '_new' ? '' : sid, disc: disc }; LS.set('day', JSON.stringify(d)); SC.dayEdit = false; SC.msg = '';
      send([{ kind: 'store_day', id: today(), data: d }]).catch(function () {});
      return K.render();
    }
    if (a === 'cam') { if (SC.cam) camStop(); else SC.cam = true; return K.render(); }
    if (a === 'find') return scFind((document.querySelector('[data-sc-k=q]') || {}).value);
    if (a === 'quote') { SC.job = null; return scQuote(); }
    if (a === 'pick') { SC.size = b.dataset.v; return K.render(); }
    if (a === 'ocr') { var tf = document.getElementById('scTagFile'); if (tf) { tf.value = ''; tf.click(); } return; }
    if (a === 'ocrPick') { var O = SC.ocr || {}, bc0 = SC.newBc; scFind(b.dataset.v); if (SC.hit) { SC.hit.src = 'ocr'; if (bc0) SC.hit.bc = bc0; if (O.size) SC.size = O.size; } SC.ocr = null; return K.render(); }
    if (a === 'learn') { var HL = SC.hit, lz2 = String(SC.size || (HL && HL.size) || ''); if (HL && bcLearn(HL, lz2)) SC.msg = '기억했어요 — 다음부터 바코드 ' + HL.bc + ' 를 찍으면 바로 ' + String(HL.it.code || '').split('/')[0] + ' · ' + lz2 + ' 로 찾아요'; return K.render(); }
    if (a === 'buy') return scBuy();
    if (a === 'mkt') { UI.tab = 'mkt'; return K.render(); }
    if (a === 'shortBuy') { UI.tab = 'scan'; K.render(); scFind(b.dataset.v); SC.size = b.dataset.sz; return K.render(); }
    if (a === 'short') {
      var H = SC.hit, J = SC.job, size = String(SC.size || (H && H.size) || '').trim();
      var ask = J && J.sizes && J.sizes[size] ? J.sizes[size].ask : null;
      var price = +prompt('공매도 판매가 (원) — ' + size + ' KREAM 최저 판매가 ' + (ask ? won(ask) : '모름'), ask || '');
      if (!size || !(price >= 1000)) { SC.msg = '사이즈와 판매가를 넣어 주세요'; return K.render(); }
      var D = day(), tag = +SC.tag || 0, cost = SC.cost !== '' ? +SC.cost : tag ? Math.round(tag * (1 - ((D && +D.disc) || 0) / 100) / 10) * 10 : 0;
      var id = 's' + uid();
      send([{ kind: 'job', id: id, data: { type: 'short', code: String(H.it.code || '').split('/')[0], name: H.it.name || '', size: size, price: price, cost: cost, from: D ? D.store : '', status: 'wait', at: Date.now() } }])
        .then(function () { SC.msg = '공매도를 PC 에 보냈어요 — PC 킥스캔이 KREAM 에 ' + size + ' ' + won(price) + ' 입찰을 걸어요(자동 입찰 방식대로)'; }).catch(function () { SC.msg = '인터넷이 끊겨 모아 뒀어요 — 연결되면 보내요'; }).then(function () { K.render(); });
      return;
    }
    if (a === 'run') {
      var rid = 'r' + uid(); SC.runMsg = pcOn() ? 'PC 에 소싱 실행을 보냈어요 — 결과는 PC 소싱 화면 · 폰 홈 요약에 나와요' : 'PC 의 킥스캔이 꺼져 있어요 — 켜지면 실행해요';
      send([{ kind: 'job', id: rid, data: { type: 'run', kind: 'product', status: 'wait', at: Date.now() } }]).catch(function () { SC.runMsg = '인터넷이 끊겨 모아 뒀어요'; }).then(function () { K.render(); });
      return;
    }
  });
  document.getElementById('view').addEventListener('change', function (e) {
    if (e.target.id === 'scTagFile') { var f = e.target.files && e.target.files[0]; if (f) ocrRun(f); return; }
    var k = e.target.dataset.scK;
    if (k === 'store') { var nw = document.querySelector('[data-sc-k=storeNew]'); if (nw) nw.hidden = e.target.value !== '_new'; var p = DOC.partner[e.target.value], dc = document.querySelector('[data-sc-k=disc]'); if (p && p.lastDisc != null && dc && !dc.value) dc.value = p.lastDisc; }
    if (k === 'pay') SC.payId = e.target.value;
    if (k === 'tag' || k === 'cost' || k === 'size' || k === 'qty') { SC[k] = e.target.value; if (k === 'tag') SC.cost = ''; K.render(); }
  });
  document.getElementById('view').addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.dataset.scK === 'q') { e.preventDefault(); scFind(e.target.value); } });
  var stT = null;
  document.getElementById('view').addEventListener('input', function (e) { if (e.target.dataset.stK === 'q') { ST.q = e.target.value; clearTimeout(stT); stT = setTimeout(function () { K.render(); var n = document.querySelector('[data-st-k=q]'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 250); } });
  window.addEventListener('online', function () { flush(); });
  setInterval(function () { if (DOC_OK) docsLoad().then(function () { if (UI.tab === 'stock' || UI.tab === 'set') K.render(); }); }, 60000);
})();
