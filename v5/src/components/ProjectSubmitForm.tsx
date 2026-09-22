"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { siteConfig } from "../lib/site-config";
import {
  fetchIdentity,
  isSignedIn,
  type ClientIdentity,
} from "../lib/auth/sign-in-client";

interface ToolOption {
  id: string;
  name: string;
}

interface ProjectSubmitFormProps {
  tools: ToolOption[];
}

interface UploadedPhoto {
  /** `attachments.id` from `POST /api/uploads` — a Postgres uuid. */
  id: string;
  name: string;
}

/** Ties the read-only byline to the note explaining where the name came from. */
const AUTHOR_NOTE_ID = "project-author-note";

/**
 * The display name of a signed-in identity, or "" for anyone else — including a
 * signed-in account Google gave no name for, which is indistinguishable from
 * anonymous as far as the byline is concerned.
 */
function nameOf(identity: ClientIdentity | null): string {
  return isSignedIn(identity) ? (identity?.name || "").trim() : "";
}

export function ProjectSubmitForm({ tools }: ProjectSubmitFormProps) {
  const t = useTranslations("projectForm");

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [materials, setMaterials] = useState("");
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);

  // Who is submitting is request state, and this form renders inside a
  // statically-shelled layout — so it asks after mount, exactly as the header
  // does (auth spec §6). Since Phase 4 the answer decides what renders at all:
  // submitting requires an account (spec §5.5), so an anonymous visitor gets
  // the sign-in prompt in place of the form. `resolved` is what tells "not
  // signed in" apart from "has not answered yet" — showing the prompt to
  // somebody who *is* signed in, for the half-second before the fetch lands,
  // would be the most annoying possible bug here.
  const [identity, setIdentity] = useState<ClientIdentity | null>(null);
  const [resolved, setResolved] = useState(false);

  const [toolQuery, setToolQuery] = useState("");
  const [uploading, setUploading] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    fetchIdentity(controller.signal).then((answer) => {
      if (!active) return;
      setIdentity(answer);
      setResolved(true);
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  const signedIn = isSignedIn(identity);
  const verifiedName = nameOf(identity);

  const filteredTools = toolQuery.trim()
    ? tools.filter((tool) =>
        tool.name.toLowerCase().includes(toolQuery.trim().toLowerCase())
      )
    : tools;

  function toggleTool(id: string) {
    setSelectedTools((prev) =>
      prev.includes(id) ? prev.filter((toolId) => toolId !== id) : [...prev, id]
    );
  }

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setError(null);
    const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) {
      setError(t("onlyImages"));
      return;
    }

    setUploading((n) => n + files.length);
    await Promise.all(
      files.map(async (file) => {
        try {
          const form = new FormData();
          form.append("file", file);
          form.append("kind", "project");
          const res = await fetch("/api/uploads", {
            method: "POST",
            body: form,
          });
          if (res.status === 503) {
            // No Blob store is configured, so there is nowhere to keep the
            // photo. The form stays submittable: a project write-up without
            // pictures is still worth having (Article 4).
            throw new Error(t("uploadsUnavailable"));
          }
          if (!res.ok) {
            const data = (await res.json().catch(() => null)) as
              | { error?: string }
              | null;
            throw new Error(data?.error || t("uploadFailed"));
          }
          // `attachmentId` is an `attachments` row; the submission claims it.
          const data = (await res.json()) as {
            attachmentId: string;
            name: string;
          };
          setPhotos((prev) => [...prev, { id: data.attachmentId, name: data.name }]);
        } catch (err) {
          setError(err instanceof Error ? err.message : t("uploadFailed"));
        } finally {
          setUploading((n) => Math.max(0, n - 1));
        }
      })
    );
  }

  function removePhoto(id: string) {
    setPhotos((prev) => prev.filter((photo) => photo.id !== id));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!title.trim() || !body.trim()) {
      setError(t("requiredError"));
      return;
    }

    setSubmitting(true);
    try {
      const materialList = materials
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // No `author`: the route takes the byline from the session and
          // ignores anything sent here (spec §5.5).
          title: title.trim(),
          body: body.trim(),
          link: link.trim() || undefined,
          tools: selectedTools,
          materials: materialList,
          photos,
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error || t("submitError"));
      }

      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("submitError"));
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <main className="tool-detail">
        <section className="td-panel td-prose">
          <p className="td-eyebrow">{t("eyebrow")}</p>
          <h1>{t("thanksTitle")}</h1>
          <p>{t("thanksBody")}</p>
          <div className="td-prose-actions">
            <Link className="td-button td-button-primary" href="/projects">
              {t("backToGallery")}
            </Link>
          </div>
        </section>
      </main>
    );
  }

  // Anonymous, and we know it: the prompt replaces the form (spec §5.5, §6).
  // Deliberately not a redirect to sign-in — the visitor asked for this page,
  // and a header control they can use without losing their place is a better
  // answer than a bounce. Browsing the gallery stays open to them.
  if (resolved && !signedIn) {
    return (
      <main className="tool-detail">
        <section className="td-panel td-prose project-sign-in">
          <p className="td-eyebrow">{t("eyebrow")}</p>
          <h1>{t("signInTitle")}</h1>
          <p>{t("signInBody", { institution: siteConfig.institution })}</p>
          <div className="td-prose-actions">
            <Link className="td-button td-button-primary" href="/projects">
              {t("signInBrowse")}
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="tool-detail">
      <div className="td-breadcrumbs">
        <div>
          <Link href="/projects">{t("breadcrumbProjects")}</Link>
          <span aria-hidden="true">›</span>
          <span>{t("breadcrumbNew")}</span>
        </div>
      </div>

      <form className="td-panel project-form" onSubmit={handleSubmit}>
        <p className="td-eyebrow">{t("eyebrow")}</p>
        <h1>{t("title")}</h1>
        <p className="project-form-lede">
          {t("lede", { institution: siteConfig.institution })}
        </p>

        <label className="project-field">
          <span>{t("titleLabel")}</span>
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
            required
          />
        </label>

        {/* The byline, not a field. It is the session's display name and the
            server writes it whatever the request says, so offering an input
            would be offering a choice that is not there. */}
        {verifiedName ? (
          <p className="project-form-note" id={AUTHOR_NOTE_ID}>
            {t("authorNote", { name: verifiedName })}{" "}
            {t("authorFromAccount", { institution: siteConfig.institution })}
          </p>
        ) : null}

        <label className="project-field">
          <span>{t("bodyLabel")}</span>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={10}
            placeholder={t("bodyPlaceholder")}
            required
          />
        </label>

        {body.trim() ? (
          <div className="project-preview">
            <span className="td-eyebrow">{t("previewLabel")}</span>
            <div className="chat-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
            </div>
          </div>
        ) : null}

        <fieldset className="project-field">
          <legend>{t("photosLabel")}</legend>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => {
              void handleFiles(event.target.files);
              event.target.value = "";
            }}
          />
          {uploading > 0 ? (
            <p className="project-form-note">{t("uploading")}</p>
          ) : null}
          {photos.length > 0 ? (
            <ul className="project-photo-list">
              {photos.map((photo) => (
                <li key={photo.id}>
                  <span>{photo.name}</span>
                  <button
                    type="button"
                    className="chip"
                    onClick={() => removePhoto(photo.id)}
                  >
                    {t("removePhoto")}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </fieldset>

        <fieldset className="project-field">
          <legend>{t("toolsLabel")}</legend>
          <input
            type="text"
            value={toolQuery}
            onChange={(event) => setToolQuery(event.target.value)}
            placeholder={t("toolsSearch")}
          />
          <div className="chip-row project-tool-options">
            {filteredTools.slice(0, 60).map((tool) => (
              <button
                key={tool.id}
                type="button"
                className={selectedTools.includes(tool.id) ? "chip chip-active" : "chip"}
                aria-pressed={selectedTools.includes(tool.id)}
                onClick={() => toggleTool(tool.id)}
              >
                {tool.name}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="project-field">
          <span>{t("materialsLabel")}</span>
          <input
            type="text"
            value={materials}
            onChange={(event) => setMaterials(event.target.value)}
            placeholder={t("materialsPlaceholder")}
          />
        </label>

        <label className="project-field">
          <span>{t("linkLabel")}</span>
          <input
            type="url"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder="https://"
          />
        </label>

        {error ? (
          <p className="project-form-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="td-prose-actions">
          <button
            type="submit"
            className="td-button td-button-primary"
            disabled={submitting || uploading > 0}
          >
            {submitting ? t("submitting") : t("submit")}
          </button>
          <Link className="td-button" href="/projects">
            {t("cancel")}
          </Link>
        </div>
      </form>
    </main>
  );
}
