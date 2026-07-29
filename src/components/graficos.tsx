"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatarMesAno, formatarMoeda, formatarMoedaCompacta } from "@/lib/format";
import type { ItemRanking, PontoMensal } from "@/server/services/dashboard";

/**
 * Duas séries apenas, nas cores categóricas 1 e 2 da paleta — validadas para
 * daltonismo e contraste nos modos claro e escuro.
 */
const SERIE_RELATORIO = "var(--color-serie-1)";
const SERIE_WR = "var(--color-serie-2)";

interface DicaProps {
  active?: boolean;
  label?: string | number;
  payload?: { name?: string; value?: number; color?: string }[];
  formatarRotulo?: (valor: string) => string;
}

function Dica({ active, label, payload, formatarRotulo }: DicaProps) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-[var(--color-borda-forte)] bg-[var(--color-superficie-2)] px-3 py-2 text-xs shadow-lg">
      <p className="mb-1.5 font-medium text-[var(--color-texto)]">
        {formatarRotulo ? formatarRotulo(String(label ?? "")) : String(label ?? "")}
      </p>
      <ul className="flex flex-col gap-1">
        {payload.map((item) => (
          <li key={item.name} className="flex items-center gap-2">
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-[var(--color-texto-2)]">{item.name}</span>
            <span className="numerico ml-auto font-medium text-[var(--color-texto)]">
              {formatarMoeda(item.value ?? 0)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const EIXO = { stroke: "var(--color-borda)", fontSize: 12 } as const;

export function GraficoMensal({ dados }: { dados: PontoMensal[] }) {
  if (dados.length === 0) {
    return <SemDados mensagem="Nenhum lançamento de comissão no período selecionado." />;
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={dados} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} barGap={2}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="mes"
          tickFormatter={formatarMesAno}
          tickLine={false}
          axisLine={EIXO}
          tick={{ fontSize: 12 }}
        />
        <YAxis
          tickFormatter={(valor: number) => formatarMoedaCompacta(valor)}
          tickLine={false}
          axisLine={false}
          width={70}
          tick={{ fontSize: 12 }}
        />
        <Tooltip
          cursor={{ fill: "color-mix(in oklab, var(--color-texto) 6%, transparent)" }}
          content={<Dica formatarRotulo={formatarMesAno} />}
        />
        <Legend
          verticalAlign="top"
          align="left"
          height={32}
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 12 }}
        />
        <Bar
          dataKey="valor"
          name="Recebido do relatório"
          fill={SERIE_RELATORIO}
          radius={[4, 4, 0, 0]}
          maxBarSize={38}
        />
        <Bar
          dataKey="comissaoWr"
          name="Comissão WR"
          fill={SERIE_WR}
          radius={[4, 4, 0, 0]}
          maxBarSize={38}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function GraficoRanking({
  dados,
  rotuloValor = "Recebido",
}: {
  dados: ItemRanking[];
  rotuloValor?: string;
}) {
  if (dados.length === 0) {
    return <SemDados mensagem="Sem dados para o ranking no período selecionado." />;
  }

  const altura = Math.max(200, dados.length * 38 + 24);

  return (
    <ResponsiveContainer width="100%" height={altura}>
      <BarChart
        data={dados}
        layout="vertical"
        margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
      >
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis
          type="number"
          tickFormatter={(valor: number) => formatarMoedaCompacta(valor)}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 12 }}
        />
        <YAxis
          type="category"
          dataKey="nome"
          width={160}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 12 }}
        />
        <Tooltip
          cursor={{ fill: "color-mix(in oklab, var(--color-texto) 6%, transparent)" }}
          content={<Dica />}
        />
        <Bar dataKey="valor" name={rotuloValor} radius={[0, 4, 4, 0]} maxBarSize={22}>
          {dados.map((item) => (
            <Cell key={item.id} fill={SERIE_RELATORIO} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function SemDados({ mensagem }: { mensagem: string }) {
  return (
    <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-[var(--color-borda-forte)] px-4 text-center text-sm text-[var(--color-texto-3)]">
      {mensagem}
    </div>
  );
}
