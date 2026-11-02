/*
 * Wilma's own forms, read the way a browser without scripts would send them:
 * the fields Wilma filled in (its form key, the recipient, the day), checked
 * boxes, each select's chosen option, and no submit button until one is
 * picked. Writes send these and add only what the parent wrote.
 */
import type { CheerioAPI, Cheerio, load } from "cheerio";

/** A parsed node (domhandler's AnyNode, without depending on domhandler). */
export type AnyNode = Extract<Parameters<typeof load>[0], { type: unknown }>;

export interface WilmaForm {
  /** Where the form posts: a path on this Wilma. */
  action: string;
  /** Name/value pairs a browser would send, without any submit button. */
  fields: [string, string][];
  /** The form's submit buttons, in page order. */
  buttons: { name: string; value: string; label: string }[];
  selects: { name: string; options: { value: string; label: string; selected: boolean }[] }[];
  textareas: string[];
  /** The form's checkboxes, ticked or not (`fields` has only the ticked ones, as a browser sends them). */
  checkboxes?: { name: string; value: string; checked: boolean }[];
}

export class FormOutsideWilmaError extends Error {
  constructor() {
    super("Wilma's form points outside Wilma; nothing was sent");
    this.name = "FormOutsideWilmaError";
  }
}

/** A path on this Wilma for a link or form action on a page at `pageUrl`. */
export function wilmaPath(href: string, pageUrl: string): string {
  const page = new URL(pageUrl);
  const url = new URL(href || pageUrl, pageUrl);
  if (url.origin !== page.origin) throw new FormOutsideWilmaError();
  return url.pathname + url.search;
}

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

export function readForm($: CheerioAPI, form: Cheerio<AnyNode>, pageUrl: string): WilmaForm {
  const fields: [string, string][] = [];
  const buttons: WilmaForm["buttons"] = [];
  const selects: WilmaForm["selects"] = [];
  const textareas: string[] = [];
  const checkboxes: NonNullable<WilmaForm["checkboxes"]> = [];
  form.find("input, select, textarea, button").each((_, el) => {
    const control = $(el);
    const name = control.attr("name");
    if (!name || control.attr("disabled") !== undefined) return;
    const tag = (el as { tagName?: string }).tagName?.toLowerCase();
    if (tag === "select") {
      const options = control
        .find("option")
        .map((_, o) => ({
          value: $(o).attr("value") ?? clean($(o).text()),
          label: clean($(o).text()),
          selected: $(o).attr("selected") !== undefined,
        }))
        .get();
      selects.push({ name, options });
      const chosen = options.find((o) => o.selected) ?? (control.attr("multiple") === undefined ? options[0] : undefined);
      if (chosen) fields.push([name, chosen.value]);
      return;
    }
    if (tag === "textarea") {
      textareas.push(name);
      fields.push([name, control.text()]);
      return;
    }
    const type = (control.attr("type") ?? (tag === "button" ? "submit" : "text")).toLowerCase();
    const value = control.attr("value") ?? "";
    if (type === "submit" || type === "image") {
      buttons.push({ name, value, label: clean(control.text()) || value });
    } else if (type === "checkbox" || type === "radio") {
      const checked = control.attr("checked") !== undefined;
      if (type === "checkbox") checkboxes.push({ name, value: control.attr("value") ?? "on", checked });
      if (checked) fields.push([name, control.attr("value") ?? "on"]);
    } else if (type !== "file" && type !== "reset" && type !== "button") {
      fields.push([name, value]);
    }
  });
  return { action: wilmaPath(form.attr("action") ?? "", pageUrl), fields, buttons, selects, textareas, checkboxes };
}

/** The form key on a page (Wilma's anti-forgery token), preferring one outside the logout form. */
export function pageFormkey($: CheerioAPI): string | null {
  const keys = $('input[name="formkey"]')
    .filter((_, el) => $(el).closest("#logout-form").length === 0)
    .map((_, el) => $(el).attr("value") ?? "")
    .get()
    .filter(Boolean);
  return keys[0] ?? ($('#logout-form input[name="formkey"]').attr("value") || null);
}

/** Set a field's value, replacing every earlier value of that name (or adding it). */
export function setField(fields: [string, string][], name: string, value: string): [string, string][] {
  const out = fields.filter(([n]) => n !== name);
  const at = fields.findIndex(([n]) => n === name);
  out.splice(at === -1 ? out.length : at, 0, [name, value]);
  return out;
}

/** The text of Wilma's error messages on a page (after a refused form), if any. */
export function pageErrors($: CheerioAPI): string | null {
  const text = $(".alert-danger, .alert-error, .has-error .help-block, .error-message")
    .map((_, el) => clean($(el).text()))
    .get()
    .filter(Boolean)
    .join(" ");
  return text ? text.slice(0, 300) : null;
}

/** Wilma's success and info notices on a page, one string each. */
export function pageNotices($: CheerioAPI): string[] {
  return $(".alert-success, .alert-info, .notification-success")
    .map((_, el) => clean($(el).text()))
    .get()
    .filter(Boolean);
}
