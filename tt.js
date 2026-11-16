// Offseason Trade Tracker — shared by the control page (index.html) and the OBS display (display.html).
//  · data derivations from data.js (window.OTT_DATA)
//  · one graphic per view, drawn on a 1920×1080 stage inside the safe area between the host cams
//  · relay transport (Jomboy Cloudflare relay + BroadcastChannel), same as Savant Spotlight
'use strict';
const TT = (() => {
  const HUB_DEFAULT = 'https://jomboy-relay.jomboymedia.workers.dev';
  const SAFE_DEFAULT = { l: 400, t: 48, r: 1520, b: 895 };
  const CAMS = { top: 230, bottom: 805, video: { l: 165, t: 41, r: 1750, b: 901 } };

  // ── teams (keyed by the nickname the trade data uses) ──
  const TEAM_LIST = [
    [108,'LAA','#BA0021','Angels'],[109,'ARI','#A71930','Diamondbacks'],[110,'BAL','#DF4601','Orioles'],[111,'BOS','#BD3039','Red Sox'],
    [112,'CHC','#0E3386','Cubs'],[113,'CIN','#C6011F','Reds'],[114,'CLE','#0C2340','Guardians'],[115,'COL','#33006F','Rockies'],
    [116,'DET','#0C2340','Tigers'],[117,'HOU','#002D62','Astros'],[118,'KC','#004687','Royals'],[119,'LAD','#005A9C','Dodgers'],
    [120,'WSH','#AB0003','Nationals'],[121,'NYM','#002D72','Mets'],[133,'ATH','#003831','Athletics'],[134,'PIT','#27251F','Pirates'],
    [135,'SD','#2F241D','Padres'],[136,'SEA','#0C2C56','Mariners'],[137,'SF','#27251F','Giants'],[138,'STL','#C41E3A','Cardinals'],
    [139,'TB','#092C5C','Rays'],[140,'TEX','#003278','Rangers'],[141,'TOR','#134A8E','Blue Jays'],[142,'MIN','#002B5C','Twins'],
    [143,'PHI','#E81828','Phillies'],[144,'ATL','#13274F','Braves'],[145,'CWS','#27251F','White Sox'],[146,'MIA','#00A3E0','Marlins'],
    [147,'NYY','#0C2340','Yankees'],[158,'MIL','#12284B','Brewers'],
  ];
  const TEAMS = {}; TEAM_LIST.forEach(([id, abbr, color, name]) => TEAMS[name] = { id, abbr, color, name });
  const tm = n => TEAMS[n] || { id: 0, abbr: n, color: '#173a5e', name: n };
  const logo = n => `https://www.mlbstatic.com/team-logos/team-cap-on-light/${tm(n).id}.svg`;
  const logoDk = n => `https://www.mlbstatic.com/team-logos/team-cap-on-dark/${tm(n).id}.svg`;
  const headshot = (id, w = 360) => `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:silo:current.png/w_${w},q_auto:best/v1/people/${id}/headshot/silo/current`;

  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const lab = o => o.replace('-', '–');
  const short = o => '’' + o.slice(2).replace('-', '–');
  const fmt = (d, o = { month: 'short', day: 'numeric' }) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', o);
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // ── data ──
  const D = window.OTT_DATA;
  const ROWS = D.rows, OFF = ROWS.map(r => r.offseason), NOW = OFF[OFF.length - 1];
  const nowRow = ROWS[ROWS.length - 1], DONE = ROWS.slice(0, -1);
  const T = D.trades.map((t, i) => Object.assign(t, { i }));
  const doneT = T.filter(t => t.o !== NOW), nowT = T.filter(t => t.o === NOW);
  const hasMLB = t => t.q === 'yes';
  const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);

  const teamCount = {}; TEAM_LIST.forEach(x => teamCount[x[3]] = 0);
  doneT.forEach(t => new Set(t.g).forEach(g => teamCount[g] = (teamCount[g] || 0) + 1));
  const teamsSorted = Object.entries(teamCount).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const rankOf = g => 1 + teamsSorted.findIndex(([n, c]) => c > teamCount[g] ? false : true);
  const monCount = Array(12).fill(0), mlbMon = Array(12).fill(0);
  doneT.forEach(t => { const m = +t.d.slice(5, 7) - 1; monCount[m]++; if (hasMLB(t)) mlbMon[m]++; });
  const dayCount = {}; doneT.forEach(t => dayCount[t.d] = (dayCount[t.d] || 0) + 1);
  const topDays = Object.entries(dayCount).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 4);
  const bigDeals = []; T.forEach(t => t.p.forEach(p => { if (p[5] != null && p[5] >= 20) bigDeals.push({ t, p }); }));
  bigDeals.sort((a, b) => b.p[5] - a.p[5]);

  const F = {
    avg: Math.round(sum(DONE, r => r.trade_events) / DONE.length),
    busiest: DONE.reduce((a, b) => b.trade_events > a.trade_events ? b : a),
    pct: Math.round(100 * sum(DONE, r => r.headline_qualifying_min) / sum(DONE, r => r.trade_events)),
    mlbN: sum(DONE, r => r.headline_qualifying_min), doneN: doneT.length,
    preNY: monCount[9] + monCount[10] + monCount[11],
    top: teamsSorted[0],
    bigTrades: new Set(bigDeals.map(x => x.t)).size,
    pastPace: (() => { const p = D.matched.slice(0, -1).map(m => m.trades); return p.reduce((a, b) => a + b, 0) / p.length; })(),
  };
  F.preNYpct = Math.round(100 * F.preNY / F.doneN);

  // ── trade parsing: position, and who sent cash / PTBNL ──
  const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function posOf(t, name) { const m = t.s.match(new RegExp('\\b([A-Z0-9]{1,3}) ' + reEsc(name))); return m ? m[1] : ''; }
  const ALIAS = { Indians: 'Guardians', 'D-backs': 'Diamondbacks' };
  function sides(t) {
    const S = t.g.map(g => ({ team: g, gets: t.p.filter(p => p[3] === g), extras: [] }));
    const m = t.s.match(/^(.*?) traded (.*) to (.*?) for (.*?)\.?$/);
    if (m && t.g.length === 2) {
      const sender = t.g.find(g => m[1].endsWith(g) || Object.entries(ALIAS).some(([a, b]) => b === g && m[1].endsWith(a)));
      if (sender) {
        const recv = t.g.find(g => g !== sender);
        const kinds = s => [/\bcash\b/i.test(s) && 'Cash', /player to be named/i.test(s) && 'Player to be named', /future considerations/i.test(s) && 'Future considerations'].filter(Boolean);
        S.find(x => x.team === recv).extras = kinds(m[2]);
        S.find(x => x.team === sender).extras = kinds(m[4]);
      }
    }
    return S;
  }
  function headline(t) {
    if (!t.p.length) return t.g.join(' / ');
    const pick = t.p.slice().sort((a, b) => (b[5] || 0) - (a[5] || 0) || (a[4] === 1 ? -1 : 0) - (b[4] === 1 ? -1 : 0))[0];
    return pick[0];
  }

  // ════════════════════════════════════════════════════════════════════
  //  VIEWS — each returns { kick, title, logo?, body, say }
  // ════════════════════════════════════════════════════════════════════
  const lg = (g, cls = '') => `<img class="${cls}" src="${logo(g)}" alt="">`;
  const tradeRow = t => `<div class="tr"><div class="dt">${fmt(t.d)}<small>${t.d.slice(0, 4)}</small></div><div class="lg2">${t.g.map(g => lg(g)).join('')}</div><div class="s">${esc(t.s)}</div></div>`;
  const face = (id, team, cls = 'hs') => `<div class="${cls}" style="--tc:${tm(team).color}"><img src="${headshot(id)}" alt=""></div>`;

  function vFact(n) {
    const B = F.busiest;
    const facts = {
      1: { big: F.avg, u: '', lbl: 'Trades a winter', line: `Teams make about ${F.avg} trades between the World Series and Opening Day. Last winter set the high with ${B.trade_events}.`,
        say: `About ${F.avg} trades a winter, and last year blew past that with ${B.trade_events}.`,
        strip: `<div class="strip box">${ROWS.map(r => `<div class="mini ${r.offseason === NOW ? 'hot' : ''}"><b>${r.trade_events}</b><i style="height:${Math.round(70 * r.trade_events / B.trade_events)}px"></i><span>${short(r.offseason)}${r.offseason === NOW ? ' so far' : ''}</span></div>`).join('')}</div>` },
      2: { big: F.pct, u: '%', lbl: 'Move a big leaguer', line: `${F.mlbN} of ${F.doneN} winter trades included somebody who was on a big-league roster the season before.`,
        say: `Four out of five winter trades move an actual big leaguer.`,
        strip: `<div class="strip box"><div class="split"><div class="bar"><div style="flex:${F.mlbN};background:var(--gold);color:var(--ink)">${F.mlbN} with a big leaguer</div><div style="flex:${F.doneN - F.mlbN};background:var(--slate)">${F.doneN - F.mlbN}</div></div><div class="lg"><span>Last five full winters</span><span>${F.doneN} trades</span></div></div></div>` },
      3: { big: F.preNYpct, u: '%', lbl: 'Done before New Year’s', line: `November and December do half the work. The busiest single days land in mid-November, right around MLB's roster deadlines.`,
        say: `Half of all winter trades are done before the ball drops on New Year's.`,
        strip: `<div class="strip box"><div class="split"><div class="bar"><div style="flex:${F.preNY};background:var(--navy)">Oct–Dec · ${F.preNY}</div><div style="flex:${F.doneN - F.preNY};background:var(--slate)">Jan–Apr · ${F.doneN - F.preNY}</div></div><div class="lg"><span>Before New Year’s</span><span>After</span></div></div></div>` },
      4: { big: F.top[1], u: '', lbl: `Trades for the ${F.top[0]}`, line: `The ${F.top[0]} were in on ${F.top[1]} of the ${F.doneN} trades over the last five full winters, way more than anybody else.`,
        say: `The ${F.top[0]} are in on one of every ${Math.round(F.doneN / F.top[1])} winter trades.`,
        strip: `<div class="strip box"><div class="logoRow">${teamsSorted.slice(0, 6).map(([g, c]) => `<div>${lg(g)}<b>${c}</b></div>`).join('')}</div></div>` },
      5: { big: F.bigTrades, u: '', lbl: '$20M-a-year guys moved', line: `In five full winters, only ${F.bigTrades} trades we could verify moved a player making $20M or more a year. Blockbusters are rare.`,
        say: `Big-contract winter trades? About one a year.`,
        strip: `<div class="strip box"><div class="faceRow">${bigDeals.map(({ p }) => `<div>${face(p[1], p[3])}<span>${esc(p[0].split(' ').slice(-1)[0])}</span></div>`).join('')}</div></div>` },
    }[n];
    return { kick: `Talking point ${n} of 5`, title: 'The short version', say: facts.say,
      body: `<div class="fact"><div class="main box"><div class="big">${facts.big}<small>${facts.u}</small></div><div class="lbl">${esc(facts.lbl)}</div><div class="line">${esc(facts.line)}</div></div>${facts.strip}</div>` };
  }

  function vNow() {
    const list = nowT.slice().reverse(), shown = list.slice(0, 7);
    const pace = nowT.length > F.pastPace + 1 ? 'ahead of' : nowT.length < F.pastPace - 1 ? 'behind' : 'right on';
    return { kick: `${lab(NOW)} · through ${fmt(nowRow.window_end)}`, title: `${nowT.length} trades so far`,
      say: `${nowT.length} trades since the World Series. That's ${pace} the usual pace for mid-November.`,
      body: `<div class="box rows">${shown.map(tradeRow).join('') || '<div class="empty">No trades yet</div>'}${list.length > shown.length ? `<div class="moreN">+ ${list.length - shown.length} more</div>` : ''}</div>` };
  }

  function vPace() {
    const M = D.matched, mx = Math.max(...M.map(m => m.trades));
    const pace = nowT.length > F.pastPace + 1 ? 'ahead of' : nowT.length < F.pastPace - 1 ? 'behind' : 'right on';
    return { kick: 'This winter vs. every winter', title: `Trades by ${fmt(nowRow.window_end, { month: 'long', day: 'numeric' })}`,
      say: `Through ${fmt(nowRow.window_end, { month: 'long', day: 'numeric' })} we're at ${nowT.length}. The average at this point is ${F.pastPace.toFixed(1)}, so we're ${pace} pace.`,
      body: `<div class="box hbars">${M.map(m => `<div class="hb ${m.offseason === NOW ? 'hot' : ''}"><span>${lab(m.offseason)}</span><div class="t"><i style="width:${100 * m.trades / mx}%"></i></div><span class="v">${m.trades}</span></div>`).join('')}
        <div class="note">Each winter counted from the day after the World Series through the same date. Average: <b>${F.pastPace.toFixed(1)}</b>.</div></div>` };
  }

  function vWinters() {
    const mx = Math.max(...ROWS.map(r => r.trade_events));
    return { kick: 'Every trade between MLB clubs', title: 'Trades per winter',
      say: `Last winter was the busiest of the bunch: ${F.busiest.trade_events} trades. The lockout winter only had ${ROWS[0].trade_events}.`,
      body: `<div class="box" style="height:100%;padding:26px 30px 20px;display:flex;flex-direction:column">
        <div class="vbars" style="flex:1;min-height:0">${ROWS.map(r => `<div class="vb ${r.offseason === NOW ? 'hot' : ''}"><b>${r.trade_events}</b><i style="height:${86 * r.trade_events / mx}%">${r.offseason === NOW ? '' : `<u style="height:${100 * r.headline_qualifying_min / r.trade_events}%"></u>`}</i></div>`).join('')}</div>
        <div class="vlab">${ROWS.map(r => `<span>${short(r.offseason)}<small>${r.offseason === NOW ? 'so far' : r.offseason === '2021-22' ? 'lockout' : '&nbsp;'}</small></span>`).join('')}</div>
        <div class="key" style="margin-top:16px"><span><i style="background:var(--navy)"></i>All trades</span><span><i style="background:var(--gold)"></i>Had a big leaguer</span><span><i style="background:var(--red)"></i>This winter</span></div></div>` };
  }

  function vMonths() {
    const MO = [10, 11, 0, 1, 2, 3];
    const c = i => i === 10 ? monCount[9] + monCount[10] : monCount[i], cm = i => i === 10 ? mlbMon[9] + mlbMon[10] : mlbMon[i];
    const mx = Math.max(...MO.map(c));
    return { kick: 'All five full winters combined', title: 'When the deals happen',
      say: `November and December are trade season. The busiest days line up with the mid-November roster deadlines.`,
      body: `<div style="height:100%;display:flex;flex-direction:column;gap:16px"><div class="box" style="flex:1;min-height:0;padding:22px 30px 16px;display:flex;flex-direction:column">
        <div class="vbars" style="flex:1;min-height:0">${MO.map(i => `<div class="vb"><b>${c(i)}</b><i style="height:${86 * c(i) / mx}%"><u style="height:${100 * cm(i) / c(i)}%"></u></i></div>`).join('')}</div>
        <div class="vlab">${MO.map(i => `<span>${MON[i]}<small>${i === 10 ? '+ late Oct' : '&nbsp;'}</small></span>`).join('')}</div></div>
        <div class="callout"><b>The mid-November rush</b>Busiest days: ${topDays.map(([d, n]) => `${fmt(d, { month: 'short', day: 'numeric', year: 'numeric' })} (${n})`).join(' · ')}. Clubs clear 40-man spots around the Rule 5 protection and non-tender deadlines.</div></div>` };
  }

  function vTeams() {
    const mx = F.top[1];
    return { kick: 'Trades each club was part of · last five full winters', title: 'Trade machines',
      say: `The ${F.top[0]} lead everybody with ${F.top[1]}. The ${teamsSorted[29][0]} made the fewest: ${teamsSorted[29][1]}.`,
      body: `<div class="box tgrid">${teamsSorted.map(([g, n], i) => `<div class="trow ${i < 3 ? 'top' : ''}"><span class="rk">${i + 1}</span>${lg(g)}<span>${esc(g)}</span><div class="t"><i style="width:${100 * n / mx}%"></i></div><span class="v">${n}</span></div>`).join('')}</div>` };
  }

  function vMoney() {
    return { kick: 'Verified contracts of $20M+ per year', title: 'The big-money moves',
      say: `Only ${F.bigTrades} winter trades we could verify moved a $20M-a-year player. ${[...new Set(bigDeals.map(x => x.p[0].split(' ').slice(-1)[0]))].slice(0, 4).join(', ')}, that's the club.`,
      body: `<div class="mgrid">${bigDeals.map(({ t, p }) => `<div class="box mcard"><div class="ph" style="--tc:${tm(p[3]).color}"><img class="hs" src="${headshot(p[1])}" alt=""><div class="lgs"><img src="${logo(p[2])}" alt="">→<img src="${logo(p[3])}" alt=""></div></div><div class="nf"><div class="nm">${esc(p[0])}</div><div class="aav">$${p[5].toFixed(1)}M<small>/ yr</small></div><div class="dt">${fmt(t.d, { month: 'short', day: 'numeric', year: 'numeric' })}</div></div></div>`).join('')}
        ${bigDeals.length < 8 ? `<div class="sum"><b>${F.bigTrades}</b><span>trades in five full winters moved a $20M-a-year player</span></div>` : ''}</div>` };
  }

  function chips(p) {
    const c = [];
    if (p[4] === 1) c.push('<span class="chip mlb">Big leaguer</span>');
    else if (p[4] === 2) c.push('<span class="chip f40">40-man</span>');
    if (p[5] != null && p[5] >= 1) c.push(`<span class="chip aav">$${p[5].toFixed(1)}M / yr</span>`);
    return c.join('');
  }
  function vTrade(S) {
    const t = T[S.ti];
    if (!t) return { kick: 'Trade card', title: 'Pick a trade', say: 'Pick a trade from the list on the left.', body: '<div class="empty">Pick a trade from the list</div>' };
    const sd = sides(t), n3 = sd.length > 2;
    const side = x => {
      const items = x.gets.length + x.extras.length, dense = items > (n3 ? 3 : 4);
      return `<div class="side box ${n3 ? 'n3' : ''} ${dense ? 'dense' : ''}" style="--tc:${tm(x.team).color}"><div class="sh"><img src="${logoDk(x.team)}" alt=""><span><small>Receive</small>${esc(x.team)}</span></div><div class="ls">
        ${x.gets.map(p => `<div class="pl">${face(p[1], x.team)}<div><div class="ps">${esc(posOf(t, p[0]))}${n3 ? ` · from ${esc(p[2])}` : ''}</div><div class="nm ${p[0].length > 17 ? 'long' : ''}">${esc(p[0])}</div><div class="tg">${chips(p)}</div></div></div>`).join('')}
        ${x.extras.map(e => `<div class="xtra"><i>${e === 'Cash' ? '$' : '?'}</i>${esc(e)}</div>`).join('')}
        ${!items ? '<div class="xtra"><i>–</i>Nothing named</div>' : ''}</div></div>`;
    };
    const big = t.p.find(p => p[5] != null && p[5] >= 20);
    return { kick: `${lab(t.o)} offseason · ${fmt(t.d, { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })}`,
      title: t.g.join(' ↔ '), long: t.g.join('').length > 22,
      say: `${t.s}${big ? ` ${big[0]} was making $${big[5].toFixed(1)}M a year.` : ''}`,
      body: `<div class="tc"><div class="sides">${sd.map(side).join('')}</div><div class="box desc">${esc(t.s)}</div></div>` };
  }

  function vTeam(S) {
    const g = S.team;
    if (!g || !TEAMS[g]) return { kick: 'Team card', title: 'Pick a team', say: 'Pick a team from the list on the left.', body: '<div class="empty">Pick a team from the list</div>' };
    const mine = T.filter(t => t.g.includes(g)), done = mine.filter(t => t.o !== NOW);
    const per = ROWS.map(r => mine.filter(t => t.o === r.offseason).length), mx = Math.max(1, ...per);
    const part = {}; done.forEach(t => t.g.forEach(o => { if (o !== g) part[o] = (part[o] || 0) + 1; }));
    const partners = Object.entries(part).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3);
    const rk = rankOf(g), last = mine.slice().sort((a, b) => b.d.localeCompare(a.d)).slice(0, 3);
    return { kick: 'Offseason trades · since 2021–22', title: `${g}`, logo: g,
      say: `The ${g} have made ${done.length} winter trades in the last five full offseasons, #${rk} in baseball.${partners[0] ? ` Favorite partner: the ${partners[0][0]} (${partners[0][1]}).` : ''}`,
      body: `<div class="tm"><div class="id" style="--tc:${tm(g).color}"><img src="${logoDk(g)}" alt=""><b>${done.length}</b><span>trades in five<br>full winters</span><div class="rk">#${rk} of 30</div></div>
        <div class="box ch"><h4>Trades per winter</h4><div class="vbars">${ROWS.map((r, i) => `<div class="vb ${r.offseason === NOW ? 'hot' : ''}"><b>${per[i]}</b><i style="height:${per[i] ? 82 * per[i] / mx : 0}%"></i></div>`).join('')}</div><div class="vlab">${ROWS.map(r => `<span>${short(r.offseason)}</span>`).join('')}</div></div>
        <div class="box pt"><h4>Favorite trade partners</h4><div class="pp">${partners.map(([o, n]) => `<div>${lg(o)}${esc(o)} <small>${n}</small></div>`).join('') || '<small>None</small>'}</div>
          <h4 style="margin-top:14px">Latest</h4><div class="last">${last.map(t => `<div><b>${fmt(t.d, { month: 'short', day: 'numeric', year: '2-digit' })}</b>${esc(t.s)}</div>`).join('')}</div></div></div>` };
  }

  const VIEWS = [
    { key: 'f1', grp: 'Talking points', label: 'Trades a winter', fn: () => vFact(1) },
    { key: 'f2', grp: 'Talking points', label: 'Big leaguers', fn: () => vFact(2) },
    { key: 'f3', grp: 'Talking points', label: 'Before New Year’s', fn: () => vFact(3) },
    { key: 'f4', grp: 'Talking points', label: 'Top dealer', fn: () => vFact(4) },
    { key: 'f5', grp: 'Talking points', label: '$20M guys', fn: () => vFact(5) },
    { key: 'now', grp: 'This winter', label: 'Trades so far', fn: vNow },
    { key: 'pace', grp: 'This winter', label: 'Pace', fn: vPace },
    { key: 'winters', grp: 'History', label: 'Per winter', fn: vWinters },
    { key: 'months', grp: 'History', label: 'By month', fn: vMonths },
    { key: 'teams', grp: 'History', label: 'Trade machines', fn: vTeams },
    { key: 'money', grp: 'History', label: 'Big money', fn: vMoney },
    { key: 'trade', grp: 'From the list', label: 'Trade card', fn: vTrade },
    { key: 'team', grp: 'From the list', label: 'Team card', fn: vTeam },
  ];
  const viewOf = k => VIEWS.find(v => v.key === k) || VIEWS[0];
  const build = S => viewOf(S.view).fn(S);

  // ════════════════════════════════════════════════════════════════════
  //  STAGE
  // ════════════════════════════════════════════════════════════════════
  function createStage(host) {
    const el = document.createElement('div');
    el.className = 'stage off';
    el.innerHTML = '<div class="backdrop"></div><div class="panel"><div class="hd"></div><div class="bd"></div></div>';
    host.appendChild(el);
    const panel = el.querySelector('.panel'), hd = el.querySelector('.hd'), bd = el.querySelector('.bd');
    let lastKey = '';
    function render(S) {
      const sf = Object.assign({}, SAFE_DEFAULT, S.safe || {});
      Object.assign(panel.style, { left: sf.l + 'px', top: sf.t + 'px', width: (sf.r - sf.l) + 'px', height: (sf.b - sf.t) + 'px' });
      el.classList.toggle('off', !S.on);
      el.classList.toggle('clear', S.bg === 'clear');
      const v = build(S);
      const key = [S.view, S.ti, S.team].join('|');
      hd.innerHTML = `${v.logo ? `<img src="${logoDk(v.logo)}" alt="">` : ''}<div class="tx"><div class="kick">${esc(v.kick)}</div><div class="ttl ${v.long ? 'long' : ''}">${esc(v.title)}</div></div><div class="brand">Talkin' Baseball<br>Offseason Trade Tracker</div>`;
      if (key !== lastKey) { bd.innerHTML = `<div class="vw in" style="height:100%">${v.body}</div>`; lastKey = key; }
      return v;
    }
    return { el, render };
  }

  // ════════════════════════════════════════════════════════════════════
  //  TRANSPORT
  // ════════════════════════════════════════════════════════════════════
  function hubOf(params) { return (params.get('hub') || HUB_DEFAULT).replace(/\/$/, ''); }
  function publisher(hub, getRoom, onStatus) {
    let bc = null, bcRoom = null, inflight = 0;
    return async payload => {
      const room = getRoom();
      if (bcRoom !== room) { try { bc && bc.close(); bc = new BroadcastChannel('ott-' + room); bcRoom = room; } catch { bc = null; } }
      try { bc && bc.postMessage(payload); } catch {}
      const my = ++inflight;
      onStatus('sending…', '');
      try {
        const r = await fetch(`${hub}/r/${encodeURIComponent(room)}`, { method: 'POST', body: JSON.stringify(payload), signal: AbortSignal.timeout(6000) });
        const j = await r.json().catch(() => ({}));
        if (my !== inflight) return;
        if (!r.ok) throw new Error('HTTP ' + r.status);
        onStatus(`sent · ${j.sent ?? 0} screen${j.sent === 1 ? '' : 's'} connected`, 'ok');
      } catch {
        if (my === inflight) onStatus('relay unreachable — OBS will not update', 'bad');
      }
    };
  }
  function subscribe(hub, room, apply) {
    try { new BroadcastChannel('ott-' + room).onmessage = e => apply(e.data); } catch {}
    const url = `${hub}/r/${encodeURIComponent(room)}`;
    let backoff = 2000;
    const open = () => {
      try {
        const ws = new WebSocket(url.replace(/^http/, 'ws'));
        ws.onopen = () => { backoff = 2000; };
        ws.onmessage = ev => { try { apply(JSON.parse(ev.data)); } catch {} };
        ws.onclose = () => { setTimeout(open, backoff); backoff = Math.min(backoff * 2, 30000); };
      } catch { setTimeout(open, backoff); }
    };
    open();
    const poll = async () => {
      try {
        const r = await fetch(url + '?t=' + Date.now(), { cache: 'no-store', signal: AbortSignal.timeout(6000) });
        const t = await r.text();
        if (t && t !== 'null') apply(JSON.parse(t));
      } catch {}
    };
    poll();
    setInterval(poll, 30000);
  }

  return { SAFE_DEFAULT, CAMS, TEAMS, TEAM_LIST, tm, logo, logoDk, headshot, esc, lab, short, fmt, ROWS, OFF, NOW, T, teamCount, teamsSorted, rankOf,
    hasMLB, headline, VIEWS, viewOf, createStage, hubOf, publisher, subscribe };
})();
