-- =============================================================
-- imputa.me — Esquema de base de datos (PostgreSQL / Supabase)
--
-- Modelo idéntico al de la app de escritorio: tareas con color y una
-- lista de "fichajes" (tramos de tiempo con inicio y fin en ms epoch).
-- Cada usuario solo ve y edita SUS datos (RLS por auth.uid()).
--
-- Cómo usarlo: Supabase -> SQL Editor -> pega este archivo -> Run.
-- =============================================================

create extension if not exists "pgcrypto";

-- -------------------------------------------------------------
-- TAREAS
-- -------------------------------------------------------------
create table if not exists tareas (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nombre     text not null,
  color      text not null,
  creado_en  timestamptz not null default now()
);

-- -------------------------------------------------------------
-- FICHAJES (tramos de tiempo de una tarea). fin_ms NULL = en curso.
-- inicio_ms / fin_ms en milisegundos epoch (Date.now()), igual que el PC.
-- -------------------------------------------------------------
create table if not exists fichajes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tarea_id   uuid not null references tareas(id) on delete cascade,
  inicio_ms  int8 not null,
  fin_ms     int8,
  creado_en  timestamptz not null default now()
);

create index if not exists idx_tareas_user    on tareas(user_id);
create index if not exists idx_fichajes_user   on fichajes(user_id);
create index if not exists idx_fichajes_tarea  on fichajes(tarea_id);
-- Como mucho un fichaje "en curso" por tarea.
create unique index if not exists idx_fichaje_abierto on fichajes(tarea_id) where fin_ms is null;

-- -------------------------------------------------------------
-- SEGURIDAD (RLS): cada usuario, solo lo suyo
-- -------------------------------------------------------------
alter table tareas   enable row level security;
alter table fichajes enable row level security;

drop policy if exists "tareas_propias" on tareas;
create policy "tareas_propias" on tareas for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "fichajes_propios" on fichajes;
create policy "fichajes_propios" on fichajes for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- -------------------------------------------------------------
-- REALTIME: sincronización en vivo entre PC y móvil
-- (si da error "already member", ignóralo: ya estaban añadidas)
-- -------------------------------------------------------------
alter publication supabase_realtime add table tareas;
alter publication supabase_realtime add table fichajes;
