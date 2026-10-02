import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { createGame, applyAction } from '../src/game.js';

const schema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const token = (number) => number.toString(16).padStart(64, '0');
const fresh = (id = 'database-game') => createGame(
  { names: ['阿橙', '阿蓝'] },
  { id, now: '2026-10-02T00:00:00.000Z' },
);

describe('Supabase schema executed in PostgreSQL with pgcrypto', { concurrency: false }, () => {
  let database;

  before(async () => {
    database = new PGlite({ extensions: { pgcrypto } });
    // Supabase supplies these roles. PGlite starts as the database owner.
    await database.exec('create role anon; create role authenticated; create role outsider;');
    await database.exec(schema);
  });

  after(async () => {
    await database?.close();
  });

  async function asRole(role, callback) {
    assert.ok(['anon', 'authenticated', 'outsider'].includes(role));
    await database.exec(`set role ${role}`);
    try {
      return await callback();
    } finally {
      await database.exec('reset role');
    }
  }

  async function rpc(name, values, role = 'anon') {
    const statements = {
      create_game: 'select public.create_game($1::text, $2::jsonb) as result',
      read_game: 'select public.read_game($1::text) as result',
      save_game: 'select public.save_game($1::text, $2::integer, $3::jsonb) as result',
    };
    assert.ok(Object.hasOwn(statements, name));
    return asRole(role, async () => {
      const response = await database.query(statements[name], values);
      return response.rows[0].result;
    });
  }

  const create = (roomToken, state, role) => rpc('create_game', [roomToken, JSON.stringify(state)], role);
  const read = (roomToken, role) => rpc('read_game', [roomToken], role);
  const save = (roomToken, revision, state, role) => rpc('save_game', [roomToken, revision, JSON.stringify(state)], role);

  it('creates and reads a real engine state using only the anon role', async () => {
    const state = fresh();
    const created = await create(token(1), state);
    assert.deepEqual(Object.keys(created).sort(), ['revision', 'state', 'updatedAt']);
    assert.deepEqual(created.state, state);
    assert.equal(created.revision, 0);
    assert.ok(Number.isFinite(Date.parse(created.updatedAt)));
    assert.deepEqual(await read(token(1)), created);
    assert.deepEqual(await read(token(1), 'authenticated'), created);

    const stored = await database.query(
      'select encode(token_hash, \'hex\') as hash from private.dafuweng_games',
    );
    assert.equal(stored.rows.length, 1);
    assert.match(stored.rows[0].hash, /^[a-f0-9]{64}$/);
    assert.notEqual(stored.rows[0].hash, token(1));
  });

  it('does not replace the saved game when create is retried with the same token', async () => {
    const original = await read(token(1));
    const retried = await create(token(1), fresh('a-different-game'));
    assert.deepEqual(retried, original);
  });

  it('saves an actual game action and rejects a stale device without overwriting it', async () => {
    const initial = await read(token(1));
    const moved = applyAction(initial.state, { type: 'ROLL', dice: [1, 2] });
    const updated = await save(token(1), initial.revision, moved);
    assert.equal(updated.revision, initial.revision + 1);
    assert.deepEqual(updated.state, moved);
    assert.ok(Date.parse(updated.updatedAt) >= Date.parse(initial.updatedAt));
    await assert.rejects(save(token(1), initial.revision, initial.state), {
      code: '40001', message: 'revision_conflict',
    });
    assert.deepEqual(await read(token(1)), updated);
  });

  it('permits only one of two saves based on the same revision', async () => {
    const initial = await create(token(2), fresh('two-devices'));
    const first = applyAction(initial.state, { type: 'ROLL', dice: [1, 2] });
    const second = applyAction(initial.state, { type: 'ROLL', dice: [1, 4] });
    // PGlite queues a single PostgreSQL session; this checks compare-and-swap
    // behavior, not lock scheduling between independent database connections.
    const results = await asRole('anon', () => Promise.allSettled([first, second].map((state) =>
      database.query('select public.save_game($1, $2, $3::jsonb) as result',
        [token(2), initial.revision, JSON.stringify(state)]),
    )));
    const successes = results.filter((result) => result.status === 'fulfilled');
    const failures = results.filter((result) => result.status === 'rejected');
    assert.equal(successes.length, 1);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].reason.code, '40001');
    assert.equal(failures[0].reason.message, 'revision_conflict');
    const current = await read(token(2));
    assert.equal(current.revision, 1);
    assert.deepEqual(current, successes[0].value.rows[0].result);
  });

  it('re-running the complete migration preserves existing games and permissions', async () => {
    const previous = await read(token(1));
    await database.exec(schema);
    assert.deepEqual(await read(token(1)), previous);
    const security = await database.query(`
      select relrowsecurity as enabled
      from pg_catalog.pg_class
      where oid = 'private.dafuweng_games'::regclass
    `);
    assert.equal(security.rows[0].enabled, true);
  });

  it('rejects an unknown token without revealing or modifying another room', async () => {
    const previous = await read(token(1));
    await assert.rejects(read(token(999)), { code: 'P0002', message: 'game_not_found' });
    await assert.rejects(save(token(999), 0, fresh()), { code: 'P0002', message: 'game_not_found' });
    assert.deepEqual(await read(token(1)), previous);
  });

  it('denies direct table reads and writes to both public application roles', async () => {
    for (const role of ['anon', 'authenticated']) {
      for (const statement of [
        'select * from private.dafuweng_games',
        'update private.dafuweng_games set revision = 0',
        'delete from private.dafuweng_games',
        "insert into private.dafuweng_games(token_hash, state) values (decode(repeat('00', 32), 'hex'), '{}'::jsonb)",
        "select private.dafuweng_token_hash(repeat('0', 64))",
      ]) {
        await assert.rejects(asRole(role, () => database.query(statement)), { code: '42501' });
      }
    }
    // PUBLIC execution was revoked, so an unrelated role cannot call an RPC.
    await assert.rejects(read(token(1), 'outsider'), { code: '42501' });
    assert.equal((await read(token(1))).revision, 1);
  });

  it('rejects malformed, uppercase, short and newline-suffixed room tokens', async () => {
    for (const invalid of [null, '', 'a'.repeat(63), 'A'.repeat(64), 'g'.repeat(64), `${'a'.repeat(64)}\n`]) {
      for (const action of [() => read(invalid), () => create(invalid, fresh()), () => save(invalid, 0, fresh())]) {
        await assert.rejects(action(), { code: '22023', message: 'invalid_room_token' });
      }
    }
  });

  it('validates JSON shape, version, player count, identities and byte size', async () => {
    const valid = fresh();
    const invalidStates = [
      [null, 'invalid_game_state'],
      [[], 'invalid_game_state'],
      ['not-an-object', 'invalid_game_state'],
      [{ ...valid, schemaVersion: 2 }, 'unsupported_state_version'],
      [{ ...valid, schemaVersion: '1' }, 'unsupported_state_version'],
      [{ ...valid, id: '' }, 'invalid_game_id'],
      [{ ...valid, id: null }, 'invalid_game_id'],
      [{ ...valid, id: 'a'.repeat(129) }, 'invalid_game_id'],
      [{ ...valid, players: {} }, 'invalid_players'],
      [{ ...valid, players: [valid.players[0]] }, 'invalid_players'],
      [{ ...valid, players: Array.from({ length: 5 }, (_, i) => ({ id: `p${i}` })) }, 'invalid_players'],
      [{ ...valid, players: [{ id: null }, { id: 'p2' }] }, 'invalid_player_id'],
      [{ ...valid, players: [{ id: 1 }, { id: 'p2' }] }, 'invalid_player_id'],
      [{ ...valid, players: [{ id: 'p1' }, { id: 'p1' }] }, 'duplicate_player_id'],
      [{ ...valid, oversized: '测'.repeat(45000) }, 'invalid_game_state'],
    ];
    for (const [state, message] of invalidStates) {
      await assert.rejects(create(token(3), state), { code: '22023', message });
    }
    await assert.rejects(read(token(3)), { code: 'P0002', message: 'game_not_found' });
  });

  it('rejects invalid saves without advancing revision or changing identity', async () => {
    const previous = await read(token(1));
    for (const badRevision of [null, -1]) {
      await assert.rejects(save(token(1), badRevision, previous.state), {
        code: '22023', message: 'invalid_revision',
      });
    }
    await assert.rejects(save(token(1), previous.revision, { ...previous.state, schemaVersion: 2 }), {
      code: '22023', message: 'unsupported_state_version',
    });
    await assert.rejects(save(token(1), previous.revision, { ...previous.state, id: 'replacement-game' }), {
      code: '22023', message: 'game_id_changed',
    });
    const renamedPlayer = structuredClone(previous.state);
    renamedPlayer.players[0].id = 'replacement-player';
    await assert.rejects(save(token(1), previous.revision, renamedPlayer), {
      code: '22023', message: 'player_ids_changed',
    });
    const reorderedPlayers = structuredClone(previous.state);
    reorderedPlayers.players.reverse();
    await assert.rejects(save(token(1), previous.revision, reorderedPlayers), {
      code: '22023', message: 'player_ids_changed',
    });
    assert.deepEqual(await read(token(1)), previous);
  });

  it('refuses to replace a conflicting pre-existing function and preserves stored games', async () => {
    const previous = await read(token(1));
    await database.exec("comment on function public.read_game(text) is 'an unrelated application'");
    try {
      await assert.rejects(database.exec(schema), /schema_conflict/);
    } finally {
      // The failed migration intentionally leaves its transaction aborted.
      await database.exec('rollback');
      await database.exec("comment on function public.read_game(text) is 'dafuweng capability storage v1'");
    }
    assert.deepEqual(await read(token(1)), previous);
  });
});
