import * as cheerio from "cheerio";

export interface StudentInfo {
  studentNumber: string;
  name: string;
  href: string;
}

const NAV_KEYWORDS = [
  "messages",
  "viestit",
  "schedule",
  "lukujärjestys",
  "gradebook",
  "assessments",
  "exams",
  "attendance",
  "poissaolot",
  "printouts",
  "news",
];

const STUDENT_HREF_RE = /\/!(\d+)(?:\/|$)/;

export function studentNumberFromHref(href: string): string | null {
  const match = STUDENT_HREF_RE.exec(href);
  return match ? match[1] : null;
}

function isPasswdAccountRole(type: unknown): boolean {
  return type === "passwd" || type === 7 || type === "7";
}

function studentNumberFromSlug(slug: string): string | null {
  const trimmed = slug.trim();
  if (!trimmed) {
    return null;
  }
  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return studentNumberFromHref(withSlash);
}

export function parseStudentFromUrl(url: string): StudentInfo | null {
  const studentNumber = studentNumberFromHref(url);
  if (!studentNumber) {
    return null;
  }
  return {
    studentNumber,
    name: studentNumber,
    href: `/!${studentNumber}/`,
  };
}

function roleType(rec: Record<string, unknown>): unknown {
  return rec.Type ?? rec.type ?? rec.RoleType ?? rec.roleType;
}

function roleName(rec: Record<string, unknown>, fallback: string): string {
  return String(rec.Name ?? rec.name ?? rec.Caption ?? rec.caption ?? fallback);
}

function collectStudent(
  students: Map<string, StudentInfo>,
  studentNumber: string,
  name: string
): void {
  if (!students.has(studentNumber)) {
    students.set(studentNumber, {
      studentNumber,
      name,
      href: `/!${studentNumber}/`,
    });
  }
}

/**
 * Parse GET /api/v1/accounts/me/roles.
 * Accepts `{ payload: AccountRole[] }` or a raw array.
 * Skips the account itself (`type === "passwd"` / type 7). Guardian (and other
 * non-passwd) roles contribute a student from `slug` + `name`.
 */
export function parseStudentsFromAccountsRoles(data: unknown): StudentInfo[] {
  const students = new Map<string, StudentInfo>();

  let roles: unknown[] = [];
  if (Array.isArray(data)) {
    roles = data;
  } else if (data && typeof data === "object") {
    const rec = data as Record<string, unknown>;
    const payload = rec.payload ?? rec.Payload;
    if (Array.isArray(payload)) {
      roles = payload;
    }
  }

  for (const item of roles) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const rec = item as Record<string, unknown>;
    if (isPasswdAccountRole(roleType(rec))) {
      continue;
    }
    const slug = String(rec.slug ?? rec.Slug ?? "");
    const studentNumber = studentNumberFromSlug(slug);
    if (!studentNumber) {
      continue;
    }
    const name = roleName(rec, studentNumber);
    if (!name) {
      continue;
    }
    collectStudent(students, studentNumber, name);
  }

  return [...students.values()];
}

export function parseStudentsFromHome(html: string, pageUrl?: string): StudentInfo[] {
  const $ = cheerio.load(html);
  const named = new Map<string, StudentInfo>();
  const fromHref = new Map<string, StudentInfo>();

  $("a[href]").each((_, anchor) => {
    const href = $(anchor).attr("href") ?? "";
    const studentNumber = studentNumberFromHref(href);
    if (!studentNumber) {
      return;
    }

    fromHref.set(studentNumber, {
      studentNumber,
      name: studentNumber,
      href,
    });

    const cloned = $(anchor).clone();
    cloned.find("small, span.lem").remove();
    const text = cloned.text().trim();
    if (!text) {
      return;
    }

    const lower = text.toLowerCase();
    if (NAV_KEYWORDS.some((kw) => lower.includes(kw))) {
      return;
    }

    if (!named.has(studentNumber)) {
      named.set(studentNumber, {
        studentNumber,
        name: text,
        href,
      });
    }
  });

  if (named.size > 0) {
    return [...named.values()];
  }

  if (fromHref.size > 0) {
    return [...fromHref.values()];
  }

  if (pageUrl) {
    const fromUrl = parseStudentFromUrl(pageUrl);
    if (fromUrl) {
      return [fromUrl];
    }
  }

  return [];
}
