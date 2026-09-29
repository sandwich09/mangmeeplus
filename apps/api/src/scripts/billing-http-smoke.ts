import { BILLING_TEST_ADDRESS, applySyntheticCustomerFields } from './billing-profile-fixture';
import { checkEmailAccess } from './email-access-smoke';
import { checkBillingAdjustments } from './billing-adjustments-smoke';
import { checkBillingSupportOutcomes } from './billing-support-outcomes-smoke';
import { checkLineBinding } from './line-binding-smoke';
import { checkLineRuntimeCredentials } from './line-runtime-credentials-smoke';
import { checkBillingProviderEvents } from './billing-provider-events-smoke';
import { checkSignupClaimHistory } from './signup-claim-history-smoke';
import { checkSignupJourney } from './signup-journey-smoke';
import { checkBillingProviderScans } from './billing-provider-scans-smoke';
import { checkEmailPasswordReset } from './email-password-reset-smoke';
import { checkEmailVerification } from './email-verification-smoke';
import { checkEmailMonitoring } from './email-monitoring-smoke';
import { checkBillingApplyRetry } from './billing-apply-retry-smoke';
import { checkBillingNoSetup } from './billing-no-setup-smoke';
import { RedisRateLimitService } from '../common/security/redis-rate-limit.service';
import { BillingOperationsService } from '../modules/billing/application/billing-operations.service';
import { BillingService } from '../modules/billing/application/billing.service';
/** Full compiled AppModule + HTTP + PostgreSQL. Only external provider transports are simulated. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { json } from 'express';
import cookieParser from 'cookie-parser';
import { BILLING_ACTIONS, BILLING_DRAFT_POLICY, STRIPE_API_VERSION } from '@watchdog-bms/contracts';
import type { Prisma } from '../generated/prisma/client';
import { DEFAULT_JWT_AUDIENCE, DEFAULT_JWT_ISSUER } from '@watchdog-bms/config';
import { PROVIDER_EVENTS_PATH, providerEventsJson } from '../common/middleware/provider-events-body.middleware';
import { TrimStringsPipe } from '../common/pipes/trim-strings.pipe';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../common/pipes/validation-pipe.options';

import { checkBillingAdmin } from './billing-admin-smoke';
import { checkBillingConfiguration } from './billing-configuration-smoke';
import { checkBillingCollection } from './billing-collection-smoke';
import { checkBillingPlanChange } from './billing-plan-change-smoke';
import { checkBillingUpgrade } from './billing-upgrade-smoke';
import { checkBillingRestart } from './billing-restart-smoke';
import { checkBillingFinancial } from './billing-financial-smoke';
import { billingNotificationFixture, checkBillingNotifications } from './billing-notification-smoke';
import { repeatProviderFixture, checkRepeatPurchase } from './billing-repeat-smoke';
import { checkReceiptQuotaRuntime } from './receipt-quota-runtime-smoke';

type ProviderObject = Record<string, any>;
async function main() {
  const trialCarryoverOnly = process.env.BILLING_TRIAL_CARRYOVER_ONLY === '1';
  const databaseUrl = process.env.BILLING_TEST_DATABASE_URL;
  assert.ok(databaseUrl, 'BILLING_TEST_DATABASE_URL is required');
  const db = new URL(databaseUrl);
  assert.ok(['localhost', '127.0.0.1'].includes(db.hostname));
  assert.ok(['/mangmee_billing_20260912', '/watchdog_postmark_ci', '/email_otp_test', '/email_access_test'].includes(db.pathname));
  const run = randomUUID().replaceAll('-', ''), accountId = `acct_${run}`;
  const companyIds = [`billing-http-${run}`, `billing-http-other-${run}`], userIds = [`owner-${run}`, `staff-${run}`];
  const secret = randomUUID(), webhookSecret = `whsec_${run}`, workerToken = randomUUID();
  Object.assign(process.env, { APP_ENV: 'local', DEPLOY_ENVIRONMENT: 'local', NODE_ENV: 'test', SERVICE_NAME: 'billing-http-smoke',
    S3_BUCKET: 'synthetic-billing-smoke', DATABASE_URL: databaseUrl, EMAIL_PROVIDER: 'postmark', BILLING_MODE: 'test', RECEIPT_QUOTA_ENFORCED: 'false',
    // The real billing limiters stay on, capped at a 10 s window so rate-limited retries wait seconds, not minutes.
    // Settlement's forced-429 case needs ≥5 s of closure after priming; set 60 to reproduce production timing.
    BILLING_RATE_LIMIT_WINDOW_SECONDS: process.env.BILLING_RATE_LIMIT_WINDOW_SECONDS ?? '10',
    ...(process.env.BILLING_SIGNUP_JOURNEY_ONLY==='1'?{EXTERNAL_SIGNUP_ENABLED:'true',AI_GATEWAY_INTERNAL_URL:'https://synthetic-ai.example.test'}:{}),
    EMAIL_OTP_HMAC_KEY: randomBytes(32).toString('hex'), EMAIL_OTP_HMAC_KEY_VERSION: 'test-v1',
    POSTMARK_SERVER_TOKEN: 'POSTMARK_API_TEST', POSTMARK_SERVER_ID: '9191301', POSTMARK_MESSAGE_STREAM: 'outbound', POSTMARK_FROM_ADDRESS: 'system@example.test',
    POSTMARK_WEBHOOK_USERNAME: 'synthetic-billing', POSTMARK_WEBHOOK_PASSWORD: randomUUID(),
    LINE_MESSAGING_CHANNEL_SECRET: 's'.repeat(32), LINE_MESSAGING_CHANNEL_ID: `channel-${run}`, LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: `synthetic-${run}`,
    ...(process.env.BILLING_LINE_BINDING_ONLY==='1'?{LINE_LOGIN_CHANNEL_ID:`login-${run}`,LINE_LIFF_ID:'1234567890-Synthetic'}:{}),
    CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    STRIPE_ACCOUNT_ID: accountId, STRIPE_SECRET_KEY: `sk_test_${run}`, STRIPE_WEBHOOK_SECRET: webhookSecret,
    WATCHDOG_JWT_SECRET_ARN: secret, WATCHDOG_JWT_ISSUER: DEFAULT_JWT_ISSUER, WATCHDOG_JWT_AUDIENCE: DEFAULT_JWT_AUDIENCE,
    WORKER_INTERNAL_TOKEN: workerToken, WEB_BASE_URL: 'https://app.example.test', REQUEST_LOG_ENABLED: 'false', LOG_LEVEL: 'error', AWS_EC2_METADATA_DISABLED: 'true' });
  const provider = { customers: [] as ProviderObject[], sessions: [] as ProviderObject[], subscriptions: [] as ProviderObject[], invoices: [] as ProviderObject[], lines: [] as ProviderObject[], payments: [] as ProviderObject[], intents: [] as ProviderObject[], charges: [] as ProviderObject[] };
  const repeatFixture = repeatProviderFixture(run, provider);
  const notificationFixture = billingNotificationFixture();
  let providerReadHook: ((path:string)=>Promise<void>) | undefined;
  let providerCallHook: ((path:string,method:string)=>Promise<void>) | undefined;
  let checkoutCalls = 0, badDocument = false, loseSubscriptionCheckout = false;
  const subscriptionCheckouts = new Map<string, ProviderObject>();
  const nativeFetch = globalThis.fetch;
  let journeyTransport:((url:URL,init?:RequestInit)=>Promise<Response|undefined>|Response|undefined)|undefined;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.hostname === '127.0.0.1') return nativeFetch(input, init);
    const journeyResponse=await journeyTransport?.(url,init);if(journeyResponse!==undefined)return journeyResponse;
    const noticeResponse = notificationFixture.request(url, init);
    if (noticeResponse !== undefined) return noticeResponse;
    assert.equal(url.origin, 'https://api.stripe.com', 'Unexpected external destination');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('stripe-version'), STRIPE_API_VERSION);
    const form = new URLSearchParams(String(init?.body ?? '')), path = url.pathname.slice(3);
    await providerCallHook?.(path,init?.method??'GET');
    if(providerReadHook && (!init?.method || init.method==='GET'))await providerReadHook(path);
    const list = (data: ProviderObject[]) => ({ object: 'list', data, has_more: false });
    const response = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
    const repeatResponse = repeatFixture.request(path, init?.method ?? 'GET', form, headers.get('idempotency-key'));
    if (repeatResponse !== undefined) return response(repeatResponse);
    if (path === '/invoices/create_preview') {
      assert.equal(form.has('customer'), false); assert.equal(form.has('subscription'), false); assert.equal(form.get('customer_details[address][country]'), 'TH');
      const amount = Number(form.get('invoice_items[0][amount]'));
      return response({ id: `in_preview${run}`, object: 'invoice', livemode: false, currency: 'thb', parent: null, total: amount, amount_due: amount, amount_paid: 0, starting_balance: 0, ending_balance: 0, amount_shipping: 0, total_taxes: [],
        lines: { has_more: false, data: [{ amount, currency: 'thb', quantity: 1, discountable: false, parent: { type: 'invoice_item_details', subscription_item_details: null } }] } });
    }
    if (path === '/account') return response({ id: accountId, settings: { invoices: { default_account_tax_ids: ['txi_Synthetic'] } } });
    if (path.startsWith('/prices/')) return response({ id: path.split('/').at(-1), object: 'price', livemode: false, active: true, type: 'recurring',
      product: path.includes('Starter') ? 'prod_Starter' : path.includes('Basic') ? 'prod_Basic' : 'prod_Pro', currency: 'thb', unit_amount: path.includes('Zero') ? 0 : (path.includes('Starter') ? 24900 : path.includes('Basic') ? 49900 : 99900) * (path.includes('Month') ? 1 : 10), recurring: { interval: path.includes('Month') ? 'month' : 'year', interval_count: 1, usage_type: 'licensed' }, billing_scheme: 'per_unit',
      tax_behavior: path.includes('Exclusive') ? 'exclusive' : 'inclusive' });
    if (path.startsWith('/billing_portal/configurations/')) return response({ id: path.split('/').at(-1), object: 'billing_portal.configuration', livemode: false, active: true,
      features: { payment_method_update: { enabled: true }, subscription_update: { enabled: false }, subscription_cancel: { enabled: false } } });
    if (path.startsWith('/tax_rates/')) return response({ id: path.split('/').at(-1), active: true, country: 'TH', percentage: 7, inclusive: !path.includes('Exclusive') });
    if (path.startsWith('/tax_ids/')) return response({ id: path.split('/').at(-1), object: 'tax_id', type: 'th_vat', value: '0105567123456', owner: { type: 'self' }, customer: null });
    if (path === '/customers' && init?.method === 'POST') {
      const customer = { object: 'customer', id: `cus_${run}`, livemode: false, email: form.get('email'), metadata: { billingAccountId: form.get('metadata[billingAccountId]') } };
      applySyntheticCustomerFields(customer, form);
      provider.customers.push(customer); return response(customer);
    }
    if (path === '/checkout/sessions' && init?.method === 'POST') {
      const key = headers.get('idempotency-key')!;
      if (subscriptionCheckouts.has(key)) return response(subscriptionCheckouts.get(key));
      checkoutCalls++;
      assert.equal(form.get('mode'), 'subscription'); assert.equal(form.get('line_items[0][quantity]'), '1');
      assert.equal(form.get('subscription_data[billing_mode][type]'), 'classic');
      assert.ok(['price_ProYear', 'price_StarterYear'].includes(form.get('line_items[0][price]') ?? ''));
      assert.equal(form.get('payment_method_types[0]'), 'card');
      // R-A3: a complete profile keeps the synced address; Checkout's cancel returns with a marker.
      assert.equal(form.get('customer_update[address]'), 'never'); assert.match(form.get('cancel_url') ?? '', /&checkout=canceled$/);
      const session = { object: 'checkout.session', id: `cs_${run}${checkoutCalls}`, livemode: false, mode: 'subscription', status: 'open', customer: form.get('customer'), subscription: null,
        client_reference_id: form.get('client_reference_id'),
        metadata: { billingAccountId: form.get('metadata[billingAccountId]'), billingAttemptId: form.get('metadata[billingAttemptId]') }, url: `https://checkout.stripe.com/c/pay/${run}` };
      provider.sessions.push(session); subscriptionCheckouts.set(key, session);
      if (loseSubscriptionCheckout) { loseSubscriptionCheckout = false; throw new Error('Synthetic lost Checkout response after commit'); }
      return response(session);
    }
    const updatingCustomer = provider.customers.find(c => path === `/customers/${c.id}`);
    if (updatingCustomer && init?.method === 'POST') { applySyntheticCustomerFields(updatingCustomer, form); return response(updatingCustomer); }
    if (path === '/customers') return response(list(provider.customers));
    if (path === '/checkout/sessions') return response(list(provider.sessions.filter(s => s.customer === url.searchParams.get('customer'))));
    if (path === '/subscriptions') return response(list(provider.subscriptions.filter(s => s.customer === url.searchParams.get('customer'))));
    if (path === '/invoices') return response(list(provider.invoices.filter(i => url.searchParams.has('customer') ? i.customer === url.searchParams.get('customer') : i.parent?.subscription_details?.subscription === url.searchParams.get('subscription'))));
    const lineInvoice = /^\/invoices\/([^/]+)\/lines$/.exec(path)?.[1];
    if (lineInvoice) return response(list(provider.lines.filter(l => l.invoice === lineInvoice)));
    if (path === '/invoice_payments') return response(list(provider.payments.filter(p => p.invoice === url.searchParams.get('invoice'))));
    const pools: Record<string, ProviderObject[]> = { customers: provider.customers, 'checkout/sessions': provider.sessions, subscriptions: provider.subscriptions, invoices: provider.invoices, payment_intents: provider.intents, charges: provider.charges };
    for (const [prefix, values] of Object.entries(pools)) {
      const value = values.find(v => path === `/${prefix}/${v.id}`);
      if (value) return response(badDocument && prefix === 'charges' ? { ...value, receipt_url: 'https://attacker.example/receipt' } : value);
    }
    throw new Error(`Unhandled synthetic Stripe route ${init?.method} ${path}`);
  };
  const { AppModule } = await import('../app.module');
  const { PrismaService } = await import('../common/database/prisma.service');
  const { LegalAcceptanceService, currentLegalRelease } = await import('../modules/auth/application/legal-acceptance.service');
  const { PlatformAccessService } = await import('../modules/auth/application/platform-access.service');
  const { BillingReconcilerService } = await import('../modules/billing/application/billing-reconciler.service');
  const { admitCompanyOcr } = await import('../modules/line-ai/application/company-ocr-governance');
  const app = await NestFactory.create(AppModule, { abortOnError: false, bodyParser: false, logger: process.env.BILLING_SIGNUP_JOURNEY_ONLY==='1'?['error']:false });
  app.use(PROVIDER_EVENTS_PATH, providerEventsJson); app.use(json({ limit: '5mb', verify: (req, _res, buf) => { if(buf.length) (req as typeof req & {rawBody?:Buffer}).rawBody=Buffer.from(buf); } })); app.use(cookieParser());
  app.setGlobalPrefix('v1', { exclude: [{ path: 'local-storage/(.*)', method: RequestMethod.ALL }] });
  app.useGlobalPipes(new TrimStringsPipe(), new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS));
  const prisma = app.get(PrismaService), client = prisma.client, cases: string[] = [];
  let roleId = '', memberId = '';
  let browser: Awaited<ReturnType<typeof import('./billing-browser-smoke').startBillingBrowser>> | undefined;
  try {
    await app.listen(0, '127.0.0.1'); const origin = await app.getUrl();
    await client.company.createMany({ data: companyIds.map(id => ({ id, name: 'Synthetic billing company', addressJson: BILLING_TEST_ADDRESS })) });
    await client.user.createMany({ data: userIds.map(id => ({ id, displayName: 'Synthetic billing user', email: `${id}@example.test`, emailVerifiedAt: new Date() })) });
    await client.externalIdentity.create({ data: { userId: userIds[0]!, provider: 'LINE', providerChannelId: `channel-${run}`, providerUserId: `U${run}` } });
    const permission = await client.permission.upsert({ where: { key: 'account.session.read' }, create: { key: 'account.session.read', description: 'Read own session' }, update: {} });
    const role = await client.role.create({ data: { companyId: companyIds[0]!, scopeKey: companyIds[0]!, key: 'OWNER', name: 'Synthetic owner', permissions: { create: { permissionId: permission.id } } } }); roleId = role.id;
    for(const key of ['company.plan.manage','notification.read','notification.delivery.retry','company.setup.manage','company.setup.read','company.legal_identity.read','company.legal_identity.manage','company.vat_registration.read','company.vat_registration.manage']){
      const noticePermission = await client.permission.upsert({ where: { key }, create: { key, description: key }, update: {} });
      await client.rolePermission.create({ data: { roleId, permissionId: noticePermission.id } });
    }
    for (const companyId of companyIds) {
      const membership = await client.companyMembership.create({ data: { companyId, userId: userIds[0]!, roles: { create: { roleId } } } });
      if (companyId === companyIds[0]) memberId = membership.id;
      await client.companyPlanTerm.create({ data: { companyId, tierKey: 'FREE_TRIAL_15', branchLimit: 1, employeeLimit: 2, monthlySlipLimit: 15,
        termStartAt: new Date(Date.now() - (trialCarryoverOnly ? 1 : 31) * 86400000), termEndsAt: new Date(Date.now() + (trialCarryoverOnly ? 7 * 86400000 : -60000)) } });
    }
    if (trialCarryoverOnly) for (let i = 0; i < 6; i++) assert.equal((await admitCompanyOcr(prisma, { companyId: companyIds[0]!, sourceRoute: i % 2 ? 'receipt-ocr-line' : 'receipt-ocr-web', requestId: `trial-before-${i}`, enforceReceiptQuota: true })).allowed, true);
    const release = currentLegalRelease('th');
    await client.$transaction(tx => app.get(LegalAcceptanceService).recordFromEvidence(tx, { userId: userIds[0]!, companyId: companyIds[0]!, membershipId: memberId,
      requestId: run, evidence: { ...release, locale: 'th', legalAcceptedAt: new Date() } }));
    const sid = randomUUID(); await client.authSession.create({ data: { userId: userIds[0]!, tokenId: sid, expiresAt: new Date(Date.now() + 3600000) } });
    const token = new JwtService().sign({ sub: userIds[0], sid }, { secret, algorithm: 'HS256', issuer: DEFAULT_JWT_ISSUER, audience: DEFAULT_JWT_AUDIENCE, expiresIn: 3600 });
    const policy = { ...BILLING_DRAFT_POLICY, priceIds: { 'PRO_999:year': 'price_ProYear' }, zeroPriceIds: { 'PRO_999:year': 'price_ZeroProYear' }, portalConfigurationId: 'bpc_Synthetic' };
    const revision = await client.billingPolicyRevision.create({ data: { stripeAccountId: accountId, livemode: false, version: 1, state: 'ACTIVE', policyJson: policy, createdByUserId: userIds[0]! } });
    await client.billingSettings.create({ data: { id: `${accountId}:test`, stripeAccountId: accountId, livemode: false, policyRevisionId: revision.id, gatesJson: Object.fromEntries(BILLING_ACTIONS.map(action => [action, action!=='refunds'])) } });
    const base = `/v1/companies/${companyIds[0]}/billing`;
    const request = async (path: string, method = 'GET', body?: unknown, extra: Record<string, string> = {}) => {
      const response = await fetch(`${origin}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const value = await response.json(); return { status: response.status, body: value };
    };
    const drainNotifications = () => request('/v1/internal/billing/notifications/drain', 'POST', {}, { 'x-worker-token': workerToken });
    const checkProviderEvents=()=>checkBillingProviderEvents({request,prisma,userId:userIds[0]!,membershipId:memberId,stripeAccountId:accountId,
      reconciler:app.get(BillingReconcilerService),operations:app.get(BillingOperationsService),provider,browser,interceptRead:hook=>{providerReadHook=hook;}});
    const checkClaimHistory=()=>checkSignupClaimHistory({request,prisma,userId:userIds[0]!,membershipId:memberId,browser});
    const checkMailMonitoring=()=>checkEmailMonitoring({app,prisma,request,userId:userIds[0]!,membershipId:memberId,browser,transport:hook=>{journeyTransport=hook;}});
    const checkProviderScans=async()=>{
      // Keep the actual operator limit; this independent scenario follows other commands in the combined suite.
      const budget=await app.get(RedisRateLimitService).inspect('billing-operator-commands',userIds[0]!,30,60);
      if(budget.count)await new Promise(resolve=>setTimeout(resolve,Math.min(60,budget.retryAfterSeconds+1)*1000));
      return checkBillingProviderScans({prisma,stripe:app.get(BillingService).stripe,request,userId:userIds[0]!,membershipId:memberId,stripeAccountId:accountId,browser,
        second:{userId:userIds[1]!,signToken:sid=>new JwtService().sign({sub:userIds[1],sid},{secret,algorithm:'HS256',issuer:DEFAULT_JWT_ISSUER,audience:DEFAULT_JWT_AUDIENCE,expiresIn:3600}),
          recordLegal:membershipId=>client.$transaction(tx=>app.get(LegalAcceptanceService).recordFromEvidence(tx,{userId:userIds[1]!,companyId:companyIds[0]!,membershipId,
            requestId:run,evidence:{...release,locale:'th',legalAcceptedAt:new Date()}})).then(()=>{})},
        drainOperations:()=>request('/v1/internal/billing/drain','POST',{}, {'x-worker-token':workerToken}),
        drain:()=>request('/v1/internal/billing/provider-scans/drain','POST',{}, {'x-worker-token':workerToken}),transport:hook=>{journeyTransport=hook;}});
    };
    if(process.env.BILLING_NO_SETUP_ONLY==='1'){
      cases.push(...await checkBillingNoSetup({app,request,prisma,companyId:companyIds[0]!,userId:userIds[0]!,stripeAccountId:accountId,
        drain:()=>request('/v1/internal/billing/drain','POST',{}, {'x-worker-token':workerToken}),drainNotifications,
        reconcile:id=>app.get(BillingReconcilerService).reconcileAccount(id),transport:hook=>{journeyTransport=hook;},
        event:async(type,objectId,eventId)=>{
          const payload=JSON.stringify({id:eventId,object:'event',api_version:STRIPE_API_VERSION,livemode:false,type,data:{object:{id:objectId}}});
          const timestamp=Math.floor(Date.now()/1000),hash=createHmac('sha256',webhookSecret).update(`${timestamp}.${payload}`).digest('hex');
          return (await fetch(`${origin}/v1/public/stripe-events`,{method:'POST',headers:{'content-type':'application/json','stripe-signature':`t=${timestamp},v1=${hash}`},body:payload})).status;
        }}));
      console.log(JSON.stringify({layer:'real-Nest-HTTP-PostgreSQL-provider-simulation',passed:cases,simulatedProviders:['Stripe','Postmark'],realProviderPayment:false}));return;
    }
    if(process.env.BILLING_EMAIL_ACCESS_ONLY==='1'){
      const {startBillingBrowser}=await import('./billing-browser-smoke');browser=await startBillingBrowser({apiOrigin:origin,token,companyId:companyIds[0]!});
      cases.push(...await checkEmailAccess({app,prisma,membershipId:memberId,request,browser,transport:hook=>{journeyTransport=hook;}}));
      console.log(JSON.stringify({layer:'real-Nest-HTTP-PostgreSQL-Next-Chromium',passed:cases,browserE2E:true,simulatedProviders:['Postmark'],realProviderDelivery:false}));return;
    }
    if(process.env.BILLING_SUPPORT_OUTCOMES_ONLY==='1'){
      const {startBillingBrowser}=await import('./billing-browser-smoke');browser=await startBillingBrowser({apiOrigin:origin,token,companyId:companyIds[0]!});
      cases.push(...await checkBillingSupportOutcomes({prisma,userId:userIds[0]!,companyId:companyIds[0]!,membershipId:memberId,stripeAccountId:accountId,request,browser}));
      console.log(JSON.stringify({layer:'real-Nest-HTTP-PostgreSQL-Next-Chromium',passed:cases,browserE2E:true,simulatedProviders:[],realProviderDelivery:false}));return;
    }
    if(process.env.BILLING_LINE_BINDING_ONLY==='1'){
      const {startBillingBrowser}=await import('./billing-browser-smoke');browser=await startBillingBrowser({apiOrigin:origin,token,companyId:companyIds[0]!});
      cases.push(...await checkLineBinding({app,prisma,origin,userId:userIds[0]!,companyId:companyIds[0]!,membershipId:memberId,request,browser,transport:hook=>{journeyTransport=hook;}}));
      console.log(JSON.stringify({layer:'real-Nest-HTTP-PostgreSQL-Next-Chromium-LIFF',passed:cases,browserE2E:true,simulatedProviders:['LINE SDK/verification/push'],realProviderDelivery:false}));return;
    }
    if(process.env.BILLING_LINE_CREDENTIALS_ONLY==='1'){
      const {startBillingBrowser}=await import('./billing-browser-smoke');browser=await startBillingBrowser({apiOrigin:origin,token,companyId:companyIds[0]!});
      cases.push(...await checkLineRuntimeCredentials({app,prisma,origin,userId:userIds[0]!,companyId:companyIds[0]!,membershipId:memberId,request,browser,transport:hook=>{journeyTransport=hook;}}));
      console.log(JSON.stringify({layer:'real-Nest-HTTP-PostgreSQL-Next-Chromium',passed:cases,browserE2E:true,simulatedProviders:['LINE'],realProviderDelivery:false}));return;
    }
    if(process.env.BILLING_EMAIL_RESET_ONLY==='1'||process.env.BILLING_EMAIL_VERIFICATION_ONLY==='1'){
      const {startBillingBrowser}=await import('./billing-browser-smoke');browser=await startBillingBrowser({apiOrigin:origin,token,companyId:companyIds[0]!});
      cases.push(...await (process.env.BILLING_EMAIL_RESET_ONLY==='1'?checkEmailPasswordReset:checkEmailVerification)({app,prisma,userId:userIds[0]!,membershipId:memberId,request,browser,transport:hook=>{journeyTransport=hook;}}));
      console.log(JSON.stringify({layer:'real-Nest-HTTP-PostgreSQL-Next-Chromium',passed:cases,browserE2E:true,simulatedProviders:['Postmark','LINE','Stripe'],realProviderDelivery:false}));return;
    }
    if(process.env.BILLING_PROVIDER_SCANS_ONLY==='1'||process.env.BILLING_SCAN_SCHEDULE_ONLY==='1'||process.env.BILLING_INVOICE_SCANS_ONLY==='1'||process.env.BILLING_INVOICE_IMPORT_ONLY==='1'){
      if(process.env.BILLING_BROWSER_E2E==='1'){
        const {startBillingBrowser}=await import('./billing-browser-smoke');browser=await startBillingBrowser({apiOrigin:origin,token,companyId:companyIds[0]!});
      }
      cases.push(...await checkProviderScans());console.log(JSON.stringify({layer:'real-Nest-HTTP-PostgreSQL-provider-simulation',passed:cases,browserE2E:Boolean(browser),simulatedProviders:['Stripe'],realProviderPayment:false}));return;
    }
    if(process.env.BILLING_SIGNUP_JOURNEY_ONLY==='1'){
      const {startBillingBrowser}=await import('./billing-browser-smoke');browser=await startBillingBrowser({apiOrigin:origin,token,companyId:companyIds[0]!});
      cases.push(...await checkSignupJourney({app,prisma,origin,userId:userIds[0]!,membershipId:memberId,request,browser,
        drain:()=>request('/v1/internal/signup-claim-email/drain','POST',{}, {'x-worker-token':workerToken}),transport:hook=>{journeyTransport=hook;}}));
      console.log(JSON.stringify({layer:'real-Nest-HTTP-PostgreSQL-Next-Chromium',passed:cases,simulatedProviders:['DNS','Postmark','AI Gateway (503)'],objectStorage:'real-local-bytes',realProviderDelivery:false,browserE2E:true}));return;
    }
    if (process.env.BILLING_CLAIM_HISTORY_ONLY === '1' || process.env.BILLING_EMAIL_MONITORING_ONLY === '1') {
      if(process.env.BILLING_BROWSER_E2E==='1'){
        const {startBillingBrowser}=await import('./billing-browser-smoke');browser=await startBillingBrowser({apiOrigin:origin,token,companyId:companyIds[0]!});
      }
      cases.push(...await (process.env.BILLING_EMAIL_MONITORING_ONLY === '1' ? checkMailMonitoring() : checkClaimHistory()));
      console.log(JSON.stringify({layer:'real-Nest-HTTP-PostgreSQL',passed:cases,browserE2E:Boolean(browser),nativeProviderCalls:false}));return;
    }
    if (process.env.BILLING_PROVIDER_EVENTS_ONLY === '1') {
      if(process.env.BILLING_BROWSER_E2E==='1'){
        const {startBillingBrowser}=await import('./billing-browser-smoke');browser=await startBillingBrowser({apiOrigin:origin,token,companyId:companyIds[0]!});
      }
      cases.push(...await checkProviderEvents());
      console.log(JSON.stringify({layer:'real-Nest-HTTP-PostgreSQL-provider-simulation',passed:cases,browserE2E:Boolean(browser),simulatedProviders:['Stripe'],realProviderPayment:false}));return;
    }
    if (process.env.BILLING_RECEIPT_QUOTA_ONLY === '1') {
      if (process.env.BILLING_BROWSER_E2E === '1') {
        const { startBillingBrowser } = await import('./billing-browser-smoke');
        browser = await startBillingBrowser({ apiOrigin: origin, token, companyId: companyIds[0]! });
      }
      cases.push(...await checkReceiptQuotaRuntime({ request, prisma, userId: userIds[0]!, membershipId: memberId, browser }));
      console.log(JSON.stringify({ layer: 'real-Nest-HTTP-PostgreSQL-provider-simulation', passed: cases, browserE2E: Boolean(browser), providerCalls: false }));
      return;
    }
    if (process.env.BILLING_CONFIG_ONLY !== '1') {
    const companyId = companyIds[0]!, profilePath = `/v1/companies/${companyId}/identity`;
    await client.company.update({ where: { id: companyId }, data: { addressJson: {}, registeredName: null } });
    // R-A1: an incomplete profile quotes; the confirm page reads missingFields, Checkout collects the address.
    const missingProfile = await request(`${base}/quote`, 'POST', { offerKey: 'PRO_999', interval: 'year', billingEmail: 'ignored@example.test' });
    assert.equal(missingProfile.status, 200, JSON.stringify(missingProfile.body));
    assert.deepEqual(missingProfile.body.billingProfile.missingFields, ['line1', 'subdistrict', 'district', 'province', 'postalCode']);
    assert.equal(missingProfile.body.billingEmail, `${userIds[0]}@example.test`, 'the quote pins the verified owner email and ignores the body');
    assert.equal(provider.customers.length, 0); assert.equal(checkoutCalls, 0);
    await client.company.update({ where: { id: companyId }, data: { addressJson: BILLING_TEST_ADDRESS, registeredName: ' ' } });
    const fallbackQuote = await request(`${base}/quote`, 'POST', { offerKey: 'PRO_999', interval: 'year', billingEmail: 'ignored@example.test' });
    assert.equal(fallbackQuote.status, 200, JSON.stringify(fallbackQuote));
    assert.equal(fallbackQuote.body.billingProfile.name, 'Synthetic billing company');
    const staleBody = { quoteId: fallbackQuote.body.quoteId, consentRevision: fallbackQuote.body.consentRevision, accepted: true, channel: 'web' };
    await client.company.update({ where: { id: companyId }, data: { registeredName: 'บริษัท ทดสอบเอกสาร จำกัด' } });
    assert.equal((await request(`${base}/checkout`, 'POST', staleBody, { 'idempotency-key': randomUUID() })).body.code, 'BILLING_QUOTE_STALE');
    await client.company.update({ where: { id: companyId }, data: { addressJson: { ...BILLING_TEST_ADDRESS, postalCode: '1011a' } } });
    assert.equal((await request(`${base}/checkout`, 'POST', staleBody, { 'idempotency-key': randomUUID() })).body.code, 'BILLING_QUOTE_STALE');
    assert.equal(await client.billingAttempt.count({ where: { initiatingUserId: userIds[0] } }), 0);
    await client.company.update({ where: { id: companyId }, data: { addressJson: BILLING_TEST_ADDRESS, status: 'DISABLED' } });
    await client.companyPlanTerm.update({ where: { companyId }, data: { termDisabledAt: new Date() } });
    const repairProfile = await request(profilePath); assert.equal(repairProfile.status, 200, JSON.stringify(repairProfile));
    const repaired = await request(profilePath, 'PATCH', { expectedLegalIdentityVersion: repairProfile.body.control.legalIdentityVersion,
      changeKind: 'INITIAL_CAPTURE', addressJson: { ...BILLING_TEST_ADDRESS, line1: '99 ถนนทดสอบแก้ไข' } });
    assert.equal(repaired.status, 200, JSON.stringify(repaired));
    await client.role.update({ where: { id: roleId }, data: { key: 'STAFF' } });
    assert.equal((await request(profilePath)).status, 403);
    await client.role.update({ where: { id: roleId }, data: { key: 'OWNER' } });
    await client.company.update({ where: { id: companyId }, data: { addressJson: BILLING_TEST_ADDRESS, status: 'ACTIVE' } });
    await client.companyPlanTerm.update({ where: { companyId }, data: { termDisabledAt: null } });
    cases.push('company-profile-optional-before-quote-or-checkout-registered-name-priority-fallback-stale-quote-expired-owner-repair');
    assert.equal((await fetch(`${origin}${base}`)).status, 401);
    assert.equal((await request(base, 'GET', undefined, { 'x-company-id': companyIds[1]! })).status, 403);
    const before = await request(base); assert.equal(before.status, 200); assert.equal(before.body.accessState, trialCarryoverOnly ? 'ACTIVE' : 'EXPIRED');
    cases.push('real-session-tenant-and-expired-owner-recovery');
    const requestPath=`/v1/companies/${companyIds[0]}/package-change-requests`;
    const originalRequest=await request(requestPath,'POST',{requestedTierKey:'PRO_999',note:'ขอซื้อ Pro เพื่อเพิ่มใบเสร็จให้ร้าน'});
    assert.equal(originalRequest.status,201,JSON.stringify(originalRequest));assert.equal(originalRequest.body.status,'OPEN');
    assert.equal((await request(requestPath,'POST',{requestedTierKey:'PRO_999'})).body.id,originalRequest.body.id);
    const foreignRequest=await client.packageChangeRequest.create({data:{companyId:companyIds[1]!,requestedByUserId:userIds[0]!,requestedTierKey:'PRO_999'}});
    // Phase 6: ENTERPRISE is sellable in principle but this policy binds no Price for it, so the
    // quote still fails closed (BILLING_OFFER_UNAVAILABLE) exactly as a hidden tier does.
    for (const offerKey of ['ENTERPRISE_1999', 'RECEIPT_ONLY']) assert.equal((await request(`${base}/quote`, 'POST', { offerKey, interval: 'year', billingEmail: 'owner@example.test' })).status, 409);
    assert.equal((await request(`${base}/quote`, 'POST', { offerKey: 'PRO_999', interval: 'year', billingEmail: 'owner@example.test', amount: 1 })).status, 400);
    assert.equal(checkoutCalls, 0); cases.push('hidden-enterprise-and-forged-price-rejected');
    if (process.env.BILLING_BROWSER_E2E === '1') {
      await client.company.update({ where: { id: companyIds[0] }, data: { addressJson: {} } });
      const { startBillingBrowser } = await import('./billing-browser-smoke');
      browser = await startBillingBrowser({ apiOrigin: origin, token, companyId: companyIds[0]! });
      const { page } = browser;
      if (process.env.MANGMEE_MARKETING_DIR) {
        const { checkBillingMarketing } = await import('./billing-marketing-smoke');
        cases.push(...await checkBillingMarketing({ page, appOrigin: browser.origin, directory: process.env.MANGMEE_MARKETING_DIR, evidenceDir: browser.evidenceDir }));
      }
      await page.goto(`${browser.origin}/billing/companies?offer=PRO_999&interval=year&channel=line`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'เลือกบริษัทที่จะจัดการแพ็กเกจ', exact: true }).waitFor();
      const selectedCompany = page.locator(`a[href="/companies/${companyIds[0]}/billing?offer=PRO_999&interval=year&channel=line"]`);
      await selectedCompany.click();
      await page.getByRole('heading', { name: 'แพ็กเกจและการชำระเงิน', exact: true }).waitFor();
      cases.push('browser-owner-company-picker-retains-plan-interval-and-line-origin');
      assert.doesNotMatch(await page.locator('main').last().innerText(), /ซื้อใบเพิ่ม|ซื้อเฉพาะใบ/);
      // Purchase without setup (R-A9/R-A11): an empty address never blocks — a note, not a popup — and
      // the confirm box says Stripe Checkout will ask. The shop profile stays an optional detour.
      assert.match(await page.getByRole('note').filter({ hasText: 'เอกสารจะออกในชื่อ' }).innerText(), /ที่อยู่กรอกได้ที่หน้าชำระเงิน/);
      await page.getByRole('button', { name: /^(เลือกแพ็กเกจ|ซื้อหรือเปลี่ยนแพ็กเกจ)$/, exact: true }).click();
      await page.getByRole('button', { name: 'รายปี', exact: true }).click();
      await page.getByRole('button', { name: 'เลือกแพ็กเกจนี้', exact: true }).click();
      await page.getByRole('heading', { name: /ยืนยันซื้อ/ }).waitFor();
      assert.equal(await page.getByRole('dialog').count(), 0);
      const documents = page.getByLabel('ข้อมูลออกเอกสาร', { exact: true });
      assert.match(await documents.innerText(), /จะกรอกที่หน้าชำระเงิน/);
      await page.setViewportSize({ width: 390, height: 900 });
      await page.screenshot({ path: `${browser.evidenceDir}/purchase-no-setup-review-mobile.png`, fullPage: true });
      await documents.getByRole('link', { name: 'แก้ไขข้อมูลร้าน', exact: true }).click();
      await page.getByRole('heading', { name: 'ข้อมูลร้าน', exact: true }).waitFor();
      for (const [label, value] of Object.entries({ 'ที่อยู่ (บ้านเลขที่ ถนน)': BILLING_TEST_ADDRESS.line1,
        'ตำบล / แขวง': BILLING_TEST_ADDRESS.subdistrict, 'อำเภอ / เขต': BILLING_TEST_ADDRESS.district,
        'จังหวัด': BILLING_TEST_ADDRESS.province, 'รหัสไปรษณีย์': BILLING_TEST_ADDRESS.postalCode })) {
        await page.getByRole('textbox', { name: label, exact: true }).fill(value);
      }
      await page.getByRole('button', { name: 'บันทึกและกลับไปซื้อแพ็กเกจ', exact: true }).click();
      await page.getByRole('heading', { name: /ยืนยันซื้อ/ }).waitFor();
      // F30: the resumed selection leaves the URL (a reload must not quote it again); the LINE origin stays.
      assert.match(page.url(), /channel=line/); assert.doesNotMatch(page.url(), /profile=updated|offer=/);
      assert.match(await page.getByLabel('ข้อมูลออกเอกสาร', { exact: true }).innerText(), /บริษัท ทดสอบเอกสาร จำกัด/);
      assert.equal(checkoutCalls, 0);
      await page.screenshot({ path: `${browser.evidenceDir}/company-profile-purchase-review-mobile.png`, fullPage: true });
      await page.setViewportSize({ width: 1280, height: 900 });
      cases.push('browser-no-setup-review-without-profile-popup-optional-profile-detour-returns-to-selected-package-no-auto-charge');
      const toggleSales = async (enabled: boolean) => {
        await client.billingSettings.update({ where: { id: `${accountId}:test` }, data: {
          gatesJson: Object.fromEntries(BILLING_ACTIONS.map(action => [action, action === 'new_sales' ? enabled : action!=='refunds'])), version: { increment: 1 },
        } });
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      };
      await toggleSales(false);
      await page.getByRole('heading', { name: /ยืนยันซื้อ/ }).waitFor({ state: 'hidden' });
      assert.equal(checkoutCalls, 0);
      assert.equal(await page.getByRole('button', { name: 'เลือกแพ็กเกจนี้', exact: true }).count(), 0);
      await toggleSales(true);
      await page.getByRole('button', { name: 'เลือกแพ็กเกจนี้', exact: true }).click();
      await page.getByRole('heading', { name: /ยืนยันซื้อ/ }).waitFor();
      cases.push('browser-runtime-sales-gate-refresh-invalidates-review-and-recovers-without-restart');
      if (trialCarryoverOnly) {
        const review = await page.getByRole('region', { name: 'ยืนยันซื้อแพ็กเกจ', exact: true }).innerText();
        assert.match(review, /ยกยอดจากทดลองใช้/); assert.match(review, /1,209 ใบ/);
      }
      await page.screenshot({ path: `${browser.evidenceDir}/quote-desktop.png`, fullPage: true });
      await page.getByRole('checkbox').check();
      await page.getByRole('button', { name: 'ยืนยันและไปชำระที่ Stripe' }).click();
      await page.waitForURL('https://checkout.stripe.com/**');
      cases.push('browser-real-cookie-csrf-expired-owner-quote-consent-checkout');
    }
    const storedAttempt = browser ? await client.billingAttempt.findFirstOrThrow({ where: { initiatingUserId: userIds[0] } }) : null;
    const storedQuote = storedAttempt ? await client.billingQuote.findUniqueOrThrow({ where: { id: storedAttempt.quoteId } }) : null;
    const quote = storedQuote ? { status: 200, body: (storedQuote.snapshotJson as any).quote } : await request(`${base}/quote`, 'POST', { offerKey: 'PRO_999', interval: 'year', billingEmail: 'owner@example.test' });
    assert.equal(quote.status, 200, JSON.stringify(quote.body)); assert.equal(quote.body.totalSatang, 999000); assert.equal(quote.body.offer.receiptAllowance, 1200);
    if (trialCarryoverOnly) {
      assert.equal(quote.body.purchase.trialCarryover.receiptUnits, 9);
      assert.equal(quote.body.purchase.projectedRemainingReceipts, 1209);
      assert.equal((await admitCompanyOcr(prisma, { companyId: companyIds[0]!, sourceRoute: 'receipt-ocr-web', requestId: 'trial-during-checkout', enforceReceiptQuota: true })).allowed, true);
    } else assert.equal(quote.body.purchase.trialCarryover, undefined);
    const body = { quoteId: quote.body.quoteId, consentRevision: quote.body.consentRevision, accepted: true, channel: 'line' };
    const key = storedAttempt?.idempotencyKey ?? randomUUID(); const checkout = await request(`${base}/checkout`, 'POST', body, { 'idempotency-key': key });
    assert.equal(checkout.status, 200, JSON.stringify(checkout.body)); assert.equal(checkout.body.state, 'OPEN');
    assert.equal(provider.customers[0]!.name, 'บริษัท ทดสอบเอกสาร จำกัด');
    assert.deepEqual(provider.customers[0]!.address, { country: 'TH', line1: BILLING_TEST_ADDRESS.line1, line2: BILLING_TEST_ADDRESS.subdistrict,
      city: BILLING_TEST_ADDRESS.district, state: BILLING_TEST_ADDRESS.province, postal_code: BILLING_TEST_ADDRESS.postalCode });
    const replay = await request(`${base}/checkout`, 'POST', body, { 'idempotency-key': key });
    assert.equal(replay.body.attemptId, checkout.body.attemptId); assert.equal(checkoutCalls, 1);
    if (process.env.BILLING_PROFILE_ONLY === '1') {
      cases.push('registered-name-and-all-address-parts-reach-stripe-new-customer-single-checkout');
      console.log(JSON.stringify({ provider: 'simulated', app: 'real HTTP/PostgreSQL/Next', cases }, null, 2));
      return;
    }
    assert.equal((await request(`${base}/checkout`, 'POST', { ...body, channel: 'web' }, { 'idempotency-key': key })).status, 409);
    assert.equal((await request(`/v1/companies/${companyIds[1]}/billing/attempts/${checkout.body.attemptId}`)).status, 404);
    assert.equal(await client.billingReceiptGrant.count({ where: { companyId: companyIds[0] } }), 0);
    assert.equal((await request(`${base}/attempts/${checkout.body.attemptId}`)).body.paymentState, 'PENDING');
    assert.equal((await client.packageChangeRequest.findUniqueOrThrow({where:{id:originalRequest.body.id}})).status,'OPEN');
    cases.push('quote-line-checkout-replay-cross-tenant-and-no-return-url-unlock');
    const session = provider.sessions[0]!, start = Math.floor(Date.now() / 1000) - 1, end = start + 365 * 86400;
    const subId = `sub_${run}`, invoiceId = `in_${run}`, intentId = `pi_${run}`, chargeId = `ch_${run}`;
    Object.assign(session, { status: 'complete', subscription: subId, customer_details: { email: `${userIds[0]}@example.test`,
      address: { country: 'TH', line1: BILLING_TEST_ADDRESS.line1, line2: null, city: BILLING_TEST_ADDRESS.district, state: BILLING_TEST_ADDRESS.province, postal_code: '10110' } } });
    provider.customers[0]!.email ??= `${userIds[0]}@example.test`;
    const subscription: ProviderObject = { id: subId, object: 'subscription', livemode: false, customer: session.customer, metadata: session.metadata, status: 'active', cancel_at_period_end: false, collection_method: 'charge_automatically', billing_mode: { type: 'classic' }, billing_cycle_anchor: start,
      items: { data: [{ id: `si_${run}`, price: 'price_ProYear', quantity: 1, current_period_start: start, current_period_end: end }] } }; provider.subscriptions.push(subscription);
    provider.invoices.push({ id: invoiceId, object: 'invoice', livemode: false, customer: session.customer, parent: { subscription_details: { subscription: subId } }, status: 'paid',
      collection_method: 'charge_automatically', currency: 'thb', billing_reason: 'subscription_create', amount_remaining: 0, total: 999000, amount_paid: 999000, starting_balance: 0,
      number: 'SYNTHETIC-1', created: start, status_transitions: { paid_at: start }, hosted_invoice_url: 'https://invoice.stripe.com/i/synthetic', invoice_pdf: 'https://invoice.stripe.com/i/synthetic/pdf' });
    provider.lines.push({ id: `il_${run}`, invoice: invoiceId, parent: { type: 'subscription_item_details', subscription_item_details: { subscription: subId, subscription_item: `si_${run}`, proration: false } },
      pricing: { price_details: { price: 'price_ProYear' } }, currency: 'thb', quantity: 1, livemode: false, period: { start, end } });
    provider.payments.push({ id: `inpay_${run}`, object: 'invoice_payment', livemode: false, status: 'paid', invoice: invoiceId,
      payment: { type: 'payment_intent', payment_intent: intentId }, amount_paid: 999000, currency: 'thb' });
    const charge = { id: chargeId, livemode: false, status: 'succeeded', paid: true, captured: true, currency: 'thb', amount: 999000, customer: session.customer,
      payment_intent: intentId, payment_method_details: { type: 'card' }, amount_refunded: 0, disputed: false, receipt_url: 'https://pay.stripe.com/receipts/synthetic' };
    provider.charges.push(charge); provider.intents.push({ id: intentId, livemode: false, status: 'succeeded', currency: 'thb', amount_received: 999000, customer: session.customer, latest_charge: charge });
    const webhook = async (eventId: string, signatureValid = true) => {
      const payload = JSON.stringify({ id: eventId, object: 'event', api_version: STRIPE_API_VERSION, livemode: false, type: 'invoice.paid', data: { object: { id: invoiceId } } });
      const timestamp = Math.floor(Date.now() / 1000), hash = createHmac('sha256', webhookSecret).update(`${timestamp}.${payload}`).digest('hex');
      return fetch(`${origin}/v1/public/stripe-events`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${timestamp},v1=${signatureValid ? hash : '0'.repeat(64)}` }, body: payload });
    };
    const access = app.get(PlatformAccessService), nativeStatus = access.getStatus.bind(access);
    await client.branch.createMany({ data: Array.from({ length: 6 }, (_, index) => ({ companyId: companyIds[0]!, code: `initial-cap-${index}`,
      name: `Synthetic initial branch ${index}`, type: index === 0 ? 'HEAD_OFFICE' as const : 'BRANCH' as const })) });
    access.getStatus = async () => ({ ...await nativeStatus(), effectiveState: 'CLOSED' });
    assert.equal((await webhook(`evt_${run}`, false)).status, 401);
    assert.equal((await webhook(`evt_${run}`)).status, 200);
    assert.equal((await webhook(`evt_${run}`)).status, 200);
    assert.equal((await request(base)).status, 503);
    assert.equal((await request('/v1/internal/billing/drain', 'POST', {})).status, 401);
    const drained = await request('/v1/internal/billing/drain', 'POST', {}, { 'x-worker-token': workerToken });
    assert.equal(drained.status, 200); assert.equal(drained.body.failed, 0, JSON.stringify(drained));
    assert.equal(notificationFixture.line.length, 0); assert.equal(notificationFixture.mail.length, 0);
    assert.equal((await request('/v1/internal/billing/notifications/drain', 'POST', {})).status, 401);
    await drainNotifications();
    access.getStatus = nativeStatus;
    cases.push('closed-platform-signed-durable-webhook-dedupe-worker-credential');
    const initialHeld = await request(base); assert.equal(initialHeld.body.paymentState, 'PAID'); assert.equal(initialHeld.body.applyState, 'HELD');
    assert.equal((await client.packageChangeRequest.findUniqueOrThrow({where:{id:originalRequest.body.id}})).status,'OPEN');
    assert.equal(initialHeld.body.attemptId, checkout.body.attemptId); assert.equal(initialHeld.body.capacityRepair.attemptId, checkout.body.attemptId);
    assert.equal(await client.billingReceiptGrant.count({ where: { companyId: companyIds[0] } }), 0);
    assert.equal((await request(`${base}/quote`, 'POST', { offerKey: 'PRO_999', interval: 'year', billingEmail: 'owner@example.test' })).body.code, 'BILLING_EXISTING_SUBSCRIPTION');
    const repairInitialCapacity=async()=>{
    const currentHeld=(await request(base)).body;
    const initialOptions = (await request(`${base}/capacity?offerKey=PRO_999&interval=year`)).body;
    const initialRepair = await request(`${base}/attempts/${checkout.body.attemptId}/capacity`, 'POST', { expectedVersion: currentHeld.capacityRepair.attemptVersion, accepted: true,
      selection: { sourceHash: initialOptions.sourceHash, branchIds: initialOptions.branches.filter((b: any) => b.headOffice).map((b: any) => b.id),
        memberships: initialOptions.memberships.map((m: any) => ({ id: m.id, defaultBranchId: null })) } }, { 'idempotency-key': randomUUID() });
    assert.equal(initialRepair.status, 202, JSON.stringify(initialRepair.body));
    };
    if(process.env.BILLING_PACKAGE_REQUEST_ONLY==='1' || trialCarryoverOnly)await repairInitialCapacity();
    else cases.push(...await checkBillingApplyRetry({prisma,operations:app.get(BillingOperationsService),companyIds,stripeAccountId:accountId,origin,request,browser,
      signToken:(sid,userId)=>new JwtService().sign({sub:userId,sid},{secret,algorithm:'HS256',issuer:DEFAULT_JWT_ISSUER,audience:DEFAULT_JWT_AUDIENCE,expiresIn:3600}),
      recordLegal:(userId,membershipId,companyId)=>client.$transaction(tx=>app.get(LegalAcceptanceService).recordFromEvidence(tx,{userId,companyId,membershipId,
        requestId:run,evidence:{...release,locale:'th',legalAcceptedAt:new Date()}})).then(()=>{}),
      repairCapacity:repairInitialCapacity,charge,intercept:hook=>{providerCallHook=hook;}}));
    if(process.env.BILLING_APPLY_RETRY_ONLY==='1'){
      console.log(JSON.stringify({layer:'real-Nest-HTTP-PostgreSQL-provider-simulation',passed:cases,browserE2E:Boolean(browser),simulatedProviders:['Stripe','Postmark','LINE'],realProviderPayment:false}));return;
    }
    const initialAccount = await client.billingAccount.findFirstOrThrow({ where: { companyId: companyIds[0], stripeAccountId: accountId } });
    await app.get(BillingReconcilerService).reconcileAccount(initialAccount.id);
    await drainNotifications();
    assert.equal(await client.branch.count({ where: { companyId: companyIds[0], status: 'ACTIVE' } }), 1);
    cases.push('initial-paid-held-capacity-retains-original-command-and-repairs-without-repayment');
    const after = await request(base); assert.equal(after.status, 200, JSON.stringify(after));
    assert.equal(after.body.paymentState, 'PAID'); assert.equal(after.body.applyState, 'APPLIED'); assert.equal(after.body.accessState, 'ACTIVE');
    // R-A4: the first paid invoice captured the Checkout recipient (the pinned owner email) and address.
    assert.deepEqual(after.body.recipient, { email: `${userIds[0]}@example.test`, source: 'ACCOUNT_EMAIL', bouncedAt: null, canChange: true });
    const capturedAccount = await client.billingAccount.findUniqueOrThrow({ where: { id: initialAccount.id } });
    assert.equal((capturedAccount.checkoutAddressJson as Record<string, unknown>).postal_code, '10110');
    cases.push('initial-subscription-captures-checkout-recipient-and-address');
    assert.equal(after.body.usage.remaining, trialCarryoverOnly ? 1208 : 1200); assert.equal(after.body.usage.cadence, 'PAID_GRANTS');
    assert.equal(after.body.paidThrough, new Date(end * 1000).toISOString());
    assert.equal(await client.billingReceiptGrant.count({ where: { companyId: companyIds[0] } }), trialCarryoverOnly ? 2 : 1);
    if (trialCarryoverOnly) {
      const carry = await client.billingReceiptGrant.findFirstOrThrow({ where: { companyId: companyIds[0], kind: 'TRIAL_CARRYOVER' } });
      assert.equal(carry.units, 8); assert.equal(carry.expiresAt.toISOString(), new Date(end * 1000).toISOString());
      await app.get(BillingReconcilerService).reconcileAccount(initialAccount.id);
      assert.equal((await request(base)).body.usage.remaining, 1208);
      cases.push('trial-review-nine-rechecks-eight-after-checkout-consumption-and-grants-once-after-held-repair');
    }
    const paidAttempt = await request(`${base}/attempts/${checkout.body.attemptId}`);
    assert.equal(paidAttempt.body.paymentState, 'PAID'); assert.equal(paidAttempt.body.applyState, 'APPLIED');
    assert.ok(paidAttempt.body.invoiceReference);
    const requestHistory=await request(requestPath);assert.equal(requestHistory.status,200,JSON.stringify(requestHistory));
    const fulfilled=requestHistory.body.find((row:any)=>row.id===originalRequest.body.id);
    assert.equal(fulfilled.status,'APPROVED');assert.equal(fulfilled.resolutionSource,'PAID_PURCHASE');assert.equal(fulfilled.note,originalRequest.body.note);
    assert.doesNotMatch(JSON.stringify(fulfilled),/paymentRef|providerInvoiceId|receipt_url|hosted_invoice_url|totalSatang/);
    assert.equal((await client.packageChangeRequest.findUniqueOrThrow({where:{id:foreignRequest.id}})).status,'OPEN');
    assert.equal(await client.auditLog.count({where:{companyId:companyIds[0],action:'billing.package_request.fulfilled'}}),1);
    const nextRequest=await request(requestPath,'POST',{requestedTierKey:'PRO_999'});assert.equal(nextRequest.status,201);
    assert.notEqual(nextRequest.body.id,originalRequest.body.id);assert.equal(nextRequest.body.status,'OPEN');
    await webhook(`evt_second${run}`); await request('/v1/internal/billing/drain', 'POST', {}, { 'x-worker-token': workerToken });
    await drainNotifications();
    assert.equal(await client.billingReceiptGrant.count({ where: { companyId: companyIds[0] } }), trialCarryoverOnly ? 2 : 1);
    // Stripe sandbox proved schedule transitions replace the item ID. Reprocessing the
    // historical invoice must still succeed without minting another receipt grant.
    subscription.items.data[0]!.id = `si_replaced${run}`;
    await webhook(`evt_history${run}`);
    const historical = await request('/v1/internal/billing/drain', 'POST', {}, { 'x-worker-token': workerToken });
    assert.equal(historical.body.failed, 0, JSON.stringify(historical));
    assert.equal(await client.billingReceiptGrant.count({ where: { companyId: companyIds[0] } }), trialCarryoverOnly ? 2 : 1);
    cases.push('historical-paid-invoice-survives-replaced-subscription-item');
    assert.equal((await client.packageChangeRequest.findUniqueOrThrow({where:{id:nextRequest.body.id}})).status,'OPEN');
    assert.equal(await client.auditLog.count({where:{companyId:companyIds[0],action:'billing.package_request.fulfilled'}}),1);
    cases.push('original-line-request-stays-open-unpaid-and-held-then-fulfills-once-with-safe-purchase-history');
    cases.push('historical-paid-replay-preserves-newer-and-foreign-package-requests');
    // Independent later repurchase scenarios start without this synthetic next-request fixture.
    await client.packageChangeRequest.deleteMany({where:{id:{in:[nextRequest.body.id,foreignRequest.id]}}});
    if(process.env.BILLING_PACKAGE_REQUEST_ONLY==='1'){
      console.log(JSON.stringify({layer:'real-Nest-HTTP-PostgreSQL-provider-simulation',passed:cases,browserE2E:Boolean(browser),simulatedProviders:['Stripe','Postmark','LINE'],realProviderPayment:false}));return;
    }
    if(process.env.BILLING_ADJUSTMENTS_ONLY==='1') {
      cases.push(...await checkBillingAdjustments({prisma,request,companyId:companyIds[0]!,foreignCompanyId:companyIds[1]!,userId:userIds[0]!,membershipId:memberId,provider,browser,
        transport:hook=>{journeyTransport=hook;},intercept:hook=>{providerCallHook=hook;}}));
      console.log(JSON.stringify({layer:'real-Nest-HTTP-PostgreSQL-provider-simulation',passed:cases,browserE2E:Boolean(browser),simulatedProviders:['Stripe','Postmark','LINE'],realProviderPayment:false}));return;
    }
    if (process.env.BILLING_PLAN_CHANGE_ONLY === '1') {
      cases.push(...await checkBillingPlanChange({ request, prisma, companyIds, userId:userIds[0]!, provider, fixture:repeatFixture, cadence:true, reconcile:id=>app.get(BillingReconcilerService).reconcileAccount(id) }));
      cases.push(...await checkBillingPlanChange({ request, prisma, companyIds, userId:userIds[0]!, provider, fixture:repeatFixture, browser, reconcile:id=>app.get(BillingReconcilerService).reconcileAccount(id) }));
      console.log(JSON.stringify({layer:'real-Nest-HTTP-PostgreSQL-provider-simulation',passed:cases,simulatedProviders:['Stripe','Postmark','LINE'],realProviderPayment:false,browserE2E:Boolean(browser)}));return;
    }
    if (process.env.BILLING_UPGRADE_ONLY === '1') {
      cases.push(...await checkBillingUpgrade({ request, prisma, companyIds, userId: userIds[0]!, provider, fixture: repeatFixture, browser, reconcile: id => app.get(BillingReconcilerService).reconcileAccount(id) }));
      console.log(JSON.stringify({ layer: 'real-Nest-HTTP-PostgreSQL-provider-simulation', passed: cases, simulatedProviders: ['Stripe','Postmark','LINE'], realProviderPayment: false, browserE2E: Boolean(browser) })); return;
    }
    if (process.env.BILLING_RESTART_ONLY !== '1') {
      const { EmailDeliveryService } = await import('../modules/auth/application/email-delivery.service');
      cases.push(...await checkBillingNotifications({ prisma, companyId: companyIds[0]!, userId: userIds[0]!, membershipId: memberId,
        fixture: notificationFixture, email: app.get(EmailDeliveryService), drain: drainNotifications,request }));
      if(process.env.BILLING_NOTIFICATIONS_ONLY==='1'){
        console.log(JSON.stringify({layer:'real-Nest-HTTP-PostgreSQL-provider-simulation',passed:cases,simulatedProviders:['Stripe','Postmark','LINE'],realProviderPayment:false,browserE2E:Boolean(browser)}));return;
      }
      if (browser) {
        await browser.page.setViewportSize({ width: 390, height: 844 });
        await browser.page.goto(`${browser.origin}/companies/${companyIds[0]}/notifications`, { waitUntil: 'domcontentloaded' });
        const notification = browser.page.getByRole('link', { name: 'อัปเดตแพ็กเกจมั่งมี', exact: true });
        await notification.waitFor();
        await browser.page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('main')!.getBoundingClientRect().width > innerWidth * 0.8);
        await browser.page.screenshot({ path: `${browser.evidenceDir}/billing-notification-mobile.png`, fullPage: true });
        assert.equal(await notification.getAttribute('href'), `/companies/${companyIds[0]}/billing`);
        await notification.click();
        await browser.page.getByRole('heading', { name: 'แพ็กเกจและการชำระเงิน', exact: true }).waitFor();
        await browser.page.getByRole('region', { name: 'สถานะแพ็กเกจ' }).getByText('แพ็กเกจปัจจุบัน', { exact: true }).waitFor();
        await browser.page.getByRole('region', { name: 'สถานะแพ็กเกจ' }).getByText('ใช้งานได้', { exact: true }).waitFor();
        cases.push('browser-billing-notification-center-link-returns-to-authoritative-paid-status');
      }
      if (process.env.BILLING_NOTIFICATIONS_ONLY === '1') {
        console.log(JSON.stringify({ layer: 'real-Nest-HTTP-PostgreSQL-provider-simulation', passed: cases,
          simulatedProviders: ['Stripe', 'Postmark', 'LINE'], realProviderPayment: false, browserE2E: Boolean(browser) }));
        return;
      }
    }
    for (const sourceRoute of ['receipt-ocr-web', 'receipt-ocr-line'] as const) assert.equal((await admitCompanyOcr(prisma, { companyId: companyIds[0]!, sourceRoute, requestId: `${run}-${sourceRoute}`, monthKey: '2026-09' })).allowed, true);
    assert.equal((await request(base)).body.usage.remaining, trialCarryoverOnly ? 1206 : 1198);
    cases.push('verified-payment-atomic-automatic-unlock-and-shared-web-line-quota');
    if (browser) {
      const { page } = browser;
      await page.goto(`${browser.origin}/companies/${companyIds[0]}/billing/return?attempt=${checkout.body.attemptId}`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'ชำระแล้ว เปิดใช้งานแล้ว', exact: true }).waitFor();
      assert.match(await page.getByRole('region', { name: 'สถานะแพ็กเกจ' }).innerText(), trialCarryoverOnly ? /1206/ : /1198/);
      await page.getByRole('button', { name: 'ประวัติ', exact: true }).click();
      await page.getByRole('link', { name: 'ดูเอกสาร', exact: true }).first().waitFor();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: `${browser.evidenceDir}/paid-mobile.png`, fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      cases.push('browser-return-verified-unlock-documents-and-mobile-layout');
      for (const query of ['', `?attempt=${randomUUID()}`]) {
        await page.goto(`${browser.origin}/companies/${companyIds[0]}/billing/return${query}`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('alert').filter({ hasText: /ลิงก์ไม่มีเลขรายการ|ไม่พบรายการนี้/ }).waitFor();
        assert.equal(await page.getByRole('heading', { name: 'ชำระแล้ว เปิดใช้งานแล้ว', exact: true }).count(), 0);
        await page.getByRole('button', { name: 'สลับเมนู', exact: true }).click();
        await page.locator('aside').waitFor();
      }
      const failedQuoteId = randomUUID(), failedAttemptId = randomUUID();
      const sourceAttempt = await client.billingAttempt.findUniqueOrThrow({ where: { id: checkout.body.attemptId } });
      const sourceQuote = await client.billingQuote.findUniqueOrThrow({ where: { id: sourceAttempt.quoteId } });
      await client.billingQuote.create({ data: { ...sourceQuote, id: failedQuoteId, snapshotJson: sourceQuote.snapshotJson as Prisma.InputJsonValue } });
      await client.billingAttempt.create({ data: { ...sourceAttempt, id: failedAttemptId, quoteId: failedQuoteId, idempotencyKey: randomUUID(),
        status: 'EXPIRED', checkoutSessionId: null, subscriptionId: null, quoteSnapshot: sourceAttempt.quoteSnapshot as Prisma.InputJsonValue, collectionJson: undefined } });
      const failedAttempt = await request(`${base}/attempts/${failedAttemptId}`);
      assert.equal(failedAttempt.body.paymentState, 'FAILED'); assert.equal(failedAttempt.body.invoiceReference, null);
      await page.goto(`${browser.origin}/companies/${companyIds[0]}/billing/return?attempt=${failedAttemptId}`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('status').filter({ hasText: 'ไม่ได้ชำระสำเร็จหรือรายการหมดอายุ' }).waitFor();
      assert.equal(await page.getByRole('heading', { name: 'ชำระแล้ว เปิดใช้งานแล้ว', exact: true }).count(), 0);
      cases.push('browser-forged-missing-and-expired-return-never-reuse-an-old-payment-success');
    }
    const history = await request(`${base}/history`); assert.equal(history.status, 200); assert.equal(history.body.items.length, 1);
    assert.doesNotMatch(JSON.stringify(history.body), /https:|customerId|providerInvoiceId/);
    const documentId = history.body.items[0].id;
    for (const kind of ['invoice', 'pdf', 'receipt']) {
      const doc = await request(`${base}/documents/${documentId}/open`, 'POST', { kind });
      assert.equal(doc.status, 200, JSON.stringify(doc)); assert.ok(new URL(doc.body.url).hostname.endsWith('stripe.com'));
    }
    assert.equal((await request(`/v1/companies/${companyIds[1]}/billing/documents/${documentId}/open`, 'POST', { kind: 'receipt' })).status, 404);
    badDocument = true; assert.equal((await request(`${base}/documents/${documentId}/open`, 'POST', { kind: 'receipt' })).status, 409); badDocument = false;
    await client.membershipRole.delete({ where: { membershipId_roleId: { membershipId: memberId, roleId } } });
    assert.equal((await request(`${base}/documents/${documentId}/open`, 'POST', { kind: 'receipt' })).status, 403);
    await client.membershipRole.create({ data: { membershipId: memberId, roleId } });
    cases.push('protected-invoice-pdf-receipt-tenant-owner-and-url-allowlist');
    if (trialCarryoverOnly) {
      console.log(JSON.stringify({ layer: 'real-Nest-HTTP-PostgreSQL-provider-simulation', passed: cases, browserE2E: Boolean(browser), realProviderPayment: false })); return;
    }
    if (process.env.BILLING_RESTART_ONLY !== '1') {
    const billingAccount = await client.billingAccount.findFirstOrThrow({ where: { companyId: companyIds[0], stripeAccountId: accountId } });
    const collectionInput = { request, prisma, companyId: companyIds[0]!, otherCompanyId: companyIds[1]!, membershipId: memberId, ownerRoleId: roleId,
      fixture: repeatFixture, subscription, provider, scan: () => request('/v1/internal/billing/scan', 'POST', {}, { 'x-worker-token': workerToken }),
      drain: () => app.get(BillingReconcilerService).reconcileAccount(billingAccount.id), browser };
    cases.push(...await checkBillingCollection({ ...collectionInput, prepaid: false }));
    subscription.status = 'past_due';
    await app.get(BillingReconcilerService).reconcileAccount(billingAccount.id);
    assert.equal((await request(base)).body.paymentState, 'FAILED'); cases.push('failed-renewal-not-hidden-by-prior-paid-invoice');
    const reconciler = app.get(BillingReconcilerService), savedPrisma = (reconciler as any).prisma;
    (reconciler as any).prisma = { client: { billingProviderEvent: { upsert: async () => { throw new Error('synthetic database fault'); } } } };
    try { assert.equal((await webhook(`evt_fault${run}`)).status, 503); } finally { (reconciler as any).prisma = savedPrisma; }
    cases.push('callback-persistence-failure-is-retryable');
    cases.push(...await checkRepeatPurchase({ request, base, companyId: companyIds[0]!, prisma, reconciler, provider, fixture: repeatFixture, browser,
      operations:app.get(BillingOperationsService),userId:userIds[0]!,membershipId:memberId }));
    cases.push(...await checkBillingCollection({ ...collectionInput, prepaid: true }));
    cases.push(...await checkBillingAdmin({ request, prisma, companyIds, userId: userIds[0]!, membershipId: memberId, stripeAccountId: accountId, browser, failNextRead: repeatFixture.failNextRead,
      drain: () => request('/v1/internal/billing/drain', 'POST', {}, { 'x-worker-token': workerToken }) }));
    if(process.env.BILLING_REPEAT_APPLY_ONLY==='1'){
      console.log(JSON.stringify({layer:'real-Nest-HTTP-PostgreSQL-provider-simulation',passed:cases,browserE2E:Boolean(browser),simulatedProviders:['Stripe','Postmark','LINE'],realProviderPayment:false}));return;
    }
    }
    } else {
      await client.companyPlanTerm.update({ where: { companyId: companyIds[0]! }, data: { termEndsAt: new Date(Date.now() + 86400000) } });
      await client.billingAccount.create({ data: { companyId: companyIds[0]!, stripeAccountId: accountId, livemode: false } });
      if (process.env.BILLING_BROWSER_E2E === '1') {
        const { startBillingBrowser } = await import('./billing-browser-smoke');
        browser = await startBillingBrowser({ apiOrigin: origin, token, companyId: companyIds[0]! });
      }
    }
    if (process.env.BILLING_RESTART_ONLY !== '1' && process.env.BILLING_CUSTOMER_JOURNEYS_ONLY !== '1') cases.push(...await checkBillingConfiguration({ request, prisma, provider,companyIds,repeatFixture,reconcile:id=>app.get(BillingReconcilerService).reconcileAccount(id), companyId: companyIds[0]!, userIds, membershipId: memberId, stripeAccountId: accountId, browser,
      transport: hook => { journeyTransport = hook; },
      scanAccounts:()=>request('/v1/internal/billing/scan','POST',{}, {'x-worker-token':workerToken}),
      drainProviderScans:()=>request('/v1/internal/billing/provider-scans/drain','POST',{}, {'x-worker-token':workerToken}),
      drainOperations:()=>request('/v1/internal/billing/drain','POST',{}, {'x-worker-token':workerToken}),drainNotifications,notificationFixture,
      signToken: (sid, userId) => new JwtService().sign({ sub: userId ?? userIds[1], sid }, { secret, algorithm: 'HS256', issuer: DEFAULT_JWT_ISSUER, audience: DEFAULT_JWT_AUDIENCE, expiresIn: 3600 }),
      recordLegal: (userId, membershipId, targetCompanyId) => client.$transaction(tx => app.get(LegalAcceptanceService).recordFromEvidence(tx, { userId, companyId: targetCompanyId??companyIds[0]!, membershipId,
        requestId: run, evidence: { ...release, locale: 'th', legalAcceptedAt: new Date() } })).then(() => {}) }));
    if (process.env.BILLING_SCOPES_ONLY === '1' || process.env.BILLING_MANUAL_PLAN_ONLY === '1' || process.env.BILLING_PLAN_ADJUSTMENTS_ONLY === '1' || process.env.BILLING_RECEIPT_ADJUSTMENTS_ONLY === '1' || process.env.BILLING_OFFER_MATRIX_ONLY === '1' || process.env.BILLING_OFFER_TERMS_ONLY === '1' || process.env.BILLING_BATCHES_ONLY === '1' || process.env.BILLING_CHECKOUT_EXPIRY_ONLY === '1' || process.env.BILLING_SETTLEMENT_ONLY === '1' || process.env.BILLING_REFUNDS_ONLY === '1' || process.env.BILLING_REFUND_CONTROLS_ONLY === '1' || process.env.BILLING_READINESS_ONLY === '1' || process.env.BILLING_SALES_COHORT_ONLY === '1' || process.env.BILLING_SUPPORT_SLA_ONLY === '1' || process.env.BILLING_SCHEDULED_POLICY_ONLY === '1') {
      console.log(JSON.stringify({ layer: 'real-Nest-HTTP-PostgreSQL-Next-Chromium', passed: cases, browserE2E: Boolean(browser), simulatedProviders: ['Stripe', 'Postmark', 'LINE'], realProviderPayment: false })); return;
    }
    if (process.env.BILLING_CONFIG_ONLY !== '1') cases.push(...await checkBillingRestart({ request, prisma, companyId: companyIds[1]!, sourceCompanyId: companyIds[0]!, extraUserId: userIds[1]!,
      provider, browser, reconcile: id => app.get(BillingReconcilerService).reconcileAccount(id), loseCheckout: () => { loseSubscriptionCheckout = true; } }));
    if (process.env.BILLING_CONFIG_ONLY !== '1' && process.env.BILLING_RESTART_ONLY !== '1') cases.push(...await checkBillingFinancial({ request, prisma,
      companyId: companyIds[0]!, userId: userIds[0]!, membershipId: memberId, provider, browser,
      reconcile: id => app.get(BillingReconcilerService).reconcileAccount(id), drain: () => request('/v1/internal/billing/drain', 'POST', {}, { 'x-worker-token': workerToken }),
      event: async (type, objectId, eventId) => {
        const payload = JSON.stringify({ id: eventId, object: 'event', api_version: STRIPE_API_VERSION, livemode: false, type, data: { object: { id: objectId } } });
        const timestamp = Math.floor(Date.now() / 1000), hash = createHmac('sha256', webhookSecret).update(`${timestamp}.${payload}`).digest('hex');
        const result = await fetch(`${origin}/v1/public/stripe-events`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${timestamp},v1=${hash}` }, body: payload });
        return result.status;
      } }));
    if (process.env.BILLING_CONFIG_ONLY !== '1' && process.env.BILLING_RESTART_ONLY !== '1') cases.push(...await checkBillingUpgrade({ request, prisma, companyIds, userId: userIds[0]!, provider, fixture: repeatFixture, browser, reconcile: id => app.get(BillingReconcilerService).reconcileAccount(id) }));
    if (process.env.BILLING_CONFIG_ONLY !== '1' && process.env.BILLING_RESTART_ONLY !== '1') cases.push(...await checkBillingPlanChange({ request, prisma, companyIds, userId:userIds[0]!, provider, fixture:repeatFixture, browser, reconcile:id=>app.get(BillingReconcilerService).reconcileAccount(id) }));
    cases.push(...await checkReceiptQuotaRuntime({ request, prisma, userId: userIds[0]!, membershipId: memberId, browser: process.env.BILLING_CUSTOMER_JOURNEYS_ONLY === '1' ? undefined : browser }));
    if (process.env.BILLING_CUSTOMER_JOURNEYS_ONLY === '1') {
      console.log(JSON.stringify({ layer: 'real-Nest-HTTP-PostgreSQL-provider-simulation', passed: cases,
        browserE2E: Boolean(browser), simulatedProviders: ['Stripe', 'Postmark', 'LINE'], realProviderPayment: false })); return;
    }
    cases.push(...await checkProviderEvents());
    cases.push(...await checkClaimHistory());
    cases.push(...await checkMailMonitoring());
    cases.push(...await checkProviderScans());
    console.log(JSON.stringify({ layer: 'real-Nest-HTTP-PostgreSQL-provider-simulation', passed: cases,
      simulatedProviders: ['Stripe', 'Postmark', 'LINE'], realProviderPayment: false, browserE2E: Boolean(browser) }));
  } catch (error) {
    if (browser) {
      await browser.page.screenshot({ path: `${browser.evidenceDir}/failure.png`, fullPage: true, timeout: 10000 }).catch(() => {});
      const failure = {
        pathname: new URL(browser.page.url()).pathname, error: error instanceof Error ? error.message : 'Billing smoke failed',
        headings: await browser.page.getByRole('heading').allTextContents().catch(() => []),
      };
      console.error('Billing browser failure:', JSON.stringify(failure));
      writeFileSync(`${browser.evidenceDir}/failure.json`, JSON.stringify(failure, null, 2), { mode: 0o600 });
    }
    throw error;
  } finally {
    await browser?.close();
    await client.companyOcrUsageEvent.deleteMany({ where: { companyId: { in: companyIds } } });
    await client.companyPlanTerm.deleteMany({ where: { companyId: { in: companyIds } } });
    await client.billingReceiptGrant.deleteMany({ where: { companyId: { in: companyIds } } });
    const accounts = await client.billingAccount.findMany({ where: { stripeAccountId: accountId }, select: { id: true } });
    const ids = accounts.map(a => a.id);
    await client.billingSubscriptionContract.deleteMany({ where: { billingAccountId: { in: ids } } });
    await client.billingInvoice.deleteMany({ where: { billingAccountId: { in: ids } } });
    await client.billingAttempt.deleteMany({ where: { billingAccountId: { in: ids } } });
    await client.billingQuote.deleteMany({ where: { companyId: { in: companyIds } } });
    await client.billingAccount.deleteMany({ where: { stripeAccountId: accountId } });
    await client.billingProviderEvent.deleteMany({ where: { stripeAccountId: accountId } });
    await client.billingIssue.deleteMany({ where: { stripeAccountId: accountId } });
    await client.billingOperation.deleteMany({ where: { stripeAccountId: accountId } });
    await client.billingSettings.deleteMany({ where: { stripeAccountId: accountId } });
    await client.billingPolicyRevision.deleteMany({ where: { stripeAccountId: accountId } });
    await client.outboxEvent.deleteMany({ where: { companyId: { in: companyIds } } });
    await client.notificationEvent.deleteMany({ where: { companyId: { in: companyIds } } });
    await client.emailSendAttempt.deleteMany({ where: { recipient: { in: userIds.map(id => `${id}@example.test`) } } });
    await client.emailSuppression.deleteMany({ where: { recipient: { in: userIds.map(id => `${id}@example.test`) } } });
    await client.auditLog.deleteMany({ where: { companyId: { in: companyIds } } });
    // Synthetic clickwrap evidence stays append-only in this disposable test database.
    await client.companyMembership.deleteMany({ where: { companyId: { in: companyIds } } });
    if (roleId) await client.role.deleteMany({ where: { id: roleId } });
    await client.user.deleteMany({ where: { id: { in: userIds } } });
    await client.company.deleteMany({ where: { id: { in: companyIds } } });
    await app.close(); globalThis.fetch = nativeFetch;
  }
}
main().then(() => process.exit(0), (error: unknown) => { console.error(error instanceof Error ? error.stack : 'Billing HTTP smoke failed'); process.exit(1); });
