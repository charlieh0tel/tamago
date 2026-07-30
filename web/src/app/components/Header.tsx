// Header strip: identity and global actions only -- brand, repo link,
// tool-version chip, and the copy-design-link button.
//
// It used to carry status chips for tuning state, achieved sense, and the loop-B
// connection. Each of those had a better home: the numbers belong to the results
// summary, the connection is a build step and belongs to the cut sheet and the
// schematic (which draws the crossover), and freshness belongs to the stale
// banner, which explains itself and offers the fix. See docs/web-ux.md.

import { VERSION_LABEL } from "../version";

const REPO_URL = "https://github.com/charlieh0tel/tamago";

// Balloon whisk in the same stroked line art as the feed schematics: a tapered
// handle at the lower left and four wires bowing into a long teardrop at the
// upper right, the way the antenna stands -- loops up, mast below. Decorative;
// the brand text alongside already names the thing.
//
// The wire cubics share their along-axis control fractions (0.30 and 0.72) and
// differ only in how far they bow off it, which is what puts the widest part of
// the teardrop past the midpoint instead of at it.
function WhiskMark(): JSX.Element {
  return (
    <svg className="whisk" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {/* Tapered handle: up one side, across the ferrule, back down the other. */}
      <path d="M2.4 19.4 L10.2 12.2 L11.8 13.8 L4.6 21.6 Z" />
      {/* Wires, ferrule to a common tip, two bows per side. */}
      <path d="M11 13 C16.1 12.1 21.9 9.5 21 3" />
      <path d="M11 13 C11.9 7.9 14.5 2.1 21 3" />
      <path d="M11 13 C14.9 10.9 19.9 7.5 21 3" />
      <path d="M11 13 C13.1 9.1 16.5 4.1 21 3" />
    </svg>
  );
}

export function Header({ onCopyLink }: { onCopyLink: () => void }): JSX.Element {
  return (
    <header>
      <span className="brand">
        <WhiskMark />
        tamago awadateki
        <span className="jp" lang="ja">
          卵泡立て器
        </span>
        <span className="jp">Egg Beater</span>
      </span>
      <a
        className="chip repo"
        href={REPO_URL}
        target="_blank"
        rel="noreferrer noopener"
      >
        charlieh0tel/tamago
      </a>
      <span className="chip ver" title="tool version">
        {VERSION_LABEL}
      </span>
      <span className="spacer" />
      <button type="button" className="linkbtn" onClick={onCopyLink}>
        copy design link
      </button>
    </header>
  );
}
