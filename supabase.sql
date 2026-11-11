-- Execute no SQL Editor do Supabase

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  service text,
  value numeric(12,2) not null default 0,
  status text not null default 'novo'
    check (status in ('novo','atendimento','proposta','fechado')),
  created_at timestamptz not null default now()
);

create index if not exists leads_status_idx on public.leads (status);
create index if not exists leads_created_idx on public.leads (created_at desc);

-- Realtime
alter table public.leads replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.leads;
exception when duplicate_object then null;
end $$;

-- RLS
alter table public.leads enable row level security;

-- ATENÇÃO: política aberta apenas para desenvolvimento/protótipo.
-- Em produção, adicione user_id uuid default auth.uid() e restrinja por auth.uid().
drop policy if exists "dev_all_access" on public.leads;
create policy "dev_all_access" on public.leads
  for all using (true) with check (true);
