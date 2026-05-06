# AgentDB Marketing UI

Vite + React + shadcn/ui marketing/docs site for [agentdb](https://www.npmjs.com/package/agentdb).

This was previously hosted at `ruvnet/agentdb-site` and was merged into `ruvnet/agentdb` under `ui/` on 2026-05-06.

## Develop

```bash
cd ui
npm install
npm run dev
```

## Environment

Copy `.env.example` to `.env` and fill in the Supabase credentials. The previous `.env` file (containing public Supabase publishable keys) was scrubbed during the migration.
