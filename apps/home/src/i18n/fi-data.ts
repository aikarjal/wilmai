/* Finnish for data. Keys are the English text exactly as in t(). */
export const FI_DATA: Record<string, string> = {
  // feed.ts: tasks and agenda
  "Explain in Wilma": "Selvitä Wilmassa",
  "Wilma shows this absence as unexplained until a guardian explains it.": "Wilma näyttää poissaolon selvittämättömänä, kunnes huoltaja selvittää sen.",
  "Sign up": "Ilmoittaudu",
  "The school asks you to sign up.": "Koulu pyytää sinua ilmoittautumaan.",
  "The school asks you to sign up today.": "Koulu pyytää sinua ilmoittautumaan tänään.",
  "The school asks you to sign up by tomorrow.": "Koulu pyytää sinua ilmoittautumaan huomiseen mennessä.",
  "The school asks you to sign up by {date}.": "Koulu pyytää sinua ilmoittautumaan {date} mennessä.",
  "The school asks you to sign up, by {time} today.": "Koulu pyytää sinua ilmoittautumaan tänään klo {time} mennessä.",
  "The school asks you to sign up, by {time} tomorrow.": "Koulu pyytää sinua ilmoittautumaan huomenna klo {time} mennessä.",
  "The school asks you to sign up, by {date} {time}.": "Koulu pyytää sinua ilmoittautumaan {date} klo {time} mennessä.",
  "(no subject)": "(ei aihetta)",
  "Sent by you, no reply yet": "Lähettämäsi, ei vielä vastausta",
  "Sent by you": "Lähettämäsi",
  "To {names}, no reply yet": "Vastaanottaja {names}, ei vielä vastausta",
  "To {names}": "Vastaanottaja {names}",
  "Signed up": "Ilmoittauduttu",
  "Sign up: {title}": "Ilmoittaudu: {title}",
  "{title} (sign-up ends)": "{title} (ilmoittautuminen päättyy)",

  // engine.ts: signing in
  "Wilma didn't accept that code. Check the code in your authenticator app.": "Wilma ei hyväksynyt koodia. Tarkista koodi todennussovelluksestasi.",
  "Wilma didn't accept that username and password.": "Wilma ei hyväksynyt käyttäjätunnusta ja salasanaa.",
  "{error} Sign in again with your password.": "{error} Kirjaudu uudelleen salasanallasi.",
  "Wilma didn't accept that code. Type the newest code from your authenticator app.": "Wilma ei hyväksynyt koodia. Kirjoita uusin koodi todennussovelluksestasi.",
  "Wilma ended the session. Sign in again to refresh; everything already here stays.": "Wilma päätti istunnon. Kirjaudu uudelleen, niin tiedot päivittyvät. Kaikki jo haettu pysyy tallessa.",

  // engine.ts: sync steps
  "Checking Wilma": "Tarkistetaan Wilmaa",
  "Read {name}'s Wilma": "Wilma luettu: {name}",
  "Reading new messages and bulletins": "Luetaan uusia viestejä ja tiedotteita",

  // engine.ts: invitations, the sample family, sending
  "Open the invitation first.": "Avaa kutsu ensin.",
  "Sample family: signed up here only.": "Esimerkkiperhe: ilmoittauduttu vain täällä.",
  "Sample family: answered here only.": "Esimerkkiperhe: vastattu vain täällä.",
  "Sample family: taken back here only.": "Esimerkkiperhe: peruttu vain täällä.",
  "Sample family: cancelled here only.": "Esimerkkiperhe: peruttu vain täällä.",
  "Sample family: nothing was sent.": "Esimerkkiperhe: mitään ei lähetetty.",
  "The Wilma session changed, so nothing was sent. Check it and send again.": "Wilma-istunto vaihtui, joten mitään ei lähetetty. Tarkista ja lähetä uudelleen.",

  // store.ts
  "Couldn't save the key in the keychain: {error}": "Avainta ei voitu tallentaa avainnippuun: {error}",

  // runner.ts: errors when Jev decides (the eval suite only)
  "Jev's answer was missing a question": "Jevin vastauksesta puuttui kysymys",
  "Jev didn't accept the API key.": "Jev ei hyväksynyt API-avainta.",
  "The Jev account has no credits left.": "Jev-tilin krediitit ovat loppuneet.",
  "Jev answered HTTP {status}.": "Jev vastasi: HTTP {status}.",
};
