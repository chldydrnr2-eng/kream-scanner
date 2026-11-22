/* 킥스캔 — 영수증 읽기 (폰 재고 탭 [영수증 등록] · PC 매입 등록 공통 — 원본 kickscan-source/kream-app/app/receipt.js, 고치면 둘 다)
   글자 인식 결과(낱말마다 [글자, x, y, 너비, 높이])를 줄로 다시 묶고 → 품번 · 사이즈 · 수량 · 금액 · 할인 · 날짜 · 지점 · 카드를 뽑아요.
   - 줄 묶기: 영수증이 조금 기울어도 되게 기울기를 재서 바로 세운 뒤 높이로 묶어요
   - 상품 한 개 = 품번이 나온 줄부터 다음 품번(또는 합계 줄) 앞까지. 그 안의 마이너스 금액 = 그 상품 할인
   - 쿠폰처럼 영수증 전체에 걸린 할인은 결제금액과 맞도록 상품 금액 비율로 나눠 빼요(줍픽과 같은 방식)
   - 알아본 게 틀릴 수 있으니 화면에서 고치고 등록해요 — 이 파일은 고르기만 해요 */
(function (root) {
  const SUM = /합\s*계|소\s*계|[총종]\s*(구매|판매|금액|할인|결제)|결\s*제\s*금\s*액|[받밥발]\s*을\s*금\s*액|받\s*은\s*금\s*액|승\s*인\s*금\s*액|실\s*결\s*제|과\s*세|면\s*세|부\s*가\s*세|공\s*급\s*가|합\s*산|TOTAL/i;
  const PAID = /결\s*제\s*금\s*액|[받밥발]\s*을\s*금\s*액|승\s*인\s*금\s*액|실\s*결\s*제|[총종]\s*결\s*제|결\s*제\s*합\s*계|청\s*구\s*금\s*액/;
  const GROSS = /[총종]\s*(구매|판매)\s*(금)?액|^\s*합\s*계|판\s*매\s*합\s*계|정\s*상\s*가\s*합\s*계/;
  const CARDS = ['신한', '삼성', '현대', '국민', 'KB', '롯데', '하나', '우리', '비씨', 'BC', '농협', 'NH', '씨티', '카카오', '토스', 'IBK', '기업', '수협', '광주', '전북', '제주', '경남', '부산', '대구'];

  // OCR 이 자주 틀리는 글자 고치기(품번 자리에서만)
  const toDigit = s => s.replace(/[Oo]/g, '0').replace(/[Il|!]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2');
  // 글자 자리에 숫자로 읽힌 것: 0→D · 1→I (나이키 DD→00 · DDI391 처럼)
  const toAlpha = s => s.toUpperCase().replace(/[|!1L]/g, 'I').replace(/0/g, 'D').replace(/5/g, 'S').replace(/8/g, 'B');
  function codeOf(tok, known) {
    let t = String(tok || '').replace(/[‐‑–—_•·∙・●]/g, '-').replace(/\\\/|\/\\/g, 'V').replace(/^[^A-Za-z0-9|!]+|[^A-Za-z0-9]+$/g, '');
    if (!t) return '';
    const dash = /-/.test(t);
    let m = t.match(/^([A-Za-z0-9|!]{2})([\w|!]{4})-?([\w|!]{3})$/);       // 나이키 · 조던 DD1391-100
    if (m && (/[A-Za-z|!]/.test(m[1]) || dash)) { const a = toAlpha(m[1]), b = toDigit(m[2]), c = toDigit(m[3]); if (/^[A-Z]{2}$/.test(a) && /^\d{4}$/.test(b) && /^\d{3}$/.test(c)) return `${a}${b}-${c}`; }
    m = t.match(/^([A-Za-z|!1]{2})([\w|!]{4})$/);                         // 아디다스 IF1477 · GW2871
    if (m && /[A-Za-z]/.test(m[1])) { const a = toAlpha(m[1]), b = toDigit(m[2]); if (/^[A-Z]{2}$/.test(a) && /^\d{4}$/.test(b)) return a + b; }
    m = t.match(/^([A-Za-z])(\w{5})$/);                               // 아디다스 B75806 · H03737
    if (m && /[A-Za-z]/.test(m[1]) && /^\d{5}$/.test(toDigit(m[2])) && /\d{3}/.test(m[2])) return m[1].toUpperCase() + toDigit(m[2]);
    if (known && known.size) { const k = t.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (k.length >= 5 && known.has(k)) return known.get(k); }
    return '';
  }
  // 줄 안에서 품번 찾기 — 'FD9082- 102' · 'CW2288-1 11' · 'DDI 391-100' 처럼 쪼개진 것도 붙여 봐요
  function findCode(toks, known) {
    for (let i = 0; i < toks.length; i++) {
      const one = codeOf(toks[i], known);
      for (let n = 3; n >= 2; n--) {
        if (i + n > toks.length) continue;
        if (one && !/[-•·]$/.test(toks[i]) && !/^[-•·]/.test(toks[i + 1])) continue;   // 혼자 품번이면 '-' 로 이어질 때만 붙여요
        const c = codeOf(toks.slice(i, i + n).join(''), known);
        if (c && c.length > (one || '').length) return { code: c, i, n };
      }
      if (one) return { code: one, i, n: 1 };
    }
    return null;
  }
  // 금액: 139,000 · -41,700 · 41,700- · ₩139,000 · 139000(5자리 이상)
  function amtOf(tok) {
    let t = String(tok || '').replace(/[₩원\\]/g, '').replace(/^[•·∙・●]/, '-').replace(/[.](?=\d{3}(\D|$))/g, ',').trim();
    let neg = false; if (/^[-−–(]/.test(t) || /[-−–)]$/.test(t)) neg = true;
    t = t.replace(/^[-−–(]+|[-−–)]+$/g, '');
    if (/^\d{1,3}(,\d{3})+$/.test(t) || /^\d{5,8}$/.test(t)) { const v = +t.replace(/,/g, ''); if (v >= 1000) return neg ? -v : v; }
    return null;
  }
  const SHOE = s => { const v = +s; return /^\d{3}(\.5)?$/.test(s) && v >= 200 && v <= 330 && v % 5 === 0 ? s : ''; };
  const CLOTH = s => /^(XXS|XS|S|M|L|XL|XXL|2XL|3XL|XXXL|4XL|OS|F)$/i.test(s) ? s.toUpperCase() : (/^(80|85|90|95|100|105|110|115|120)$/.test(s) ? s : '');

  // 낱말 → 줄
  function rows(words) {
    const W = (words || []).filter(w => w && String(w[0]).trim()).map(w => ({ t: String(w[0]).trim(), x: +w[1], y: +w[2], w: +w[3], h: +w[4] }));
    if (!W.length) return [];
    const hs = W.map(w => w.h).sort((a, b) => a - b), H = hs[hs.length >> 1] || 10;
    // 기울기: 가까운 높이에 있는 낱말 쌍의 기울기 중앙값
    const sl = [], byX = W.slice().sort((a, b) => a.x - b.x);
    for (let i = 0; i < byX.length; i++) for (let j = i + 1; j < byX.length && sl.length < 4000; j++) {
      const a = byX[i], b = byX[j], dx = (b.x + b.w / 2) - (a.x + a.w / 2); if (dx < H * 3) continue;
      const dy = (b.y + b.h / 2) - (a.y + a.h / 2); if (Math.abs(dy) < H * 0.9 && Math.abs(dy / dx) < 0.12) sl.push(dy / dx);
    }
    sl.sort((a, b) => a - b); const k = sl.length ? sl[sl.length >> 1] : 0;
    W.forEach(w => { w.cy = w.y + w.h / 2 - k * (w.x + w.w / 2); });
    W.sort((a, b) => a.cy - b.cy);
    const R = [];
    for (const w of W) { const r = R[R.length - 1]; if (r && Math.abs(w.cy - r.cy) < H * 0.55) { r.ws.push(w); r.cy = (r.cy * (r.ws.length - 1) + w.cy) / r.ws.length; } else R.push({ cy: w.cy, ws: [w] }); }
    return R.map(r => { r.ws.sort((a, b) => a.x - b.x); return { toks: r.ws.map(w => w.t), text: r.ws.map(w => w.t).join(' ') }; });
  }

  // 줄(글자) → 영수증
  function parse(input, opt) {
    opt = opt || {};
    const known = new Map(); (opt.codes || []).forEach(c => { const k = String(c).toUpperCase().replace(/[^A-Z0-9]/g, ''); if (k) known.set(k, String(c).toUpperCase()); });
    const R0 = Array.isArray(input) ? (input.length && Array.isArray(input[0]) ? rows(input) : input) : String(input || '').split(/\r?\n/).map(l => ({ toks: l.trim().split(/\s+/).filter(Boolean), text: l.trim() }));
    // 폰 글자 인식(tesseract)은 한글을 '여 주 점' · '신 한 카드' 처럼 한 글자씩 띄어 읽어요 — 붙어 있는 한 글자 한글은 한 낱말로 붙여요
    const R = R0.map(r => {
      const t = []; let run = false;   // run: 마지막 낱말이 한 글자씩 붙여 만든 것
      for (const x of r.toks) {
        const one = /^[가-힣]$/.test(x);
        if (t.length && run && (one || /^(점|카드)$/.test(x))) { t[t.length - 1] += x; continue; }
        if (t.length && one && /^[가-힣]$/.test(t[t.length - 1])) { t[t.length - 1] += x; run = true; continue; }
        t.push(x); run = false;
      }
      return { toks: t, text: t.join(' ') };
    });
    const out = { date: '', store: '', brand: '', card: null, items: [], gross: 0, paid: 0, extraDisc: 0, warn: [], rows: R.map(r => r.text) };
    const all = R.map(r => r.text).join('\n').replace(/[•·∙・●]/g, '-');
    // 날짜 · 브랜드 · 지점 · 카드
    const dm = all.match(/(20\d{2})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/) || all.match(/(?:^|\D)(\d{2})[-./](\d{1,2})[-./](\d{1,2})(?:\D|$)/);
    if (dm) { const y = dm[1].length === 2 ? '20' + dm[1] : dm[1], mo = +dm[2], d = +dm[3]; if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) out.date = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
    out.brand = /아디다스|adidas/i.test(all) ? '아디다스' : /나이[키기]|NIKE|조던|JORDAN/i.test(all) ? '나이키' : /뉴발란스|new\s*balance/i.test(all) ? '뉴발란스' : '';
    for (const r of R.slice(0, 12)) { const t = r.toks.find(x => /^[가-힣A-Za-z]{1,8}점$/.test(x) && !/^(매점|지점|본점|상점|당점|할인점)$/.test(x)); if (t) { out.store = t; break; } }
    for (const r of R) {
      if (!/[카가]드|CARD|\*{2,}|승인/i.test(r.text)) continue;
      const co = CARDS.find(c => r.text.includes(c)); const l4 = r.text.match(/[*xX]{2,}[\s*xX-]*(\d{4})(?!\d)/) || (/카드\s*번호/.test(r.text) ? r.text.match(/(\d{4})\s*$/) : null);
      if (co || l4) { out.card = out.card || { co: '', last4: '' }; if (co && !out.card.co) out.card.co = co; if (l4 && !out.card.last4) out.card.last4 = l4[1]; }
    }
    // 상품 덩어리
    let cur = null, ended = false;
    const flush = () => { if (cur) out.items.push(cur); cur = null; };
    for (const r of R) {
      const fc = findCode(r.toks, known), isSum = SUM.test(r.text) && !fc;
      if (isSum) {
        flush(); ended = out.items.length > 0;
        const a = r.toks.map(amtOf).filter(v => v != null), last = a.length ? a[a.length - 1] : null;
        if (last != null && last > 0) { if (PAID.test(r.text)) out.paid = last; else if (GROSS.test(r.text) && !out.gross) out.gross = last; }
        continue;
      }
      const toks = r.toks.slice();
      if (fc) { flush(); ended = false; cur = { code: fc.code, name: '', size: '', qty: 0, amts: [], disc: 0, line: r.text }; toks.splice(fc.i, fc.n); }
      if (!cur) {
        // 합계 줄 뒤 마이너스(쿠폰 등)는 영수증 전체 할인 후보 — 결제금액으로 다시 맞춰요
        if (!out.paid) { const a = toks.map(amtOf).filter(v => v != null); if (/[카가]드|현금|CARD/i.test(r.text) && a.length && a[a.length - 1] > 0 && ended) out.cardAmt = out.cardAmt || a[a.length - 1]; }
        continue;
      }
      const isDisc = /[할활]\s*[인민]|쿠\s*폰|DC|D\/C|에누리|행사|멤버십|프로모션/i.test(r.text);
      const qtyRow = !!fc || toks.some(t => amtOf(t) != null);   // 수량은 품번 줄 · 금액 있는 줄에서만('AIR FORCE 1 07' 의 숫자 말고)
      const negRow = toks.some(t => (amtOf(t) || 0) < 0);
      if (isDisc && !toks.some(t => amtOf(t) != null)) { const pc = toks.map(t => t.match(/^(\d{1,2})(%|0\/0|o\/o)$/)).find(Boolean); if (pc) cur.pct = +pc[1]; }   // 할인 금액이 뭉개지면 '30%' 로 계산
      for (const t of toks) {
        const v = amtOf(t);
        if (v != null) { if (v < 0 || isDisc) cur.disc += Math.abs(v); else cur.amts.push(v); continue; }
        if (negRow) continue;
        if (!cur.size) { const s = SHOE(t) || (isDisc ? '' : CLOTH(t)); if (s) { cur.size = s; continue; } }
        if (!cur.qty && qtyRow && /^\d{1,2}$/.test(t) && +t >= 1 && +t <= 30 && !isDisc) { cur.qty = +t; continue; }
        if (!isDisc && /[A-Za-z가-힣]{2,}/.test(t) && cur.name.length < 40 && !/^(수량|단가|금액|사이즈|SIZE|QTY)$/i.test(t)) cur.name = (cur.name + ' ' + t).trim();
      }
    }
    flush();
    if (!out.paid && out.cardAmt) out.paid = out.cardAmt;
    delete out.cardAmt;
    // 단가 · 줄 금액 정하기: 금액이 둘이면 작은 게 단가, 하나면 합계와 맞는 쪽으로
    out.items.forEach(it => { it.qty = it.qty || 1; const a = it.amts; if (a.length >= 2) { const s = a.slice().sort((x, y) => x - y); it.unit = s[0]; it.lineAmt = s.find(v => v === s[0] * it.qty) || s[0] * it.qty; } else { it.unit = a[0] || 0; it.lineAmt = it.unit * it.qty; } });
    const multi = out.items.filter(it => it.qty > 1 && it.amts.length === 1);
    if (multi.length) {
      const sumAsUnit = out.items.reduce((t, it) => t + it.lineAmt, 0), sumAsLine = out.items.reduce((t, it) => t + (it.qty > 1 && it.amts.length === 1 ? it.unit : it.lineAmt), 0);
      const netU = sumAsUnit - out.items.reduce((t, it) => t + it.disc, 0), netL = sumAsLine - out.items.reduce((t, it) => t + it.disc, 0);
      const near = (x, y) => y && Math.abs(x - y) <= 10;
      if ((near(sumAsLine, out.gross) || near(netL, out.paid)) && !(near(sumAsUnit, out.gross) || near(netU, out.paid))) multi.forEach(it => { it.lineAmt = it.unit; it.unit = Math.round(it.unit / it.qty); });
    }
    out.items.forEach(it => { if (!it.disc && it.pct) it.disc = Math.round(it.lineAmt * it.pct / 100 / 100) * 100; delete it.pct; it.net = Math.max(0, it.lineAmt - it.disc); });
    const net = out.items.reduce((t, it) => t + it.net, 0);
    if (out.paid && net > out.paid) {
      out.extraDisc = net - out.paid; let left = out.extraDisc;
      out.items.forEach((it, i) => { const cut = i === out.items.length - 1 ? left : Math.round(out.extraDisc * it.net / net); it.net -= cut; left -= cut; });
    } else if (out.paid && net && net < out.paid - 10) out.warn.push(`상품 금액 합(${net.toLocaleString()}원)이 결제금액(${out.paid.toLocaleString()}원)보다 적어요 — 빠진 상품이 있는지 봐 주세요`);
    out.items.forEach(it => { it.cost = Math.round(it.net / it.qty); delete it.amts; if (!it.size) out.warn.push(`${it.code}: 사이즈를 못 읽었어요`); if (!it.unit) out.warn.push(`${it.code}: 금액을 못 읽었어요`); });
    if (!out.items.length) out.warn.push('품번을 하나도 못 읽었어요 — 영수증을 밝은 곳에서 똑바로, 가까이 찍어 주세요');
    if (!out.paid) out.warn.push('결제금액을 못 읽었어요 — 금액을 확인해 주세요');
    if (!out.date) out.warn.push('날짜를 못 읽었어요 — 매입일을 확인해 주세요');
    return out;
  }
  // 지점 글자(예: 여주점) → 매장 사전에서 고르기
  function matchStore(store, brand, parts) {
    if (!store) return null; const s = store.replace(/점$/, '');
    const near = n => { n = String(n || ''); if (s.length < 2) return false;   // 한 글자 틀려도(시홍 → 시흥)
      for (let i = 0; i + s.length <= n.length; i++) { let d = 0; for (let j = 0; j < s.length; j++) if (n[i + j] !== s[j]) d++; if (d <= 1 && /^[가-힣]+$/.test(n.slice(i, i + s.length))) return true; } return false; };
    let c = (parts || []).filter(p => String(p.name || '').includes(s)); if (!c.length) c = (parts || []).filter(p => near(p.name));
    return c.find(p => brand && String(p.name || '').includes(brand)) || c[0] || null;
  }
  const RC = { rows, parse, codeOf, amtOf, matchStore };
  if (typeof module !== 'undefined' && module.exports) module.exports = RC; else root.RC = RC;
})(typeof window !== 'undefined' ? window : this);
