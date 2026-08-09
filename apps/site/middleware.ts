import { NextRequest, NextResponse } from "next/server";
import { isLang } from "./lib/i18n";

function preferredLang(req: NextRequest): string {
  const cookie = req.cookies.get("lang")?.value;
  if (cookie && isLang(cookie)) {
    return cookie;
  }
  const header = req.headers.get("accept-language") ?? "";
  for (const part of header.split(",")) {
    const tag = part.split(";")[0].trim().toLowerCase();
    if (tag === "fi" || tag.startsWith("fi-")) {
      return "fi";
    }
    if (tag === "en" || tag.startsWith("en-")) {
      return "en";
    }
  }
  return "en";
}

export function middleware(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = `/${preferredLang(req)}`;
  const res = NextResponse.redirect(url);
  res.headers.set("Vary", "Accept-Language");
  return res;
}

export const config = {
  matcher: ["/"]
};
