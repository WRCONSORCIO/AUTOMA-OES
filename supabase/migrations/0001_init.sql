-- Sistema de acompanhamento de compra/venda de cartas contempladas
-- Rode este arquivo no SQL Editor do seu projeto Supabase (ou via supabase db push).

create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────
-- Vendedores (representantes internos que recebem comissão)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.vendedores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  telefone text,
  email text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- Cartas contempladas (entidade central: estoque, compra, venda,
-- intermediação e financeiro derivam todos desta tabela)
-- ─────────────────────────────────────────────────────────────
create sequence if not exists public.cartas_codigo_seq;

create table if not exists public.cartas (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,

  administradora text not null,

  -- 'compra_venda': compramos do cliente e revendemos depois (fica em estoque até vender)
  -- 'intermediacao': operação de ponta a ponta (compra e venda praticamente simultâneas)
  tipo_negociacao text not null default 'compra_venda'
    check (tipo_negociacao in ('compra_venda', 'intermediacao')),

  -- 'estoque': já compramos, ainda não vendemos | 'vendida': ciclo concluído
  status text not null default 'estoque'
    check (status in ('estoque', 'vendida')),

  vendedor_id uuid references public.vendedores(id) on delete set null,

  -- dono atual da carta / quem nos vendeu
  cliente_vendedor_nome text not null,
  cliente_vendedor_documento text not null,

  -- quem está comprando a carta da empresa (preenchido quando vendida)
  cliente_comprador_nome text,
  cliente_comprador_documento text,

  valor_carta numeric(14, 2) not null default 0,
  valor_compra numeric(14, 2) not null default 0,
  valor_venda numeric(14, 2),
  valor_parcela numeric(14, 2) not null default 0,
  parcelas_pagas integer not null default 0,
  parcelas_a_pagar integer not null default 0,
  comissao_vendedor numeric(14, 2) not null default 0,

  data_compra date not null default current_date,
  data_venda date,

  observacoes text,

  -- lucro = valor de venda - valor de compra - comissão do vendedor
  lucro numeric(14, 2) generated always as (
    case
      when valor_venda is not null
        then valor_venda - valor_compra - coalesce(comissao_vendedor, 0)
      else null
    end
  ) stored,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint venda_requer_comprador check (
    status = 'estoque'
    or (cliente_comprador_nome is not null and data_venda is not null)
  )
);

create index if not exists cartas_status_idx on public.cartas (status);
create index if not exists cartas_tipo_negociacao_idx on public.cartas (tipo_negociacao);
create index if not exists cartas_administradora_idx on public.cartas (administradora);
create index if not exists cartas_vendedor_id_idx on public.cartas (vendedor_id);
create index if not exists cartas_data_compra_idx on public.cartas (data_compra);
create index if not exists cartas_data_venda_idx on public.cartas (data_venda);

-- ─────────────────────────────────────────────────────────────
-- Código automático (CART-0001, CART-0002, ...)
-- ─────────────────────────────────────────────────────────────
create or replace function public.set_carta_codigo()
returns trigger
language plpgsql
as $$
begin
  if new.codigo is null or new.codigo = '' then
    new.codigo := 'CART-' || lpad(nextval('public.cartas_codigo_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_carta_codigo on public.cartas;
create trigger trg_set_carta_codigo
  before insert on public.cartas
  for each row execute function public.set_carta_codigo();

-- ─────────────────────────────────────────────────────────────
-- updated_at automático
-- ─────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_cartas_updated_at on public.cartas;
create trigger trg_cartas_updated_at
  before update on public.cartas
  for each row execute function public.set_updated_at();

drop trigger if exists trg_vendedores_updated_at on public.vendedores;
create trigger trg_vendedores_updated_at
  before update on public.vendedores
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- RLS: liberado para usuários autenticados e anônimos (uso interno,
-- sem tela de login). Se depois adicionar autenticação, troque as
-- policies "true" por checagens de auth.uid()/role.
-- ─────────────────────────────────────────────────────────────
alter table public.vendedores enable row level security;
alter table public.cartas enable row level security;

drop policy if exists "vendedores_all" on public.vendedores;
create policy "vendedores_all" on public.vendedores
  for all using (true) with check (true);

drop policy if exists "cartas_all" on public.cartas;
create policy "cartas_all" on public.cartas
  for all using (true) with check (true);
