import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

function syncTollApiPlugin(): Plugin {
  const attach = (
    middlewares: {
      use: (
        path: string,
        handler: (req: unknown, res: unknown, next: () => void) => void,
      ) => void
    },
    root: string,
  ) => {
    middlewares.use('/api/sync-toll', (req, res, next) => {
      const request = req as { method?: string }
      const response = res as {
        setHeader: (name: string, value: string) => void
        statusCode: number
        end: (body: string) => void
      }

      if (request.method !== 'POST') {
        next()
        return
      }

      void (async () => {
        try {
          const moduleUrl = pathToFileURL(
            path.join(root, 'scripts', 'sync-toll.mjs'),
          ).href
          const { syncTollData } = await import(`${moduleUrl}?t=${Date.now()}`)
          const result = await syncTollData()
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.end(JSON.stringify(result))
        } catch (err) {
          response.statusCode = 500
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.end(
            JSON.stringify({
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            }),
          )
        }
      })()
    })
  }

  return {
    name: 'sync-toll-api',
    configureServer(server) {
      attach(server.middlewares, server.config.root)
    },
    configurePreviewServer(server) {
      attach(server.middlewares, server.config.root)
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Primer: VITE_BASE=/  →  https://transportcost.info/
  // Podfolder: VITE_BASE=/app/  →  https://transportcost.info/app/
  const base = env.VITE_BASE?.trim() || '/'

  return {
    base,
    plugins: [react(), syncTollApiPlugin()],
  }
})
