/* Swedish for data. Keys are the English text exactly as in t(). */
export const SV_DATA: Record<string, string> = {
  // feed.ts: tasks and agenda
  "Explain in Wilma": "Red ut i Wilma",
  "Wilma shows this absence as unexplained until a guardian explains it.": "Wilma visar frånvaron som outredd tills en vårdnadshavare reder ut den.",
  "Sign up": "Anmäl dig",
  "The school asks you to sign up.": "Skolan ber dig att anmäla dig.",
  "The school asks you to sign up today.": "Skolan ber dig att anmäla dig i dag.",
  "The school asks you to sign up by tomorrow.": "Skolan ber dig att anmäla dig senast i morgon.",
  "The school asks you to sign up by {date}.": "Skolan ber dig att anmäla dig senast {date}.",
  "The school asks you to sign up, by {time} today.": "Skolan ber dig att anmäla dig senast kl. {time} i dag.",
  "The school asks you to sign up, by {time} tomorrow.": "Skolan ber dig att anmäla dig senast kl. {time} i morgon.",
  "The school asks you to sign up, by {date} {time}.": "Skolan ber dig att anmäla dig senast {date} kl. {time}.",
  "(no subject)": "(inget ämne)",
  "Sent by you, no reply yet": "Skickat av dig, inget svar än",
  "Sent by you": "Skickat av dig",
  "To {names}, no reply yet": "Till {names}, inget svar än",
  "To {names}": "Till {names}",
  "Signed up": "Anmäld",
  "Sign up: {title}": "Anmäl dig: {title}",
  "{title} (sign-up ends)": "{title} (anmälningstiden går ut)",

  // engine.ts: signing in
  "Wilma didn't accept that code. Check the code in your authenticator app.": "Wilma godkände inte koden. Kontrollera koden i din autentiseringsapp.",
  "Wilma didn't accept that username and password.": "Wilma godkände inte användarnamnet och lösenordet.",
  "{error} Sign in again with your password.": "{error} Logga in igen med ditt lösenord.",
  "Wilma didn't accept that code. Type the newest code from your authenticator app.": "Wilma godkände inte koden. Skriv in den senaste koden från din autentiseringsapp.",
  "Wilma ended the session. Sign in again to refresh; everything already here stays.": "Wilma avslutade sessionen. Logga in igen för att uppdatera. Allt som redan finns här sparas.",

  // engine.ts: sync steps
  "Checking Wilma": "Kontrollerar Wilma",
  "Read {name}'s Wilma": "Har läst Wilma för {name}",
  "Reading new messages and bulletins": "Läser nya meddelanden och nyheter",

  // engine.ts: invitations, the sample family, sending
  "Open the invitation first.": "Öppna inbjudan först.",
  "Sample family: signed up here only.": "Exempelfamilj: anmälan gjordes bara här.",
  "Sample family: answered here only.": "Exempelfamilj: svaret gavs bara här.",
  "Sample family: taken back here only.": "Exempelfamilj: återtogs bara här.",
  "Sample family: cancelled here only.": "Exempelfamilj: avbokades bara här.",
  "Sample family: nothing was sent.": "Exempelfamilj: inget skickades.",
  "The Wilma session changed, so nothing was sent. Check it and send again.": "Wilma-sessionen ändrades, så inget skickades. Kontrollera och skicka igen.",

  // store.ts
  "Couldn't save the key in the keychain: {error}": "Kunde inte spara nyckeln i nyckelringen: {error}",

  // runner.ts: errors when Jev decides (the eval suite only)
  "Jev's answer was missing a question": "En fråga saknades i Jevs svar",
  "Jev didn't accept the API key.": "Jev godkände inte API-nyckeln.",
  "The Jev account has no credits left.": "Jev-kontots krediter är slut.",
  "Jev answered HTTP {status}.": "Jev svarade med HTTP {status}.",
};
