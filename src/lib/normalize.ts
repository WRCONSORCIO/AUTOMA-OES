/**
 * Normalizações usadas para casar dados vindos de fontes distintas
 * (CSV da administradora, PDF de fechamento e cadastro interno).
 */

/** Mantém apenas dígitos. Base canônica de CPF/CNPJ em todo o sistema. */
export function somenteDigitos(valor: string | null | undefined): string {
  if (!valor) return "";
  return valor.replace(/\D+/g, "");
}

export function normalizarDocumento(valor: string | null | undefined): string {
  const digitos = somenteDigitos(valor);
  if (digitos.length === 11 || digitos.length === 14) return digitos;
  return digitos;
}

export function formatarDocumento(valor: string | null | undefined): string {
  const d = somenteDigitos(valor);
  if (d.length === 11) {
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }
  if (d.length === 14) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  }
  return valor ?? "";
}

/** Colapsa espaços e remove acentuação — usado em comparação de nomes. */
export function normalizarTexto(valor: string | null | undefined): string {
  if (!valor) return "";
  return valor
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/**
 * A administradora prefixa o nome do vendedor PJ com a raiz do CNPJ
 * ("42.505.181 JULIA MARIANNE ..."). Removemos esse prefixo para exibição
 * e para casar com o cadastro interno.
 */
export function limparNomeVendedor(valor: string | null | undefined): string {
  if (!valor) return "";
  return valor
    .replace(/^\s*\d{2}\.?\d{3}\.?\d{3}\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Grupo é sempre comparado sem zeros à esquerda e sem sufixo decimal. */
export function normalizarGrupo(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined) return "";
  const bruto = String(valor).trim().replace(/\.0+$/, "");
  const digitos = bruto.replace(/\D+/g, "");
  return digitos.replace(/^0+(?=\d)/, "");
}

/**
 * A cota aparece como "3162-2" no CSV e "2754.4" no PDF (dígito verificador
 * separado). Canonicamente guardamos "NNNN-D".
 */
export function normalizarCota(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined) return "";
  const bruto = String(valor).trim();
  const match = bruto.match(/^(\d+)\s*[-.]\s*(\d)$/);
  if (match) {
    const numero = match[1]!.replace(/^0+(?=\d)/, "");
    return `${numero}-${match[2]}`;
  }
  const digitos = bruto.replace(/\D+/g, "");
  if (!digitos) return "";
  if (digitos.length > 1) {
    const numero = digitos.slice(0, -1).replace(/^0+(?=\d)/, "");
    return `${numero}-${digitos.slice(-1)}`;
  }
  return digitos;
}

/** Contrato vem com espaços à direita no CSV ("53818I10  "). */
export function normalizarContrato(valor: string | null | undefined): string {
  if (!valor) return "";
  return valor.trim().toUpperCase();
}

/**
 * Converte valores no formato brasileiro ("R$ 1.365,59", "2.500,00-") para
 * número. O sufixo "-" da administradora indica valor negativo (estorno).
 */
export function parseValorBr(valor: string | number | null | undefined): number | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;

  let texto = valor.trim();
  if (!texto) return null;

  let negativo = false;
  if (texto.endsWith("-")) {
    negativo = true;
    texto = texto.slice(0, -1).trim();
  }
  if (texto.startsWith("-")) {
    negativo = true;
    texto = texto.slice(1).trim();
  }

  texto = texto.replace(/R\$/gi, "").replace(/\s+/g, "");
  if (!texto) return null;

  // Formato brasileiro: ponto como separador de milhar, vírgula como decimal.
  texto = texto.replace(/\./g, "").replace(",", ".");

  const numero = Number(texto);
  if (!Number.isFinite(numero)) return null;
  return negativo ? -numero : numero;
}

/** Aceita dd/MM/yyyy (CSV e PDF) e yyyy-MM-dd. Retorna data em UTC puro. */
export function parseDataBr(valor: string | null | undefined): Date | null {
  if (!valor) return null;
  const texto = valor.trim();
  if (!texto) return null;

  const br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) {
    const [, dia, mes, ano] = br;
    return criarDataUtc(Number(ano), Number(mes), Number(dia));
  }

  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const [, ano, mes, dia] = iso;
    return criarDataUtc(Number(ano), Number(mes), Number(dia));
  }

  return null;
}

function criarDataUtc(ano: number, mes: number, dia: number): Date | null {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  if (
    data.getUTCFullYear() !== ano ||
    data.getUTCMonth() !== mes - 1 ||
    data.getUTCDate() !== dia
  ) {
    return null;
  }
  return data;
}

export function parseInteiro(valor: string | number | null | undefined): number | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? Math.trunc(valor) : null;
  const texto = valor.trim().replace(/\D+/g, "");
  if (!texto) return null;
  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : null;
}

export function parseBooleanoSN(valor: string | null | undefined): boolean {
  return normalizarTexto(valor) === "S";
}

/** Normaliza texto de campo livre vindo do CSV (padded com espaços). */
export function limparCampo(valor: string | null | undefined): string | null {
  if (valor === null || valor === undefined) return null;
  const texto = valor.trim();
  return texto.length > 0 ? texto : null;
}
