// 킥스캔 공개 페이지 공통: shop.json(판매자 공개 설정)을 읽어서
//  - [data-biz="name"] 같은 빈칸을 채우고(값이 없으면 [상호]처럼 노란 표시로 남겨요)
//  - 아래쪽 <footer class="biz"> 에 사업자 정보와 약관 링크를 넣어요 (빈 칸은 안 보여요)
// 페이지 위치에 상관없이 사이트 맨 위의 shop.json 을 찾아요 (/kream-scanner/shop.json)
window.KS_SITE = (function () {
  var root = (document.currentScript && document.currentScript.src || location.href).replace(/site\.js(\?.*)?$/, '');
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var https = function (u) { return /^https:\/\/\S+$/i.test(String(u || '').trim()) ? String(u).trim() : ''; };
  var ready = fetch(root + 'shop.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }).then(function (j) { return j && typeof j === 'object' ? j : {}; });
  ready.then(function (S) {
    var B = S.biz || {};
    document.querySelectorAll('[data-biz]').forEach(function (el) { var v = String(B[el.dataset.biz] || '').trim(); if (v) { el.textContent = v; el.classList.remove('blank'); } });
    document.querySelectorAll('[data-shop]').forEach(function (el) { var u = https(S[el.dataset.shop]); if (u && el.tagName === 'A') el.href = u; if (!u && el.dataset.hideEmpty !== undefined) el.hidden = true; });
    var f = document.querySelector('footer.biz'); if (!f) return;
    var rows = [['상호', B.name], ['대표', B.ceo], ['사업자등록번호', B.regNo], ['통신판매업 신고', B.mailOrderNo], ['주소', B.addr], ['전화', B.tel], ['이메일', B.email]].filter(function (x) { return String(x[1] || '').trim(); });
    var links = [['terms', '이용약관'], ['privacy', '개인정보처리방침'], ['refund', '환불 규정']].map(function (x) { return [https(S[x[0]]) || (root + x[0] + '/'), x[1]]; });
    var k = https(S.kakao);
    f.innerHTML = (rows.length ? '<p>' + rows.map(function (x) { return '<span>' + x[0] + ' ' + esc(x[1]) + '</span>'; }).join('') + '</p>' : '') +
      '<p>' + links.map(function (x) { return '<a href="' + esc(x[0]) + '">' + x[1] + '</a>'; }).join('') + (k ? '<a href="' + esc(k) + '">카카오 문의</a>' : '') + '</p>';
  });
  return { ready: ready, root: root };
})();
