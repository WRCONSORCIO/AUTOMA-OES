# WR Consórcio — ERP Comercial

Sistema interno de gestão comercial: vendedores, equipes, gerências, comissões,
recuperação e acompanhamento financeiro. Todo cálculo acontece automaticamente
a partir das importações da administradora.

## Stack

Next.js 15 (App Router) · React 19 · TypeScript strict · TailwindCSS 4 ·
Prisma · PostgreSQL · Recharts

## Como as regras de negócio estão implementadas

As regras críticas vivem em `src/server/domain/regras.ts` como funções puras,
sem acesso a banco, e são cobertas por testes em `tests/regras.test.ts`.

| Regra | Onde está | Como funciona |
|---|---|---|
| **A categoria pertence à venda, não ao vendedor** | `resolverCategoriaNaData` | A categoria vigente na data da venda é gravada em `Cota.categoriaVenda` e nunca é recalculada. Promover o vendedor não muda o cálculo das vendas anteriores. |
| **Histórico de categoria** | `VendedorCategoriaHistorico` | Append-only. Alterar a categoria encerra o período anterior e abre um novo; nada é apagado. |
| **Recuperação marca a venda permanentemente** | `encontrarRecuperacaoNaData` | Vendas no intervalo recebem `emRecuperacao = true`. A marcação só pode ser acrescentada, nunca removida — encerrar a recuperação não desmarca nada. |
| **Estorno antes da 6ª parcela** | `deveGerarEstorno` | Venda marcada em recuperação que cancela com menos de 6 parcelas pagas gera `Estorno`, mesmo que o cancelamento ocorra anos depois. |
| **Identidade da cota** | `montarIdentidadeCota` | Chave única = administradora + contrato + grupo + cota + CPF/CNPJ do cliente. Nunca só o CPF, só o nome ou só o contrato. |
| **Duplicidade** | `chaveDuplicidade` | Só é duplicata quando os **sete** campos coincidem (os cinco da identidade + nome do cliente + CPF/CNPJ do vendedor). |
| **Precedência do vendedor** | `resolverVendedorEfetivo` | O override interno da WR vence sempre; sem override, vale o vendedor da administradora. A base da administradora nunca é alterada. |
| **Inclusão de plano = parcela 1** | `resolverParcela` | `INCLUSAO DE PLANO` é sempre interpretado como parcela 1, ignorando qualquer outro valor. |
| **Flex define a base** | `calcularBaseComissao` | Base = crédito × percentual da modalidade. Crédito de R$ 500.000 com Flex 50 → base de R$ 250.000. |
| **Comissão WR por parcela** | `calcularComissaoWr` | Cruza a parcela paga com a tabela da categoria **da venda**. Parcela sem percentual cadastrado não gera comissão (é assim que "acima da parcela 4 não gera comissão de Iniciante" fica configurado). |

### Nada é apagado

- Cotas, vendedores, equipes, gerências e usuários são **inativados**, nunca excluídos.
- Cada alteração vinda da administradora gera uma linha em `CotaVersao`.
- Toda operação relevante grava um `AuditLog` com usuário, data, hora, IP e o diff.

## Importações

### Base de clientes (CSV)

Layout da administradora mapeado **pelo nome das colunas**, não pela posição —
tolera mudança de ordem ou colunas novas. Ao final, o resumo mostra novos,
atualizados, cancelados, contemplados, duplicados e erros.

Não existe cadastro manual de cliente: o CSV é a única fonte.

### Relatório de comissão (PDF)

O relatório é um listado de largura fixa. Em vez de ler o texto corrido — que
embaralha valores quando o extrator quebra tokens (`1.365,5` + `9`) — o parser
reconstrói cada linha na **coluna original** a partir das coordenadas dos glifos
e recorta os campos pelas faixas declaradas no cabeçalho do próprio relatório.

O resultado é conferido contra o total impresso no rodapé do PDF: a importação
reporta a divergência, que deve ser zero.

Registros com tipo fora dos três previstos (por exemplo `EXCLUSAO DE PLANO`,
presente nos arquivos reais) são importados e exibidos com o texto original
preservado, mas **não geram comissão WR** — não há regra definida para eles.

## Perfis de acesso

| Perfil | Acesso |
|---|---|
| Administrador | Total |
| Gerente | Somente a própria gerência |
| Supervisor | Somente a própria equipe |
| Financeiro | Comissões, importações, tabelas e dashboard |
| RH | Vendedores, equipes e gerências |

O escopo de gerência/equipe é aplicado no servidor, em todas as consultas —
inclusive nas agregações SQL do dashboard.

## Colocando para rodar

```bash
cp .env.example .env          # ajuste DATABASE_URL e gere o AUTH_SECRET
npm install
npx prisma migrate deploy     # ou `npm run prisma:migrate` em desenvolvimento
npm run db:seed               # estrutura inicial + usuário administrador
npm run dev
```

O seed exibe a senha do administrador uma única vez. Para defini-la você mesmo,
exporte `SEED_ADMIN_SENHA` (e opcionalmente `SEED_ADMIN_EMAIL`) antes de rodar.

### Ordem sugerida na primeira carga

1. **Importações → Base de clientes (CSV).** Cria as cotas e os vendedores que
   aparecem na base, já com o CPF/CNPJ real.
2. **Cadastros → Gerências e Equipes.** Confira a estrutura criada pelo seed.
3. **Cadastros → Pendências de cadastro.** Lista os vendedores cujas vendas
   ainda não geram comissão, com quantos lançamentos e quanto valor estão
   travados. Resolver ali registra a categoria (com a data de início já
   sugerida pela primeira venda do vendedor) e dispara o recálculo.

   Para completar o cadastro em lote a partir da planilha de controle, salve-a
   como CSV com as colunas `VENDEDOR;CATEGORIA;SUPERVISAO;GERENCIA` e rode:
   ```bash
   npx tsx scripts/importar-cadastro-vendedores.ts cadastro.csv          # simula
   npx tsx scripts/importar-cadastro-vendedores.ts cadastro.csv --aplicar
   ```
4. **Tabelas e Flex.** Ajuste os percentuais por parcela de cada categoria.
5. **Importações → Relatório de comissão (PDF).**
6. **Comissões WR → Recalcular comissões**, sempre que o cadastro for
   completado depois de uma importação.

> Vendedor criado automaticamente pela importação fica **sem categoria** e não
> gera comissão WR até que a categoria seja registrada com a data de início
> correta. Isso é intencional: o sistema não inventa uma categoria para calcular
> dinheiro. A tela **Pendências de cadastro** mostra exatamente o que está
> travado e quanto vale, para o RH resolver sem precisar caçar caso a caso.

## Colocando em produção

O sistema é um servidor Next.js com Prisma contra um PostgreSQL próprio. Ele
**não** roda em plataformas que publicam apenas frontend estático.

### Vercel + Postgres gerenciado (recomendado)

1. **Crie o banco** (Neon, Supabase — apenas o Postgres — ou RDS). Guarde as
   duas strings de conexão: a **com pooler** e a **direta**.
2. **Importe o repositório na Vercel.** O framework é detectado sozinho; o
   script `vercel-build` já aplica as migrations antes do build.
3. **Configure as variáveis de ambiente** (Production e Preview):

   | Variável | Valor |
   |---|---|
   | `DATABASE_URL` | string **com pooler** |
   | `DIRECT_URL` | string **direta**, usada pelas migrations |
   | `AUTH_SECRET` | `openssl rand -base64 48` |
   | `BACKUP_CRON_TOKEN` | opcional, só se for usar a rota de backup |

4. **Faça o deploy.** As migrations rodam automaticamente.
5. **Abra a URL do projeto.** Com o banco vazio, o sistema leva direto para a
   tela de **configuração inicial**: você cria o acesso do administrador e a
   estrutura (administradora, gerências, equipes, modalidades de flex e a
   tabela de Iniciante) é criada junto. A tela se fecha sozinha depois disso.

   Se preferir automatizar, o mesmo resultado sai por linha de comando:
   ```bash
   DATABASE_URL="<direta>" DIRECT_URL="<direta>" npm run db:seed
   ```

**Backup na Vercel:** o runtime serverless não tem `pg_dump`, então o botão
*Gerar Backup* falha nesse ambiente. Use o backup automático do provedor do
banco (Neon e Supabase oferecem) ou rode `npm run backup:run` de uma máquina
com o utilitário instalado. A tela de Backups continua servindo de histórico.

**Limite de tempo:** a rota de importação declara `maxDuration = 300`. No plano
Hobby da Vercel o teto é 60 s — suficiente para os arquivos atuais, mas bases
muito grandes exigem o plano Pro ou o deploy em servidor próprio.

### Servidor próprio (VPS)

Vale quando você quer o backup funcionando dentro do próprio sistema.

```bash
git clone <repo> && cd AUTOMA-OES
cp .env.example .env        # DATABASE_URL e DIRECT_URL com o mesmo valor
npm ci
npx prisma migrate deploy
npm run build
npm start                   # sob pm2, systemd ou Docker
```

No primeiro acesso, o sistema abre a tela de configuração inicial para criar o
administrador. Alternativamente, rode `npm run db:seed` antes de subir.

Coloque um nginx na frente com HTTPS e agende o backup diário:

```
0 3 * * * cd /opt/wr-consorcio && npm run backup:run >> /var/log/wr-backup.log 2>&1
```

Requisitos: Node 20+, PostgreSQL 14+ e os utilitários de cliente do Postgres
(`pg_dump`) instalados no servidor.

## Backup

Botão **Gerar Backup** na tela de Backups, e backup diário pelo agendador:

```
0 3 * * * cd /opt/wr-consorcio && npm run backup:run >> /var/log/wr-backup.log 2>&1
```

Alternativamente, `POST /api/backups/cron` com `Authorization: Bearer $BACKUP_CRON_TOKEN`.

Os dumps são gerados com `pg_dump --format=custom` (restauráveis com
`pg_restore`) e a retenção segue `BACKUP_RETENTION_DAYS`.

## Comandos

```bash
npm run dev          # desenvolvimento
npm run build        # build de produção
npm test             # testes das regras de negócio
npm run typecheck    # verificação de tipos
npm run db:seed      # carga inicial
npm run backup:run   # backup manual pela linha de comando

# conferir os parsers contra arquivos reais, sem tocar no banco
npx tsx scripts/validar-parsers.ts base.csv fechamento.pdf
```

## Organização

```
prisma/schema.prisma          modelo de dados
src/server/domain/            regras de negócio (puras, testáveis)
src/server/importacao/        parsers e serviços de importação
src/server/services/          vendedores, transferências, dashboard, auditoria, backup
src/server/auth/              sessão e controle de permissões
src/app/(app)/                telas autenticadas
src/components/               componentes reutilizáveis
tests/                        testes das regras
```

## Escala

Índices compostos nas colunas de filtro e agregação (`dataReferencia`,
`gerenciaId`, `equipeId`, `vendedorId`, identidade da cota). Importações rodam
em lotes com cache de vendedores em memória, e as agregações do dashboard são
resolvidas em SQL — sem carregar registros para a aplicação.
