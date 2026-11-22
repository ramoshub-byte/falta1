/* Camada de dados — a app fala só com isto.
 *  - Modo demonstração (sem configuração): tudo em localStorage, com os jogadores fictícios de js/data.js.
 *    Os jogadores fictícios aceitam os convites automaticamente, para se poder testar o fluxo todo.
 *  - Modo Supabase (js/config.js preenchido): contas, perfis, jogos, convites, feedback e torneios partilhados.
 *
 * Torneios: o objeto criado por js/tournament.js, mais { id, name, date, clubId, status, organizerId }.
 * Resultados de torneio: um jogador do jogo regista, a outra equipa confirma ou contesta; o organizador, se não
 * jogar nesse jogo, regista ou valida diretamente. Só o organizador corrige, termina, cancela ou volta a sortear.
 * Os jogos de torneio CONFIRMADOS entram em listResults() com tournamentId, para contarem no nível e na época.
 *
 * Formato de um jogo devolvido por listGames():
 *  { id, slot, date:'AAAA-MM-DD', clubId, status, balance, createdBy,
 *    teamA:[{id,name,level,response}], teamB:[...], myFeedback: {...}|null,
 *    result: { sets:[[6,4],[6,3]], winner:'a'|'b', submittedBy, submittedTeam:'a'|'b',
 *              status:'pendente'|'confirmado'|'contestado' } | null }
 *
 * Resultados: uma equipa regista (marcador ou à mão), a outra confirma ou contesta.
 * Só os resultados confirmados entram no nível e nos rankings (listResults()).
 */
(function (root) {
  const cfg = root.PADEL_CONFIG || {};
  const { PLAYERS, SEED_PLAYER_RATINGS, SEED_RESULTS } = root.PadelData;
  const DEFAULT_REL = root.Matchmaking.DEFAULT_RELIABILITY;
  const PRIOR_WEIGHT = 3, TRUSTED_MIN_FORMS = 3, TRUSTED_MIN_REL = 0.85;
  const CRITERIA = ['limpeza', 'balnearios', 'servicos'];

  const LIVE_MAX_AGE_MS = 20 * 60000; // o ecrã mostra os marcadores atualizados nos últimos 20 minutos
  const roundCoord = (x) => Math.round(x * 100) / 100; // ~1 km: não guardamos a morada exata de ninguém

  // Jogos de torneio com resultado → resultados para o nível e para a época (marcados com tournamentId).
  function tournamentResults(list) {
    const out = [];
    (list || []).forEach(t => {
      if (t.status === 'cancelado') return;
      (t.matches || []).forEach(m => {
        if (!root.Tournament.isConfirmed(m) || !Array.isArray(m.teamA) || !Array.isArray(m.teamB) || m.teamA.length !== 2 || m.teamB.length !== 2) return;
        out.push({ id: `${t.id}:${m.id}`, date: t.date, teamA: m.teamA, teamB: m.teamB, sets: m.result.sets, winner: m.result.winner, tournamentId: t.id });
      });
    });
    return out;
  }

  function demoTournament() {
    const T = root.Tournament, rand = T.makeRand(2026);
    const players = PLAYERS.slice(0, 8).map(p => ({ id: p.id, level: p.level }));
    const t = T.create({ format: 'americano', mode: 'ranking', players, courts: 2, seed: 17 });
    const lv = Object.fromEntries(players.map(p => [p.id, p.level]));
    t.matches.forEach(m => {
      const a = (lv[m.teamA[0]] + lv[m.teamA[1]]) / 2, b = (lv[m.teamB[0]] + lv[m.teamB[1]]) / 2;
      const aWins = rand() < 1 / (1 + Math.pow(10, (b - a) * 200 / 400));
      const loser = Math.floor(rand() * 5);
      m.result = { sets: [aWins ? [6, loser] : [loser, 6]], winner: aWins ? 'a' : 'b' };
    });
    return { ...t, id: 'demo-outono', name: 'Americano de Outono', date: '2026-10-17', clubId: root.PadelData.CLUBS[0].id,
      organizerId: 'p1', status: 'terminado', createdAt: '2026-10-10T18:00:00Z' };
  }

  // ---------------------------------------------------------------- modo demonstração
  function createLocal() {
    const KEY = 'falta1:';
    const get = (k, d) => { try { const v = localStorage.getItem(KEY + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
    const set = (k, v) => { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch (e) { /* sem armazenamento */ } };
    const ME = { id: 'me', email: null };

    function stats(id, feedback) {
      const st = { ...(SEED_PLAYER_RATINGS[id] || { forms: 0, yes: 0, total: 0 }) };
      feedback.forEach(f => {
        const a = f.players && f.players[id]; if (!a) return;
        const vals = Object.values(a).filter(v => v === true || v === false);
        if (!vals.length) return;
        st.forms++; st.total += vals.length; st.yes += vals.filter(Boolean).length;
      });
      const reliability = (st.yes + PRIOR_WEIGHT * DEFAULT_REL) / (st.total + PRIOR_WEIGHT);
      return { reliability, trusted: st.forms >= TRUSTED_MIN_FORMS && reliability >= TRUSTED_MIN_REL };
    }

    // Torneios do modo demonstração: começa com um americano fictício já jogado, para a época não começar vazia.
    function loadTournaments() {
      let list = get('tournaments', null);
      if (!list) { list = [demoTournament()]; set('tournaments', list); }
      return list;
    }

    function withMatch(tid, mid, fn) {
      const list = loadTournaments(); const t = list.find(x => x.id === tid);
      if (!t) throw new Error('Torneio não encontrado');
      if (t.status !== 'a decorrer') throw new Error('O torneio já não está a decorrer');
      const m = t.matches.find(x => x.id === mid); if (!m) throw new Error('Jogo não encontrado');
      const out = fn(t, m); set('tournaments', list); return out;
    }

    return {
      mode: 'local',
      async init() {},
      user: () => ME,
      async signIn() { throw new Error('Sem servidor configurado'); },
      async signUp() { throw new Error('Sem servidor configurado'); },
      async signOut() {},
      async getProfile() { return get('profile', null); },
      async saveProfile(p) {
        const clean = { ...p, lat: roundCoord(p.lat), lng: roundCoord(p.lng) };
        set('profile', clean); return clean;
      },
      async listPlayers() {
        const fb = get('feedback', []);
        return PLAYERS.map(p => ({ ...p, ...stats(p.id, fb) }));
      },
      async clubStats() {
        const fb = get('feedback', []); const out = {};
        fb.forEach(f => { (out[f.clubId] = out[f.clubId] || []).push(f.club); });
        Object.keys(out).forEach(id => {
          const list = out[id]; const by = {};
          CRITERIA.forEach(c => { by[c] = list.reduce((s, x) => s + x[c], 0) / list.length; });
          out[id] = { count: list.length, by, overall: CRITERIA.reduce((s, c) => s + by[c], 0) / CRITERIA.length };
        });
        return out;
      },
      async createGame({ slot, date, clubId, balance, teamA, teamB }) {
        const games = get('games-v2', []);
        // Simulação: os jogadores fictícios aceitam logo.
        const mk = (p) => ({ id: p.id, name: p.name, level: p.level, response: 'aceite' });
        const g = { id: 'g' + Date.now(), slot, date, clubId, balance, status: 'confirmado', createdBy: 'me',
          teamA: teamA.map(mk), teamB: teamB.map(mk) };
        games.unshift(g); set('games-v2', games); return g;
      },
      async respond(gameId, accept) {
        const games = get('games-v2', []); const g = games.find(x => x.id === gameId); if (!g) return;
        [...g.teamA, ...g.teamB].forEach(p => { if (p.id === 'me') p.response = accept ? 'aceite' : 'recusado'; });
        const all = [...g.teamA, ...g.teamB];
        g.status = all.some(p => p.response === 'recusado') ? 'recusado' : all.every(p => p.response === 'aceite') ? 'confirmado' : 'proposto';
        set('games-v2', games);
      },
      async cancelGame(gameId) {
        const games = get('games-v2', []); const g = games.find(x => x.id === gameId);
        if (g) { g.status = 'cancelado'; set('games-v2', games); }
      },
      async submitResult(gameId, { sets, winner }) {
        const games = get('games-v2', []); const g = games.find(x => x.id === gameId);
        if (!g || !['confirmado', 'jogado'].includes(g.status)) throw new Error('O jogo ainda não foi confirmado pelos 4');
        if (g.result && g.result.status !== 'contestado') throw new Error('Este jogo já tem resultado');
        const myTeam = g.teamA.some(p => p.id === 'me') ? 'a' : 'b';
        // Simulação: os adversários fictícios confirmam logo.
        g.result = { sets, winner, submittedBy: 'me', submittedTeam: myTeam, status: 'confirmado', at: new Date().toISOString() };
        g.status = 'jogado';
        set('games-v2', games);
        return g.result;
      },
      async confirmResult(gameId, accept) {
        const games = get('games-v2', []); const g = games.find(x => x.id === gameId);
        if (!g || !g.result || g.result.status !== 'pendente') throw new Error('Não há resultado por confirmar');
        g.result.status = accept ? 'confirmado' : 'contestado';
        if (accept) g.status = 'jogado';
        set('games-v2', games);
      },
      async listResults() {
        const mine = get('games-v2', []).filter(g => g.result && g.result.status === 'confirmado').map(g => ({
          id: g.id, date: g.date, teamA: g.teamA.map(p => p.id), teamB: g.teamB.map(p => p.id),
          sets: g.result.sets, winner: g.result.winner }));
        return [...SEED_RESULTS, ...mine, ...tournamentResults(loadTournaments())];
      },
      async listTournaments() { return loadTournaments().filter(t => t.status !== 'cancelado'); },
      async createTournament(t) {
        const list = loadTournaments();
        const row = { ...t, id: 't' + Date.now(), organizerId: 'me', status: 'a decorrer', createdAt: new Date().toISOString() };
        list.unshift(row); set('tournaments', list); return row;
      },
      async updateTournament(t) {
        const list = loadTournaments(); const i = list.findIndex(x => x.id === t.id);
        if (i < 0) throw new Error('Torneio não encontrado');
        if (list[i].organizerId !== 'me') throw new Error('Só o organizador pode alterar o torneio');
        list[i] = { ...t, updatedAt: new Date().toISOString() }; set('tournaments', list); return list[i];
      },
      // Mesmas regras que as funções do Supabase (submit/confirm/clear_tournament_result, set_tournament_status).
      async submitTournamentResult(tid, mid, { sets, winner, teamA, teamB }) {
        return withMatch(tid, mid, (t, m) => {
          const myTeam = teamA.includes('me') ? 'a' : teamB.includes('me') ? 'b' : null;
          const org = t.organizerId === 'me';
          if (!myTeam && !org) throw new Error('Não jogas neste jogo');
          if (m.result && (m.result.status || 'confirmado') !== 'contestado' && !(org && !myTeam)) throw new Error('Este jogo já tem resultado');
          // Simulação: os adversários fictícios confirmam logo (como nos jogos casuais).
          const status = 'confirmado';
          Object.assign(m, { teamA, teamB, result: { sets, winner, status, submittedBy: 'me', submittedTeam: myTeam, at: new Date().toISOString() } });
          return myTeam ? 'confirmado-simulado' : status;
        });
      },
      async confirmTournamentResult(tid, mid, accept) {
        return withMatch(tid, mid, (t, m) => {
          if (!m.result || m.result.status !== 'pendente') throw new Error('Não há resultado por confirmar');
          const myTeam = (m.teamA || []).includes('me') ? 'a' : (m.teamB || []).includes('me') ? 'b' : null;
          if (!myTeam && t.organizerId !== 'me') throw new Error('Não jogas neste jogo');
          if (myTeam && myTeam === m.result.submittedTeam) throw new Error('Tem de ser a outra equipa a confirmar');
          m.result.status = accept ? 'confirmado' : 'contestado'; m.result.decidedBy = 'me';
          return m.result.status;
        });
      },
      async clearTournamentResult(tid, mid) {
        return withMatch(tid, mid, (t, m) => {
          if (t.organizerId !== 'me') throw new Error('Só o organizador pode corrigir resultados');
          delete m.result; if (m.stage === 'eliminatoria') { m.teamA = null; m.teamB = null; }
        });
      },
      async setTournamentStatus(tid, status) {
        const list = loadTournaments(); const t = list.find(x => x.id === tid);
        if (!t || t.organizerId !== 'me') throw new Error('Só o organizador pode alterar o torneio');
        t.status = status; set('tournaments', list);
      },
      async submitFeedback(gameId, f) {
        const games = get('games-v2', []); const g = games.find(x => x.id === gameId);
        if (!g || !['confirmado', 'jogado'].includes(g.status)) throw new Error('O jogo ainda não foi confirmado pelos 4');
        const fb = get('feedback', []);
        if (fb.some(x => x.gameId === gameId)) throw new Error('Já deste feedback a este jogo');
        fb.push({ ...f, gameId, clubId: g.clubId, createdAt: new Date().toISOString() }); set('feedback', fb);
        g.status = 'jogado'; set('games-v2', games);
      },
      // Marcador ao vivo: neste browser (o ecrã do clube aberto no mesmo browser vê-o).
      async pushLiveScore(gameId, live) {
        const all = get('live', {});
        all[gameId] = { ...live, gameId, updatedAt: new Date().toISOString() };
        set('live', all);
      },
      async clearLiveScore(gameId) { const all = get('live', {}); delete all[gameId]; set('live', all); },
      async listLiveScores() {
        const all = get('live', {});
        return Object.values(all).filter(x => Date.now() - Date.parse(x.updatedAt) < LIVE_MAX_AGE_MS);
      },
      async listGames() {
        const fb = get('feedback', []);
        return get('games-v2', []).map(g => ({ ...g, result: g.result || null, myFeedback: fb.find(f => f.gameId === g.id) || null }));
      }
    };
  }

  // ---------------------------------------------------------------- modo Supabase
  function createSupabase() {
    let sb = null, session = null;
    const ok = ({ data, error }) => { if (error) throw new Error(translate(error.message)); return data; };
    function translate(msg) {
      const map = {
        'Invalid login credentials': 'Email ou palavra-passe errados',
        'User already registered': 'Já existe uma conta com este email',
        'Email not confirmed': 'Ainda não confirmaste o email — vê a tua caixa de correio',
        'Password should be at least 6 characters.': 'A palavra-passe precisa de pelo menos 6 caracteres'
      };
      return map[msg] || msg;
    }
    const uid = () => session && session.user.id;
    // O que vai para a coluna "data" (o resto são colunas próprias).
    const tournamentData = (t) => { const { id, name, clubId, date, status, organizerId, createdAt, updatedAt, ...rest } = t; return rest; };
    const fromRow = (r) => r && ({ id: r.id, name: r.name, level: Number(r.level), side: r.side, availability: r.availability || [],
      lat: r.lat, lng: r.lng, radiusKm: r.radius_km, pairId: null, publicRanking: r.public_ranking !== false });
    function loadScript(src) {
      return new Promise((resolve, reject) => {
        const s = document.createElement('script'); s.src = src; s.onload = resolve;
        s.onerror = () => reject(new Error('Sem ligação ao servidor')); document.head.appendChild(s);
      });
    }

    return {
      mode: 'supabase',
      async init() {
        if (!root.supabase) await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');
        // Aceita o "Project URL" e também o endereço da API REST (…supabase.co/rest/v1/), que é um engano comum.
        const url = String(cfg.supabaseUrl).trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
        sb = root.supabase.createClient(url, cfg.supabaseAnonKey);
        session = ok(await sb.auth.getSession()).session;
        sb.auth.onAuthStateChange((_e, s) => { session = s; });
      },
      user: () => session ? { id: session.user.id, email: session.user.email } : null,
      async signIn(email, password) {
        session = ok(await sb.auth.signInWithPassword({ email, password })).session;
      },
      async signUp(email, password) {
        const data = ok(await sb.auth.signUp({ email, password }));
        session = data.session;
        return { needsConfirmation: !data.session };
      },
      async signOut() { await sb.auth.signOut(); session = null; },
      async getProfile() {
        return fromRow(ok(await sb.from('profiles').select('*').eq('id', uid()).maybeSingle()));
      },
      async saveProfile(p) {
        const row = { id: uid(), name: p.name, level: p.level, side: p.side, availability: p.availability,
          lat: roundCoord(p.lat), lng: roundCoord(p.lng), radius_km: p.radiusKm, public_ranking: p.publicRanking !== false,
          updated_at: new Date().toISOString() };
        return fromRow(ok(await sb.from('profiles').upsert(row).select().single()));
      },
      async listPlayers() {
        const [rows, st] = await Promise.all([
          sb.from('profiles').select('*').neq('id', uid()).then(ok),
          sb.rpc('player_stats').then(ok)
        ]);
        const byId = Object.fromEntries((st || []).map(s => [s.player_id, s]));
        return rows.map(r => {
          const s = byId[r.id];
          return { ...fromRow(r), reliability: s ? Number(s.reliability) : DEFAULT_REL, trusted: !!(s && s.trusted) };
        });
      },
      async clubStats() {
        const out = {};
        (ok(await sb.rpc('club_stats')) || []).forEach(r => {
          out[r.club_id] = { count: r.count, overall: Number(r.overall),
            by: { limpeza: Number(r.limpeza), balnearios: Number(r.balnearios), servicos: Number(r.servicos) } };
        });
        return out;
      },
      async createGame({ slot, date, clubId, balance, teamA, teamB }) {
        const id = ok(await sb.rpc('create_game', { p_slot: slot, p_date: date, p_club: clubId, p_balance: balance,
          p_team_a: teamA.map(p => p.id), p_team_b: teamB.map(p => p.id) }));
        return { id };
      },
      async listGames() {
        const [games, fbs] = await Promise.all([
          sb.from('games').select('id,slot,play_date,club_id,status,balance,created_by,game_players(player_id,team,response,profiles(name,level)),game_results(sets,winner,submitted_by,submitted_team,status)')
            .order('play_date', { ascending: false }).order('created_at', { ascending: false }).then(ok),
          sb.from('feedback').select('*').eq('author_id', uid()).then(ok)
        ]);
        return games.map(g => {
          const pl = (t) => g.game_players.filter(x => x.team === t)
            .map(x => ({ id: x.player_id, name: x.profiles ? x.profiles.name : '?', level: x.profiles ? Number(x.profiles.level) : 0, response: x.response }));
          const f = fbs.find(x => x.game_id === g.id);
          const r = Array.isArray(g.game_results) ? g.game_results[0] : g.game_results;
          return { id: g.id,
            result: r ? { sets: r.sets, winner: r.winner, submittedBy: r.submitted_by, submittedTeam: r.submitted_team, status: r.status } : null, slot: g.slot, date: g.play_date, clubId: g.club_id, status: g.status, balance: g.balance,
            createdBy: g.created_by, teamA: pl('a'), teamB: pl('b'),
            myFeedback: f ? { club: { limpeza: f.limpeza, balnearios: f.balnearios, servicos: f.servicos },
              winner: f.winner, score: f.score, difficulty: f.difficulty, vibe: f.vibe } : null };
        });
      },
      async respond(gameId, accept) { return ok(await sb.rpc('respond_game', { p_game: gameId, p_accept: accept })); },
      async cancelGame(gameId) { ok(await sb.rpc('cancel_game', { p_game: gameId })); },
      async submitResult(gameId, { sets, winner }) {
        return ok(await sb.rpc('submit_result', { p_game: gameId, p_sets: sets, p_winner: winner }));
      },
      async confirmResult(gameId, accept) { ok(await sb.rpc('confirm_result', { p_game: gameId, p_accept: accept })); },
      // Marcador ao vivo: só os 4 jogadores escrevem; o ecrã do clube lê com public_live_scores() (sem conta).
      async pushLiveScore(gameId, { points, config }) {
        ok(await sb.rpc('push_live_score', { p_game: gameId, p_points: points, p_config: config }));
      },
      async clearLiveScore(gameId) { ok(await sb.rpc('clear_live_score', { p_game: gameId })); },
      async listResults() {
        return (ok(await sb.rpc('confirmed_results')) || []).map(r => ({ id: r.id, date: r.play_date,
          teamA: r.team_a, teamB: r.team_b, sets: r.sets, winner: r.winner, tournamentId: r.tournament_id || undefined }));
      },
      async listTournaments() {
        const rows = ok(await sb.from('tournaments').select('*').neq('status', 'cancelado').order('play_date', { ascending: false }));
        return rows.map(r => ({ ...(r.data || {}), id: r.id, name: r.name, clubId: r.club_id, date: r.play_date,
          format: r.format, mode: r.mode, status: r.status, organizerId: r.organizer_id, createdAt: r.created_at }));
      },
      async createTournament(t) {
        const id = ok(await sb.rpc('create_tournament', { p_name: t.name, p_club: t.clubId, p_date: t.date,
          p_format: t.format, p_mode: t.mode, p_data: tournamentData(t) }));
        return { ...t, id, organizerId: uid(), status: 'a decorrer' };
      },
      async updateTournament(t) {
        ok(await sb.rpc('update_tournament', { p_id: t.id, p_data: tournamentData(t), p_status: t.status }));
        return t;
      },
      async submitTournamentResult(tid, mid, { sets, winner, teamA, teamB }) {
        return ok(await sb.rpc('submit_tournament_result', { p_id: tid, p_match: mid, p_sets: sets, p_winner: winner, p_team_a: teamA, p_team_b: teamB }));
      },
      async confirmTournamentResult(tid, mid, accept) {
        return ok(await sb.rpc('confirm_tournament_result', { p_id: tid, p_match: mid, p_accept: accept }));
      },
      async clearTournamentResult(tid, mid) { ok(await sb.rpc('clear_tournament_result', { p_id: tid, p_match: mid })); },
      async setTournamentStatus(tid, status) { ok(await sb.rpc('set_tournament_status', { p_id: tid, p_status: status })); },
      async submitFeedback(gameId, f) {
        const ratings = Object.entries(f.players || {}).map(([target, a]) => ({ target, ...a }));
        ok(await sb.rpc('submit_feedback', { p_game: gameId, p_limpeza: f.club.limpeza, p_balnearios: f.club.balnearios,
          p_servicos: f.club.servicos, p_winner: f.winner, p_score: f.score || '', p_difficulty: f.difficulty,
          p_vibe: f.vibe, p_ratings: ratings }));
      }
    };
  }

  root.Backend = (cfg.supabaseUrl && cfg.supabaseAnonKey) ? createSupabase() : createLocal();
})(window);
