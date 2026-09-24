import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { EDITOR_BRAND, editorAppIconSvg } from '@volter/editor-sdk/session/editor-brand';
import type {
  ShareAccount,
  ShareAuditEvent,
  ShareCapability,
  ShareParticipant,
  ShareRole,
} from '@volter/editor-sdk/share';
import { WebSocket, WebSocketServer } from 'ws';
import { editorHmrPort } from '@volter/editor-project/manifest/editor-port';
import {
  isServableFsExtension,
  isServableFsPath,
  PROJECT_RESOURCE_EXTENSIONS,
  SERVABLE_FS_EXTENSIONS,
} from './server-utils';
import { signedShareClaimHeaders } from './share-claims';

const COOKIE = 'vgai_share';
const AUTH_PATH = '/__vgai_share/auth';
const CALLBACK_PATH = '/__vgai_share/callback';
const COMPLETE_PATH = '/__vgai_share/complete';
const HEALTH_PATH = '/__vgai_share/health';

export type { ShareCapability, ShareRole } from '@volter/editor-sdk/share';

const ROLE_CAPABILITIES: Record<ShareRole, readonly ShareCapability[]> = {
  viewer: ['view'],
  commenter: ['view', 'comment'],
  tester: ['view', 'comment', 'test'],
  editor: ['view', 'comment', 'test', 'edit'],
  terminal: ['view', 'comment', 'test', 'edit', 'terminal'],
};

/**
 * Least authority first. Derived from a `satisfies Record<ShareRole, …>` rank
 * table rather than written as an array annotated `readonly ShareRole[]`, for
 * the same reason `COLLABORATION_ROLE_ORDER` is: the array form ACCEPTS an
 * incomplete list, so adding a role and forgetting it here compiles, and
 * `roleAllowsRole` then reads the new role as over every ceiling. A missing key
 * here is a compile error.
 */
const ROLE_RANK = {
  viewer: 0,
  commenter: 1,
  tester: 2,
  editor: 3,
  terminal: 4,
} as const satisfies Record<ShareRole, number>;

const ROLE_ORDER: readonly ShareRole[] = (Object.keys(ROLE_RANK) as ShareRole[]).sort(
  (a, b) => ROLE_RANK[a] - ROLE_RANK[b],
);

/** A share invitation's ceiling stops at `terminal`. The collaboration
 * session's `maintainer` has no gateway meaning, so it is not a share role. */
export function isShareRole(value: string): value is ShareRole {
  return (ROLE_ORDER as readonly string[]).includes(value);
}

/**
 * The account as the GATEWAY holds it: the wire's {@link ShareAccount} plus the
 * organization list it needs to resolve a team invitation. The extension is
 * server-local by construction — `ShareHost.status()` projects a participant
 * down to `ShareParticipant`, so the org list never rides the status wire.
 */
export interface ShareAccountProjection extends ShareAccount {
  organizations?: Array<{
    id: string;
    name: string;
    slug?: string;
    role: string;
    domains: Array<{
      name: string;
      verified: boolean;
      enrollmentMode:
        | 'manual_invitation'
        | 'automatic_invitation'
        | 'automatic_suggestion'
        | 'enterprise_sso';
    }>;
  }>;
}

export interface ShareGrantRedemption {
  jti: string;
  participant: ShareAccountProjection;
}

/**
 * A redemption that failed because the VGAI account service could not be
 * reached or answered 5xx — NOT because the grant belongs to a different
 * invitation. The gateway must keep the two apart: an unreachable service is a
 * 502 the participant can retry, while "this invitation does not own that
 * grant" is the ordinary 403 that makes probing every live invitation safe.
 */
export class ShareGrantServiceError extends Error {}

export interface GatewayInvitation {
  id: string;
  token: string;
  role: ShareRole;
  expiresAt: number;
  authorize(): Promise<string>;
  recipientAccountId?: string;
  recipientEmail?: string;
  recipientOrganizationId?: string;
  recipientOrganizationDomain?: string;
  usePolicy: 'person' | 'team';
  redeem(grant: string): Promise<ShareGrantRedemption>;
}

/** A wire {@link ShareParticipant} carrying the gateway's own richer account. */
export interface GatewayParticipant extends ShareParticipant {
  account: ShareAccountProjection;
}

/** The audit row IS the wire's — the gateway adds nothing to it. */
export type GatewayAuditEvent = ShareAuditEvent;

export interface SessionShareGateway {
  readonly port: number;
  addInvitation(invitation: GatewayInvitation): void;
  revokeInvitation(invitationId: string): number;
  kickParticipant(participantId: string): number;
  setParticipantRole(participantId: string, role: ShareRole): void;
  /** Whether this id names a credentialed tunnel participant. The one question
   * the editor's local routes ask before treating an id as remote. */
  hasParticipant(participantId: string): boolean;
  participants(): readonly GatewayParticipant[];
  audit(): readonly GatewayAuditEvent[];
  close(): Promise<void>;
}

interface AuthenticatedShare {
  credentialId: string;
  participantId: string;
  account: ShareAccountProjection;
  invitationId: string;
  role: ShareRole;
  roleCeiling: ShareRole;
  joined: boolean;
}

function sameSecret(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  return header
    ?.split(';')
    .map((part) => part.trim().split('='))
    .find(([key]) => key === name)?.[1];
}

const GATEWAY_PARTICIPANT_PREFIX = 'account-';

function participantIdFor(accountId: string): string {
  return `${GATEWAY_PARTICIPANT_PREFIX}${createHash('sha256').update(accountId).digest('base64url').slice(0, 22)}`;
}

/** Whether an id is one the gateway MINTS for a verified account, as opposed
 * to one a local editor page minted for itself. The two id spaces are separate
 * so a loopback caller cannot claim a remote person's identity after that
 * person's credential is gone but their session record lingers. */
export function isGatewayParticipantId(value: string): boolean {
  return value.startsWith(GATEWAY_PARTICIPANT_PREFIX);
}

/** A role outside `ROLE_ORDER` (the collaboration session's `maintainer`, say)
 * is over EVERY ceiling: gateway roles stop at `terminal`. Answering with an
 * `indexOf` of -1 would read as "below every ceiling" and let an unmodelled
 * role be stored, where `ROLE_CAPABILITIES[role]` is undefined and the next
 * proxied request throws inside the capability gate. */
function roleAllowsRole(ceiling: ShareRole, role: ShareRole): boolean {
  const requested = ROLE_ORDER.indexOf(role);
  return requested >= 0 && requested <= ROLE_ORDER.indexOf(ceiling);
}

const NEVER_SHARE_PATHS = new Set([
  '/__editor/adapt-project',
  '/__editor/browse-folder',
  '/__editor/create-project',
  '/__editor/download',
  // Seven more that were never declared — the literal-route guard below has
  // been red on main since each landed, and `requestedShareCapability`'s
  // fallback has been answering `never-share` for all of them the whole time.
  // Writing them down changes NO behavior; it only stops the guard reporting a
  // backlog instead of a regression. Two of them deserve their own
  // workstream's second look rather than a refactor's: a shared game page
  // plausibly wants `scoped-game-css` and `play-phase`, and today it is
  // refused both.
  '/__editor/play-phase',
  '/__editor/project-verbs',
  '/__editor/recording/abort',
  '/__editor/recording/asset',
  '/__editor/recording/chunk',
  '/__editor/recording/dom',
  '/__editor/recording/finish',
  '/__editor/recording/replay-file',
  '/__editor/recording/start',
  '/__editor/scoped-game-css',
  '/__editor/editor-state',
  // The USER settings layer is the host's own ~/.vgai/settings.json.
  '/__editor/settings/user',
  '/__editor/themes/user',
  '/__editor/git/status',
  '/__editor/inspect-project',
  '/__editor/launcher-settings',
  '/__editor/open-project',
  '/__editor/recent-projects',
  '/__editor/reveal',
  '/__editor/save-thumbnail',
  // The tab heartbeat is LOCAL presence. A remote participant's tab is seen
  // through its bridged event stream (tab-presence.ts's union rule covers a
  // client that cannot beat); letting it beat would put a foreign tab in the
  // host session's table, where the bijection would then try to manage it.
  // The worker script is refused for the same reason and in the same breath:
  // handing a tunnelled tab a worker whose every beat gets a 403 would just
  // be a 403 once per second forever.
  '/__editor/heartbeat',
  '/__editor/tab-heartbeat.js',
  '/__editor/tab/ensure',
  '/__editor/tab/expect-restart',
  '/__editor/worktrees',
]);

const VIEW_API_PATHS = new Set([
  '/__editor/assets',
  '/__editor/collaboration',
  '/__editor/collaboration/messages',
  '/__editor/collaboration/revisions',
  // Reading the session's unresolved errors/warnings. A guest's own tab is one
  // of the things reporting into that set, and a guest who cannot see what
  // their page just broke is a guest who reports it to nobody.
  '/__editor/console',
  '/__editor/collaboration/audit',
  '/__editor/compatibility',
  '/__editor/events',
  '/__editor/examples',
  '/__editor/export',
  '/__editor/learn-thumbnail',
  '/__editor/manifest',
  '/__editor/project',
  '/__editor/project-attribution',
  '/__editor/project-components',
  '/__editor/project-thumbnail',
  '/__editor/project-resource',
  '/__editor/repository-presence',
  // The PROJECT settings layer is committed project data: read as view.
  '/__editor/settings/project',
  '/__editor/themes/project',
  '/__editor/story-files',
  '/__editor/source-conflict',
  '/__editor/templates',
  '/__editor/tab-yielded',
  '/__editor/validation-log',
  '/__editor/vgai-file',
]);

const VIEW_MUTATION_PATHS = new Set([
  '/__editor/collaboration/join',
  '/__editor/collaboration/leave',
  '/__editor/collaboration/presence',
  // A page reporting an error IN ITSELF, like `tab/route` below: it grants the
  // reporter nothing and claims nothing about anyone else, and a guest whose
  // tab dies during boot needs the same honest answer the host gets.
  '/__editor/page-error',
  // Same reasoning as `page-error` directly above, and the same shape: a page
  // saying what IT logged. It grants the reporter nothing.
  '/__editor/console-entries',
  // Same shape again: a page saying a condition IT raised is gone.
  '/__editor/console-resolved',
  '/__editor/tab-yielded',
  '/__editor/tab/claim',
  // A page saying IT is going away (`pagehide` beacon). Same shape as
  // `tab/route` below: a statement about the sender and nobody else, and the
  // difference between `closed` and `crashed` for a guest's tab too.
  '/__editor/tab/close',
  '/__editor/tab/route',
]);

const TEST_PATHS = new Set([
  '/__editor/collaboration/team-test',
  '/__editor/collaboration/team-test/stop',
  '/__editor/log-entries',
  '/__editor/log-session',
  '/__editor/server-log',
  '/__editor/state',
]);

const EDIT_PATHS = new Set([
  '/__editor/data-file',
  '/__editor/manifest',
  '/__editor/project-resource',
  '/__editor/save-file',
  '/__editor/settings/project',
  '/__editor/themes/project',
  '/__editor/source-conflict/resolve',
  '/__editor/vgai-file',
]);

const TERMINAL_PATHS = new Set([
  '/__editor/command',
  // Reporting a command listener is what makes a tab ELIGIBLE to receive the
  // owner's commands, so it belongs with its two siblings rather than with
  // ordinary presence: a remote page that could claim eligibility could become
  // the target of a `vgai eval` the local owner ran. (Undeclared until now —
  // the literal-route guard has been red on main since this route landed.)
  '/__editor/command-listener',
  '/__editor/command-received',
  // Acknowledging a console error CHANGES WHAT THE OWNER IS TOLD — it is the
  // one door that takes something out of the set every `vgai` command shouts
  // about. A guest who could reach it could silence the host's errors, so it
  // sits with the owner-only verbs and not with the reporting route above.
  '/__editor/console/ack',
  '/__editor/command-result',
  '/__editor/harness-chat',
  '/__editor/harness-chat/host-action',
  '/__editor/harness-chat/intent',
  '/__editor/harness-chat/caller',
  '/__editor/harness-terminal',
  '/__editor/harness-terminal/action',
  '/__editor/generations',
  '/__editor/project-tools',
  '/__editor/project-tools/run',
  '/__vgai',
  '/__vgai/screenshot',
  '/__vgai/state',
  '/__vgai/validation',
]);

/** Types a shared browser legitimately fetches from a project that neither the
 * `/@fs` module allowlist nor the writable project-resource allowlist names —
 * page shells, source maps, fonts, icons, PNG textures, authored markdown. */
const SHARE_VIEW_EXTRA_EXTENSIONS: ReadonlySet<string> = new Set([
  'html',
  'ico',
  'map',
  'md',
  'otf',
  'png',
  'ttf',
  'webmanifest',
  'woff',
  'woff2',
]);

/** YAML is an authored project resource the ASSET routes may carry, but it is
 * not fetched by anything in a running project — and it is the shape a
 * credential file most often takes (`secrets.yaml`, a service-account export).
 * A remote participant reads project-owned YAML through
 * `/__editor/project-resource`, where the project-root confinement applies. */
const SHARE_VIEW_DENIED_EXTENSIONS: ReadonlySet<string> = new Set(['yaml', 'yml']);

/**
 * Which raw (non-`/__`) project files a share VIEWER may fetch. This is an
 * ALLOWLIST on purpose: the reverse — "serve anything that is not `.git`,
 * `.vgai` or `.env*`" — hands the lowest remote role every `id_rsa`,
 * `credentials.pem` and `backup.sqlite` that happens to sit in the project.
 *
 * Extensionless paths are the SPA root and Vite's virtual-module namespace
 * (`/@vite/client`, `/@react-refresh`, `/@id/…`, `/@fs/…`). A bare
 * extensionless path elsewhere is a file, not a route, so it is denied.
 */
function isShareViewableFile(path: string): boolean {
  if (!isServableFsPath(path)) return false;
  if (path === '/' || path.startsWith('/@')) return true;
  const filename = path.split('/').pop() ?? '';
  if (!filename.includes('.')) return false;
  const extension = (filename.split('.').pop() ?? '').toLowerCase();
  if (SHARE_VIEW_DENIED_EXTENSIONS.has(extension)) return false;
  return (
    SERVABLE_FS_EXTENSIONS.has(extension) ||
    PROJECT_RESOURCE_EXTENSIONS.has(extension) ||
    SHARE_VIEW_EXTRA_EXTENSIONS.has(extension)
  );
}

export function requestedShareCapability(
  method: string | undefined,
  rawUrl: string | undefined,
): ShareCapability {
  return declaredShareCapability(method, rawUrl) ?? 'never-share';
}

/** Null means the route has no public-share declaration and is denied by the
 * caller. Returning `never-share` is an explicit private-route declaration. */
export function declaredShareCapability(
  method: string | undefined,
  rawUrl: string | undefined,
): ShareCapability | null {
  const path = decodedSharePath(rawUrl);
  if (!path) return 'never-share';
  const mutation = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
  if (path.startsWith('/@fs/')) {
    const extension = path.split('.').pop() ?? '';
    if (!isServableFsExtension(extension)) return 'never-share';
  }
  if (!path.startsWith('/__') && !isShareViewableFile(path)) return 'never-share';
  if (
    path.startsWith('/__editor/account') ||
    path.startsWith('/__editor/share-control') ||
    path.startsWith('/__editor/worktrees')
  )
    return 'never-share';
  if (NEVER_SHARE_PATHS.has(path)) return 'never-share';
  // Project Work is a read-only projection. Its POST action only resolves a
  // work item into prompt context; invoking a harness remains guarded by the
  // collaboration message/terminal capability path.
  if (path === '/__editor/project-work' || path.startsWith('/__editor/project-work/')) {
    return 'view';
  }
  if (path === '/__editor/collaboration/message') return 'comment';
  if (path.startsWith('/__editor/collaboration/messages/')) return 'comment';
  if (path === '/__editor/collaboration/role') return 'maintain';
  // Project Work joins durable tracker data to coding-session context and can
  // serve project-authored visualizer code. Keep the whole surface behind the
  // same highest remote role as agent chat rather than exposing it to viewers.
  if (path.startsWith('/__editor/project-work')) return 'terminal';
  // The project's configurations (ARCHITECTURE-CORE §The project model):
  // listing and reading a log is view-level; starting, stopping or building
  // one runs on the HOST machine and is the host's alone.
  if (path === '/__editor/configurations' || path.startsWith('/__editor/configurations/')) {
    return mutation ? 'never-share' : 'view';
  }
  if (path === '/__editor/gameplay-sessions' || path.startsWith('/__editor/gameplay-sessions/')) {
    // Gameplay Sessions expose the same complete Play log as `log-entries`,
    // plus an optional recording. They are tester evidence, not the public
    // read-only project projection, so keep both routes on one authority tier.
    return mutation ? 'never-share' : 'test';
  }
  if (TEST_PATHS.has(path)) return 'test';
  if (TERMINAL_PATHS.has(path) || path.startsWith('/__editor/generations/')) return 'terminal';
  if (path.startsWith('/__vgai/state/')) return 'terminal';
  // Synthetic Vite module routes (`/__vgai-react-world-runtime`,
  // `/__vgai-game-provider`, `/__vgai-story-runtime`, …). These are read-only
  // JS the editor imports to MOUNT THE GAME WORLD — without them a remote
  // guest's viewport fails to mount ("world failed to mount") and they see the
  // presence overlay over a blank scene. Served like any other module a viewer
  // already receives; a mutation to this synthetic namespace has no meaning and
  // stays refused. NOTE the HYPHEN: `/__vgai/` (slash) is the terminal/state
  // surface above and is deliberately untouched.
  if (path.startsWith('/__vgai-')) return mutation ? 'never-share' : 'view';
  if (path.startsWith('/__ui-source/')) {
    return !mutation && (path === '/__ui-source/read' || path === '/__ui-source/prepare')
      ? 'view'
      : 'edit';
  }
  if (mutation && VIEW_MUTATION_PATHS.has(path)) return 'view';
  if (mutation && EDIT_PATHS.has(path)) return 'edit';
  if (path === '/__editor/asset-library' || path.startsWith('/__editor/asset-library/')) {
    return mutation ? 'edit' : 'view';
  }
  if (VIEW_API_PATHS.has(path) || path === '/__editor/data-files') {
    return mutation ? 'never-share' : 'view';
  }
  // Reaching here means the path already passed the viewer file allowlist above.
  if (!path.startsWith('/__')) return mutation ? 'never-share' : 'view';
  return null;
}

function decodedSharePath(rawUrl: string | undefined): string | null {
  try {
    let path = new URL(rawUrl ?? '/', 'http://vgai.local').pathname;
    for (let pass = 0; pass < 4; pass += 1) {
      const decoded = decodeURIComponent(path);
      if (decoded === path) return path;
      path = decoded;
    }
    // A residual escape after four passes has no legitimate editor-module use
    // and could be decoded again by a downstream URL/filesystem layer.
    return path.includes('%') ? null : path;
  } catch {
    return null;
  }
}

function isRepositoryPresenceRead(method: string | undefined, rawUrl: string | undefined): boolean {
  return (
    (method === 'GET' || method === 'HEAD') &&
    decodedSharePath(rawUrl) === '/__editor/repository-presence'
  );
}

export function shareRoleAllows(
  role: ShareRole,
  method: string | undefined,
  rawUrl: string | undefined,
): boolean {
  const capability = requestedShareCapability(method, rawUrl);
  return capability !== 'never-share' && ROLE_CAPABILITIES[role].includes(capability);
}

function upstreamHeaders(
  headers: Record<string, string | string[] | undefined>,
  targetPort: number,
  share: AuthenticatedShare,
  method: string,
  rawUrl: string,
  claimSecret: string,
): Record<string, string | string[] | undefined> {
  const next = { ...headers };
  delete next['cookie'];
  for (const header of Object.keys(next)) {
    if (header.toLowerCase().startsWith('x-vgai-share-')) delete next[header];
  }
  next['host'] = `127.0.0.1:${targetPort}`;
  if (next['origin']) next['origin'] = `http://127.0.0.1:${targetPort}`;
  Object.assign(
    next,
    signedShareClaimHeaders(claimSecret, method, rawUrl, {
      participantId: share.participantId,
      invitationId: share.invitationId,
      credentialId: share.credentialId,
      role: share.role,
      account: share.account,
    }),
  );
  return next;
}

/** The invitee's first impression of VGAI, and it must survive the gateway's
 * `default-src 'none'` CSP: no external asset, no framework, one inline style
 * block shared by both pages. */
const SHARE_PAGE_STYLES = `:root{color-scheme:dark}
body{margin:0;display:grid;place-items:center;min-height:100vh;background:#111418;color:#c9d1d9;font:14px/1.5 system-ui,sans-serif}
main{max-width:32rem;padding:28px 32px;border:1px solid #232a31;border-radius:12px;background:#171b20;text-align:center}
.brand-mark{width:64px;height:64px;margin:0 auto 18px}.brand-mark svg{display:block;width:100%;height:100%}
h1{margin:0 0 8px;font-size:18px;font-weight:600;color:#e6edf3}
p{margin:6px 0}
.subject{color:#8b949e}
.role{color:#e6edf3}
.role b{color:#58a6ff}
.status{display:flex;align-items:center;justify-content:center;gap:8px;margin-top:16px}
.error{color:#f0883e}
.spinner{width:14px;height:14px;border:2px solid #30363d;border-top-color:#58a6ff;border-radius:50%;animation:spin 900ms linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
button{margin-top:14px;padding:7px 14px;border:1px solid #30363d;border-radius:7px;background:#21262d;color:#e6edf3;font:inherit;cursor:pointer}
button:hover{border-color:#58a6ff}
[hidden]{display:none}`;

/** These values are host/project supplied, so they are escaped, never trusted. */
function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  );
}

export interface ShareSessionDisplay {
  projectName?: string;
  hostName?: string;
}

function invitationSubject(display: ShareSessionDisplay | undefined): string {
  const project = display?.projectName ? escapeHtml(display.projectName) : '';
  const host = display?.hostName ? escapeHtml(display.hostName) : '';
  if (project && host) return `${host} shared the project <b>${project}</b> with you.`;
  if (project) return `Project <b>${project}</b>.`;
  if (host) return `Shared by ${host}.`;
  return '';
}

function sharePage(title: string, body: string, script: string): string {
  const fullTitle = `${title} — ${EDITOR_BRAND.name}`;
  const description = 'Open a shared Volter Editor session.';
  const favicon = `data:image/svg+xml,${encodeURIComponent(editorAppIconSvg())}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="${EDITOR_BRAND.themeColor}"><meta name="robots" content="noindex,nofollow"><meta name="description" content="${description}"><link rel="icon" type="image/svg+xml" href="${favicon}"><meta property="og:type" content="website"><meta property="og:site_name" content="${EDITOR_BRAND.name}"><meta property="og:title" content="${fullTitle}"><meta property="og:description" content="${description}"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="${fullTitle}"><meta name="twitter:description" content="${description}"><title>${fullTitle}</title><style>${SHARE_PAGE_STYLES}</style></head>
<body><main><div class="brand-mark">${editorAppIconSvg()}</div>${body}</main><script>${script}</script></body></html>`;
}

function landing(display?: ShareSessionDisplay): string {
  const subject = invitationSubject(display);
  return sharePage(
    'Join Volter Editor session',
    `<h1>You've been invited to a Volter Editor live session</h1>
${subject ? `<p class="subject">${subject}</p>` : ''}
<p class="role" id="role" hidden></p>
<p class="subject">Joining takes a Volter account — sign in, or create one right there (Google or email; it's free).</p>
<p class="status" id="status"><span class="spinner"></span><span id="statusText">Checking your invitation…</span></p>
<button id="retry" type="button" hidden>Retry</button>`,
    `const statusRow=document.getElementById('status');
const statusText=document.getElementById('statusText');
const spinner=statusRow.querySelector('.spinner');
const retry=document.getElementById('retry');
const roleLine=document.getElementById('role');
const token=new URLSearchParams(location.hash.slice(1)).get('token');
function fail(message){statusText.textContent=message;statusRow.classList.add('error');spinner.hidden=true;retry.hidden=!token}
function working(message){statusText.textContent=message;statusRow.classList.remove('error');spinner.hidden=false;retry.hidden=true}
function join(){
  if(!token){fail('This link is incomplete — ask for a fresh invitation link.');return}
  working('Checking your invitation…');
  fetch('${AUTH_PATH}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})}).then(async r=>{
    if(r.status===429){fail('Too many attempts — wait a minute.');return}
    if(!r.ok){fail('This invitation is invalid, expired, or was revoked — ask the host for a new link.');return}
    const body=await r.json();
    if(body.role){roleLine.hidden=false;roleLine.innerHTML='Your access: <b>'+String(body.role).replace(/[^a-z]/gi,'')+'</b>'}
    working('Taking you to Volter Editor — sign in or create your account…');
    history.replaceState(null,'',location.pathname);
    location.replace(body.authorizationUrl);
  }).catch(()=>{fail('This invitation is invalid, expired, or was revoked — ask the host for a new link.')});
}
retry.addEventListener('click',join);
join();`,
  );
}

function callbackLanding(): string {
  return sharePage(
    'Join Volter Editor session',
    `<h1>Finishing your Volter Editor sign-in</h1>
<p class="status" id="status"><span class="spinner"></span><span id="statusText">Confirming your account…</span></p>`,
    `const statusRow=document.getElementById('status');
const statusText=document.getElementById('statusText');
const spinner=statusRow.querySelector('.spinner');
function fail(message){statusText.textContent=message;statusRow.classList.add('error');spinner.hidden=true}
const params=new URLSearchParams(location.hash.slice(1));
const grant=params.get('grant');
const invitation=params.get('invitation');
history.replaceState(null,'',location.pathname);
if(!grant){fail('This link is incomplete — ask the host for a new invitation link.')}
else fetch('${COMPLETE_PATH}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(invitation?{grant,invitationId:invitation}:{grant})}).then(async r=>{
  if(r.status===429){fail('Too many attempts — wait a minute.');return}
  if(!r.ok){fail('This invitation is invalid, expired, or was revoked — ask the host for a new link.');return}
  const body=await r.json();
  try{localStorage.setItem('vgai.collaboration.participant.v1',body.participantId);localStorage.setItem('vgai.collaboration.remote-share.v1','1')}
  catch{fail('This browser blocks site storage; the shared editor cannot keep your identity. Enable storage/cookies for this site and reopen the link.');return}
  statusText.textContent='Loading the editor — the first load can take a while.';
  setTimeout(()=>location.replace('/'),600);
}).catch(()=>{fail('This invitation is invalid, expired, or was revoked — ask the host for a new link.')});`,
  );
}

async function readJsonBody(
  request: import('node:http').IncomingMessage,
  maximumBytes: number,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > maximumBytes) throw new Error('Authentication body is too large.');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function stringField(body: Record<string, unknown>, key: string, maximumLength: number): string {
  const value = body[key];
  return typeof value === 'string' && value.length <= maximumLength ? value : '';
}

function html(response: import('node:http').ServerResponse, content: string): void {
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy':
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
  });
  response.end(content);
}

function participantFromEventsUrl(rawUrl: string | undefined): string | null {
  const url = new URL(rawUrl ?? '/', 'http://vgai.local');
  if (url.pathname !== '/__editor/events') return null;
  const participantId = url.searchParams.get('participantId')?.trim();
  return participantId && participantId.length <= 200 ? participantId : null;
}

function forwardEventStreamToWebSocket(
  client: WebSocket,
  upstream: import('node:http').ClientRequest,
): void {
  upstream.once('response', (response) => {
    if (response.statusCode !== 200) {
      client.close(1011, 'Editor event stream refused the connection.');
      response.resume();
      return;
    }
    let buffered = '';
    response.setEncoding('utf8');
    response.on('data', (chunk: string) => {
      buffered += chunk;
      const frames = buffered.split(/\r?\n\r?\n/);
      buffered = frames.pop() ?? '';
      for (const frame of frames) {
        let event = 'message';
        let id = '';
        const data: string[] = [];
        for (const line of frame.split(/\r?\n/)) {
          if (line.startsWith('event:')) event = line.slice(6).trimStart();
          else if (line.startsWith('id:')) id = line.slice(3).trimStart();
          else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
        }
        if (data.length === 0 || client.readyState !== WebSocket.OPEN) continue;
        client.send(JSON.stringify({ event, data: data.join('\n'), ...(id ? { id } : {}) }));
      }
    });
    response.once('end', () => {
      if (client.readyState === WebSocket.OPEN) client.close(1012, 'Editor event stream closed.');
    });
    response.once('error', () => client.terminate());
    client.once('close', () => response.destroy());
  });
  upstream.once('error', () => client.terminate());
  upstream.end();
}

/** Every gate reads ONE normalization. Classifying capability from the decoded
 * path while gating CSRF/rate/joined from the raw one let `/__editor%2Fsave-file`
 * be routed as an edit and skip the mutation-only gates entirely. */
function isEditorMutation(method: string | undefined, rawUrl: string | undefined): boolean {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;
  const path = decodedSharePath(rawUrl);
  return path === null || path.startsWith('/__editor/') || path.startsWith('/__ui-source/');
}

function sameOrigin(request: import('node:http').IncomingMessage): boolean {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function isViteClientRequest(method: string | undefined, rawUrl: string | undefined): boolean {
  return (
    method === 'GET' && new URL(rawUrl ?? '/', 'http://vgai.local').pathname === '/@vite/client'
  );
}

function isViteHmrUpgrade(request: import('node:http').IncomingMessage): boolean {
  const value = request.headers['sec-websocket-protocol'];
  const protocols = Array.isArray(value) ? value : [value ?? ''];
  return protocols.flatMap((item) => item.split(',')).some((item) => item.trim() === 'vite-hmr');
}

/** The local editor uses its paired private HMR port. A public tunnel has one
 * HTTPS authority, so only its copy of Vite's client points the socket back at
 * standard WSS; the gateway then relays the `vite-hmr` upgrade to that private
 * port. Local tabs continue to receive Vite's unmodified client. */
export function publicViteClient(source: string): string {
  const portLine = /^const hmrPort = .*;$/m;
  const directLine = /^const directSocketHost = .*;$/m;
  if (!portLine.test(source) || !directLine.test(source)) {
    throw new Error('The Vite HMR client shape is not supported by the share gateway.');
  }
  return source
    .replace(portLine, 'const hmrPort = 443;')
    .replace(directLine, 'const directSocketHost = socketHost;');
}

export async function createSessionShareGateway(options: {
  targetPort: number;
  hmrPort?: number;
  claimSecret: string;
  now?: () => number;
  /** Named on the invitee's join card so the link is not anonymous. */
  display?: ShareSessionDisplay;
}): Promise<SessionShareGateway> {
  const now = options.now ?? Date.now;
  const hmrPort = options.hmrPort ?? editorHmrPort(options.targetPort);
  const invitations = new Map<string, GatewayInvitation>();
  const credentials = new Map<string, AuthenticatedShare>();
  /** jti → the instant the record may be forgotten. A grant lives ≤2 minutes,
   * so five minutes of retention outlives every grant it must refuse twice. */
  const usedGrantIds = new Map<string, number>();
  const GRANT_REPLAY_RETENTION_MS = 5 * 60_000;
  const assignedRoles = new Map<string, ShareRole>();
  const kickedParticipants = new Set<string>();
  const personInvitationAccounts = new Map<string, string>();
  const auditEvents: GatewayAuditEvent[] = [];
  /** Keyed partly by remote address, so an unauthenticated caller decides how
   * many entries exist. Both this and {@link usedGrantIds} sweep their expired
   * records once past a ceiling rather than growing until the session closes. */
  const rateWindows = new Map<string, { startedAt: number; count: number; windowMs: number }>();
  const MAP_SWEEP_THRESHOLD = 1_024;
  const audit = (event: Omit<GatewayAuditEvent, 'at'>): void => {
    auditEvents.push({ at: new Date(now()).toISOString(), ...event });
    if (auditEvents.length > 500) auditEvents.splice(0, auditEvents.length - 500);
  };
  const rateAllowed = (key: string, limit: number, windowMs: number): boolean => {
    if (rateWindows.size > MAP_SWEEP_THRESHOLD) {
      for (const [candidate, window] of rateWindows) {
        if (now() - window.startedAt >= window.windowMs) rateWindows.delete(candidate);
      }
    }
    const current = rateWindows.get(key);
    if (!current || now() - current.startedAt >= windowMs) {
      rateWindows.set(key, { startedAt: now(), count: 1, windowMs });
      return true;
    }
    current.count += 1;
    return current.count <= limit;
  };
  const rememberGrantId = (jti: string): void => {
    if (usedGrantIds.size > MAP_SWEEP_THRESHOLD) {
      for (const [candidate, expiresAt] of usedGrantIds) {
        if (expiresAt <= now()) usedGrantIds.delete(candidate);
      }
    }
    usedGrantIds.set(jti, now() + GRANT_REPLAY_RETENTION_MS);
  };

  /**
   * Credential → the terminators for every connection that credential is
   * currently holding open: bridged event WebSockets, proxied upgrade socket
   * pairs, and the long-lived SSE responses that reach the HTTP branch.
   *
   * Deleting a credential only stops the NEXT request. A kicked participant's
   * already-open event stream keeps delivering the whole session until they
   * choose to reconnect, so removal must reach the sockets too. A role change
   * deliberately does not: it applies on the participant's next request.
   */
  const liveConnections = new Map<string, Set<() => void>>();
  const trackConnection = (credentialId: string, terminate: () => void): (() => void) => {
    const held = liveConnections.get(credentialId) ?? new Set<() => void>();
    liveConnections.set(credentialId, held);
    held.add(terminate);
    return () => {
      held.delete(terminate);
      if (held.size === 0) liveConnections.delete(credentialId);
    };
  };
  const severConnections = (credentialIds: Iterable<string>): void => {
    for (const credentialId of credentialIds) {
      const held = liveConnections.get(credentialId);
      if (!held) continue;
      liveConnections.delete(credentialId);
      for (const terminate of held) terminate();
    }
  };

  const invitationForToken = (token: string): GatewayInvitation | null => {
    for (const invitation of invitations.values()) {
      if (invitation.expiresAt > now() && sameSecret(token, invitation.token)) return invitation;
    }
    return null;
  };
  const activeShare = (request: import('node:http').IncomingMessage): AuthenticatedShare | null => {
    const credential = cookieValue(request.headers.cookie, COOKIE);
    const share = credential ? credentials.get(credential) : undefined;
    if (!share || kickedParticipants.has(share.participantId)) return null;
    const invitation = invitations.get(share.invitationId);
    return invitation && invitation.expiresAt > now() ? share : null;
  };
  const eventWebSockets = new WebSocketServer({ noServer: true });

  const server: Server = createServer(async (request, response) => {
    if ((request.method === 'GET' || request.method === 'HEAD') && request.url === HEALTH_PATH) {
      response.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-VGAI-Share-Gateway': 'ready',
      });
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify({ ready: true }));
      return;
    }
    if (request.url === AUTH_PATH && request.method === 'POST') {
      if (!sameOrigin(request)) {
        response.writeHead(403, { 'Cache-Control': 'no-store' }).end('Invalid request origin.');
        return;
      }
      // Throttle BEFORE the token is read: a limiter that only runs after a
      // token validates leaves guessing unbounded, and every guess costs one
      // timing-safe compare per live invitation.
      if (!rateAllowed(`auth:${request.socket.remoteAddress ?? 'unknown'}`, 20, 60_000)) {
        response.writeHead(429).end('Too many invitation authentication attempts.');
        return;
      }
      try {
        const invitation = invitationForToken(
          stringField(await readJsonBody(request, 4_096), 'token', 4_096),
        );
        if (!invitation) throw new Error('Invalid or expired share token.');
        audit({ type: 'auth-started', invitationId: invitation.id });
        response.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        // The role is per-invitation, so the landing card can only name it from
        // here — it has nothing but a token.
        response.end(
          JSON.stringify({ authorizationUrl: await invitation.authorize(), role: invitation.role }),
        );
      } catch {
        audit({ type: 'auth-failed' });
        response.writeHead(403).end('Invalid authentication request.');
      }
      return;
    }
    if (request.url === COMPLETE_PATH && request.method === 'POST') {
      if (!sameOrigin(request)) {
        response.writeHead(403, { 'Cache-Control': 'no-store' }).end('Invalid request origin.');
        return;
      }
      try {
        if (!rateAllowed(`complete:${request.socket.remoteAddress ?? 'unknown'}`, 40, 60_000)) {
          response.writeHead(429).end('Too many authorization attempts.');
          return;
        }
        const body = await readJsonBody(request, 32_768);
        const grant = stringField(body, 'grant', 32_768);
        // The callback page names the invitation its grant was issued for, so
        // the common case is ONE worker round-trip instead of one per live
        // invitation. A wrong or stale hint simply fails redemption (the worker
        // binds every grant to an invitation), so the loop stays the fallback.
        const hinted = invitations.get(stringField(body, 'invitationId', 200));
        const candidates =
          hinted && hinted.expiresAt > now() ? [hinted] : [...invitations.values()];
        let matched: { invitation: GatewayInvitation; redeemed: ShareGrantRedemption } | null =
          null;
        let serviceUnavailable = false;
        for (const invitation of candidates) {
          if (invitation.expiresAt <= now()) continue;
          try {
            matched = { invitation, redeemed: await invitation.redeem(grant) };
            break;
          } catch (error) {
            // A grant is bound to one invitation; try the remaining live
            // records. An account service that never answered is a different
            // story and must not read as a rejected grant.
            if (error instanceof ShareGrantServiceError) serviceUnavailable = true;
          }
        }
        if (!matched && serviceUnavailable) {
          audit({ type: 'auth-failed' });
          response.writeHead(502, { 'Cache-Control': 'no-store' });
          response.end('Volter account service unavailable.');
          return;
        }
        if (!matched || usedGrantIds.has(matched.redeemed.jti)) throw new Error('Invalid grant.');
        const { invitation, redeemed } = matched;
        const normalizedEmail = redeemed.participant.email.trim().toLowerCase();
        if (
          (invitation.recipientAccountId &&
            invitation.recipientAccountId !== redeemed.participant.id) ||
          (invitation.recipientEmail &&
            invitation.recipientEmail.trim().toLowerCase() !== normalizedEmail)
        )
          throw new Error('This invitation belongs to another account.');
        const organization = invitation.recipientOrganizationId
          ? redeemed.participant.organizations?.find(
              (candidate) => candidate.id === invitation.recipientOrganizationId,
            )
          : undefined;
        if (invitation.recipientOrganizationId && !organization) {
          throw new Error('This invitation belongs to another organization.');
        }
        if (
          invitation.recipientOrganizationDomain &&
          !organization?.domains.some(
            (domain) =>
              domain.verified &&
              domain.name.toLowerCase() === invitation.recipientOrganizationDomain?.toLowerCase(),
          )
        ) {
          throw new Error('This invitation requires a Clerk-verified organization domain.');
        }
        const claimedPerson = personInvitationAccounts.get(invitation.id);
        if (
          invitation.usePolicy === 'person' &&
          claimedPerson &&
          claimedPerson !== redeemed.participant.id
        )
          throw new Error('This one-person invitation has already been claimed.');
        const participantId = participantIdFor(redeemed.participant.id);
        if (kickedParticipants.has(participantId)) throw new Error('This participant was removed.');
        const invitationCredentials = [...credentials.values()].filter(
          (share) => share.invitationId === invitation.id,
        );
        if (invitationCredentials.length >= 16)
          throw new Error('Invitation credential limit reached.');
        const accounts = new Set([...credentials.values()].map((share) => share.account.id));
        if (!accounts.has(redeemed.participant.id) && accounts.size >= 32) {
          throw new Error('Participant limit reached.');
        }
        // An account's stored assignment above THIS invitation's ceiling used
        // to refuse the redemption outright, so a participant demoted on an
        // earlier, wider invitation could not join through a narrower new one
        // at all — the invitation names a ceiling, and a ceiling clamps. The
        // assignment itself is left alone: it is the account's standing role,
        // and a later invitation that admits it should still restore it.
        const assigned = assignedRoles.get(redeemed.participant.id);
        const role =
          assigned && roleAllowsRole(invitation.role, assigned) ? assigned : invitation.role;
        if (assigned && assigned !== role) {
          audit({
            type: 'role-changed',
            invitationId: invitation.id,
            participantId,
            accountId: redeemed.participant.id,
            role,
          });
        }
        rememberGrantId(redeemed.jti);
        if (invitation.usePolicy === 'person' && !claimedPerson) {
          personInvitationAccounts.set(invitation.id, redeemed.participant.id);
        }
        const credential = randomBytes(24).toString('base64url');
        credentials.set(credential, {
          credentialId: createHash('sha256').update(credential).digest('base64url'),
          participantId,
          account: redeemed.participant,
          invitationId: invitation.id,
          role,
          roleCeiling: invitation.role,
          joined: false,
        });
        audit({
          type: 'invite-redeemed',
          invitationId: invitation.id,
          participantId,
          accountId: redeemed.participant.id,
        });
        response.setHeader(
          'Set-Cookie',
          `${COOKIE}=${credential}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.max(1, Math.ceil((invitation.expiresAt - now()) / 1_000))}`,
        );
        response.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        response.end(JSON.stringify({ participantId, participant: redeemed.participant, role }));
      } catch {
        audit({ type: 'auth-failed' });
        response.writeHead(403).end('Invalid or expired Volter account authorization.');
      }
      return;
    }
    const share = activeShare(request);
    if (!share) {
      if (request.method === 'GET' && request.url === CALLBACK_PATH)
        html(response, callbackLanding());
      else if (request.method === 'GET' && (request.url === '/' || request.url === '/index.html'))
        html(response, landing(options.display));
      else response.writeHead(401).end('Share authorization required.');
      return;
    }
    const participantId = participantFromEventsUrl(request.url);
    if (new URL(request.url ?? '/', 'http://vgai.local').pathname === '/__editor/events') {
      if (participantId && share.participantId !== participantId) {
        response.writeHead(403).end('This share login is already bound to another participant.');
        return;
      }
      share.joined = true;
    }
    if (!shareRoleAllows(share.role, request.method, request.url)) {
      audit({
        type: 'capability-denied',
        invitationId: share.invitationId,
        participantId: share.participantId,
        accountId: share.account.id,
        capability: requestedShareCapability(request.method, request.url),
      });
      response
        .writeHead(403)
        .end(`The ${share.role} share role cannot access this editor capability.`);
      return;
    }
    if (
      isRepositoryPresenceRead(request.method, request.url) &&
      !rateAllowed(`repository-presence:${share.credentialId}`, 60, 60_000)
    ) {
      response.writeHead(429, { 'Retry-After': '60' }).end('Too many repository presence reads.');
      return;
    }
    if (isEditorMutation(request.method, request.url) && !sameOrigin(request)) {
      response.writeHead(403).end('The share request origin does not match this tunnel.');
      return;
    }
    if (
      isEditorMutation(request.method, request.url) &&
      !rateAllowed(`mutation:${share.credentialId}`, 240, 60_000)
    ) {
      response.writeHead(429).end('Too many shared editor mutations.');
      return;
    }
    if (!share.joined && isEditorMutation(request.method, request.url)) {
      response.writeHead(409).end('Open the shared editor before mutating its session.');
      return;
    }
    if (requestedShareCapability(request.method, request.url) === 'terminal') {
      audit({
        type: 'terminal-invoked',
        invitationId: share.invitationId,
        participantId: share.participantId,
        accountId: share.account.id,
        capability: 'terminal',
      });
    }
    const viteClient = isViteClientRequest(request.method, request.url);
    const headers = upstreamHeaders(
      request.headers,
      options.targetPort,
      share,
      request.method ?? 'GET',
      request.url ?? '/',
      options.claimSecret,
    );
    if (viteClient) delete headers['accept-encoding'];
    const upstream = httpRequest(
      {
        hostname: '127.0.0.1',
        port: options.targetPort,
        path: request.url,
        method: request.method,
        headers,
      },
      (upstreamResponse) => {
        if (!viteClient || upstreamResponse.statusCode !== 200) {
          response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
          upstreamResponse.pipe(response);
          return;
        }
        const chunks: Buffer[] = [];
        upstreamResponse.on('data', (chunk: Buffer | string) => chunks.push(Buffer.from(chunk)));
        upstreamResponse.once('end', () => {
          try {
            const body = Buffer.from(publicViteClient(Buffer.concat(chunks).toString('utf8')));
            const responseHeaders = { ...upstreamResponse.headers };
            delete responseHeaders['content-length'];
            delete responseHeaders['content-encoding'];
            delete responseHeaders['etag'];
            responseHeaders['content-length'] = String(body.length);
            response.writeHead(200, responseHeaders).end(body);
          } catch (error) {
            response
              .writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
              .end(error instanceof Error ? error.message : 'Vite HMR relay failed.');
          }
        });
      },
    );
    upstream.on('error', () => response.writeHead(502).end('Editor session is unavailable.'));
    if (decodedSharePath(request.url) === '/__editor/events') {
      const release = trackConnection(share.credentialId, () => {
        upstream.destroy();
        response.destroy();
      });
      response.once('close', release);
    }
    request.pipe(upstream);
  });

  server.on('upgrade', (request, socket, head) => {
    const share = activeShare(request);
    if (
      !share ||
      !shareRoleAllows(share.role, request.method, request.url) ||
      !sameOrigin(request)
    ) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    const eventUrl = new URL(request.url ?? '/', 'http://vgai.local');
    if (eventUrl.pathname === '/__editor/events') {
      const participantId = participantFromEventsUrl(request.url);
      if (participantId && share.participantId !== participantId) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        return;
      }
      share.joined = true;
      eventWebSockets.handleUpgrade(request, socket, head, (client) => {
        const release = trackConnection(share.credentialId, () => client.terminate());
        client.once('close', release);
        const headers = upstreamHeaders(
          request.headers,
          options.targetPort,
          share,
          'GET',
          request.url ?? '/',
          options.claimSecret,
        );
        for (const header of Object.keys(headers)) {
          if (
            header.toLowerCase() === 'connection' ||
            header.toLowerCase() === 'upgrade' ||
            header.toLowerCase().startsWith('sec-websocket-')
          ) {
            delete headers[header];
          }
        }
        headers['accept'] = 'text/event-stream';
        const lastEventId = eventUrl.searchParams.get('lastEventId');
        if (lastEventId) headers['last-event-id'] = lastEventId;
        forwardEventStreamToWebSocket(
          client,
          httpRequest({
            hostname: '127.0.0.1',
            port: options.targetPort,
            path: request.url,
            method: 'GET',
            headers,
          }),
        );
      });
      return;
    }
    const targetPort = isViteHmrUpgrade(request) ? hmrPort : options.targetPort;
    const upstream = httpRequest({
      hostname: '127.0.0.1',
      port: targetPort,
      path: request.url,
      method: request.method,
      headers: upstreamHeaders(
        request.headers,
        targetPort,
        share,
        request.method ?? 'GET',
        request.url ?? '/',
        options.claimSecret,
      ),
    });
    upstream.on('upgrade', (upstreamResponse, upstreamSocket, upstreamHead) => {
      const release = trackConnection(share.credentialId, () => {
        upstreamSocket.destroy();
        socket.destroy();
      });
      socket.once('close', release);
      socket.write(
        `HTTP/1.1 ${upstreamResponse.statusCode ?? 101} ${upstreamResponse.statusMessage ?? 'Switching Protocols'}\r\n${Object.entries(
          upstreamResponse.headers,
        )
          .flatMap(([key, value]) =>
            Array.isArray(value)
              ? value.map((entry) => `${key}: ${entry}\r\n`)
              : `${key}: ${value}\r\n`,
          )
          .join('')}\r\n`,
      );
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) upstreamSocket.write(head);
      upstreamSocket.pipe(socket).pipe(upstreamSocket);
    });
    upstream.on('error', () => socket.destroy());
    upstream.end();
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Share gateway did not bind.');

  return {
    port: address.port,
    addInvitation(invitation) {
      if (invitations.has(invitation.id)) throw new Error(`Duplicate invitation: ${invitation.id}`);
      invitations.set(invitation.id, invitation);
    },
    revokeInvitation(invitationId) {
      invitations.delete(invitationId);
      personInvitationAccounts.delete(invitationId);
      const severed: string[] = [];
      for (const [credential, share] of credentials) {
        if (share.invitationId !== invitationId) continue;
        credentials.delete(credential);
        severed.push(share.credentialId);
      }
      severConnections(severed);
      audit({ type: 'invitation-revoked', invitationId });
      return severed.length;
    },
    kickParticipant(participantId) {
      kickedParticipants.add(participantId);
      const severed: string[] = [];
      for (const [credential, share] of credentials) {
        if (share.participantId !== participantId) continue;
        credentials.delete(credential);
        severed.push(share.credentialId);
      }
      severConnections(severed);
      audit({ type: 'participant-kicked', participantId });
      return severed.length;
    },
    setParticipantRole(participantId, role) {
      const matches = [...credentials.values()].filter(
        (share) => share.participantId === participantId,
      );
      if (matches.length === 0) throw new Error(`Unknown shared participant: ${participantId}`);
      if (matches.some((share) => !roleAllowsRole(share.roleCeiling, role))) {
        throw new Error('The requested role exceeds this participant invitation ceiling.');
      }
      assignedRoles.set(matches[0]!.account.id, role);
      for (const share of matches) share.role = role;
      audit({
        type: 'role-changed',
        participantId,
        accountId: matches[0]!.account.id,
        role,
      });
    },
    hasParticipant(participantId) {
      for (const share of credentials.values()) {
        if (share.participantId === participantId) return true;
      }
      return false;
    },
    participants() {
      const byParticipant = new Map<string, GatewayParticipant>();
      for (const share of credentials.values()) {
        const prior = byParticipant.get(share.participantId);
        if (prior) {
          prior.credentials += 1;
          prior.joined ||= share.joined;
        } else {
          byParticipant.set(share.participantId, {
            participantId: share.participantId,
            account: { ...share.account },
            invitationId: share.invitationId,
            role: share.role,
            roleCeiling: share.roleCeiling,
            credentials: 1,
            joined: share.joined,
          });
        }
      }
      return [...byParticipant.values()];
    },
    audit() {
      return auditEvents.map((event) => ({ ...event }));
    },
    close: () =>
      new Promise<void>((resolveClose) => {
        credentials.clear();
        invitations.clear();
        personInvitationAccounts.clear();
        rateWindows.clear();
        usedGrantIds.clear();
        severConnections([...liveConnections.keys()]);
        for (const client of eventWebSockets.clients) client.terminate();
        server.closeAllConnections();
        server.close(() => resolveClose());
      }),
  };
}
