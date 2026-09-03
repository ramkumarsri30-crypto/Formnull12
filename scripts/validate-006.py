#!/usr/bin/env python3
"""
FormNull Migration 006 — local syntax validation harness.

Uses pglast (libpg_query bindings = the REAL PostgreSQL parser):
  1. pglast.parse_sql(whole file)  → raw SQL-level parse of every
     statement (ALTER / CREATE TABLE / CREATE INDEX / GRANT / REVOKE /
     CREATE FUNCTION shells).
  2. parse_plpgsql_json(each CREATE FUNCTION statement) → compiles
     every PL/pgSQL body with PostgreSQL's actual plpgsql grammar
     (the same compile step the server performs at CREATE time).

Known pglast v8.4 quirk (verified by repro): for RETURNS trigger
functions libpg_query EMITS malformed JSON for the parse tree, while
the parse itself succeeds. Discriminator (verified):
  ParseError        → genuine grammar/syntax error  → FAIL
  json.JSONDecodeError → parse succeeded, only the tree serialization
                        is buggy (trigger functions)      → PASS

No database connection is made anywhere in this harness.
"""
import json
import re
import sys
import pglast
from pglast.parser import parse_plpgsql_json, ParseError

PATH = "/home/z/my-project/supabase/migrations/006_publish_and_public_submission.sql"

def compile_plpgsql(stmt: str, name: str) -> bool:
    """Compile one CREATE FUNCTION statement. True = OK."""
    try:
        raw = parse_plpgsql_json(stmt)
        try:
            json.loads(raw)
            print(f"[PASS] plpgsql compile: public.{name}")
        except json.JSONDecodeError:
            print(f"[PASS] plpgsql compile: public.{name} "
                  f"(parse OK; pglast trigger-tree JSON quirk ignored)")
        return True
    except ParseError as e:
        print(f"[FAIL] plpgsql compile: public.{name}: {e}")
        return False

def main() -> int:
    src = open(PATH, encoding="utf-8").read()
    failures = 0

    # ---- 1. Whole-file raw parse -------------------------------------
    try:
        stmts = pglast.parse_sql(src)
        print(f"[PASS] raw SQL parse: whole file → {len(stmts)} top-level statements")
    except ParseError as e:
        print(f"[FAIL] raw SQL parse: {e}")
        return 1

    # ---- 2. PL/pgSQL compile of every function -----------------------
    starts = [m.start() for m in re.finditer(
        r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.\w+\s*\(", src)]
    # Skip matches that live inside `--` comment lines (e.g. the rollback
    # script in the header comment contains a CREATE FUNCTION too).
    def in_comment(pos: int) -> bool:
        line_start = src.rfind("\n", 0, pos) + 1
        return src[line_start:line_start + 2] == "--" or src[line_start:line_start + 3] in ("-- ",)
    starts = [s for s in starts if not in_comment(s)]
    print(f"[info] found {len(starts)} live CREATE OR REPLACE FUNCTION blocks")
    for i, start in enumerate(starts, 1):
        end = src.find("$$;", start)
        if end == -1:
            print(f"[FAIL] function #{i}: no closing $$; found")
            failures += 1
            continue
        stmt = src[start:end + 3]
        name = re.search(r"public\.(\w+)", stmt).group(1)
        if not compile_plpgsql(stmt, name):
            failures += 1

    # ---- 3. Sanity checks --------------------------------------------
    n_dollar = src.count("$$")
    expected = 2 * len(starts) + 2  # +2: the rollback script inside the header comment
    print(f"[info] '$$' tokens: {n_dollar} (expect {expected}: 2 per live function + 2 in header rollback comment)")
    if n_dollar != expected:
        print("[FAIL] unexpected $$ count — possible stray dollar-quoting")
        failures += 1

    print(f"\n{'ALL CHECKS PASSED' if failures == 0 else f'{failures} FAILURE(S)'}")
    return 0 if failures == 0 else 1

if __name__ == "__main__":
    sys.exit(main())
