// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail view with the model's own
// inputs and the protocol's farm plan, plus a model sandbox that re-ranks the board live. No
// network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var M = DATA.model;
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };
  var sandbox = { mult: 1, up: M.growth_up_weight, down: M.growth_down_weight, age: 1 };
  var DEFAULTS = { mult: 1, up: M.growth_up_weight, down: M.growth_down_weight, age: 1 };

  function $(id) { return document.getElementById(id); }
  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  // The model in one function, mirroring lib/model.ts: the page recomputes a row from the snapshot
  // figures and checks the number board.json carries, so the page's code and the board's data are
  // visibly the same arithmetic. The sandbox scales the multiple, the growth weights and the
  // maturity strength; at the defaults the recompute matches board.json exactly.
  function impliedOf(row, sb) {
    var mult = row.multiple * sb.mult;
    var g = clamp(row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d, M.growth_floor, M.growth_cap);
    var w = g >= 0 ? sb.up : sb.down;
    var growthMult = clamp(1 + (g / 100) * w, 0.25, 1.98);
    var age = row.age_days === null || row.age_days === undefined ? M.unknown_age_days : row.age_days;
    var ageMult = M.age_floor + (Math.min(Math.max(age, 0), M.age_days) / M.age_days) * M.age_range;
    if (age < M.young_days) ageMult *= 0.75 + (0.25 * age) / M.young_days;
    ageMult = 1 + (ageMult - 1) * sb.age;
    return {
      implied: Math.min(M.implied_cap, Math.max(1, Math.round(row.tvl_usd * mult * growthMult * ageMult * row.chain_multiplier))),
      multiple: mult, growthMult: growthMult, ageMult: ageMult, age: age
    };
  }
  function sandboxActive() {
    return sandbox.mult !== DEFAULTS.mult || sandbox.up !== DEFAULTS.up || sandbox.down !== DEFAULTS.down || sandbox.age !== DEFAULTS.age;
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // Rows with a live implied value: the board's own number at the defaults, the sandbox's number
  // once a slider moves. Ranks follow the live number.
  function liveRows() {
    var active = sandboxActive();
    var rows = DATA.rows.map(function (r) {
      var v = impliedOf(r, sandbox);
      return { row: r, implied: v.implied, calc: v };
    });
    if (active) rows.sort(function (a, b) { return b.implied - a.implied || (a.row.slug < b.row.slug ? -1 : 1); });
    rows.forEach(function (x, i) { x.liveRank = active ? i + 1 : x.row.rank; });
    return rows;
  }
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return liveRows().filter(function (x) {
      var r = x.row;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.row.name.toLowerCase(); bv = b.row.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.row.tvl_usd; bv = b.row.tvl_usd; }
      else if (key === 'growth') { av = a.row.change_7d === null ? -Infinity : a.row.change_7d; bv = b.row.change_7d === null ? -Infinity : b.row.change_7d; }
      else if (key === 'age') { av = a.row.age_days === null ? Infinity : a.row.age_days; bv = b.row.age_days === null ? Infinity : b.row.age_days; }
      else if (key === 'chains') { av = (a.row.chains || []).length; bv = (b.row.chains || []).length; }
      else { av = a.implied; bv = b.implied; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.row.slug < b.row.slug ? -1 : a.row.slug > b.row.slug ? 1 : 0;
    });
  }

  function renderStatic() {
    $('top-meta').textContent = '';
    $('top-meta').appendChild(el('span', { text: 'Snapshot ' + DATA.as_of }));
    $('top-meta').appendChild(el('span', { text: DATA.rows.length + ' pre-token rows' }));
    $('top-meta').appendChild(el('span', { text: DATA.model_version + ' model' }));
    $('headline').textContent = DATA.watchlist_size + ' watchlist protocols, ranked by implied value';
    $('lede-p').textContent = 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor. Implied value is a model, not a promise.';
    var facts = $('facts');
    facts.textContent = '';
    var factData = [
      ['Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size],
      ['Pre-token rows scored', String(DATA.board_size)],
      ['Early rows below the floor', String(DATA.early_size)],
      ['Live-token protocols set aside', String(DATA.live_size)]
    ];
    factData.forEach(function (f) {
      facts.appendChild(el('div', { class: 'fact' }, el('span', { text: f[0] }), el('b', { text: f[1] })));
    });
    // Top 10 strip.
    var top = $('top10');
    top.textContent = '';
    var max = DATA.rows[0] ? DATA.rows[0].implied_value_usd : 1;
    DATA.rows.slice(0, 10).forEach(function (r) {
      top.appendChild(el('button', { type: 'button', class: 'top10-card', onclick: function () { openDetail(r.slug); } },
        el('span', { class: 'rk', text: '#' + r.rank }),
        el('span', { class: 'nm', text: r.name }),
        el('span', { class: 'vl', text: fmtUsd(r.implied_value_usd) }),
        el('span', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(4, Math.round((r.implied_value_usd / max) * 100)) + '%' }))
      ));
    });
    // Filters.
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var catSel = $('category');
    catSel.textContent = '';
    catSel.appendChild(el('option', { value: 'all', text: 'All categories' }));
    cats.forEach(function (c) { catSel.appendChild(el('option', { value: c, text: c })); });
    catSel.value = state.category;
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var chainSel = $('chain');
    chainSel.textContent = '';
    chainSel.appendChild(el('option', { value: 'all', text: 'All chains' }));
    chains.forEach(function (c) { chainSel.appendChild(el('option', { value: c, text: c })); });
    chainSel.value = state.chain;
    // Comparables table.
    var ct = $('comps-tbody');
    ct.textContent = '';
    DATA.comparables.forEach(function (c) {
      ct.appendChild(el('tr', null,
        el('td', { text: c.category }),
        el('td', { class: 'num', text: String(c.protocols) }),
        el('td', { class: 'num', text: c.multiple.toFixed(3) + 'x' })
      ));
    });
    ct.appendChild(el('tr', null,
      el('td', { text: 'Global fallback (fewer than ' + M.min_comparables + ' live protocols)' }),
      el('td', { class: 'num', text: '—' }),
      el('td', { class: 'num', text: DATA.global_multiple.toFixed(3) + 'x' })
    ));
    $('formula').textContent = 'implied = min($2B, round( tvl_usd x multiple x growthMult x ageMult x chainMult ))  ·  multiple = category median mcap/TVL (min ' + M.min_comparables + ' live protocols, else global ' + DATA.global_multiple.toFixed(3) + 'x, clamped ' + M.multiple_floor + '–' + M.multiple_cap + ')  ·  growthMult = 1 + clamp(7d, ' + M.growth_floor + ', ' + M.growth_cap + ')/100 x ' + M.growth_up_weight + ' up / ' + M.growth_down_weight + ' down  ·  ageMult = ' + M.age_floor + ' + min(age, ' + M.age_days + 'd)/' + M.age_days + 'd x ' + M.age_range + ', young protocols discounted  ·  chainMult = 1 + ' + M.chain_bonus + ' x extra chains (max ' + M.chain_max + ')';
    $('model-note').textContent = 'TVL, seven-day growth, listing date and chains come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + M.unknown_age_days + ' days. The early radar is every rankable pre-token protocol, and the live-token protocols are set aside with their market caps shown.';
  }

  function renderBoard() {
    var list = sortedRows(filteredRows());
    var tbody = $('tbody');
    tbody.textContent = '';
    $('empty').hidden = list.length !== 0;
    $('count').textContent = state.tab === 'pre-token' ? list.length + ' rows shown' : DATA.live.length + ' live-token protocols';
    if (list.length === 0) return;
    var max = Math.max.apply(null, list.map(function (x) { return x.implied; })) || 1;
    list.forEach(function (x) {
      var r = x.row;
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(x.liveRank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: String((r.chains || []).length) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((x.implied / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(x.implied) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
  }

  function renderLive() {
    var tbody = $('live-tbody');
    tbody.textContent = '';
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
  }

  var dialog = $('detail');
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    var calc = impliedOf(row, sandbox);
    var match = calc.implied === row.implied_value_usd;
    dialog.textContent = '';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (sandboxActive() ? ' · sandbox' : '') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category multiple' }), el('b', { class: 'num', text: calc.multiple.toFixed(3) + 'x (' + (row.comparables > 0 ? row.comparables + ' live comps' : 'global fallback') + ')' })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: calc.growthMult.toFixed(3) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Age multiplier' }), el('b', { class: 'num', text: calc.ageMult.toFixed(3) })),
        el('div', null, el('span', { text: 'Chains' }), el('b', { class: 'num', text: String((row.chains || []).length) })),
        el('div', null, el('span', { text: 'Chain multiplier' }), el('b', { class: 'num', text: row.chain_multiplier.toFixed(3) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(calc.implied) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(calc.implied) + (match ? ', the same number board.json carries.' : ' — the sandbox is active, so this differs from the board as submitted.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, (row.farm_steps || []).map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    $('board-panel').hidden = state.tab !== 'pre-token';
    $('live-panel').hidden = state.tab !== 'live';
    $('model-panel').hidden = state.tab !== 'pre-token';
    $('top10-panel').hidden = state.tab !== 'pre-token';
    $('tab-pre').setAttribute('aria-selected', state.tab === 'pre-token' ? 'true' : 'false');
    $('tab-live').setAttribute('aria-selected', state.tab === 'live' ? 'true' : 'false');
    $('sandbox-badge').hidden = !sandboxActive();
    if (state.tab === 'pre-token') renderBoard();
    else renderLive();
    $('app').setAttribute('aria-busy', 'false');
    if (state.selected) openDetail(state.selected);
    window.__shotReady = true;
  }

  function bind() {
    var q = $('q');
    q.value = state.q;
    q.addEventListener('input', function () { state.q = q.value; writeHash(); render(); });
    $('category').addEventListener('change', function (e) { state.category = e.target.value; writeHash(); render(); });
    $('chain').addEventListener('change', function (e) { state.chain = e.target.value; writeHash(); render(); });
    $('tab-pre').addEventListener('click', function () { state.tab = 'pre-token'; writeHash(); render(); });
    $('tab-live').addEventListener('click', function () { state.tab = 'live'; writeHash(); render(); });
    $('clear-filters').addEventListener('click', function () { state.q = ''; state.category = 'all'; state.chain = 'all'; q.value = ''; $('category').value = 'all'; $('chain').value = 'all'; writeHash(); render(); });
    var heads = document.querySelectorAll('#board-table thead button[data-sort]');
    heads.forEach(function (b) {
      b.addEventListener('click', function () {
        var key = b.getAttribute('data-sort');
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = -1; }
        render();
      });
    });
    function sand(id, out, key, fmt) {
      var input = $(id);
      input.addEventListener('input', function () {
        sandbox[key] = parseFloat(input.value);
        $(out).textContent = fmt(sandbox[key]);
        render();
      });
    }
    sand('sb-mult', 'sb-mult-v', 'mult', function (v) { return v.toFixed(2); });
    sand('sb-up', 'sb-up-v', 'up', function (v) { return v.toFixed(2); });
    sand('sb-down', 'sb-down-v', 'down', function (v) { return v.toFixed(2); });
    sand('sb-age', 'sb-age-v', 'age', function (v) { return v.toFixed(2); });
    $('sb-reset').addEventListener('click', function () {
      sandbox = { mult: 1, up: M.growth_up_weight, down: M.growth_down_weight, age: 1 };
      $('sb-mult').value = '1'; $('sb-up').value = String(M.growth_up_weight);
      $('sb-down').value = String(M.growth_down_weight); $('sb-age').value = '1';
      $('sb-mult-v').textContent = '1.00'; $('sb-up-v').textContent = M.growth_up_weight.toFixed(2);
      $('sb-down-v').textContent = M.growth_down_weight.toFixed(2); $('sb-age-v').textContent = '1.00';
      render();
    });
  }

  readHash();
  renderStatic();
  bind();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
