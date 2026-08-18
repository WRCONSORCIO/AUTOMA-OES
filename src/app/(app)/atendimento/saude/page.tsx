import type { Metadata } from "next";
import { exigirPermissao } from "@/server/auth/session";
import { CabecalhoPagina, Card, CardContent } from "@/components/ui";
import { verificarSaude, type EstadoServico } from "@/server/atendimento/servicos/saude";

export const metadata: Metadata = { title: "Saúde do sistema" };
export const dynamic = "force-dynamic";

const SINAL: Record<EstadoServico, string> = {
  ok: "🟢",
  degradado: "🟡",
  indisponivel: "🔴",
};

export default async function PaginaSaude() {
  await exigirPermissao("atendimento");
  const saude = await verificarSaude();

  return (
    <>
      <CabecalhoPagina
        titulo="Saúde do sistema"
        descricao="Estado de cada dependência do atendimento. Amarelo é falta de configuração; vermelho é serviço fora."
      />

      <Card>
        <CardContent className="flex flex-col gap-3">
          {saude.servicos.map((servico) => (
            <div
              key={servico.servico}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-borda)] px-4 py-3"
            >
              <span className="font-medium">
                {SINAL[servico.estado]} {servico.servico}
              </span>
              <span className="text-sm text-[var(--color-texto-2)]">{servico.detalhe}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <p className="text-xs text-[var(--color-texto-3)]">
        Mesma verificação disponível em <code>/api/health</code> para monitoramento externo.
        Verificado em {saude.verificadoEm}.
      </p>
    </>
  );
}
