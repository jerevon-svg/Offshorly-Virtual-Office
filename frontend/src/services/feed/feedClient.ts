import { getAuthToken } from "../api/client";

// REST client for Employee Feed V1 (backend/app/routers/feed.py, backend/app/repositories/
// feed.py). Same "chat backend" REST base (VITE_CHAT_SOCKET_URL) as hubClient.ts/
// requestsClient.ts — the Feed lives in the same FastAPI app as chat/requests/hub, not on
// Atlas. No socket — a profile panel fetches its feed on open, same as the Hub.

export type FeedPostType = "post" | "birthday" | "recognition" | "congratulation";
export const REACTION_EMOJI = ["❤️", "👏", "🎉", "🔥", "🙌"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJI)[number];

export interface FeedComment {
  id: string;
  postId: string;
  parentCommentId: string | null;
  authorEmail: string;
  content: string;
  createdAt: string;
  replies: FeedComment[];
}

export interface ReactionSummary {
  emoji: string;
  count: number;
}

export interface FeedPost {
  id: string;
  targetEmail: string;
  authorEmail: string;
  type: FeedPostType;
  content: string;
  createdAt: string;
  reactions: ReactionSummary[];
  myReaction: string | null;
  comments: FeedComment[];
  canDelete: boolean;
}

function socketBase(): string {
  const raw = import.meta.env.VITE_CHAT_SOCKET_URL;
  if (!raw) {
    throw new Error(
      "VITE_CHAT_SOCKET_URL is not set. Required for the Employee Feed feature — see .env.example.",
    );
  }
  return raw.replace(/\/+$/, "");
}

// DEV-ONLY: mirrors hubClient.ts's/requestsClient.ts's devEmail/setDevIdentity exactly.
let devEmail: string | null = null;

export function setDevIdentity(email: string | null): void {
  devEmail = email ? email.trim().toLowerCase() : null;
}

async function restFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (devEmail) {
    headers.set("x-dev-email", devEmail);
  } else {
    const token = getAuthToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${socketBase()}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || body?.detail || `Feed backend request failed (${res.status}) for ${path}`);
  }
  return res;
}

export async function fetchFeed(targetEmail: string): Promise<FeedPost[]> {
  const res = await restFetch(`/feed/${encodeURIComponent(targetEmail)}`);
  return res.json();
}

export async function createFeedPost(targetEmail: string, content: string): Promise<FeedPost> {
  const res = await restFetch(`/feed/${encodeURIComponent(targetEmail)}/posts`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
  return res.json();
}

export async function deleteFeedPost(postId: string): Promise<void> {
  await restFetch(`/feed/posts/${encodeURIComponent(postId)}`, { method: "DELETE" });
}

export async function reactToPost(postId: string, emoji: ReactionEmoji): Promise<FeedPost> {
  const res = await restFetch(`/feed/posts/${encodeURIComponent(postId)}/react`, {
    method: "POST",
    body: JSON.stringify({ emoji }),
  });
  return res.json();
}

export async function removeReaction(postId: string): Promise<FeedPost> {
  const res = await restFetch(`/feed/posts/${encodeURIComponent(postId)}/react`, {
    method: "DELETE",
  });
  return res.json();
}

export async function createComment(
  postId: string,
  content: string,
  parentCommentId?: string,
): Promise<FeedPost> {
  const res = await restFetch(`/feed/posts/${encodeURIComponent(postId)}/comments`, {
    method: "POST",
    body: JSON.stringify({ content, parentCommentId: parentCommentId ?? null }),
  });
  return res.json();
}

export async function deleteComment(commentId: string): Promise<void> {
  await restFetch(`/feed/comments/${encodeURIComponent(commentId)}`, { method: "DELETE" });
}

// Test-only: module state (devEmail) outlives a single test.
export function resetFeedClientForTests(): void {
  devEmail = null;
}
