import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// In development, serve the Vercel functions in /api from the Vite server itself, so `npm run dev`
// runs the whole app (UI + analyst). In production Vercel serves /api; this plugin is dev-only.
function vercelApiInDev() {
  return {
    name: 'vercel-api-in-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost');
        const match = url.pathname.match(/^\/api\/([\w-]+)\/?$/);
        if (!match) return next();
        try {
          // ssrLoadModule picks up edits to api/ and server/ without restarting.
          const mod = await server.ssrLoadModule(`/api/${match[1]}.js`);
          const chunks = [];
          for await (const c of req) chunks.push(c);
          const raw = Buffer.concat(chunks).toString('utf8');
          let body = raw;
          try { body = raw ? JSON.parse(raw) : {}; } catch { /* the handler reports bad JSON */ }
          const vreq = Object.assign(req, { body, query: Object.fromEntries(url.searchParams) });
          const vres = Object.assign(res, {
            status(code) { res.statusCode = code; return vres; },
            json(obj) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); return vres; },
            send(text) { res.end(typeof text === 'string' ? text : JSON.stringify(text)); return vres; },
          });
          await mod.default(vreq, vres);
        } catch (e) {
          if (/Failed to load url|does not exist/i.test(String(e?.message))) return next();
          console.error(`[api /${match[1]}] crashed:`, e);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'The API route crashed.', code: 'crash', detail: String(e?.message || e).slice(0, 600) }));
          }
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Make every .env value (not only VITE_*) visible to the API handlers, like Vercel does.
  const env = loadEnv(mode, process.cwd(), '');
  for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;
  return { plugins: [react(), vercelApiInDev()] };
});
