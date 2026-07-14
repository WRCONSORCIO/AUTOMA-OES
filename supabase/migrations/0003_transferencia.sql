-- Suporte a cartas compradas e transferidas para o nome da própria
-- empresa (sem venda a terceiro) — ex: WR Vendas de Cotas de Consórcio.
-- Rode este arquivo DEPOIS do 0002_clientes.sql.

alter table public.cartas
  add column if not exists data_transferencia date;

alter table public.cartas
  drop constraint if exists cartas_status_check;

alter table public.cartas
  add constraint cartas_status_check
  check (status in ('estoque', 'vendida', 'transferida'));

alter table public.cartas
  drop constraint if exists venda_requer_comprador;

alter table public.cartas
  add constraint situacao_da_carta_valida check (
    case status
      when 'estoque' then true
      when 'vendida' then cliente_comprador_id is not null and data_venda is not null
      when 'transferida' then data_transferencia is not null
      else false
    end
  );
