import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Reuse the approved review mascot; the API's existing SWC --copy-files build retains this PNG.
export const PACKAGE_ADVISOR_MASCOT_DATA_URI = `data:image/png;base64,${readFileSync(
  join(__dirname, 'line-package-advisor-mascot.png'),
).toString('base64')}`;
