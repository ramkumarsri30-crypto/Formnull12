#!/usr/bin/env python3
"""Validate migration 007: full-file raw parse + plpgsql compile of each
CREATE FUNCTION statement (same harness as validate-006.py)."""
import json
import re
import sys

import pglast
from pglast.parser import parse_plpgsql_json, ParseError

PATH = "/home/z/my-project/supabase/migrations/007_new_field_types_submission.sql"


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

    print("\nFAILURES:", failures)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
