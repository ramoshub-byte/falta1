/* Falta 1 — app (piloto Chaves)
 * Os dados passam todos por window.Backend (js/backend.js):
 *  - modo demonstração: neste browser, com jogadores fictícios;
 *  - modo Supabase: contas reais, convites e feedback partilhados.
 */
(function () {
  const { CITY_CENTER, DAYS, BLOCKS, LEVELS, CLUBS } = window.PadelData;
  const { suggestMatches, haversineKm } = window.Matchmaking;
  const Rating = window.Rating, Scorer = window.Scorer, Season = window.Season, Tournament = window.Tournament;
  const B = window.Backend;
  const DEMO = B.mode === 'local';

  // Preferências da interface (modo sozinho/dupla, parceiro) — ficam sempre neste dispositivo.
  const prefs = {
    get() { try { return JSON.parse(localStorage.getItem('falta1:prefs')) || {}; } catch (e) { return {}; } },
    set(v) { try { localStorage.setItem('falta1:prefs', JSON.stringify(v)); } catch (e) { /* sem armazenamento */ } }
  };

  const state = {
    profile: null,
    prefs: prefs.get(),
    players: [],
    clubStats: {},
    results: null,
    picked: null,
    pickedClubId: null,
    feedbackGame: null,
    justCreated: null,
    scoreGame: null,
    ratings: { players: {}, pairs: {} },
    maps: []
  };

  // ---------- utilitários ----------
  const $view = document.getElementById('view');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const km = (n) => n.toLocaleString('pt-PT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' km';
  const lvl = (n) => Number(n).toLocaleString('pt-PT', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  const stars = (n) => n.toLocaleString('pt-PT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
  const levelText = (n) => LEVELS[Math.min(7, Math.floor(n))][1];
  const sideText = { direita: 'Direita', esquerda: 'Esquerda', ambos: 'Ambos os lados' };
  const myId = () => (B.user() || {}).id;
  const isMe = (p) => p && p.id === myId();
  const firstName = (p) => isMe(p) ? 'Tu' : String(p.name).split(' ')[0];
  const clubById = (id) => CLUBS.find(c => c.id === id) || { name: id, short: id, bookingUrl: '#' };

  function slotLabel(slot) {
    const [d, b] = slot.split('-');
    const day = DAYS.find(x => x.id === d), block = BLOCKS.find(x => x.id === b);
    return { day: day ? day.label : d, block: block ? block.label : b, hours: block ? block.hours : '' };
  }
  const pad = (n) => String(n).padStart(2, '0');
  const isoDate = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  function nextDateISO(slot) {
    const idx = DAYS.findIndex(d => d.id === slot.split('-')[0]); // 0 = seg
    const today = new Date(); const jsDay = (today.getDay() + 6) % 7;
    const dt = new Date(today); dt.setDate(today.getDate() + ((idx - jsDay + 7) % 7));
    return isoDate(dt);
  }
  function fmtDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' });
  }
  const isPastOrToday = (iso) => iso <= isoDate(new Date());

  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2800);
  }
  // Desativa o botão enquanto a ação corre e mostra o erro, se houver.
  async function busy(btn, fn) {
    const label = btn.innerHTML; btn.disabled = true; btn.innerHTML = 'Um momento…';
    try { return await fn(); }
    catch (e) { toast(e.message || 'Algo correu mal'); throw e; }
    finally { if (btn.isConnected) { btn.disabled = false; btn.innerHTML = label; } }
  }
  const loading = (msg) => { $view.innerHTML = `<div class="loading">${esc(msg || 'A carregar…')}</div>`; };

  // ---------- nível calculado pelos resultados ----------
  // O nível do perfil é a autoavaliação (ponto de partida). Depois do primeiro resultado confirmado,
  // a app passa a usar o nível calculado (js/rating.js) no matchmaking e no ranking.
  const ratingOf = (id) => state.ratings.players[id];
  function effLevel(id, declared) { const r = ratingOf(id); return r && r.games > 0 ? r.level : declared; }
  async function loadPlayersAndRatings() {
    const [players, results] = await Promise.all([B.listPlayers(), B.listResults()]);
    const initialLevels = Object.fromEntries(players.map(p => [p.id, p.level]));
    if (state.profile) initialLevels[myId()] = state.profile.level;
    state.ratings = Rating.computeRatings({ initialLevels, results });
    state.allResults = results; state.initialLevels = initialLevels;
    state.players = players.map(p => ({ ...p, declaredLevel: p.level, level: effLevel(p.id, p.level) }));
    return state.players;
  }
  const myLevel = () => effLevel(myId(), state.profile.level);

  function meAsPlayer() {
    const p = state.profile;
    return { id: myId(), name: p.name, level: myLevel(), side: p.side, lat: p.lat, lng: p.lng,
      availability: p.availability, radiusKm: p.radiusKm, pairId: null, reliability: 0.8 };
  }
  const clubsWithStats = () => CLUBS.map(c => {
    const s = state.clubStats[c.id];
    return s ? { ...c, rating: s.overall, ratingCount: s.count } : { ...c };
  });
  const trustedBadge = (p) => p && p.trusted ? '<span class="trusted" title="Jogador fiável">✓ fiável</span>' : '';
  const appUrl = () => location.href.split('#')[0];

  // ---------- mapas ----------
  function clearMaps() { state.maps.forEach(m => m.remove()); state.maps = []; }
  function makeMap(el, center, zoom) {
    if (!window.L) { el.innerHTML = '<div class="map-fallback">O mapa precisa de ligação à internet.</div>'; return null; }
    const map = L.map(el).setView([center.lat, center.lng], zoom);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19, subdomains: 'abcd', attribution: '&copy; OpenStreetMap &copy; CARTO'
    }).addTo(map);
    state.maps.push(map);
    setTimeout(() => map.invalidateSize(), 50);
    return map;
  }
  const pinIcon = (label, cls) => L.divIcon({ className: '', html: `<div class="pin ${cls}"><span>${esc(label)}</span></div>`, iconSize: [34, 42], iconAnchor: [17, 40] });
  const dotIcon = (label, cls) => L.divIcon({ className: '', html: `<div class="dot ${cls}">${esc(label)}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] });

  // ---------- router ----------
  const routes = { entrar: renderEntrar, jogar: renderJogar, campo: renderCampo, jogos: renderJogos,
    feedback: renderFeedback, marcador: renderMarcador, perfil: renderPerfil, jogadores: renderJogadores,
    torneios: renderTorneios, 'torneio-novo': renderTorneioNovo, torneio: renderTorneio };
  let routeParam = null; // ex.: #torneio/ID → name 'torneio', routeParam 'ID'
  function route() {
    let [name, param] = (location.hash || '').slice(1).split('/');
    routeParam = param ? decodeURIComponent(param) : null;
    if (!B.user()) name = 'entrar';
    else if (name === 'entrar' || !routes[name]) name = state.profile ? 'jogar' : 'perfil';
    else if (!state.profile && name !== 'perfil') name = 'perfil';
    clearMaps();
    document.body.classList.toggle('no-tabs', name === 'entrar' || name === 'marcador');
    document.body.classList.toggle('scoring', name === 'marcador');
    if (name !== 'marcador') { releaseWakeLock(); exitFullscreen(); }
    document.querySelectorAll('.tabs a').forEach(a => a.classList.toggle('active',
      a.dataset.tab === name || (name === 'campo' && a.dataset.tab === 'jogar') || ((name === 'feedback' || name === 'marcador') && a.dataset.tab === 'jogos')
      || ((name === 'torneio' || name === 'torneio-novo') && a.dataset.tab === 'torneios')));
    Promise.resolve(routes[name]()).catch(e => { console.error(e); $view.innerHTML = `<div class="card empty"><p>${esc(e.message)}</p><button class="btn" onclick="location.reload()">Tentar outra vez</button></div>`; });
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  const go = (name) => { if (location.hash === '#' + name) route(); else location.hash = name; };

  // ---------- ENTRAR ----------
  function renderEntrar() {
    let signup = false;
    function draw() {
      $view.innerHTML = `
        <section class="hero">
          <h1>Quatro jogadores.<br>Um campo.<br><em>Zero mensagens.</em></h1>
          <p>Diz-nos o teu nível, quando podes jogar e onde estás. Nós juntamos a parceria, os adversários e sugerimos o campo.</p>
        </section>
        <form id="auth" class="card" novalidate>
          <h2>${signup ? 'Criar conta' : 'Entrar'}</h2>
          <label class="field"><span>Email</span><input id="a-email" type="email" autocomplete="email" required></label>
          <label class="field"><span>Palavra-passe</span><input id="a-pass" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="6" required></label>
          <p id="a-err" class="error" hidden></p>
          <button class="btn primary big" type="submit">${signup ? 'Criar conta' : 'Entrar'}</button>
          <p class="center small">${signup ? 'Já tens conta?' : 'Primeira vez?'} <a href="#" id="a-toggle" class="link">${signup ? 'Entrar' : 'Criar conta'}</a></p>
        </form>`;
      document.getElementById('a-toggle').addEventListener('click', (e) => { e.preventDefault(); signup = !signup; draw(); });
      document.getElementById('auth').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('a-email').value.trim(), pass = document.getElementById('a-pass').value;
        const err = document.getElementById('a-err'); err.hidden = true;
        if (!email || pass.length < 6) { err.textContent = 'Escreve o email e uma palavra-passe com pelo menos 6 caracteres.'; err.hidden = false; return; }
        const btn = e.target.querySelector('button[type=submit]');
        try {
          await busy(btn, async () => {
            if (signup) {
              const r = await B.signUp(email, pass);
              if (r.needsConfirmation) { err.textContent = 'Conta criada! Confirma o email que te enviámos e depois entra.'; err.hidden = false; signup = false; return; }
            } else {
              await B.signIn(email, pass);
            }
            state.profile = await B.getProfile();
            go(state.profile ? 'jogar' : 'perfil');
          });
        } catch (x) { err.textContent = x.message; err.hidden = false; }
      });
    }
    draw();
  }

  // ---------- JOGAR ----------
  async function renderJogar() {
    const p = state.profile, pf = state.prefs;
    if (!state.players.length) { loading('A procurar jogadores…'); await loadPlayersAndRatings(); }
    const partnerOpts = state.players.slice().sort((a, b) => a.name.localeCompare(b.name, 'pt'))
      .map(x => `<option value="${x.id}" ${pf.partnerId === x.id ? 'selected' : ''}>${esc(x.name)} · ${lvl(x.level)}</option>`).join('');
    const few = state.players.length < 3;

    $view.innerHTML = `
      ${DEMO ? '<div class="demo-banner">Modo demonstração · jogadores fictícios</div>' : ''}
      <section class="card me-card">
        <div class="avatar me">${esc(initials(p.name))}</div>
        <div class="grow">
          <div class="me-name">${esc(p.name)}</div>
          <div class="muted small">Nível ${lvl(myLevel())} · ${sideText[p.side]} · até ${p.radiusKm} km · ${p.availability.length} horários</div>
        </div>
        <a href="#perfil" class="link small">Editar</a>
      </section>

      ${few ? `<section class="card invite">
        <h2>Ainda são poucos</h2>
        <p class="muted">Há ${state.players.length === 0 ? 'só tu' : `só ${state.players.length + 1} jogadores`} na app. Para formar jogos são precisos pelo menos 4 — convida quem joga contigo.</p>
        <a class="btn primary" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent('Estou a testar uma app para arranjar jogos de padel em Chaves sem andar a mandar mensagens. Inscreve-te: ' + appUrl())}">Convidar por WhatsApp</a>
      </section>` : ''}

      <section class="card">
        <h2>Como queres jogar?</h2>
        <div class="segmented" role="radiogroup">
          <button type="button" data-mode="solo" class="${pf.mode !== 'pair' ? 'on' : ''}">Sozinho</button>
          <button type="button" data-mode="pair" class="${pf.mode === 'pair' ? 'on' : ''}" ${state.players.length ? '' : 'disabled'}>Com parceiro</button>
        </div>
        <div id="partner-row" class="${pf.mode === 'pair' ? '' : 'hidden'}">
          <label class="field"><span>O meu parceiro</span><select id="partner">${partnerOpts}</select></label>
          <p class="muted small">O teu parceiro tem de ter conta na app.</p>
        </div>
        <button id="find" class="btn primary big">Encontrar jogo</button>
      </section>
      <section id="results"></section>`;

    $view.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
      pf.mode = b.dataset.mode; if (pf.mode === 'pair' && !pf.partnerId && state.players[0]) pf.partnerId = state.players[0].id;
      prefs.set(pf); state.results = null; renderJogar();
    }));
    const sel = document.getElementById('partner');
    if (sel) sel.addEventListener('change', () => { pf.partnerId = sel.value; prefs.set(pf); state.results = null; });
    const find = document.getElementById('find');
    find.addEventListener('click', () => busy(find, runMatchmaking).catch(() => {}));
    if (state.results) renderResults();
  }

  async function runMatchmaking() {
    [, state.clubStats] = await Promise.all([loadPlayersAndRatings(), B.clubStats()]);
    const pf = state.prefs;
    const partner = pf.mode === 'pair' ? state.players.find(x => x.id === (pf.partnerId || document.getElementById('partner').value)) : null;
    state.results = suggestMatches({ me: meAsPlayer(), partner, players: state.players, clubs: clubsWithStats(), max: 3 });
    renderResults();
    document.getElementById('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function teamHTML(team, cls) {
    return `<div class="team ${cls}">${team.map(pl => `
      <div class="player">
        <div class="avatar ${isMe(pl) ? 'me' : ''}">${esc(initials(pl.name))}</div>
        <div class="grow"><div class="pname">${esc(isMe(pl) ? 'Tu' : pl.name)}</div>
        <div class="muted small">${lvl(pl.level)} · ${pl.side === 'ambos' ? 'ambos' : pl.side}</div>${trustedBadge(pl)}</div>
      </div>`).join('')}
      <div class="team-avg">média ${lvl(team.reduce((s, x) => s + x.level, 0) / team.length)}</div></div>`;
  }

  function renderResults() {
    const el = document.getElementById('results');
    const { matches, diagnostics } = state.results;
    if (!matches.length) {
      let why = 'Ainda não há jogadores suficientes que encaixem no teu nível e horários.';
      if (diagnostics.noClubInRange) why = 'Não há nenhum clube dentro do teu raio. Aumenta o raio no perfil.';
      else if (diagnostics.noCommonSlot) why = 'Tu e o teu parceiro não têm nenhum horário em comum.';
      el.innerHTML = `<div class="card empty"><h2>Sem jogo por agora</h2><p>${why}</p>
        <p class="muted small">Experimenta acrescentar horários ou aumentar o raio.</p>
        <a class="btn" href="#perfil">Ajustar perfil</a></div>`;
      return;
    }
    el.innerHTML = `<h2 class="section-title">${matches.length === 1 ? 'Encontrámos 1 jogo' : `Encontrámos ${matches.length} jogos`}</h2>` +
      matches.map((m, i) => {
        const s = slotLabel(m.slot); const best = m.clubs[0];
        return `
        <article class="card match">
          <div class="match-head">
            <div class="when"><b>${s.day}</b> ${s.block} <span class="muted">· ${s.hours} · ${fmtDate(nextDateISO(m.slot))}</span></div>
            <div class="balance" title="Equilíbrio entre equipas"><div class="bar"><i style="width:${m.balance}%"></i></div><span>${m.balance}%</span></div>
          </div>
          <div class="versus">${teamHTML(m.teamA, 'a')}<div class="vs">vs</div>${teamHTML(m.teamB, 'b')}</div>
          <div class="match-foot">
            <div class="small"><span class="muted">Campo mais perto:</span> <b>${esc(best.club.short)}</b> · ${km(best.avgKm)} em média</div>
            <button class="btn primary" data-pick="${i}">Escolher campo no mapa</button>
          </div>
        </article>`;
      }).join('');
    el.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => {
      state.picked = matches[+b.dataset.pick];
      state.pickedClubId = state.picked.clubs[0].club.id;
      go('campo');
    }));
  }

  // ---------- CAMPO (mapa) ----------
  function renderCampo() {
    const m = state.picked;
    if (!m) { go('jogar'); return; }
    const four = [...m.teamA, ...m.teamB];
    const inRange = new Map(m.clubs.map(c => [c.club.id, c]));
    const s = slotLabel(m.slot); const date = nextDateISO(m.slot);

    $view.innerHTML = `
      <a href="#jogar" class="back">← Voltar às propostas</a>
      <h1 class="page-title">Escolhe o campo</h1>
      <p class="muted">${s.day} ${s.block.toLowerCase()} · ${s.hours} · ${fmtDate(date)}. Os campos a verde estão ao alcance dos 4 jogadores. A ordem tem em conta a distância e as avaliações dos jogadores.</p>
      <div id="map" class="map tall"></div>
      <div class="legend small"><span><i class="lg-a"></i>Equipa A</span><span><i class="lg-b"></i>Equipa B</span><span><i class="lg-club"></i>Campo possível</span><span><i class="lg-off"></i>Fora do alcance</span></div>
      <section id="club-list"></section>
      <div class="sticky-cta"><button id="confirm" class="btn primary big">${DEMO ? 'Propor este jogo' : 'Propor e convidar os 3'}</button></div>`;

    const map = makeMap(document.getElementById('map'), CITY_CENTER, 13);
    const markers = {};
    function drawList() {
      document.getElementById('club-list').innerHTML = CLUBS.map(c => {
        const r = inRange.get(c.id);
        const sel = c.id === state.pickedClubId;
        if (!r) {
          const blockers = four.filter(p => haversineKm(p, c) > p.radiusKm).map(p => isMe(p) ? 'ti' : p.name.split(' ')[0]);
          const who = blockers.length > 1 ? blockers.slice(0, -1).join(', ') + ' e ' + blockers[blockers.length - 1] : blockers[0];
          return `<div class="club off"><div class="grow"><b>${esc(c.name)}</b><div class="muted small">Longe demais para ${esc(who)}</div></div></div>`;
        }
        const rank = m.clubs.findIndex(x => x.club.id === c.id) + 1;
        return `<button class="club ${sel ? 'sel' : ''}" data-club="${c.id}">
          <div class="rank">${rank}</div>
          <div class="grow"><b>${esc(c.name)}</b>${rank === 1 ? ' <span class="tag">recomendado</span>' : ''}
            <div class="muted small">${esc(c.courts)} · ${esc(c.hours)}</div>
            <div class="small">${r.club.ratingCount ? `<span class="stars">★ ${stars(r.club.rating)}</span> <span class="muted">· ${r.club.ratingCount} ${r.club.ratingCount === 1 ? 'avaliação' : 'avaliações'}</span>` : '<span class="muted">Ainda sem avaliações</span>'}</div>
            <div class="small">${km(r.avgKm)} em média · ${km(r.totalKm)} no total${c.approx ? ' · <span class="muted">localização aproximada</span>' : ''}</div></div>
          <div class="radio ${sel ? 'on' : ''}"></div></button>`;
      }).join('');
      document.querySelectorAll('[data-club]').forEach(b => b.addEventListener('click', () => select(b.dataset.club, true)));
    }
    function select(id, pan) {
      state.pickedClubId = id; drawList();
      if (!map) return;
      Object.entries(markers).forEach(([cid, mk]) => {
        const r = inRange.get(cid); const rank = r ? m.clubs.indexOf(r) + 1 : '×';
        mk.setIcon(pinIcon(rank, !r ? 'off' : cid === id ? 'sel' : 'ok'));
      });
      if (pan) { const c = clubById(id); map.panTo([c.lat, c.lng]); }
    }
    if (map) {
      const bounds = [];
      CLUBS.forEach(c => {
        const r = inRange.get(c.id); const rank = r ? m.clubs.indexOf(r) + 1 : '×';
        const mk = L.marker([c.lat, c.lng], { icon: pinIcon(rank, !r ? 'off' : c.id === state.pickedClubId ? 'sel' : 'ok'), zIndexOffset: r ? 500 : 0 })
          .addTo(map).bindTooltip(c.short, { direction: 'top', offset: [0, -36] });
        if (r) { mk.on('click', () => select(c.id, false)); bounds.push([c.lat, c.lng]); }
        markers[c.id] = mk;
      });
      four.forEach(p => {
        const team = m.teamA.includes(p) ? 'a' : 'b';
        L.marker([p.lat, p.lng], { icon: dotIcon(initials(isMe(p) ? 'Tu' : p.name), team + (isMe(p) ? ' me' : '')) })
          .addTo(map).bindTooltip(isMe(p) ? 'Tu' : p.name, { direction: 'top', offset: [0, -12] });
        bounds.push([p.lat, p.lng]);
      });
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
    drawList();

    const confirm = document.getElementById('confirm');
    confirm.addEventListener('click', () => busy(confirm, async () => {
      const g = await B.createGame({ slot: m.slot, date, clubId: state.pickedClubId, balance: m.balance, teamA: m.teamA, teamB: m.teamB });
      state.justCreated = g.id; state.results = null; state.picked = null;
      toast(DEMO ? 'Jogo proposto (simulação: os 3 aceitaram)' : 'Jogo proposto — avisa os outros 3');
      go('jogos');
    }).catch(() => {}));
  }

  // ---------- OS MEUS JOGOS ----------
  const STATUS = {
    proposto: ['À espera de respostas', ''], confirmado: ['Confirmado', 'ok'], recusado: ['Alguém recusou', 'bad'],
    cancelado: ['Cancelado', 'muted-st'], jogado: ['Jogado', 'done']
  };
  const RESP = { aceite: ['✓', 'ok', 'aceitou'], recusado: ['✕', 'bad', 'recusou'], pendente: ['…', '', 'ainda não respondeu'] };

  function inviteText(g) {
    const s = slotLabel(g.slot), club = clubById(g.clubId);
    const names = (t) => t.map(p => String(p.name).split(' ')[0]).join(' + ');
    return `🎾 Jogo de padel proposto\n${s.day} ${fmtDate(g.date)}, ${s.block.toLowerCase()} (${s.hours})\n${club.name}\n${names(g.teamA)} vs ${names(g.teamB)}\n\nAceita ou recusa aqui: ${appUrl()}#jogos`;
  }

  async function renderJogos() {
    loading('A carregar os teus jogos…');
    const games = await B.listGames();
    state.games = games;
    if (!games.length) {
      $view.innerHTML = `<h1 class="page-title">Os meus jogos</h1>
        <div class="card empty"><p>Ainda não tens jogos.</p><a class="btn primary" href="#jogar">Encontrar jogo</a></div>`;
      return;
    }
    const pendingForMe = games.filter(g => g.status === 'proposto' && [...g.teamA, ...g.teamB].some(p => isMe(p) && p.response === 'pendente'));
    $view.innerHTML = `
      <div class="title-row"><h1 class="page-title">Os meus jogos</h1><button id="refresh" class="btn ghost small-btn">Atualizar</button></div>
      ${pendingForMe.length ? `<div class="notice">Tens ${pendingForMe.length} ${pendingForMe.length === 1 ? 'convite' : 'convites'} à espera de resposta.</div>` : ''}
      ${games.map(gameCard).join('')}
      ${DEMO ? '<p class="muted small center">Modo demonstração: os jogadores fictícios aceitam sozinhos.</p>' : ''}`;

    document.getElementById('refresh').addEventListener('click', route);
    const byId = Object.fromEntries(games.map(g => [g.id, g]));
    $view.querySelectorAll('[data-respond]').forEach(b => b.addEventListener('click', () => busy(b, async () => {
      const [id, v] = b.dataset.respond.split(':');
      await B.respond(id, v === '1'); toast(v === '1' ? 'Aceitaste o jogo' : 'Recusaste o jogo'); route();
    }).catch(() => {})));
    $view.querySelectorAll('[data-cancel]').forEach(b => b.addEventListener('click', () => busy(b, async () => {
      await B.cancelGame(b.dataset.cancel); toast('Jogo cancelado'); route();
    }).catch(() => {})));
    $view.querySelectorAll('[data-played]').forEach(b => b.addEventListener('click', () => {
      state.feedbackGame = byId[b.dataset.played]; go('feedback');
    }));
    $view.querySelectorAll('[data-score]').forEach(b => b.addEventListener('click', () => {
      state.scoreGame = byId[b.dataset.score]; go('marcador');
    }));
    $view.querySelectorAll('[data-confirm]').forEach(b => b.addEventListener('click', () => busy(b, async () => {
      const [id, v] = b.dataset.confirm.split(':');
      await B.confirmResult(id, v === '1'); state.players = [];
      toast(v === '1' ? 'Resultado confirmado — conta para o nível' : 'Resultado contestado — registem outra vez'); route();
    }).catch(() => {})));
    if (state.justCreated) {
      const card = document.querySelector(`[data-game="${state.justCreated}"]`);
      if (card) { card.classList.add('flash'); card.scrollIntoView({ block: 'center' }); }
      state.justCreated = null;
    }
  }

  function gameCard(g) {
    const s = slotLabel(g.slot), club = clubById(g.clubId);
    const all = [...g.teamA, ...g.teamB];
    const me = all.find(isMe);
    const [stLabel, stCls] = STATUS[g.status] || [g.status, ''];
    const accepted = all.filter(p => p.response === 'aceite').length;
    const chips = (t, cls) => t.map(p => { const [ic, rc, tip] = RESP[p.response] || RESP.pendente;
      return `<span class="pchip ${cls}" title="${esc(firstName(p))} ${tip}">${esc(firstName(p))}<i class="resp ${rc}">${ic}</i></span>`; }).join('');
    const dayCame = DEMO || isPastOrToday(g.date);
    const canFeedback = ['confirmado', 'jogado'].includes(g.status) && !g.myFeedback && dayCame;
    const r = g.result;
    const canScore = ['confirmado', 'jogado'].includes(g.status) && dayCame && (!r || r.status === 'contestado');
    const myTeam = g.teamA.some(isMe) ? 'a' : 'b';
    let actions = '';
    if (g.status === 'proposto' && me && me.response === 'pendente') {
      actions = `<div class="row"><button class="btn primary" data-respond="${g.id}:1">Aceitar</button><button class="btn" data-respond="${g.id}:0">Recusar</button></div>`;
    } else if (g.status === 'proposto') {
      actions = `<a class="btn whatsapp full" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(inviteText(g))}">Lembrar os outros por WhatsApp</a>`;
    } else if (g.status === 'confirmado' || g.status === 'jogado') {
      const book = g.status === 'confirmado' && !r ? `<a class="btn ${canScore ? '' : 'primary'}" href="${club.bookingUrl}" target="_blank" rel="noopener">Reservar campo</a>` : '';
      const score = canScore ? `<button class="btn primary" data-score="${g.id}">${r ? 'Registar outra vez' : 'Marcar resultado'}</button>` : '';
      const fb = canFeedback ? `<button class="btn" data-played="${g.id}">Dar feedback</button>` : '';
      actions = `${book || score ? `<div class="row">${score}${book}</div>` : ''}${fb ? `<div class="row">${fb}</div>` : ''}
        ${!dayCame ? '<p class="muted small">O marcador e o feedback abrem no dia do jogo.</p>' : ''}`;
    } else if (g.status === 'recusado') {
      actions = `<a class="btn full" href="#jogar">Procurar outro jogo</a>`;
    }
    const canCancel = g.createdBy === myId() && ['proposto', 'confirmado', 'recusado'].includes(g.status) && !g.result;
    return `<article class="card game ${g.status === 'cancelado' ? 'dim' : ''}" data-game="${g.id}">
      <div class="game-head"><div><b>${s.day} ${s.block.toLowerCase()}</b> <span class="muted">· ${fmtDate(g.date)} · ${s.hours}</span></div>
        <span class="status ${stCls}">${stLabel}${g.status === 'proposto' ? ` · ${accepted}/4` : ''}</span></div>
      <div class="game-club">${esc(club.name)}</div>
      <div class="game-teams">${chips(g.teamA, 'a')}<span class="muted">vs</span>${chips(g.teamB, 'b')}</div>
      ${r ? resultBlock(g, myTeam) : ''}
      ${g.myFeedback ? feedbackSummary(g) : ''}
      ${actions}
      ${canCancel ? `<button class="btn ghost full" data-cancel="${g.id}">Cancelar jogo</button>` : ''}
    </article>`;
  }

  function resultBlock(g, myTeam) {
    const r = g.result;
    const sets = r.sets.map(([a, b]) => `<span class="set">${a}-${b}</span>`).join('');
    const winnerNames = (r.winner === 'a' ? g.teamA : g.teamB).map(firstName).join(' + ');
    const other = (r.submittedTeam === 'a' ? g.teamB : g.teamA).map(firstName).join(' ou ');
    let st = '', act = '';
    if (r.status === 'confirmado') st = '<span class="rs ok">✓ confirmado · conta para o nível</span>';
    else if (r.status === 'contestado') st = '<span class="rs bad">Contestado — registem o resultado outra vez</span>';
    else if (r.submittedTeam === myTeam) st = `<span class="rs">À espera que ${esc(other)} confirme</span>`;
    else {
      st = '<span class="rs">A outra equipa registou este resultado. Está certo?</span>';
      act = `<div class="row"><button class="btn primary" data-confirm="${g.id}:1">Confirmar</button><button class="btn" data-confirm="${g.id}:0">Contestar</button></div>`;
    }
    return `<div class="result-box"><div class="result-line"><b>${esc(winnerNames)}</b> ganharam <span class="sets">${sets}</span></div>
      <div class="small">${st}</div>${act}</div>`;
  }

  function feedbackSummary(g) {
    const f = g.myFeedback;
    const vibe = { mal: 'Correu mal', normal: 'Correu normal', bem: 'Correu muito bem' }[f.vibe];
    const myTeam = g.teamA.some(isMe) ? 'a' : 'b';
    const won = f.winner === 'none' ? 'Não terminámos' : f.winner === myTeam ? 'Ganhámos' : 'Perdemos';
    const avgClub = (f.club.limpeza + f.club.balnearios + f.club.servicos) / 3;
    return `<div class="fb-summary small"><span>${won}${f.score ? ' · ' + esc(f.score) : ''}</span><span>${vibe}</span><span class="stars">★ ${stars(avgClub)} ao clube</span></div>`;
  }

  // ---------- FEEDBACK PÓS-JOGO ----------
  const CLUB_CRITERIA = [
    { id: 'limpeza', label: 'Limpeza do campo e do espaço' },
    { id: 'balnearios', label: 'Balneários' },
    { id: 'servicos', label: 'Serviços (bar, loja, aluguer)' }
  ];
  function renderFeedback() {
    const g = state.feedbackGame;
    if (!g) { go('jogos'); return; }
    const club = clubById(g.clubId);
    const others = [...g.teamA, ...g.teamB].filter(p => !isMe(p));
    const names = (t) => t.map(firstName).join(' + ');
    const res = g.result && g.result.status !== 'contestado' ? g.result : null;
    const f = { club: {}, winner: res ? res.winner : null, score: res ? Scorer.format({ sets: res.sets }) : '', difficulty: null, vibe: null, players: {} };
    others.forEach(p => { f.players[p.id] = { pontual: null, fairplay: null, repetir: null }; });

    const starRow = (c) => `<div class="rate-row"><span>${c.label}</span>
      <div class="starbar" data-crit="${c.id}" role="radiogroup" aria-label="${c.label}">
        ${[1, 2, 3, 4, 5].map(n => `<button type="button" data-n="${n}" aria-label="${n} estrela${n > 1 ? 's' : ''}">★</button>`).join('')}
      </div></div>`;
    const seg = (key, opts) => `<div class="segmented ${opts.length === 3 ? 'three' : ''}" data-key="${key}">
      ${opts.map(([v, l]) => `<button type="button" data-v="${v}">${esc(l)}</button>`).join('')}</div>`;
    const QUESTIONS = [['pontual', 'Chegou a horas?'], ['fairplay', 'Fair play?'], ['repetir', 'Voltavas a jogar com esta pessoa?']];

    $view.innerHTML = `
      <a href="#jogos" class="back">← Os meus jogos</a>
      <h1 class="page-title">Como correu?</h1>
      <p class="muted">Demora 30 segundos e ajuda a formar jogos melhores para todos.</p>
      <section class="card"><h2>O clube</h2><p class="muted small">${esc(club.name)}</p>${CLUB_CRITERIA.map(starRow).join('')}</section>
      <section class="card">
        <h2>O jogo</h2>
        ${res ? `<p class="small">Resultado: <b>${esc(names(res.winner === 'a' ? g.teamA : g.teamB))}</b> ganharam ${esc(f.score)}</p>` : `
        <label class="field"><span>Quem ganhou?</span></label>
        ${seg('winner', [['a', names(g.teamA)], ['b', names(g.teamB)], ['none', 'Não terminámos']])}
        <label class="field"><span>Resultado (opcional)</span><input id="fb-score" maxlength="30" placeholder="ex.: 6-4, 3-6, 7-5"></label>
        <p class="muted small">Para contar para o nível, usa antes o <b>marcador</b> em "Os meus jogos": a outra equipa confirma e o nível atualiza.</p>`}
        <label class="field"><span>Para ti, o nível do jogo foi…</span></label>
        ${seg('difficulty', [['facil', 'Fácil demais'], ['ok', 'Equilibrado'], ['dificil', 'Difícil demais']])}
        <label class="field"><span>No geral, o jogo correu…</span></label>
        ${seg('vibe', [['mal', 'Mal'], ['normal', 'Normal'], ['bem', 'Muito bem']])}
      </section>
      <section class="card">
        <h2>Os outros jogadores</h2>
        <p class="muted small">As respostas são privadas: ninguém vê notas nem quem respondeu o quê. Quem tiver várias respostas positivas ganha o selo <span class="trusted">✓ fiável</span>.</p>
        ${others.map(p => `
          <div class="fb-player">
            <div class="fb-pname"><div class="avatar ${g.teamA.some(x => x.id === p.id) ? 'ta' : 'tb'}">${esc(initials(p.name))}</div><b>${esc(p.name)}</b></div>
            ${QUESTIONS.map(([q, l]) => `<div class="yn-row"><span>${l}</span>
              <div class="yn" data-player="${p.id}" data-q="${q}"><button type="button" data-v="1">Sim</button><button type="button" data-v="0">Não</button></div></div>`).join('')}
          </div>`).join('')}
      </section>
      <p id="fb-err" class="error" hidden></p>
      <div class="sticky-cta"><button id="fb-send" class="btn primary big">Enviar feedback</button></div>`;

    $view.querySelectorAll('.starbar').forEach(bar => bar.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      const n = +b.dataset.n; f.club[bar.dataset.crit] = n;
      bar.querySelectorAll('button').forEach(x => x.classList.toggle('on', +x.dataset.n <= n));
    })));
    $view.querySelectorAll('.segmented[data-key]').forEach(segEl => segEl.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      f[segEl.dataset.key] = b.dataset.v;
      segEl.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    })));
    $view.querySelectorAll('.yn').forEach(yn => yn.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      const cur = f.players[yn.dataset.player][yn.dataset.q]; const val = b.dataset.v === '1';
      const next = cur === val ? null : val; // tocar outra vez apaga a resposta
      f.players[yn.dataset.player][yn.dataset.q] = next;
      yn.querySelectorAll('button').forEach(x => x.classList.toggle('on', next !== null && (x.dataset.v === '1') === next));
    })));

    const send = document.getElementById('fb-send');
    send.addEventListener('click', () => {
      const missing = [];
      if (CLUB_CRITERIA.some(c => !f.club[c.id])) missing.push('as estrelas do clube');
      if (!f.winner) missing.push('quem ganhou');
      if (!f.difficulty) missing.push('o nível do jogo');
      if (!f.vibe) missing.push('como correu');
      const err = document.getElementById('fb-err');
      if (missing.length) { err.textContent = 'Falta: ' + missing.join(', ') + '.'; err.hidden = false; err.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      err.hidden = true;
      const scoreEl = document.getElementById('fb-score');
      if (scoreEl) f.score = scoreEl.value.trim();
      busy(send, async () => {
        await B.submitFeedback(g.id, f);
        // O nível já não muda aqui: passa a vir dos resultados confirmados (js/rating.js).
        // "Fácil/difícil demais" fica guardado para afinar o matchmaking.
        state.feedbackGame = null; state.players = [];
        toast('Obrigado pelo feedback'); go('jogos');
      }).catch(() => {});
    });
  }


  // ---------- MARCADOR ----------
  // O ecrã fica aceso enquanto se marca (quando o browser deixa).
  let wakeLock = null;
  async function keepAwake() { try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* sem permissão */ } }
  function releaseWakeLock() { if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; } }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && location.hash === '#marcador' && !wakeLock) keepAwake(); });

  const scoreStore = {
    key: (id) => 'falta1:score:' + id,
    get(id) { try { return JSON.parse(localStorage.getItem(this.key(id))); } catch (e) { return null; } },
    set(id, v) { try { localStorage.setItem(this.key(id), JSON.stringify(v)); } catch (e) { /* sem armazenamento */ } },
    clear(id) { try { localStorage.removeItem(this.key(id)); } catch (e) { /* idem */ } }
  };

  // Ecrã inteiro (Android/computador; no iPhone a app instalada já ocupa o ecrã todo).
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
  const canFullscreen = () => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  function exitFullscreen() { if (fsEl()) (document.exitFullscreen || document.webkitExitFullscreen).call(document); }
  async function toggleFullscreen() {
    if (fsEl()) { exitFullscreen(); return; }
    const el = document.documentElement;
    try { await (el.requestFullscreen || el.webkitRequestFullscreen).call(el); } catch (e) { toast('Este browser não deixa pôr em ecrã inteiro'); }
  }

  function renderMarcador() {
    const g = state.scoreGame;
    if (!g) { go('jogos'); return; }
    const names = (t) => t.map(firstName).join(' + ');
    const team = (t) => (t === 'a' ? g.teamA : g.teamB);
    const playerById = (id) => [...g.teamA, ...g.teamB].find(p => p.id === id);
    let saved = scoreStore.get(g.id) || { started: false, points: [], config: { ...Scorer.DEFAULTS } };
    // Valores por defeito (também para marcadores guardados antes destas opções existirem).
    saved.config = { ...Scorer.DEFAULTS, live: true, ...saved.config };
    if (!saved.config.serveOrder) saved.config.serveOrder = { a: g.teamA.map(p => p.id), b: g.teamB.map(p => p.id) };
    const persist = () => scoreStore.set(g.id, saved);
    const liveUrl = () => new URL('ecra.html?jogo=' + encodeURIComponent(g.id), location.href).href;

    // ---- ao vivo: envia o estado completo depois de cada toque (o último envio ganha) ----
    let liveTimer = null, liveOk = null;
    const shortName = (p) => { const n = String(p.name || '').trim().split(/\s+/); return n.length > 1 ? `${n[0]} ${n[n.length - 1][0]}.` : n[0]; };
    function pushLive() {
      if (!saved.config.live || !saved.started) return;
      clearTimeout(liveTimer);
      liveTimer = setTimeout(() => {
        B.pushLiveScore(g.id, { points: saved.points, config: saved.config, clubId: g.clubId,
          teamA: g.teamA.map(p => ({ id: p.id, name: shortName(p) })), teamB: g.teamB.map(p => ({ id: p.id, name: shortName(p) })) })
          .then(() => setLive(true)).catch(() => setLive(false));
      }, 250);
    }
    function setLive(ok) {
      liveOk = ok;
      const el = document.getElementById('sc-live');
      if (el) { el.className = 'sc-live ' + (ok ? 'on' : 'off'); el.textContent = ok ? '● ao vivo' : '○ sem rede'; }
    }
    async function shareLive() {
      const url = liveUrl();
      try {
        if (navigator.share) await navigator.share({ title: 'Falta 1 — ao vivo', text: `${names(g.teamA)} vs ${names(g.teamB)}`, url });
        else { await navigator.clipboard.writeText(url); toast('Link copiado'); }
      } catch (e) { /* cancelado */ }
    }

    function drawSetup() {
      const cfg = saved.config, order = cfg.serveOrder;
      const first = cfg.firstServer, second = first === 'a' ? 'b' : 'a';
      // group 0: os 4 jogadores (marca quem começa); group 1: só a outra equipa (marca o 1.º a servir dela)
      const pick = (t, list, group) => list.map(p => `<button type="button" class="${t === 'a' ? 'ta' : 'tb'} ${order[t][0] === p.id && (group === 1 || t === first) ? 'on' : ''}" data-serve="${t}:${esc(p.id)}">${esc(firstName(p))}</button>`).join('');
      const manualVal = (document.getElementById('sc-manual') || {}).value || '';
      $view.innerHTML = `
        <a href="#jogos" class="back">← Os meus jogos</a>
        <h1 class="page-title">Marcar resultado</h1>
        <p class="muted">${esc(names(g.teamA))} <b>vs</b> ${esc(names(g.teamB))}</p>
        <section class="card">
          <h2>Regras</h2>
          <label class="field"><span>Em 40-40</span></label>
          <div class="segmented" data-cfg="goldenPoint">
            <button type="button" data-v="1" class="${cfg.goldenPoint ? 'on' : ''}">Ponto de ouro</button>
            <button type="button" data-v="0" class="${!cfg.goldenPoint ? 'on' : ''}">Vantagens</button></div>
          <label class="field"><span>3.º set</span></label>
          <div class="segmented" data-cfg="superTiebreak">
            <button type="button" data-v="1" class="${cfg.superTiebreak ? 'on' : ''}">Super tie-break a 10</button>
            <button type="button" data-v="0" class="${!cfg.superTiebreak ? 'on' : ''}">Set normal</button></div>
          <label class="field"><span>Quem serve primeiro?</span></label>
          <div class="serve-pick">${pick('a', g.teamA, 0)}${pick('b', g.teamB, 0)}</div>
          <label class="field"><span>E na outra equipa (${esc(names(team(second)))}), quem serve primeiro?</span></label>
          <div class="serve-pick">${pick(second, team(second), 1)}</div>
          <label class="check"><input type="checkbox" id="sc-live-on" ${cfg.live ? 'checked' : ''}>
            <span>Mostrar ao vivo no ecrã do clube e no link para quem está a ver<small class="muted"> (só primeiro nome e inicial)</small></span></label>
          <button id="sc-start" class="btn primary big">Começar a marcar</button>
          <p class="muted small">Deixa o telemóvel junto à rede ou no bolso de um jogador. Um toque por ponto; o ecrã fica aceso. A app diz quem serve e quando trocar de lado.</p>
        </section>
        <section class="card">
          <h2>Já sabes o resultado?</h2>
          <label class="field"><span>Escreve os sets da equipa de <b>${esc(names(g.teamA))}</b> primeiro</span>
            <input id="sc-manual" inputmode="numeric" maxlength="30" placeholder="ex.: 6-4, 3-6, 10-8" value="${esc(manualVal)}"></label>
          <p id="sc-err" class="error" hidden></p>
          <button id="sc-manual-save" class="btn full">Guardar este resultado</button>
        </section>`;
      $view.querySelectorAll('[data-cfg]').forEach(segEl => segEl.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        saved.config[segEl.dataset.cfg] = b.dataset.v === '1'; persist();
        segEl.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      })));
      // Escolher quem serve: no 1.º grupo escolhe-se a equipa e o jogador; no 2.º, o jogador da outra equipa.
      $view.querySelectorAll('.serve-pick').forEach((box, i) => box.querySelectorAll('[data-serve]').forEach(b => b.addEventListener('click', () => {
        const [t, id] = b.dataset.serve.split(':');
        const ids = team(t).map(p => p.id);
        order[t] = [id, ids.find(x => x !== id)];
        if (i === 0) cfg.firstServer = t;
        persist(); drawSetup();
      })));
      document.getElementById('sc-live-on').addEventListener('change', (e) => { cfg.live = e.target.checked; persist(); });
      document.getElementById('sc-start').addEventListener('click', () => { saved.started = true; persist(); keepAwake(); pushLive(); drawBoard(); });
      const manualBtn = document.getElementById('sc-manual-save');
      manualBtn.addEventListener('click', () => {
        const err = document.getElementById('sc-err');
        const sets = Scorer.parseSets(document.getElementById('sc-manual').value);
        const winner = sets && Rating.winnerFromSets(sets);
        if (!sets || !winner) { err.textContent = 'Não percebi o resultado. Escreve por exemplo: 6-4, 3-6, 10-8'; err.hidden = false; return; }
        err.hidden = true;
        saveResult(manualBtn, sets, winner);
      });
    }

    function drawBoard() {
      const st = Scorer.compute(saved.points, saved.config);
      const pd = Scorer.pointDisplay(st);
      const sv = Scorer.server(st);
      const rows = (t) => {
        const done = st.sets.map(([a, b]) => `<td class="${(t === 'a' ? a > b : b > a) ? 'won' : ''}">${t === 'a' ? a : b}</td>`).join('');
        // No super tie-break não há jogos: os pontos aparecem nos botões grandes.
        const cur = st.finished || st.superTiebreak ? '' : `<td class="cur">${st.games[t]}</td>`;
        return done + cur;
      };
      const serveBadge = (t) => {
        if (!sv || sv.team !== t) return '';
        const p = playerById(saved.config.serveOrder[t][sv.idx]);
        const where = pd.note === 'Ponto de ouro' ? 'a equipa que recebe escolhe o lado' : `serve da ${sv.side}`;
        return `<span class="sc-serve">🎾 ${esc(p ? firstName(p) : 'Serve')} · ${where}</span>`;
      };
      const note = st.changeEnds ? '<div class="sc-swap">↔ Trocar de lado</div>' : `<div class="sc-note">${esc(pd.note) || '&nbsp;'}</div>`;
      const tools = `
        ${saved.config.live ? `<span id="sc-live" class="sc-live ${liveOk === false ? 'off' : liveOk ? 'on' : ''}">${liveOk === false ? '○ sem rede' : '● ao vivo'}</span>
          <button id="sc-share" class="btn ghost small-btn" title="Partilhar o link ao vivo">🔗</button>` : ''}
        ${canFullscreen() ? `<button id="sc-full" class="btn ghost small-btn" title="Ecrã inteiro">${fsEl() ? '✕' : '⛶'}</button>` : ''}`;
      $view.innerHTML = `
        <div class="sc-top"><button id="sc-back" class="btn ghost small-btn">← Sair</button>
          <span class="muted small sc-rules">${saved.config.goldenPoint ? 'Ponto de ouro' : 'Vantagens'} · ${saved.config.superTiebreak ? 'super tie-break' : '3 sets'}</span>
          <span class="sc-tools">${tools}</span></div>
        <table class="sc-table" aria-label="Sets">
          <tr class="ta"><th>${sv && sv.team === 'a' ? '🎾 ' : ''}${esc(names(g.teamA))}</th>${rows('a')}</tr>
          <tr class="tb"><th>${sv && sv.team === 'b' ? '🎾 ' : ''}${esc(names(g.teamB))}</th>${rows('b')}</tr>
        </table>
        ${st.finished ? `
          <section class="card sc-done">
            <div class="muted small">Fim do jogo</div>
            <h2>${esc(names(st.winner === 'a' ? g.teamA : g.teamB))} ganharam</h2>
            <div class="sets big">${st.sets.map(([a, b]) => `<span class="set">${a}-${b}</span>`).join('')}</div>
            <button id="sc-save" class="btn primary big">Guardar resultado</button>
            <button id="sc-undo" class="btn ghost full">Anular o último ponto</button>
            <p class="muted small">${DEMO ? 'Simulação: os adversários confirmam logo.' : 'A outra equipa recebe o pedido para confirmar. Só depois conta para o nível.'}</p>
          </section>` : `
          ${note}
          <div class="sc-pads">
            <button class="sc-pad ta" data-pt="a"><span class="sc-names">${esc(names(g.teamA))}</span><span class="sc-pts">${pd.a}</span>${serveBadge('a')}</button>
            <button class="sc-pad tb" data-pt="b"><span class="sc-names">${esc(names(g.teamB))}</span><span class="sc-pts">${pd.b}</span>${serveBadge('b')}</button>
          </div>
          <button id="sc-undo" class="btn ghost full" ${saved.points.length ? '' : 'disabled'}>↶ Anular o último ponto</button>`}`;

      $view.querySelectorAll('[data-pt]').forEach(b => b.addEventListener('click', () => {
        saved.points.push(b.dataset.pt); persist(); pushLive();
        const after = Scorer.compute(saved.points, saved.config);
        if (navigator.vibrate) navigator.vibrate(after.changeEnds ? [80, 80, 80] : 15);
        drawBoard();
      }));
      const undo = document.getElementById('sc-undo');
      if (undo) undo.addEventListener('click', () => { saved.points.pop(); persist(); pushLive(); drawBoard(); });
      document.getElementById('sc-back').addEventListener('click', () => {
        exitFullscreen();
        toast(saved.points.length ? 'O marcador fica guardado — podes continuar depois' : 'Saíste do marcador'); go('jogos');
      });
      const share = document.getElementById('sc-share');
      if (share) share.addEventListener('click', shareLive);
      const full = document.getElementById('sc-full');
      if (full) full.addEventListener('click', toggleFullscreen);
      const save = document.getElementById('sc-save');
      if (save) save.addEventListener('click', () => saveResult(save, st.sets, st.winner));
    }
    // O ícone do ecrã inteiro acompanha (também quando se sai com o botão "voltar" do telemóvel).
    const onFs = () => { const b = document.getElementById('sc-full'); if (b) b.textContent = fsEl() ? '✕' : '⛶'; };
    document.onfullscreenchange = onFs; document.onwebkitfullscreenchange = onFs;

    function saveResult(btn, sets, winner) {
      busy(btn, async () => {
        const before = myLevel();
        await B.submitResult(g.id, { sets, winner });
        exitFullscreen();
        scoreStore.clear(g.id); state.scoreGame = null;
        await loadPlayersAndRatings();
        const after = myLevel();
        const changed = Math.abs(after - before) >= 0.005;
        toast(changed ? `Resultado guardado · o teu nível: ${lvl(before)} → ${lvl(after)}` : 'Resultado guardado — à espera da confirmação da outra equipa');
        go('jogos');
      }).catch(() => {});
    }

    if (saved.started) { keepAwake(); pushLive(); drawBoard(); } else drawSetup();
  }

  // ---------- PERFIL ----------
  async function renderPerfil() {
    if (state.profile && !state.players.length) { loading(); await loadPlayersAndRatings(); }
    const p = state.profile || { name: '', level: 3, side: 'ambos', availability: [], lat: CITY_CENTER.lat, lng: CITY_CENTER.lng, radiusKm: 8 };
    const draft = JSON.parse(JSON.stringify(p));
    const user = B.user();
    const myRating = state.profile ? ratingOf(myId()) : null;

    const grid = `<div class="avail" role="group" aria-label="Disponibilidade">
      <div></div>${DAYS.map(d => `<div class="ah">${d.label}</div>`).join('')}
      ${BLOCKS.map(b => `<div class="ab">${b.label}<small>${b.hours}</small></div>` +
        DAYS.map(d => { const id = `${d.id}-${b.id}`; const on = draft.availability.includes(id);
          return `<button type="button" class="slot ${on ? 'on' : ''}" data-slot="${id}" aria-pressed="${on}" aria-label="${d.label} ${b.label}"></button>`; }).join('')
      ).join('')}</div>`;

    $view.innerHTML = `
      <h1 class="page-title">${state.profile ? 'O meu perfil' : 'Cria o teu perfil'}</h1>
      <form id="pf" novalidate>
        <section class="card">
          <label class="field"><span>Nome</span><input id="f-name" required maxlength="40" placeholder="Como te chamam no campo" value="${esc(draft.name)}"></label>
        </section>
        <section class="card">
          ${myRating && myRating.games ? `<div class="computed-level"><div><div class="muted small">Nível atual, calculado pelos jogos</div>
            <div class="big-level">${lvl(myRating.level)}${myRating.provisional ? ' <span class="tag">provisório</span>' : ''}</div></div>
            <div class="small muted right">${myRating.games} ${myRating.games === 1 ? 'jogo confirmado' : 'jogos confirmados'}<br>${myRating.wins}V · ${myRating.losses}D</div></div>
            <p class="muted small">O valor abaixo é a tua autoavaliação inicial. Os resultados confirmados vão afinando o nível a partir dela.</p>` : ''}
          <h2>${myRating && myRating.games ? 'Nível inicial' : 'Nível'} <span class="lvl-num" id="lvl-num">${lvl(draft.level)}</span></h2>
          <input type="range" id="f-level" min="0" max="7" step="0.25" value="${draft.level}">
          <div class="ticks">${[0, 1, 2, 3, 4, 5, 6, 7].map(n => `<span>${n}</span>`).join('')}</div>
          <p class="lvl-desc" id="lvl-desc">${levelText(draft.level)}</p>
        </section>
        <section class="card">
          <h2>Lado preferido</h2>
          <div class="segmented three">
            ${['direita', 'esquerda', 'ambos'].map(s => `<button type="button" data-side="${s}" class="${draft.side === s ? 'on' : ''}">${s === 'ambos' ? 'Tanto faz' : sideText[s]}</button>`).join('')}
          </div>
        </section>
        <section class="card">
          <h2>Ecrã dos clubes</h2>
          <label class="check"><input type="checkbox" id="f-public" ${draft.publicRanking !== false ? 'checked' : ''}>
            <span class="grow">Mostrar o meu nome no ranking da época que os clubes põem na TV</span></label>
          <p class="muted small">Aparece só o primeiro nome e a inicial do apelido. Se desligares, contas na mesma, mas no ecrã público apareces como "Jogador".</p>
        </section>
        <section class="card">
          <h2>Quando podes jogar?</h2>
          <p class="muted small">Toca nos horários em que costumas estar livre.</p>
          ${grid}
        </section>
        <section class="card">
          <h2>Onde estás?</h2>
          <p class="muted small">Toca no mapa ou arrasta o ponto. O círculo é a distância máxima que estás disposto a fazer. Guardamos a localização arredondada a cerca de 1 km.</p>
          <div id="pmap" class="map"></div>
          <button type="button" id="geo" class="btn ghost small-btn">Usar a minha localização</button>
          <label class="field"><span>Distância máxima: <b id="rad-num">${draft.radiusKm} km</b></span>
            <input type="range" id="f-radius" min="1" max="30" step="1" value="${draft.radiusKm}"></label>
        </section>
        <p id="pf-err" class="error" hidden></p>
        <div class="sticky-cta"><button class="btn primary big" type="submit">${state.profile ? 'Guardar' : 'Guardar e encontrar jogo'}</button></div>
      </form>
      ${!DEMO && user ? `<section class="card account"><div class="grow"><div class="muted small">Conta</div><div>${esc(user.email)}</div></div><button id="logout" class="btn ghost">Sair</button></section>` : ''}`;

    const lvlInput = document.getElementById('f-level');
    lvlInput.addEventListener('input', () => {
      draft.level = +lvlInput.value;
      document.getElementById('lvl-num').textContent = lvl(draft.level);
      document.getElementById('lvl-desc').textContent = levelText(draft.level);
    });
    $view.querySelectorAll('[data-side]').forEach(b => b.addEventListener('click', () => {
      draft.side = b.dataset.side;
      $view.querySelectorAll('[data-side]').forEach(x => x.classList.toggle('on', x === b));
    }));
    $view.querySelectorAll('[data-slot]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.slot; const i = draft.availability.indexOf(id);
      if (i >= 0) draft.availability.splice(i, 1); else draft.availability.push(id);
      b.classList.toggle('on', i < 0); b.setAttribute('aria-pressed', i < 0);
    }));

    const map = makeMap(document.getElementById('pmap'), draft, 13);
    let marker, circle;
    function placeMe(lat, lng, pan) {
      draft.lat = lat; draft.lng = lng;
      if (!map) return;
      marker.setLatLng([lat, lng]); circle.setLatLng([lat, lng]);
      if (pan) map.panTo([lat, lng]);
    }
    if (map) {
      CLUBS.forEach(c => L.marker([c.lat, c.lng], { icon: pinIcon('P', 'ok mini') }).addTo(map).bindTooltip(c.short, { direction: 'top', offset: [0, -36] }));
      circle = L.circle([draft.lat, draft.lng], { radius: draft.radiusKm * 1000, color: '#0f7b5f', weight: 1.5, fillOpacity: 0.08 }).addTo(map);
      marker = L.marker([draft.lat, draft.lng], { draggable: true, icon: dotIcon('Eu', 'a me') }).addTo(map);
      marker.on('dragend', () => { const ll = marker.getLatLng(); placeMe(ll.lat, ll.lng); });
      map.on('click', (e) => placeMe(e.latlng.lat, e.latlng.lng));
      const fit = () => map.fitBounds(circle.getBounds(), { padding: [10, 10] });
      fit();
      document.getElementById('f-radius').addEventListener('change', fit);
    }
    const rad = document.getElementById('f-radius');
    rad.addEventListener('input', () => {
      draft.radiusKm = +rad.value; document.getElementById('rad-num').textContent = draft.radiusKm + ' km';
      if (circle) circle.setRadius(draft.radiusKm * 1000);
    });
    document.getElementById('geo').addEventListener('click', () => {
      if (!navigator.geolocation) { toast('Este browser não dá a localização'); return; }
      navigator.geolocation.getCurrentPosition(
        (pos) => { placeMe(pos.coords.latitude, pos.coords.longitude, true); toast('Localização atualizada'); },
        () => toast('Não foi possível obter a localização — toca no mapa'),
        { enableHighAccuracy: false, timeout: 8000 });
    });
    const logout = document.getElementById('logout');
    if (logout) logout.addEventListener('click', async () => { await B.signOut(); state.profile = null; state.players = []; go('entrar'); });

    document.getElementById('pf').addEventListener('submit', (e) => {
      e.preventDefault();
      draft.name = document.getElementById('f-name').value.trim();
      draft.publicRanking = document.getElementById('f-public').checked;
      const err = document.getElementById('pf-err');
      const problems = [];
      if (!draft.name) problems.push('o teu nome');
      if (!draft.availability.length) problems.push('pelo menos um horário');
      if (problems.length) { err.textContent = 'Falta: ' + problems.join(' e ') + '.'; err.hidden = false; err.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      err.hidden = true;
      busy(e.target.querySelector('button[type=submit]'), async () => {
        state.profile = await B.saveProfile(draft); state.results = null;
        toast('Perfil guardado'); go('jogar');
      }).catch(() => {});
    });
  }

  // ---------- dados partilhados: jogadores (comigo), época e torneios ----------
  function everyoneList() {
    const me = state.profile ? { id: myId(), name: state.profile.name, side: state.profile.side, level: myLevel(),
      declaredLevel: state.profile.level, trusted: false } : null;
    return [...state.players, ...(me ? [me] : [])];
  }
  function namer(everyone) {
    const byId = Object.fromEntries(everyone.map(p => [p.id, p]));
    const full = (id) => id === myId() ? 'Tu' : (byId[id] ? byId[id].name : 'Jogador');
    // "Rui T." — curto, mas distingue dois Ruis
    const short = (id) => { if (id === myId()) return 'Tu'; const n = byId[id] ? byId[id].name.split(/\s+/) : ['?'];
      return n.length > 1 ? `${n[0]} ${n[n.length - 1][0]}.` : n[0]; };
    return { byId, full, short, team: (t) => (t || []).map(short).join(' + ') };
  }
  const finishedTournaments = (list) => list.filter(t => t.status === 'terminado')
    .map(t => ({ id: t.id, name: t.name, date: t.date, placements: Tournament.placements(t) })).filter(t => t.placements);
  async function loadSeason(year) {
    const [, tournaments] = await Promise.all([loadPlayersAndRatings(), B.listTournaments()]);
    state.tournaments = tournaments;
    const initialLevels = { ...state.initialLevels };
    return Season.computeSeason({ year, results: state.allResults, initialLevels, tournaments: finishedTournaments(tournaments) });
  }
  function rulesFooter(extraTitle) {
    const e = Season.explain();
    return `<section class="card rules-foot">
      <h3>${esc(extraTitle || e.title)}</h3>
      <ul>${e.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></section>`;
  }

  // ---------- RANKING (época, nível, parelhas) ----------
  async function renderJogadores() {
    loading();
    const thisYear = new Date().getFullYear();
    const year = state.prefs.seasonYear && state.prefs.seasonYear <= thisYear ? state.prefs.seasonYear : thisYear;
    const season = await loadSeason(year);
    const view = ['epoca', 'jogadores', 'parelhas'].includes(state.prefs.rankView) ? state.prefs.rankView : 'epoca';
    const everyone = everyoneList();
    const N = namer(everyone);
    const byId = N.byId, nameOf = N.full;
    const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const trend = (t) => t > 0.02 ? '<span class="up" title="A subir nos últimos jogos">▲</span>' : t < -0.02 ? '<span class="down" title="A descer nos últimos jogos">▼</span>' : '';

    // --- época
    const myRow = season.rows[myId()];
    const div = state.prefs.seasonDiv && season.divisions.some(d => d.id === state.prefs.seasonDiv) ? state.prefs.seasonDiv : (myRow ? myRow.division : 'B');
    const D = season.divisions.find(d => d.id === div);
    const years = [...new Set((state.allResults || []).map(r => Number(r.date.slice(0, 4))))].filter(y => y <= thisYear).sort((a, b) => b - a);
    if (!years.includes(thisYear)) years.unshift(thisYear);
    const pct = (x) => Math.round(x * 100) + '%';
    const seasonRow = (r) => {
      const p = byId[r.id] || { name: '?' };
      const best = r.tournaments.slice().sort((a, b) => Season.PLACE_ORDER.indexOf(a.place) - Season.PLACE_ORDER.indexOf(b.place))[0];
      return `<div class="prow ${r.id === myId() ? 'me-row' : ''}">
        <div class="pos">${r.position || '–'}</div>
        <div class="avatar ${r.id === myId() ? 'me' : ''}">${esc(initials(p.name))}</div>
        <div class="grow"><b>${esc(nameOf(r.id))}</b> ${trustedBadge(p)}
          <div class="muted small">${r.games} ${r.games === 1 ? 'jogo' : 'jogos'} · ${r.wins}V ${r.losses}D · ${pct(r.winPct)}${r.tournaments.length ? ` · ${r.tournaments.length} ${r.tournaments.length === 1 ? 'torneio' : 'torneios'}${best && best.place === 'campeao' ? ' 🏆' : ''}` : ''}${r.divisionProvisional ? ' · <span class="tag soft" title="Ainda não fez 5 jogos: a divisão pode mudar">divisão provisória</span>' : ''}</div></div>
        <div class="pts-pill" title="${r.casualPoints} de jogos + ${r.tournamentPoints} de torneios">${r.points}<small>pts</small></div>
      </div>`;
    };
    const leaderCard = (title, list, val) => `<div class="card leader"><div class="muted small">${title}</div>
      ${list.slice(0, 3).map((r, i) => `<div class="lrow"><span>${i + 1}. ${esc(N.short(r.id))}</span><b>${val(r)}</b></div>`).join('') || '<div class="muted small">—</div>'}</div>`;
    const seasonHTML = `
      <div class="season-head">
        <div><div class="muted small">Época</div><div class="season-year">${year}</div></div>
        ${years.length > 1 ? `<select id="season-year" aria-label="Escolher época">${years.map(y => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select>` : ''}
        ${myRow ? `<div class="me-season"><div class="muted small">Tu · ${esc(season.divisions.find(d => d.id === myRow.division).name)}</div>
          <b>${myRow.position ? myRow.position + '.º · ' : ''}${myRow.points} pts</b></div>` : ''}
      </div>
      <div class="segmented three" role="tablist">${season.divisions.map(d => `<button type="button" data-div="${d.id}" class="${d.id === div ? 'on' : ''}">${esc(d.name)}</button>`).join('')}</div>
      ${D.ranked.length ? `<div class="card list">${D.ranked.map(seasonRow).join('')}</div>`
        : `<div class="card empty"><p>Ainda ninguém da ${esc(D.name)} tem ${season.rules.minGames} jogos esta época.</p></div>`}
      ${D.pending.length ? `<h2 class="section-title">Ainda sem ${season.rules.minGames} jogos</h2><div class="card list">${D.pending.map(seasonRow).join('')}</div>` : ''}
      <a class="card screen-link" href="ecra.html" target="_blank" rel="noopener"><b>📺 Ecrã para o clube</b><span class="muted small">Abre o ranking em ecrã inteiro para pôr numa TV. Não precisa de conta.</span></a>
      <h2 class="section-title">Destaques da época</h2>
      <div class="leaders">
        ${leaderCard('Mais vitórias', season.leaders.wins, r => r.wins)}
        ${leaderCard('Mais jogos', season.leaders.games, r => r.games)}
      </div>
      ${rulesFooter()}`;

    // --- nível (Elo)
    const ranked = Rating.rankPlayers(state.ratings.players).filter(r => byId[r.id]);
    const unranked = everyone.filter(p => !ranked.some(r => r.id === p.id)).sort((a, b) => (b.declaredLevel || 0) - (a.declaredLevel || 0));
    const pairs = Rating.rankPairs(state.ratings.pairs).filter(pr => pr.ids.every(id => byId[id]));
    const playersHTML = `
      <p class="muted small">O nível mede como jogas e é o que a app usa para formar jogos equilibrados. Não recomeça com a época.</p>
      ${ranked.length ? `<div class="card list">${ranked.map((r, i) => {
        const p = byId[r.id];
        return `<div class="prow ${r.id === myId() ? 'me-row' : ''}">
          <div class="pos">${i + 1}</div>
          <div class="avatar ${r.id === myId() ? 'me' : ''}">${esc(initials(p.name))}</div>
          <div class="grow"><b>${esc(nameOf(r.id))}</b> ${trustedBadge(p)}
            <div class="muted small">${r.games} ${r.games === 1 ? 'jogo' : 'jogos'} · ${r.wins}V ${r.losses}D${r.provisional ? ' · <span class="tag soft">provisório</span>' : ''}</div></div>
          <div class="lvl-pill">${lvl(r.level)} ${trend(r.trend)}</div>
        </div>`; }).join('')}</div>` : '<div class="card empty"><p>Ainda não há resultados confirmados.</p></div>'}
      ${unranked.length ? `<h2 class="section-title">Ainda sem jogos</h2><div class="card list">${unranked.map(p => `
        <div class="prow"><div class="avatar ${p.id === myId() ? 'me' : ''}">${esc(initials(p.name))}</div>
          <div class="grow"><b>${esc(nameOf(p.id))}</b> ${trustedBadge(p)}<div class="muted small">${sideText[p.side] || ''} · nível declarado ${lvl(p.declaredLevel || 0)}</div></div></div>`).join('')}</div>` : ''}`;

    const pairsHTML = pairs.length ? `
      <p class="muted small">Parelhas com pelo menos 2 jogos juntas. A <b>química</b> compara o nível da parelha com a média dos dois: positiva quando jogam melhor juntos do que cada um sozinho.</p>
      <div class="card list">${pairs.map((pr, i) => `
        <div class="prow ${pr.ids.includes(myId()) ? 'me-row' : ''}">
          <div class="pos">${i + 1}</div>
          <div class="duo">${pr.ids.map(id => `<div class="avatar ${id === myId() ? 'me' : ''}">${esc(initials(byId[id].name))}</div>`).join('')}</div>
          <div class="grow"><b>${pr.ids.map(id => esc(nameOf(id).split(' ')[0])).join(' + ')}</b>
            <div class="muted small">${pr.games} jogos · ${pr.wins}V ${pr.losses}D · química <span class="${pr.chemistry >= 0 ? 'pos-c' : 'neg-c'}">${signed(pr.chemistry)}</span></div></div>
          <div class="lvl-pill">${lvl(pr.level)}</div>
        </div>`).join('')}</div>` : '<div class="card empty"><p>Ainda nenhuma parelha jogou 2 jogos junta.</p></div>';

    $view.innerHTML = `<h1 class="page-title">Ranking</h1>
      <p class="muted small">${DEMO ? 'Modo demonstração: resultados fictícios de setembro a novembro, um americano fictício e os teus jogos.' : 'Só contam resultados confirmados.'}</p>
      <div class="segmented three" role="tablist">
        <button type="button" data-rank="epoca" class="${view === 'epoca' ? 'on' : ''}">Época</button>
        <button type="button" data-rank="jogadores" class="${view === 'jogadores' ? 'on' : ''}">Nível</button>
        <button type="button" data-rank="parelhas" class="${view === 'parelhas' ? 'on' : ''}">Parelhas</button>
      </div>
      ${view === 'epoca' ? seasonHTML : view === 'parelhas' ? pairsHTML : playersHTML}`;
    $view.querySelectorAll('[data-rank]').forEach(b => b.addEventListener('click', () => {
      state.prefs.rankView = b.dataset.rank; prefs.set(state.prefs); renderJogadores();
    }));
    $view.querySelectorAll('[data-div]').forEach(b => b.addEventListener('click', () => {
      state.prefs.seasonDiv = b.dataset.div; prefs.set(state.prefs); renderJogadores();
    }));
    const ysel = document.getElementById('season-year');
    if (ysel) ysel.addEventListener('change', () => { state.prefs.seasonYear = Number(ysel.value); prefs.set(state.prefs); renderJogadores(); });
  }

  // ---------- TORNEIOS ----------
  const T_STATUS = { 'a decorrer': ['A decorrer', 'st-open'], terminado: ['Terminado', 'st-done'], cancelado: ['Cancelado', 'st-off'] };
  const isOrganizer = (t) => t && t.organizerId === myId();

  async function renderTorneios() {
    loading('A carregar os torneios…');
    const [, list] = await Promise.all([state.players.length ? null : loadPlayersAndRatings(), B.listTournaments()]);
    state.tournaments = list;
    const N = namer(everyoneList());
    const card = (t) => {
      const [stl, stc] = T_STATUS[t.status] || [t.status, ''];
      const pl = t.status === 'terminado' ? Tournament.placements(t) : null;
      const champs = pl ? Object.entries(pl).filter(([, v]) => v === 'campeao').map(([id]) => N.short(id)) : [];
      const mine = pl && pl[myId()];
      const n = (t.entries.players || (t.entries.pairs || []).flat()).length;
      const playing = (t.entries.players || (t.entries.pairs || []).flat()).includes(myId());
      const toConfirm = t.status === 'a decorrer' ? t.matches.filter(m => { const r = m.result; if (!r || r.status !== 'pendente') return false;
        const mt = Array.isArray(m.teamA) && m.teamA.includes(myId()) ? 'a' : Array.isArray(m.teamB) && m.teamB.includes(myId()) ? 'b' : null;
        return (mt && mt !== r.submittedTeam) || (!mt && isOrganizer(t)); }).length : 0;
      return `<a class="card t-card" href="#torneio/${encodeURIComponent(t.id)}">
        <div class="game-head"><b>${esc(t.name)}</b><span class="status ${stc}">${stl}</span></div>
        <div class="muted small">${fmtDate(t.date)} · ${esc(clubById(t.clubId).short || clubById(t.clubId).name)} · ${esc(Tournament.FORMATS[t.format].label)} · ${n} jogadores${playing ? ' · <span class="tag">jogas</span>' : ''}${isOrganizer(t) ? ' · <span class="tag soft">organizas</span>' : ''}</div>
        ${toConfirm ? `<div class="small t-alert">${toConfirm} ${toConfirm === 1 ? 'resultado' : 'resultados'} para confirmares</div>` : ''}
        ${champs.length ? `<div class="small t-champ">🏆 ${esc(champs.join(' + '))}${mine ? ` · tu: ${esc(Season.PLACE_LABELS[mine].toLowerCase())}` : ''}</div>` : ''}
      </a>`;
    };
    const open = list.filter(t => t.status === 'a decorrer'), done = list.filter(t => t.status === 'terminado');
    $view.innerHTML = `
      <div class="title-row"><h1 class="page-title">Torneios</h1><a class="btn primary small-btn" href="#torneio-novo">+ Criar torneio</a></div>
      <p class="muted small">A app sugere as duplas e os jogos pelo nível de cada um, ou sorteia sem repetir duplas. Os torneios contam para o ranking da época.</p>
      ${open.length ? `<h2 class="section-title">A decorrer</h2>${open.map(card).join('')}` : ''}
      ${done.length ? `<h2 class="section-title">Terminados</h2>${done.map(card).join('')}` : ''}
      ${!list.length ? '<div class="card empty"><p>Ainda não há torneios.</p><a class="btn primary" href="#torneio-novo">Criar o primeiro</a></div>' : ''}`;
  }

  function nextSaturdayISO() {
    const d = new Date(); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7)); return isoDate(d);
  }

  async function renderTorneioNovo() {
    if (!state.players.length) { loading(); await loadPlayersAndRatings(); }
    const everyone = everyoneList().slice().sort((a, b) => (a.id === myId() ? -1 : b.id === myId() ? 1 : a.name.localeCompare(b.name, 'pt')));
    const N = namer(everyone);
    const f = state.newTournament || (state.newTournament = {
      name: '', date: nextSaturdayISO(), clubId: CLUBS[0].id, format: 'americano', mode: 'ranking', courts: 2, rounds: '',
      selected: [myId()], pairs: null, pairsEdited: false, seed: Math.floor(Math.random() * 1e9) });
    const levelOf = (id) => (N.byId[id] ? N.byId[id].level : 3);

    function suggestedPairs() {
      const pl = f.selected.map(id => ({ id, level: levelOf(id) }));
      return Tournament.formPairs(pl, f.mode, Tournament.makeRand(f.seed));
    }
    function draw() {
      const prevList = $view.querySelector('.check-list'), keepScroll = prevList ? prevList.scrollTop : 0;
      const F = Tournament.FORMATS[f.format];
      const pairFormat = F.entry === 'pairs';
      if (pairFormat && (!f.pairs || !f.pairsEdited)) f.pairs = suggestedPairs();
      const n = f.selected.length;
      const need = pairFormat ? F.min * 2 : F.min;
      const problem = n < need ? `Escolhe pelo menos ${need} jogadores (tens ${n}).`
        : pairFormat && n % 2 ? 'Para jogar em duplas, o número de jogadores tem de ser par.' : '';
      const maxRounds = Math.max(1, n - 1);
      const opt = (id) => `<option value="${esc(id)}">${esc(N.full(id))} · ${lvl(levelOf(id))}</option>`;
      $view.innerHTML = `
        <a href="#torneios" class="back">← Torneios</a>
        <h1 class="page-title">Criar torneio</h1>
        <section class="card">
          <label class="field"><span>Nome</span><input id="tn-name" maxlength="60" placeholder="ex.: Americano de sábado" value="${esc(f.name)}"></label>
          <div class="row2">
            <label class="field"><span>Data</span><input id="tn-date" type="date" value="${esc(f.date)}"></label>
            <label class="field"><span>Clube</span><select id="tn-club">${CLUBS.map(c => `<option value="${c.id}" ${c.id === f.clubId ? 'selected' : ''}>${esc(c.short || c.name)}</option>`).join('')}</select></label>
          </div>
        </section>
        <section class="card">
          <h2>Formato</h2>
          <div class="segmented three">${Object.values(Tournament.FORMATS).map(x => `<button type="button" data-format="${x.id}" class="${x.id === f.format ? 'on' : ''}">${esc(x.label.replace(' + eliminatórias', ' + elim.'))}</button>`).join('')}</div>
          <p class="muted small">${esc(F.desc)}</p>
          <h2>Duplas e jogos</h2>
          <div class="segmented">${Object.values(Tournament.MODES).map(x => `<button type="button" data-tmode="${x.id}" class="${x.id === f.mode ? 'on' : ''}">${esc(x.label)}</button>`).join('')}</div>
          <p class="muted small">${esc(Tournament.MODES[f.mode].desc)}${f.format === 'americano' ? '' : ' Nas eliminatórias as duplas podem voltar a encontrar-se.'}</p>
          <div class="row2">
            <label class="field"><span>Campos</span><input id="tn-courts" type="number" min="1" max="8" value="${f.courts}"></label>
            ${f.format === 'americano' ? `<label class="field"><span>Rondas (máx. ${maxRounds})</span><input id="tn-rounds" type="number" min="1" max="${maxRounds}" placeholder="automático" value="${esc(f.rounds)}"></label>` : '<div></div>'}
          </div>
        </section>
        <section class="card">
          <div class="title-row"><h2>Participantes · ${n}</h2>
            <button type="button" id="tn-all" class="btn ghost small-btn">${n === everyone.length ? 'Limpar' : 'Todos'}</button></div>
          <div class="check-list">${everyone.map(p => `
            <label class="check"><input type="checkbox" data-pick="${esc(p.id)}" ${f.selected.includes(p.id) ? 'checked' : ''}>
              <span class="grow">${esc(N.full(p.id))}</span><span class="muted small">${lvl(p.level)}</span></label>`).join('')}</div>
        </section>
        ${pairFormat && n >= 2 && n % 2 === 0 ? `<section class="card">
          <div class="title-row"><h2>Duplas</h2><button type="button" id="tn-repair" class="btn ghost small-btn">${f.mode === 'sorteio' ? 'Sortear outra vez' : 'Repor sugestão'}</button></div>
          <p class="muted small">${f.mode === 'ranking' ? 'Sugestão da app: o mais forte com o mais fraco, para as duplas ficarem equilibradas.' : 'Duplas sorteadas.'} Podes trocar à mão.</p>
          ${f.pairs.map((pr, i) => `<div class="pair-row"><span class="pos">${i + 1}</span>
            <select data-pair="${i}:0">${f.selected.map(opt).join('')}</select><span class="muted">+</span>
            <select data-pair="${i}:1">${f.selected.map(opt).join('')}</select></div>`).join('')}
          <p id="tn-pair-err" class="error" hidden></p>
        </section>` : ''}
        ${problem ? `<p class="error">${esc(problem)}</p>` : ''}
        <button id="tn-create" class="btn primary big" ${problem ? 'disabled' : ''}>Criar torneio e gerar os jogos</button>
        <p class="muted small center">Enquanto não houver resultados, podes voltar a sortear na página do torneio.</p>`;

      const list = $view.querySelector('.check-list'); if (list) list.scrollTop = keepScroll;
      // valores atuais das duplas nos selects
      $view.querySelectorAll('[data-pair]').forEach(sel => { const [i, j] = sel.dataset.pair.split(':').map(Number); sel.value = f.pairs[i][j]; });

      const bindVal = (id, key, num) => { const el = document.getElementById(id); if (el) el.addEventListener('change', () => { f[key] = num ? (el.value === '' ? '' : Number(el.value)) : el.value; }); };
      bindVal('tn-name', 'name'); bindVal('tn-date', 'date'); bindVal('tn-club', 'clubId'); bindVal('tn-courts', 'courts', true); bindVal('tn-rounds', 'rounds', true);
      document.getElementById('tn-name').addEventListener('input', e => { f.name = e.target.value; });
      $view.querySelectorAll('[data-format]').forEach(b => b.addEventListener('click', () => { f.format = b.dataset.format; f.pairsEdited = false; draw(); }));
      $view.querySelectorAll('[data-tmode]').forEach(b => b.addEventListener('click', () => { f.mode = b.dataset.tmode; f.pairsEdited = false; draw(); }));
      $view.querySelectorAll('[data-pick]').forEach(cb => cb.addEventListener('change', () => {
        const id = cb.dataset.pick;
        f.selected = cb.checked ? [...f.selected, id] : f.selected.filter(x => x !== id);
        f.pairsEdited = false; draw();
      }));
      document.getElementById('tn-all').addEventListener('click', () => {
        f.selected = f.selected.length === everyone.length ? [myId()] : everyone.map(p => p.id); f.pairsEdited = false; draw();
      });
      const rep = document.getElementById('tn-repair');
      if (rep) rep.addEventListener('click', () => { f.seed = Math.floor(Math.random() * 1e9); f.pairsEdited = false; draw(); });
      $view.querySelectorAll('[data-pair]').forEach(sel => sel.addEventListener('change', () => {
        const [i, j] = sel.dataset.pair.split(':').map(Number); f.pairs[i][j] = sel.value; f.pairsEdited = true;
        const dup = f.pairs.flat().length !== new Set(f.pairs.flat()).size;
        const err = document.getElementById('tn-pair-err'); err.textContent = dup ? 'Há um jogador em duas duplas.' : ''; err.hidden = !dup;
      }));
      const btn = document.getElementById('tn-create');
      btn.addEventListener('click', () => busy(btn, async () => {
        const players = f.selected.map(id => ({ id, level: levelOf(id) }));
        const t = Tournament.create({ format: f.format, mode: f.mode, players, pairs: pairFormat ? f.pairs : null,
          courts: Math.max(1, Number(f.courts) || 1), rounds: Number(f.rounds) || undefined });
        const name = f.name.trim() || `${Tournament.FORMATS[f.format].label} de ${fmtDate(f.date)}`;
        const saved = await B.createTournament({ ...t, name, date: f.date, clubId: f.clubId, pairsManual: pairFormat && f.pairsEdited });
        state.newTournament = null;
        toast('Torneio criado'); go('torneio/' + encodeURIComponent(saved.id));
      }).catch(() => {}));
    }
    draw();
  }

  async function renderTorneio() {
    const id = routeParam;
    if (!id) { go('torneios'); return; }
    loading('A carregar o torneio…');
    const [, list] = await Promise.all([state.players.length ? null : loadPlayersAndRatings(), B.listTournaments()]);
    state.tournaments = list;
    const t = list.find(x => String(x.id) === String(id));
    if (!t) { $view.innerHTML = '<a href="#torneios" class="back">← Torneios</a><div class="card empty"><p>Este torneio já não existe.</p></div>'; return; }
    const N = namer(everyoneList());
    const org = isOrganizer(t) && t.status === 'a decorrer';
    const res = Tournament.resolve(t);
    const F = Tournament.FORMATS[t.format];
    const [stl, stc] = T_STATUS[t.status] || [t.status, ''];
    const anyResult = t.matches.some(m => m.result);
    const pl = t.status === 'terminado' ? Tournament.placements(t) : null;
    const pts = Season.DEFAULT_RULES.tournament;

    // Um jogo não pode ser corrigido se um jogo de eliminatória que depende dele já tiver resultado.
    const dependents = (mid) => t.matches.filter(m => m.slotA && (m.slotA.winnerOf === mid) || m.slotB && (m.slotB.winnerOf === mid));
    const isLocked = (m) => {
      if (m.stage === 'grupo') return t.matches.some(k => k.stage === 'eliminatoria' && k.result);
      return dependents(m.id).some(d => d.result || isLocked(d));
    };
    const teamHtml = (team, label, won) => Array.isArray(team)
      ? `<span class="mt ${won ? 'won' : ''}">${esc(N.team(team))}</span>`
      : `<span class="mt tbd">${esc(label || 'por definir')}</span>`;
    const open = t.status === 'a decorrer';
    const teamOf = (m) => Array.isArray(m.teamA) && m.teamA.includes(myId()) ? 'a' : Array.isArray(m.teamB) && m.teamB.includes(myId()) ? 'b' : null;
    const needsMe = (m) => { const r = m.result, mt = teamOf(m);
      return open && r && r.status === 'pendente' && ((mt && mt !== r.submittedTeam) || (!mt && isOrganizer(t))); };
    const matchRow = (m) => {
      const ready = Array.isArray(m.teamA) && Array.isArray(m.teamB);
      const r = m.result, mt = teamOf(m);
      const confirmed = Tournament.isConfirmed(m);
      const canSubmit = open && ready && (mt || isOrganizer(t)) && (!r || r.status === 'contestado');
      const sets = r ? r.sets.map(([a, b]) => `<span class="set">${a}-${b}</span>`).join('') : '';
      let right = '', note = '';
      if (canSubmit) {
        right = `<form class="res-form" data-res="${esc(m.id)}"><input inputmode="numeric" maxlength="20" placeholder="${t.format === 'americano' ? '6-3' : '6-4, 6-3'}" aria-label="Resultado"><button class="btn small-btn primary">OK</button></form>`;
        if (r && r.status === 'contestado') note = `<div class="mnote bad">Contestado (${sets.replace(/<[^>]+>/g, ' ').trim()}) — registem outra vez</div>`;
      } else if (r && r.status === 'pendente') {
        const other = r.submittedTeam === 'a' ? m.teamB : r.submittedTeam === 'b' ? m.teamA : null;
        right = `<span class="sets pend">${sets}</span>`;
        if (needsMe(m)) {
          note = `<div class="mnote">${mt ? 'A outra equipa registou este resultado. Está certo?' : 'Registado por um jogador. Validas como organizador?'}
            <div class="row"><button class="btn small-btn primary" data-tconfirm="${esc(m.id)}:1">Confirmar</button><button class="btn small-btn" data-tconfirm="${esc(m.id)}:0">Contestar</button></div></div>`;
        } else note = `<div class="mnote">À espera que ${esc(other ? N.team(other) : 'a outra equipa')} confirme</div>`;
      } else if (confirmed) {
        right = `<span class="sets">${sets}</span>${open && isOrganizer(t) && !isLocked(m) ? `<button class="link small" data-edit="${esc(m.id)}">corrigir</button>` : ''}`;
      } else if (ready) right = '<span class="muted small">por jogar</span>';
      return `<div class="match-row ${needsMe(m) ? 'needs-me' : ''}" data-mid="${esc(m.id)}">
        ${m.court && m.stage !== 'eliminatoria' ? `<span class="court" title="Campo">C${m.court}</span>` : ''}
        <div class="mteams">${teamHtml(m.teamA, m.labelA, confirmed && r.winner === 'a')}<span class="muted small">vs</span>${teamHtml(m.teamB, m.labelB, confirmed && r.winner === 'b')}</div>
        <div class="mres">${right}</div>${note}
      </div>`;
    };
    const toConfirm = res.matches.filter(needsMe).length;

    // --- blocos por formato
    let body = '';
    if (t.format === 'americano') {
      const st = Tournament.americanoStandings(t);
      body += `<h2 class="section-title">Classificação</h2>
        <div class="card list">${st.map((r, i) => `<div class="prow ${r.id === myId() ? 'me-row' : ''}"><div class="pos">${i + 1}</div>
          <div class="grow"><b>${esc(N.full(r.id))}</b><div class="muted small">${r.played} jogos · ${r.wins}V · ${r.points}-${r.against}</div></div>
          <div class="pts-pill">${r.points}<small>jogos</small></div></div>`).join('')}</div>
        <p class="muted small">No americano conta a soma dos jogos ganhos em todas as partidas. Desempate: vitórias, depois saldo.</p>`;
      (t.rounds || []).forEach(rd => {
        const ms = res.matches.filter(m => m.round === rd.round);
        body += `<h2 class="section-title">Ronda ${rd.round}</h2><div class="card">${ms.map(matchRow).join('')}
          ${rd.sitting && rd.sitting.length ? `<p class="muted small">Descansa${rd.sitting.length > 1 ? 'm' : ''}: ${esc(rd.sitting.map(N.short).join(', '))}</p>` : ''}</div>`;
      });
    } else {
      if (t.groups) {
        t.groups.forEach(g => {
          const table = res.groupTables[g.name];
          body += `<h2 class="section-title">Grupo ${g.name}</h2>
            <div class="card list">${table.map((r, i) => `<div class="prow ${r.team.includes(myId()) ? 'me-row' : ''}"><div class="pos">${i + 1}</div>
              <div class="grow"><b>${esc(N.team(r.team))}</b><div class="muted small">${r.played} jogos · ${r.wins}V ${r.losses}D · ${r.gf}-${r.ga}</div></div>
              ${i < 2 ? '<span class="tag">passa</span>' : ''}</div>`).join('')}</div>
            <div class="card">${res.matches.filter(m => m.stage === 'grupo' && m.group === g.name).map(matchRow).join('')}</div>`;
        });
      } else {
        body += `<h2 class="section-title">Duplas</h2><div class="card list">${t.entries.pairs.map((p, i) => `<div class="prow ${p.includes(myId()) ? 'me-row' : ''}"><div class="pos">${i + 1}</div><div class="grow"><b>${esc(N.team(p))}</b></div><span class="muted small">cabeça de série ${i + 1}</span></div>`).join('')}</div>`;
      }
      const ko = res.matches.filter(m => m.stage === 'eliminatoria' && !m.bye);
      const rounds = [...new Set(ko.map(m => m.inRound))].sort((a, b) => b - a);
      rounds.forEach(n => {
        body += `<h2 class="section-title">${Tournament.koRoundName(n)}</h2><div class="card">${ko.filter(m => m.inRound === n).map(matchRow).join('')}</div>`;
      });
      const byes = res.matches.filter(m => m.stage === 'eliminatoria' && m.bye && Array.isArray(m.byeWinner));
      if (byes.length) body += `<p class="muted small">Passam diretamente (isenção): ${esc(byes.map(m => N.team(m.byeWinner)).join(' · '))}</p>`;
    }

    const podium = pl ? (() => {
      const by = (place) => Object.entries(pl).filter(([, v]) => v === place).map(([pid]) => N.short(pid));
      return `<section class="card podium"><div><span>🏆</span><b>${esc(by('campeao').join(' + '))}</b><small>Campeão · +${pts.campeao} pts na época</small></div>
        <div><span>🥈</span><b>${esc(by('finalista').join(' + '))}</b><small>Finalista · +${pts.finalista} pts</small></div>
        ${pl[myId()] ? `<p class="small center">Tu: <b>${esc(Season.PLACE_LABELS[pl[myId()]])}</b> · +${pts[pl[myId()]]} pts na época</p>` : ''}</section>`;
    })() : '';

    $view.innerHTML = `
      <a href="#torneios" class="back">← Torneios</a>
      <div class="title-row"><h1 class="page-title">${esc(t.name)}</h1><span class="status ${stc}">${stl}</span></div>
      <p class="muted small">${fmtDate(t.date)} · ${esc(clubById(t.clubId).name)} · ${esc(F.label)} · ${esc(Tournament.MODES[t.mode].label.toLowerCase())} · organiza ${esc(N.short(t.organizerId))}</p>
      ${podium}
      ${org && res.finished ? '<div class="notice">Todos os jogos têm resultado confirmado. Termina o torneio para as posições contarem na época.</div>' : ''}
      ${org ? `<div class="row org-actions">
        ${res.finished ? '<button id="t-finish" class="btn primary">Terminar torneio</button>' : ''}
        ${!anyResult ? '<button id="t-redraw" class="btn">Sortear de novo</button>' : ''}
        <button id="t-cancel" class="btn ghost">Cancelar torneio</button></div>` : ''}
      ${toConfirm ? `<div class="notice">Tens ${toConfirm} ${toConfirm === 1 ? 'resultado' : 'resultados'} para confirmar neste torneio.</div>` : ''}
      ${open ? `<p class="muted small">Quem joga regista o resultado no fim do jogo e a outra equipa confirma. Só os resultados confirmados contam.${res.pending.length ? ` ${res.pending.length} à espera de confirmação.` : ''}</p>` : ''}
      ${body}
      <section class="card rules-foot">
        <h3>Regras deste torneio</h3>
        <ul><li>${esc(F.desc)}</li><li>${esc(Tournament.MODES[t.mode].label)}: ${esc(Tournament.MODES[t.mode].desc)}</li>
          <li>Resultados: um jogador do jogo regista e alguém da outra equipa confirma ou contesta. O organizador, se não jogar nesse jogo, pode registar ou validar.</li>
          <li>Pontos para a época pela posição final: campeão ${pts.campeao}, finalista ${pts.finalista}, meias-finais ${pts.meias}, quartos de final ${pts.quartos}, participação ${pts.participacao}. Os jogos contam também para o nível.</li></ul>
      </section>
      ${rulesFooter()}`;

    const reload = (msg) => { if (msg) toast(msg); state.players = []; renderTorneio(); };
    $view.querySelectorAll('[data-res]').forEach(form => form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = form.querySelector('input'), btn = form.querySelector('button');
      const sets = Scorer.parseSets(input.value), winner = sets && Rating.winnerFromSets(sets);
      if (!sets || !winner) { toast('Escreve o resultado assim: 6-3 (ou 6-4, 3-6, 10-8)'); input.focus(); return; }
      const rm = res.matches.find(x => x.id === form.dataset.res);
      busy(btn, async () => {
        const st = await B.submitTournamentResult(t.id, rm.id, { sets, winner, teamA: rm.teamA, teamB: rm.teamB });
        reload(st === 'pendente' ? 'Resultado guardado — falta a outra equipa confirmar'
          : st === 'confirmado-simulado' ? 'Resultado guardado (simulação: os adversários confirmam logo)' : 'Resultado guardado e confirmado');
      }).catch(() => {});
    }));
    $view.querySelectorAll('[data-tconfirm]').forEach(b => b.addEventListener('click', () => busy(b, async () => {
      const [mid, v] = b.dataset.tconfirm.split(':');
      await B.confirmTournamentResult(t.id, mid, v === '1');
      reload(v === '1' ? 'Resultado confirmado' : 'Resultado contestado — registem outra vez');
    }).catch(() => {})));
    $view.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
      if (!confirmInline(b, 'Apagar este resultado para o escrever de novo?')) return;
      busy(b, async () => { await B.clearTournamentResult(t.id, b.dataset.edit); reload('Resultado apagado'); }).catch(() => {});
    }));
    const fin = document.getElementById('t-finish');
    if (fin) fin.addEventListener('click', () => busy(fin, async () => {
      await B.setTournamentStatus(t.id, 'terminado'); reload('Torneio terminado — as posições já contam na época');
    }).catch(() => {}));
    const redraw = document.getElementById('t-redraw');
    if (redraw) redraw.addEventListener('click', () => busy(redraw, async () => {
      const players = Object.entries(t.levels).map(([pid, level]) => ({ id: pid, level }));
      const fresh = Tournament.create({ format: t.format, mode: t.mode, players, courts: t.config.courts,
        pairs: t.pairsManual ? t.entries.pairs : null,
        rounds: t.format === 'americano' ? t.config.rounds : undefined });
      Object.assign(t, { matches: fresh.matches, groups: fresh.groups, seeds: fresh.seeds, entries: fresh.entries, rounds: fresh.rounds, config: fresh.config });
      await B.updateTournament(t); reload('Jogos sorteados de novo');
    }).catch(() => {}));
    const cancel = document.getElementById('t-cancel');
    if (cancel) cancel.addEventListener('click', () => {
      if (!confirmInline(cancel, 'Cancelar o torneio? Os resultados deixam de contar.')) return;
      busy(cancel, async () => { await B.setTournamentStatus(t.id, 'cancelado'); toast('Torneio cancelado'); go('torneios'); }).catch(() => {});
    });
  }

  // Confirmação em dois toques no próprio botão (sem janelas do browser).
  function confirmInline(btn, question) {
    if (btn.dataset.armed) return true;
    btn.dataset.armed = '1'; const label = btn.innerHTML; btn.innerHTML = 'Toca outra vez para confirmar';
    toast(question);
    setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.innerHTML = label; } }, 4000);
    return false;
  }

  // ---------- arranque ----------
  (async function boot() {
    loading('A abrir…');
    try {
      await B.init();
      if (B.user()) state.profile = await B.getProfile();
    } catch (e) {
      $view.innerHTML = `<div class="card empty"><h2>Sem ligação</h2><p>${esc(e.message)}</p><button class="btn" onclick="location.reload()">Tentar outra vez</button></div>`;
      return;
    }
    route();
  })();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
