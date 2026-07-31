#!/usr/bin/env python3
"""
Token usage parser for Claude Code transcripts.

Modes:
  --transcript <path>  Parse single transcript file (used by SessionEnd hook)
  --reconcile          Scan all transcripts; parse those not in the sidecar ledger or modified since last parse (not CSV-mtime gated)
  --rebuild            Wipe CSV and re-parse all transcripts from scratch

Output: JSON summary to stdout
CSV: .claude/usage.csv (atomic writes via os.replace)
Sidecar: .claude/.parsed_sessions.json tracks all ever-parsed session_ids
         (including zero-row transcripts) so reconcile is truly idempotent.
"""

import argparse
import csv
import json
import os
import sys
import glob
from datetime import datetime, timezone

# ── Paths ──────────────────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CLAUDE_DIR = os.path.dirname(SCRIPT_DIR)  # .claude/
CSV_PATH = os.path.join(CLAUDE_DIR, "usage.csv")
PARSED_SESSIONS_PATH = os.path.join(CLAUDE_DIR, ".parsed_sessions.json")


def resolve_transcripts_glob(project_dir: str | None = None) -> str:
    """
    Return the glob pattern for transcript JSONL files scoped to this project.

    If project_dir is given (e.g. passed from hook via --project-dir), use it
    directly as the transcript directory.

    Otherwise fall back to encoding the project root (parent of .claude/) into
    the Claude transcript path convention:
        ~/.claude/projects/<encoded>/  where <encoded> = abs-path with / → -
    """
    if project_dir:
        expanded = os.path.expanduser(project_dir)
        return os.path.join(expanded, "*.jsonl")

    # Fallback: derive from this script's own project root
    project_root = os.path.abspath(os.path.dirname(CLAUDE_DIR))
    encoded = project_root.replace("/", "-")
    transcript_dir = os.path.expanduser(f"~/.claude/projects/{encoded}")
    return os.path.join(transcript_dir, "*.jsonl")

CSV_HEADER = [
    "Session_ID",
    "Session_Name",
    "Model",
    "Effort",
    "Billable_Tokens",
    "Cache_Tokens",
    "Total_Tokens",
    "Run_ID",
    "Last_Parsed",
]


# ── CSV helpers ────────────────────────────────────────────────────────────────

def read_csv() -> dict:
    """Return {(Session_ID, Model): row_dict}."""
    rows = {}
    if not os.path.exists(CSV_PATH):
        return rows
    try:
        with open(CSV_PATH, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                key = (row.get("Session_ID", ""), row.get("Model", ""))
                rows[key] = row
    except Exception as e:
        print(f"[warn] failed to read CSV: {e}", file=sys.stderr)
    return rows


def write_csv(rows: dict) -> None:
    """Atomic CSV write via tmp + os.replace."""
    tmp_path = CSV_PATH + ".tmp"
    try:
        with open(tmp_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=CSV_HEADER)
            writer.writeheader()
            for row in sorted(rows.values(), key=lambda r: (r["Session_ID"], r["Model"])):
                writer.writerow(row)
        os.replace(tmp_path, CSV_PATH)
    except Exception as e:
        # Clean up tmp on failure
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        raise RuntimeError(f"CSV write failed: {e}") from e


# ── Sidecar ledger helpers ─────────────────────────────────────────────────────

def read_parsed_sessions() -> dict:
    """Return {session_id: mtime_float} from sidecar ledger."""
    if not os.path.exists(PARSED_SESSIONS_PATH):
        return {}
    try:
        with open(PARSED_SESSIONS_PATH, encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return {str(k): float(v) for k, v in data.items()}
    except Exception as e:
        print(f"[warn] failed to read parsed_sessions ledger: {e}", file=sys.stderr)
    return {}


def write_parsed_sessions(ledger: dict) -> None:
    """Atomic write of {session_id: mtime_float} sidecar ledger."""
    tmp_path = PARSED_SESSIONS_PATH + ".tmp"
    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(ledger, f, indent=2, sort_keys=True)
            f.write("\n")
        os.replace(tmp_path, PARSED_SESSIONS_PATH)
    except Exception as e:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        print(f"[warn] failed to write parsed_sessions ledger: {e}", file=sys.stderr)


# ── Transcript parsing ─────────────────────────────────────────────────────────

def parse_transcript(path: str) -> dict:
    """
    Parse a single JSONL transcript.

    Returns:
        {
          "session_id": str,
          "session_name": str | None,
          "records": { (session_id, model): {"billable": int, "cache": int, "total": int} }
        }
    """
    session_id = None
    session_name = None
    seen_message_ids: set = set()
    # key: (session_id, model) -> token accumulators
    accum: dict = {}

    try:
        with open(path, encoding="utf-8") as f:
            for lineno, line in enumerate(f, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    print(f"[warn] {path}:{lineno} malformed JSON, skipping", file=sys.stderr)
                    continue

                rtype = record.get("type", "")

                # Capture session_id from any record that has it
                if "sessionId" in record and session_id is None:
                    session_id = record["sessionId"]

                # Capture session name from ai-title record
                if rtype == "ai-title":
                    session_name = record.get("aiTitle") or record.get("ai_title") or session_name
                    if "sessionId" in record:
                        session_id = record["sessionId"]
                    continue

                # Only process assistant records with message data
                if rtype != "assistant":
                    continue

                msg = record.get("message")
                if not isinstance(msg, dict):
                    continue

                # Must have model
                model = msg.get("model")
                if not model:
                    continue
                # Skip synthetic model records
                if model == "<synthetic>":
                    continue

                # Must have usage
                usage = msg.get("usage")
                if not isinstance(usage, dict):
                    continue

                # Dedup on message.id
                msg_id = msg.get("id")
                if msg_id:
                    if msg_id in seen_message_ids:
                        continue
                    seen_message_ids.add(msg_id)

                # Use sessionId from record if top-level session_id not yet set
                rec_session_id = record.get("sessionId") or session_id
                if not rec_session_id:
                    continue

                # Token math — top-level usage fields only (never iterations[])
                input_tokens = int(usage.get("input_tokens") or 0)
                output_tokens = int(usage.get("output_tokens") or 0)
                cache_creation = int(usage.get("cache_creation_input_tokens") or 0)
                cache_read = int(usage.get("cache_read_input_tokens") or 0)

                billable = input_tokens + output_tokens
                cache = cache_creation + cache_read
                total = billable + cache

                key = (rec_session_id, model)
                if key not in accum:
                    accum[key] = {"billable": 0, "cache": 0, "total": 0}
                accum[key]["billable"] += billable
                accum[key]["cache"] += cache
                accum[key]["total"] += total

                # Capture session_id if not set
                if session_id is None:
                    session_id = rec_session_id

    except OSError as e:
        print(f"[warn] cannot read {path}: {e}", file=sys.stderr)

    return {
        "session_id": session_id,
        "session_name": session_name,
        "records": accum,
    }


def upsert_transcript(path: str, csv_rows: dict) -> dict:
    """
    Parse transcript and upsert into csv_rows dict.
    Returns summary dict: {parsed, upserted, session_id, session_name}.
    """
    result = parse_transcript(path)
    session_id = result["session_id"]
    session_name = result["session_name"]
    records = result["records"]

    now_iso = datetime.now(timezone.utc).isoformat()
    upserted = 0

    for (sid, model), tokens in records.items():
        key = (sid, model)
        existing = csv_rows.get(key, {})
        csv_rows[key] = {
            "Session_ID": sid,
            "Session_Name": session_name or existing.get("Session_Name", ""),
            "Model": model,
            "Effort": existing.get("Effort", ""),
            "Billable_Tokens": tokens["billable"],
            "Cache_Tokens": tokens["cache"],
            "Total_Tokens": tokens["total"],
            "Run_ID": sid,
            "Last_Parsed": now_iso,
        }
        upserted += 1

    return {
        "parsed": len(records),
        "upserted": upserted,
        "session_id": session_id,
        "session_name": session_name,
    }


# ── Modes ──────────────────────────────────────────────────────────────────────

def mode_transcript(path: str) -> dict:
    """Parse single transcript and upsert into CSV."""
    if not path or not os.path.exists(path):
        msg = f"transcript not found: {path}"
        print(f"[error] {msg}", file=sys.stderr)
        return {"ok": False, "error": msg}

    csv_rows = read_csv()
    summary = upsert_transcript(path, csv_rows)
    write_csv(csv_rows)

    result = {
        "ok": True,
        "mode": "transcript",
        "transcript": path,
        **summary,
    }
    return result


def _session_id_from_path(path: str) -> str:
    """Extract session_id from transcript filename (UUID prefix before first dot)."""
    return os.path.basename(path).split(".")[0]


def mode_reconcile(project_dir: str | None = None) -> dict:
    """
    Per-transcript freshness reconcile.

    A transcript is (re-)parsed when its session_id is not in the sidecar ledger
    OR its mtime has advanced since the ledger timestamp for that session_id.

    The sidecar (.parsed_sessions.json) tracks ALL ever-parsed session_ids,
    including zero-row ones (sessions with no billable records).  Zero-row
    transcripts never produce CSV rows, so relying solely on the CSV for
    idempotency caused them to be reparsed on every reconcile run.

    Does NOT gate on CSV file mtime — that causes old transcripts to become
    unreachable after the CSV is rewritten (the CSV mtime advances past all
    existing transcript mtimes).
    """
    transcript_paths = sorted(glob.glob(resolve_transcripts_glob(project_dir)))
    csv_rows = read_csv()

    # Load sidecar ledger: {session_id: mtime_float_when_parsed}
    ledger = read_parsed_sessions()

    # Also build index from CSV rows so existing CSV data still counts even if
    # sidecar was deleted/missing.  Merge both sources; sidecar wins on ties.
    session_last_parsed: dict = {}
    for (sid, _model), row in csv_rows.items():
        lp_str = row.get("Last_Parsed", "")
        lp_ts = 0.0
        if lp_str:
            try:
                lp_ts = datetime.fromisoformat(lp_str).timestamp()
            except ValueError:
                lp_ts = 0.0
        if sid not in session_last_parsed or lp_ts > session_last_parsed[sid]:
            session_last_parsed[sid] = lp_ts
    # Sidecar entries override (they track exact mtime-at-parse for zero-row sessions)
    for sid, ts in ledger.items():
        if sid not in session_last_parsed or ts > session_last_parsed[sid]:
            session_last_parsed[sid] = ts

    pending = []
    pending_mtimes: dict = {}  # path -> mtime, for ledger update
    for path in transcript_paths:
        sid = _session_id_from_path(path)
        try:
            t_mtime = os.path.getmtime(path)
        except OSError:
            continue
        if sid not in session_last_parsed:
            # Session never parsed — always include.
            pending.append(path)
            pending_mtimes[path] = t_mtime
        else:
            # Re-parse if transcript has been modified since last parse.
            if t_mtime > session_last_parsed[sid]:
                pending.append(path)
                pending_mtimes[path] = t_mtime

    total_upserted = 0
    processed = []

    for path in pending:
        summary = upsert_transcript(path, csv_rows)
        total_upserted += summary["upserted"]
        processed.append(os.path.basename(path))
        # Record in ledger regardless of whether any rows were produced (zero-row fix)
        sid = _session_id_from_path(path)
        ledger[sid] = pending_mtimes[path]

    if pending:
        write_csv(csv_rows)
        write_parsed_sessions(ledger)

    return {
        "ok": True,
        "mode": "reconcile",
        "transcripts_found": len(transcript_paths),
        "transcripts_processed": len(pending),
        "rows_upserted": total_upserted,
        "files": processed,
    }


def mode_rebuild(project_dir: str | None = None) -> dict:
    """Wipe CSV and re-parse all transcripts. Resets sidecar ledger too."""
    transcript_paths = sorted(glob.glob(resolve_transcripts_glob(project_dir)))

    csv_rows: dict = {}
    ledger: dict = {}
    total_upserted = 0
    processed = []

    for path in transcript_paths:
        summary = upsert_transcript(path, csv_rows)
        total_upserted += summary["upserted"]
        processed.append(os.path.basename(path))
        # Record mtime in ledger regardless of zero-row result
        sid = _session_id_from_path(path)
        try:
            ledger[sid] = os.path.getmtime(path)
        except OSError:
            ledger[sid] = 0.0

    write_csv(csv_rows)
    write_parsed_sessions(ledger)

    return {
        "ok": True,
        "mode": "rebuild",
        "transcripts_found": len(transcript_paths),
        "transcripts_processed": len(transcript_paths),
        "rows_upserted": total_upserted,
        "files": processed,
    }


# ── Entry point ────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Parse Claude Code token usage from JSONL transcripts.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--transcript", metavar="PATH", help="Parse single transcript file")
    group.add_argument("--reconcile", action="store_true", help="Parse transcripts not in sidecar ledger or modified since last parse")
    group.add_argument("--rebuild", action="store_true", help="Wipe CSV and re-parse all transcripts")
    parser.add_argument("--project-dir", metavar="DIR", default=None,
                        help="Transcript dir to scope reconcile/rebuild to "
                             "(defaults to this project's encoded dir)")
    args = parser.parse_args()

    if args.transcript:
        result = mode_transcript(args.transcript)
    elif args.reconcile:
        result = mode_reconcile(args.project_dir)
    elif args.rebuild:
        result = mode_rebuild(args.project_dir)
    else:
        result = {"ok": False, "error": "no mode specified"}

    print(json.dumps(result, indent=2))
    sys.exit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    main()
