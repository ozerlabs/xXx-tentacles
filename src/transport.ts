/**
 * The posting transport — the one seam between the swarm and the outside world.
 *
 * Everything upstream (interrogate → showrun → write) produces text. A Transport
 * is the only thing that actually puts it on a platform. Swap DryRunTransport for
 * an XApiTransport later and nothing else changes.
 */
export interface PostResult {
  id: string;
  url: string;
}

export interface Transport {
  /** Shown in the CLI so it's obvious whether posts are real. */
  readonly label: string;
  post(text: string): Promise<PostResult>;
}

/**
 * Dry run: pretends to post. No network, no keys. Generates a stable fake id
 * from a counter so the whole pipeline runs end-to-end with nothing wired up.
 */
export class DryRunTransport implements Transport {
  readonly label = "DRY RUN (nothing actually posted)";
  private n = 0;

  async post(_text: string): Promise<PostResult> {
    this.n += 1;
    const id = `dry_${String(this.n).padStart(4, "0")}`;
    return { id, url: `https://x.com/_dryrun/status/${id}` };
  }
}

/**
 * Placeholder for the real thing — Tentacle 3's eventual job once X API
 * credentials exist. Intentionally throws so the seam is visible and `--live`
 * fails loudly instead of silently doing nothing.
 */
export class XApiTransport implements Transport {
  readonly label = "X.com LIVE";
  async post(_text: string): Promise<PostResult> {
    throw new Error("Real X.com posting isn't wired yet. Add X API credentials, then implement XApiTransport.");
  }
}
