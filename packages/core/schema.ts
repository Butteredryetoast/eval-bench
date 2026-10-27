import { pgTable, text, integer, jsonb, uniqueIndex, boolean } from 'drizzle-orm/pg-core';
import type { CaseData, RunSpec, Usage, ExecutionStatus, Verdict, ExecutionMetadata } from '../contracts/index';

export const editorialRecords = pgTable('editorial_records', {
  id: text('id').primaryKey(), kind: text('kind').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>().notNull(),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull()
});

export const cases = pgTable('cases', {
  id: text('id').primaryKey(), versionId: text('version_id').notNull(), version: integer('version').notNull(),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(), favorite: boolean('favorite').notNull().default(false)
});
export const caseVersions = pgTable('case_versions', {
  id: text('id').primaryKey(), caseId: text('case_id').notNull().references(() => cases.id),
  version: integer('version').notNull(), data: jsonb('data').$type<CaseData>().notNull(),
  hash: text('hash').notNull(), createdAt: text('created_at').notNull()
}, t => [uniqueIndex('case_version_unique').on(t.caseId, t.version)]);
export const files = pgTable('files', {
  id: text('id').primaryKey(), name: text('name').notNull(), mime: text('mime').notNull(),
  size: integer('size').notNull(), sha256: text('sha256').notNull(), role: text('role').notNull(),
  attemptId: text('attempt_id'), createdAt: text('created_at').notNull()
}, t => [uniqueIndex('files_attempt_name_unique').on(t.attemptId, t.name)]);
export const runs = pgTable('runs', {
  name: text('name').notNull().default(''), pinned: boolean('pinned').notNull().default(false),
  id: text('id').primaryKey(), spec: jsonb('spec').$type<RunSpec>().notNull(),
  requestKey: text('request_key').notNull().unique(), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
  runnerId: text('runner_id'), leaseGeneration: integer('lease_generation').notNull().default(0),
  leaseExpiresAt: text('lease_expires_at'), lastHeartbeatAt: text('last_heartbeat_at')
});
export const results = pgTable('results', {
  id: text('id').primaryKey(), runId: text('run_id').notNull().references(() => runs.id),
  caseVersionId: text('case_version_id').notNull().references(() => caseVersions.id), profileId: text('profile_id').notNull(),
  status: text('status').$type<ExecutionStatus>().notNull().default('pending'), attemptId: text('attempt_id')
}, t => [uniqueIndex('result_slot_unique').on(t.runId, t.caseVersionId, t.profileId)]);
export const attempts = pgTable('attempts', {
  id: text('id').primaryKey(), resultId: text('result_id').notNull().references(() => results.id),
  number: integer('number').notNull(), status: text('status').$type<ExecutionStatus>().notNull(),
  startedAt: text('started_at').notNull(), finishedAt: text('finished_at'), outputText: text('output_text').notNull().default(''),
  error: text('error'), durationMs: integer('duration_ms'), usage: jsonb('usage').$type<Usage>().notNull(),
  reportedModel: text('reported_model'), adapterVersion: text('adapter_version').notNull(), logs: text('logs').notNull().default(''),
  conversationTurnId: text('conversation_turn_id'), kind: text('kind').notNull().default('initial'), metadata: jsonb('metadata').$type<ExecutionMetadata>().notNull().default({}),
  eventSeq: integer('event_seq').notNull().default(0)
}, t => [uniqueIndex('attempt_number_unique').on(t.resultId, t.number)]);
export const annotations = pgTable('annotations', {
  attemptId: text('attempt_id').primaryKey().references(() => attempts.id), verdict: text('verdict').$type<Verdict>(),
  note: text('note').notNull().default(''), revision: integer('revision').notNull().default(0),
  updatedAt: text('updated_at').notNull(), updatedBy: text('updated_by').notNull()
});
export const annotationEvents = pgTable('annotation_events', {
  id: text('id').primaryKey(), attemptId: text('attempt_id').notNull().references(() => attempts.id),
  verdict: text('verdict').$type<Verdict>(), note: text('note').notNull(), at: text('at').notNull(), by: text('by').notNull()
});
export const devices = pgTable('devices', {
  id: text('id').primaryKey(), tokenHash: text('token_hash').notNull().unique(), name: text('name').notNull(), createdAt: text('created_at').notNull()
});

export const conversationSessions = pgTable('conversation_sessions', {
  id: text('id').primaryKey(), initialAttemptId: text('initial_attempt_id').notNull().unique().references(() => attempts.id),
  resultId: text('result_id').notNull().references(() => results.id), nativeThreadId: text('native_thread_id').notNull(), model: text('model').notNull(),
  activeTurnId: text('active_turn_id'), nativeBusy: boolean('native_busy').notNull().default(false), cancelRequested: boolean('cancel_requested').notNull().default(false),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(), lastSyncedAt: text('last_synced_at'), syncError: text('sync_error')
});
export const conversationTurns = pgTable('conversation_turns', {
  id: text('id').primaryKey(), sessionId: text('session_id').notNull().references(() => conversationSessions.id),
  number: integer('number').notNull(), prompt: text('prompt').notNull(), source: text('source').notNull(), nativeTurnId: text('native_turn_id'),
  attemptId: text('attempt_id').notNull().references(() => attempts.id), requestKey: text('request_key').notNull().unique(), retryCount: integer('retry_count').notNull().default(0),
  runnerId: text('runner_id'), lease: text('lease'), heartbeatAt: text('heartbeat_at'), createdAt: text('created_at').notNull()
}, t => [uniqueIndex('conversation_turn_number_unique').on(t.sessionId, t.number), uniqueIndex('conversation_native_turn_unique').on(t.sessionId, t.nativeTurnId)]);
