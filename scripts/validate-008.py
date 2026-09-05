#!/usr/bin/env python3
"""Validate migration 008: full-file raw parse + plpgsql compile of each
CREATE FUNCTION statement (same harness as validate-006/007.py)."""
import json
import re
import sys

import pglast
from pglast.parser import parse_plpgsql_json, ParseError

PATH = "/home/z/my-project/supabase/migrations/008_field_expansion.sql"


def compile_plpgsql(stmt: str, name: str) -> bool:
    """Compile one CREATE FUNCTION statement. True = OK."""
    try:
        raw = parse_plpgsql_json(stmt)
        try:
            json.loads(raw)
            print(f"[PASS] plpgsql compile: public.{name}")
        except json.JSONDecodeError:
            print(f"[PASS] plpgsql compile: public.{name} (parse OK)")
        return True
    except ParseError as e:
        print(f"[FAIL] plpgsql compile: public.{name}: {e}")
        return False


def main() -> int:
    src = open(PATH, encoding="utf-8").read()
    failures = 0

    # 1. Whole-file raw parse
    try:
        stmts = pglast.parse_sql(src)
        print(f"[PASS] raw SQL parse: whole file → {len(stmts)} top-level statements")
    except ParseError as e:
        print(f"[FAIL] raw SQL parse: {e}")
        return 1

    # 2. Extract each full CREATE OR REPLACE FUNCTION statement
    matches = [m.start() for m in re.finditer(r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.\w+\s*\(", src)]
    for start in matches:
        end = src.index("$$;", start) + 3
        stmt = src[start:end]
        m = re.match(r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(\w+)", stmt)
        name = m.group(1) if m else "unknown"
        if not compile_plpgsql(stmt, name):
            failures += 1

    # 3. Structural cross-checks against the app contract
    checks = [
        ("c_submittable has 21 types", src.count("'file_upload','signature','contact_info','scheduler'") == 1),
        ("payment NOT in c_submittable", (lambda arr: "'payment'" not in arr and arr.count("'") == 42)(
            re.search(r"c_submittable\s+constant text\[\] := ARRAY\[(.*?)\];", src, re.S).group(1)
        )),
        ("publish file_upload block removed", "FILE_UPLOAD_NOT_SUPPORTED" not in src.split("SECTION C")[0]),
        ("upload attach present", "SET status = 'attached', submission_id = v_sub_id" in src),
        ("booking insert present", "INSERT INTO public.bookings" in src),
        ("payment claim present", "p.status = 'succeeded'" in src),
        ("SLOT_TAKEN code present", "SLOT_TAKEN" in src),
        ("enum adds all 4", all(
            f"ADD VALUE IF NOT EXISTS '{v}'" in src
            for v in ["contact_info", "payment", "scheduler", "embed"]
        )),
        ("3 new tables", all(t in src for t in ["CREATE TABLE IF NOT EXISTS public.form_uploads", "CREATE TABLE IF NOT EXISTS public.payments", "CREATE TABLE IF NOT EXISTS public.bookings"])),
        ("anon pending-write policy", '"form_uploads_pending_write"' in src),
        ("no anon SELECT policy on bucket", 'FOR SELECT TO anon' not in src),
        ("scheduler advisory lock", "formnull:bookings:" in src),
        ("payments unique ref", "payments_provider_ref_uniq" in src),
        ("bookings partial unique", "bookings_slot_unique" in src),
        ("metadata payment_ref whitelist", "jsonb_build_object('payment_ref', left(p_meta->>'payment_ref', 64))" in src),
        ("stale upload cleanup", "interval '24 hours'" in src),
        ("2 new RPCs", all(f in src for f in ["public.create_upload_intent(", "public.create_payment_intent("])),
    ]
    for label, ok in checks:
        print(f"[{'PASS' if ok else 'FAIL'}] {label}")
        if not ok:
            failures += 1

    print()
    if failures:
        print(f"FAILED: {failures} failure(s)")
        return 1
    print("ALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
