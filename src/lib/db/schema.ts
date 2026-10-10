// The tables every dev server shares. Run (idempotently) by the first query
// of each server and by scripts/push-data.mjs; no imports, so the script can
// load this file as it is.
//
// documents  the app's data as JSON, keyed like the files it once was under
//            data/ ("accounts", "generations/<id>/set", "sync/<account>/sales");
//            json, not jsonb, so objects keep their keys in the order written
// files      the index of the images and videos in object storage (bytes in
//            the bucket under data/<key>), so listing or checking a file never
//            asks the bucket
// instances  the dev servers running now, each seen every few seconds
//
// A change to a document or file tells every server (NOTIFY "changes",
// "d <version> <key>" or "f <hash> <key>"), so their copies in memory stay current.

export const SCHEMA = `
create table if not exists documents (
  key text primary key,
  value json not null,
  version bigint not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists files (
  key text primary key,
  size bigint not null,
  hash text not null,
  type text not null,
  updated_at timestamptz not null default now()
);

create table if not exists instances (
  id text primary key,
  host text not null,
  started_at timestamptz not null default now(),
  seen_at timestamptz not null default now()
);

create index if not exists documents_prefix on documents (key text_pattern_ops);
create index if not exists files_prefix on files (key text_pattern_ops);

create or replace function notify_document() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    perform pg_notify('changes', 'd 0 ' || old.key);
  else
    perform pg_notify('changes', 'd ' || new.version || ' ' || new.key);
  end if;
  return null;
end $$;

create or replace function notify_file() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    perform pg_notify('changes', 'f - ' || old.key);
  else
    perform pg_notify('changes', 'f ' || new.hash || ' ' || new.key);
  end if;
  return null;
end $$;

create or replace trigger documents_changed after insert or update or delete on documents
  for each row execute function notify_document();

create or replace trigger files_changed after insert or update or delete on files
  for each row execute function notify_file();
`
