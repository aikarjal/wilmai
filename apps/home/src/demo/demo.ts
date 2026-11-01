/*
 * A made-up family for trying the app without signing in (and for
 * screenshots without real children's data). Dates follow today.
 *
 * The children are at schools on two Wilmas, as a family with children in two towns signs in to both: Kiia's school
 * is the first login and Otso's was added after it, so his number and the ids of what his school sent carry its slot
 * (data/logins.ts). Each school writes only to its own pupils.
 */
import type { ExamGrade, LessonNote, PastExam, ScheduleLesson, UpcomingExam } from "@wilma-client/src/core";
import { addDays, isoWeek, mondayOf, today, weekday } from "../data/dates";
import { finnishTime } from "@wilma-client/src/finnish-time";
import type { Contacts, MessageRec, NewsRec, Snapshot } from "../data/model";
import type { InvitationSlot as InviteSlot } from "@wilma-client/src/core";
import { familyChild, familyId, wilmaNumber } from "../data/logins";

const KIIA = "1001";
const OTSO = familyChild(1, "1002");

/** The two schools' Wilmas (made-up addresses; the towns as on the Home page's picture of signing in to two). */
const KIIAS_WILMA = { baseUrl: "https://example.inschool.fi", username: "demo", tenantName: "Espoon kaupunki", via: "demo" as const };
const OTSOS_WILMA = { baseUrl: "https://example-2.inschool.fi", username: "demo", tenantName: "Helsingin kaupunki", via: "demo" as const };

function at(iso: string, hhmm: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  const [h, min] = hhmm.split(":").map(Number);
  return finnishTime(y, m, d, h, min);
}

const fi = (iso: string) => {
  const [, m, d] = iso.split("-").map(Number);
  return `${d}.${m}.`;
};
const FI_DAY = ["ma", "ti", "ke", "to", "pe", "la", "su"];
const fiDay = (iso: string) => `${FI_DAY[weekday(iso)]} ${fi(iso)}`;

/*
 * The family in English, as Settings → Translating messages would show it: each Finnish text below is paired with its
 * English where it's written (`en`), so the sample family can show translation without AI (demo/translations.ts) and
 * the two can't drift apart. The English reads as the app's translations do: weekdays in English, dates' numbers as
 * written, and a form's Finnish word in brackets the first time.
 */
const english = new Map<string, string>();
const en = (finnish: string, translated: string) => {
  english.set(finnish, translated);
  return finnish;
};
const EN_DAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const enDay = (iso: string) => `${EN_DAY[weekday(iso)]} ${fi(iso)}`;

/** Subjects in English, wherever they show (timetables, notes, homework, exams, grades). */
const SUBJECTS_EN: Record<string, string> = {
  Matematiikka: "Maths",
  Englanti: "English",
  Kuvataide: "Visual arts",
  Historia: "History",
  Ruotsi: "Swedish",
  Liikunta: "PE",
  Äidinkieli: "Finnish",
  Fysiikka: "Physics",
  Biologia: "Biology",
  Musiikki: "Music",
  Kotitalous: "Home economics",
  Ympäristöoppi: "Environmental studies",
  Käsityö: "Crafts",
  Uskonto: "Religion",
  "Suomen kieli ja kirjallisuus": "Finnish language and literature",
  "Englanti, A1": "English, A1",
  "Ruotsin kieli, B1": "Swedish, B1",
  "Ruotsi, B1": "Swedish, B1",
};
for (const [subject, translated] of Object.entries(SUBJECTS_EN)) en(subject, translated);

let made: { day: string; english: ReadonlyMap<string, string> } | null = null;
/** The sample family's Finnish texts and their English, as made for today. */
export function demoEnglish(): ReadonlyMap<string, string> {
  if (made?.day !== today()) {
    demoSnapshot();
    made = { day: today(), english: new Map(english) };
  }
  return made.english;
}

/** The next date on or after `from` that falls on weekday `day` (0 = Monday). */
function next(from: string, day: number, skip = 0): string {
  const d = addDays(from, (day - weekday(from) + 7) % 7);
  return addDays(d, skip * 7);
}

type Slot = [start: string, end: string, subject: string, code: string, teacher: string, teacherCode: string, room: string];

const KIIA_WEEK: Slot[][] = [
  [["08:15", "09:00", "Matematiikka", "MA", "Jussi Korhonen", "KOJ", "B204"], ["09:10", "10:40", "Englanti", "ENA", "Anna Nieminen", "NIA", "A112"], ["11:15", "12:45", "Kuvataide", "KU", "Eeva Lindholm", "LIE", "C01"], ["13:00", "14:30", "Historia", "HI", "Pekka Salo", "SAP", "A210"]],
  [["09:10", "10:40", "Ruotsi", "RUB", "Maria Holm", "HOM", "A114"], ["11:15", "12:45", "Liikunta", "LI", "Mikko Lehtonen", "LEM", "Sali"], ["13:00", "14:30", "Äidinkieli", "ÄI", "Sanna Koivisto", "KOS", "A201"]],
  [["08:15", "09:45", "Fysiikka", "FY", "Jussi Korhonen", "KOJ", "B110"], ["10:00", "11:30", "Englanti", "ENA", "Anna Nieminen", "NIA", "A112"], ["12:15", "13:45", "Matematiikka", "MA", "Jussi Korhonen", "KOJ", "B204"]],
  [["08:15", "09:45", "Äidinkieli", "ÄI", "Sanna Koivisto", "KOS", "A201"], ["10:00", "11:30", "Biologia", "BI", "Leena Aho", "AHL", "B112"], ["12:15", "13:45", "Musiikki", "MU", "Ville Rinne", "RIV", "M1"], ["14:00", "15:30", "Matematiikka", "MA", "Jussi Korhonen", "KOJ", "B204"]],
  [["09:10", "10:40", "Ruotsi", "RUB", "Maria Holm", "HOM", "A114"], ["11:15", "12:45", "Kotitalous", "KO", "Riikka Aalto", "AAR", "Keittiö"]],
];

const OTSO_WEEK: Slot[][] = [
  [["08:15", "09:00", "Äidinkieli", "ÄI", "Laura Mäkinen", "MÄL", "3B"], ["09:00", "09:45", "Matematiikka", "MA", "Laura Mäkinen", "MÄL", "3B"], ["10:15", "11:00", "Ympäristöoppi", "YM", "Laura Mäkinen", "MÄL", "3B"], ["12:00", "12:45", "Liikunta", "LI", "Mikko Lehtonen", "LEM", "Sali"]],
  [["08:15", "09:00", "Matematiikka", "MA", "Laura Mäkinen", "MÄL", "3B"], ["09:00", "09:45", "Englanti", "ENA", "Anna Nieminen", "NIA", "A110"], ["10:15", "11:00", "Musiikki", "MU", "Ville Rinne", "RIV", "M1"], ["12:00", "13:30", "Käsityö", "KÄ", "Tuula Ranta", "RAT", "Pajaluokka"]],
  [["08:15", "09:45", "Äidinkieli", "ÄI", "Laura Mäkinen", "MÄL", "3B"], ["10:15", "11:00", "Uskonto", "UE", "Laura Mäkinen", "MÄL", "3B"], ["12:00", "12:45", "Matematiikka", "MA", "Laura Mäkinen", "MÄL", "3B"]],
  [["08:15", "09:00", "Englanti", "ENA", "Anna Nieminen", "NIA", "A110"], ["09:00", "09:45", "Ympäristöoppi", "YM", "Laura Mäkinen", "MÄL", "3B"], ["10:15", "11:45", "Kuvataide", "KU", "Eeva Lindholm", "LIE", "C01"], ["12:30", "13:15", "Liikunta", "LI", "Mikko Lehtonen", "LEM", "Sali"]],
  [["08:15", "09:00", "Matematiikka", "MA", "Laura Mäkinen", "MÄL", "3B"], ["09:00", "09:45", "Äidinkieli", "ÄI", "Laura Mäkinen", "MÄL", "3B"], ["10:15", "11:00", "Ympäristöoppi", "YM", "Laura Mäkinen", "MÄL", "3B"]],
];

/** Who the sample family can write to: each child's teachers from the timetable, the class teacher first. */
export function demoContacts(child: string): Contacts {
  const kiia = child === KIIA;
  const path = (query: string) => `/!${wilmaNumber(child)}/messages/compose?${query}`;
  const teachers = new Map<string, string>();
  for (const [, , , , teacher, code] of (kiia ? KIIA_WEEK : OTSO_WEEK).flat()) {
    const [first, last] = teacher.split(" ");
    teachers.set(code, `${last} ${first} (${code})`);
  }
  const ids = [...teachers.keys()];
  const teacher = (code: string, group: string) => ({ name: teachers.get(code)!, group, school: null, kind: "teacher" as const, composePath: path(`r_teacher=${3000 + ids.indexOf(code)}`) });
  const classTeacher = kiia ? "KOJ" : "MÄL";
  return {
    details: {
      name: kiia ? "Kiia Virtanen" : "Otso Virtanen",
      className: kiia ? "7B" : "3B",
      supervisors: [{ name: teachers.get(classTeacher)!.replace(/\s*\(.*\)$/, ""), role: "Ryhmänohjaaja/Luokanvalvoja", recipient: teacher(classTeacher, "Huollettavasi tiedot") }],
      messageGroups: [{ name: "Lähetä viesti opiskelijan kaikille opettajille", group: "Huollettavasi tiedot", school: null, kind: "group", composePath: path(`r_ownteachers=${child}`) }],
    },
    recipients: [
      { name: "Virtanen Mikko", group: "Muut huoltajat", school: null, kind: "guardian", composePath: path("r_guardian=1") },
      { name: "Kaikki", group: "Omat opettajat", school: null, kind: "group", composePath: path(`r_ownteachers=${child}`) },
      ...ids.map((code) => teacher(code, "Omat opettajat")),
      { name: "Virtanen Sari (terveydenhoitaja)", group: "Henkilökunta", school: "Esimerkkikoulu", kind: "staff", composePath: path("r_personnel=2001") },
      { name: "Salo Pekka (rehtori)", group: "Henkilökunta", school: "Esimerkkikoulu", kind: "staff", composePath: path("r_personnel=2002") },
    ],
    fetchedAt: new Date(),
  };
}

function lessons(week: Slot[][], monday: string, shift?: { date: string; from: string }): ScheduleLesson[] {
  const out: ScheduleLesson[] = [];
  for (let w = 0; w < 2; w += 1) {
    week.forEach((day, i) => {
      const date = addDays(monday, w * 7 + i);
      for (const [start, end, subject, code, teacher, teacherCode, room] of day) {
        if (shift && date === shift.date && start < shift.from) continue;
        out.push({ date, dayOfWeek: i + 1, start, end, subject, subjectCode: code, teacher, teacherCode, groupId: 0, room });
      }
    });
  }
  return out;
}

export function demoSnapshot(): Snapshot {
  const now = today();
  const monday = mondayOf(now);
  const tomorrow = addDays(now, 1);
  const d = (days: number) => addDays(now, days);
  const fri = next(d(1), 4);
  // The trip's permission is due the school day before it, never after (a Wednesday from tomorrow was, on a Wednesday).
  const permissionBy = addDays(fri, -1);
  const mathExam = next(d(2), 3, 1);
  const parentsEvening = next(d(3), 1);
  const lastMonday = addDays(monday, weekday(now) === 0 ? -7 : 0);
  const autumnBreak = next(d(7), 0);

  // Past exams over two school years (a school day near each offset), the newest without a grade yet.
  const schoolDay = (days: number) => {
    let date = d(days);
    const [y, m, day] = date.split("-").map(Number);
    // Not in the Christmas or summer holidays.
    if ((m === 12 && day >= 20) || (m === 1 && day <= 7)) date = `${m === 12 ? y : y - 1}-12-17`;
    if ((m === 6 && day > 0) || m === 7 || (m === 8 && day < 12)) date = `${y}-05-27`;
    return weekday(date) > 4 ? addDays(date, 4 - weekday(date)) : date;
  };
  const TEACHERS: Record<string, [string, string]> = {
    MA: ["Jussi Korhonen", "KOJ"], ÄI: ["Liisa Lehtonen", "LEL"], ENA1: ["Anna Nieminen", "NIA"], RUB1: ["Maria Holm", "HOM"], HI: ["Pekka Salo", "SAP"], BI: ["Sanna Aalto", "AAS"],
  };
  const SUBJECTS: Record<string, string> = { MA: "Matematiikka", ÄI: "Suomen kieli ja kirjallisuus", ENA1: "Englanti, A1", RUB1: "Ruotsin kieli, B1", HI: "Historia", BI: "Biologia" };
  const pastExam = (days: number, family: string, course: string, name: string, grade: string | null, info: string | null = null, seen = true): PastExam => {
    const date = schoolDay(days);
    const [teacher, teacherCode] = TEACHERS[family];
    return { date, name, subject: SUBJECTS[family], subjectCode: `${family}_${course}`, grade, verbalGrade: null, info, teacher, teacherCode, seen: grade && seen ? addDays(date, 3) : null };
  };
  const kiiaPast: PastExam[] = [
    pastExam(-1, "BI", "81", en("Solu ja perinnöllisyys", "The cell and heredity"), null, en("Kirjan luvut 1–5 ja vihkotehtävät.", "Chapters 1–5 of the book and the notebook exercises.")),
    pastExam(-5, "HI", "81", en("Ranskan vallankumous", "The French Revolution"), "9-", en("Luvut 6–9, käsitteet ja aikajana.", "Chapters 6–9, concepts and the timeline."), false),
    pastExam(-9, "ENA1", "81", "Unit 1–2", "9"),
    pastExam(-12, "RUB1", "81", en("Verbikoe 2", "Verb test 2"), "8½", en("Epäsäännölliset verbit, lista 2.", "Irregular verbs, list 2.")),
    pastExam(-14, "ENA1", "81", en("Verbikoe 2", "Verb test 2"), "24", en("Pisteet /25p.", "Points out of 25.")),
    pastExam(-16, "MA", "81", en("Murtoluvut ja desimaaliluvut", "Fractions and decimals"), "8+", en("Kirjan kappaleet 1–6.\nKertaa myös vihon tehtävät.", "Chapters 1–6 of the book.\nAlso go over the exercises in your notebook.")),
    pastExam(-26, "ÄI", "81", en("Mielipidekirjoitus", "Opinion writing"), "K", en("Arviointi T-H-K", "Graded T-H-K")),
    pastExam(-23, "RUB1", "81", en("Sanakoe kpl 3", "Vocabulary test, ch. 3"), "7½"),
    pastExam(-30, "ÄI", "81", en("Kielioppi: lauseenjäsenet", "Grammar: parts of the sentence"), "9"),
    pastExam(-136, "MA", "7LV", en("Geometria", "Geometry"), "9"),
    pastExam(-142, "ENA1", "7LV", "Units 7–9", "10-"),
    pastExam(-149, "BI", "7LV", en("Ekosysteemit", "Ecosystems"), "8"),
    pastExam(-156, "RUB1", "7LV", en("Kappaleet 7–9", "Chapters 7–9"), "8-"),
    pastExam(-163, "ÄI", "7LV", en("Romaanin analyysi", "Analysing a novel"), "9+"),
    pastExam(-170, "ÄI", "7LV", en("Työskentely kevään tunneilla", "Work in the spring's lessons"), "4", en("Arviointi 1-5\n5 = työskentely on esimerkillistä\n3 = työskentely on pääsääntöisesti sujuvaa\n1 = työskentelyssä on paljon parannettavaa", "Graded 1-5\n5 = exemplary work\n3 = mostly fluent work\n1 = a lot to improve")),
    pastExam(-176, "HI", "7LV", en("Teollistuminen", "Industrialisation"), "9"),
    pastExam(-190, "MA", "7LV", en("Yhtälöt", "Equations"), "9½"),
    pastExam(-204, "ENA1", "7LV", "Units 4–6", "10"),
    pastExam(-218, "RUB1", "7LV", en("Verbikoe 1", "Verb test 1"), "8"),
    pastExam(-246, "MA", "71", en("Prosenttilaskut", "Percentages"), "8½"),
    pastExam(-260, "ÄI", "71", en("Kielioppi: sijamuodot", "Grammar: cases"), "9"),
    pastExam(-267, "BI", "71", en("Kasvit", "Plants"), "8+"),
    pastExam(-281, "ENA1", "71", "Units 1–3", "9+"),
    pastExam(-295, "RUB1", "71", en("Sanakoe kpl 2", "Vocabulary test, ch. 2"), "7"),
    pastExam(-302, "HI", "71", en("Uuden ajan alku", "The beginning of the modern era"), "8+"),
    pastExam(-316, "MA", "71", en("Lausekkeet", "Expressions"), "8"),
    pastExam(-330, "ÄI", "71", en("Tekstitaidot", "Text skills"), "9-"),
  ];
  const kiiaFront: ExamGrade[] = kiiaPast
    .filter((e) => e.grade && e.date >= d(-40))
    .map((e, i) => ({ examId: 91 + i, date: e.date, name: e.name, subject: e.subject, subjectCode: e.subjectCode, grade: e.grade!, verbalGrade: null, info: e.info, teacher: e.teacher, teacherCode: e.teacherCode, seen: e.seen }));
  const otsoPast: PastExam[] = [
    { date: schoolDay(-6), name: en("Kertotaulut 2–5", "Times tables 2–5"), subject: "Matematiikka", subjectCode: "MA_3B", grade: "9+", verbalGrade: en("Kertotaulut sujuvat hienosti!", "The times tables are going really well!"), info: null, teacher: "Laura Mäkinen", teacherCode: "MÄL", seen: addDays(schoolDay(-6), 2) },
    { date: schoolDay(-20), name: en("Sanelu", "Dictation"), subject: "Äidinkieli", subjectCode: "ÄI_3B", grade: "8", verbalGrade: null, info: en("Isot alkukirjaimet ja pisteet.", "Capital letters and full stops."), teacher: "Laura Mäkinen", teacherCode: "MÄL", seen: addDays(schoolDay(-20), 2) },
  ];

  let id = 41000;
  const message = (m: Omit<MessageRec, "id" | "replyCount"> & { replyCount?: number }): MessageRec => ({
    id: ++id,
    replyCount: m.thread?.replies.length ?? m.replyCount ?? 0,
    ...m,
  });
  const thread = (content: string, extra: Partial<NonNullable<MessageRec["thread"]>> = {}) => ({
    content,
    recipients: null,
    replies: [],
    collated: false,
    fetchedAt: new Date(),
    ...extra,
  });

  const messages: MessageRec[] = [
    message({
      subject: en(`Huomenna koulu alkaa klo 10.15`, `School starts at 10.15 tomorrow`),
      sender: "Mäkinen Laura (MÄL)",
      sentAt: at(now, "07:45"),
      unreadInWilma: true,
      children: [OTSO],
      thread: thread(
        en(
          `Hei!\n\nOpettajien koulutuspäivän vuoksi 3B:n koulupäivä alkaa huomenna ${fiDay(tomorrow)} vasta klo 10.15. Aamupäiväkerho on auki normaalisti klo 7.30 alkaen.\n\nLaura`,
          `Hi!\n\nBecause of a teachers' training day, 3B's school day starts only at 10.15 tomorrow, ${enDay(tomorrow)}. The morning club is open as usual from 7.30.\n\nLaura`
        )
      ),
    }),
    message({
      subject: en(`Poissaolon selvitys`, `Explaining an absence`),
      sender: "Korhonen Jussi (KOJ)",
      sentAt: at(d(-1), "16:20"),
      unreadInWilma: true,
      children: [KIIA],
      thread: thread(
        en(
          `Hei,\n\nKiialla on merkitty selvittämätön poissaolo ${fiDay(lastMonday)} klo 11.15–12.45 (kuvataide). Voisitteko kuitata poissaolon Wilmassa tai vastata tähän viestiin? Kiitos!\n\nJussi Korhonen\n8C:n luokanvalvoja`,
          `Hi,\n\nKiia has an unexplained absence on ${enDay(lastMonday)} at 11.15–12.45 (visual arts). Could you explain the absence in Wilma or reply to this message? Thank you!\n\nJussi Korhonen\n8C's class teacher`
        )
      ),
    }),
    message({
      subject: en(`Metsäretki Nuuksioon ${fiDay(fri)}`, `Forest trip to Nuuksio ${enDay(fri)}`),
      sender: "Mäkinen Laura (MÄL)",
      sentAt: at(d(-1), "15:12"),
      unreadInWilma: false,
      children: [OTSO],
      thread: thread(
        en(
          `Hei 3B:n huoltajat!\n\nLähdemme perjantaina ${fi(fri)} metsäretkelle Nuuksioon. Lähtö koululta klo 8.30 ja paluu noin klo 14.00.\n\nMukaan:\n- reilut eväät ja juomapullo\n- sään mukainen vaatetus ja kumisaappaat\n- pieni reppu\n\nPalauttakaa retkilupa allekirjoitettuna ${fiDay(permissionBy)} mennessä tai vastatkaa tähän viestiin, että lapsenne saa osallistua.\n\nTerveisin\nLaura`,
          `Hi 3B's guardians!\n\nOn Friday ${fi(fri)} we're going on a forest trip to Nuuksio. We leave school at 8.30 and are back at about 14.00.\n\nBring:\n- a good packed lunch and a water bottle\n- clothes for the weather and rubber boots\n- a small backpack\n\nPlease return the signed trip permission (retkilupa) by ${enDay(permissionBy)}, or reply to this message that your child may take part.\n\nBest wishes\nLaura`
        )
      ),
    }),
    message({
      subject: en(`Matematiikan koe ${fiDay(mathExam)}`, `Maths exam ${enDay(mathExam)}`),
      sender: "Korhonen Jussi (KOJ)",
      sentAt: at(d(-2), "09:40"),
      unreadInWilma: false,
      children: [KIIA],
      thread: thread(
        en(
          `Hei!\n\n8C:n matematiikan koe on ${fiDay(mathExam)} klo 8.15. Kokeen aiheina yhtälöt ja verrannollisuus (kirjan kappaleet 1–9). Kertauspaketti on Classroomissa. Laskin mukaan.\n\nJussi`,
          `Hi!\n\n8C's maths exam is on ${enDay(mathExam)} at 8.15. It covers equations and proportionality (chapters 1–9 of the book). The revision pack is in Classroom. Bring a calculator.\n\nJussi`
        )
      ),
    }),
    message({
      subject: en(`Kiitos Kiialle!`, `Thanks to Kiia!`),
      sender: "Nieminen Anna (NIA)",
      sentAt: at(d(-3), "14:05"),
      unreadInWilma: false,
      children: [KIIA],
      thread: thread(
        en(
          `Hei!\n\nHalusin kertoa, että Kiia piti tänään englannin tunnilla todella hyvän esitelmän Skotlannista. Hän oli valmistautunut huolella ja puhui rohkeasti koko luokan edessä. Hienoa työtä!\n\nTerveisin\nAnna Nieminen`,
          `Hi!\n\nI wanted to let you know that Kiia gave a really good presentation on Scotland in today's English lesson: carefully prepared, and given confidently in front of the whole class. Great work!\n\nBest wishes\nAnna Nieminen`
        )
      ),
    }),
    message({
      subject: en(`Vanhempainilta ${fiDay(parentsEvening)} klo 18.00`, `Parents' evening ${enDay(parentsEvening)} at 18.00`),
      sender: "Salo Pekka (rehtori)",
      sentAt: at(d(-4), "12:00"),
      unreadInWilma: false,
      children: [KIIA],
      thread: thread(
        en(
          `Hyvät huoltajat,\n\ntervetuloa koulun vanhempainiltaan ${fiDay(parentsEvening)} klo 18.00 koulun auditorioon. Illan aiheina ovat koulun hyvinvointisuunnitelma ja syksyn tapahtumat. Lopuksi luokkakohtaiset tapaamiset omien luokanopettajien ja -valvojien kanssa.\n\nIlmoittauduttehan Wilman lomakkeella ${fiDay(fri)} mennessä, jotta osaamme varata kahvia riittävästi.\n\nPekka Salo\nrehtori`,
          `Dear guardians,\n\nWelcome to the school's parents' evening on ${enDay(parentsEvening)} at 18.00 in the school auditorium. The evening's topics are the school's wellbeing plan and the autumn's events. To finish, each class meets its own class teachers.\n\nPlease sign up with the form in Wilma (lomake) by ${enDay(fri)}, so we know how much coffee to make.\n\nPekka Salo\nprincipal`
        )
      ),
    }),
    message({
      subject: en(`8C:n luokkaretkikassa – ideoita varainkeruuseen?`, `8C's class trip fund – ideas for fundraising?`),
      sender: "Korhonen Jussi (KOJ)",
      sentAt: at(d(-5), "19:30"),
      unreadInWilma: false,
      children: [KIIA],
      thread: thread(
        en(
          `Hei 8C:n huoltajat!\n\nOppilaat toivovat keväälle luokkaretkeä. Kerätään yhdessä ideoita varainkeruuseen: kahvio vanhempainillassa, talkoot, arpajaiset…\n\nTämä on avoin keskustelu, eli kaikki näkevät vastaukset. Kertokaa myös, jos voitte olla mukana järjestämässä.\n\nJussi`,
          `Hi 8C's guardians!\n\nThe pupils would like a class trip in the spring. Let's gather ideas for fundraising together: a café at the parents' evening, a work day, a raffle…\n\nThis is an open discussion, so everyone sees the replies. Let us know too if you can help organise it.\n\nJussi`
        ),
        {
          collated: true,
          replies: [
            { id: 1, sentAt: at(d(-5), "20:12"), senderName: "Rantanen Tiina (huoltaja)", content: en("Kahvio vanhempainillassa kuulostaa hyvältä! Voin leipoa ja olla myymässä.", "A café at the parents' evening sounds good! I can bake and help sell.") },
            { id: 2, sentAt: at(d(-4), "07:58"), senderName: "Hakala Jari (huoltaja)", content: en("Ehdotan myös joulukorttimyyntiä. Meillä on kotona painokone, voin auttaa kuvien kanssa.", "I'd also suggest selling Christmas cards. We have a printer at home, and I can help with the pictures.") },
          ],
        }
      ),
    }),
    message({
      subject: en(`Kotitalouden ryhmätyö: leivonnaiset myyjäisiin`, `Home economics group work: baking for the fair`),
      sender: "Aalto Riikka (AAR)",
      sentAt: at(d(-6), "14:10"),
      unreadInWilma: false,
      children: [KIIA],
      // A longer thread: the reader folds the earlier messages so the newest shows first.
      thread: thread(
        en(
          `Hei 8C:n huoltajat!\n\nKotitalouden tunneilla valmistamme ryhmissä leivonnaisia koulun joulumyyjäisiin. Jokainen ryhmä suunnittelee oman reseptinsä ja laskee sille kustannusarvion. Koulu hankkii raaka-aineet.\n\nKertokaa minulle, jos lapsellanne on ruoka-aineallergioita, jotka meidän pitää huomioida ryhmien suunnittelussa.\n\nRiikka Aalto\nkotitalous`,
          `Hi 8C's guardians!\n\nIn home economics lessons we're baking in groups for the school's Christmas fair. Each group plans its own recipe and works out what it will cost. The school buys the ingredients.\n\nPlease tell me if your child has food allergies that we need to take into account when planning the groups.\n\nRiikka Aalto\nhome economics`
        ),
        {
          replies: [
            { id: 1, sentAt: at(d(-6), "18:40"), senderName: "Virtanen Mikko (Kiia Virtanen, 8C)", content: en("Hei! Kiialla on pähkinäallergia, joten toivoisimme, ettei hänen ryhmänsä käytä pähkinöitä. Voiko hän tuoda omat ainekset, jos resepti vaatii jotain korvaavaa?", "Hi! Kiia has a nut allergy, so we'd hope the group won't use nuts. Could Kiia bring some ingredients from home if the recipe needs something in their place?") },
            { id: 2, sentAt: at(d(-5), "08:05"), senderName: "Aalto Riikka (AAR)", content: en("Kiitos tiedosta! Huomioimme allergian kaikissa ryhmissä, eli pähkinöitä ei käytetä tällä kertaa ollenkaan. Omia aineksia ei tarvitse tuoda, korvaavat hankitaan koulun puolesta.", "Thank you for letting me know! We'll take the allergy into account in every group, so no nuts at all this time. There's no need to bring anything: the school will get what's needed instead.") },
            { id: 3, sentAt: at(d(-4), "20:15"), senderName: "Virtanen Mikko (Kiia Virtanen, 8C)", content: en("Hienoa, kiitos! Kiia kertoi, että hänen ryhmänsä tekee kaurakeksejä. Tarvitaanko myyjäisiin vanhempia avuksi?", "Great, thank you! Kiia said the group is making oat biscuits. Do you need parents to help at the fair?") },
            { id: 4, sentAt: at(d(-1), "15:30"), senderName: "Aalto Riikka (AAR)", content: en("Apu on tervetullutta! Tarvitsemme kaksi aikuista myyntipöytään klo 17–18. Kerron tarkemmin ensi viikolla, kun aikataulu on vahvistunut.", "Help is welcome! We need two adults at the sales table from 17 to 18. I'll tell you more next week, once the timetable is confirmed.") },
          ],
        }
      ),
    }),
    message({
      subject: en(`Liikunta ulkona koko lokakuun`, `PE outdoors all through October`),
      sender: "Lehtonen Mikko (LEM)",
      sentAt: at(d(-6), "10:02"),
      unreadInWilma: false,
      children: [KIIA],
      thread: thread(
        en(
          `Hei!\n\nLokakuun liikuntatunnit pidetään ulkona säällä kuin säällä. Huolehdittehan, että mukana on lämmin ja sateenkestävä vaatetus sekä ulkokengät.\n\nMikko Lehtonen`,
          `Hi!\n\nOctober's PE lessons are held outdoors whatever the weather. Please make sure warm, rainproof clothes and outdoor shoes come along.\n\nMikko Lehtonen`
        )
      ),
    }),
    message({
      subject: en(`Terveystarkastukset 3. ja 8. luokille`, `Health checks for years 3 and 8`),
      sender: "Virtanen Sari (terveydenhoitaja)",
      sentAt: at(d(-8), "13:30"),
      unreadInWilma: false,
      children: [KIIA],
      thread: thread(
        en(
          `Hyvät huoltajat,\n\nlaajat terveystarkastukset 3. ja 8. luokille alkavat ${fi(next(d(1), 0, 1))}. Saatte kutsun ja ajan erikseen. Täyttäkää ennen tarkastusta esitietolomake, jonka lähetän Wilmaan lomakkeena.\n\nYstävällisin terveisin\nSari Virtanen, kouluterveydenhoitaja`,
          `Dear guardians,\n\nThe full health checks for years 3 and 8 start on ${fi(next(d(1), 0, 1))}. You'll get an invitation and a time separately. Before the check, please fill in the background form (esitietolomake), which I'll send in Wilma as a form.\n\nKind regards\nSari Virtanen, school nurse`
        )
      ),
    }),
    // Sent by the family, not answered yet: only in Wilma's Sent folder.
    message({
      subject: en("Hammaslääkäri torstaina", "Dentist on Thursday"),
      sender: null,
      sentAt: at(d(-1), "19:05"),
      unreadInWilma: false,
      children: [KIIA],
      sent: true,
      thread: thread(en(`Hei,\n\nKiialla on hammaslääkäri torstaiaamuna, joten hän tulee kouluun vasta toiselle tunnille.\n\nTerveisin\nMikko Virtanen`, `Hi,\n\nKiia has a dentist's appointment on Thursday morning, so Kiia will come to school only for the second lesson.\n\nBest wishes\nMikko Virtanen`), {
        recipients: ["Korhonen Jussi (KOJ)"],
      }),
    }),
    message({
      subject: en(`Viikkokirje vk ${isoWeek(now) - 1}`, `Weekly letter, week ${isoWeek(now) - 1}`),
      sender: "Mäkinen Laura (MÄL)",
      sentAt: at(addDays(monday, -3), "14:45"),
      unreadInWilma: false,
      children: [OTSO],
      thread: thread(
        en(
          `Hei!\n\nTällä viikolla opettelimme kertotauluja 6 ja 7, luimme yhteistä kirjaa ja ympäristöopissa tutkimme sieniä. Ensi viikolla jatkamme kertotauluja ja aloitamme syksyn taideprojektin.\n\nKiitos kaikille aktiivisesta yhteistyöstä!\n\nLaura`,
          `Hi!\n\nThis week we learnt the 6 and 7 times tables, read our class book together and studied mushrooms in environmental studies. Next week we'll carry on with the times tables and start the autumn art project.\n\nThank you all for working together so actively!\n\nLaura`
        )
      ),
    }),
  ];

  const slot = (id: string, date: string, start: string, end: string, extra: Partial<InviteSlot> = {}): InviteSlot => ({
    id,
    start: at(date, start),
    end: at(date, end),
    enrollStart: at(d(-1), "08:00"),
    enrollEnd: at(next(d(1), 0), "16:00"),
    cancelUntil: at(date, "08:00"),
    info: "",
    subject: "",
    maxPeople: 1,
    peopleCount: 0,
    selected: false,
    selectedByOther: null,
    wilmaState: "available",
    canDecline: true,
    declined: false,
    ...extra,
  });
  const talkDay = next(d(7), 1);
  const party = next(d(8), 2);
  messages.push(
    message({
      subject: en("Kutsu oppimiskeskusteluun", "Invitation to a learning discussion"),
      sender: "Korhonen Jussi (KOJ)",
      sentAt: at(d(-1), "09:20"),
      unreadInWilma: false,
      children: [KIIA],
      invite: { status: null, extra: null },
      thread: thread(
        en(
          `Hei!\n\nKutsun teidät Kiian oppimiskeskusteluun. Keskustelu kestää 25 minuuttia ja pidetään luokassa B204 tai Teamsissa, kumpi teille sopii paremmin.\n\nValitkaa sopiva aika alta.\n\nJussi Korhonen`,
          `Hi!\n\nI'd like to invite you to Kiia's learning discussion (oppimiskeskustelu). It takes 25 minutes and is held in classroom B204 or on Teams, whichever suits you better.\n\nPlease choose a time below.\n\nJussi Korhonen`
        ),
        {
          invite: {
            mustApply: true,
            canDecline: true,
            declined: false,
            slots: [
              slot("1", talkDay, "14:00", "14:25", { peopleCount: 1, wilmaState: "full" }),
              slot("2", talkDay, "14:30", "14:55"),
              slot("3", talkDay, "15:00", "15:25"),
              slot("4", addDays(talkDay, 1), "15:30", "15:55"),
            ],
          },
        }
      ),
    }),
    message({
      subject: en(`3B:n syysjuhla ${fiDay(party)} – ilmoittautuminen`, `3B's autumn party ${enDay(party)} – sign-up`),
      sender: "Mäkinen Laura (MÄL)",
      sentAt: at(d(-6), "12:30"),
      unreadInWilma: false,
      children: [OTSO],
      invite: { status: "Applied", extra: null },
      thread: thread(en(`Tervetuloa 3B:n syysjuhlaan! Oppilaat esittävät laulun ja näytelmän, ja vanhempainyhdistys järjestää kahvion.\n\nIlmoittautukaa alta.\n\nLaura`, `Welcome to 3B's autumn party! The pupils will perform a song and a play, and the parents' association is running a café.\n\nPlease sign up below.\n\nLaura`), {
        invite: {
          mustApply: true,
          canDecline: true,
          declined: false,
          slots: [slot("1", party, "17:30", "19:00", { maxPeople: 0, peopleCount: 14, selected: true, wilmaState: "selected-cancellable", cancelUntil: at(addDays(party, -1), "12:00") })],
        },
      }),
    })
  );

  const news: NewsRec[] = [
    {
      id: 900,
      title: en(`Syysloma viikolla ${isoWeek(autumnBreak)}`, `Autumn break in week ${isoWeek(autumnBreak)}`),
      subtitle: en("Koulu on suljettuna syysloman ajan.", "The school is closed during the autumn break."),
      author: "Rehtori Pekka Salo",
      published: at(d(-12), "09:00"),
      pinned: false,
      children: [KIIA],
      detail: {
        content: en(
          `Syysloma on ${fi(autumnBreak)}–${fi(addDays(autumnBreak, 4))}. Koulu alkaa jälleen maanantaina ${fi(addDays(autumnBreak, 7))} lukujärjestyksen mukaan. Iltapäiväkerho on suljettu loman ajan.`,
          `The autumn break is ${fi(autumnBreak)}–${fi(addDays(autumnBreak, 4))}. School starts again on Monday ${fi(addDays(autumnBreak, 7))}, as timetabled. The after-school club is closed during the break.`
        ),
        resources: [],
        fetchedAt: new Date(),
      },
    },
    {
      id: familyId(1, 901),
      title: en("Lokakuun ruokalista", "October's menu"),
      subtitle: en("Kouluruokalan ruokalista ja erityisruokavaliot", "The school canteen's menu and special diets"),
      author: "Ruokapalvelut",
      published: at(d(-7), "08:00"),
      pinned: false,
      children: [OTSO],
      detail: { content: en("Lokakuun ruokalista on julkaistu koulun verkkosivuilla. Erityisruokavaliot ilmoitetaan terveydenhoitajalle lomakkeella.", "October's menu is on the school's website. Special diets are reported to the school nurse with a form."), resources: [], fetchedAt: new Date() },
    },
    {
      id: familyId(1, 902),
      title: en("Lukudiplomi alkaa", "The reading diploma starts"),
      subtitle: en("Kaikille luokille 1–9", "For all years 1–9"),
      author: "Kirjasto",
      published: at(d(-15), "12:00"),
      pinned: false,
      children: [OTSO],
      detail: { content: en("Lukudiplomin kirjalistat on päivitetty. Diplomin voi suorittaa koko lukuvuoden ajan; kirjat löytyvät koulun kirjastosta.", "The reading diploma's book lists have been updated. The diploma can be done at any time in the school year; the books are in the school library."), resources: [], fetchedAt: new Date() },
    },
  ];

  const note = (date: string, start: string, end: string, subject: string, typeLabel: string, teacher: string, text?: string): LessonNote => ({
    date,
    start,
    end,
    subject,
    typeLabel,
    typeClass: "",
    teacher,
    note: text ?? null,
  });

  // Today's note, or the last school day's at a weekend: Today shows the recent ones.
  const lastSchoolDay = weekday(now) > 4 ? addDays(now, 4 - weekday(now)) : now;
  const kiiaNotes = [
    note(lastSchoolDay, "08:15", "09:45", "Fysiikka", en("Sinulta puuttui opiskeluvälineitä", "Missing study materials"), "Jussi Korhonen", en("Laskin jäi kotiin.", "The calculator was left at home.")),
    note(d(-3), "09:10", "10:40", "Englanti", en("Positiivinen palaute", "Positive feedback"), "Anna Nieminen", en("Erinomainen esitelmä Skotlannista – selkeä ja rohkea esitys!", "An excellent presentation on Scotland – clear and confident!")),
    note(lastMonday, "11:15", "12:45", "Kuvataide", en("Selvittämätön poissaolo", "Unexplained absence"), "Eeva Lindholm"),
    note(d(-9), "08:15", "09:00", "Matematiikka", en("Myöhästyminen", "Late"), "Jussi Korhonen"),
    // A note on a coming lesson: the calendar reads it (a make-up exam).
    note(addDays(monday, 9), "08:15", "09:45", "Fysiikka", en("Tiedoksi", "For your information"), "Jussi Korhonen", en("Fysiikan rästikoe tunnin lopussa klo 9.15. Tuo laskin.", "Physics make-up exam at the end of the lesson at 9.15. Bring a calculator.")),
  ];
  const otsoNotes = [
    note(d(-2), "09:00", "09:45", "Matematiikka", en("Kotitehtävä tekemättä", "Homework not done"), "Laura Mäkinen", en("Kirjan sivu 34 jäi tekemättä.", "Page 34 of the book wasn't done.")),
    note(d(-6), "10:15", "11:00", "Ympäristöoppi", en("Hyvää työskentelyä", "Good work"), "Laura Mäkinen", en("Otso auttoi muita ryhmätyössä ja keksi hienon tavan mitata puun korkeuden.", "Otso helped others in the group work and came up with a clever way to measure a tree's height.")),
  ];

  const exam = (examId: number, date: string, time: string, subject: string, code: string, topic: string, teacher: string, teacherCode: string): UpcomingExam => ({
    examId,
    date,
    time,
    // "Matematiikan koe", "Ruotsin koe": Finnish bends the subject's name.
    name: en(`${{ Matematiikka: "Matematiikan" }[subject] ?? `${subject}n`} koe`, `${SUBJECTS_EN[subject] ?? subject} exam`),
    subject,
    subjectCode: code,
    topic,
    teacher,
    teacherCode,
  });

  const firstSyncAt = at(d(-2), "12:00").getTime();
  const kiiaLessons = lessons(KIIA_WEEK, monday);
  const otsoLessons = lessons(OTSO_WEEK, monday, { date: tomorrow, from: "10:00" });

  return {
    version: 1,
    account: KIIAS_WILMA,
    logins: [
      { slot: 0, account: KIIAS_WILMA, students: [{ number: KIIA, name: "Kiia Virtanen" }], firstSyncAt },
      { slot: 1, account: OTSOS_WILMA, students: [{ number: OTSO, name: "Otso Virtanen" }], firstSyncAt },
    ],
    children: [
      { number: KIIA, name: "Kiia Virtanen", first: "Kiia", color: 0 },
      { number: OTSO, name: "Otso Virtanen", first: "Otso", color: 1 },
    ],
    perChild: {
      [KIIA]: {
        overview: {
          schedule: [],
          upcomingExams: [],
          grades: kiiaFront,
          homework: [
            { date: d(-1), subject: "Matematiikka", subjectCode: "MA_81", homework: en("Kertauspaketti s. 1–4", "Revision pack pp. 1–4"), teacher: "Jussi Korhonen", teacherCode: "KOJ" },
            { date: d(-1), subject: "Englanti", subjectCode: "ENA_81", homework: en("Unit 3: sanat ja tekstin käännös", "Unit 3: the words, and translating the text"), teacher: "Anna Nieminen", teacherCode: "NIA" },
            { date: d(-2), subject: "Ruotsi", subjectCode: "RUB_81", homework: en("Kpl 5 sanat, kuulustelu torstaina", "Chapter 5 words, a test on Thursday"), teacher: "Maria Holm", teacherCode: "HOM" },
          ],
          fetchedAt: new Date(),
        },
        gradebook: {
          fetchedAt: new Date(),
          entries: [
            ["Matematiikka", "MA", "9", ["8+", "9", "9-", "9"]],
            ["Suomen kieli ja kirjallisuus", "ÄI", "9", ["9", "9", "9+", "9"]],
            ["Englanti, A1", "ENA1", "10", ["9", "9+", "10", "10"]],
            ["Ruotsi, B1", "RUB1", "8", ["8", "8+", "8-", "8"]],
            ["Historia", "HI", "9", ["8", "9"]],
            ["Biologia", "BI", "8", ["9", "8"]],
            ["Kuvataide", "KU", "S", ["S", "S"]],
          ].map(([name, code, grade, courses]) => ({
            name: name as string,
            code: null,
            grade: grade as string,
            credits: null,
            date: null,
            children: (courses as string[]).map((c, i) => ({ name: name as string, code: `${code}_${["61", "6LV", "71", "7LV"][i + (4 - (courses as string[]).length)]}`, grade: c, credits: null, date: ["2024-12-20", "2025-05-31", "2025-12-19", "2026-05-29"][i + (4 - (courses as string[]).length)], children: [] })),
          })),
        },
        pastExams: { exams: kiiaPast, fetchedAt: new Date(), v: 2 },
        lessons: kiiaLessons,
        notes: kiiaNotes,
        exams: [
          exam(
            1,
            mathExam,
            "08:15",
            "Matematiikka",
            "MA",
            en(
              "Koealue:\nkpl 1–4 Yhtälöt ja niiden ratkaiseminen s. 8–41\nkpl 5–7 Verrannollisuus ja kääntäen verrannollisuus s. 42–66\nkpl 8–9 Prosenttilaskut s. 67–80\nKertaa myös vihon tehtävät ja kertauspaketti s. 1–4.",
              "What it covers:\nch. 1–4 Equations and solving them pp. 8–41\nch. 5–7 Proportionality and inverse proportionality pp. 42–66\nch. 8–9 Percentages pp. 67–80\nAlso go over the exercises in your notebook and the revision pack pp. 1–4."
            ),
            "Jussi Korhonen",
            "KOJ"
          ),
          exam(2, next(d(3), 4, 1), "09:10", "Ruotsi", "RUB", en("Kappaleet 1–6, sanasto ja preesens", "Chapters 1–6, vocabulary and the present tense"), "Maria Holm", "HOM"),
        ],
        syncedAt: new Date(),
      },
      [OTSO]: {
        overview: {
          schedule: [],
          upcomingExams: [],
          grades: [],
          homework: [
            { date: d(-1), subject: "Matematiikka", subjectCode: "MA_3B", homework: en("Kertotaulut 6 ja 7, s. 36", "Times tables 6 and 7, p. 36"), teacher: "Laura Mäkinen", teacherCode: "MÄL" },
            { date: d(-1), subject: "Äidinkieli", subjectCode: "ÄI_3B", homework: en("Lue kirjasta luku 4 ääneen", "Read chapter 4 of the book aloud"), teacher: "Laura Mäkinen", teacherCode: "MÄL" },
          ],
          fetchedAt: new Date(),
        },
        pastExams: { exams: otsoPast, fetchedAt: new Date(), v: 2 },
        lessons: otsoLessons,
        notes: otsoNotes,
        exams: [],
        syncedAt: new Date(),
      },
    },
    // What Otso's school sent comes through its Wilma, with ids that carry its slot.
    messages: Object.fromEntries(messages.map((m) => (m.children.includes(OTSO) ? { ...m, id: familyId(1, m.id) } : m)).map((m) => [m.id, m])),
    news: Object.fromEntries(news.map((n) => [n.id, n])),
    syncedAt: new Date(),
    firstSyncAt,
  };
}
