"use client";

import { useEffect, useRef } from "react";
import { Globe2, MessageCircle, Share2, ThumbsUp, X } from "lucide-react";
import "./facebook-post-preview.css";

export type PreviewPost = {
  title: string;
  caption: string;
  mediaUrl: string;
  kind: "image" | "video";
};

export type FacebookPreview =
  | { source: "draft"; post: PreviewPost }
  | {
      source: "activity";
      post: PreviewPost;
      status: "queued" | "simulated";
      scheduledAt: string;
    };

export function FacebookPostPreview({
  preview,
  onClose,
}: {
  preview: FacebookPreview;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLButtonElement>(".fb-preview-close")?.focus();
    }
  }, []);

  const activity = preview.source === "activity";
  const statusText = activity
    ? preview.status === "simulated"
      ? "Simulated locally"
      : "Scheduled locally"
    : "Draft";
  const scheduledDate = activity ? new Date(preview.scheduledAt) : null;
  const validDate = scheduledDate && !Number.isNaN(scheduledDate.getTime());

  return (
    <dialog
      ref={dialogRef}
      className="fb-preview-dialog"
      aria-labelledby="fb-preview-heading"
      aria-describedby="fb-preview-disclosure"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
    >
      <div className="fb-preview-shell">
        <header className="fb-preview-heading-row">
          <div>
            <p className="fb-preview-eyebrow">POST HOUSE / FACEBOOK</p>
            <h2 id="fb-preview-heading">Feed preview</h2>
          </div>
          <button
            type="button"
            className="fb-preview-close"
            aria-label="Close feed preview"
            onClick={() => dialogRef.current?.close()}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <p id="fb-preview-disclosure" className="fb-preview-disclosure">
          Local preview only. This post is not on Facebook.
        </p>

        <div className="fb-preview-context">
          <div className="fb-preview-context-text">
            <span className="fb-preview-status">{statusText}</span>
            <span className="fb-preview-post-title">{preview.post.title}</span>
          </div>
          {activity && (
            <span className="fb-preview-schedule">
              {validDate ? (
                <time dateTime={preview.scheduledAt}>
                  {scheduledDate.toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </time>
              ) : (
                preview.scheduledAt
              )}
            </span>
          )}
        </div>

        <div className="fb-preview-canvas">
          <article className="fb-preview-card" aria-label="Facebook-style post preview">
            <div className="fb-preview-author">
              <span className="fb-preview-avatar" aria-hidden="true"><img src="/brand/post-house-mark.svg" alt="" /></span>
              <div className="fb-preview-author-copy">
                <strong>Your Facebook Page</strong>
                <span>Preview <span aria-hidden="true">·</span> <Globe2 size={12} aria-label="Public-style audience icon" /></span>
              </div>
            </div>

            <p className="fb-preview-caption">{preview.post.caption}</p>

            <div className="fb-preview-media">
              {preview.post.kind === "video" ? (
                <video src={preview.post.mediaUrl} controls playsInline preload="metadata" aria-label="Post video" />
              ) : (
                // The generated artwork is content, so its title is the useful text alternative.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview.post.mediaUrl} alt={preview.post.title} />
              )}
            </div>

            <div className="fb-preview-actions" aria-hidden="true">
              <span><ThumbsUp size={17} /> Like</span>
              <span><MessageCircle size={17} /> Comment</span>
              <span><Share2 size={17} /> Share</span>
            </div>
          </article>
        </div>

        <p className="fb-preview-footnote">
          {activity
            ? "The caption above is the saved post text, including its tracked link when present."
            : "A tracked product link is added to the caption when you schedule this draft."}
        </p>
      </div>
    </dialog>
  );
}
