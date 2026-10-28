const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const account = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
test('SQL migration is repeatable, isolates users and returns incremental updates and tombstones', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema auth; create schema storage;
      create role authenticated;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated;
      grant execute on function auth.uid() to authenticated;
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects (id uuid primary key, bucket_id text, name text);
      create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1, '/') $$;
      insert into auth.users values ('${account}'), ('${other}');
    `);
    const schema = fs.readFileSync(require('node:path').join(__dirname, '../supabase-schema.sql'), 'utf8');
    await db.exec(schema);
    await db.exec(schema);
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${account}', false);`);
    const event = { id: '33333333-3333-4333-8333-333333333333', type: 'cigarette', timestamp: '2026-01-01T12:00:00Z', updated_at: '2026-01-01T12:00:00Z' };
    await db.query('select public.merge_smokelog_data($1::jsonb, $2::jsonb, $3::jsonb)', [JSON.stringify([event]), '[]', '[]']);
    const pull = async cursor => (await db.query('select public.smokelog_changes($1::bigint, 1) as page', [cursor])).rows[0].page;
    const first = await pull('0');
    assert.equal(first.changes.length, 1);
    assert.equal(first.changes[0].record.id, event.id);
    assert.equal(first.changes[0].record.user_id, undefined);
    assert.equal((await pull(first.cursor)).changes.length, 0);
    await db.query('select public.merge_smokelog_data($1::jsonb, $2::jsonb, $3::jsonb)', [JSON.stringify([{ ...event, updated_at: '2026-02-01', deleted_at: '2026-02-01' }]), '[]', '[]']);
    const deleted = await pull(first.cursor);
    assert.ok(deleted.changes[0].record.deleted_at);
    assert.ok(BigInt(deleted.cursor) > BigInt(first.cursor));
    await db.query('select public.merge_smokelog_data($1::jsonb, $2::jsonb, $3::jsonb)', [JSON.stringify([event]), '[]', '[]']);
    assert.equal((await pull(deleted.cursor)).changes.length, 0, 'old backup must not resurrect a tombstone');
    await db.exec(`select set_config('request.jwt.claim.sub', '${other}', false);`);
    assert.equal((await pull('0')).changes.length, 0, 'RLS must isolate accounts');
    await db.exec(`reset role; delete from auth.users where id = '${account}';`);
    assert.equal((await db.query('select count(*)::int as count from public.smokelog_events')).rows[0].count, 0);
  } finally { await db.close(); }
});
