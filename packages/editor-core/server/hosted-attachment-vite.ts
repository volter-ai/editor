import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { createHostedAttachmentRelay } from './hosted-attachment-relay';

/** Opt-in on a hosted shell's development server. Production hosts can mount
 * createHostedAttachmentRelay on their HTTP server instead. */
export function hostedAttachmentPlugin(origin: string): Plugin {
  return {
    name: 'volter-editor-hosted-attachment',
    configureServer(server) {
      if (!server.httpServer) throw new Error('Hosted attachment requires an HTTP server.');
      const relay = createHostedAttachmentRelay({ origin });
      const uninstall = relay.install(server.httpServer);
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] === '/__editor-hosted/client.js') {
          response.setHeader('content-type', 'text/javascript');
          response.setHeader('cache-control', 'no-store');
          response.end(readFileSync(new URL('./hosted-attachment-client.js', import.meta.url))); return;
        }
        void relay.middleware(request, response, next).catch(next);
      });
      server.httpServer.once('close', () => { uninstall(); relay.close(); });
    },
  };
}
