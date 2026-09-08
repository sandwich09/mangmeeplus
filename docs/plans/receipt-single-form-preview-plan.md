# Receipt single form and detailed LINE summary plan

1. Verify the current two-form render and source/financial save contracts; identify shared receipt formatter and recovery callers.
2. Select exactly one editor from source completeness and existing permissions. Restore the normal review layout for readable receipts, including purpose/category resolution; keep partial saves and the original image for unreadable receipts.
3. Remove raw question fallback from web labels and replace long initial missing lists with concise, accessible field guidance.
4. Restore seven receipt summary facts in initial/recovered LINE replies without restarting draft questions; test shared rendering/fallback output.
5. Run focused model, component, API and browser checks. Inspect local screenshots, record evidence and limitations in task memory. Capture owner-review evidence before deployment.

Completed locally: all five steps. The ordinary review form now includes purpose and item category inputs, staged rows without a financial counterpart, and one shared save function. Scoped source references/removals prevent same-named items or deleted staged rows from reappearing after review. Browser acceptance passed at 390px and 1280px, including real API save/reload. Owner screenshot review was accepted; UAT release preparation is now authorized. Production remains held.

6. Owner approved the preview: rename the explicit financial-review action to “บันทึกแบบร่าง” and gate it to step 1 / DRAFT; verify save/reload, other-status omission and navigation. Refresh screenshots, merge reviewed CI-passing code into develop/main, then deploy UAT through the canonical protocol. Record candidate/controller, UAT/auto READY IDs, signed evidence and customer OPEN acceptance. Do not deploy Production.

7. Owner follow-ups: audit dropdown theme (including the partial editor), replace the remaining native category select with the shared themed control, retain disabled authority and add accessible item labels. Add explicit draft-save success toast and truthful refresh-failure warning. Verify browser popup bounds/theme, API validation/permission/conflict/server/network errors and saved-but-readback-failed behavior.
