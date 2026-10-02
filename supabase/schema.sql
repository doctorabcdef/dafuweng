-- Run this entire file once in the Supabase SQL Editor, then configure the
-- project's URL and publishable/anon key in the web app. Anonymous Auth is not
-- required. Anyone holding a room's 256-bit link token can read/write that room.
-- Re-running this file preserves all games. It never drops existing objects.
begin;

create schema if not exists private;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Refuse to replace unrelated objects in a project shared with another app.
do $migration$
declare
  marker constant text := 'dafuweng capability storage v1';
  signature text;
  object_id oid;
begin
  if pg_catalog.to_regprocedure('extensions.digest(text,text)') is null then
    raise exception 'pgcrypto must provide extensions.digest(text,text); check the extension schema before running this file';
  end if;

  object_id := pg_catalog.to_regclass('private.dafuweng_games');
  if object_id is not null
     and pg_catalog.obj_description(object_id, 'pg_class') is distinct from marker then
    raise exception 'schema_conflict: private.dafuweng_games already exists and is not managed by this application';
  end if;

  foreach signature in array array[
    'private.dafuweng_token_hash(text)',
    'private.dafuweng_validate_state(jsonb)',
    'public.create_game(text,jsonb)',
    'public.read_game(text)',
    'public.save_game(text,integer,jsonb)'
  ] loop
    object_id := pg_catalog.to_regprocedure(signature);
    if object_id is not null
       and pg_catalog.obj_description(object_id, 'pg_proc') is distinct from marker then
      raise exception 'schema_conflict: % already exists and is not managed by this application', signature;
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in ('create_game', 'read_game', 'save_game')
      and pg_catalog.obj_description(procedure.oid, 'pg_proc') is distinct from marker
  ) then
    raise exception 'schema_conflict: public RPC names create_game/read_game/save_game are already in use';
  end if;
end;
$migration$;

create table if not exists private.dafuweng_games (
  token_hash bytea primary key check (pg_catalog.octet_length(token_hash) = 32),
  state jsonb not null check (pg_catalog.jsonb_typeof(state) = 'object'),
  revision integer not null default 0 check (revision >= 0),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);
comment on table private.dafuweng_games is 'dafuweng capability storage v1';

alter table private.dafuweng_games enable row level security;
revoke all on table private.dafuweng_games from public, anon, authenticated;

create or replace function private.dafuweng_token_hash(p_token text)
returns bytea
language plpgsql
immutable
set search_path = ''
as $function$
begin
  if p_token is null or pg_catalog.length(p_token) <> 64
     or p_token !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'invalid_room_token';
  end if;
  return extensions.digest(p_token, 'sha256');
end;
$function$;
comment on function private.dafuweng_token_hash(text) is 'dafuweng capability storage v1';
revoke all on function private.dafuweng_token_hash(text) from public, anon, authenticated;

create or replace function private.dafuweng_validate_state(p_state jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $function$
declare
  player jsonb;
  player_count integer;
  distinct_ids integer;
begin
  if p_state is null or pg_catalog.jsonb_typeof(p_state) is distinct from 'object'
     or pg_catalog.octet_length(p_state::text) > 131072 then
    raise exception using errcode = '22023', message = 'invalid_game_state';
  end if;
  if p_state -> 'schemaVersion' is distinct from '1'::jsonb then
    raise exception using errcode = '22023', message = 'unsupported_state_version';
  end if;
  if pg_catalog.jsonb_typeof(p_state -> 'id') is distinct from 'string'
     or pg_catalog.length(p_state ->> 'id') not between 1 and 128 then
    raise exception using errcode = '22023', message = 'invalid_game_id';
  end if;
  if pg_catalog.jsonb_typeof(p_state -> 'players') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'invalid_players';
  end if;
  player_count := pg_catalog.jsonb_array_length(p_state -> 'players');
  if player_count not between 2 and 4 then
    raise exception using errcode = '22023', message = 'invalid_players';
  end if;

  for player in select value from pg_catalog.jsonb_array_elements(p_state -> 'players') loop
    if pg_catalog.jsonb_typeof(player) is distinct from 'object'
       or pg_catalog.jsonb_typeof(player -> 'id') is distinct from 'string'
       or pg_catalog.length(player ->> 'id') not between 1 and 128 then
      raise exception using errcode = '22023', message = 'invalid_player_id';
    end if;
  end loop;
  select pg_catalog.count(distinct value ->> 'id') into distinct_ids
  from pg_catalog.jsonb_array_elements(p_state -> 'players');
  if distinct_ids <> player_count then
    raise exception using errcode = '22023', message = 'duplicate_player_id';
  end if;
end;
$function$;
comment on function private.dafuweng_validate_state(jsonb) is 'dafuweng capability storage v1';
revoke all on function private.dafuweng_validate_state(jsonb) from public, anon, authenticated;

create or replace function public.create_game(p_token text, p_state jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  room_hash bytea := private.dafuweng_token_hash(p_token);
  saved private.dafuweng_games%rowtype;
begin
  perform private.dafuweng_validate_state(p_state);
  insert into private.dafuweng_games (token_hash, state)
  values (room_hash, p_state)
  on conflict (token_hash) do nothing;

  -- A retry with an existing token returns its current game without resetting it.
  select * into strict saved
  from private.dafuweng_games
  where token_hash = room_hash;
  return pg_catalog.jsonb_build_object(
    'state', saved.state, 'revision', saved.revision, 'updatedAt', saved.updated_at
  );
end;
$function$;
comment on function public.create_game(text, jsonb) is 'dafuweng capability storage v1';
revoke all on function public.create_game(text, jsonb) from public, anon, authenticated;
grant execute on function public.create_game(text, jsonb) to anon, authenticated;

create or replace function public.read_game(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  room_hash bytea := private.dafuweng_token_hash(p_token);
  saved private.dafuweng_games%rowtype;
begin
  select * into saved from private.dafuweng_games where token_hash = room_hash;
  if not found then
    raise exception using errcode = 'P0002', message = 'game_not_found';
  end if;
  return pg_catalog.jsonb_build_object(
    'state', saved.state, 'revision', saved.revision, 'updatedAt', saved.updated_at
  );
end;
$function$;
comment on function public.read_game(text) is 'dafuweng capability storage v1';
revoke all on function public.read_game(text) from public, anon, authenticated;
grant execute on function public.read_game(text) to anon, authenticated;

create or replace function public.save_game(
  p_token text,
  p_expected_revision integer,
  p_state jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  room_hash bytea := private.dafuweng_token_hash(p_token);
  saved private.dafuweng_games%rowtype;
  existing_player_ids jsonb;
  new_player_ids jsonb;
begin
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception using errcode = '22023', message = 'invalid_revision';
  end if;
  perform private.dafuweng_validate_state(p_state);

  -- The row lock makes revision comparison and replacement one atomic action.
  select * into saved from private.dafuweng_games
  where token_hash = room_hash
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'game_not_found';
  end if;
  if saved.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'revision_conflict';
  end if;
  if saved.state -> 'id' is distinct from p_state -> 'id' then
    raise exception using errcode = '22023', message = 'game_id_changed';
  end if;
  select pg_catalog.jsonb_agg(value -> 'id' order by position) into existing_player_ids
  from pg_catalog.jsonb_array_elements(saved.state -> 'players') with ordinality as players(value, position);
  select pg_catalog.jsonb_agg(value -> 'id' order by position) into new_player_ids
  from pg_catalog.jsonb_array_elements(p_state -> 'players') with ordinality as players(value, position);
  if existing_player_ids is distinct from new_player_ids then
    raise exception using errcode = '22023', message = 'player_ids_changed';
  end if;

  update private.dafuweng_games
  set state = p_state,
      revision = revision + 1,
      updated_at = pg_catalog.clock_timestamp()
  where token_hash = room_hash
  returning * into saved;
  return pg_catalog.jsonb_build_object(
    'state', saved.state, 'revision', saved.revision, 'updatedAt', saved.updated_at
  );
end;
$function$;
comment on function public.save_game(text, integer, jsonb) is 'dafuweng capability storage v1';
revoke all on function public.save_game(text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.save_game(text, integer, jsonb) to anon, authenticated;

-- Ask PostgREST to see these RPC signatures immediately after this commits.
notify pgrst, 'reload schema';
commit;
