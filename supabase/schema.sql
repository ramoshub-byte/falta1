-- Falta 1 — esquema da base de dados (Supabase / Postgres)
-- Como usar: Supabase → SQL Editor → New query → colar este ficheiro inteiro → Run.
-- Pode ser corrido mais do que uma vez (apaga e recria as funções; as tabelas só são criadas se não existirem).

-- =========================================================
-- Tabelas
-- =========================================================

create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  name        text not null check (char_length(name) between 1 and 40),
  level       numeric(4,2) not null check (level between 0 and 7),
  side        text not null check (side in ('direita','esquerda','ambos')),
  availability text[] not null default '{}',
  lat         double precision not null,   -- guardada arredondada a ~1 km pela app
  lng         double precision not null,
  radius_km   int not null check (radius_km between 1 and 50),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.games (
  id          uuid primary key default gen_random_uuid(),
  slot        text not null,                -- ex.: 'seg-noite'
  play_date   date not null,
  club_id     text not null,                -- id do clube em js/data.js
  status      text not null default 'proposto'
              check (status in ('proposto','confirmado','recusado','cancelado','jogado')),
  balance     int,
  created_by  uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists public.game_players (
  game_id     uuid not null references public.games on delete cascade,
  player_id   uuid not null references public.profiles(id) on delete cascade,
  team        text not null check (team in ('a','b')),
  response    text not null default 'pendente' check (response in ('pendente','aceite','recusado')),
  primary key (game_id, player_id)
);

-- Feedback do jogo e do clube (um por jogador por jogo)
create table if not exists public.feedback (
  game_id     uuid not null references public.games on delete cascade,
  author_id   uuid not null references public.profiles(id) on delete cascade,
  limpeza     int not null check (limpeza between 1 and 5),
  balnearios  int not null check (balnearios between 1 and 5),
  servicos    int not null check (servicos between 1 and 5),
  winner      text not null check (winner in ('a','b','none')),
  score       text check (char_length(score) <= 30),
  difficulty  text not null check (difficulty in ('facil','ok','dificil')),
  vibe        text not null check (vibe in ('mal','normal','bem')),
  created_at  timestamptz not null default now(),
  primary key (game_id, author_id)
);

-- Avaliação de cada jogador. PRIVADA: ninguém lê esta tabela diretamente,
-- só os totais agregados através da função player_stats().
create table if not exists public.player_ratings (
  game_id     uuid not null references public.games on delete cascade,
  author_id   uuid not null references public.profiles(id) on delete cascade,
  target_id   uuid not null references public.profiles(id) on delete cascade,
  pontual     boolean,
  fairplay    boolean,
  repetir     boolean,
  primary key (game_id, author_id, target_id),
  check (author_id <> target_id)
);

-- Resultado do jogo: uma equipa regista, a outra confirma ou contesta.
-- Só os resultados confirmados contam para o nível e para os rankings.
create table if not exists public.game_results (
  game_id         uuid primary key references public.games on delete cascade,
  sets            jsonb not null,             -- ex.: [[6,4],[3,6],[10,8]]
  winner          text not null check (winner in ('a','b')),
  submitted_by    uuid not null references public.profiles(id) on delete cascade,
  submitted_team  text not null check (submitted_team in ('a','b')),
  status          text not null default 'pendente' check (status in ('pendente','confirmado','contestado')),
  decided_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  decided_at      timestamptz
);

create index if not exists game_players_player_idx on public.game_players(player_id);
create index if not exists player_ratings_target_idx on public.player_ratings(target_id);
create index if not exists feedback_game_idx on public.feedback(game_id);

-- =========================================================
-- Segurança (Row Level Security)
-- =========================================================

alter table public.profiles       enable row level security;
alter table public.games          enable row level security;
alter table public.game_players   enable row level security;
alter table public.feedback       enable row level security;
alter table public.player_ratings enable row level security;
alter table public.game_results   enable row level security;

-- Função auxiliar (evita recursão nas regras de game_players)
create or replace function public.is_game_participant(gid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from game_players where game_id = gid and player_id = auth.uid());
$$;

drop policy if exists "perfis visíveis a quem tem conta" on public.profiles;
create policy "perfis visíveis a quem tem conta" on public.profiles
  for select to authenticated using (true);
drop policy if exists "criar o próprio perfil" on public.profiles;
create policy "criar o próprio perfil" on public.profiles
  for insert to authenticated with check (id = auth.uid());
drop policy if exists "editar o próprio perfil" on public.profiles;
create policy "editar o próprio perfil" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "ver jogos onde participo" on public.games;
create policy "ver jogos onde participo" on public.games
  for select to authenticated using (public.is_game_participant(id));

drop policy if exists "ver jogadores dos meus jogos" on public.game_players;
create policy "ver jogadores dos meus jogos" on public.game_players
  for select to authenticated using (public.is_game_participant(game_id));

drop policy if exists "ver o meu feedback" on public.feedback;
create policy "ver o meu feedback" on public.feedback
  for select to authenticated using (author_id = auth.uid());

drop policy if exists "ver resultados dos meus jogos" on public.game_results;
create policy "ver resultados dos meus jogos" on public.game_results
  for select to authenticated using (public.is_game_participant(game_id));

-- player_ratings: sem nenhuma regra de leitura → ninguém lê linhas individuais.
-- Jogos, respostas e feedback só se escrevem através das funções abaixo.

-- =========================================================
-- Funções (a app chama-as com supabase.rpc)
-- =========================================================

-- Propor um jogo: 2 + 2 jogadores; quem propõe fica logo "aceite".
create or replace function public.create_game(
  p_slot text, p_date date, p_club text, p_balance int, p_team_a uuid[], p_team_b uuid[]
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  gid uuid;
  pid uuid;
begin
  if uid is null then raise exception 'Sessão inválida'; end if;
  if coalesce(array_length(p_team_a, 1), 0) <> 2 or coalesce(array_length(p_team_b, 1), 0) <> 2 then
    raise exception 'Um jogo precisa de 2 + 2 jogadores';
  end if;
  if not (uid = any(p_team_a) or uid = any(p_team_b)) then raise exception 'Tens de fazer parte do jogo'; end if;
  if (select count(distinct x) from unnest(p_team_a || p_team_b) x) <> 4 then raise exception 'Jogadores repetidos'; end if;
  if (select count(*) from profiles where id = any(p_team_a || p_team_b)) <> 4 then raise exception 'Jogador desconhecido'; end if;

  insert into games (slot, play_date, club_id, balance, created_by)
  values (p_slot, p_date, p_club, p_balance, uid) returning id into gid;

  foreach pid in array p_team_a loop
    insert into game_players (game_id, player_id, team, response)
    values (gid, pid, 'a', case when pid = uid then 'aceite' else 'pendente' end);
  end loop;
  foreach pid in array p_team_b loop
    insert into game_players (game_id, player_id, team, response)
    values (gid, pid, 'b', case when pid = uid then 'aceite' else 'pendente' end);
  end loop;
  return gid;
end $$;

-- Aceitar ou recusar um convite. Os 4 aceitam → confirmado. Alguém recusa → recusado.
create or replace function public.respond_game(p_game uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  new_status text;
begin
  if (select status from games where id = p_game) not in ('proposto','confirmado','recusado') then
    raise exception 'Este jogo já não aceita respostas';
  end if;
  update game_players set response = case when p_accept then 'aceite' else 'recusado' end
  where game_id = p_game and player_id = uid;
  if not found then raise exception 'Não estás neste jogo'; end if;

  select case
           when bool_or(response = 'recusado') then 'recusado'
           when bool_and(response = 'aceite') then 'confirmado'
           else 'proposto' end
    into new_status
  from game_players where game_id = p_game;

  update games set status = new_status where id = p_game;
  return new_status;
end $$;

-- Cancelar (só quem propôs, e antes de ser jogado)
create or replace function public.cancel_game(p_game uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update games set status = 'cancelado'
  where id = p_game and created_by = auth.uid() and status in ('proposto','confirmado','recusado');
  if not found then raise exception 'Não é possível cancelar este jogo'; end if;
end $$;

-- Feedback pós-jogo. p_ratings = [{"target": uuid, "pontual": bool|null, "fairplay": bool|null, "repetir": bool|null}, ...]
create or replace function public.submit_feedback(
  p_game uuid, p_limpeza int, p_balnearios int, p_servicos int,
  p_winner text, p_score text, p_difficulty text, p_vibe text, p_ratings jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  g games%rowtype;
  r jsonb;
  t uuid;
begin
  select * into g from games where id = p_game;
  if not found or not exists (select 1 from game_players where game_id = p_game and player_id = uid) then
    raise exception 'Não estás neste jogo';
  end if;
  if g.status not in ('confirmado','jogado') then raise exception 'O jogo ainda não foi confirmado pelos 4'; end if;
  if g.play_date > current_date then raise exception 'O feedback só abre no dia do jogo'; end if;
  if exists (select 1 from feedback where game_id = p_game and author_id = uid) then
    raise exception 'Já deste feedback a este jogo';
  end if;

  insert into feedback (game_id, author_id, limpeza, balnearios, servicos, winner, score, difficulty, vibe)
  values (p_game, uid, p_limpeza, p_balnearios, p_servicos, p_winner, nullif(p_score, ''), p_difficulty, p_vibe);

  for r in select * from jsonb_array_elements(coalesce(p_ratings, '[]'::jsonb)) loop
    t := (r->>'target')::uuid;
    if t <> uid and exists (select 1 from game_players where game_id = p_game and player_id = t) then
      insert into player_ratings (game_id, author_id, target_id, pontual, fairplay, repetir)
      values (p_game, uid, t, (r->>'pontual')::boolean, (r->>'fairplay')::boolean, (r->>'repetir')::boolean)
      on conflict do nothing;
    end if;
  end loop;

  update games set status = 'jogado' where id = p_game and status = 'confirmado';
end $$;

-- Registar o resultado (marcador ou à mão). Fica "pendente" até a outra equipa confirmar.
-- Se tinha sido contestado, pode ser registado outra vez por qualquer uma das equipas.
create or replace function public.submit_result(p_game uuid, p_sets jsonb, p_winner text)
returns text language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  g games%rowtype;
  my_team text;
  existing game_results%rowtype;
begin
  select * into g from games where id = p_game;
  select team into my_team from game_players where game_id = p_game and player_id = uid;
  if not found or my_team is null then raise exception 'Não estás neste jogo'; end if;
  if g.status not in ('confirmado','jogado') then raise exception 'O jogo ainda não foi confirmado pelos 4'; end if;
  if g.play_date > current_date then raise exception 'O resultado só pode ser registado no dia do jogo'; end if;
  if p_winner not in ('a','b') then raise exception 'Vencedor inválido'; end if;
  if jsonb_typeof(p_sets) <> 'array' or jsonb_array_length(p_sets) not between 1 and 3 then
    raise exception 'Resultado inválido';
  end if;

  select * into existing from game_results where game_id = p_game;
  if found and existing.status <> 'contestado' then raise exception 'Este jogo já tem resultado'; end if;

  insert into game_results (game_id, sets, winner, submitted_by, submitted_team, status)
  values (p_game, p_sets, p_winner, uid, my_team, 'pendente')
  on conflict (game_id) do update
    set sets = excluded.sets, winner = excluded.winner, submitted_by = excluded.submitted_by,
        submitted_team = excluded.submitted_team, status = 'pendente', decided_by = null,
        created_at = now(), decided_at = null;
  return 'pendente';
end $$;

-- Confirmar ou contestar: só um jogador da equipa que NÃO registou.
create or replace function public.confirm_result(p_game uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  my_team text;
  r game_results%rowtype;
  new_status text;
begin
  select * into r from game_results where game_id = p_game;
  if not found or r.status <> 'pendente' then raise exception 'Não há resultado por confirmar'; end if;
  select team into my_team from game_players where game_id = p_game and player_id = uid;
  if my_team is null then raise exception 'Não estás neste jogo'; end if;
  if my_team = r.submitted_team then raise exception 'Tem de ser a outra equipa a confirmar'; end if;

  new_status := case when p_accept then 'confirmado' else 'contestado' end;
  update game_results set status = new_status, decided_by = uid, decided_at = now() where game_id = p_game;
  if p_accept then update games set status = 'jogado' where id = p_game and status = 'confirmado'; end if;
  return new_status;
end $$;

-- Resultados confirmados de todos os jogos, para calcular níveis e rankings.
-- Mostra quem jogou com quem e o resultado; nunca mostra feedback nem avaliações.
create or replace function public.confirmed_results()
returns table (game_id uuid, play_date date, team_a uuid[], team_b uuid[], sets jsonb, winner text)
language sql stable security definer set search_path = public as $$
  select r.game_id, g.play_date,
         array(select player_id from game_players where game_id = r.game_id and team = 'a' order by player_id),
         array(select player_id from game_players where game_id = r.game_id and team = 'b' order by player_id),
         r.sets, r.winner
  from game_results r join games g on g.id = r.game_id
  where r.status = 'confirmado';
$$;

-- Fiabilidade agregada: só devolve o índice (0–1) e o selo, nunca respostas individuais.
-- Ponto de partida de 80% com o peso de 3 respostas (igual à app).
create or replace function public.player_stats()
returns table (player_id uuid, forms int, reliability numeric, trusted boolean)
language sql stable security definer set search_path = public as $$
  with per_form as (
    select target_id,
           (case when pontual then 1 else 0 end + case when fairplay then 1 else 0 end + case when repetir then 1 else 0 end) as yes,
           (case when pontual is not null then 1 else 0 end + case when fairplay is not null then 1 else 0 end + case when repetir is not null then 1 else 0 end) as total
    from player_ratings
  ), agg as (
    select target_id, count(*) filter (where total > 0)::int as forms, sum(yes) as yes, sum(total) as total
    from per_form group by target_id
  )
  select target_id, forms,
         round((yes + 3 * 0.8) / (total + 3), 3) as reliability,
         (forms >= 3 and (yes + 3 * 0.8) / (total + 3) >= 0.85) as trusted
  from agg;
$$;

-- Média das avaliações de cada clube
create or replace function public.club_stats()
returns table (club_id text, count int, limpeza numeric, balnearios numeric, servicos numeric, overall numeric)
language sql stable security definer set search_path = public as $$
  select g.club_id, count(*)::int,
         round(avg(f.limpeza), 2), round(avg(f.balnearios), 2), round(avg(f.servicos), 2),
         round((avg(f.limpeza) + avg(f.balnearios) + avg(f.servicos)) / 3, 2)
  from feedback f join games g on g.id = f.game_id
  group by g.club_id;
$$;

-- Só utilizadores com sessão podem chamar as funções
revoke execute on function public.create_game(text, date, text, int, uuid[], uuid[]) from public, anon;
revoke execute on function public.respond_game(uuid, boolean) from public, anon;
revoke execute on function public.cancel_game(uuid) from public, anon;
revoke execute on function public.submit_feedback(uuid, int, int, int, text, text, text, text, jsonb) from public, anon;
revoke execute on function public.player_stats() from public, anon;
revoke execute on function public.club_stats() from public, anon;
revoke execute on function public.submit_result(uuid, jsonb, text) from public, anon;
revoke execute on function public.confirm_result(uuid, boolean) from public, anon;
revoke execute on function public.confirmed_results() from public, anon;
grant execute on function public.create_game(text, date, text, int, uuid[], uuid[]) to authenticated;
grant execute on function public.respond_game(uuid, boolean) to authenticated;
grant execute on function public.cancel_game(uuid) to authenticated;
grant execute on function public.submit_feedback(uuid, int, int, int, text, text, text, text, jsonb) to authenticated;
grant execute on function public.player_stats() to authenticated;
grant execute on function public.club_stats() to authenticated;
grant execute on function public.submit_result(uuid, jsonb, text) to authenticated;
grant execute on function public.confirm_result(uuid, boolean) to authenticated;
grant execute on function public.confirmed_results() to authenticated;
