export function SetupNoticePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-6">
      <div className="max-w-lg rounded-xl border bg-card p-8 shadow-sm">
        <h1 className="text-xl font-semibold">Configure o Supabase</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Este projeto ainda não tem as credenciais do Supabase configuradas.
        </p>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm">
          <li>
            Crie um projeto gratuito em{" "}
            <span className="font-medium">supabase.com</span>.
          </li>
          <li>
            Rode o SQL de <code className="rounded bg-muted px-1 py-0.5">supabase/migrations/0001_init.sql</code>{" "}
            no SQL Editor do seu projeto.
          </li>
          <li>
            Copie <code className="rounded bg-muted px-1 py-0.5">.env.example</code> para{" "}
            <code className="rounded bg-muted px-1 py-0.5">.env</code> e preencha
            <code className="rounded bg-muted px-1 py-0.5 ml-1">VITE_SUPABASE_URL</code> e{" "}
            <code className="rounded bg-muted px-1 py-0.5">VITE_SUPABASE_ANON_KEY</code>{" "}
            (Project Settings → API).
          </li>
          <li>Reinicie o servidor (<code className="rounded bg-muted px-1 py-0.5">npm run dev</code>).</li>
        </ol>
      </div>
    </div>
  )
}
