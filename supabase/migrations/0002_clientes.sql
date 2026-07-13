-- Normaliza os dados de cliente (pessoa física ou jurídica) numa tabela
-- própria, para reaproveitar automaticamente nome/documento em negociações
-- futuras com a mesma pessoa. Rode este arquivo DEPOIS do 0001_init.sql.

-- ─────────────────────────────────────────────────────────────
-- Clientes (donos atuais e compradores das cartas)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  documento text not null,
  tipo_pessoa text not null default 'fisica'
    check (tipo_pessoa in ('fisica', 'juridica')),
  telefone text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists clientes_documento_key on public.clientes (documento);

drop trigger if exists trg_clientes_updated_at on public.clientes;
create trigger trg_clientes_updated_at
  before update on public.clientes
  for each row execute function public.set_updated_at();

alter table public.clientes enable row level security;

drop policy if exists "clientes_all" on public.clientes;
create policy "clientes_all" on public.clientes
  for all using (true) with check (true);

-- ─────────────────────────────────────────────────────────────
-- Backfill: cria um cliente para cada (nome, documento) já usado em
-- cartas, como vendedor (dono atual) ou comprador.
-- ─────────────────────────────────────────────────────────────
insert into public.clientes (nome, documento)
select distinct on (documento) nome, documento
from (
  select cliente_vendedor_nome as nome, cliente_vendedor_documento as documento
  from public.cartas
  where cliente_vendedor_documento is not null
  union all
  select cliente_comprador_nome as nome, cliente_comprador_documento as documento
  from public.cartas
  where cliente_comprador_documento is not null
) pessoas
order by documento
on conflict (documento) do nothing;

-- ─────────────────────────────────────────────────────────────
-- Liga cartas aos clientes recém-criados e remove as colunas de texto
-- ─────────────────────────────────────────────────────────────
alter table public.cartas
  add column if not exists cliente_vendedor_id uuid references public.clientes(id),
  add column if not exists cliente_comprador_id uuid references public.clientes(id);

update public.cartas c
set cliente_vendedor_id = cl.id
from public.clientes cl
where cl.documento = c.cliente_vendedor_documento
  and c.cliente_vendedor_id is null;

update public.cartas c
set cliente_comprador_id = cl.id
from public.clientes cl
where cl.documento = c.cliente_comprador_documento
  and c.cliente_comprador_id is null;

alter table public.cartas
  alter column cliente_vendedor_id set not null;

alter table public.cartas
  drop constraint if exists venda_requer_comprador;

alter table public.cartas
  add constraint venda_requer_comprador check (
    status = 'estoque'
    or (cliente_comprador_id is not null and data_venda is not null)
  );

alter table public.cartas
  drop column if exists cliente_vendedor_nome,
  drop column if exists cliente_vendedor_documento,
  drop column if exists cliente_comprador_nome,
  drop column if exists cliente_comprador_documento;

create index if not exists cartas_cliente_vendedor_id_idx on public.cartas (cliente_vendedor_id);
create index if not exists cartas_cliente_comprador_id_idx on public.cartas (cliente_comprador_id);
