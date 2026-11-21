/* I Want to Play Padle — app (piloto Chaves)
 * Os dados passam todos por window.Backend (js/backend.js):
 *  - modo demonstração: neste browser, com jogadores fictícios;
 *  - modo Supabase: contas reais, convites e feedback partilhados.
 */
(function () {
  const { CITY_CENTER, DAYS, BLOCKS, LEVELS, CLUBS } = window.PadelData;
  const { suggestMatches, haversineKm } = window.Matchmaking;
  const Rating = window.Rating, Scorer = window.Scorer;
  const B = window.Backend;
  const DEMO = B.mode === 'local';

  // Preferências da interface (modo sozinho/dupla, parceiro) — ficam sempre neste dispositivo.
  const prefs = {
    get() { try { return JSON.parse(localStorage.getItem('iwtpp:prefs')) || {}; } catch (e) { return {}; } },
    set(v) { try { localStorage.setItem('iwtpp:prefs', JSON.stringify(v)); } catch (e) { /* sem armazenamento */ } }
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
    feedback: renderFeedback, marcador: renderMarcador, perfil: renderPerfil, jogadores: renderJogadores };
  function route() {
    let name = (location.hash || '').slice(1);
    if (!B.user()) name = 'entrar';
    else if (name === 'entrar' || !routes[name]) name = state.profile ? 'jogar' : 'perfil';
    else if (!state.profile && name !== 'perfil') name = 'perfil';
    clearMaps();
    document.body.classList.toggle('no-tabs', name === 'entrar' || name === 'marcador');
    if (name !== 'marcador') releaseWakeLock();
    document.querySelectorAll('.tabs a').forEach(a => a.classList.toggle('active',
      a.dataset.tab === name || (name === 'campo' && a.dataset.tab === 'jogar') || ((name === 'feedback' || name === 'marcador') && a.dataset.tab === 'jogos')));
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
    key: (id) => 'iwtpp:score:' + id,
    get(id) { try { return JSON.parse(localStorage.getItem(this.key(id))); } catch (e) { return null; } },
    set(id, v) { try { localStorage.setItem(this.key(id), JSON.stringify(v)); } catch (e) { /* sem armazenamento */ } },
    clear(id) { try { localStorage.removeItem(this.key(id)); } catch (e) { /* idem */ } }
  };

  function renderMarcador() {
    const g = state.scoreGame;
    if (!g) { go('jogos'); return; }
    const names = (t) => t.map(firstName).join(' + ');
    let saved = scoreStore.get(g.id) || { started: false, points: [], config: { ...Scorer.DEFAULTS } };
    const persist = () => scoreStore.set(g.id, saved);

    function drawSetup() {
      const cfg = saved.config;
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
          <button id="sc-start" class="btn primary big">Começar a marcar</button>
          <p class="muted small">Deixa o telemóvel junto à rede ou no bolso de um jogador. Um toque por ponto; o ecrã fica aceso.</p>
        </section>
        <section class="card">
          <h2>Já sabes o resultado?</h2>
          <label class="field"><span>Escreve os sets da equipa de <b>${esc(names(g.teamA))}</b> primeiro</span>
            <input id="sc-manual" inputmode="numeric" maxlength="30" placeholder="ex.: 6-4, 3-6, 10-8"></label>
          <p id="sc-err" class="error" hidden></p>
          <button id="sc-manual-save" class="btn full">Guardar este resultado</button>
        </section>`;
      $view.querySelectorAll('[data-cfg]').forEach(segEl => segEl.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        saved.config[segEl.dataset.cfg] = b.dataset.v === '1'; persist();
        segEl.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      })));
      document.getElementById('sc-start').addEventListener('click', () => { saved.started = true; persist(); keepAwake(); drawBoard(); });
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
      const rows = (team) => {
        const done = st.sets.map(([a, b]) => `<td class="${(team === 'a' ? a > b : b > a) ? 'won' : ''}">${team === 'a' ? a : b}</td>`).join('');
        // No super tie-break não há jogos: os pontos aparecem nos botões grandes.
        const cur = st.finished || st.superTiebreak ? '' : `<td class="cur">${st.games[team]}</td>`;
        return done + cur;
      };
      $view.innerHTML = `
        <div class="sc-top"><button id="sc-back" class="btn ghost small-btn">← Sair</button>
          <span class="muted small">${saved.config.goldenPoint ? 'Ponto de ouro' : 'Vantagens'} · ${saved.config.superTiebreak ? 'super tie-break' : '3 sets'}</span></div>
        <table class="sc-table" aria-label="Sets">
          <tr class="ta"><th>${esc(names(g.teamA))}</th>${rows('a')}</tr>
          <tr class="tb"><th>${esc(names(g.teamB))}</th>${rows('b')}</tr>
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
          <div class="sc-note">${esc(pd.note) || '&nbsp;'}</div>
          <div class="sc-pads">
            <button class="sc-pad ta" data-pt="a"><span class="sc-names">${esc(names(g.teamA))}</span><span class="sc-pts">${pd.a}</span></button>
            <button class="sc-pad tb" data-pt="b"><span class="sc-names">${esc(names(g.teamB))}</span><span class="sc-pts">${pd.b}</span></button>
          </div>
          <button id="sc-undo" class="btn ghost full" ${saved.points.length ? '' : 'disabled'}>↶ Anular o último ponto</button>`}`;

      $view.querySelectorAll('[data-pt]').forEach(b => b.addEventListener('click', () => {
        saved.points.push(b.dataset.pt); persist();
        if (navigator.vibrate) navigator.vibrate(15);
        drawBoard();
      }));
      const undo = document.getElementById('sc-undo');
      if (undo) undo.addEventListener('click', () => { saved.points.pop(); persist(); drawBoard(); });
      document.getElementById('sc-back').addEventListener('click', () => {
        toast(saved.points.length ? 'O marcador fica guardado — podes continuar depois' : 'Saíste do marcador'); go('jogos');
      });
      const save = document.getElementById('sc-save');
      if (save) save.addEventListener('click', () => saveResult(save, st.sets, st.winner));
    }

    function saveResult(btn, sets, winner) {
      busy(btn, async () => {
        const before = myLevel();
        await B.submitResult(g.id, { sets, winner });
        scoreStore.clear(g.id); state.scoreGame = null;
        await loadPlayersAndRatings();
        const after = myLevel();
        const changed = Math.abs(after - before) >= 0.005;
        toast(changed ? `Resultado guardado · o teu nível: ${lvl(before)} → ${lvl(after)}` : 'Resultado guardado — à espera da confirmação da outra equipa');
        go('jogos');
      }).catch(() => {});
    }

    if (saved.started) { keepAwake(); drawBoard(); } else drawSetup();
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

  // ---------- RANKING ----------
  async function renderJogadores() {
    loading();
    await loadPlayersAndRatings();
    const view = state.prefs.rankView || 'jogadores';
    const me = state.profile ? { id: myId(), name: state.profile.name, side: state.profile.side, radiusKm: state.profile.radiusKm, availability: state.profile.availability, declaredLevel: state.profile.level } : null;
    const everyone = [...state.players, ...(me ? [me] : [])];
    const byId = Object.fromEntries(everyone.map(p => [p.id, p]));
    const nameOf = (id) => id === myId() ? 'Tu' : (byId[id] ? byId[id].name : '?');
    const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const trend = (t) => t > 0.02 ? '<span class="up" title="A subir nos últimos jogos">▲</span>' : t < -0.02 ? '<span class="down" title="A descer nos últimos jogos">▼</span>' : '';

    const ranked = Rating.rankPlayers(state.ratings.players).filter(r => byId[r.id]);
    const unranked = everyone.filter(p => !ranked.some(r => r.id === p.id)).sort((a, b) => (b.declaredLevel || 0) - (a.declaredLevel || 0));
    const pairs = Rating.rankPairs(state.ratings.pairs).filter(pr => pr.ids.every(id => byId[id]));

    const playersHTML = `
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
      <p class="muted">${DEMO ? 'Modo demonstração: resultados fictícios de setembro a novembro, mais os teus jogos.' : 'Só contam resultados confirmados pelas duas equipas.'}</p>
      <div class="segmented" role="tablist">
        <button type="button" data-rank="jogadores" class="${view === 'jogadores' ? 'on' : ''}">Jogadores</button>
        <button type="button" data-rank="parelhas" class="${view === 'parelhas' ? 'on' : ''}">Parelhas</button>
      </div>
      ${view === 'parelhas' ? pairsHTML : playersHTML}`;
    $view.querySelectorAll('[data-rank]').forEach(b => b.addEventListener('click', () => {
      state.prefs.rankView = b.dataset.rank; prefs.set(state.prefs); renderJogadores();
    }));
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
