const moeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const moedaCompacta = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});

const numero = new Intl.NumberFormat("pt-BR");

const percentual = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

type Numerico = number | string | { toString(): string } | null | undefined;

function paraNumero(valor: Numerico): number {
  if (valor === null || valor === undefined) return 0;
  if (typeof valor === "number") return valor;
  const convertido = Number(valor.toString());
  return Number.isFinite(convertido) ? convertido : 0;
}

export function formatarMoeda(valor: Numerico): string {
  return moeda.format(paraNumero(valor));
}

export function formatarMoedaCompacta(valor: Numerico): string {
  return moedaCompacta.format(paraNumero(valor));
}

export function formatarNumero(valor: Numerico): string {
  return numero.format(paraNumero(valor));
}

export function formatarPercentual(valor: Numerico): string {
  return `${percentual.format(paraNumero(valor))}%`;
}

export function formatarData(valor: Date | string | null | undefined): string {
  if (!valor) return "—";
  const data = typeof valor === "string" ? new Date(valor) : valor;
  if (Number.isNaN(data.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(data);
}

export function formatarDataHora(valor: Date | string | null | undefined): string {
  if (!valor) return "—";
  const data = typeof valor === "string" ? new Date(valor) : valor;
  if (Number.isNaN(data.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "America/Sao_Paulo",
  }).format(data);
}

export function formatarMesAno(chave: string): string {
  const [ano, mes] = chave.split("-");
  if (!ano || !mes) return chave;
  const data = new Date(Date.UTC(Number(ano), Number(mes) - 1, 1));
  return new Intl.DateTimeFormat("pt-BR", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(data);
}

/**
 * Quanto tempo uma operação levou, do início ao fim.
 *
 * Nula enquanto a operação não terminou — o que é informação, não ausência
 * dela: importação sem duração é importação que ainda está rodando ou que
 * morreu no meio.
 */
export function formatarDuracao(
  inicio: Date | string | null | undefined,
  fim: Date | string | null | undefined,
): string {
  if (!inicio || !fim) return "—";
  const ms = new Date(fim).getTime() - new Date(inicio).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms} ms`;

  const segundos = ms / 1000;
  if (segundos < 60) return `${segundos.toFixed(1)} s`;

  const minutos = Math.floor(segundos / 60);
  return `${minutos}min ${Math.round(segundos - minutos * 60)}s`;
}

export function formatarBytes(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  const unidades = ["B", "KB", "MB", "GB", "TB"];
  let valor = bytes;
  let indice = 0;
  while (valor >= 1024 && indice < unidades.length - 1) {
    valor /= 1024;
    indice += 1;
  }
  return `${valor.toFixed(indice === 0 ? 0 : 1)} ${unidades[indice]}`;
}
