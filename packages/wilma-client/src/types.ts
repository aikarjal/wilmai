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
  content?: string | null;
  fetchedAt: Date;
}

export interface NewsItem {
  wilmaId: number;
  title: string;
  subtitle?: string | null;
  author?: string | null;
  published?: Date | null;
  content?: string | null;
  resources?: NewsResource[];
  fetchedAt: Date;
}

export type NewsResourceKind = "external_link" | "wilma_attachment";
export type NewsResourceAuthContext = "external" | "wilma";
export type NewsResourceAction = "open" | "download";

export interface NewsResource {
  id: string;
  label: string;
  url: string;
  kind: NewsResourceKind;
  authContext: NewsResourceAuthContext;
  availableActions: NewsResourceAction[];
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
}

export interface UpcomingExam {
  examId: number;
  /** YYYY-MM-DD */
  date: string;
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
}
