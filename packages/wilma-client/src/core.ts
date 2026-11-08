/*
 * @wilm-ai/wilma-client/core: the client for any JavaScript runtime (a
 * browser, a desktop app's web view, Node). It has no Node-only imports and
 * sends requests through the transport it's given (ClientOptions.transport, or
 * setDefaultTransport). The main entry point is this plus Node's defaults.
 */
export type {
  Exam,
  ExamGrade,
  GradebookEntry,
  HomeworkItem,
  Invitation,
  InvitationListing,
  InvitationSlot,
  InvitationSlotState,
  MessageRecipient,
  StudentDetails,
  LessonNote,
  LessonNoteSummary,
  Message,
  MessageReply,
  MessageFolder,
  Municipality,
  NewsItem,
  NewsResource,
  NewsResourceAuthContext,
  OverviewData,
  PastExam,
  Printout,
  ScheduleLesson,
  TenantDiscoveryResponse,
  TenantInfo,
  UpcomingExam,
  WilmaProfile,
  StudentInfo,
} from "./types.js";
export { WilmaClient } from "./client.js";
export type { MfaCallback, ClientOptions, ResumeProfile } from "./client.js";
export { WilmaSession, AuthenticationError, MfaRequiredError, APIError, SessionEndedError, CredentialsUnavailableError, LoginBlockedError } from "./session.js";
export type { SessionOptions, RequestInit, SharedSession, SessionEvent, PasswordSource } from "./session.js";
export { setDefaultTransport } from "./transport.js";
export type { WilmaTransport, WilmaRequest, WilmaReply } from "./transport.js";
export { DOWNLOAD_TIMEOUT_MS, isHtmlResponse, setExternalFetcher } from "./downloads.js";
export type { ExternalFetcher } from "./downloads.js";
export { NetworkError, describeNetworkCode, extractCauseCode, wrapNetworkError } from "./network-error.js";
export { parseWilmaTimestamp } from "./parsers/dates.js";
export { finnishDateString, finnishIsoString, finnishParts, finnishTime } from "./finnish-time.js";
export { parseStudentsFromHome } from "./parsers/students.js";
export { htmlToText } from "./parsers/html-text.js";
export { addExamTimes, parsePastExamsHtml } from "./parsers/exams.js";
export { awaitingAnswer, slotState } from "./parsers/invitations.js";
