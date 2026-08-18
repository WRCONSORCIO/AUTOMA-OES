import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["pdfjs-dist", "@prisma/client", "bcryptjs"],
  // O pdfjs carrega o worker por import dinâmico, que o rastreador de arquivos
  // da Vercel não consegue seguir — o arquivo ficava de fora do pacote e a
  // importação de PDF quebrava em produção com "Cannot find module
  // .../pdf.worker.mjs". Só a rota de importação lê PDF.
  outputFileTracingIncludes: {
    "/api/importacoes": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    ],
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
