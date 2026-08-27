import { useEffect, useState } from "react";
import styles from "./EmployeeProfile.module.css";
import {
  createComment,
  createFeedPost,
  deleteComment,
  deleteFeedPost,
  fetchFeed,
  reactToPost,
  removeReaction,
  REACTION_EMOJI,
  type FeedComment,
  type FeedPost,
  type ReactionEmoji,
} from "../../services/feed/feedClient";
import { avatarIdForEmail } from "../../data/avatarIdentity";
import { SPRITE_SET_BY_AVATAR_ID, characterSprite } from "../../data/bonWalkFrames";
import { PLACEHOLDER_SPRITE_SET } from "../../services/avatar/placeholder";
import { mapAtlasToOfficeStatus, STATUS_META } from "../../services/presence/status";
import type { OfficePerson } from "../../services/office/floorMerge";

export interface EmployeeProfileProps {
  email: string;
  viewerEmail: string;
  roster: OfficePerson[];
  onClose: () => void;
}

function titleCaseLocalpart(email: string): string {
  const local = email.split("@")[0] || email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

function avatarSrcFor(email: string): string {
  const avatarId = avatarIdForEmail(email);
  const set = avatarId ? SPRITE_SET_BY_AVATAR_ID[avatarId] : undefined;
  return characterSprite(set ?? PLACEHOLDER_SPRITE_SET, "idle", "front");
}

function nameFor(email: string, roster: OfficePerson[]): string {
  const person = roster.find((p) => p.email.toLowerCase() === email.toLowerCase());
  return person?.displayName || titleCaseLocalpart(email);
}

// System-generated activity types render a composed sentence from author/target names — the
// backend has no employee-name table (see routers/hub.py's Hub->Feed wiring comment), so name
// resolution happens here, the same place chat/roster rendering already resolves email -> name.
// Adding a new activity type later just means adding one entry here, per the "additional
// activity types can be added later" extensibility goal.
const ACTIVITY_SENTENCE: Partial<Record<FeedPost["type"], (author: string, target: string) => string>> = {
  birthday: (author, target) => `${author} wished ${target} a Happy Birthday! 🎉`,
  congratulation: (author, target) => `${author} congratulated ${target}! 👏`,
  recognition: (author, target) => `${author} recognized ${target}! 🏆`,
};

const ACTIVITY_EMOJI: Partial<Record<FeedPost["type"], string>> = {
  birthday: "🎂",
  recognition: "🏆",
  congratulation: "🏆",
};

function timestampLabel(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface CommentThreadProps {
  postId: string;
  comment: FeedComment;
  roster: OfficePerson[];
  viewerEmail: string;
  onReplySubmit: (postId: string, parentCommentId: string, text: string) => Promise<void>;
  onDelete: (commentId: string) => Promise<void>;
}

function CommentThread({ postId, comment, roster, viewerEmail, onReplySubmit, onDelete }: CommentThreadProps) {
  const [replying, setReplying] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [busy, setBusy] = useState(false);

  async function submitReply() {
    if (!replyText.trim()) return;
    setBusy(true);
    try {
      await onReplySubmit(postId, comment.id, replyText.trim());
      setReplyText("");
      setReplying(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.commentThread}>
      <div className={styles.commentRow}>
        <img className={styles.commentAvatar} src={avatarSrcFor(comment.authorEmail)} alt="" />
        <div className={styles.commentBody}>
          <div className={styles.commentAuthor}>{nameFor(comment.authorEmail, roster)}</div>
          <div className={styles.commentText}>{comment.content}</div>
          <div className={styles.commentActions}>
            <button className={styles.linkButton} onClick={() => setReplying((v) => !v)}>
              Reply
            </button>
            {comment.authorEmail.toLowerCase() === viewerEmail.toLowerCase() && (
              <button className={styles.linkButton} onClick={() => void onDelete(comment.id)}>
                Delete
              </button>
            )}
          </div>
          {replying && (
            <div className={styles.replyComposer}>
              <input
                className={styles.replyInput}
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Write a reply…"
                disabled={busy}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitReply();
                }}
              />
              <button className={styles.smallPrimary} disabled={busy || !replyText.trim()} onClick={() => void submitReply()}>
                Send
              </button>
            </div>
          )}
        </div>
      </div>
      {comment.replies.map((reply) => (
        <div key={reply.id} className={styles.replyRow}>
          <span className={styles.replyArrow}>↳</span>
          <img className={styles.commentAvatar} src={avatarSrcFor(reply.authorEmail)} alt="" />
          <div className={styles.commentBody}>
            <div className={styles.commentAuthor}>{nameFor(reply.authorEmail, roster)}</div>
            <div className={styles.commentText}>{reply.content}</div>
            {reply.authorEmail.toLowerCase() === viewerEmail.toLowerCase() && (
              <button className={styles.linkButton} onClick={() => void onDelete(reply.id)}>
                Delete
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

interface FeedPostCardProps {
  post: FeedPost;
  roster: OfficePerson[];
  viewerEmail: string;
  onUpdate: (post: FeedPost) => void;
  onDeletePost: (postId: string) => void;
}

function FeedPostCard({ post, roster, viewerEmail, onUpdate, onDeletePost }: FeedPostCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [busy, setBusy] = useState(false);

  const totalComments = post.comments.reduce((sum, c) => sum + 1 + c.replies.length, 0);
  const authorName = nameFor(post.authorEmail, roster);
  const targetName = nameFor(post.targetEmail, roster);
  const sentenceTemplate = ACTIVITY_SENTENCE[post.type];

  async function react(emoji: ReactionEmoji) {
    setBusy(true);
    try {
      const updated = post.myReaction === emoji ? await removeReaction(post.id) : await reactToPost(post.id, emoji);
      onUpdate(updated);
    } finally {
      setBusy(false);
    }
  }

  async function submitComment() {
    if (!commentText.trim()) return;
    setBusy(true);
    try {
      const updated = await createComment(post.id, commentText.trim());
      onUpdate(updated);
      setCommentText("");
    } finally {
      setBusy(false);
    }
  }

  async function submitReply(postId: string, parentCommentId: string, text: string) {
    const updated = await createComment(postId, text, parentCommentId);
    onUpdate(updated);
  }

  async function handleDeleteComment(commentId: string) {
    await deleteComment(commentId);
    const updated = await fetchFeed(post.targetEmail);
    const refreshed = updated.find((p) => p.id === post.id);
    if (refreshed) onUpdate(refreshed);
  }

  return (
    <div className={styles.postCard}>
      <div className={styles.postHeader}>
        <img className={styles.postAvatar} src={avatarSrcFor(post.authorEmail)} alt="" />
        <div className={styles.postHeaderText}>
          {sentenceTemplate ? (
            <div className={styles.activitySentence}>
              <span className={styles.activityEmoji}>{ACTIVITY_EMOJI[post.type] ?? ""}</span>{" "}
              {sentenceTemplate(authorName, targetName)}
            </div>
          ) : (
            <>
              <div className={styles.postAuthor}>{authorName}</div>
              <div className={styles.postText}>{post.content}</div>
            </>
          )}
          <div className={styles.postTimestamp}>{timestampLabel(post.createdAt)}</div>
        </div>
        {post.canDelete && (
          <button className={styles.linkButton} onClick={() => void onDeletePost(post.id)}>
            Delete
          </button>
        )}
      </div>

      <div className={styles.reactionRow}>
        {REACTION_EMOJI.map((emoji) => {
          const count = post.reactions.find((r) => r.emoji === emoji)?.count ?? 0;
          const active = post.myReaction === emoji;
          return (
            <button
              key={emoji}
              className={active ? styles.reactionButtonActive : styles.reactionButton}
              disabled={busy}
              onClick={() => void react(emoji)}
              aria-label={`React with ${emoji}`}
            >
              {emoji} {count > 0 ? count : ""}
            </button>
          );
        })}
        <button className={styles.linkButton} onClick={() => setExpanded((v) => !v)}>
          💬 Comment{totalComments > 0 ? ` (${totalComments})` : ""}
        </button>
      </div>

      {expanded && (
        <div className={styles.commentsSection}>
          {post.comments.map((comment) => (
            <CommentThread
              key={comment.id}
              postId={post.id}
              comment={comment}
              roster={roster}
              viewerEmail={viewerEmail}
              onReplySubmit={submitReply}
              onDelete={handleDeleteComment}
            />
          ))}
          <div className={styles.commentComposer}>
            <input
              className={styles.replyInput}
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Write a comment…"
              disabled={busy}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitComment();
              }}
            />
            <button className={styles.smallPrimary} disabled={busy || !commentText.trim()} onClick={() => void submitComment()}>
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function EmployeeProfile({ email, viewerEmail, roster, onClose }: EmployeeProfileProps) {
  const [tab, setTab] = useState<"profile" | "feed">("profile");
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composerText, setComposerText] = useState("");
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchFeed(email)
      .then((data) => {
        if (!cancelled) setPosts(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load feed.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [email]);

  const person = roster.find((p) => p.email.toLowerCase() === email.toLowerCase());
  const name = nameFor(email, roster);
  const officeStatus = person ? mapAtlasToOfficeStatus(person.status) : null;
  const statusMeta = officeStatus ? STATUS_META[officeStatus] : null;
  const hasRecognition = posts.some((p) => p.type === "recognition" || p.type === "congratulation");

  function updatePost(updated: FeedPost) {
    setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  }

  async function handleDeletePost(postId: string) {
    await deleteFeedPost(postId);
    setPosts((prev) => prev.filter((p) => p.id !== postId));
  }

  async function submitPost() {
    if (!composerText.trim()) return;
    setPosting(true);
    try {
      const post = await createFeedPost(email, composerText.trim());
      setPosts((prev) => [post, ...prev]);
      setComposerText("");
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeButton} onClick={onClose} aria-label="Close profile">
          ✕
        </button>

        <div className={styles.header}>
          <img className={styles.avatar} src={avatarSrcFor(email)} alt="" />
          <div className={styles.headerText}>
            <div className={styles.name}>
              {name}
              {hasRecognition && <span className={styles.recognitionBadge}>🏆</span>}
            </div>
            {person?.jobTitle || person?.departmentName ? (
              <div className={styles.role}>{[person?.jobTitle, person?.departmentName].filter(Boolean).join(" · ")}</div>
            ) : (
              <div className={styles.role}>Role unavailable</div>
            )}
            {statusMeta ? (
              <div className={styles.status} style={{ color: statusMeta.color }}>
                {statusMeta.emoji} {statusMeta.label}
              </div>
            ) : (
              <div className={styles.status}>Status unavailable</div>
            )}
          </div>
        </div>

        <div className={styles.tabs}>
          <button
            className={tab === "profile" ? styles.tabActive : styles.tab}
            onClick={() => setTab("profile")}
          >
            Profile
          </button>
          <button className={tab === "feed" ? styles.tabActive : styles.tab} onClick={() => setTab("feed")}>
            Feed
          </button>
        </div>

        <div className={styles.body}>
          {tab === "profile" && (
            <div className={styles.profileInfo}>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Email</span>
                <span>{email}</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Role</span>
                <span>{person?.jobTitle || "—"}</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Team</span>
                <span>{person?.departmentName || "—"}</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Status</span>
                <span>{statusMeta?.label ?? "Unavailable"}</span>
              </div>
              {hasRecognition && (
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>Recognition</span>
                  <span>🏆 Recently recognized — see Feed</span>
                </div>
              )}
            </div>
          )}

          {tab === "feed" && (
            <div className={styles.feedTab}>
              <div className={styles.composer}>
                <input
                  className={styles.composerInput}
                  value={composerText}
                  onChange={(e) => setComposerText(e.target.value)}
                  placeholder={`Write something on ${name}'s feed…`}
                  disabled={posting}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submitPost();
                  }}
                />
                <button
                  className={styles.smallPrimary}
                  disabled={posting || !composerText.trim()}
                  onClick={() => void submitPost()}
                >
                  Post
                </button>
              </div>

              {loading && <div className={styles.empty}>Loading feed…</div>}
              {error && <div className={styles.errorBanner}>{error}</div>}
              {!loading && !error && posts.length === 0 && (
                <div className={styles.empty}>No activity yet.</div>
              )}
              {posts.map((post) => (
                <FeedPostCard
                  key={post.id}
                  post={post}
                  roster={roster}
                  viewerEmail={viewerEmail}
                  onUpdate={updatePost}
                  onDeletePost={handleDeletePost}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default EmployeeProfile;
