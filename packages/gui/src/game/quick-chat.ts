// The quick chat: seven lines a player says with two clicks (game/QuickChat.tsx), in a game against bots too. Each is shown
// to everyone in their own language ("xxx 发送了：你好。", online/ChatNotice.tsx) and said by the sender's leader, from the
// sound files each person has (public/audio/cards/<leader>-<line>, resources/sound.ts); online it is a chat line as well.
// Blocking it (Settings.blockQuickChat) turns it off for this person, and online for everyone in their games: their program
// says so in "hello", and the other player's quick chat is off then too.
import type { PlayerId } from "@sve/core";
import { useSyncExternalStore } from "react";
import { getSettings } from "../app/settings";
import { getApp } from "../app/store";
import type { GameUpdate } from "../engine/protocol";
import type { QuickChatId } from "../net/messages";
import { sendQuickChat, type OnlineState } from "../net/state";
import { playLeaderVoice } from "../resources/sound";

/** A quick chat line said: by which seat's player, which line, and a count (the same line said again shows again). */
export interface QuickChatSaid {
  seq: number;
  seat: PlayerId;
  quick: QuickChatId;
}

let said: QuickChatSaid | null = null;
let count = 0;
const listeners = new Set<() => void>();

/**
 * Whether the quick chat is off in this game: this person blocks it, or (an online game, connected) the other player does.
 * `online`: the online state, for an online game only.
 */
export function quickChatBlocked(blockQuickChat: boolean, online: OnlineState | null): boolean {
  return blockQuickChat || (online !== null && online.phase.kind === "connected" && online.phase.peer?.noQuickChat === true);
}

/**
 * A quick chat line has been said (here, or heard from the other program): it shows, and the sender's leader says it. Not
 * when it is off here (a line on its way while it was being turned off).
 */
export function quickChatSaid(seat: PlayerId, quick: QuickChatId, online: OnlineState | null = null): void {
  const update = getApp().update;
  if (!update || quickChatBlocked(getSettings().blockQuickChat, update.online ? online : null)) return;
  said = { seq: ++count, seat, quick };
  for (const listener of listeners) listener();
  playLeaderVoice(update, seat, quick);
}

/**
 * A quick chat line heard over the connection (from the other player, or a spectator's from the host): said by `seat`'s
 * player of the online game, so only while that game is the one shown — else (a game against bots after it, a replay, no
 * game yet) it stays a line of the chat.
 */
export function quickChatHeard(seat: PlayerId, quick: QuickChatId, online: OnlineState): void {
  const update = getApp().update;
  if (update?.online && online.game && update.seed === online.game.id) quickChatSaid(seat, quick, online);
}

/**
 * This person says a quick chat line (`text`: its words in their language): online, to the other program too (as their seat's
 * player); else as the player at the screen.
 */
export function sayQuickChat(update: GameUpdate, quick: QuickChatId, text: string, online: OnlineState | null): void {
  if (update.online) {
    const seat = update.online.seat;
    if (seat === null || !sendQuickChat(quick, text)) return;
    quickChatSaid(seat, quick, online);
  } else quickChatSaid(update.perspective, quick);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The last quick chat line said (null: none yet). */
export function useQuickChatSaid(): QuickChatSaid | null {
  return useSyncExternalStore(subscribe, () => said);
}
