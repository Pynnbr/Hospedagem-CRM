-- Execute no SQL Editor do Supabase

create table if not exists public.reservas (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  checkin date not null,
  checkout date not null,
  guests int not null default 1 check (guests > 0),
  room text not null default 'Standard'
    check (room in ('Standard','Superior','Suíte','Família')),
  rate numeric(12,2) not null default 0,
  status text not null default 'novo'
    check (status in ('novo','cotacao','sinal','fechado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (checkout >= checkin)
);

create index if not exists reservas_status_idx on public.reservas (status);
create index if not exists reservas_updated_idx on public.reservas (updated_at desc);

-- updated_at muda a cada edição (base do alerta de 24h sem retorno)
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists reservas_touch on public.reservas;
create trigger reservas_touch before update on public.reservas
  for each row execute function public.touch_updated_at();

-- Realtime
alter table public.reservas replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.reservas;
exception when duplicate_object then null;
end $$;

-- RLS
alter table public.reservas enable row level security;

-- ATENÇÃO: política aberta apenas para testes.
-- Em produção, ative o Supabase Auth e restrinja a equipe do hotel:
--   using (auth.role() = 'authenticated')
drop policy if exists "dev_all_access" on public.reservas;
create policy "dev_all_access" on public.reservas
  for all using (true) with check (true);

-- Dados de exemplo (só entram se a tabela estiver vazia)
insert into public.reservas (name, phone, checkin, checkout, guests, room, rate, status, updated_at) select * from (values
  ('Marina Souza',  '(11) 98888-1200', current_date + 20, current_date + 24, 2, 'Suíte',    540, 'fechado', now() - interval '50 hours'),
  ('Carlos Mendes', '(21) 97777-4410', current_date + 35, current_date + 38, 4, 'Família',  420, 'cotacao', now() - interval '30 hours'),
  ('Ana Beatriz',   '(31) 96666-0098', current_date + 12, current_date + 15, 2, 'Superior', 360, 'sinal',   now() - interval '8 hours'),
  ('Rafael Lima',   '(41) 95555-7321', current_date + 50, current_date + 53, 1, 'Standard', 280, 'novo',    now() - interval '2 hours'),
  ('Júlia Prado',   '(71) 94444-5532', current_date + 9,  current_date + 11, 2, 'Standard', 290, 'novo',    now() - interval '27 hours')
) as v(name, phone, checkin, checkout, guests, room, rate, status, updated_at)
where not exists (select 1 from public.reservas);
