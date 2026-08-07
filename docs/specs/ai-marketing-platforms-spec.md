# AI Marketing Platforms Spec

## Status

Roadmap backlog. Canonical reference: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 23.

Deferred until owner explicitly pulls it back into active implementation. This item does not block item 24.

## 1. Goal

Support AI-assisted marketing for SME sales channels such as Shopee, TikTok, Facebook, and later Lazada by generating campaign suggestions and content drafts from trusted business data.

Marketplace/platform integrations are not MVP. This spec stays as later-phase direction; AI content drafting can be introduced before direct platform APIs if useful.

## 2. Non-goals

- Auto-posting or changing campaigns without approval in MVP
- Direct marketplace/platform API integration in MVP
- Replacing platform policy review
- Guaranteeing ad performance
- Managing every platform-specific ad setting in the first phase

## 3. User Roles

- Owner: asks what to promote and why
- Marketing: generates captions, hashtags, scripts, and campaign drafts
- Sales: requests campaign ideas for target customers
- Inventory: receives promotion warnings when stock is low
- AI assistant user: chats with AI Marketing

## 4. Business Workflow

1. User asks AI Marketing for campaign idea or platform content.
2. AI checks product, stock, sales trend, margin, customer segment, and channel history.
3. AI proposes platform-specific draft.
4. User edits and approves.
5. External posting/integration is manual or approval-gated.

## 5. Business Rules

- AI must not promote products with insufficient stock unless warning is shown.
- AI should consider margin, inventory, seasonality, and sales trend.
- Platform drafts must identify target platform and content type.
- User approval is required before any external mutation.
- Imported marketplace data must be permission-controlled.

## 6. Platform Scope

- Shopee: product promotion idea, bundle suggestion, marketplace order/sales summary later.
- TikTok: caption, hashtag, short video script, live selling talking points.
- Facebook: post copy, page content, ad angle, retargeting idea.
- Lazada: optional later integration similar to Shopee.

## 7. Data Model Draft

- MarketingCampaignDraft: platform, productId, objective, content, status
- PlatformAccount: platform, accountName, connectionStatus
- ChannelSalesSummary: platform, period, productId, units, revenue
- ContentVariant: campaignId, format, caption, hashtags, script
- ApprovalRequest: sourceType, sourceId, status, approverId

## 8. UI Behavior

### LINE

- AI Marketing chat for campaign ideas and short summaries.
- Alert when sales trend or stock suggests a campaign opportunity.
- Deep links to web campaign draft/detail pages.

### Web Admin

- Campaign library.
- Draft editing and approval.
- Platform connection settings.
- Channel performance reports.
- Approval and publishing workflow later.

## 9. Edge Cases

- Platform API unavailable.
- Product stock is low.
- Product has missing description or image.
- Platform policy may reject claim or wording.

## 10. Acceptance Criteria

- [ ] AI can draft TikTok caption, hashtags, and video script.
- [ ] AI can draft Facebook post copy.
- [ ] AI can suggest Shopee promotion direction.
- [ ] Drafts are not auto-posted without approval.
- [ ] AI warns when stock or data is insufficient.

## 11. Test Cases

- Low-stock product returns warning with campaign draft.
- User without marketing permission cannot access campaign drafts.
- Draft creation logs source data and user.
- External publish action requires approval flag.

## 12. Open Questions

- Which platform API should be integrated first when marketplace phase starts?
- Should content generation support Thai-first tone presets?
- Should paid ads management be in scope or content-only MVP?
