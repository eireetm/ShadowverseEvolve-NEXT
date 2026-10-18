// Importing the player's resources from a zip file (the Android and iOS apps): where each file of the zip goes in
// public/. Pure: tested without a phone (test/android.test.ts).

/** The folders of public/ a zip may fill (README "Custom resources"; text: the player's card texts), and its style sheet. */
const FOLDERS = ["audio", "images", "textures", "fonts", "text"];

const isResource = (parts: readonly string[]): boolean =>
  (parts.length === 1 && parts[0] === "theme.css") || (parts.length > 1 && FOLDERS.includes(parts[0]!));

/**
 * The public/ path of a zip entry ("images/cards/BP01-001.png"), or null when it isn't a resource:
 *  - a whole "public" folder — the PC release's, zipped as it is (a pack someone made, 2026-10-18) — goes in as it is, all of
 *    it, under however many folders around it ("SVEN-0.4.1-pc/public/...", "Public/...");
 *  - else the resource folders themselves, or one folder around them ("MyPack/images/...").
 * Folders, hidden files and macOS's "__MACOSX" copies are not resources; nothing may climb out ("..").
 */
export function resourcePathInZip(name: string): string | null {
  if (name.endsWith("/") || name.endsWith("\\")) return null;
  const parts = name
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part !== "" && part !== ".");
  if (parts.some((part) => part === ".." || part.startsWith(".") || part === "__MACOSX")) return null;
  const inPublic = parts.findIndex((part) => part.toLowerCase() === "public");
  if (inPublic >= 0) return inPublic < parts.length - 1 ? parts.slice(inPublic + 1).join("/") : null;
  const inside = isResource(parts) ? parts : parts.length > 1 && isResource(parts.slice(1)) ? parts.slice(1) : null;
  return inside ? inside.join("/") : null;
}
