# Visual Asset Spec: LINE Rich Menu V2 (versioned / Ver1)

## 1. Status

- **PRODUCTION BITMAP CREATED — LINE Console activation and device UAT pending.**
- Date: 2026-08-21
- Parent behavior spec: [[specs/line-rich-menu-v2-spec|LINE Rich Menu V2 Spec]]
- Source reference: owner-provided `Ver1.png`, exactly `2500 x 1686 px`.
- Production bitmap: `apps/web/public/assets/line/mangmeeplus-line-rich-menu-v2-ver1-2500x1686.png`.
- Scope: the versioned static image and area manifest attached to the six-action employee LINE rich menu.
- The reference contains a drawn bottom `เมนู` bar. The production bitmap replaces that strip with the surrounding deep-green field and does not stretch or distort the retained artwork.

## 2. Output contract

| Property | Required value |
|---|---|
| Canvas | `2500 x 1686 px` |
| Aspect ratio | `1.4828:1` |
| Layout | Asymmetric `Ver1`: 2 top areas + 4 bottom areas |
| Production format | PNG preferred; JPEG allowed only if needed to stay within size limit |
| Color space | sRGB |
| Background | Opaque; no transparent outer corners |
| Maximum upload size | LINE limit 1 MB; project target `< 950 KB` |
| Profile ID | `line-rich-menu-v2-ver1` |
| Production filename | `mangmeeplus-line-rich-menu-v2-ver1-2500x1686.png` |
| Editable master | Figma, SVG, or equivalent layered source |

LINE currently accepts JPEG or PNG rich-menu images, width 800–2500 px, height at least 250 px, aspect ratio at least 1.45, and file size no greater than 1 MB. The 2500x1686 large template is the canonical size used for this design. Source: [LINE Messaging API reference](https://developers.line.biz/en/reference/messaging-api/nojs/).

## 3. Grid and tappable bounds

Artwork and Messaging API bounds must use the same integer grid. There must be no gap or overlap between areas.

| Area | Menu | x | y | width | height |
|---|---|---:|---:|---:|---:|
| A | บริษัทของฉัน (`หน้าหลัก` heading) | 0 | 0 | 1667 | 843 |
| B | ถ่ายใบเสร็จ | 1667 | 0 | 833 | 843 |
| C | คุยกับน้องมั่งมี | 0 | 843 | 625 | 843 |
| D | สรุปค่าใช้จ่าย | 625 | 843 | 625 | 843 |
| E | เริ่มต้นใช้งานฟรี | 1250 | 843 | 625 | 843 |
| F | ติดต่อเรา | 1875 | 843 | 625 | 843 |

The visible raised cards may be inset to create green gutters, but tappable bounds remain the six contiguous cells above. Shadows, rounded corners, and the smaller `หน้าหลัก` header shape do not create extra actions. Artwork and the Messaging API manifest must make the cell ownership unambiguous.

## 4. Exact visible copy

Use Thai labels only. Do not add English subtitles; they become too small on mobile and repeat the action label.

1. Area A heading: `หน้าหลัก`
2. Area A action label: `บริษัทของฉัน`
3. Area B: `ถ่ายใบเสร็จ`
4. Area C: `คุยกับน้องมั่งมี`
5. Area D: `สรุปค่าใช้จ่าย`
6. Area E: `เริ่มต้นใช้งานฟรี`
7. Area F: `ติดต่อเรา`

`หน้าหลัก` is informational copy inside Area A, not a seventh tappable area.

Do not place any of the following in the bitmap:

- company name, user name, role, feature list, email, phone number, or URL;
- pricing, package name, discount percentage, or disabled-feature upsell; `FREE` is allowed only as supporting art inside the approved `เริ่มต้นใช้งานฟรี` tile;
- a drawn `Menu ▼` or chat bar — LINE renders its own `chatBarText` outside the image;
- instructions such as “แตะที่นี่”, arrows, badges, notification counts, or changing status.

The bitmap must stay static while the cards behind it remain dynamic.

## 5. Visual direction

Use the owner-provided `Ver1.png` as the current composition and trend-skin reference:

- friendly Thai SME product, clean and trustworthy rather than corporate-heavy;
- deep green field with raised white rounded cards and warm brown/orange Thai labels;
- a large company hero, a separate receipt tile, and four balanced lower cards;
- soft 3D button depth with one consistent lighting direction and shadow density;
- simple silhouettes that remain recognizable when the full image is displayed at phone width;
- no photography, photorealistic hands/devices, casino/gold-coin treatment, or unrelated stock illustration styles.

The dog artwork may be reproduced in the production asset only when its source and commercial-use rights are recorded. Otherwise recreate the functions with an approved น้องมั่งมี mascot master or licensed icon-led illustrations; do not trace an unknown third-party character. Keep one consistent mascot construction across all areas.

Trend-driven future skins may change the palette, illustration treatment, or surface style. Each must receive a new profile ID and freeze its actual palette, fonts, asset licenses, and checksum in the editable master and manifest. A trend refresh must not silently change action meaning.

## 6. Brand tokens

Use repository tokens as the default brand baseline. The `Ver1` production master may freeze owner-approved skin colors sampled from the reference, but must record their exact sRGB values before export.

| Use | Token/value |
|---|---|
| Default light background | Page background `#F6F8F5` |
| Default soft-green background | Brand 50 `#ECFDF3` |
| Primary text | `#1A2E22` |
| Secondary text/detail | `#475467` |
| Primary green | Brand 500 `#22C55E` |
| Deep green | Brand 900 `#14532D` |
| Highlight gold | Gold 500 `#F59E0B` |
| Dividers | Border `#E3EBE5` |
| White surfaces | `#FFFFFF` |
| Ver1 field | Owner-approved deep green sampled and frozen in the master before export |
| Ver1 title | Owner-approved warm brown/orange sampled and frozen in the master before export |

Rules:

- The Ver1 deep-green field may be a full background; white remains the card surface.
- Titles use the approved warm brown/orange on white only after the final contrast check.
- Do not use white text on bright brand green for small labels.
- Keep each action distinct through its label and illustration, not through six unrelated background colors.

## 7. Typography

- Thai: `IBM Plex Sans Thai`, weight 700 for labels.
- Latin fallback, if required by asset metadata only: `Outfit`.
- Label size on the 2500px master: target `64–72 px`; never below `60 px`.
- One line per label when possible. Reduce within the approved minimum before wrapping.
- Center alignment; no letter spacing on Thai.
- Keep titles at least 64px from tile edges and 72px above the tile bottom.
- Convert fonts to outlines only in the final portable SVG/export copy; retain editable text in the design master.

## 8. Tile illustration briefs

All illustrations share the same line weight, corner softness, shadow density, light direction, and perspective.

| Area | Required visual idea | Avoid |
|---|---|---|
| A บริษัทของฉัน | Large friendly office/building, growth chart, and approved mascot; `หน้าหลัก` is a small header tab | Specific company logo/name or a separate action implied by the header |
| B ถ่ายใบเสร็จ | Phone/camera framing a paper receipt | Implying the receipt is already approved or paid |
| C คุยกับน้องมั่งมี | Chat bubble plus assistant/phone gesture; approved mascot optional | Human customer-service stock photo |
| D สรุปค่าใช้จ่าย | Expense sheet with bar/pie summary and calculator | Dense dashboard numbers or real financial data |
| E เริ่มต้นใช้งานฟรี | Welcoming gift/onboarding gesture; `FREE` badge is allowed | A price, discount, package promise, or guaranteed entitlement |
| F ติดต่อเรา | Headset or phone with one clear contact gesture | Email address, phone number, social badges |

Illustration sizing:

- Area A may use a hero illustration up to approximately `760 x 560 px`.
- Areas B–F target a maximum illustration box of approximately `420 x 420 px`.
- Keep the optical center below the title/header zone and away from neighboring cells.
- Keep at least 72px clear of dividers and outer canvas edges.
- no fine detail thinner than 8px on the master.

## 9. Tile composition

Area A uses a large hero surface with a smaller raised `หน้าหลัก` header tab and a separate `บริษัทของฉัน` action label inside the same surface. Area B uses a tall card. Areas C–F use four equal lower cards. All six surfaces share corner radius, border depth, shadow direction, illustration line weight, and title hierarchy.

Rounded cards may sit inside their action cells with consistent gutters. Do not draw an overlapping surface that makes one area look tappable as another area. The whole rectangular cell remains the actual tap target.

## 10. Safe area and accessibility

- Keep all critical artwork and text at least 64px inside each tile.
- Keep 72px clear around the relevant cell edges: top split `x=1667`, bottom splits `x=625`, `x=1250`, `x=1875`, and row split `y=843`.
- Maintain at least WCAG AA-like text contrast (`4.5:1`) even though the image itself is not HTML.
- Icons must support, not replace, the Thai label.
- Avoid relying on red/green distinction alone.
- Do not put text over gradients, glow, or illustration shadows.
- Action objects must carry matching accessibility labels from the parent behavior spec.

### 10.1 Remove the drawn LINE menu bar

- Remove the entire bright-green bottom strip, the word `เมนู`, and both triangle symbols from the reference.
- Keep the `2500 x 1686 px` canvas. Replace the complete strip with the exact surrounding deep-green field; do not crop, vertically stretch, scale, or redraw the retained cards and mascot artwork.
- LINE's `chatBarText` is configured as UI metadata outside the bitmap. It may change independently and must never be baked into a trend skin.

## 11. Deliverables

Required:

1. owner-provided editable/source artwork or equivalent source record;
2. production image `mangmeeplus-line-rich-menu-v2-ver1-2500x1686.png` under 950 KB and without the drawn bottom menu bar;
3. one LINE iOS and one LINE Android screenshot for rollout evidence;
4. six-area coordinate/action manifest matching §3 and the parent behavior spec, including profile ID, image SHA-256, stable behavior IDs, accessibility labels, and rollback profile ID;
5. font and icon/illustration source/license notes retained by the owner.

Do not overwrite the existing `2500x843` staff-menu assets. V2 is a new large image and must be reviewable beside the old assets until deployment is accepted.

## 12. Visual acceptance criteria

- [x] IMG-1 Export is exactly 2500x1686 px, opaque PNG, and below 950 KB.
- [x] IMG-2 All seven visible text strings are exact and correctly spelled; they map to six actions because `หน้าหลัก` is only the Area A heading.
- [ ] IMG-3 Artwork boundaries match the six tap bounds with no visual ambiguity, gap, or overlap.
- [ ] IMG-4 All labels remain readable in a phone-width preview without zooming.
- [ ] IMG-5 Icons remain distinguishable in grayscale and at phone size.
- [x] IMG-6 No dynamic data, contact detail, pricing, or drawn LINE chat bar appears in the bitmap; `FREE` appears only inside the approved free-start illustration.
- [ ] IMG-7 Colors, typography, raised surfaces, shadows, and mascot treatment match the approved `Ver1` skin and are recorded in the editable master.
- [ ] IMG-8 No unlicensed third-party logo, mascot, icon, or traced reference artwork is used.
- [x] IMG-9 The exported image and repository area manifest pass automated size, format, checksum, coverage, overlap, and action-mapping validation; LINE Console validation remains part of rollout.
- [ ] IMG-10 Current LINE iOS and Android screenshots show no crop, blur, text collision, or misleading tap boundary.
- [x] IMG-11 The production image replaces the reference chat bar with the surrounding field; no vertical stretching or character distortion is visible.
- [ ] IMG-12 The manifest records an immutable profile ID, image checksum, and behavior mapping. The rollback target must be recorded before activation.

## 13. Non-goals

- No redesign of the owner-provided Ver1 artwork.
- No animation, tab switching, or per-user image variant. Trend and seasonal skins are allowed only as separately reviewed, versioned profiles.
- No redesign of the result cards behind each shortcut.

## 14. Open questions

No product-design questions. LINE Console activation still requires recording the currently active rich menu as the rollback target and completing the device evidence in §11.
