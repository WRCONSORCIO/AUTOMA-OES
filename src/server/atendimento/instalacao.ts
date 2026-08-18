import type { Prisma, TipoEtapaFluxo, TipoFluxo } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MODELOS_PADRAO } from "./mensagens-padrao";

/**
 * Carga inicial do módulo de atendimento.
 *
 * Idempotente: rodar de novo não duplica nada e não sobrescreve o que o
 * administrador já editou. Só cria o que ainda não existe — é o que permite
 * rodar o seed em produção depois de um deploy sem medo de apagar texto.
 *
 * Nada de preço fictício: os planos nascem vazios, para o administrador
 * cadastrar os reais. Instruções de aparelho também nascem em branco, com um
 * aviso claro de que precisam ser preenchidas.
 */

interface AparelhoPadrao {
  chave: string;
  nome: string;
  icone: string;
}

/** Os oito aparelhos do catálogo inicial. Depois disso, quem manda é o painel. */
export const APARELHOS_PADRAO: readonly AparelhoPadrao[] = [
  { chave: "celular", nome: "Celular", icone: "📱" },
  { chave: "btv_htv", nome: "BTV/HTV", icone: "📦" },
  { chave: "tv_box", nome: "TV Box", icone: "📦" },
  { chave: "tv_smart", nome: "TV Smart", icone: "📺" },
  { chave: "video_game", nome: "Video Game", icone: "🎮" },
  { chave: "chromecast", nome: "Chromecast", icone: "🎤" },
  { chave: "amazon_fire", nome: "Amazon Fire", icone: "🔥" },
  { chave: "computador", nome: "Computador", icone: "🖥️" },
] as const;

const INSTRUCAO_PENDENTE =
  "As instruções deste aparelho ainda não foram cadastradas. " +
  "Configure em Atendimento → Aparelhos ou monte um fluxo próprio em Atendimento → Fluxos.";

export interface ResumoInstalacaoAtendimento {
  aparelhos: number;
  mensagens: number;
  horarios: number;
  fluxos: number;
}

export async function criarEstruturaAtendimento(): Promise<ResumoInstalacaoAtendimento> {
  const aparelhos = await semearAparelhos();
  const mensagens = await semearMensagens();
  const horarios = await semearHorarios();
  const fluxos = await semearFluxos();

  return { aparelhos, mensagens, horarios, fluxos };
}

async function semearAparelhos(): Promise<number> {
  let criados = 0;

  for (const [indice, aparelho] of APARELHOS_PADRAO.entries()) {
    const existente = await prisma.aparelho.findUnique({ where: { chave: aparelho.chave } });
    if (existente) continue;

    await prisma.aparelho.create({
      data: {
        chave: aparelho.chave,
        nome: aparelho.nome,
        icone: aparelho.icone,
        ordem: indice,
        instrucoes: INSTRUCAO_PENDENTE,
      },
    });
    criados += 1;
  }

  return criados;
}

async function semearMensagens(): Promise<number> {
  let criadas = 0;

  for (const modelo of MODELOS_PADRAO) {
    const existente = await prisma.modeloMensagem.findUnique({ where: { chave: modelo.chave } });
    if (existente) continue;

    await prisma.modeloMensagem.create({
      data: {
        chave: modelo.chave,
        titulo: modelo.titulo,
        conteudo: modelo.conteudo,
        descricao: modelo.descricao,
        variaveis: modelo.variaveis,
      },
    });
    criadas += 1;
  }

  return criadas;
}

async function semearHorarios(): Promise<number> {
  let criados = 0;

  // Segunda a sexta 08–18, sábado 08–12, domingo fechado. É só um ponto de
  // partida visível na tela de configuração.
  const padrao = [
    { diaSemana: 0, abertura: "08:00", fechamento: "12:00", fechado: true },
    ...[1, 2, 3, 4, 5].map((diaSemana) => ({
      diaSemana,
      abertura: "08:00",
      fechamento: "18:00",
      fechado: false,
    })),
    { diaSemana: 6, abertura: "08:00", fechamento: "12:00", fechado: false },
  ];

  for (const dia of padrao) {
    const existente = await prisma.horarioAtendimento.findUnique({
      where: { diaSemana: dia.diaSemana },
    });
    if (existente) continue;

    await prisma.horarioAtendimento.create({ data: dia });
    criados += 1;
  }

  return criados;
}

// ---------------------------------------------------------------------------
// Fluxos
// ---------------------------------------------------------------------------

interface EtapaSemente {
  chave: string;
  nome: string;
  tipo: TipoEtapaFluxo;
  mensagem: string;
  config?: Prisma.InputJsonValue;
  acao?: Prisma.InputJsonValue;
  /** Chave da próxima etapa dentro do mesmo fluxo. */
  proxima?: string;
  /** Chave de outro fluxo, com precedência sobre `proxima`. */
  proximoFluxo?: string;
  opcoes?: OpcaoSemente[];
}

interface OpcaoSemente {
  rotulo: string;
  valor: string;
  proxima?: string;
  proximoFluxo?: string;
  acao?: Prisma.InputJsonValue;
}

interface FluxoSemente {
  chave: string;
  nome: string;
  descricao: string;
  tipo: TipoFluxo;
  etapas: EtapaSemente[];
  /** Aparelhos que passam a apontar para este fluxo. */
  aparelhos?: string[];
}

const FLUXOS_PADRAO: readonly FluxoSemente[] = [
  {
    chave: "principal",
    nome: "Menu principal",
    descricao: "Porta de entrada de toda conversa nova.",
    tipo: "PRINCIPAL",
    etapas: [
      {
        chave: "menu_principal",
        nome: "Menu principal",
        tipo: "BUTTONS",
        mensagem: "👋 Olá! Seja bem-vindo!\nComo podemos ajudar você hoje?",
        opcoes: [
          { rotulo: "🔄 Renovação", valor: "renovacao", proximoFluxo: "renovacao" },
          { rotulo: "🆕 Nova contratação", valor: "nova_contratacao", proximoFluxo: "nova_contratacao" },
          { rotulo: "👨‍💻 Falar com atendente", valor: "atendente", proxima: "transferir" },
        ],
      },
      {
        chave: "transferir",
        nome: "Transferir para atendente",
        tipo: "HUMAN_HANDOFF",
        mensagem:
          "👨‍💻 Certo! Vou chamar um atendente.\nAguarde um instante que já vamos responder por aqui.",
      },
    ],
  },
  {
    chave: "nova_contratacao",
    nome: "Nova contratação",
    descricao: "Escolha do plano, pagamento e liberação do aparelho.",
    tipo: "NOVA_CONTRATACAO",
    etapas: [
      {
        chave: "escolha_plano",
        nome: "Escolha do plano",
        tipo: "LIST",
        mensagem: "Perfeito! 🛒\nEscolha seu plano:",
        // Sem opções fixas: a lista é montada com os planos ativos do banco.
        config: { fonte: "planos", titulo: "Planos disponíveis", rotuloBotao: "Ver planos" },
        proxima: "pagamento",
      },
      {
        chave: "pagamento",
        nome: "Pagamento",
        tipo: "PAYMENT",
        mensagem:
          "📋 Plano escolhido: {{plan_name}}\nValor: {{plan_price}}\n\nPara continuar, realize o pagamento:\n{{payment_link}}",
        proxima: "aguardando_pagamento",
      },
      {
        chave: "aguardando_pagamento",
        nome: "Aguardando confirmação",
        tipo: "PAYMENT_STATUS",
        mensagem:
          "🟡 Estou aguardando a confirmação do pagamento do pedido #{{order_id}}.\nAssim que o gateway confirmar, seguimos automaticamente.",
        proxima: "pagamento_confirmado",
      },
      {
        chave: "pagamento_confirmado",
        nome: "Pagamento confirmado",
        tipo: "TEXT",
        mensagem: "✅ Pagamento confirmado!",
        proxima: "escolha_aparelho",
      },
      {
        chave: "escolha_aparelho",
        nome: "Escolha do aparelho",
        tipo: "DEVICE_SELECTION",
        mensagem: "Agora selecione o aparelho em que você irá utilizar o serviço:",
        config: { titulo: "Aparelhos", rotuloBotao: "Ver aparelhos" },
        proxima: "fim",
      },
      {
        chave: "fim",
        nome: "Encerramento",
        tipo: "END",
        mensagem: "✅ Tudo certo por aqui!\nQualquer coisa, é só chamar. Responda *menu* para recomeçar.",
      },
    ],
  },
  {
    chave: "renovacao",
    nome: "Renovação",
    descricao: "Cliente já atendido escolhe um plano e renova.",
    tipo: "RENOVACAO",
    etapas: [
      {
        chave: "identificacao",
        nome: "Identificação",
        tipo: "TEXT",
        mensagem: "🔄 Vamos renovar seu plano!",
        proxima: "escolha_plano",
      },
      {
        chave: "escolha_plano",
        nome: "Escolha do plano",
        tipo: "LIST",
        mensagem: "Escolha o plano da renovação:",
        config: { fonte: "planos", titulo: "Planos disponíveis", rotuloBotao: "Ver planos" },
        proxima: "pagamento",
      },
      {
        chave: "pagamento",
        nome: "Pagamento",
        tipo: "PAYMENT",
        mensagem:
          "📋 Plano escolhido: {{plan_name}}\nValor: {{plan_price}}\n\nPara continuar, realize o pagamento:\n{{payment_link}}",
        proxima: "aguardando_pagamento",
      },
      {
        chave: "aguardando_pagamento",
        nome: "Aguardando confirmação",
        tipo: "PAYMENT_STATUS",
        mensagem:
          "🟡 Estou aguardando a confirmação do pagamento do pedido #{{order_id}}.\nAssim que o gateway confirmar, seguimos automaticamente.",
        proxima: "renovacao_confirmada",
      },
      {
        chave: "renovacao_confirmada",
        nome: "Renovação confirmada",
        tipo: "TEXT",
        mensagem: "✅ Renovação confirmada! Seu plano {{plan_name}} está ativo.",
        proxima: "fim",
      },
      {
        chave: "fim",
        nome: "Encerramento",
        tipo: "END",
        mensagem: "✅ Tudo certo! Responda *menu* se precisar de mais alguma coisa.",
      },
    ],
  },
  {
    chave: "aparelho_celular",
    nome: "Aparelho — Celular",
    descricao: "Fluxo de exemplo: pergunta o sistema e entrega as instruções.",
    tipo: "APARELHO",
    aparelhos: ["celular"],
    etapas: [
      {
        chave: "sistema",
        nome: "Sistema do celular",
        tipo: "BUTTONS",
        mensagem: "📱 Perfeito!\nQual é o sistema do seu celular?",
        opcoes: [
          { rotulo: "Android", valor: "android", proxima: "instrucoes_android" },
          { rotulo: "iPhone", valor: "ios", proxima: "instrucoes_ios" },
        ],
      },
      {
        chave: "instrucoes_android",
        nome: "Instruções — Android",
        tipo: "TEXT",
        mensagem: `📖 Instruções para Android\n\n${INSTRUCAO_PENDENTE}`,
        proxima: "fim",
      },
      {
        chave: "instrucoes_ios",
        nome: "Instruções — iPhone",
        tipo: "TEXT",
        mensagem: `📖 Instruções para iPhone\n\n${INSTRUCAO_PENDENTE}`,
        proxima: "fim",
      },
      {
        chave: "fim",
        nome: "Encerramento",
        tipo: "END",
        mensagem: "✅ Tudo certo! Responda *menu* se precisar de mais alguma coisa.",
      },
    ],
  },
  {
    chave: "aparelho_tv_smart",
    nome: "Aparelho — TV Smart",
    descricao: "Fluxo de exemplo: pergunta a marca e entrega as instruções.",
    tipo: "APARELHO",
    aparelhos: ["tv_smart"],
    etapas: [
      {
        chave: "marca",
        nome: "Marca da TV",
        tipo: "LIST",
        mensagem: "📺 Perfeito!\nQual é a marca da sua TV?",
        config: { titulo: "Marcas", rotuloBotao: "Ver marcas" },
        opcoes: [
          { rotulo: "Samsung", valor: "samsung", proxima: "instrucoes" },
          { rotulo: "LG", valor: "lg", proxima: "instrucoes" },
          { rotulo: "Philips", valor: "philips", proxima: "instrucoes" },
          { rotulo: "TCL", valor: "tcl", proxima: "instrucoes" },
          { rotulo: "Outra", valor: "outra", proxima: "instrucoes" },
        ],
      },
      {
        chave: "instrucoes",
        nome: "Instruções — TV Smart",
        tipo: "TEXT",
        mensagem: `📖 Instruções para TV Smart\n\n${INSTRUCAO_PENDENTE}`,
        proxima: "fim",
      },
      {
        chave: "fim",
        nome: "Encerramento",
        tipo: "END",
        mensagem: "✅ Tudo certo! Responda *menu* se precisar de mais alguma coisa.",
      },
    ],
  },
] as const;

async function semearFluxos(): Promise<number> {
  const criadosAgora: FluxoSemente[] = [];

  for (const semente of FLUXOS_PADRAO) {
    const existente = await prisma.fluxo.findUnique({ where: { chave: semente.chave } });
    if (existente) continue;

    await criarFluxo(semente);
    criadosAgora.push(semente);
  }

  // Salto entre fluxos só pode ser ligado depois que todos existem: o menu
  // principal aponta para a contratação, que é criada depois dele. Só os fluxos
  // criados nesta execução são religados — fluxo que o administrador já editou
  // não volta ao padrão.
  for (const semente of criadosAgora) {
    await vincularEntreFluxos(semente);
  }

  // O vínculo aparelho → fluxo é feito depois que todos os fluxos existem.
  for (const semente of FLUXOS_PADRAO) {
    if (!semente.aparelhos?.length) continue;

    const fluxo = await prisma.fluxo.findUnique({ where: { chave: semente.chave } });
    if (!fluxo) continue;

    await prisma.aparelho.updateMany({
      where: { chave: { in: semente.aparelhos }, fluxoId: null },
      data: { fluxoId: fluxo.id },
    });
  }

  return criadosAgora.length;
}

/**
 * Cria fluxo, etapas e opções em três passos.
 *
 * A ligação entre etapas só pode ser feita depois que todas existem — a
 * primeira etapa costuma apontar para a última, e a última para a primeira.
 */
async function criarFluxo(semente: FluxoSemente): Promise<void> {
  const fluxo = await prisma.fluxo.create({
    data: {
      chave: semente.chave,
      nome: semente.nome,
      descricao: semente.descricao,
      tipo: semente.tipo,
    },
  });

  const idPorChave = new Map<string, string>();

  for (const [indice, etapa] of semente.etapas.entries()) {
    const criada = await prisma.etapaFluxo.create({
      data: {
        fluxoId: fluxo.id,
        chave: etapa.chave,
        nome: etapa.nome,
        tipo: etapa.tipo,
        mensagem: etapa.mensagem,
        ordem: indice,
        config: etapa.config,
        acao: etapa.acao,
      },
    });
    idPorChave.set(etapa.chave, criada.id);
  }

  for (const etapa of semente.etapas) {
    const id = idPorChave.get(etapa.chave)!;

    await prisma.etapaFluxo.update({
      where: { id },
      data: {
        proximaEtapaId: etapa.proxima ? (idPorChave.get(etapa.proxima) ?? null) : null,
      },
    });

    for (const [indice, opcao] of (etapa.opcoes ?? []).entries()) {
      await prisma.opcaoEtapaFluxo.create({
        data: {
          etapaId: id,
          rotulo: opcao.rotulo,
          valor: opcao.valor,
          ordem: indice,
          acao: opcao.acao,
          proximaEtapaId: opcao.proxima ? (idPorChave.get(opcao.proxima) ?? null) : null,
        },
      });
    }
  }

  const primeira = semente.etapas[0];
  if (primeira) {
    await prisma.fluxo.update({
      where: { id: fluxo.id },
      data: { etapaInicialId: idPorChave.get(primeira.chave) ?? null },
    });
  }
}

/** Liga os saltos deste fluxo para outros fluxos, já criados. */
async function vincularEntreFluxos(semente: FluxoSemente): Promise<void> {
  const fluxo = await prisma.fluxo.findUnique({
    where: { chave: semente.chave },
    include: { etapas: { include: { opcoes: true } } },
  });
  if (!fluxo) return;

  const idDoFluxo = async (chave: string): Promise<string | null> => {
    const destino = await prisma.fluxo.findUnique({ where: { chave }, select: { id: true } });
    return destino?.id ?? null;
  };

  for (const etapaSemente of semente.etapas) {
    const etapa = fluxo.etapas.find((item) => item.chave === etapaSemente.chave);
    if (!etapa) continue;

    if (etapaSemente.proximoFluxo) {
      await prisma.etapaFluxo.update({
        where: { id: etapa.id },
        data: { proximoFluxoId: await idDoFluxo(etapaSemente.proximoFluxo) },
      });
    }

    for (const opcaoSemente of etapaSemente.opcoes ?? []) {
      if (!opcaoSemente.proximoFluxo) continue;

      const opcao = etapa.opcoes.find((item) => item.valor === opcaoSemente.valor);
      if (!opcao) continue;

      await prisma.opcaoEtapaFluxo.update({
        where: { id: opcao.id },
        data: { proximoFluxoId: await idDoFluxo(opcaoSemente.proximoFluxo) },
      });
    }
  }
}
