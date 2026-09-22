import { type ChildProcess, spawn } from 'node:child_process';

export type ShareTunnelProvider = 'cloudflared' | 'ngrok';

export interface ShareTunnel {
  child: ChildProcess;
  publicUrl: string;
}

export type ShareTunnelStarter = (port: number) => Promise<ShareTunnel>;

function publicUrl(line: string, pattern: RegExp): string | null {
  const direct = line.match(pattern)?.[0];
  if (direct) return direct;
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    for (const value of Object.values(parsed)) {
      if (typeof value !== 'string') continue;
      const match = value.match(pattern)?.[0];
      if (match) return match;
    }
  } catch {
    // Human-readable output is handled by the direct expression.
  }
  return null;
}

export function parseNgrokPublicUrl(line: string): string | null {
  return publicUrl(line, /https:\/\/[a-zA-Z0-9.-]+\.ngrok(?:-free)?\.(?:app|dev)/);
}

export function parseCloudflaredPublicUrl(line: string): string | null {
  return publicUrl(line, /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
}

function startTunnelProcess(input: {
  provider: ShareTunnelProvider;
  command: string;
  args: string[];
  parseUrl(line: string): string | null;
  prerequisite: string;
}): Promise<ShareTunnel> {
  const child = spawn(input.command, input.args, { stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise<ShareTunnel>((resolveUrl, rejectUrl) => {
    let settled = false;
    let output = '';
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      rejectUrl(
        new Error(`${input.provider} did not publish a URL within 30 seconds.\n${output.trim()}`),
      );
    }, 30_000);
    const inspect = (chunk: Buffer | string) => {
      const text = chunk.toString();
      output = `${output}${text}`.slice(-8_000);
      for (const line of text.split(/\r?\n/)) {
        const url = input.parseUrl(line);
        if (!url || settled) continue;
        settled = true;
        clearTimeout(timer);
        resolveUrl({ child, publicUrl: url });
        return;
      }
    };
    child.stdout?.on('data', inspect);
    child.stderr?.on('data', inspect);
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectUrl(new Error(error.message.includes('ENOENT') ? input.prerequisite : error.message));
    });
    child.once('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectUrl(
        new Error(
          `${input.provider} exited before publishing a URL (code ${code}).\n${output.trim()}`,
        ),
      );
    });
  });
}

export function startNgrokShareTunnel(port: number): Promise<ShareTunnel> {
  return startTunnelProcess({
    provider: 'ngrok',
    command: 'ngrok',
    args: ['http', `http://127.0.0.1:${port}`, '--log', 'stdout', '--log-format', 'json'],
    parseUrl: parseNgrokPublicUrl,
    prerequisite: 'ngrok is required for this share. Install and authenticate ngrok first.',
  });
}

export function startCloudflaredShareTunnel(port: number): Promise<ShareTunnel> {
  return startTunnelProcess({
    provider: 'cloudflared',
    command: 'cloudflared',
    args: [
      'tunnel',
      '--url',
      `http://127.0.0.1:${port}`,
      '--no-autoupdate',
      // Quick Tunnels default to QUIC, which is commonly blocked on managed
      // networks even when ordinary HTTPS works. HTTP/2 preserves the
      // accountless path without requiring UDP egress.
      '--protocol',
      'http2',
      '--config',
      process.platform === 'win32' ? 'NUL' : '/dev/null',
    ],
    parseUrl: parseCloudflaredPublicUrl,
    prerequisite:
      'cloudflared is required for this share. Install cloudflared; Quick Tunnels need no Cloudflare account.',
  });
}

export function shareTunnelStarter(provider: ShareTunnelProvider): ShareTunnelStarter {
  return provider === 'cloudflared' ? startCloudflaredShareTunnel : startNgrokShareTunnel;
}
