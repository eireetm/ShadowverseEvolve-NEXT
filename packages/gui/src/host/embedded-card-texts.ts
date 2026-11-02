// The complete card texts built into the program: the private PC release's (scripts/release-pc.ts puts in the files of the
// machine that builds it), and no other build's: they aren't in the repository, and the program on GitHub has none. A module
// of its own, so that they are a file of their own, loaded when the texts are read (api.ts), not with the page.

declare const __EMBEDDED_CARD_TEXTS__: string;

/** The text files (core/data/set-file.ts), unchecked JSON; none where the build didn't put any in. */
export const EMBEDDED_CARD_TEXTS: unknown[] = typeof __EMBEDDED_CARD_TEXTS__ === "string" ? (JSON.parse(__EMBEDDED_CARD_TEXTS__) as unknown[]) : [];
