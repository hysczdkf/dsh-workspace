(function () {
  'use strict';

  var PAGE = 50;

  var state = {
    contests: [], schools: [], seasons: [],
    rows: [],
    loaded: Object.create(null),
    careers: null,
    season: null,          // season key, or 'all'
    contest: 'all',
    q: '',
    sort: 'rank',
    page: 1,
    sPage: 1, sQ: '',
    cPage: 1, cQ: '', cSort: 'appear',
    womenOnly: false,
    pQ: '',
    shards: Object.create(null),
    filtered: []
  };
  var careerMap = new Map();

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function getJson(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + ': HTTP ' + r.status);
      return r.json();
    });
  }

  function seasonFile(key) { return 'data/rows-' + key + '.json'; }

  function note(text) { $('rows-meta').textContent = text; }

  // ---------- loading ----------

  function loadSeason(key) {
    if (state.loaded[key]) return Promise.resolve();
    return getJson(seasonFile(key)).then(function (rows) {
      state.loaded[key] = true;
      for (var i = 0; i < rows.length; i++) state.rows.push(rows[i]);
    });
  }

  function loadAllSeasons() {
    var pending = state.seasons.filter(function (s) { return !state.loaded[s.key]; });
    var done = state.seasons.length - pending.length;
    var chain = Promise.resolve();
    pending.forEach(function (s) {
      chain = chain.then(function () {
        note('正在加载 ' + s.label + ' …（' + (done + 1) + '/' + state.seasons.length + '）');
        return loadSeason(s.key).then(function () { done++; });
      });
    });
    return chain;
  }

  function ensureLoaded() {
    if (state.season === 'all') return loadAllSeasons();
    return loadSeason(state.season);
  }

  // ---------- views ----------

  function boot() {
    var counts = state.counts || { contests: state.contests.length, rows: 0, schools: state.schools.length, teams: 0 };
    $('st-contests').textContent = counts.contests.toLocaleString();
    $('st-rows').textContent = counts.rows.toLocaleString();
    $('st-schools').textContent = counts.schools.toLocaleString();
    $('st-teams').textContent = counts.teams.toLocaleString();

    fillSeasonFilter();
    fillContestFilter('all');

    // default to the most recent season so first paint stays fast
    state.season = state.seasons.length ? state.seasons[0].key : 'all';
    $('f-season').value = state.season;

    note('正在加载最新赛季 …');
    ensureLoaded().then(function () {
      applyRows();
      renderSchools();
    }).catch(showError);
  }

  function showError(err) {
    $('loading').style.display = 'block';
    $('loading').textContent = '数据加载失败：' + err.message;
  }

  function fillSeasonFilter() {
    var sel = $('f-season');
    sel.innerHTML = '<option value="all">全部赛季（较慢）</option>' +
      state.seasons.map(function (s) {
        return '<option value="' + esc(s.key) + '">' + esc(s.label) +
          '（' + s.contests + ' 场 · ' + s.rows + ' 队）</option>';
      }).join('');
  }

  function fillContestFilter(seasonKey) {
    var sel = $('f-contest');
    var list = state.contests.map(function (c, i) { return { c: c, i: i }; })
      .filter(function (o) { return seasonKey === 'all' || o.c.key === seasonKey; });
    sel.innerHTML = '<option value="all">全部赛事</option>' + list.map(function (o) {
      return '<option value="' + o.i + '">' + (o.c.women ? '【女生赛】' : '') +
        esc(o.c.name) + '（' + o.c.teams + '队）</option>';
    }).join('');
  }

  function schoolName(row) { return state.schools[row[4]][0]; }

  function rowHaystack(row) {
    if (!row._h) row._h = (schoolName(row) + ' ' + row[5] + ' ' + row[6]).toLowerCase();
    return row._h;
  }

  function switchSeason(key) {
    state.season = key;
    state.contest = 'all';
    state.rows = [];
    state.loaded = Object.create(null);
    $('f-season').value = key;
    fillContestFilter(key);
    note('正在加载 …');
    return ensureLoaded().then(applyRows);
  }

  function seasonHasWomen(key) {
    return state.contests.some(function (c) {
      return c.women && (key === 'all' || c.key === key);
    });
  }

  function applyRows() {
    var q = state.q.trim().toLowerCase();
    var terms = q ? q.split(/\s+/) : [];
    var contest = state.contest;
    var idx = [];

    for (var i = 0; i < state.rows.length; i++) {
      var row = state.rows[i];
      if (contest !== 'all' && String(row[0]) !== contest) continue;
      if (state.womenOnly && !state.contests[row[0]].women) continue;
      if (terms.length) {
        var hay = rowHaystack(row), ok = true;
        for (var t = 0; t < terms.length; t++) {
          if (hay.indexOf(terms[t]) === -1) { ok = false; break; }
        }
        if (!ok) continue;
      }
      idx.push(i);
    }

    var sort = state.sort;
    if (sort === 'rank') {
      idx.sort(function (a, b) { return state.rows[a][0] - state.rows[b][0] || state.rows[a][1] - state.rows[b][1]; });
    } else if (sort === 'solved') {
      idx.sort(function (a, b) { return state.rows[b][2] - state.rows[a][2] || state.rows[a][1] - state.rows[b][1]; });
    } else if (sort === 'school') {
      idx.sort(function (a, b) { return schoolName(state.rows[a]).localeCompare(schoolName(state.rows[b]), 'zh-CN'); });
    } else if (sort === 'time') {
      idx.sort(function (a, b) { return state.rows[b][0] - state.rows[a][0] || state.rows[a][1] - state.rows[b][1]; });
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
      var wtag = c.women ? '<span class="tag tag-women">女生赛</span>' : '';
      return '<tr data-i="' + i + '">' +
        '<td class="num ' + cls + '">' + r[1] + '</td>' +
        '<td>' + esc(c.season) + '</td>' +
        '<td>' + esc(c.name) + wtag + '</td>' +
        '<td class="school">' + esc(schoolName(r)) + '</td>' +
        '<td>' + esc(r[5]) + tag + '</td>' +
        '<td class="members">' + esc(r[6]) + '</td>' +
        '<td class="num">' + r[2] + '</td>' +
        '<td class="num">' + r[3] + '</td>' +
        '</tr>';
    }).join('');

    $('tbl-rows').tBodies[0].innerHTML = html ||
      '<tr><td colspan="8" style="text-align:center;color:#8b93a3">没有匹配的记录</td></tr>';

    var label = state.season === 'all' ? '全部赛季' :
      (state.seasons.find(function (s) { return s.key === state.season; }) || {}).label || '';
    note('已载入 ' + label + ' · 共 ' + total.toLocaleString() + ' 条记录');
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
    var list = state.schools.filter(function (s) { return !q || s[0].toLowerCase().indexOf(q) !== -1; });
    var pages = Math.max(1, Math.ceil(list.length / PAGE));
    if (state.sPage > pages) state.sPage = pages;
    var slice = list.slice((state.sPage - 1) * PAGE, state.sPage * PAGE);
    $('tbl-schools').tBodies[0].innerHTML = slice.map(function (s) {
      return '<tr><td class="school">' + esc(s[0]) + '</td>' +
        '<td class="num">' + s[1] + '</td><td class="num">' + s[2] + '</td>' +
        '<td class="num">' + (s[3] == null ? '—' : s[3]) + '</td></tr>';
    }).join('') || '<tr><td colspan="4" style="text-align:center;color:#8b93a3">没有匹配的学校</td></tr>';
    renderPager($('s-pager'), state.sPage, pages, function (p) { state.sPage = p; renderSchools(); });
  }

  function ensureCareers() {
    if (state.careers) return Promise.resolve();
    $('tbl-careers').tBodies[0].innerHTML =
      '<tr><td colspan="6" style="text-align:center;color:#8b93a3">正在加载队伍生涯数据（约 2 MB）…</td></tr>';
    return getJson('data/careers.json').then(function (list) {
      state.careers = list;
      list.forEach(function (c) {
        careerMap.set(c[0] + '\u0000' + c[1], c);
        if (c[2] > 1) state.bestTeam = c;
      });
      var teams = list.length;
      list.forEach(function (c) { });
      $('st-teams').textContent = teams.toLocaleString();
      renderCareers();
    });
  }

  function renderCareers() {
    if (!state.careers) return;
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
      var hist = c[5].slice(0, 4).map(function (h) {
        var ct = state.contests[h[0]];
        return esc(ct.season + ' ' + ct.name) + ' · #' + h[1] + ' · ' + h[2] + '题';
      }).join('<br>');
      return '<tr data-school="' + esc(c[0]) + '" data-team="' + esc(c[1]) + '">' +
        '<td class="school">' + esc(c[0]) + '</td><td>' + esc(c[1]) + '</td>' +
        '<td class="num">' + c[2] + '</td><td class="num">' + c[3] + '</td>' +
        '<td class="num">' + c[4] + '</td><td class="members">' + hist + '</td></tr>';
    }).join('') || '<tr><td colspan="6" style="text-align:center;color:#8b93a3">没有匹配的队伍</td></tr>';
    renderPager($('c-pager'), state.cPage, pages, function (p) { state.cPage = p; renderCareers(); });
  }

  var CAREER_HEAD = '<tr><th>赛季</th><th>赛事</th><th class="num">名次</th><th class="num">过题</th><th class="num">罚时</th></tr>';
  var PEOPLE_HEAD = '<tr><th>赛季</th><th>赛事</th><th>队伍</th><th class="num">名次</th><th class="num">过题</th></tr>';

  function showModal(title, sub, head, body) {
    $('modal-title').textContent = title;
    $('modal-sub').textContent = sub;
    $('modal-head').innerHTML = head;
    $('tbl-modal').tBodies[0].innerHTML = body;
    $('modal').hidden = false;
  }

  function openCareer(school, team) {
    var c = careerMap.get(school + '\u0000' + team);
    if (!c) {
      showModal(team, school + ' · 生涯数据尚未加载，请切换到「队伍生涯」标签载入后再试', CAREER_HEAD, '');
      return;
    }
    var body = c[5].slice().sort(function (a, b) { return b[0] - a[0]; })
      .map(function (h) {
        var ct = state.contests[h[0]];
        return '<tr><td>' + esc(ct.season) + '</td><td>' + esc(ct.name) +
          (ct.women ? '<span class="tag tag-women">女生赛</span>' : '') + '</td>' +
          '<td class="num">' + h[1] + '</td><td class="num">' + h[2] + '</td>' +
          '<td class="num">' + h[3] + '</td></tr>';
      }).join('');
    showModal(team, school + ' · 参赛 ' + c[2] + ' 次 · 最佳名次 ' + c[3] + ' · 累计过题 ' + c[4],
      CAREER_HEAD, body);
  }

  // ---------- 选手检索 ----------

  function shardFor(name) { return name.charCodeAt(0) % 16; }

  function ensureShard(bucket) {
    if (state.shards[bucket]) return Promise.resolve(state.shards[bucket]);
    var file = 'data/people-' + ('0' + bucket).slice(-2) + '.json';
    return getJson(file).then(function (data) {
      state.shards[bucket] = data;
      return data;
    });
  }

  function renderPeople() {
    var q = state.pQ.trim();
    var tbody = $('tbl-people').tBodies[0];
    if (!q) {
      tbody.innerHTML = '';
      $('p-meta').textContent = '输入姓名开始检索；同名选手按学校区分，同一人在不同年份会合并。';
      return;
    }
    $('p-meta').textContent = '正在加载 ' + q + ' 所在的分片…';

    ensureShard(shardFor(q)).then(function (shard) {
      var names = Object.keys(shard).filter(function (n) { return n.indexOf(q) === 0; })
        .sort(function (a, b) {
          if (a === q && b !== q) return -1;
          if (b === q && a !== q) return 1;
          return a.length - b.length || a.localeCompare(b, 'zh-CN');
        });

      var results = [];
      names.forEach(function (n) {
        shard[n].forEach(function (entry) {
          var si = entry[0], hist = entry[1];
          var best = null, solved = 0;
          hist.forEach(function (h) {
            if (best === null || h[1] < best) best = h[1];
            solved += h[2];
          });
          results.push({ name: n, school: state.schools[si][0], hist: hist, best: best, solved: solved });
        });
      });

      if (!results.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#8b93a3">' +
          '没有找到以「' + esc(q) + '」开头的选手</td></tr>';
        $('p-meta').textContent = '未找到匹配选手。提示：从姓氏开始输入，如「张三」。';
        return;
      }

      results.sort(function (a, b) { return b.hist.length - a.hist.length || a.best - b.best; });
      var top = results.slice(0, 100);
      state.pResults = top;

      var nameCount = {};
      results.forEach(function (r) { nameCount[r.name] = (nameCount[r.name] || 0) + 1; });
      var conflicts = results.filter(function (r) { return nameCount[r.name] > 1; }).length;

      tbody.innerHTML = top.map(function (r, i) {
        var teams = [];
        r.hist.forEach(function (h) { if (teams.indexOf(h[3]) === -1) teams.push(h[3]); });
        return '<tr data-p="' + i + '">' +
          '<td class="school">' + esc(r.name) + '</td>' +
          '<td>' + esc(r.school) + '</td>' +
          '<td class="num">' + r.hist.length + '</td>' +
          '<td class="num">' + (r.best == null ? '—' : r.best) + '</td>' +
          '<td class="num">' + r.solved + '</td>' +
          '<td class="members">' + esc(teams.slice(0, 4).join('、')) +
          (teams.length > 4 ? ' 等' : '') + '</td></tr>';
      }).join('');

      $('p-meta').textContent = '「' + q + '」共 ' + results.length + ' 条选手记录' +
        (conflicts ? '（其中 ' + conflicts + ' 条姓名重复，已按学校区分）' : '') +
        (results.length > 100 ? ' · 仅显示前 100 条' : '');
    }).catch(showError);
  }

  function openPerson(r) {
    var body = r.hist.slice().sort(function (a, b) { return b[0] - a[0]; })
      .map(function (h) {
        var ct = state.contests[h[0]];
        return '<tr><td>' + esc(ct.season) + '</td><td>' + esc(ct.name) +
          (ct.women ? '<span class="tag tag-women">女生赛</span>' : '') + '</td>' +
          '<td>' + esc(h[3]) + '</td>' +
          '<td class="num">' + h[1] + '</td><td class="num">' + h[2] + '</td></tr>';
      }).join('');
    showModal(r.name, r.school + ' · 参赛 ' + r.hist.length + ' 次 · 最佳名次 ' + r.best +
      ' · 累计过题 ' + r.solved, PEOPLE_HEAD, body);
  }

  function bind() {
    document.querySelectorAll('.tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.tab').forEach(function (b) { b.classList.remove('active'); });
        document.querySelectorAll('.panel').forEach(function (p) { p.classList.remove('active'); });
        btn.classList.add('active');
        $('panel-' + btn.dataset.tab).classList.add('active');
        if (btn.dataset.tab === 'careers') ensureCareers().catch(showError);
        if (btn.dataset.tab === 'schools') renderSchools();
      });
    });

    $('f-season').addEventListener('change', function (e) {
      switchSeason(e.target.value).catch(showError);
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

    $('f-women').addEventListener('change', function (e) {
      state.womenOnly = e.target.checked;
      if (state.womenOnly && !seasonHasWomen(state.season)) {
        // 当前赛季没有女生赛，自动切到最近一个有女生赛的赛季
        var target = state.seasons.filter(function (s) {
          return state.contests.some(function (c) { return c.women && c.key === s.key; });
        })[0];
        if (target) {
          switchSeason(target.key).catch(showError);
          return;
        }
      }
      applyRows();
    });

    var pt;
    $('p-q').addEventListener('input', function (e) {
      clearTimeout(pt);
      pt = setTimeout(function () { state.pQ = e.target.value; renderPeople(); }, 220);
    });
    $('tbl-people').tBodies[0].addEventListener('click', function (e) {
      var tr = e.target.closest('tr');
      if (!tr || tr.dataset.p === undefined || tr.dataset.p === '') return;
      var person = state.pResults && state.pResults[+tr.dataset.p];
      if (person) openPerson(person);
    });

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
      openCareer(schoolName(r), r[5]);
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

  getJson('data/index.json').then(function (idx) {
    state.contests = idx.contests;
    state.schools = idx.schools;
    state.seasons = idx.seasons;
    state.counts = idx.counts;
    $('loading').style.display = 'none';
    bind();
    boot();
  }).catch(showError);
})();
