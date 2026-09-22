import { randomBytes, timingSafeEqual } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

export const COMFYUI_BRIDGE_TOKEN = randomBytes(32).toString('base64url');

export function validComfyUIBridgeAuthorization(header: string | undefined): boolean {
  const actual = Buffer.from(header?.startsWith('Bearer ') ? header.slice(7) : '');
  const expected = Buffer.from(COMFYUI_BRIDGE_TOKEN);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function allowedComfyUIProviderOperation(
  generation:
    | {
        provider: string;
        role: string;
      }
    | null
    | undefined,
): boolean {
  return Boolean(
    generation &&
      ['fal', 'tripo', 'worldlabs', 'openrouter'].includes(generation.provider) &&
      ['submit', 'poll', 'cancel'].includes(generation.role),
  );
}

function normalizeBridgeBaseUrl(value: string): { baseUrl: string; loopback: boolean } {
  const url = new URL(value.trim());
  const loopback =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('ComfyUI must use HTTPS, or loopback HTTP for a local installation.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('ComfyUI base URL must not contain credentials, a query, or a fragment.');
  }
  return { baseUrl: `${url.origin}${url.pathname.replace(/\/$/, '')}`, loopback };
}

export async function configureComfyUIBridge(
  baseUrlInput: string,
  editorUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<{ baseUrl: string; providerBridge: boolean }> {
  const { baseUrl, loopback } = normalizeBridgeBaseUrl(baseUrlInput);
  // A remote backend can execute ordinary Comfy workflows, but it must never
  // receive a capability that calls back into this machine's local editor.
  if (!loopback) return { baseUrl, providerBridge: false };
  const response = await fetcher(`${baseUrl}/vgai/configure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ editorUrl, token: COMFYUI_BRIDGE_TOKEN }),
  });
  if (!response.ok) {
    throw new Error(`ComfyUI bridge configuration failed with HTTP ${response.status}.`);
  }
  return { baseUrl, providerBridge: true };
}

const INIT_PY = `from .vgai_bridge import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

WEB_DIRECTORY = "./web"
__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
`;

const BRIDGE_PY = `import json
import time
import urllib.error
import urllib.request
from aiohttp import web
from server import PromptServer

_config = {"editor_url": None, "token": None}

@PromptServer.instance.routes.post("/vgai/configure")
async def configure_vgai(request):
    if request.remote not in ("127.0.0.1", "::1"):
        return web.json_response({"error": "Volter Editor bridge configuration is loopback-only."}, status=403)
    body = await request.json()
    editor_url = str(body.get("editorUrl", "")).rstrip("/")
    token = str(body.get("token", ""))
    if not (editor_url.startswith("http://127.") or editor_url.startswith("http://localhost:") or editor_url.startswith("https://")):
        return web.json_response({"error": "Volter Editor URL must be loopback HTTP or HTTPS."}, status=400)
    if len(token) < 32:
        return web.json_response({"error": "Volter Editor bridge token is invalid."}, status=400)
    _config.update(editor_url=editor_url, token=token)
    return web.json_response({"ok": True})

def _call(body):
    if not _config["editor_url"] or not _config["token"]:
        raise RuntimeError("Open this workflow through Volter Editor before running a Volter Editor provider node.")
    request = urllib.request.Request(
        _config["editor_url"] + "/__editor/comfyui/provider-operation",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": "Bearer " + _config["token"],
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError("Volter Editor provider operation failed: " + detail) from error

class VGAIProviderOperation:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "operation": ("STRING", {"default": "project.fal.submit"}),
                "route": (["managed", "byok", "mock"],),
                "input_json": ("STRING", {"multiline": True, "default": "{}"}),
                "wait_for_result": ("BOOLEAN", {"default": True}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("result_json",)
    FUNCTION = "run"
    OUTPUT_NODE = True
    CATEGORY = "Volter Editor/Providers"

    def run(self, operation, route, input_json, wait_for_result):
        native_input = json.loads(input_json)
        if not isinstance(native_input, dict):
            raise ValueError("Volter Editor provider input_json must decode to an object.")
        native_input.setdefault("mode", "direct" if route == "byok" else route)
        outcome = _call({"name": operation, "input": native_input, "confirm": True})
        if not outcome.get("ok"):
            raise RuntimeError(outcome.get("error", {}).get("message", "Volter Editor provider operation failed."))
        job = outcome.get("generation")
        if wait_for_result and job:
            for _ in range(1800):
                if job.get("status") not in ("queued", "running"):
                    break
                poll = job.get("poll") or {}
                if not poll.get("tool"):
                    break
                time.sleep(2)
                outcome = _call({"name": poll["tool"], "input": poll.get("input", {}), "confirm": False})
                if not outcome.get("ok"):
                    raise RuntimeError(outcome.get("error", {}).get("message", "Volter Editor provider polling failed."))
                job = outcome.get("generation") or job
            else:
                raise RuntimeError("Volter Editor provider operation exceeded the one-hour wait limit.")
        payload = json.dumps({"result": outcome.get("data"), "generation": job}, separators=(",", ":"))
        return {"ui": {"text": (payload,)}, "result": (payload,)}

NODE_CLASS_MAPPINGS = {"VGAIProviderOperation": VGAIProviderOperation}
NODE_DISPLAY_NAME_MAPPINGS = {"VGAIProviderOperation": "Volter Editor Provider Operation"}
`;

const BRIDGE_JS = `import { app } from "/scripts/app.js";

let activePath = null;
let editorOrigin = null;

function reply(target, message, origin = editorOrigin) {
  if (!origin) return;
  target?.postMessage({ source: "vgai-comfyui-bridge", ...message }, origin);
}

window.addEventListener("message", async (event) => {
  const message = event.data;
  if (!message || message.source !== "vgai-editor") return;
  try {
    if (message.type === "configure") {
      const requestedOrigin = new URL(message.editorUrl).origin;
      if (event.origin !== requestedOrigin) throw new Error("Volter Editor origin mismatch.");
      editorOrigin = requestedOrigin;
      reply(event.source, { type: "ready" }, requestedOrigin);
      return;
    }
    if (!editorOrigin || event.origin !== editorOrigin) return;
    if (message.type === "load") {
      activePath = message.path;
      await app.loadGraphData(message.workflow, true, true, activePath);
      reply(event.source, { type: "loaded", path: activePath, requestId: message.requestId });
      return;
    }
    if (message.type === "export") {
      const execution = await app.graphToPrompt();
      reply(event.source, {
        type: "exported",
        requestId: message.requestId,
        action: message.action,
        path: activePath,
        workflow: app.rootGraph.serialize(),
        prompt: execution.output,
        clientId: app.api?.clientId,
      });
    }
  } catch (error) {
    reply(event.source, {
      type: "error",
      requestId: message?.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

app.registerExtension({
  name: "vgai.bridge",
  setup() {
    window.parent?.postMessage({ source: "vgai-comfyui-bridge", type: "extension-ready" }, "*");
  },
});
`;

export interface ComfyBridgeInstallResult {
  root: string;
  files: string[];
  restartRequired: true;
}

export async function installComfyUIBridge(rootInput: string): Promise<ComfyBridgeInstallResult> {
  const root = resolve(rootInput.trim());
  if (!rootInput.trim()) throw new Error('A ComfyUI installation directory is required.');
  await access(resolve(root, 'main.py'));
  const destination = resolve(root, 'custom_nodes', 'vgai_bridge');
  if (!destination.startsWith(`${root}${sep}`))
    throw new Error('Invalid ComfyUI bridge destination.');
  await mkdir(resolve(destination, 'web'), { recursive: true });
  const files = [
    [resolve(destination, '__init__.py'), INIT_PY],
    [resolve(destination, 'vgai_bridge.py'), BRIDGE_PY],
    [resolve(destination, 'web', 'vgai-bridge.js'), BRIDGE_JS],
  ] as const;
  for (const [path, content] of files) await writeFile(path, content, 'utf8');
  return { root, files: files.map(([path]) => path), restartRequired: true };
}

export async function comfyUIBridgeInstalled(rootInput: string): Promise<boolean> {
  try {
    const source = await readFile(
      resolve(rootInput.trim(), 'custom_nodes', 'vgai_bridge', 'vgai_bridge.py'),
      'utf8',
    );
    return source.includes('class VGAIProviderOperation');
  } catch {
    return false;
  }
}
