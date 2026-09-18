PRAGMA foreign_keys=ON;
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE sessions (
  session_key TEXT PRIMARY KEY,
  incarnation TEXT NOT NULL,
  scope_json TEXT NOT NULL CHECK(json_valid(scope_json)),
  host_epoch INTEGER NOT NULL DEFAULT 0 CHECK(host_epoch>=0),
  view_revision INTEGER NOT NULL DEFAULT 0 CHECK(view_revision>=0),
  policy_revision INTEGER NOT NULL DEFAULT 0 CHECK(policy_revision>=0),
  publication_seq INTEGER NOT NULL DEFAULT 0 CHECK(publication_seq>=0),
  activation_seq INTEGER NOT NULL DEFAULT 0 CHECK(activation_seq>=0),
  owner_fence INTEGER NOT NULL DEFAULT 0 CHECK(owner_fence>=0),
  owner_id TEXT, lease_until_ms INTEGER,
  mode TEXT NOT NULL CHECK(mode IN ('complete','assisted','unsupported')),
  paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN (0,1)),
  dispatch_blocked INTEGER NOT NULL DEFAULT 0 CHECK(dispatch_blocked IN (0,1)),
  config_json TEXT NOT NULL CHECK(json_valid(config_json)),
  counters_json TEXT NOT NULL CHECK(json_valid(counters_json)),
  created_at TEXT NOT NULL,
  UNIQUE(session_key,incarnation)
);
CREATE TABLE sources (
  session_key TEXT NOT NULL REFERENCES sessions(session_key) ON DELETE CASCADE,
  source_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>=0),
  digest TEXT CHECK(digest IS NULL OR (length(digest)=64 AND digest NOT GLOB '*[^0-9a-f]*')),
  native_refs_json TEXT NOT NULL CHECK(json_valid(native_refs_json)),
  availability TEXT NOT NULL CHECK(availability IN ('captured','excluded','missing','deleted')),
  media_type TEXT NOT NULL, size_bytes INTEGER NOT NULL CHECK(size_bytes>=0),
  inline_bytes BLOB, blob_key TEXT, policy_revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(session_key,source_id,revision),
  CHECK((availability='captured' AND digest IS NOT NULL AND
    ((inline_bytes IS NOT NULL AND blob_key IS NULL) OR (inline_bytes IS NULL AND blob_key IS NOT NULL)))
    OR (availability<>'captured' AND inline_bytes IS NULL AND blob_key IS NULL))
);
CREATE TABLE root_units (
  session_key TEXT NOT NULL REFERENCES sessions(session_key) ON DELETE CASCADE,
  host_epoch INTEGER NOT NULL, native_identity TEXT NOT NULL,
  unit_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>=0),
  unit_digest TEXT NOT NULL, payload_digest TEXT NOT NULL,
  record_json TEXT NOT NULL CHECK(json_valid(record_json)),
  PRIMARY KEY(session_key,host_epoch,unit_id,revision),
  UNIQUE(session_key,host_epoch,native_identity,revision)
);
CREATE TABLE jobs (
  job_id TEXT PRIMARY KEY,
  session_key TEXT NOT NULL REFERENCES sessions(session_key) ON DELETE CASCADE,
  incarnation TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','running','ready','published','rejected','failed','cancelled')),
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),
  proposal_json TEXT CHECK(proposal_json IS NULL OR json_valid(proposal_json)),
  owner_fence INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 2),
  deadline_at TEXT NOT NULL, error_code TEXT,
  usage_json TEXT CHECK(usage_json IS NULL OR json_valid(usage_json)),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(session_key,job_id)
);
CREATE UNIQUE INDEX one_active_job ON jobs(session_key)
  WHERE status IN ('queued','running','ready');
CREATE TABLE aux_runs (
  run_id TEXT PRIMARY KEY, session_key TEXT NOT NULL, job_id TEXT NOT NULL,
  attempt_no INTEGER NOT NULL CHECK(attempt_no BETWEEN 1 AND 2),
  state TEXT NOT NULL CHECK(state IN ('reserved','running','stopped','quarantine')),
  remote_state TEXT NOT NULL CHECK(remote_state IN ('unknown','confirmed')),
  local_stopped INTEGER NOT NULL CHECK(local_stopped IN (0,1)),
  UNIQUE(session_key,job_id,attempt_no),
  FOREIGN KEY(session_key,job_id) REFERENCES jobs(session_key,job_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX one_local_run ON aux_runs(session_key) WHERE state<>'stopped';
CREATE TABLE attempts (
  attempt_id TEXT PRIMARY KEY, session_key TEXT NOT NULL, job_id TEXT NOT NULL,
  attempt_no INTEGER NOT NULL CHECK(attempt_no BETWEEN 1 AND 2),
  state TEXT NOT NULL CHECK(state IN ('reserved','dispatched','completed','failed','cancelled','unknown')),
  input_reserved INTEGER NOT NULL CHECK(input_reserved>=0),
  output_reserved INTEGER NOT NULL CHECK(output_reserved>=0),
  request_id TEXT, usage_json TEXT CHECK(usage_json IS NULL OR json_valid(usage_json)),
  UNIQUE(job_id,attempt_no),
  FOREIGN KEY(session_key,job_id,attempt_no) REFERENCES aux_runs(session_key,job_id,attempt_no),
  FOREIGN KEY(session_key,job_id) REFERENCES jobs(session_key,job_id) ON DELETE CASCADE
);
CREATE TABLE operations (
  operation_id TEXT PRIMARY KEY,
  session_key TEXT NOT NULL REFERENCES sessions(session_key) ON DELETE CASCADE,
  request_id TEXT NOT NULL, input_digest TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('compaction','block','correction','restore','redaction','reset')),
  actor TEXT NOT NULL CHECK(actor IN ('user','authorized_flow','maintenance')),
  job_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('committed','cleanup_pending')),
  expected_revision INTEGER NOT NULL, result_revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(session_key,request_id), UNIQUE(session_key,operation_id), UNIQUE(job_id),
  CHECK((kind='compaction' AND job_id IS NOT NULL) OR (kind<>'compaction' AND job_id IS NULL)),
  FOREIGN KEY(session_key,job_id) REFERENCES jobs(session_key,job_id)
);
CREATE TABLE chapters (
  chapter_id TEXT PRIMARY KEY, session_key TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  host_epoch INTEGER NOT NULL CHECK(host_epoch>=0),
  digest TEXT,
  coverage_json TEXT NOT NULL CHECK(json_valid(coverage_json)),
  logical_json TEXT NOT NULL CHECK(json_valid(logical_json)),
  dependencies_json TEXT NOT NULL CHECK(json_valid(dependencies_json)),
  parents_json TEXT NOT NULL CHECK(json_valid(parents_json)),
  manifest_json TEXT CHECK(manifest_json IS NULL OR json_valid(manifest_json)),
  proposal_json TEXT CHECK(proposal_json IS NULL OR json_valid(proposal_json)),
  status TEXT NOT NULL CHECK(status IN ('published','superseded','invalidated','withdrawn','redacted')),
  created_at TEXT NOT NULL,
  UNIQUE(session_key,chapter_id),
  CHECK(status='redacted' OR (proposal_json IS NOT NULL AND manifest_json IS NOT NULL AND digest IS NOT NULL)),
  FOREIGN KEY(session_key,operation_id) REFERENCES operations(session_key,operation_id)
);
CREATE TABLE views (
  session_key TEXT NOT NULL REFERENCES sessions(session_key) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK(revision>=0),
  host_epoch INTEGER NOT NULL, policy_revision INTEGER NOT NULL,
  replacements_json TEXT NOT NULL CHECK(json_valid(replacements_json)),
  blocks_json TEXT NOT NULL CHECK(json_valid(blocks_json)),
  suppressed_json TEXT NOT NULL CHECK(json_valid(suppressed_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(session_key,revision)
);
CREATE TABLE blocks (
  session_key TEXT NOT NULL REFERENCES sessions(session_key) ON DELETE CASCADE,
  block_id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>=1),
  kind TEXT NOT NULL CHECK(kind IN ('presence','reference','curated','retention')),
  authority TEXT NOT NULL CHECK(authority IN ('user','host','agent','external')),
  text TEXT, digest TEXT,
  scope_json TEXT NOT NULL CHECK(json_valid(scope_json)),
  sources_json TEXT NOT NULL CHECK(json_valid(sources_json)),
  expires_publication_seq INTEGER, created_at TEXT NOT NULL,
  PRIMARY KEY(session_key,block_id,version)
);
CREATE TABLE dependencies (
  session_key TEXT NOT NULL REFERENCES sessions(session_key) ON DELETE CASCADE,
  from_ref TEXT NOT NULL CHECK(json_valid(from_ref)),
  to_ref TEXT NOT NULL CHECK(json_valid(to_ref)),
  relation TEXT NOT NULL CHECK(relation IN ('content','history')),
  PRIMARY KEY(session_key,from_ref,to_ref,relation)
);
CREATE TABLE retrievals (
  retrieval_id TEXT PRIMARY KEY,
  incarnation TEXT NOT NULL,
  host_epoch INTEGER NOT NULL CHECK(host_epoch>=0),
  host_message_id TEXT NOT NULL, tool_call_id TEXT NOT NULL,
  request_digest TEXT NOT NULL CHECK(length(request_digest)=64 AND request_digest NOT GLOB '*[^0-9a-f]*'),
  response_digest TEXT NOT NULL CHECK(length(response_digest)=64 AND response_digest NOT GLOB '*[^0-9a-f]*'),
  session_key TEXT NOT NULL REFERENCES sessions(session_key) ON DELETE CASCADE,
  chapter_id TEXT,
  source_ref_json TEXT CHECK(source_ref_json IS NULL OR json_valid(source_ref_json)),
  work_json TEXT NOT NULL CHECK(json_valid(work_json)),
  range_json TEXT NOT NULL CHECK(json_valid(range_json)),
  text_digest TEXT NOT NULL, excerpt_text TEXT,
  reason TEXT NOT NULL CHECK(reason IN ('lookup','missing_detail','omitted_rule','correction')),
  declared_by TEXT NOT NULL CHECK(declared_by IN ('agent','user','unspecified')),
  created_at TEXT NOT NULL, consumed_by_job TEXT,
  UNIQUE(session_key,incarnation,host_epoch,host_message_id,tool_call_id),
  FOREIGN KEY(session_key,incarnation) REFERENCES sessions(session_key,incarnation) ON DELETE CASCADE,
  FOREIGN KEY(session_key,chapter_id) REFERENCES chapters(session_key,chapter_id),
  FOREIGN KEY(session_key,consumed_by_job) REFERENCES jobs(session_key,job_id)
);
CREATE TABLE emissions (
  emission_id TEXT PRIMARY KEY,
  session_key TEXT NOT NULL REFERENCES sessions(session_key) ON DELETE CASCADE,
  frame_id TEXT NOT NULL, transport_attempt INTEGER NOT NULL,
  view_revision INTEGER NOT NULL, fingerprint TEXT NOT NULL,
  selected_at TEXT NOT NULL, emitted_at TEXT, acknowledged_at TEXT,
  request_id TEXT, usage_json TEXT CHECK(usage_json IS NULL OR json_valid(usage_json)),
  UNIQUE(session_key,frame_id,transport_attempt)
);
CREATE TABLE blobs (digest TEXT PRIMARY KEY, size_bytes INTEGER NOT NULL CHECK(size_bytes>=0), created_at TEXT NOT NULL);
CREATE TABLE storage_owners (
  owner_id TEXT PRIMARY KEY, process_instance TEXT NOT NULL,
  liveness_lock_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('active','retired')),
  created_at TEXT NOT NULL
);
CREATE TABLE storage_reservations (
  reservation_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES storage_owners(owner_id),
  operation_id TEXT NOT NULL, staging_path_key TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('staging','read_pin','export_pin')),
  blob_digest TEXT, session_key TEXT, incarnation TEXT,
  size_bytes INTEGER NOT NULL CHECK(size_bytes>=0), created_at TEXT NOT NULL
);
CREATE TABLE tombstones (scope_hash TEXT NOT NULL, identity TEXT NOT NULL, reason TEXT NOT NULL, PRIMARY KEY(scope_hash,identity));
CREATE TABLE managed_files (
  path_key TEXT PRIMARY KEY, kind TEXT NOT NULL, operation_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('staging','complete','cleanup_pending')),
  scopes_json TEXT NOT NULL CHECK(json_valid(scopes_json))
);
CREATE INDEX chapters_by_session ON chapters(session_key,created_at,chapter_id);
CREATE INDEX retrievals_by_session ON retrievals(session_key,created_at,retrieval_id);
