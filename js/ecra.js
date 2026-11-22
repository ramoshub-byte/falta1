/* Ecrã do clube — Falta 1
 * Página pública (sem conta) para pôr numa TV: ranking da época por divisão, torneio a decorrer e destaques.
 * Roda entre ecrãs e atualiza os dados a cada minuto.
 *  - modo demonstração: usa os dados deste browser (window.Backend local);
 *  - modo Supabase: chama a função pública public_screen() com a chave anon, sem sessão.
 * Ao vivo: quando há jogos a ser marcados na app, aparece o ecrã "Ao vivo" (atualiza a cada 5 s).
 * ecra.html?jogo=ID mostra só esse jogo, em grande — é o link que os jogadores partilham com quem está a ver.
 */
(function () {
  const { CLUBS } = window.PadelData;
  const Season = window.Season, Tournament = window.Tournament, Rating = window.Rating, Scorer = window.Scorer;
  const params = new URLSearchParams(location.search);
  const clubId = params.get('clube');
  const club = CLUBS.find(c => c.id === clubId) || null;
  const SECS = Math.max(5, Number(params.get('seg')) || 15);
  const ONLY = params.get('so');
  const cfg = window.PADEL_CONFIG || {};
  const DEMO = window.Backend.mode === 'local';
  const REFRESH_MS = 60000;
  const SINGLE = params.get('jogo');          // link de um jogo ao vivo
  const LIVE_MS = SINGLE ? 3000 : 5000;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const short = (name) => { if (!name) return null; const n = String(name).trim().split(/\s+/); return n.length > 1 ? `${n[0]} ${n[n.length - 1][0]}.` : n[0]; };
  const fmtDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' }); };
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const daysAgo = (iso) => (new Date(today()) - new Date(iso)) / 86400000;

  // ---------- dados ----------
  async function loadDemo() {
    const B = window.Backend;
    const [players, results, tournaments, profile] = await Promise.all([B.listPlayers(), B.listResults(), B.listTournaments(), B.getProfile()]);
    const list = players.map(p => ({ id: p.id, level: p.level, name: short(p.name) }));
    if (profile) list.push({ id: 'me', level: profile.level, name: profile.publicRanking === false ? null : short(profile.name) });
    return { players: list, results, tournaments };
  }
  let sb = null;
  function loadScript(src) {
    return new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Sem ligação ao servidor')); document.head.appendChild(s); });
  }
  async function client() {
    if (!sb) {
      if (!window.supabase) await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');
      const url = String(cfg.supabaseUrl).trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
      sb = window.supabase.createClient(url, cfg.supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    }
    return sb;
  }
  // Jogos a ser marcados agora (últimos 20 minutos).
  async function loadLive() {
    let list;
    if (DEMO) {
      list = (await window.Backend.listLiveScores()).map(l => ({ id: l.gameId, clubId: l.clubId, points: l.points || [], config: l.config || {},
        teamA: l.teamA || [], teamB: l.teamB || [], updatedAt: l.updatedAt }));
      if (club) list = list.filter(l => l.clubId === club.id);
    } else {
      const { data, error } = await (await client()).rpc('public_live_scores', { p_club: club ? club.id : null });
      if (error) throw new Error(error.message);
      list = (data || []).map(l => ({ id: l.game_id, clubId: l.club_id, points: l.points || [], config: l.config || {},
        teamA: l.team_a || [], teamB: l.team_b || [], updatedAt: l.updated_at }));
    }
    return SINGLE ? list.filter(l => l.id === SINGLE) : list;
  }
  async function loadRemote() {
    await client();
    const { data, error } = await sb.rpc('public_screen');
    if (error) throw new Error(error.message);
    return {
      players: (data.players || []).map(p => ({ id: p.id, level: Number(p.level), name: p.name })),
      results: (data.results || []).map(r => ({ id: r.id, date: r.play_date, teamA: r.team_a, teamB: r.team_b, sets: r.sets, winner: r.winner, tournamentId: r.tournament_id || undefined })),
      tournaments: (data.tournaments || []).map(t => ({ ...(t.data || {}), id: t.id, name: t.name, clubId: t.club_id, date: t.play_date, format: t.format, mode: t.mode, status: t.status }))
    };
  }

  function compute(d) {
    const year = new Date().getFullYear();
    const initialLevels = Object.fromEntries(d.players.map(p => [p.id, p.level]));
    const finished = d.tournaments.filter(t => t.status === 'terminado')
      .map(t => ({ id: t.id, name: t.name, date: t.date, clubId: t.clubId, placements: Tournament.placements(t) })).filter(t => t.placements);
    const season = Season.computeSeason({ year, results: d.results, initialLevels, tournaments: finished });
    const ratings = Rating.computeRatings({ initialLevels, results: d.results }).players;
    const names = Object.fromEntries(d.players.map(p => [p.id, p.name]));
    const nm = (id) => names[id] || 'Jogador';
    const team = (t) => (t || []).map(nm).join(' + ');
    const atClub = (t) => !club || t.clubId === club.id;
    // Torneios em destaque: a decorrer (no clube, se escolhido) ou terminados há menos de 7 dias.
    const featured = d.tournaments.filter(t => atClub(t) && (t.status === 'a decorrer' || (t.status === 'terminado' && daysAgo(t.date) <= 7)))
      .sort((a, b) => (a.status === 'a decorrer' ? 0 : 1) - (b.status === 'a decorrer' ? 0 : 1) || (a.date < b.date ? 1 : -1)).slice(0, 2);
    const champions = finished.filter(atClub).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 3)
      .map(t => ({ name: t.name, date: t.date, who: Object.entries(t.placements).filter(([, v]) => v === 'campeao').map(([id]) => nm(id)) }));
    return { year, season, ratings, nm, team, featured, champions };
  }

  // ---------- ecrãs ----------
  function rankingSlide(D) {
    const S = D.season;
    const col = (div) => `<section class="tv-col">
      <h2>${esc(div.name)}</h2>
      ${div.ranked.length ? `<ol class="tv-list">${div.ranked.slice(0, 10).map(r => `
        <li class="${r.position <= 3 ? 'top' : ''}"><span class="p">${r.position}</span>
          <span class="n">${esc(D.nm(r.id))}<small>${r.games} jogos · ${r.wins} ${r.wins === 1 ? 'vitória' : 'vitórias'}</small></span>
          <span class="pts">${r.points}</span></li>`).join('')}</ol>`
        : `<p class="tv-empty">Ainda ninguém tem ${S.rules.minGames} jogos nesta divisão.</p>`}
      ${div.ranked.length > 10 ? `<p class="tv-more">+ ${div.ranked.length - 10} jogadores</p>` : ''}
    </section>`;
    return { title: `Ranking da época ${D.year}`, html: `<div class="tv-cols">${S.divisions.map(col).join('')}</div>` };
  }

  function tournamentSlide(D, t) {
    const res = Tournament.resolve(t);
    const F = Tournament.FORMATS[t.format];
    const clubName = (CLUBS.find(c => c.id === t.clubId) || {}).short || '';
    const head = `<div class="tv-thead"><b>${esc(t.name)}</b><span>${fmtDate(t.date)}${clubName ? ' · ' + esc(clubName) : ''} · ${esc(F.label)}</span>
      <span class="tv-tag ${t.status === 'a decorrer' ? 'live' : ''}">${t.status === 'a decorrer' ? '● a decorrer' : 'terminado'}</span></div>`;
    if (t.status === 'terminado') {
      const pl = Tournament.placements(t) || {};
      const by = (p) => Object.entries(pl).filter(([, v]) => v === p).map(([id]) => D.nm(id)).join(' + ');
      return { title: 'Torneio', html: `${head}<div class="tv-podium">
        <div class="first"><span>🏆</span><b>${esc(by('campeao'))}</b><small>Campeão</small></div>
        <div><span>🥈</span><b>${esc(by('finalista'))}</b><small>Finalista</small></div></div>` };
    }
    const nextGames = res.playable.filter(m => !Tournament.isConfirmed(m)).slice(0, 6);
    const gamesHTML = nextGames.length ? `<ul class="tv-games">${nextGames.map(m => `<li>
        ${m.court && m.stage !== 'eliminatoria' ? `<span class="c">${m.stage === 'ronda' ? `R${m.round} · ` : ''}Campo ${m.court}</span>` : `<span class="c">${esc(m.stage === 'eliminatoria' ? Tournament.koRoundName(m.inRound) : 'Grupo ' + m.group)}</span>`}
        <span>${esc(D.team(m.teamA))}</span><i>vs</i><span>${esc(D.team(m.teamB))}</span></li>`).join('')}</ul>`
      : '<p class="tv-empty">À espera dos últimos resultados.</p>';
    let left;
    if (t.format === 'americano') {
      left = `<h2>Classificação</h2><ol class="tv-list">${Tournament.americanoStandings(t).slice(0, 10).map((r, i) => `
        <li class="${i < 3 ? 'top' : ''}"><span class="p">${i + 1}</span><span class="n">${esc(D.nm(r.id))}<small>${r.wins} ${r.wins === 1 ? 'vitória' : 'vitórias'}</small></span><span class="pts">${r.points}</span></li>`).join('')}</ol>`;
    } else if (t.groups) {
      left = t.groups.map(g => `<h2>Grupo ${g.name}</h2><ol class="tv-list compact">${res.groupTables[g.name].map((r, i) => `
        <li class="${i < 2 ? 'top' : ''}"><span class="p">${i + 1}</span><span class="n">${esc(D.team(r.team))}</span><span class="pts">${r.wins}V</span></li>`).join('')}</ol>`).join('');
    } else {
      const done = res.matches.filter(m => m.stage === 'eliminatoria' && Tournament.isConfirmed(m)).slice(-6);
      left = `<h2>Resultados</h2>${done.length ? `<ul class="tv-games">${done.map(m => `<li><span class="c">${esc(Tournament.koRoundName(m.inRound))}</span>
        <span class="${m.result.winner === 'a' ? 'w' : ''}">${esc(D.team(m.teamA))}</span><i>${m.result.sets.map(s => s.join('-')).join(' ')}</i><span class="${m.result.winner === 'b' ? 'w' : ''}">${esc(D.team(m.teamB))}</span></li>`).join('')}</ul>` : '<p class="tv-empty">Ainda sem resultados.</p>'}`;
    }
    return { title: 'Torneio', html: `${head}<div class="tv-two"><section class="tv-col">${left}</section><section class="tv-col"><h2>Próximos jogos</h2>${gamesHTML}</section></div>` };
  }

  // ---------- ao vivo ----------
  function liveCard(L, big) {
    const st = Scorer.compute(L.points, L.config);
    const pd = Scorer.pointDisplay(st);
    const sv = Scorer.server(st);
    const order = L.config.serveOrder || {};
    const serverId = sv && order[sv.team] ? order[sv.team][sv.idx] : null;
    const who = (p) => esc(p.name || 'Jogador');
    const teamHTML = (t) => (t === 'a' ? L.teamA : L.teamB).map(p =>
      `<span class="${p.id === serverId ? 'srv' : ''}">${who(p)}${p.id === serverId ? ' <i title="serve">🎾</i>' : ''}</span>`).join('<em>+</em>');
    const row = (t) => {
      const sets = st.sets.map(([a, b]) => `<td class="${(t === 'a' ? a > b : b > a) ? 'won' : ''}">${t === 'a' ? a : b}</td>`).join('');
      const cur = st.finished || st.superTiebreak ? '' : `<td class="cur">${st.games[t]}</td>`;
      const pts = st.finished ? '' : `<td class="pts">${t === 'a' ? pd.a : pd.b}</td>`;
      const win = st.finished && st.winner === t;
      return `<tr class="${t === 'a' ? 'ta' : 'tb'} ${win ? 'win' : ''} ${sv && sv.team === t ? 'serving' : ''}"><th>${win ? '🏆 ' : ''}${teamHTML(t)}</th>${sets}${cur}${pts}</tr>`;
    };
    const clubName = (CLUBS.find(c => c.id === L.clubId) || {}).short || '';
    const mins = Math.floor((Date.now() - Date.parse(L.updatedAt)) / 60000);
    const note = st.finished ? 'Fim do jogo' : st.changeEnds ? '↔ Troca de lado' : (pd.note || (sv ? `Serve da ${sv.side}` : ''));
    return `<div class="lv-card ${big ? 'big' : ''}">
      <div class="lv-head"><span class="tv-tag ${st.finished ? '' : 'live'}">${st.finished ? 'terminado' : '● ao vivo'}</span>
        <span>${esc([clubName, L.config.goldenPoint === false ? 'vantagens' : 'ponto de ouro', L.config.superTiebreak === false ? '3 sets' : 'super tie-break'].filter(Boolean).join(' · '))}</span>
        ${mins >= 2 && !st.finished ? `<span class="lv-age">atualizado há ${mins} min</span>` : ''}</div>
      <table class="lv-table">${row('a')}${row('b')}</table>
      <div class="lv-note ${st.changeEnds ? 'swap' : ''}">${esc(note) || '&nbsp;'}</div>
    </div>`;
  }
  function liveSlide() {
    const shown = live.slice(0, 4);
    return { title: 'Ao vivo', html: `<div class="lv-grid n${shown.length}">${shown.map(l => liveCard(l, shown.length === 1)).join('')}</div>
      ${live.length > 4 ? `<p class="tv-more">+ ${live.length - 4} jogos a decorrer</p>` : ''}` };
  }

  function highlightsSlide(D) {
    const L = D.season.leaders;
    const rows = (list, val) => list.slice(0, 5).map((r, i) => `<li class="${i === 0 ? 'top' : ''}"><span class="p">${i + 1}</span><span class="n">${esc(D.nm(r.id))}</span><span class="pts">${val(r)}</span></li>`).join('');
    const best = Object.values(D.season.rows).filter(r => r.games >= 5).sort((a, b) => b.winPct - a.winPct || b.games - a.games).slice(0, 5);
    return { title: `Destaques da época ${D.year}`, html: `<div class="tv-cols">
      <section class="tv-col"><h2>Mais vitórias</h2><ol class="tv-list">${rows(L.wins, r => r.wins)}</ol></section>
      <section class="tv-col"><h2>Mais jogos</h2><ol class="tv-list">${rows(L.games, r => r.games)}</ol></section>
      <section class="tv-col"><h2>Melhor % de vitórias</h2><ol class="tv-list">${rows(best, r => Math.round(r.winPct * 100) + '%')}</ol>
        <p class="tv-more">mínimo 5 jogos</p>
        ${D.champions.length ? `<h2 class="mt">Últimos campeões</h2><ul class="tv-champs">${D.champions.map(c => `<li>🏆 <b>${esc(c.who.join(' + '))}</b><small>${esc(c.name)} · ${fmtDate(c.date)}</small></li>`).join('')}</ul>` : ''}
      </section></div>` };
  }

  // ---------- ciclo ----------
  let data = null, slides = [], idx = 0, timer = null, started = false, live = [], currentKey = null;
  function buildSlides() {
    const all = [...(live.length ? [{ key: 'aovivo', make: liveSlide }] : []),
      { key: 'ranking', make: () => rankingSlide(data) },
      ...data.featured.map(t => ({ key: 'torneio', make: () => tournamentSlide(data, t) })),
      { key: 'destaques', make: () => highlightsSlide(data) }];
    slides = ONLY ? all.filter(s => s.key === ONLY) : all;
    if (!slides.length) slides = all.slice(0, 1);
  }
  function show() {
    currentKey = slides[idx % slides.length].key;
    const s = slides[idx % slides.length].make();
    $('tv-title').textContent = s.title;
    const main = $('tv-main');
    main.classList.remove('in'); void main.offsetWidth;
    main.innerHTML = s.html; main.classList.add('in');
    const bar = $('tv-bar');
    bar.style.transition = 'none'; bar.style.width = '0';
    if (slides.length > 1) { void bar.offsetWidth; bar.style.transition = `width ${SECS}s linear`; bar.style.width = '100%'; }
  }
  function next() { idx = (idx + 1) % slides.length; show(); }
  async function refresh(first) {
    try {
      data = compute(DEMO ? await loadDemo() : await loadRemote());
      buildSlides();
      if (!started) { started = true; show(); clearInterval(timer); timer = setInterval(next, SECS * 1000); }
      $('tv-join').innerHTML = `Atualizado às ${new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })} · Joga também: <b>${esc(appAddress())}</b>`;
    } catch (e) {
      console.error(e);
      if (!started) $('tv-main').innerHTML = `<div class="tv-msg">Sem ligação ao servidor. A tentar outra vez…</div>`;
    }
  }
  async function refreshLive() {
    try { live = await loadLive(); } catch (e) { console.error(e); return; }
    if (SINGLE) { renderSingle(); return; }
    if (!data) return;
    const hadLive = slides.some(s => s.key === 'aovivo');
    if (!!live.length !== hadLive) {
      const key = currentKey; buildSlides();
      idx = Math.max(0, slides.findIndex(s => s.key === key));
      if (live.length && !hadLive) { idx = 0; show(); clearInterval(timer); timer = setInterval(next, SECS * 1000); } // começou um jogo: mostra já
      else if (!live.length && key === 'aovivo') show();
    } else if (currentKey === 'aovivo') {
      $('tv-main').innerHTML = liveSlide().html; // atualiza sem animação
    }
  }
  function renderSingle() {
    $('tv-title').textContent = 'Ao vivo';
    $('tv-main').innerHTML = live.length ? liveCard(live[0], true)
      : '<div class="tv-msg">Este jogo não está a ser marcado agora.<br><small>O marcador aparece aqui quando um dos jogadores marcar pontos na app.</small></div>';
    $('tv-join').innerHTML = `Atualizado às ${new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · Joga também: <b>${esc(appAddress())}</b>`;
  }
  function appAddress() {
    const u = new URL('index.html', location.href);
    return (u.host + u.pathname).replace(/index\.html$/, '').replace(/\/$/, '') || u.host;
  }
  function rulesLine() {
    const r = Season.DEFAULT_RULES, c = r.casual, t = r.tournament;
    return `<b>Pontos:</b> vitória ${c.win} · derrota ${c.loss} · surpresa +${c.upsetBonus} · torneio: campeão ${t.campeao}, finalista ${t.finalista}, meias ${t.meias}, quartos ${t.quartos}, participação ${t.participacao} · Divisões pelo nível · mín. ${r.minGames} jogos`;
  }
  function clock() { $('tv-time').textContent = new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }); }

  // ecrã inteiro e cursor escondido quando parado
  const fullBtn = $('tv-full');
  fullBtn.addEventListener('click', () => { const el = document.documentElement; (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el); });
  let idle;
  document.addEventListener('mousemove', () => { document.body.classList.remove('idle'); clearTimeout(idle); idle = setTimeout(() => document.body.classList.add('idle'), 4000); });
  idle = setTimeout(() => document.body.classList.add('idle'), 4000);
  document.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') { next(); clearInterval(timer); timer = setInterval(next, SECS * 1000); } });

  $('tv-club').textContent = club ? club.short || club.name : (DEMO ? 'Demonstração' : 'Chaves');
  $('tv-rules').innerHTML = rulesLine();
  clock(); setInterval(clock, 10000);
  (async function boot() {
    try { await window.Backend.init(); } catch (e) { /* modo Supabase: o ecrã não precisa de sessão */ }
    if (SINGLE) {
      document.documentElement.classList.add('single');
      await refreshLive();
      setInterval(refreshLive, LIVE_MS);
      return;
    }
    try { live = await loadLive(); } catch (e) { console.error(e); }
    await refresh(true);
    setInterval(() => refresh(false), REFRESH_MS);
    setInterval(refreshLive, LIVE_MS);
    // modo demonstração: o marcador noutro separador do mesmo browser avisa logo
    if (DEMO) window.addEventListener('storage', (e) => { if (e.key === 'falta1:live') refreshLive(); });
  })();
})();
