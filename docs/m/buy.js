/* 킥스캔 현장 앱 — 오늘 살 것 (11/25 · 자동화: 결제만 사장님)
   - PC 킥스캔이 소싱 결과에서 고른 '오늘 살 것'(서버 문서 ks_doc job 'tbuy')을 보여 줘요 — [구매 ↗]로 쇼핑몰을 열어 결제만
   - [샀어요] · [안 살래요] → ks_doc job 'tbact-…'(by phone) → 켜져 있는 PC 가 1분 안에 받아 목록에서 빼요
   - 새 상품 알림은 발매 탭과 같은 폰 알림(웹 푸시) — 여기서 켜도 돼요 */
(function () {
  'use strict';
  if (!window.KSM) return;
  var K = window.KSM, esc = K.esc, UI = K.UI;
  var TB = { at: 0, d: null, none: false, err: '', busy: false, gone: {}, msg: '' };
  var w = function (n) { return n == null || isNaN(n) ? '–' : K.won(Math.round(n)); };

  function load(force) {
    if (TB.busy || (!force && TB.at && Date.now() - TB.at < 60e3)) return;
    TB.busy = true;
    K.token().then(function (tok) {
      if (!tok) throw new Error('먼저 킥스캔 계정으로 로그인해 주세요');
      return K.call('GET', '/rest/v1/ks_doc?select=data&kind=eq.job&id=eq.tbuy', null, tok);
    }).then(function (r) {
      if (!r.ok) throw new Error('목록을 못 받았어요 (' + r.status + ')');
      var d = r.j && r.j[0] && r.j[0].data;
      TB.none = !d; TB.d = d || { items: [] }; TB.at = Date.now(); TB.err = ''; TB.gone = {};
    }).catch(function (e) { TB.err = String((e && e.message) || e); })
      .then(function () { TB.busy = false; if (UI.tab === 'buy') K.render(); });
  }
  function card(x) {
    var sizes = (x.sizes || []).map(function (s) { return esc(s.size) + ' ×' + s.q + (s.url ? ' <a href="' + esc(s.url) + '" target="_blank" rel="noopener">↗</a>' : ''); }).join(' · ');
    return '<div class="box drp-card' + (x.over ? ' tbm-over' : '') + '"><div class="drp-top">' + (x.img ? '<img src="' + esc(x.img) + '" alt="" loading="lazy">' : '<span></span>') + '<div><span class="drp-brand">' + esc(x.brand || '') + '</span><b>' + esc(x.name || x.code) + '</b><span class="sub">' + esc(x.code || '') + '</span></div></div>'
      + '<dl class="kv"><dt>매입처</dt><dd>' + esc(x.site || '–') + ' · ' + w(x.unit) + '</dd><dt>살 사이즈</dt><dd>' + sizes + '</dd><dt>매입 금액</dt><dd>' + w(x.cost) + '</dd><dt>예상 수익</dt><dd><b class="tbm-pf">' + w(x.profit) + '</b> <span class="sub">개당 ' + w(x.avg) + '</span></dd></dl>'
      + '<div class="tbm-btns"><button type="button" class="ghost" data-tbm="skip" data-ck="' + esc(x.ck) + '">안 살래요</button><button type="button" class="ghost" data-tbm="done" data-ck="' + esc(x.ck) + '">샀어요</button>'
      + (x.url ? '<a class="primary" href="' + esc(x.url) + '" target="_blank" rel="noopener">구매 ↗</a>' : '') + '</div></div>';
  }
  K.VIEWS.buy = function () {
    load(false);
    var d = TB.d, L = d ? (d.items || []).filter(function (x) { return !TB.gone[x.ck]; }) : null;
    var pick = L ? L.filter(function (x) { return !x.over; }) : [], over = L ? L.filter(function (x) { return x.over; }) : [];
    var sc = 0, sp = 0; pick.forEach(function (x) { sc += +x.cost || 0; sp += +x.profit || 0; });
    var box = K.pushBox ? K.pushBox('수익 상품 알림', '오늘 살 것에 새 상품이 생기면 이 폰으로 알려요') : '';
    var bar = '<div class="sc-row drp-bar"><span class="sub">' + (d && d.at ? 'PC 계산 ' + K.ago(d.at) : '') + '</span><button type="button" class="linkbtn" data-tbm="reload"' + (TB.busy ? ' disabled' : '') + '>' + (TB.busy ? '받는 중…' : '새로 받기') + '</button></div>';
    var sum = pick.length ? '<div class="box tbm-sum"><div><b>' + pick.length + '개</b> · 매입 ' + w(sc) + ' · <b class="tbm-pf">예상 수익 ' + w(sp) + '</b></div><span class="sub">' + (d.budget ? '하루 예산 ' + w(d.budget) + ' · 오늘 산 것 ' + w(d.spent) : '예산 제한 없음') + '</span></div>' : '';
    var body;
    if (TB.err && !d) body = '<div class="empty">' + esc(TB.err) + '</div>';
    else if (!d) body = '<div class="empty">받는 중이에요…</div>';
    else if (TB.none) body = '<div class="empty">아직 목록이 없어요<br><span class="sub">PC 킥스캔을 최신 버전으로 켜 두면 소싱 결과에서 살 만한 상품을 골라 여기에 올려요</span></div>';
    else if (!pick.length && !over.length) body = '<div class="empty">지금 살 만한 수익 상품이 없어요<br><span class="sub">PC 킥스캔이 소싱으로 찾는 대로 여기에 채워지고 알려 드려요</span></div>';
    else body = pick.map(card).join('') + (over.length ? '<p class="note">' + (pick.length ? '' : '오늘 예산 안에 드는 상품이 없어요 · ') + '예산 넘는 상품 ' + over.length + '개</p>' + over.map(card).join('') : '');
    return box + (TB.msg ? '<p class="note">' + esc(TB.msg) + '</p>' : '') + bar + sum + body;
  };
  function act(ck, a) {
    var x = ((TB.d && TB.d.items) || []).filter(function (y) { return y.ck === ck; })[0];
    TB.gone[ck] = 1; TB.msg = a === 'done' ? '샀어요로 옮겼어요 — 켜져 있는 PC 가 1분 안에 받아요' : '7일 동안 안 보여요';
    K.render();
    K.token().then(function (tok) {
      return K.call('POST', '/rest/v1/rpc/ks_doc_put', { p_docs: [{ kind: 'job', id: 'tbact-' + ck + '-' + Date.now().toString(36), data: { type: 'tbact', ck: ck, code: x ? x.code : '', act: a, name: x ? x.name : '', cost: x ? x.cost : 0, q: x ? x.q : 0, at: Date.now() }, by: 'phone', at: new Date().toISOString() }] }, tok);
    }).then(function (r) { if (!r.ok) throw new Error(String(r.status)); })
      .catch(function () { delete TB.gone[ck]; TB.msg = '서버에 못 보냈어요 — 인터넷을 확인하고 다시 눌러 주세요'; K.render(); });
  }
  document.getElementById('view').addEventListener('click', function (e) {
    var b = e.target.closest('[data-tbm]'); if (!b) return;
    var a = b.dataset.tbm;
    if (a === 'reload') { TB.msg = ''; load(true); K.render(); }
    else if (a === 'done' || a === 'skip') act(b.dataset.ck, a);
  });
})();
