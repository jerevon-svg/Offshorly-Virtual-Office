"""Grant or revoke ONE named capability for ONE employee. Administrative, out of band, manual.

THIS IS NOT WIRED TO ANYTHING. It is not imported by app.main, it does not run at startup, it is
not a route, and nothing schedules it. An operator runs it deliberately, against a database they
named, and that is the whole point: permission assignment stays outside the request path, so
"an employee cannot assign themselves a capability" remains a property of the system's shape rather
than a check somebody has to remember (see app/repositories/employee_permissions.py).

USAGE (from backend/, with the venv active):

    DATABASE_URL=<the target database> python -m app.scripts.grant_permission \\
        --email person@offshorly.com --permission experience.creator \\
        --granted-by you@offshorly.com --note "Phase 9A, approved by ..."

    ... --revoke      ends an existing grant, keeping the row and its audit trail.
    ... --list        prints the employee's active capabilities and exits without writing.

IT REFUSES TO GUESS WHICH DATABASE IT IS TALKING TO. DATABASE_URL must be set explicitly in the
environment, and the script prints the host/file it resolved and asks for confirmation before it
writes — typing the employee's email back is the confirmation. `--yes` skips the prompt for a
scripted run, and is the only way to write without a human at the keyboard.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys

from app.models.employee_permission import KNOWN_PERMISSIONS


def _parse(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="python -m app.scripts.grant_permission",
        description="Grant, revoke or list one employee's named capabilities.",
    )
    parser.add_argument("--email", required=True, help="the employee the capability is about")
    parser.add_argument(
        "--permission",
        help=f"one of: {', '.join(sorted(KNOWN_PERMISSIONS))}",
    )
    parser.add_argument(
        "--granted-by",
        help="the administrator making the grant, recorded for audit (required unless --revoke/--list)",
    )
    parser.add_argument("--note", default=None, help="free-text audit reason (ticket, approval)")
    parser.add_argument("--revoke", action="store_true", help="end the grant instead of making one")
    parser.add_argument("--list", action="store_true", help="print active capabilities and exit")
    parser.add_argument("--yes", action="store_true", help="skip the interactive confirmation")
    return parser.parse_args(argv)


async def _run(args: argparse.Namespace) -> int:
    # Imported HERE, after the argument parse, so `--help` works without building an engine and so
    # a missing DATABASE_URL is reported as the clear error below rather than as an import failure.
    from app.config import settings
    from app.database import async_session_maker
    from app.repositories import employee_permissions as permissions_repo

    if not os.environ.get("DATABASE_URL"):
        print(
            "DATABASE_URL is not set in the environment. Refusing to fall back to backend/.env — "
            "this script writes permissions, and it must be obvious which database that is.",
            file=sys.stderr,
        )
        return 2

    target = settings.DATABASE_URL
    # Never print a password back at the operator; the host/file is what they need to recognise.
    shown = target.split("@")[-1] if "@" in target else target
    print(f"Database: {shown}")

    async with async_session_maker() as session:
        if args.list:
            active = await permissions_repo.list_active(session, args.email)
            print(f"{args.email}: {', '.join(active) if active else '(no active capabilities)'}")
            return 0

        if not args.permission:
            print("--permission is required unless --list is given.", file=sys.stderr)
            return 2
        if args.permission not in KNOWN_PERMISSIONS:
            print(
                f"Unknown permission {args.permission!r}. Known: {', '.join(sorted(KNOWN_PERMISSIONS))}",
                file=sys.stderr,
            )
            return 2
        if not args.revoke and not args.granted_by:
            print("--granted-by is required for a grant.", file=sys.stderr)
            return 2

        verb = "REVOKE" if args.revoke else "GRANT"
        print(f"{verb} {args.permission} {'from' if args.revoke else 'to'} {args.email}")
        if not args.yes:
            typed = input("Type the employee's email to confirm: ").strip().lower()
            if typed != args.email.strip().lower():
                print("Confirmation did not match. Nothing was written.", file=sys.stderr)
                return 1

        if args.revoke:
            ended = await permissions_repo.revoke(session, args.email, args.permission)
            print("Revoked." if ended else "There was no active grant to revoke.")
        else:
            await permissions_repo.grant(
                session,
                args.email,
                args.permission,
                granted_by=args.granted_by,
                note=args.note,
            )
            print("Granted.")

        active = await permissions_repo.list_active(session, args.email)
        print(f"{args.email} now holds: {', '.join(active) if active else '(nothing)'}")
        return 0


def main(argv: list[str] | None = None) -> int:
    return asyncio.run(_run(_parse(argv)))


if __name__ == "__main__":
    raise SystemExit(main())
