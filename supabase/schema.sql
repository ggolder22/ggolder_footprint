-- =====================================================================
-- Huella de Carbono · esquema de base de datos (Supabase / PostgreSQL)
-- Ejecutar completo en Supabase > SQL Editor > New query > Run.
-- Es idempotente: se puede volver a ejecutar sin perder datos.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Perfiles (1 a 1 con auth.users)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  company text,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, company)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'company')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- API key de Climatiq por usuario.
-- RLS activo y SIN políticas: el navegador nunca puede leerla.
-- Solo se escribe con las funciones de abajo y la lee el proxy (service role).
-- ---------------------------------------------------------------------
create table if not exists public.api_keys (
  user_id uuid primary key references auth.users (id) on delete cascade,
  climatiq_key text not null,
  key_hint text,
  updated_at timestamptz not null default now()
);
alter table public.api_keys enable row level security;

create or replace function public.set_climatiq_key(p_key text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if p_key is null or length(trim(p_key)) < 10 then raise exception 'API key inválida'; end if;
  insert into public.api_keys (user_id, climatiq_key, key_hint, updated_at)
  values (auth.uid(), trim(p_key), right(trim(p_key), 4), now())
  on conflict (user_id) do update set climatiq_key = excluded.climatiq_key, key_hint = excluded.key_hint, updated_at = now();
  insert into public.audit_log (owner_id, entity, action, detail) values (auth.uid(), 'cuenta', 'api_key_actualizada', jsonb_build_object('hint', right(trim(p_key), 4)));
end $$;

create or replace function public.delete_climatiq_key()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.api_keys where user_id = auth.uid();
  insert into public.audit_log (owner_id, entity, action) values (auth.uid(), 'cuenta', 'api_key_eliminada');
end $$;

create or replace function public.climatiq_key_status()
returns table (has_key boolean, key_hint text, updated_at timestamptz)
language sql security definer set search_path = public as $$
  select true, k.key_hint, k.updated_at from public.api_keys k where k.user_id = auth.uid()
  union all
  select false, null, null where not exists (select 1 from public.api_keys where user_id = auth.uid())
$$;

-- ---------------------------------------------------------------------
-- Clientes
-- ---------------------------------------------------------------------
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  cuit text,
  sector text,
  address text,
  province text,
  contact_name text,
  contact_email text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists clients_owner_idx on public.clients (owner_id);

-- ---------------------------------------------------------------------
-- Biblioteca de factores de emisión propios, por cliente
-- value = kgCO2e por 1 unidad de activity_unit
-- ---------------------------------------------------------------------
create table if not exists public.factors (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  code text not null,
  name text not null,
  value numeric not null,
  activity_unit text not null,
  source text,
  year int,
  uncertainty numeric,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, code)
);
create index if not exists factors_client_idx on public.factors (client_id);

-- ---------------------------------------------------------------------
-- Huellas (organización / evento / producto). data = estado completo del asistente
-- ---------------------------------------------------------------------
create table if not exists public.footprints (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  type text not null check (type in ('organizacion', 'evento', 'producto')),
  name text not null,
  period_year int,
  status text not null default 'borrador' check (status in ('borrador', 'emitido')),
  completeness numeric default 0,
  total_kg numeric,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists footprints_client_idx on public.footprints (client_id);

-- ---------------------------------------------------------------------
-- Versiones emitidas (inmutables: no hay políticas de update/delete)
-- ---------------------------------------------------------------------
create table if not exists public.footprint_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  footprint_id uuid not null references public.footprints (id) on delete cascade,
  version int not null,
  data jsonb not null,
  totals jsonb,
  note text,
  created_at timestamptz not null default now(),
  unique (footprint_id, version)
);

-- ---------------------------------------------------------------------
-- Registro de auditoría (trazabilidad). Solo inserción y lectura.
-- ---------------------------------------------------------------------
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  client_id uuid references public.clients (id) on delete set null,
  footprint_id uuid references public.footprints (id) on delete set null,
  entity text not null,
  action text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_client_idx on public.audit_log (client_id, created_at desc);
create index if not exists audit_footprint_idx on public.audit_log (footprint_id, created_at desc);

-- ---------------------------------------------------------------------
-- updated_at automático
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists clients_touch on public.clients;
create trigger clients_touch before update on public.clients for each row execute function public.touch_updated_at();
drop trigger if exists factors_touch on public.factors;
create trigger factors_touch before update on public.factors for each row execute function public.touch_updated_at();
drop trigger if exists footprints_touch on public.footprints;
create trigger footprints_touch before update on public.footprints for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Auditoría automática (del lado del servidor, no se puede saltear desde el navegador)
-- ---------------------------------------------------------------------
create or replace function public.audit_clients()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into audit_log (owner_id, client_id, entity, action, detail) values (new.owner_id, new.id, 'cliente', 'creado', jsonb_build_object('nombre', new.name));
  elsif tg_op = 'UPDATE' then
    insert into audit_log (owner_id, client_id, entity, action, detail) values (new.owner_id, new.id, 'cliente', 'modificado', jsonb_build_object('nombre', new.name));
  elsif tg_op = 'DELETE' then
    insert into audit_log (owner_id, client_id, entity, action, detail) values (old.owner_id, null, 'cliente', 'eliminado', jsonb_build_object('nombre', old.name, 'id', old.id));
  end if;
  return coalesce(new, old);
end $$;

create or replace function public.audit_factors()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into audit_log (owner_id, client_id, entity, action, detail) values (new.owner_id, new.client_id, 'factor', 'creado',
      jsonb_build_object('codigo', new.code, 'valor', new.value, 'unidad', new.activity_unit, 'fuente', new.source));
  elsif tg_op = 'UPDATE' then
    if (old.value, old.activity_unit, old.code, coalesce(old.source, '')) is distinct from (new.value, new.activity_unit, new.code, coalesce(new.source, '')) then
      insert into audit_log (owner_id, client_id, entity, action, detail) values (new.owner_id, new.client_id, 'factor', 'modificado',
        jsonb_build_object('codigo', new.code, 'antes', jsonb_build_object('valor', old.value, 'unidad', old.activity_unit, 'fuente', old.source),
                                               'despues', jsonb_build_object('valor', new.value, 'unidad', new.activity_unit, 'fuente', new.source)));
    end if;
  elsif tg_op = 'DELETE' then
    -- si el cliente se está borrando en cascada, no referenciarlo
    insert into audit_log (owner_id, client_id, entity, action, detail) values (old.owner_id, (select c.id from clients c where c.id = old.client_id), 'factor', 'eliminado',
      jsonb_build_object('codigo', old.code, 'valor', old.value, 'unidad', old.activity_unit));
  end if;
  return coalesce(new, old);
end $$;

create or replace function public.audit_footprints()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into audit_log (owner_id, client_id, footprint_id, entity, action, detail) values (new.owner_id, new.client_id, new.id, 'huella', 'creada',
      jsonb_build_object('tipo', new.type, 'nombre', new.name, 'periodo', new.period_year));
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status then
    insert into audit_log (owner_id, client_id, footprint_id, entity, action, detail) values (new.owner_id, new.client_id, new.id, 'huella', 'estado_' || new.status,
      jsonb_build_object('total_kg', new.total_kg, 'completitud', new.completeness));
  elsif tg_op = 'DELETE' then
    insert into audit_log (owner_id, client_id, footprint_id, entity, action, detail) values (old.owner_id, (select c.id from clients c where c.id = old.client_id), null, 'huella', 'eliminada',
      jsonb_build_object('tipo', old.type, 'nombre', old.name, 'id', old.id));
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists clients_audit on public.clients;
create trigger clients_audit after insert or update or delete on public.clients for each row execute function public.audit_clients();
drop trigger if exists factors_audit on public.factors;
create trigger factors_audit after insert or update or delete on public.factors for each row execute function public.audit_factors();
drop trigger if exists footprints_audit on public.footprints;
create trigger footprints_audit after insert or update or delete on public.footprints for each row execute function public.audit_footprints();

-- ---------------------------------------------------------------------
-- Seguridad por fila: cada usuario ve y modifica solo lo suyo
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.factors enable row level security;
alter table public.footprints enable row level security;
alter table public.footprint_versions enable row level security;
alter table public.audit_log enable row level security;

drop policy if exists "perfil propio" on public.profiles;
create policy "perfil propio" on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "clientes propios" on public.clients;
create policy "clientes propios" on public.clients for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "factores propios" on public.factors;
create policy "factores propios" on public.factors for all using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and exists (select 1 from public.clients c where c.id = client_id and c.owner_id = auth.uid()));

drop policy if exists "huellas propias" on public.footprints;
create policy "huellas propias" on public.footprints for all using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and exists (select 1 from public.clients c where c.id = client_id and c.owner_id = auth.uid()));

drop policy if exists "versiones leer" on public.footprint_versions;
create policy "versiones leer" on public.footprint_versions for select using (owner_id = auth.uid());
drop policy if exists "versiones crear" on public.footprint_versions;
create policy "versiones crear" on public.footprint_versions for insert
  with check (owner_id = auth.uid() and exists (select 1 from public.footprints f where f.id = footprint_id and f.owner_id = auth.uid()));

drop policy if exists "auditoria leer" on public.audit_log;
create policy "auditoria leer" on public.audit_log for select using (owner_id = auth.uid());
drop policy if exists "auditoria crear" on public.audit_log;
create policy "auditoria crear" on public.audit_log for insert with check (owner_id = auth.uid());
