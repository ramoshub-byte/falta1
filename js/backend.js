/* Camada de dados — a app fala só com isto.
 *  - Modo demonstração (sem configuração): tudo em localStorage, com os jogadores fictícios de js/data.js.
 *    Os jogadores fictícios aceitam os convites automaticamente, para se poder testar o fluxo todo.
 *  - Modo Supabase (js/config.js preenchido): contas, perfis, jogos, convites e feedback partilhados.
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

  const roundCoord = (x) => Math.round(x * 100) / 100; // ~1 km: não guardamos a morada exata de ninguém

  // ---------------------------------------------------------------- modo demonstração
  function createLocal() {
    const KEY = 'iwtpp:';
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
        return [...SEED_RESULTS, ...mine];
      },
      async submitFeedback(gameId, f) {
        const games = get('games-v2', []); const g = games.find(x => x.id === gameId);
        if (!g || !['confirmado', 'jogado'].includes(g.status)) throw new Error('O jogo ainda não foi confirmado pelos 4');
        const fb = get('feedback', []);
        if (fb.some(x => x.gameId === gameId)) throw new Error('Já deste feedback a este jogo');
        fb.push({ ...f, gameId, clubId: g.clubId, createdAt: new Date().toISOString() }); set('feedback', fb);
        g.status = 'jogado'; set('games-v2', games);
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
    const fromRow = (r) => r && ({ id: r.id, name: r.name, level: Number(r.level), side: r.side, availability: r.availability || [],
      lat: r.lat, lng: r.lng, radiusKm: r.radius_km, pairId: null });
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
        sb = root.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
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
          lat: roundCoord(p.lat), lng: roundCoord(p.lng), radius_km: p.radiusKm, updated_at: new Date().toISOString() };
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
      async listResults() {
        return (ok(await sb.rpc('confirmed_results')) || []).map(r => ({ id: r.game_id, date: r.play_date,
          teamA: r.team_a, teamB: r.team_b, sets: r.sets, winner: r.winner }));
      },
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
