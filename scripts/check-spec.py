#!/usr/bin/env python3
"""Offline documentation checks only. This does not test the Context Continuity runtime."""
from __future__ import annotations

import hashlib
import re
import sqlite3
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
SPEC = ROOT / "specs/v0.1"
AXIOMS = (
    "Success Criteria", "Quality Standards", "Completeness Criteria",
    "Definition of Done", "Invariants",
)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def validate_markdown() -> int:
    documents = [ROOT / "README.md", ROOT / "AGENTS.md"]
    documents += sorted((ROOT / "docs").rglob("*.md"))
    documents += sorted(SPEC.rglob("*.md"))
    for path in documents:
        text = path.read_text(encoding="utf-8")
        fences = re.findall(r"^\s*```", text, flags=re.MULTILINE)
        require(len(fences) % 2 == 0, f"Unclosed code fence: {path.relative_to(ROOT)}")
        for target in re.findall(r"\[[^\]\n]+\]\(([^)\s]+)\)", text):
            url = urlsplit(target)
            if url.scheme or target.startswith("#"):
                continue
            relative = unquote(url.path)
            require(bool(relative), f"Empty link in {path.relative_to(ROOT)}")
            resolved = (path.parent / relative).resolve()
            require(resolved.is_relative_to(ROOT), f"Link escapes repository: {target}")
            require(resolved.exists(), f"Broken link in {path.relative_to(ROOT)}: {target}")
    return len(documents)


def validate_traceability() -> None:
    acceptance = (SPEC / "06-acceptance.md").read_text(encoding="utf-8")
    requirements = re.findall(r"^\| (R\d{2}) \|", acceptance, re.MULTILINE)
    cases = re.findall(r"^### (T\d{2}) —", acceptance, re.MULTILINE)
    require(requirements == [f"R{i:02}" for i in range(1, 37)], "Expected unique ordered R01-R36")
    require(cases == [f"T{i:02}" for i in range(1, 41)], "Expected unique ordered T01-T40")
    work = (SPEC / "WORK-PACKAGES.md").read_text(encoding="utf-8")
    parts = re.split(r"^## (WP-\d{2}) —", work, flags=re.MULTILINE)
    ids = parts[1::2]
    require(ids == [f"WP-{i:02}" for i in range(8)], "Expected WP-00-WP-07 exactly once")
    for ident, body in zip(ids, parts[2::2]):
        for axiom in AXIOMS:
            count = len(re.findall(r"^### " + re.escape(axiom) + r"$", body, re.MULTILINE))
            require(count == 1, f"{ident}: expected one {axiom}, found {count}")
        require("**Dependências:**" in body, f"{ident}: missing dependencies")
        require("**Evidência esperada:**" in body, f"{ident}: missing evidence")
    for row in acceptance.splitlines():
        if not re.match(r"^\| R\d{2} \|", row):
            continue
        cells = [item.strip() for item in row.split("|")[1:-1]]
        require(len(cells) == 5, f"Malformed requirement row: {row}")
        require(cells[3] in ids, f"Unknown owner in {row}")
        require(cells[4] in cases, f"Unknown acceptance test in {row}")
    for path in [*SPEC.glob("*.md"), ROOT / "docs/reviews/REVIEW-001.md"]:
        text = path.read_text(encoding="utf-8")
        for ident in re.findall(r"\bT\d{2}\b", text):
            require(ident in cases, f"Undefined test {ident} in {path.name}")
        for ident in re.findall(r"\bR\d{2}\b", text):
            require(ident in requirements, f"Undefined requirement {ident} in {path.name}")
        for ident in re.findall(r"\bWP-\d{2}\b", text):
            require(ident in ids, f"Undefined work package {ident} in {path.name}")
    review = (ROOT / "docs/reviews/REVIEW-001.md").read_text(encoding="utf-8")
    findings = re.findall(r"^\| (A\d{2}) \|", review, re.MULTILINE)
    require(findings == [f"A{i:02}" for i in range(1, 17)], "Expected A01-A16 findings")


def validate_archive() -> None:
    data = (ROOT / "docs/history/RFC-CSC-001-v0.1.md").read_bytes()
    git_blob = hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest()
    require(git_blob == "701d9fa06f8bf39065085048b6be6bb20b52b112", "Historical RFC changed")


def validate_reference_ddl() -> None:
    text = (SPEC / "03-ledger.md").read_text(encoding="utf-8")
    blocks = re.findall(r"```sql\n(.*?)\n```", text, re.DOTALL)
    require(len(blocks) == 1, "Expected one normative SQL block")
    with sqlite3.connect(":memory:") as db:
        db.execute("PRAGMA foreign_keys=ON")
        db.executescript(blocks[0])
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        require(tables == {"meta", "sessions", "sources", "jobs", "chapters", "views", "blocks", "retrievals", "emissions"}, "Unexpected reference schema")
        db.execute("INSERT INTO sessions(session_key,scope_json,mode,config_json,counters_json,created_at) VALUES (?,?,?,?,?,?)", ("fixture", "{}", "complete", "{}", "{}", "2026-09-17T00:00:00Z"))
        job_sql = "INSERT INTO jobs(job_id,session_key,status,snapshot_json,owner_fence,deadline_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)"
        fields = ("fixture", "queued", "{}", 1, "2026-09-17T00:05:00Z", "2026-09-17T00:00:00Z", "2026-09-17T00:00:00Z")
        db.execute(job_sql, ("first", *fields))
        try:
            db.execute(job_sql, ("second", *fields))
        except sqlite3.IntegrityError:
            pass
        else:
            raise ValueError("one_active_job failed to reject a duplicate active job")
        db.execute("UPDATE jobs SET status='published' WHERE job_id='first'")
        db.execute(job_sql, ("second", *fields))
        require(db.execute("SELECT count(*) FROM jobs").fetchone()[0] == 2, "Terminal job incorrectly blocks new job")
        require(not list(db.execute("PRAGMA foreign_key_check")), "Reference DDL FK violation")


def main() -> int:
    try:
        documents = validate_markdown()
        validate_traceability()
        validate_archive()
        validate_reference_ddl()
    except (OSError, ValueError, sqlite3.Error) as exc:
        print(f"SPEC CHECK FAILED: {exc}", file=sys.stderr)
        return 1
    print(f"PASS: {documents} Markdown files; local links and closed fences.")
    print("PASS: 16 findings, 36 requirements, 40 test specifications, 8 work packages with all 5 axioms.")
    print("PASS: original RFC Git blob unchanged; reference SQLite DDL and partial unique index valid.")
    print("NOT TESTED: plugin/runtime, OpenCode integration, provider cache, semantic quality, performance.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
