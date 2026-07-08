# WR Consórcio — Cartas Contempladas

Sistema para acompanhar a compra, venda e intermediação de cartas de
consórcio contempladas: quem vendeu a carta para a empresa, quem comprou,
valores, parcelas, comissão do vendedor interno e lucro de cada negociação.

Stack: React + Vite + TypeScript + Tailwind + shadcn/ui + Supabase (Postgres).
Essa é a mesma stack usada pelo Lovable, então o projeto pode ser publicado
lá depois sem precisar reescrever nada.

## 1. Rodando localmente (VS Code)

```bash
npm install
npm run dev
```

Ao abrir `http://localhost:5173`, se o Supabase ainda não estiver
configurado, você verá uma tela explicando os próximos passos (a mesma
coisa descrita abaixo).

## 2. Criando o banco no Supabase

1. Crie uma conta e um projeto gratuito em [supabase.com](https://supabase.com).
2. No painel do projeto, abra **SQL Editor** e rode o conteúdo do arquivo
   [`supabase/migrations/0001_init.sql`](./supabase/migrations/0001_init.sql).
   Isso cria as tabelas `vendedores` e `cartas`, os índices, o gerador
   automático de código (`CART-0001`, `CART-0002`, ...) e a coluna de
   lucro calculada automaticamente.
3. Em **Project Settings → API**, copie a **Project URL** e a chave
   **anon public**.
4. Copie `.env.example` para `.env` e preencha:

   ```bash
   cp .env.example .env
   ```

   ```
   VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
   VITE_SUPABASE_ANON_KEY=SUA_CHAVE_ANON_PUBLICA
   ```

5. Reinicie `npm run dev`.

> O `.env` não é versionado (está no `.gitignore`). Cada pessoa que rodar
> o projeto localmente precisa do seu próprio arquivo.

## 3. Modelo de dados

Tudo gira em torno da tabela `cartas`, que representa o ciclo completo de
uma carta contemplada:

- **Cliente (dono atual)**: `cliente_vendedor_nome` / `cliente_vendedor_documento`
  — quem vendeu a carta para a empresa.
- **Comprador**: `cliente_comprador_nome` / `cliente_comprador_documento`
  — preenchido quando a carta é vendida.
- **Valores**: `valor_carta`, `valor_compra` (o que pagamos), `valor_venda`
  (o que recebemos), `valor_parcela`, `parcelas_pagas`, `parcelas_a_pagar`.
- **Comissão**: `comissao_vendedor`, vinculada a um `vendedor_id`
  (tabela `vendedores`, os representantes internos).
- **Datas**: `data_compra`, `data_venda`.
- **Lucro**: coluna gerada automaticamente pelo Postgres =
  `valor_venda - valor_compra - comissao_vendedor`.
- **Status**: `estoque` (comprada, ainda não vendida) ou `vendida`.
- **Tipo de negociação**: `compra_venda` (compramos e revendemos depois)
  ou `intermediacao` (ponta a ponta).

## 4. Páginas

- **Dashboard**: cartas compradas, em estoque, vendidas, em intermediação
  e lucro total, com gráfico de lucro por mês.
- **Cartas**: cadastro completo (cliente vendedor, comprador, valores,
  parcelas, comissão, administradora, vendedor) com filtros por
  estoque/vendidas/intermediação.
- **Vendedores**: cadastro dos representantes internos que recebem comissão.
- **Financeiro**: entradas, saídas e resultado de cada evento (compra,
  venda, intermediação), com filtro por tipo/mês/ano — no mesmo formato
  da tela de referência.

## 5. Publicando no Lovable

Como o projeto usa a stack padrão do Lovable (Vite + React + TS +
Tailwind + shadcn/ui + Supabase), basta importar este repositório em um
novo projeto Lovable e conectar o mesmo projeto Supabase (ou deixar o
Lovable criar um novo e rodar a migration de novo por lá).
