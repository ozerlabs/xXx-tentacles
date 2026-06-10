/**
 * `npm run x:login` — sign in to X by hand, once. Saves the session for every
 * later read-only crawl. See session.ts for why we don't automate the form.
 */
import { login } from "./session.js";

login().catch((err) => {
  console.error(`\n✗ ${err.message}\n`);
  process.exit(1);
});
