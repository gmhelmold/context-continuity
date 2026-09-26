CREATE TABLE scheduler_state (
  session_key TEXT PRIMARY KEY REFERENCES sessions(session_key) ON DELETE CASCADE,
  incarnation TEXT NOT NULL,
  armed INTEGER NOT NULL CHECK(armed IN (0,1)),
  last_attempt_host_epoch INTEGER CHECK(last_attempt_host_epoch IS NULL OR last_attempt_host_epoch>=0),
  last_attempt_coverage_digest TEXT,
  last_attempt_policy_revision INTEGER CHECK(last_attempt_policy_revision IS NULL OR last_attempt_policy_revision>=0),
  last_attempt_config_digest TEXT,
  low_water_observed INTEGER NOT NULL DEFAULT 0 CHECK(low_water_observed IN (0,1)),
  low_water_host_epoch INTEGER CHECK(low_water_host_epoch IS NULL OR low_water_host_epoch>=0),
  low_water_policy_revision INTEGER CHECK(low_water_policy_revision IS NULL OR low_water_policy_revision>=0),
  low_water_config_digest TEXT,
  last_observed_eligible_tokens INTEGER CHECK(last_observed_eligible_tokens IS NULL OR last_observed_eligible_tokens>=0),
  last_observed_at_ms INTEGER CHECK(last_observed_at_ms IS NULL OR last_observed_at_ms>=0),
  CHECK((last_attempt_host_epoch IS NULL AND last_attempt_coverage_digest IS NULL AND last_attempt_policy_revision IS NULL AND last_attempt_config_digest IS NULL) OR
        (last_attempt_host_epoch IS NOT NULL AND last_attempt_coverage_digest IS NOT NULL AND last_attempt_policy_revision IS NOT NULL AND last_attempt_config_digest IS NOT NULL)),
  CHECK((low_water_observed=0 AND low_water_host_epoch IS NULL AND low_water_policy_revision IS NULL AND low_water_config_digest IS NULL) OR
        (low_water_observed=1 AND low_water_host_epoch IS NOT NULL AND low_water_policy_revision IS NOT NULL AND low_water_config_digest IS NOT NULL))
);
