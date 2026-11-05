"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type {
  FindPhotoOptionsResult,
  LoadPhotoOptionsResult,
} from "../../app/admin/inventory/photo-option-result";
import { PHOTO_NOTE_MAX_CHARS } from "../../lib/photo-options/candidates";
import { cleanReviewerNote } from "../../lib/intake/reviewer-note";
import {
  PHOTO_SEARCH_POLL_MS,
  photoOptionHost,
  type PhotoOption,
  type PhotoSearchView,
} from "../../lib/photo-options/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "../system/Field";
import { ReviewNote } from "../system/review/ReviewCard";

/**
 * **Photo options** in the tool editor's Photos section (photo options spec
 * 2026-10-29 §5): for a tool whose photo is the wrong machine, a busy room or
 * a shop's listing, ask for better ones and pick.
 *
 * - **Find photo options**, with an optional note, starts a background search
 *   (one item of today's research allowance). The section polls the tool's
 *   latest search every few seconds while it runs; a panel closed meanwhile
 *   finds the result when it opens again.
 * - **The options are tiles**, one native radio each, best first as the
 *   ranking ordered them — the maker's own clean pictures first. Each says
 *   where it is from and carries tags for what to watch: "Manufacturer",
 *   "Plain background", "Banner", "Back view", "Detail". Pictures load from
 *   their own hosts in the admin's browser with no referrer; nothing is
 *   fetched or stored until one is used.
 * - **Use as cover** downloads the chosen picture, removes its background
 *   (unless unticked) and makes it the cover; "Replace the current cover"
 *   (on by default) removes the old one. The panel then re-reads the photos.
 * - **Find more options** asks again: pictures already offered are left out.
 */

export interface PhotoOptionsProps {
  toolId: string;
  name: string;
  /** Whether the tool has a cover now — the replace checkbox only means something then. */
  hasCover: boolean;
  /** The panel is writing; the section waits. */
  pending: boolean;
  /** The tool's latest search, by id. A stable function: the panel's action, not a closure. */
  load: (toolId: string) => Promise<LoadPhotoOptionsResult>;
  onFind: (note: string | null) => Promise<FindPhotoOptionsResult>;
  /** Make an option the cover. Answers whether it landed (the panel's status line says why not). */
  onPick: (choice: { searchId: string; url: string; removeBackground: boolean; replaceCover: boolean }) => Promise<boolean>;
}

export function PhotoOptions({ toolId, name, hasCover, pending, load, onFind, onPick }: PhotoOptionsProps) {
  const t = useTranslations("admin.inventory.editor.photoOptions");
  const tErrors = useTranslations("admin.errors");
  const [search, setSearch] = useState<PhotoSearchView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [removeBackground, setRemoveBackground] = useState(true);
  const [replaceCover, setReplaceCover] = useState(true);
  const [picking, setPicking] = useState(false);

  const refresh = useCallback(async () => {
    const result = await load(toolId);
    if (result.ok) setSearch(result.search);
    setLoaded(true);
  }, [load, toolId]);

  // The latest search on open: a result that landed while the panel was closed shows at once.
  useEffect(() => {
    let cancelled = false;
    void load(toolId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setSearch(result.search);
        if (result.search && (result.search.running || result.search.status === "ready")) setOpen(true);
      }
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [load, toolId]);

  const running = search?.running ?? false;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void refresh(), PHOTO_SEARCH_POLL_MS);
    return () => clearInterval(timer);
  }, [running, refresh]);

  async function find() {
    setStarting(true);
    setError(null);
    try {
      const result = await onFind(cleanReviewerNote(note) || null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSelected(null);
      await refresh();
    } catch {
      setError("failed");
    } finally {
      setStarting(false);
    }
  }

  async function pick() {
    if (!search || !selected) return;
    setPicking(true);
    try {
      const landed = await onPick({ searchId: search.id, url: selected, removeBackground, replaceCover: hasCover && replaceCover });
      if (landed) {
        setSelected(null);
        await refresh();
      }
    } finally {
      setPicking(false);
    }
  }

  if (!loaded) return null;

  if (!open) {
    return (
      <div data-slot="photo-options" className="ui flex flex-col gap-1.5 border-t border-rule pt-2">
        <ReviewNote>{t("lede")}</ReviewNote>
        <Button size="sm" variant="outline" className="self-start" onClick={() => setOpen(true)}>
          {t("open")}
        </Button>
      </div>
    );
  }

  const options = search?.status === "ready" ? search.options : [];
  const noteId = `photo-options-note-${toolId}`;
  const group = `photo-options-${toolId}`;
  const busy = pending || picking || starting;

  return (
    <div data-slot="photo-options" className="ui flex flex-col gap-2 border-t border-rule pt-2">
      <h5 className="m-0 text-sm font-semibold">{t("title")}</h5>
      <ReviewNote>{t("hint")}</ReviewNote>

      {options.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t("title")}>
          {options.map((option, index) => (
            <OptionTile
              key={option.url}
              group={group}
              index={index}
              option={option}
              name={name}
              checked={selected === option.url}
              current={search?.chosenUrl === option.url}
              disabled={busy}
              onSelect={() => setSelected(option.url)}
            />
          ))}
        </div>
      ) : null}

      {selected ? (
        <div className="flex flex-col gap-1.5 text-table">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={removeBackground}
              disabled={busy}
              onChange={(event) => setRemoveBackground(event.target.checked)}
            />
            {t("removeBackground")}
          </label>
          {hasCover ? (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={replaceCover}
                disabled={busy}
                onChange={(event) => setReplaceCover(event.target.checked)}
              />
              {t("replaceCover")}
            </label>
          ) : null}
          <Button size="sm" className="self-start" disabled={busy} onClick={() => void pick()}>
            {picking ? t("using") : t("use")}
          </Button>
        </div>
      ) : null}

      <Field id={noteId} label={t("note")}>
        <Textarea
          id={noteId}
          rows={2}
          maxLength={PHOTO_NOTE_MAX_CHARS}
          placeholder={t("notePlaceholder")}
          value={note}
          disabled={running || busy}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>
      <Button size="sm" variant="outline" className="self-start" disabled={running || busy} onClick={() => void find()}>
        {search ? t("findMore") : t("find")}
      </Button>

      <ReviewNote role="status" tone={error || (!running && search?.status === "failed") ? "bad" : "muted"}>
        {starting ? t("starting") : null}
        {!starting && running ? t("running") : null}
        {!starting && !running && error ? tErrors(error) : null}
        {!starting && !running && !error && search?.status === "failed" ? t("failed", { reason: search.error ?? "" }) : null}
        {!starting && !running && !error && search?.status === "ready" && options.length > 0 ? t("ready", { count: options.length }) : null}
      </ReviewNote>
    </div>
  );
}

/** The tags a tile carries: what is good about it, and what to watch for. */
function optionTags(option: PhotoOption): ("manufacturer" | "plain" | "banner" | "back" | "detail" | "side")[] {
  const tags: ("manufacturer" | "plain" | "banner" | "back" | "detail" | "side")[] = [];
  if (option.manufacturer) tags.push("manufacturer");
  if (option.background === "plain" || option.background === "transparent") tags.push("plain");
  if (option.composite) tags.push("banner");
  if (option.view === "back") tags.push("back");
  if (option.view === "detail") tags.push("detail");
  if (option.view === "side") tags.push("side");
  return tags;
}

function OptionTile({
  group,
  index,
  option,
  name,
  checked,
  current,
  disabled,
  onSelect,
}: {
  group: string;
  index: number;
  option: PhotoOption;
  name: string;
  checked: boolean;
  current: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations("admin.inventory.editor.photoOptions");
  const id = `${group}-${index + 1}`;
  const host = photoOptionHost(option);
  const href = option.pageUrl ?? option.url;
  return (
    <div
      data-slot="photo-option"
      data-selected={checked || undefined}
      className={cn(
        "flex min-w-0 flex-col gap-1 border border-border bg-muted p-1.5",
        checked && "border-primary-ink outline-1 -outline-offset-2 outline-primary-ink outline-solid",
        disabled && "opacity-60"
      )}
    >
      <div className="flex flex-wrap items-center gap-1 text-table">
        <input
          id={id}
          type="radio"
          name={group}
          value={option.url}
          className="size-4 accent-primary"
          checked={checked}
          disabled={disabled}
          onChange={onSelect}
        />
        <label htmlFor={id}>{t("option", { number: index + 1 })}</label>
        {current ? <Badge>{t("tags.current")}</Badge> : null}
      </div>
      {/* The picture selects too, for a pointer; the radio is the keyboard's way in. */}
      <div
        className={cn(
          "flex aspect-square items-center justify-center overflow-hidden bg-card [&_img]:block [&_img]:h-auto [&_img]:max-h-full [&_img]:w-auto [&_img]:max-w-full [&_img]:object-contain",
          disabled ? "cursor-default" : "cursor-pointer"
        )}
        onClick={disabled ? undefined : onSelect}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- an arbitrary host the search found; loaded by the admin's browser, never proxied */}
        <img
          src={option.url}
          alt={t("alt", { name, number: index + 1 })}
          width={option.width}
          height={option.height}
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      </div>
      <div className="flex flex-wrap gap-1">
        {optionTags(option).map((tag) => (
          <Badge key={tag} variant="outline">
            {t(`tags.${tag}`)}
          </Badge>
        ))}
      </div>
      {option.reason ? <p className="m-0 text-xs text-muted-foreground">{option.reason}</p> : null}
      {host ? (
        <a
          className="text-xs break-all text-primary-ink underline-offset-2 hover:underline"
          href={href}
          target="_blank"
          rel="noreferrer noopener"
        >
          {t("from", { host })}
        </a>
      ) : null}
    </div>
  );
}
