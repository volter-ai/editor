/**
 * `/__editor/account/**` — the GLOBAL VGAI account: sign-in, provider
 * credentials, plan/credits/checkout, and the sealed development-twin portal.
 *
 * Never project state: every route here answers the same way whether or not a
 * project is open, which is why this family is registered ahead of the
 * project-serving middleware and is the only one that needs nothing from the
 * session beyond `EditorAccountService`.
 */

import express, { type Request, type Response } from 'express';
import { ProviderCredentialIdSchema } from '@volter/editor-sdk/account';
import { renderEditorBrandPage } from '../editor-brand-html';
import type { EditorServerRouter } from '../editor-server';
import type { RouteContext } from './context';

export function registerAccountRoutes(router: EditorServerRouter, ctx: RouteContext): void {
  const { account } = ctx;

  // ---- Global VGAI account (never project state) ----
  router.get('/__editor/account', async (_req: Request, res: Response) => {
    try {
      res.json(await account.snapshot());
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  router.put(
    '/__editor/account/provider-credentials/:provider',
    async (req: Request, res: Response) => {
      try {
        const parsed = ProviderCredentialIdSchema.safeParse(req.params['provider']);
        const key = (req.body as { key?: unknown }).key;
        if (!parsed.success || typeof key !== 'string') {
          res.status(400).json({ error: 'A supported provider and API key are required.' });
          return;
        }
        res.json(await account.setProviderCredential(parsed.data, key));
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
      }
    },
  );
  router.delete(
    '/__editor/account/provider-credentials/:provider',
    async (req: Request, res: Response) => {
      try {
        const parsed = ProviderCredentialIdSchema.safeParse(req.params['provider']);
        if (!parsed.success) {
          res.status(400).json({ error: 'A supported provider is required.' });
          return;
        }
        res.json(await account.deleteProviderCredential(parsed.data));
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
      }
    },
  );
  router.post(
    '/__editor/account/provider-credentials/:provider/test',
    async (req: Request, res: Response) => {
      try {
        const parsed = ProviderCredentialIdSchema.safeParse(req.params['provider']);
        if (!parsed.success) {
          res.status(400).json({ error: 'A supported provider is required.' });
          return;
        }
        res.json(await account.testProviderCredential(parsed.data));
      } catch (error) {
        res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
      }
    },
  );
  router.post('/__editor/account/mock-session', async (req: Request, res: Response) => {
    try {
      const body = req.body as { email?: unknown };
      if (typeof body.email !== 'string') {
        res.status(400).json({ error: 'email is required' });
        return;
      }
      res.status(201).json(await account.signInMock(body.email));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  // Managed sign-in against the deployed twin (placeholder IdP). Active only when the
  // editor is launched with VGAI_TWIN_URL set; otherwise signInTwin throws a loud 400.
  router.post('/__editor/account/twin-session', async (req: Request, res: Response) => {
    try {
      const body = req.body as { email?: unknown };
      if (typeof body.email !== 'string') {
        res.status(400).json({ error: 'email is required' });
        return;
      }
      res.status(201).json(await account.signInTwin(body.email));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  router.delete('/__editor/account/session', async (_req: Request, res: Response) => {
    res.json(await account.signOut());
  });
  router.put('/__editor/account/spend-policy', async (req: Request, res: Response) => {
    try {
      res.json(await account.updateSpendPolicy(req.body));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  router.put('/__editor/account/execution-route', async (req: Request, res: Response) => {
    try {
      const route = (req.body as { route?: unknown }).route;
      if (route !== 'auto' && route !== 'mock' && route !== 'managed' && route !== 'byok') {
        res.status(400).json({ error: 'route must be auto, mock, managed, or byok' });
        return;
      }
      res.json(await account.setPreferredRoute(route));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  router.put('/__editor/account/coding-inference', async (req: Request, res: Response) => {
    try {
      res.json(await account.setCodingInference(req.body));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  router.post('/__editor/account/coding-inference/quote', async (req: Request, res: Response) => {
    try {
      res.json(await account.quoteCodingInference(req.body));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  router.post('/__editor/account/checkout', async (req: Request, res: Response) => {
    try {
      const idempotencyKey = req.get('Idempotency-Key');
      if (!idempotencyKey) {
        res.status(400).json({ error: 'Idempotency-Key is required.' });
        return;
      }
      res.json(
        await account.checkout(String((req.body as { plan?: unknown }).plan ?? ''), idempotencyKey),
      );
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  router.put('/__editor/account/plan', async (req: Request, res: Response) => {
    try {
      const action = (req.body as { action?: unknown }).action;
      if (action !== 'cancel' && action !== 'resume') {
        res.status(400).json({ error: 'action must be cancel or resume' });
        return;
      }
      res.json(await account.updatePlan(action));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  router.post('/__editor/account/credits', async (req: Request, res: Response) => {
    try {
      const idempotencyKey = req.get('Idempotency-Key');
      if (!idempotencyKey) {
        res.status(400).json({ error: 'Idempotency-Key is required.' });
        return;
      }
      res.json(
        await account.purchaseCredits(
          String((req.body as { packId?: unknown }).packId ?? ''),
          idempotencyKey,
        ),
      );
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  router.get('/__editor/account/usage', async (_req: Request, res: Response) => {
    try {
      res.json({ entries: await account.accountUsage() });
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  router.get('/__editor/account/catalog', async (_req: Request, res: Response) => {
    try {
      res.json(await account.accountCatalog());
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  router.post('/__editor/account/billing-portal', async (_req: Request, res: Response) => {
    try {
      res.json(await account.billingPortal());
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  router.post('/__editor/account/checkout/confirm', async (req: Request, res: Response) => {
    try {
      res.json(
        await account.confirmCheckout(
          String((req.body as { checkoutId?: unknown }).checkoutId ?? ''),
        ),
      );
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  router.get('/__editor/account/twin-portal', async (_req: Request, res: Response) => {
    const snapshot = await account.snapshot();
    if (!snapshot.authenticated || snapshot.accountEnvironment !== 'development-twin') {
      res.status(404).send('Not found.');
      return;
    }
    const escapeHtml = (value: string) =>
      value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    res
      .status(200)
      .type('html')
      .set('Cache-Control', 'no-store')
      .set(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      )
      .send(
        `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Polar Twin portal</title><style>body{margin:0;background:#0d1017;color:#eef2ff;font:15px system-ui;display:grid;place-items:center;min-height:100vh}.card{width:min(520px,calc(100vw - 48px));padding:28px;border:1px solid #30394a;border-radius:14px;background:#151a24}h1{margin:0 0 18px;font-size:21px}.row{display:flex;justify-content:space-between;padding:12px 0;border-top:1px solid #293142}.muted{color:#97a1b4}.badge{display:inline-block;padding:4px 8px;border-radius:999px;background:#26334a;color:#9dc1ff;font-size:12px}a{display:inline-block;margin-top:20px;color:#a9c2ff}</style></head><body><main class="card"><span class="badge">SEALED POLAR TWIN</span><h1>Billing and invoices</h1><div class="row"><span class="muted">Account</span><strong>${escapeHtml(snapshot.user.email)}</strong></div><div class="row"><span class="muted">Plan</span><strong>${escapeHtml(snapshot.plan.name)}</strong></div><div class="row"><span class="muted">Included credits</span><strong>${snapshot.credits.included.toLocaleString()}</strong></div><div class="row"><span class="muted">Purchased credits</span><strong>${snapshot.credits.purchased.toLocaleString()}</strong></div><p class="muted">This local mirror contains fake Twin state only. Subscription changes remain in Volter Editor's Account document so they exercise the same account API as production.</p><a href="/">Return to Volter Editor</a></main></body></html>`,
      );
  });
  router.get('/__editor/account/twin-checkout', async (req: Request, res: Response) => {
    const checkoutId = String(req.query['checkout_id'] ?? '');
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(checkoutId)) {
      res.status(400).send('Invalid Twin checkout id.');
      return;
    }
    res
      .status(200)
      .type('html')
      .set('Cache-Control', 'no-store')
      .set(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      )
      .send(
        `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Polar Twin checkout</title><style>body{margin:0;background:#0d1017;color:#eef2ff;font:15px system-ui;display:grid;place-items:center;min-height:100vh}.card{width:min(440px,calc(100vw - 48px));padding:28px;border:1px solid #30394a;border-radius:14px;background:#151a24;box-shadow:0 20px 70px #0008}h1{font-size:21px;margin:0 0 8px}p{color:#aeb7c8;line-height:1.5}.badge{display:inline-block;padding:4px 8px;border-radius:999px;background:#26334a;color:#9dc1ff;font-size:12px}button,a{display:inline-block;margin-top:14px;padding:10px 14px;border-radius:8px;border:0;background:#6d8dff;color:white;font-weight:650;text-decoration:none;cursor:pointer}small{display:block;margin-top:18px;color:#778196}</style></head><body><main class="card"><span class="badge">SEALED DEVELOPMENT TWIN</span><h1>Confirm fake Polar checkout</h1><p>This exercises Volter Editor's real checkout intent, fulfillment, and credit ledger without contacting a payment network.</p><form method="post" action="/__editor/account/twin-checkout"><input type="hidden" name="checkout_id" value="${checkoutId}"><button type="submit">Confirm fake payment</button></form><small>No card or live provider credential is used.</small></main></body></html>`,
      );
  });
  router.post(
    '/__editor/account/twin-checkout',
    express.urlencoded({ extended: false, limit: '4kb' }),
    async (req: Request, res: Response) => {
      try {
        await account.confirmTwinCheckout(
          String((req.body as { checkout_id?: unknown }).checkout_id ?? ''),
        );
        res.redirect(303, '/');
      } catch (error) {
        res.status(400).send(error instanceof Error ? error.message : String(error));
      }
    },
  );
  router.post('/__editor/account/alerts/read', async (_req: Request, res: Response) => {
    try {
      res.json(await account.markAlertsRead());
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  router.post('/__editor/account/browser-authorization', async (req: Request, res: Response) => {
    try {
      const origin = req.headers.origin;
      if (typeof origin !== 'string') {
        res.status(400).json({ error: 'Browser sign-in requires the editor Origin header.' });
        return;
      }
      res.status(201).json(await account.beginBrowserAuthorization(origin));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  router.get('/__editor/account/authorization-methods', async (_req: Request, res: Response) => {
    try {
      res.json(await account.authorizationMethods());
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  router.get(
    '/__editor/account/browser-authorization/callback',
    async (req: Request, res: Response) => {
      const state = typeof req.query['state'] === 'string' ? req.query['state'] : '';
      const code = typeof req.query['code'] === 'string' ? req.query['code'] : '';
      const providerError = typeof req.query['error'] === 'string' ? req.query['error'] : undefined;
      try {
        if (state && providerError) {
          account.failBrowserAuthorization(state, `Account authorization failed: ${providerError}`);
          throw new Error('The account provider rejected authorization.');
        }
        if (!state || !code) throw new Error('The account callback is missing code or state.');
        await account.completeBrowserAuthorization(state, code);
        res
          .status(200)
          .type('html')
          .send(
            renderEditorBrandPage({
              subject: 'Signed in',
              description: 'Volter account authorization is complete.',
              contentHtml:
                '<h1>Signed in to Volter Editor</h1><p>You can close this tab and return to the editor.</p>',
            }),
          );
      } catch {
        res
          .status(400)
          .type('html')
          .send(
            renderEditorBrandPage({
              subject: 'Sign-in failed',
              description: 'Volter account authorization did not complete.',
              contentHtml: '<h1>Sign-in failed</h1><p>Return to the editor and try again.</p>',
            }),
          );
      }
    },
  );
  router.get('/__editor/account/browser-authorization/:id', async (req: Request, res: Response) => {
    try {
      const parameter = req.params['id'];
      const id = Array.isArray(parameter) ? (parameter[0] ?? '') : (parameter ?? '');
      const result = await account.pollBrowserAuthorization(id);
      res.status(result.pending ? 202 : 200).json(result);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  router.post('/__editor/account/device-authorization', async (_req: Request, res: Response) => {
    try {
      res.status(201).json(await account.beginDeviceAuthorization());
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  router.get(
    '/__editor/account/device-authorization/:code',
    async (req: Request, res: Response) => {
      try {
        const parameter = req.params['code'];
        const code = Array.isArray(parameter) ? (parameter[0] ?? '') : (parameter ?? '');
        const result = await account.pollDeviceAuthorization(code);
        res.status(result.pending ? 202 : 200).json(result);
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
      }
    },
  );
}
