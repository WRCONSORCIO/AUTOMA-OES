# Atendimento automatizado via WhatsApp

Guia completo do módulo: instalação, configuração, operação e produção.

> **Sobre custos.** O sistema é self-hosted e não cobra assinatura própria, mas
> a operação não é gratuita: o provedor de WhatsApp, o gateway de pagamento e a
> hospedagem têm custos próprios. O objetivo aqui foi evitar despesa
> desnecessária — em especial, o atendimento **não depende de nenhuma API de
> IA**, nem para funcionar nem para ser mantido.

---

## 1. Requisitos

| Item | Versão | Observação |
|---|---|---|
| Node.js | ≥ 20.11 | 22 LTS é o recomendado |
| PostgreSQL | ≥ 14 | 16 é o usado no Docker |
| Docker | opcional | só para a subida com `docker compose` |
| Provedor de WhatsApp | — | Evolution API (self-hosted) ou WhatsApp Cloud API |
| Gateway de pagamento | — | Stripe no MVP; a arquitetura aceita outros |

Redis **não** é necessário. O estado do atendimento vive no PostgreSQL de
propósito: é o que faz a conversa sobreviver a um reinício do processo.

---

## 2. Instalação

```bash
git clone <repositório>
cd AUTOMA-OES
npm install
cp .env.example .env      # preencha os valores
npm run prisma:migrate    # cria o banco
npm run prisma:seed       # carga inicial
npm run dev               # http://localhost:3000
```

O seed exibe uma única vez a senha do administrador, a menos que
`SEED_ADMIN_SENHA` esteja definida.

---

## 3. Variáveis de ambiente

As do módulo estão no fim do `.env.example`. As essenciais:

| Variável | Para que serve |
|---|---|
| `DATABASE_URL` / `DIRECT_URL` | Conexão do PostgreSQL |
| `AUTH_SECRET` | Assina a sessão **e** cifra as credenciais gravadas no banco |
| `APP_URL` | Base pública: webhooks e URLs de retorno do pagamento |
| `WHATSAPP_PROVIDER` | `EVOLUTION`, `CLOUD_API` ou `SIMULADOR` |
| `WHATSAPP_API_URL` / `WHATSAPP_API_KEY` / `WHATSAPP_INSTANCE` | Credenciais do provedor |
| `WHATSAPP_WEBHOOK_TOKEN` | Token exigido no webhook de entrada |
| `PAYMENT_PROVIDER` | `STRIPE`, `SIMULADOR` ou `MANUAL` |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Credenciais da Stripe |
| `PAGAMENTO_EXPIRA_MINUTOS` | Validade da cobrança (padrão: 60) |
| `BACKUP_CRON_TOKEN` | Autentica as rotinas agendadas |

> **Trocar o `AUTH_SECRET` invalida as credenciais já gravadas no banco**, que
> são cifradas com uma chave derivada dele. As telas passam a mostrar "—" e
> basta recadastrá-las.

Nada disso vai para o Git: `.env` está no `.gitignore`, e as credenciais
salvas pelo painel são cifradas em repouso (AES-256-GCM) e voltam mascaradas
para o navegador.

---

## 4. Banco de dados

```bash
npm run prisma:migrate    # desenvolvimento: cria e aplica migrations
npm run prisma:deploy     # produção: aplica o que falta, sem gerar nada
npm run prisma:seed       # idempotente: só cria o que ainda não existe
```

O seed cria:

- o usuário administrador;
- os **oito aparelhos** (Celular, BTV/HTV, TV Box, TV Smart, Video Game,
  Chromecast, Amazon Fire, Computador);
- as mensagens configuráveis com o texto padrão;
- o horário de atendimento humano;
- cinco fluxos: menu principal, nova contratação, renovação e dois fluxos de
  aparelho como exemplo.

**Nenhum preço fictício é criado.** Os planos nascem vazios porque preço é
decisão comercial, não dado de exemplo.

---

## 5. Docker

```bash
cp .env.example .env       # defina ao menos POSTGRES_PASSWORD e AUTH_SECRET
npm run docker:up          # sobe app + postgres
npm run docker:seed        # carga inicial
npm run docker:logs
```

As migrations rodam sozinhas na subida do contêiner (`prisma migrate deploy`).
O PostgreSQL só escuta em `127.0.0.1`; a aplicação fala com ele pela rede
interna do compose.

---

## 6. Configurar o WhatsApp

**Painel → Atendimento → Configurações → WhatsApp**

1. Escolha o provedor (Evolution API ou Cloud API).
2. Informe URL da API, instância e chave.
3. Defina um token de webhook — sem ele, o endpoint de entrada aceita qualquer
   chamada.
4. Clique em **Testar conexão**.
5. No provedor, cadastre a URL mostrada na tela:

```
https://SEU-DOMINIO/webhooks/whatsapp?instancia=<id>
```

O token é aceito no cabeçalho `Authorization: Bearer`, em `apikey`, em
`x-webhook-token` ou na query `?token=`.

**Sem credencial cadastrada o sistema entra em modo simulação**: o fluxo roda
inteiro e as mensagens aparecem no histórico da conversa, mas nada sai do
servidor. É como percorrer o atendimento sem depender de um número real.

Respeite as políticas do WhatsApp e do provedor escolhido — envio em massa não
solicitado derruba o número, e o sistema não tem nem terá recurso para
contornar bloqueio.

---

## 7. Configurar a Stripe

**Painel → Atendimento → Configurações → Pagamentos**

1. Selecione **Stripe** e o ambiente (*test* ou *live*).
2. Cole a *secret key* e a *publishable key*.
3. Cadastre o webhook na Stripe apontando para:

```
https://SEU-DOMINIO/webhooks/stripe
```

4. Assine estes eventos:

| Evento | Efeito |
|---|---|
| `checkout.session.completed` | Pago (ou em processamento, se ainda não pago) |
| `checkout.session.async_payment_succeeded` | Pago |
| `checkout.session.async_payment_failed` | Falhou |
| `checkout.session.expired` | Expirado |
| `charge.refunded` | Estornado |

5. Cole o *webhook secret* no painel e clique em **Testar conexão**.

Para desenvolvimento sem credencial, use `PAYMENT_PROVIDER=SIMULADOR`: as
cobranças ficam pendentes e o botão "Confirmar pagamento (simulado)" da tela do
pedido percorre exatamente o mesmo caminho do webhook real. Com um gateway real
ativo, esse botão é recusado.

### A regra que não se negocia

**Só o gateway confirma pagamento.** Cliente que escreve "já paguei" recebe a
mensagem de espera e o pedido não se move. O `PAID` vem de:

- webhook validado por assinatura; ou
- consulta direta ao gateway feita pelo próprio sistema.

Se a Stripe não aceitar a atividade comercial, **não tente contornar**: troque
de gateway. A arquitetura (`PaymentProvider` + fábrica) existe para isso —
implementar Mercado Pago, Asaas ou PagBank é escrever uma classe e acrescentar
um caso na fábrica.

---

## 8. Como criar planos

**Atendimento → Planos.** Nome, duração em dias, preço, ordem e destaque. A
ordem é a ordem da lista enviada no WhatsApp; plano inativo some do bot sem
apagar o histórico de quem já comprou.

Plano com pedido não pode ser excluído — só desativado. Apagar levaria o
histórico da compra junto.

## 9. Como criar aparelhos

**Atendimento → Aparelhos.** Chave (identificador fixo), nome, ícone, ordem e
uma de duas formas de responder:

- **instruções diretas**, para aparelho simples; ou
- **fluxo próprio**, quando há perguntas antes (marca da TV, sistema do
  celular).

## 10. Como criar fluxos

**Atendimento → Fluxos.** Um fluxo é uma sequência de etapas; cada etapa tem
tipo, mensagem, destino e opções.

| Tipo | O que faz |
|---|---|
| `TEXT` | Envia e segue direto para a próxima |
| `MENU` / `BUTTONS` / `LIST` | Pergunta e espera; botão vira menu numerado quando o provedor não suporta |
| `INPUT` | Guarda a resposta livre em uma variável |
| `PAYMENT` | Cria a cobrança e envia o link |
| `PAYMENT_STATUS` | Espera a confirmação do gateway |
| `DEVICE_SELECTION` | Lista os aparelhos ativos e desvia para o fluxo de cada um |
| `HUMAN_HANDOFF` | Transfere para atendente |
| `END` | Encerra |

Regras que a tela cobra:

- só **um** fluxo principal ativo — dois seriam duas portas de entrada;
- fluxo ativo precisa de etapa inicial, senão não roda;
- etapa sem destino e sem opções encerra a conversa (a tela avisa).

A primeira etapa criada vira a inicial automaticamente.

## 11. Mensagens

**Atendimento → Mensagens.** Cada texto do bot, editável, com as variáveis
disponíveis: `{{customer_name}}`, `{{plan_name}}`, `{{plan_price}}`,
`{{plan_duration}}`, `{{payment_link}}`, `{{order_id}}`, `{{device_name}}` e
`{{business_hours}}`.

Variável inexistente é recusada ao salvar. Variável sem valor no envio some do
texto — nunca aparece crua para o cliente.

## 12. Atendentes

**Administração → Usuários.** O perfil **Atendente** vê conversas, clientes e
pedidos e pode assumir e devolver atendimentos; não edita plano, preço, fluxo
nem credencial.

No inbox: **Assumir atendimento** silencia o bot; **Devolver para o bot**
retoma a etapa exata onde o cliente estava. Com pagamento pendente, a devolução
volta para "aguardando pagamento", não para o fluxo — o bot não avançaria sem
confirmação mesmo.

---

## 13. Horário de atendimento

**Atendimento → Configurações → Horário.** Vale só para o pedido de atendente:
o bot funciona 24 horas, porque pagamento e instrução não dependem de ninguém.

Fora do horário, quem pede atendente recebe a mensagem `fora_do_horario` (com
`{{business_hours}}`) e a conversa fica marcada como humana, esperando o
expediente.

## 14. Manutenção

Expira cobranças vencidas e encerra conversas abandonadas há mais de 24 horas.
Conversa em atendimento humano nunca é encerrada automaticamente.

```bash
npm run atendimento:manutencao
```

Ou por HTTP, com o mesmo token dos backups:

```bash
curl -X POST https://SEU-DOMINIO/api/atendimento/manutencao \
  -H "Authorization: Bearer $BACKUP_CRON_TOKEN"
```

No crontab, a cada dez minutos:

```
*/10 * * * * cd /opt/automa && npm run atendimento:manutencao >> /var/log/automa.log 2>&1
```

---

## 15. Produção

1. Aponte um domínio com HTTPS para a aplicação (webhook exige TLS).
2. Defina `APP_URL` com esse domínio.
3. `AUTH_SECRET` novo e forte: `openssl rand -base64 48`.
4. Suba com `docker compose up -d --build` ou `npm run build && npm start`.
5. Rode o seed uma vez.
6. Cadastre WhatsApp e gateway pelo painel.
7. Cadastre os webhooks nos dois provedores.
8. Crie os planos com os preços reais.
9. Agende a manutenção e o backup.
10. Confira `/atendimento/saude` — todos os sinais devem estar verdes.

### Observabilidade

`GET /api/health` responde 200 quando tudo está de pé e 503 quando algo caiu.
Sem sessão, devolve só o estado de cada serviço; o detalhe do erro exige
autenticação, porque a mensagem de um provedor pode revelar configuração
interna.

Amarelo é "falta configurar", vermelho é "está fora" — a diferença importa: o
sistema sobe sem WhatsApp e sem gateway.

## 16. Backup e restauração

O ERP já traz backup diário (`npm run backup:run`, tela **Administração →
Backups**), que cobre o banco inteiro — inclusive as tabelas do atendimento.

Manualmente:

```bash
# Backup
pg_dump "$DATABASE_URL" -Fc -f backup-$(date +%F).dump

# Restauração (apaga e recria os objetos do dump)
pg_restore --clean --if-exists -d "$DATABASE_URL" backup-2026-08-18.dump
```

Com Docker:

```bash
docker compose exec -T postgres pg_dump -U automa automa -Fc > backup.dump
docker compose exec -T postgres pg_restore -U automa -d automa --clean --if-exists < backup.dump
```

Guarde os backups fora do servidor. Um backup no mesmo disco não é backup.

---

## 17. Solução de problemas

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Bot não responde | Conversa em atendimento humano | É o esperado. Devolver ao bot no inbox |
| Bot não responde a ninguém | Nenhum fluxo principal ativo | Ativar em Fluxos; a tela avisa |
| Mensagens não chegam ao cliente | Modo simulação | Cadastrar credenciais em Configurações |
| Webhook do WhatsApp com 401 | Token errado | Conferir o token no provedor e no painel |
| Webhook da Stripe com 400 | Assinatura inválida | Conferir o *webhook secret*; ele é por endpoint |
| Pagamento confirmado e fluxo parado | Conversa assumida por atendente | O bot não interrompe; devolver ao bot |
| Cobrança não é criada | Gateway não configurado | Configurações → Pagamentos; o cliente vai para atendimento humano |
| Cliente preso na espera do pagamento | Webhook não chega | Conferir a URL; a etapa também consulta o gateway na próxima mensagem |
| Credenciais aparecem como "—" | `AUTH_SECRET` mudou | Recadastrar as credenciais |
| Mensagem repetida ao cliente | — | Não deve acontecer: entrada e webhook são idempotentes. Se ocorrer, ver Logs |

**Onde olhar:** *Atendimento → Logs* registra mensagens, mudanças de etapa,
pedidos, pagamentos, webhooks e erros. Credenciais e tokens nunca são
registrados.

---

## 18. Como o módulo está organizado

```
src/server/atendimento/
├── dominio/        regras puras, testadas sem banco
│   ├── motor.ts        interpretação da resposta do cliente
│   ├── telefone.ts     normalização (um número, um cliente)
│   ├── variaveis.ts    substituição de {{variáveis}}
│   └── horario.ts      expediente do atendimento humano
├── motor/          execução do fluxo
│   ├── executor.ts     máquina de estados
│   ├── opcoes.ts       opções vindas do banco
│   └── pagamento.ts    continuação após confirmação do gateway
├── whatsapp/       WhatsAppProvider: contrato, Evolution, simulador
├── pagamentos/     PaymentProvider: contrato, Stripe, simulador, fábrica
└── servicos/       clientes, conversas, pedidos, mensagens, logs, segredos
```

A regra da dependência: `dominio` não importa nada; `servicos` e `motor`
dependem do domínio e do Prisma; as telas dependem dos serviços. Nenhuma
chamada específica de Evolution API ou de Stripe escapa da sua camada.

### Integração futura com IA

Não há dependência de IA e o MVP não deve ter. Quando fizer sentido, o ponto de
extensão é um `AIProvider` no mesmo formato dos outros dois contratos, chamado
apenas para mensagens **fora** do fluxo — o caminho normal continua
determinístico, porque é ele que precisa ser previsível.
