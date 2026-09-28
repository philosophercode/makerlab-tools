"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { siteConfig } from "../lib/site-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "./system/Field";
import { Markdown } from "./system/Markdown";
import { Prose, PublicPage } from "./system/PublicPage";
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
 * What the form knows about who is submitting.
 *
 * Three states, not two, because `/api/identity` has three answers: a signed-in
 * identity, the anonymous identity (a normal 200), and *no answer at all* — a
 * 429 from the identity tier (120/min), or a dropped connection on lab wifi.
 * `fetchIdentity` resolves the last of those to `null`, which is why `null`
 * here means "could not ask" and never "signed out": an anonymous visitor comes
 * back as `{ role: "anonymous" }`. Collapsing the two would tell a signed-in
 * student they are signed out — an assertion the form has no evidence for, and
 * one the server would contradict if they posted anyway (Article 4).
 */
type IdentityStatus = "pending" | "answered" | "unavailable";

/** How many of a submission's photos actually landed, as the route reports it. */
interface PhotoOutcome {
  submitted: number;
  attached: number;
}

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
  // the sign-in prompt in place of the form. `status` is what tells the three
  // answers apart — showing the prompt to somebody who *is* signed in, either
  // for the half-second before the fetch lands or because the fetch never
  // landed, would be the most annoying possible bug here.
  const [identity, setIdentity] = useState<ClientIdentity | null>(null);
  const [status, setStatus] = useState<IdentityStatus>("pending");
  // Bumped by "Try again". A failed identity fetch is the one state here the
  // visitor can do something about, so it gets a way to do it rather than a
  // dead end that only a reload escapes.
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);

  const [toolQuery, setToolQuery] = useState("");
  const [uploading, setUploading] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [photoOutcome, setPhotoOutcome] = useState<PhotoOutcome | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    fetchIdentity(controller.signal).then((answer) => {
      if (!active) return;
      setIdentity(answer);
      // `null` is "no answer", not "anonymous" — see IdentityStatus.
      setStatus(answer ? "answered" : "unavailable");
      setRetrying(false);
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [attempt]);

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
          // A photo picked while signed out — routine now that an unreachable
          // `/api/identity` leaves the form up rather than the sign-in wall.
          // The route answers in English; every other string on this page is in
          // the reader's language, so the translated one wins here too.
          if (res.status === 401) throw new Error(t("signInRequiredError"));
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
        // 401 is its own sentence, in the visitor's language (Article 6): it
        // means the session ended — or never resolved, when the identity fetch
        // failed and the form rendered optimistically — and "sign in, then
        // submit again" is advice the route's English prose does not give.
        if (res.status === 401) throw new Error(t("signInRequiredError"));
        throw new Error(data?.error || t("submitError"));
      }

      // The route reports how many of the photo ids actually attached, because
      // an upload nobody claimed is deleted after 24 hours and a form left open
      // overnight submits ids that no longer name anything. Thanking a student
      // for a write-up whose pictures were silently dropped is the kind of
      // quiet lie Article 4 exists to forbid, so the confirmation says it.
      const data = (await res.json().catch(() => null)) as
        | { photosSubmitted?: number; photosAttached?: number }
        | null;
      if (
        typeof data?.photosSubmitted === "number" &&
        typeof data.photosAttached === "number"
      ) {
        setPhotoOutcome({
          submitted: data.photosSubmitted,
          attached: data.photosAttached,
        });
      }

      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("submitError"));
    } finally {
      setSubmitting(false);
    }
  }

  const crumbs = [{ label: t("breadcrumbProjects"), href: "/projects" }, { label: t("breadcrumbNew") }];

  if (submitted) {
    return (
      <PublicPage width="narrow" crumbs={crumbs} title={t("thanksTitle")}>
        <Prose className="pt-2">
          <p>{t("thanksBody")}</p>
        </Prose>
        {photoOutcome && photoOutcome.attached < photoOutcome.submitted ? (
          <p data-slot="form-error" className="pt-3 text-sm text-bad" role="alert">
            {photoOutcome.attached === 0 ? t("thanksPhotosNone") : t("thanksPhotosSome")}
          </p>
        ) : null}
        <div className="pt-6">
          <Button asChild variant="default">
            <Link href="/projects">{t("backToGallery")}</Link>
          </Button>
        </div>
      </PublicPage>
    );
  }

  // Anonymous, and we know it — `status === "answered"` is the part that makes
  // it knowledge rather than a guess: the prompt replaces the form (spec §5.5,
  // §6). Deliberately not a redirect to sign-in — the visitor asked for this
  // page, and a header control they can use without losing their place is a
  // better answer than a bounce. Browsing the gallery stays open to them.
  if (status === "answered" && !signedIn) {
    return (
      <PublicPage width="narrow" crumbs={crumbs} title={t("signInTitle")}>
        <Prose className="pt-2">
          <p>{t("signInBody", { institution: siteConfig.institution })}</p>
        </Prose>
        <div className="pt-6">
          <Button asChild variant="outline">
            <Link href="/projects">{t("signInBrowse")}</Link>
          </Button>
        </div>
      </PublicPage>
    );
  }

  return (
    <PublicPage crumbs={crumbs} title={t("title")} lede={t("lede", { institution: siteConfig.institution })}>
      <form className="flex w-full max-w-[640px] min-w-0 flex-col gap-5 pt-4" onSubmit={handleSubmit}>
        {/* The identity endpoint could not answer — a 429 from its 120/min tier,
            or a connection that dropped. The form stays open rather than
            claiming the visitor is signed out: the server is the authority on
            that and would accept a signed-in student's post. What the page owes
            them is the truth about what it does not know, and a way to ask
            again (Article 4). */}
        {status === "unavailable" ? (
          <div className="flex flex-wrap items-center gap-3 border-s-2 border-s-warn ps-3" role="status">
            <p className="text-sm">{t("identityUnknown")}</p>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setRetrying(true);
                setAttempt((n) => n + 1);
              }}
              disabled={retrying}
            >
              {retrying ? t("identityChecking") : t("identityRetry")}
            </Button>
          </div>
        ) : null}

        <Field id="project-title" label={t("titleLabel")}>
          <Input
            id="project-title"
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
            required
          />
        </Field>

        {/* The byline, not a field. It is the session's display name and the
            server writes it whatever the request says, so offering an input
            would be offering a choice that is not there. */}
        {verifiedName ? (
          <p className="text-sm text-muted-foreground" id={AUTHOR_NOTE_ID}>
            {t("authorNote", { name: verifiedName })} {t("authorFromAccount", { institution: siteConfig.institution })}
          </p>
        ) : null}

        <Field id="project-body" label={t("bodyLabel")}>
          <Textarea
            id="project-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={10}
            placeholder={t("bodyPlaceholder")}
            required
          />
        </Field>

        {body.trim() ? (
          <div className="flex flex-col gap-1 border-s-2 border-s-border ps-3">
            <span className="font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase">{t("previewLabel")}</span>
            <Markdown className="text-sm">{body}</Markdown>
          </div>
        ) : null}

        <Field id="project-photos" label={t("photosLabel")}>
          <input
            id="project-photos"
            type="file"
            accept="image/*"
            multiple
            className="text-sm file:me-3 file:h-8 file:cursor-pointer file:border file:border-border file:bg-transparent file:px-3 file:font-mono file:text-label file:uppercase"
            onChange={(event) => {
              void handleFiles(event.target.files);
              event.target.value = "";
            }}
          />
          {uploading > 0 ? <p className="text-xs text-muted-foreground">{t("uploading")}</p> : null}
          {photos.length > 0 ? (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {photos.map((photo) => (
                <li key={photo.id} className="flex items-center justify-between gap-2 border-b border-rule py-1 text-sm">
                  <span className="min-w-0 truncate">{photo.name}</span>
                  <Button type="button" size="xs" variant="ghost" onClick={() => removePhoto(photo.id)}>
                    {t("removePhoto")}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </Field>

        <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="mb-1 font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase">{t("toolsLabel")}</legend>
          <Input
            type="search"
            value={toolQuery}
            aria-label={t("toolsSearch")}
            onChange={(event) => setToolQuery(event.target.value)}
            placeholder={t("toolsSearch")}
          />
          <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto">
            {filteredTools.slice(0, 60).map((tool) => {
              const on = selectedTools.includes(tool.id);
              return (
                <Button
                  key={tool.id}
                  type="button"
                  size="xs"
                  variant={on ? "outline" : "quiet"}
                  className={on ? "border-primary-ink" : undefined}
                  aria-pressed={on}
                  onClick={() => toggleTool(tool.id)}
                >
                  {tool.name}
                </Button>
              );
            })}
          </div>
        </fieldset>

        <Field id="project-materials" label={t("materialsLabel")}>
          <Input
            id="project-materials"
            type="text"
            value={materials}
            onChange={(event) => setMaterials(event.target.value)}
            placeholder={t("materialsPlaceholder")}
          />
        </Field>

        <Field id="project-link" label={t("linkLabel")}>
          <Input
            id="project-link"
            type="url"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder="https://"
          />
        </Field>

        {error ? (
          <p data-slot="form-error" className="text-sm text-bad" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="default" disabled={submitting || uploading > 0}>
            {submitting ? t("submitting") : t("submit")}
          </Button>
          <Button asChild>
            <Link href="/projects">{t("cancel")}</Link>
          </Button>
        </div>
      </form>
    </PublicPage>
  );
}
