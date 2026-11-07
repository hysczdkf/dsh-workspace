(function () {
  'use strict';

  var PAGE = 50;
  var state = {
    rows: [], contests: [], schools: [], careers: [],
    filtered: [], page: 1,
    season: 'all', contest: 'all', q: '', sort: 'rank',
    sPage: 1, cPage: 1, cQ: '', cSort: 'appear', sQ: ''
  };
  var careerMap = new Map();

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtDate(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function load() {
    var files = ['data/dataset.json', 'data/schools.json', 'data/careers.json'];
    return Promise.all(files.map(function (f) {
      return fetch(f).then(function (r) {
        if (!r.ok) throw new Error(f + ': HTTP ' + r.status);
        return r.json();
      });
    })).then(function (out) {
      state.contests = out[0].contests;
      state.rows = out[0].rows;
      state.schools = out[1];
      state.careers = out[2];
      state.careers.forEach(function (c) { careerMap.set(c[0] + '\u0000' + c[1], c); });
    });
  }

  function boot() {
    $('st-contests').textContent = state.contests.length.toLocaleString();
    $('st-rows').textContent = state.rows.length.toLocaleString();
    $('st-schools').textContent = state.schools.length.toLocaleString();
    $('st-teams').textContent = state.careers.length.toLocaleString();

    fillSeasonFilter();
    fillContestFilter('all');
    applyRows();
    renderSchools();
    renderCareers();
    $('loading').style.display = 'none';
  }

  function seasons() {
    var seen = new Set(), out = [];
    state.contests.forEach(function (c) { if (!seen.has(c.season)) { seen.add(c.season); out.push(c.season); } });
    return out;
  }

  function fillSeasonFilter() {
    var sel = $('f-season');
    sel.innerHTML = '<option value="all">全部赛季</option>' + seasons().map(function (s) {
      return '<option value="' + esc(s) + '">' + esc(s) + '</option>';
    }).join('');
  }

  function fillContestFilter(season) {
    var sel = $('f-contest');
    var list = state.contests.map(function (c, i) { return { c: c, i: i }; })
      .filter(function (o) { return season === 'all' || o.c.season === season; });
    sel.innerHTML = '<option value="all">全部赛事</option>' + list.map(function (o) {
      return '<option value="' + o.i + '">' + esc(o.c.name) + '（' + o.c.teams + '队）</option>';
    }).join('');
  }

  function rowHaystack(row) {
    if (!row._h) {
      row._h = (row[4] + ' ' + row[5] + ' ' + row[6]).toLowerCase();
    }
    return row._h;
  }

  function applyRows() {
    var q = state.q.trim().toLowerCase();
    var terms = q ? q.split(/\s+/) : [];
    var season = state.season, contest = state.contest;

    var idx = [];
    for (var i = 0; i < state.rows.length; i++) {
      var row = state.rows[i];
      var c = state.contests[row[0]];
      if (season !== 'all' && c.season !== season) continue;
      if (contest !== 'all' && String(row[0]) !== contest) continue;
      if (terms.length) {
        var hay = rowHaystack(row);
        var ok = true;
        for (var t = 0; t < terms.length; t++) {
          if (hay.indexOf(terms[t]) === -1) { ok = false; break; }
        }
        if (!ok) continue;
      }
      idx.push(i);
    }

    var sort = state.sort;
    if (sort === 'rank') {
      idx.sort(function (a, b) {
        var ra = state.rows[a], rb = state.rows[b];
        return ra[0] - rb[0] || ra[1] - rb[1];
      });
    } else if (sort === 'solved') {
      idx.sort(function (a, b) {
        var ra = state.rows[a], rb = state.rows[b];
        return rb[2] - ra[2] || ra[1] - rb[1];
      });
    } else if (sort === 'school') {
      idx.sort(function (a, b) {
        var ra = state.rows[a], rb = state.rows[b];
        return ra[4].localeCompare(rb[4], 'zh-CN') || ra[1] - rb[1];
      });
    } else if (sort === 'time') {
      idx.sort(function (a, b) {
        return state.rows[b][0] - state.rows[a][0] || state.rows[a][1] - state.rows[b][1];
      });
    }

    state.filtered = idx;
    state.page = 1;
    renderRows();
  }

  function renderRows() {
    var total = state.filtered.length;
    var pages = Math.max(1, Math.ceil(total / PAGE));
    if (state.page > pages) state.page = pages;
    var start = (state.page - 1) * PAGE;
    var slice = state.filtered.slice(start, start + PAGE);

    var html = slice.map(function (i) {
      var r = state.rows[i], c = state.contests[r[0]];
      var cls = r[1] === 1 ? 'rank-1' : r[1] === 2 ? 'rank-2' : r[1] === 3 ? 'rank-3' : '';
      var tag = r[7] ? '' : '<span class="tag">非正式</span>';
      return '<tr data-i="' + i + '">' +
        '<td class="num ' + cls + '">' + r[1] + '</td>' +
        '<td>' + esc(c.season) + '</td>' +
        '<td>' + esc(c.name) + '</td>' +
        '<td class="school">' + esc(r[4]) + '</td>' +
        '<td>' + esc(r[5]) + tag + '</td>' +
        '<td class="members">' + esc(r[6]) + '</td>' +
        '<td class="num">' + r[2] + '</td>' +
        '<td class="num">' + r[3] + '</td>' +
        '</tr>';
    }).join('');

    $('tbl-rows').tBodies[0].innerHTML = html || '<tr><td colspan="8" style="text-align:center;color:#8b93a3">没有匹配的记录</td></tr>';
    $('rows-meta').textContent = '共 ' + total.toLocaleString() + ' 条记录' +
      (state.contest !== 'all' ? ' · 单场赛事' : '') +
      (state.season !== 'all' ? ' · ' + state.season : '');
    renderPager($('pager'), state.page, pages, function (p) { state.page = p; renderRows(); });
  }

  function renderPager(el, page, pages, go) {
    if (pages <= 1) { el.innerHTML = ''; return; }
    el.innerHTML =
      '<button ' + (page <= 1 ? 'disabled' : '') + ' data-p="' + (page - 1) + '">上一页</button>' +
      '<span class="info">' + page + ' / ' + pages + '</span>' +
      '<button ' + (page >= pages ? 'disabled' : '') + ' data-p="' + (page + 1) + '">下一页</button>';
    Array.prototype.forEach.call(el.querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () { go(parseInt(b.getAttribute('data-p'), 10)); });
    });
  }

  function renderSchools() {
    var q = state.sQ.trim().toLowerCase();
    var list = state.schools.filter(function (s) { return !q || s.name.toLowerCase().indexOf(q) !== -1; });
    var pages = Math.max(1, Math.ceil(list.length / PAGE));
    if (state.sPage > pages) state.sPage = pages;
    var slice = list.slice((state.sPage - 1) * PAGE, state.sPage * PAGE);
    $('tbl-schools').tBodies[0].innerHTML = slice.map(function (s) {
      return '<tr><td class="school">' + esc(s.name) + '</td>' +
        '<td class="num">' + s.appearances + '</td>' +
        '<td class="num">' + s.teams + '</td>' +
        '<td class="num">' + (s.best_rank == null ? '—' : s.best_rank) + '</td></tr>';
    }).join('') || '<tr><td colspan="4" style="text-align:center;color:#8b93a3">没有匹配的学校</td></tr>';
    renderPager($('s-pager'), state.sPage, pages, function (p) { state.sPage = p; renderSchools(); });
  }

  function renderCareers() {
    var q = state.cQ.trim().toLowerCase();
    var list = state.careers.filter(function (c) {
      return !q || (c[0] + ' ' + c[1]).toLowerCase().indexOf(q) !== -1;
    });
    var sort = state.cSort;
    list = list.slice().sort(function (a, b) {
      if (sort === 'best') return a[3] - b[3] || b[2] - a[2];
      if (sort === 'solved') return b[4] - a[4] || b[2] - a[2];
      return b[2] - a[2] || a[3] - b[3];
    });
    var pages = Math.max(1, Math.ceil(list.length / PAGE));
    if (state.cPage > pages) state.cPage = pages;
    var slice = list.slice((state.cPage - 1) * PAGE, state.cPage * PAGE);
    $('tbl-careers').tBodies[0].innerHTML = slice.map(function (c) {
      var hist = c[5].slice(0, 6).map(function (h) {
        var ct = state.contests[h[0]];
        return esc(ct.season + ' ' + ct.name) + ' · #' + h[1] + ' · ' + h[2] + '题';
      }).join('<br>');
      return '<tr data-school="' + esc(c[0]) + '" data-team="' + esc(c[1]) + '"><td class="school">' + esc(c[0]) + '</td>' +
        '<td>' + esc(c[1]) + '</td>' +
        '<td class="num">' + c[2] + '</td>' +
        '<td class="num">' + c[3] + '</td>' +
        '<td class="num">' + c[4] + '</td>' +
        '<td class="members">' + hist + '</td></tr>';
    }).join('') || '<tr><td colspan="6" style="text-align:center;color:#8b93a3">没有匹配的队伍</td></tr>';
    renderPager($('c-pager'), state.cPage, pages, function (p) { state.cPage = p; renderCareers(); });
  }

  function openCareer(school, team) {
    var c = careerMap.get(school + '\u0000' + team);
    if (!c) return;
    $('modal-title').textContent = team;
    $('modal-sub').textContent = school + ' · 参赛 ' + c[2] + ' 次 · 最佳名次 ' + c[3] + ' · 累计过题 ' + c[4];
    var rows = c[5].slice().sort(function (a, b) { return b[0] - a[0]; }).map(function (h) {
      var ct = state.contests[h[0]];
      return '<tr><td>' + esc(ct.season) + '</td><td>' + esc(ct.name) + '</td>' +
        '<td class="num">' + h[1] + '</td><td class="num">' + h[2] + '</td><td class="num">' + h[3] + '</td></tr>';
    }).join('');
    $('tbl-modal').tBodies[0].innerHTML = rows;
    $('modal').hidden = false;
  }

  function bind() {
    document.querySelectorAll('.tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.tab').forEach(function (b) { b.classList.remove('active'); });
        document.querySelectorAll('.panel').forEach(function (p) { p.classList.remove('active'); });
        btn.classList.add('active');
        $('panel-' + btn.dataset.tab).classList.add('active');
      });
    });

    $('f-season').addEventListener('change', function (e) {
      state.season = e.target.value;
      state.contest = 'all';
      fillContestFilter(state.season);
      applyRows();
    });
    $('f-contest').addEventListener('change', function (e) {
      state.contest = e.target.value;
      applyRows();
    });
    var qt;
    $('f-q').addEventListener('input', function (e) {
      clearTimeout(qt);
      qt = setTimeout(function () { state.q = e.target.value; applyRows(); }, 160);
    });
    $('f-sort').addEventListener('change', function (e) { state.sort = e.target.value; applyRows(); });

    var st;
    $('s-q').addEventListener('input', function (e) {
      clearTimeout(st);
      st = setTimeout(function () { state.sQ = e.target.value; state.sPage = 1; renderSchools(); }, 160);
    });
    var ct;
    $('c-q').addEventListener('input', function (e) {
      clearTimeout(ct);
      ct = setTimeout(function () { state.cQ = e.target.value; state.cPage = 1; renderCareers(); }, 160);
    });
    $('c-sort').addEventListener('change', function (e) { state.cSort = e.target.value; renderCareers(); });

    $('tbl-rows').tBodies[0].addEventListener('click', function (e) {
      var tr = e.target.closest('tr');
      if (!tr || !tr.dataset.i) return;
      var r = state.rows[+tr.dataset.i];
      openCareer(r[4], r[5]);
    });
    $('tbl-careers').tBodies[0].addEventListener('click', function (e) {
      var tr = e.target.closest('tr');
      if (!tr) return;
      openCareer(tr.dataset.school, tr.dataset.team);
    });
    $('modal-close').addEventListener('click', function () { $('modal').hidden = true; });
    $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) $('modal').hidden = true; });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') $('modal').hidden = true; });
  }

  load().then(function () { bind(); boot(); }).catch(function (err) {
    $('loading').textContent = '数据加载失败：' + err.message + '（请先运行 scripts/build_dataset.py 生成 web/data）';
  });
})();
