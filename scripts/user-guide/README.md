# User guide (Word) generator

Builds `docs/user-guide/ERP-User-Guide.docx`: one chapter per demo role with screenshots of every
workspace, menu page, tab and "create" dialog, plus a table of every action button (what it does and
when it is shown).

1. Start the API (:3100) and web (:5180) dev servers with the demo data seeded.
2. Crawl the UI (about 20 min):

   ```sh
   cd apps/e2e
   GUIDE_OUT=/tmp/erp-guide GUIDE_ROLES=superadmin@erp.local,owner@greenwood.demo,... \
     E2E_WORKERS=3 pnpm exec playwright test -c guide/playwright.guide.config.ts
   ```

   The crawler only opens forms/dialogs ("New …", "Add …", "Pay … via UPI") and closes them with
   Escape; it never approves, deletes, saves or submits anything.

3. Build the document (needs `python-docx` and `pillow`, e.g. in a venv):

   ```sh
   python3 scripts/user-guide/build_guide.py /tmp/erp-guide docs/user-guide/ERP-User-Guide.docx scripts/demo/demo-manifest.json
   ```

Open the file in Word and accept "update fields" to fill the table of contents.

## Step-by-step workflow guide

Every button click, field entry and result in the e2e suite can be recorded as a narrated workflow, with the clicked button outlined in red in each screenshot.

```bash
pnpm -C apps/api db:sync-roles
cd apps/e2e && GUIDE_STEPS=/tmp/erp-steps E2E_WORKERS=2 pnpm exec playwright test --reporter=line
cd ../.. && /tmp/guide-venv/bin/python scripts/user-guide/build_guide.py workflows \
  /tmp/erp-steps docs/user-guide/ERP-Workflows-Guide.docx scripts/demo/demo-manifest.json /tmp/erp-guide
```

Capture is off unless `GUIDE_STEPS` is set. The last argument, the crawler output directory, is optional; when given, it maps URLs to menu names. The builder skips failed tests and access-check specs.
