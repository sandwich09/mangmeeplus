import { Injectable, Logger } from '@nestjs/common';
import { stripLineExternalBrowserParam } from '@watchdog-bms/contracts';
import { AppConfigService } from '../../../common/config/app-config.service';
import { MintLineHandoffTokenUseCase } from '../../auth/application/use-cases/mint-line-handoff-token.use-case';
import { lineHandoffUrl } from '../../auth/domain/logic/line-handoff.logic';
import type { LineReplyMessage } from '../infrastructure/line-reply.adapter';

/** Who the outgoing message is for. Without all three there is no identity to bind, so no token. */
/** The sales demo's web chat speaks as `Vdemo<companyId>`; real LINE user ids start with `U`. */
export function isWebDemoLineUser(lineUserId: string): boolean {
  return lineUserId.startsWith('Vdemo');
}

export type LineHandoffContext = {
  userId: string;
  companyId: string;
  lineUserId: string;
  /** Which sender minted it — audit and adoption measurement only (spec §9). */
  surface: string;
};

/** Absolute http(s) URLs, stopped at the first character LINE would not treat as part of the URL. */
const URL_PATTERN = /https?:\/\/[^\s<>"'`)\]}]+/g;

/**
 * P12-3b delivery-boundary seam (spec §11 "Minting seam").
 *
 * Deliberately ONE seam at the send boundary rather than the ~25 call sites the plan enumerated: the
 * plan's own G12 analysis already established that every `webPath:` builder reaches users through a
 * small number of renderers, so rewriting the rendered message covers every current surface and
 * every future one for free — and it cannot be forgotten at a new call site.
 *
 * Three rules make this safe to switch on:
 *  - flag off, or no `webBaseUrl` → the messages are returned untouched, byte for byte;
 *  - only URLs on the web origin under `/companies/` are rewritten, so API upload links and any
 *    third-party URL are left alone;
 *  - ANY mint failure keeps the original URL. A broken handoff must never cost the user their link.
 *
 * The raw token exists only inside the message being sent. It is never logged.
 */
@Injectable()
export class LineHandoffLinkService {
  private readonly logger = new Logger(LineHandoffLinkService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly mint: MintLineHandoffTokenUseCase,
  ) {}

  /** True when a wrap would do anything at all — lets callers skip the walk entirely. */
  private get enabled(): boolean {
    return this.config.lineWebHandoffEnabled && !!this.config.webBaseUrl;
  }

  async wrapOutgoingLineContent(
    ctx: LineHandoffContext | null | undefined,
    messages: LineReplyMessage[],
  ): Promise<LineReplyMessage[]> {
    // No identity resolved for this send (an unlinked-user prompt, a company picker, a refusal
    // before login) means there is nobody to mint for — today's plain link is the honest answer.
    if (!this.enabled || !ctx) return messages;

    const tenantPrefix = `${this.config.webBaseUrl!.replace(/\/+$/, '')}/companies/`;
    const out: LineReplyMessage[] = [];
    for (const message of messages) {
      if (message.type === 'text') {
        const text = await this.rewriteText(message.text, tenantPrefix, ctx);
        out.push(text === message.text ? message : { ...message, text });
      } else if (message.type === 'flex') {
        const replacements = new Map<string, string>();
        const contents = await this.rewriteNode(message.contents, tenantPrefix, ctx, replacements) as Record<string, unknown>;
        let canonicalText = message.canonicalText;
        for (const [url, handoff] of replacements) canonicalText = canonicalText?.split(url).join(handoff);
        out.push(contents === message.contents && canonicalText === message.canonicalText
          ? message : { ...message, contents, ...(canonicalText ? { canonicalText } : {}) });
      } else {
        out.push(message);
      }
    }
    return out;
  }

  private async rewriteText(text: string, tenantPrefix: string, ctx: LineHandoffContext): Promise<string> {
    const matches = [...new Set(text.match(URL_PATTERN) ?? [])].filter((url) => url.startsWith(tenantPrefix));
    if (matches.length === 0) return text;
    let rewritten = text;
    for (const url of matches) {
      const handoff = await this.handoffFor(url, ctx);
      if (handoff) rewritten = rewritten.split(url).join(handoff);
    }
    return rewritten;
  }

  /** Deep-walks a flex bubble and rewrites every `action: { type: 'uri', uri }` on the web tenant. */
  private async rewriteNode(node: unknown, tenantPrefix: string, ctx: LineHandoffContext, replacements: Map<string, string>): Promise<unknown> {
    if (Array.isArray(node)) {
      const items = await Promise.all(node.map((item) => this.rewriteNode(item, tenantPrefix, ctx, replacements)));
      return items.some((item, index) => item !== node[index]) ? items : node;
    }
    if (!node || typeof node !== 'object') return node;

    const source = node as Record<string, unknown>;
    let next: Record<string, unknown> | null = null;
    const replace = (key: string, value: unknown) => {
      next ??= { ...source };
      next[key] = value;
    };

    if (source['type'] === 'uri' && typeof source['uri'] === 'string' && source['uri'].startsWith(tenantPrefix)) {
      const handoff = await this.handoffFor(source['uri'], ctx);
      if (handoff) { replacements.set(source['uri'], handoff); replace('uri', handoff); }
    }
    for (const [key, value] of Object.entries(source)) {
      if (!value || typeof value !== 'object') continue;
      const rewritten = await this.rewriteNode(value, tenantPrefix, ctx, replacements);
      if (rewritten !== value) replace(key, rewritten);
    }
    return next ?? node;
  }

  /** `<web>/l/<token>` for one tenant URL, or `null` to keep the original. */
  private async handoffFor(url: string, ctx: LineHandoffContext): Promise<string | null> {
    try {
      const parsed = new URL(url);
      // The destination is the path the message already decided to send, never the whole URL — and
      // never the in-app-browser escape: the exit adds it to `/l/<token>` itself (R-B1), so a stored
      // target must not carry it into the post-exchange redirect.
      return await this.linkFor(ctx, stripLineExternalBrowserParam(`${parsed.pathname}${parsed.search}`));
    } catch {
      return null;
    }
  }

  /**
   * `<web>/l/<token>` for one destination PATH, or `null` when the caller must render exactly what
   * it renders without the handoff feature.
   *
   * Public because the walk above binds ONE recipient company to a whole message, and the
   * บริษัทของฉัน picker needs a DIFFERENT company per bubble — `isSafeHandoffPath` rejects bubble
   * B's path against bubble A's company, by design. Callers in that shape mint here instead, and
   * so keep the seam's enabled rule, its degrade-to-plain failure, and its never-log-the-token
   * guarantee rather than re-deriving three rules that must not drift.
   */
  async linkFor(ctx: LineHandoffContext, targetPath: string): Promise<string | null> {
    if (!this.enabled) return null;
    // The web demo chat runs inside a page the visitor is already signed in to: a handoff there would
    // bounce through LINE Login, so it gets the plain link on this web origin.
    if (isWebDemoLineUser(ctx.lineUserId)) return `${this.config.webBaseUrl!.replace(/\/+$/, '')}${stripLineExternalBrowserParam(targetPath)}`;
    try {
      const { rawToken } = await this.mint.execute({
        userId: ctx.userId,
        companyId: ctx.companyId,
        lineUserId: ctx.lineUserId,
        surface: ctx.surface,
        targetPath: stripLineExternalBrowserParam(targetPath),
      });
      return lineHandoffUrl(this.config.webBaseUrl!, rawToken);
    } catch (error) {
      // Degrade to today's behaviour, loudly enough to notice and without naming the token.
      this.logger.warn({ msg: 'line_handoff_mint_failed', surface: ctx.surface, error: (error as Error).message });
      return null;
    }
  }
}
