import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Cifra as credenciais guardadas no banco (chave da API do WhatsApp, chave
 * secreta do gateway, token de webhook).
 *
 * Elas precisam ser lidas de volta para chamar o provedor, então hash não
 * serve — é cifragem simétrica, com a chave derivada do `AUTH_SECRET`. Quem
 * lê o banco sem o segredo da aplicação não obtém a credencial.
 *
 * O que sai daqui para o navegador é sempre `mascarar()`. A credencial em
 * texto claro nunca cruza a fronteira do servidor.
 */

const ALGORITMO = "aes-256-gcm";
const SAL = "atendimento-whatsapp";

function chave(): Buffer {
  return scryptSync(env().AUTH_SECRET, SAL, 32);
}

export function cifrar(valor: string): string {
  const iv = randomBytes(12);
  const cifra = createCipheriv(ALGORITMO, chave(), iv);
  const conteudo = Buffer.concat([cifra.update(valor, "utf8"), cifra.final()]);
  const tag = cifra.getAuthTag();

  return [iv.toString("base64"), tag.toString("base64"), conteudo.toString("base64")].join(".");
}

/**
 * Devolve `null` quando o texto não é decifrável — trocar o `AUTH_SECRET`
 * invalida as credenciais gravadas, e é melhor a tela dizer "reconfigure" do
 * que o processo cair no meio de um atendimento.
 */
export function decifrar(cifrado: string | null | undefined): string | null {
  if (!cifrado) return null;

  const partes = cifrado.split(".");
  if (partes.length !== 3) return null;

  try {
    const [iv, tag, conteudo] = partes as [string, string, string];
    const decifra = createDecipheriv(ALGORITMO, chave(), Buffer.from(iv, "base64"));
    decifra.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([
      decifra.update(Buffer.from(conteudo, "base64")),
      decifra.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/** Como a credencial aparece no painel: só o fim, nunca o valor inteiro. */
export function mascarar(valor: string | null | undefined): string {
  if (!valor) return "—";
  if (valor.length <= 4) return "••••";
  return `••••${valor.slice(-4)}`;
}
