export type MessageFolder =
  | "inbox"
  | "archive"
  | "outbox"
  | "drafts"
  | "appointments";

export interface Message {
  wilmaId: number;
  subject: string;
  sentAt: Date;
  folder: MessageFolder | string;
  senderId?: number | null;
  senderType?: number | null;
  senderName?: string | null;
  sendersJson?: Record<string, unknown> | null;
  status?: number | null;
  /** In lists: Wilma hasn't seen it opened yet. */
  unread?: boolean;
  /** In lists: how many replies the thread has (read them with the message). */
  replyCount?: number;
  content?: string | null;
  /** Message detail: who it went to (Wilma may hide the list). */
  recipients?: string[] | null;
  /** Message detail: the thread's replies, oldest first. */
  replies?: MessageReply[];
  fetchedAt: Date;
}

export interface MessageReply {
  id: number;
  sentAt: Date;
  senderName: string | null;
  content: string;
}

export interface NewsItem {
  wilmaId: number;
  title: string;
  subtitle?: string | null;
  author?: string | null;
  published?: Date | null;
  content?: string | null;
  resources?: NewsResource[];
  /** A pinned bulletin (Wilma: "Pysyvät tiedotteet"), kept on the page until removed. */
  pinned?: boolean;
  /** Listed among older bulletins (Wilma: "Vanhat tiedotteet"); its date is on the bulletin itself. */
  archived?: boolean;
  fetchedAt: Date;
}

export type NewsResourceAuthContext = "external" | "wilma";

export interface NewsResource {
  id: string;
  label: string;
  url: string;
  // "wilma": downloads use the authenticated Wilma session.
  // "external": downloads use an isolated, unauthenticated fetch that never
  // carries Wilma credentials. Every resource supports a download attempt;
  // the attempt's status reports whether the URL actually served a file.
  authContext: NewsResourceAuthContext;
  fileName?: string | null;
}

export interface Exam {
  wilmaId: number;
  examDate: Date;
  /** Local date string in YYYY-MM-DD format (avoids timezone serialization issues) */
  dateString: string;
  subject: string;
  description?: string | null;
  teacher?: string | null;
  notes?: string | null;
  /** Start time ("08:30") when the school gives one; only the exam calendar has it. */
  time?: string | null;
  fetchedAt: Date;
}

export interface StudentInfo {
  studentNumber: string;
  name: string;
  href: string;
}

export interface Municipality {
  nameFi: string;
  nameSv: string;
}

export interface TenantInfo {
  url: string;
  name: string;
  municipalities: Municipality[];
  formerUrl?: string | null;
}

export interface TenantDiscoveryResponse {
  wilmat: TenantInfo[];
}

export interface WilmaProfile {
  baseUrl: string;
  username: string;
  password: string;
  studentNumber?: string | null;
  debug?: boolean;
}

export interface ScheduleLesson {
  /** YYYY-MM-DD */
  date: string;
  /** 1=Monday ... 5=Friday */
  dayOfWeek: number;
  start: string;
  end: string;
  subject: string;
  subjectCode: string;
  teacher: string;
  teacherCode: string;
  groupId: number;
  /** Room code(s), e.g. "407"; null when Wilma gives none. */
  room?: string | null;
}

export interface UpcomingExam {
  examId: number;
  /** YYYY-MM-DD */
  date: string;
  /** Start time ("08:30") when the school gives one (from the exam calendar). */
  time?: string | null;
  name: string;
  subject: string;
  subjectCode: string;
  topic: string | null;
  teacher: string;
  teacherCode: string;
}

export interface ExamGrade {
  examId: number;
  /** YYYY-MM-DD */
  date: string;
  name: string;
  subject: string;
  subjectCode: string;
  grade: string;
  verbalGrade: string | null;
  info: string | null;
  teacher: string;
  teacherCode: string;
}

export interface HomeworkItem {
  /** YYYY-MM-DD */
  date: string;
  subject: string;
  subjectCode: string;
  homework: string;
  teacher: string;
  teacherCode: string;
}

export interface OverviewData {
  schedule: ScheduleLesson[];
  upcomingExams: UpcomingExam[];
  grades: ExamGrade[];
  homework: HomeworkItem[];
  fetchedAt: Date;
}

/**
 * A lesson note from the attendance/lesson notes page.
 * start/end are string | null — null when time-slot derivation
 * falls outside the assumed 08:00–15:00 range (see parseAttendanceHtml).
 */
export interface LessonNote {
  /** YYYY-MM-DD */
  date: string;
  start: string | null;
  end: string | null;
  subject: string;
  typeLabel: string;
  typeClass: string;
  teacher: string;
  /** The teacher's own words, when they wrote any (e.g. what was missing, or praise). */
  note?: string | null;
}

/** How many lesson notes of each kind in a period (absences, lateness, feedback…). */
export interface LessonNoteSummary {
  /** YYYY-MM-DD, or null for "the whole school year" as Wilma defines it. */
  from: string | null;
  to: string | null;
  total: number;
  byType: { type: string; count: number }[];
}

/** One row of the gradebook (Suoritukset): a subject, a syllabus or a course, with its sub-rows. */
export interface GradebookEntry {
  name: string;
  /** Course code such as "MA_81" (null for subject rows). */
  code: string | null;
  grade: string | null;
  /** Scope as Wilma shows it (e.g. "2 vvt"), if any. */
  credits: string | null;
  /** YYYY-MM-DD when completed. */
  date: string | null;
  children: GradebookEntry[];
}

/** A printable document Wilma offers as a PDF (report cards, absence reports…). */
export interface Printout {
  id: string;
  title: string;
  /** Path on this Wilma, e.g. "/!123/printouts/456.pdf". */
  path: string;
}
