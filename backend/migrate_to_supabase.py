from __future__ import annotations
#!/usr/bin/env python3
"""
Migrate all data from local SQLite to Supabase PostgreSQL.

Notes:
- Reads from backend/suraksha_setu.db
- Writes to DATABASE_URL (or SUPABASE_DB_URL) from environment/.env
- Truncates target tables first so Supabase mirrors local SQLite
- Uses row-level savepoints so one bad row does not abort the whole table
"""


import ast
import asyncio
import json
import os
from datetime import datetime
from typing import Any

from dotenv import load_dotenv
from sqlalchemy import Boolean, DateTime, JSON, MetaData, create_engine, inspect, insert, text
from sqlalchemy.ext.asyncio import create_async_engine


SQLITE_URL = "sqlite+pysqlite:///./suraksha_setu.db"

TABLE_ORDER = [
    "users",
    "mosdac_metadata",
    "push_subscriptions",
    "chat_messages",
    "alerts",
    "alert_feedback",
    "incident_logs",
    "community_reports",
    "status_checks",
    "community_posts",
    "user_reports",
    "comments",
    "direct_messages",
    "notifications",
    "ai_logs",
    "earthquake_dataset",
    "flood_dataset",
    "heatwave_dataset",
    "nearby_disaster_dataset",
    "weather_dataset",
    "aqi_dataset",
    "source_ingestion_logs",
]


def _to_async_url(url: str) -> str:
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    if url.startswith("postgresql+asyncpg://"):
        return url
    raise ValueError("Supabase URL must start with postgresql:// or postgresql+asyncpg://")


def _ordered_tables(sqlite_tables: list[str]) -> list[str]:
    ordered = [t for t in TABLE_ORDER if t in sqlite_tables]
    extras = sorted([t for t in sqlite_tables if t not in ordered])
    return ordered + extras


def _parse_datetime(value: str) -> datetime | str:
    v = value.strip()
    if not v:
        return value
    if v.endswith("Z"):
        v = v[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(v)
    except ValueError:
        return value


def _normalize_json(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (dict, list, int, float, bool)):
        return value
    if not isinstance(value, str):
        return value

    raw = value.strip()
    if not raw:
        return None

    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        pass

    try:
        parsed = ast.literal_eval(raw)
        if isinstance(parsed, (dict, list, int, float, bool, str)):
            return parsed
    except (ValueError, SyntaxError):
        pass

    return value


def _normalize_value(value: Any, column_type: Any) -> Any:
    if value is None:
        return None

    if isinstance(column_type, JSON):
        return _normalize_json(value)

    if isinstance(column_type, Boolean):
        if isinstance(value, bool):
            return value
        if isinstance(value, int):
            return bool(value)
        if isinstance(value, str):
            lower = value.strip().lower()
            if lower in {"1", "true", "t", "yes", "y"}:
                return True
            if lower in {"0", "false", "f", "no", "n"}:
                return False
        return value

    if isinstance(column_type, DateTime) and isinstance(value, str):
        return _parse_datetime(value)

    return value


def _build_payload(row: dict[str, Any], target_table: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    for col in target_table.columns:
        if col.name in row:
            payload[col.name] = _normalize_value(row[col.name], col.type)
    return payload


async def _truncate_target_tables(async_engine: Any, tables: list[str]) -> None:
    quoted = ", ".join([f'"{t}"' for t in tables])
    sql = f"TRUNCATE TABLE {quoted} CASCADE"
    async with async_engine.begin() as conn:
        for table in tables: await conn.execute(text(f'TRUNCATE TABLE "{table}" CASCADE'))


async def run_migration() -> int:
    load_dotenv()

    raw_url = (os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DB_URL") or "").strip()
    if not raw_url:
        print("ERROR: DATABASE_URL (or SUPABASE_DB_URL) is missing")
        return 1
    if "supabase.co" not in raw_url:
        print("ERROR: URL does not look like a Supabase host")
        return 1

    if not os.path.exists("./suraksha_setu.db"):
        print("ERROR: Local sqlite db not found at backend/suraksha_setu.db")
        return 1

    sqlite_engine = create_engine(SQLITE_URL, echo=False)
    sqlite_tables = inspect(sqlite_engine).get_table_names()
    tables = _ordered_tables(sqlite_tables)

    if not tables:
        print("No SQLite tables found")
        sqlite_engine.dispose()
        return 0

    async_engine = create_async_engine(
        _to_async_url(raw_url),
        echo=False,
        pool_pre_ping=True,
        connect_args={
            "ssl": "require",
            "server_settings": {"application_name": "sqlite_to_supabase_migration"},
        },
    )

    metadata = MetaData()
    async with async_engine.begin() as conn:
        await conn.run_sync(metadata.reflect)

    target_tables = {name: table for name, table in metadata.tables.items()}
    missing = [t for t in tables if t not in target_tables]
    if missing:
        print("ERROR: Missing tables on Supabase:")
        for t in missing:
            print(f"  - {t}")
        await async_engine.dispose()
        sqlite_engine.dispose()
        return 1

    print("Starting migration: SQLite -> Supabase")
    print("Source sqlite file: ./suraksha_setu.db")
    print(f"Tables: {len(tables)}")

    await _truncate_target_tables(async_engine, tables)
    print("Target tables truncated")

    total_inserted = 0
    total_skipped = 0
    table_failures: list[str] = []

    for table_name in tables:
        try:
            target_table = target_tables[table_name]
            with sqlite_engine.connect() as sconn:
                rows = sconn.execute(text(f'SELECT * FROM "{table_name}"')).mappings().all()

            if not rows:
                print(f"{table_name}: source=0 inserted=0 skipped=0")
                continue

            inserted = 0
            skipped = 0
            row_errors: list[str] = []

            async with async_engine.connect() as conn:
                tx = await conn.begin()
                try:
                    for idx, row in enumerate(rows, start=1):
                        sp = await conn.begin_nested()
                        try:
                            payload = _build_payload(dict(row), target_table)
                            await conn.execute(insert(target_table).values(**payload))
                            await sp.commit()
                            inserted += 1
                        except Exception as exc:
                            await sp.rollback()
                            skipped += 1
                            if len(row_errors) < 5:
                                row_errors.append(f"row {idx}: {str(exc)[:160]}")
                    await tx.commit()
                except Exception:
                    await tx.rollback()
                    raise

            total_inserted += inserted
            total_skipped += skipped
            print(f"{table_name}: source={len(rows)} inserted={inserted} skipped={skipped}")
            for err in row_errors:
                print(f"  error: {err}")

        except Exception as exc:
            table_failures.append(f"{table_name}: {str(exc)[:200]}")
            print(f"{table_name}: source=unknown inserted=0 skipped=0")
            print(f"  error: table failure: {str(exc)[:200]}")

    mismatches: list[str] = []
    async with async_engine.connect() as conn:
        for table_name in tables:
            with sqlite_engine.connect() as sconn:
                source_count = sconn.execute(text(f'SELECT COUNT(*) FROM "{table_name}"')).scalar_one()
            target_count = (await conn.execute(text(f'SELECT COUNT(*) FROM "{table_name}"'))).scalar_one()
            if source_count != target_count:
                mismatches.append(f"{table_name}: source={source_count} target={target_count}")

    print("Migration summary")
    print(f"Total inserted: {total_inserted}")
    print(f"Total skipped: {total_skipped}")

    if table_failures:
        print("Table failures:")
        for item in table_failures:
            print(f"  - {item}")

    if mismatches:
        print("Count mismatches:")
        for item in mismatches:
            print(f"  - {item}")
    else:
        print("All table counts match between SQLite and Supabase")

    await async_engine.dispose()
    sqlite_engine.dispose()

    if table_failures:
        return 3
    if mismatches:
        return 2
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(run_migration()))
    except KeyboardInterrupt:
        raise SystemExit(130)
#!/usr/bin/env python3
"""
Migrate all data from local SQLite to Supabase PostgreSQL.

Design goals:
- Avoid importing application modules (keeps script independent and avoids side effects)
- Use typed SQLAlchemy inserts (no manual SQL string value formatting)
- Isolate row failures with savepoints so one bad row does not abort the whole table
- Verify source vs target row counts at the end
"""


import ast
import asyncio
import json
import os
from datetime import datetime
from typing import Any

from dotenv import load_dotenv
from sqlalchemy import Boolean, DateTime, JSON, MetaData, create_engine, inspect, insert, text
from sqlalchemy.ext.asyncio import create_async_engine


SQLITE_URL = "sqlite+pysqlite:///./suraksha_setu.db"

# Preferred order to respect foreign keys.
TABLE_ORDER = [
    "users",
    "mosdac_metadata",
    "push_subscriptions",
    "chat_messages",
    "alerts",
    "alert_feedback",
    "incident_logs",
    "community_reports",
    "status_checks",
    "community_posts",
    "user_reports",
    "comments",
    "direct_messages",
    "notifications",
    "ai_logs",
    "earthquake_dataset",
    "flood_dataset",
    "heatwave_dataset",
    "nearby_disaster_dataset",
    "weather_dataset",
    "aqi_dataset",
    "source_ingestion_logs",
]


def _to_async_supabase_url(raw_url: str) -> str:
    if raw_url.startswith("postgresql://"):
        return raw_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    if raw_url.startswith("postgresql+asyncpg://"):
        return raw_url
    raise ValueError("DATABASE_URL must start with postgresql:// or postgresql+asyncpg://")


def _ordered_tables(sqlite_tables: list[str]) -> list[str]:
    ordered = [t for t in TABLE_ORDER if t in sqlite_tables]
    extras = sorted([t for t in sqlite_tables if t not in ordered])
    return ordered + extras


def _parse_datetime(value: str) -> datetime | str:
    """Best-effort parse for ISO-like timestamps; returns original value on failure."""
    candidate = value.strip()
    if not candidate:
        return value

    # Handle UTC 'Z'.
    if candidate.endswith("Z"):
        candidate = candidate[:-1] + "+00:00"

    try:
        return datetime.fromisoformat(candidate)
    except ValueError:
        return value


def _normalize_json(value: Any) -> Any:
    """Convert sqlite text payloads into Python JSON-native values when possible."""
    if value is None:
        return None
    if isinstance(value, (dict, list, int, float, bool)):
        return value
    if not isinstance(value, str):
        return value

    raw = value.strip()
    if not raw:
        return None

    # First try strict JSON.
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        pass

    # Fallback for Python-literal style dict/list strings from legacy writes.
    try:
        parsed = ast.literal_eval(raw)
        if isinstance(parsed, (dict, list, int, float, bool, str)):
            return parsed
    except (ValueError, SyntaxError):
        pass

    # As a last resort keep original string; JSON column can store string values.
    return value


def _normalize_value(value: Any, column_type: Any) -> Any:
    if value is None:
        return None

    if isinstance(column_type, JSON):
        return _normalize_json(value)

    if isinstance(column_type, Boolean):
        if isinstance(value, bool):
            return value
        if isinstance(value, int):
            return bool(value)
        if isinstance(value, str):
            lower = value.strip().lower()
            if lower in {"1", "true", "t", "yes", "y"}:
                return True
            if lower in {"0", "false", "f", "no", "n"}:
                return False
        return value

    if isinstance(column_type, DateTime) and isinstance(value, str):
        return _parse_datetime(value)

    return value


def _build_row_payload(row: dict[str, Any], target_table: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    for column in target_table.columns:
        name = column.name
        if name not in row:
            continue
        payload[name] = _normalize_value(row[name], column.type)
    return payload


async def _truncate_target_tables(async_engine: Any, tables: list[str]) -> None:
    # Truncate once with CASCADE so Supabase exactly matches local SQLite after migration.
    quoted = ", ".join([f'"{t}"' for t in tables])
    sql = f"TRUNCATE TABLE {quoted} CASCADE"
    async with async_engine.begin() as conn:
        for table in tables: await conn.execute(text(f'TRUNCATE TABLE "{table}" CASCADE'))


async def run_migration() -> int:
    load_dotenv()

    raw_database_url = os.getenv("DATABASE_URL", "").strip()
    if not raw_database_url:
        print("ERROR: DATABASE_URL is missing in backend/.env")
        return 1
    if "supabase.co" not in raw_database_url:
        print("ERROR: DATABASE_URL is not a Supabase URL")
        return 1

    if not os.path.exists("./suraksha_setu.db"):
        print("ERROR: Local sqlite database not found at backend/suraksha_setu.db")
        return 1

    supabase_async_url = _to_async_supabase_url(raw_database_url)
    sqlite_engine = create_engine(SQLITE_URL, echo=False)
    sqlite_inspector = inspect(sqlite_engine)
    sqlite_tables = sqlite_inspector.get_table_names()
    tables_to_migrate = _ordered_tables(sqlite_tables)

    if not tables_to_migrate:
        print("No sqlite tables found to migrate")
        return 0

    async_engine = create_async_engine(
        supabase_async_url,
        echo=False,
        pool_pre_ping=True,
        connect_args={
            "ssl": "require",
            "server_settings": {"application_name": "sqlite_to_supabase_migration"},
        },
    )

    target_metadata = MetaData()
    async with async_engine.begin() as conn:
        await conn.run_sync(target_metadata.reflect)

    target_tables = {name: table for name, table in target_metadata.tables.items()}
    missing_target_tables = [t for t in tables_to_migrate if t not in target_tables]
    if missing_target_tables:
        print("ERROR: These tables do not exist on Supabase:")
        for table_name in missing_target_tables:
            print(f"  - {table_name}")
        await async_engine.dispose()
        return 1

    print("Starting migration: SQLite -> Supabase")
    print("Source sqlite file: ./suraksha_setu.db")
    print(f"Tables: {len(tables_to_migrate)}")

    await _truncate_target_tables(async_engine, tables_to_migrate)
    print("Target tables truncated")

    total_inserted = 0
    total_skipped = 0

    for table_name in tables_to_migrate:
        target_table = target_tables[table_name]

        with sqlite_engine.connect() as sconn:
            rows = sconn.execute(text(f'SELECT * FROM "{table_name}"')).mappings().all()

        if not rows:
            print(f"{table_name}: source=0 inserted=0 skipped=0")
            continue

        inserted = 0
        skipped = 0
        errors: list[str] = []

        async with async_engine.connect() as conn:
            outer = await conn.begin()
            try:
                for idx, row in enumerate(rows, start=1):
                    savepoint = await conn.begin_nested()
                    try:
                        payload = _build_row_payload(dict(row), target_table)
                        stmt = insert(target_table).values(**payload)
                        await conn.execute(stmt)
                        await savepoint.commit()
                        inserted += 1
                    except Exception as exc:
                        await savepoint.rollback()
                        skipped += 1
                        if len(errors) < 5:
                            errors.append(f"row {idx}: {str(exc)[:160]}")
                await outer.commit()
            except Exception:
                await outer.rollback()
                raise

        total_inserted += inserted
        total_skipped += skipped

        print(f"{table_name}: source={len(rows)} inserted={inserted} skipped={skipped}")
        for err in errors:
            print(f"  error: {err}")

    # Verification pass: compare source and target counts.
    mismatches: list[str] = []
    async with async_engine.connect() as conn:
        for table_name in tables_to_migrate:
            with sqlite_engine.connect() as sconn:
                source_count = sconn.execute(text(f'SELECT COUNT(*) FROM "{table_name}"')).scalar_one()
            target_count = (await conn.execute(text(f'SELECT COUNT(*) FROM "{table_name}"'))).scalar_one()
            if source_count != target_count:
                mismatches.append(f"{table_name}: source={source_count} target={target_count}")

    print("Migration summary")
    print(f"Total inserted: {total_inserted}")
    print(f"Total skipped: {total_skipped}")
    if mismatches:
        print("Count mismatches:")
        for item in mismatches:
            print(f"  - {item}")
    else:
        print("All table counts match between SQLite and Supabase")

    await async_engine.dispose()
    sqlite_engine.dispose()
    return 0 if not mismatches else 2


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(run_migration()))
    except KeyboardInterrupt:
        raise SystemExit(130)
#!/usr/bin/env python3
"""
Migrate all data from local SQLite to Supabase PostgreSQL.

Design goals:
- Avoid importing application modules (keeps script independent and avoids side effects)
- Use typed SQLAlchemy inserts (no manual SQL string value formatting)
- Isolate row failures with savepoints so one bad row does not abort the whole table
- Verify source vs target row counts at the end
"""

# Removed duplicate future import

import ast
import asyncio
import json

from dotenv import load_dotenv
from sqlalchemy import Boolean, DateTime, JSON, MetaData, create_engine, inspect, insert, text
from sqlalchemy.ext.asyncio import create_async_engine


SQLITE_URL = "sqlite+pysqlite:///./suraksha_setu.db"

# Preferred order to respect foreign keys.
TABLE_ORDER = [
    "users",
    "mosdac_metadata",
    "push_subscriptions",
    "chat_messages",
    "alerts",
    "alert_feedback",
    "incident_logs",
    "community_reports",
    "status_checks",
    "community_posts",
    "user_reports",
    "comments",
    "direct_messages",
    "notifications",
    "ai_logs",
    "earthquake_dataset",
    "flood_dataset",
    "heatwave_dataset",
    "nearby_disaster_dataset",
    "weather_dataset",
    "aqi_dataset",
    "source_ingestion_logs",
]


def _to_async_supabase_url(raw_url: str) -> str:
    if raw_url.startswith("postgresql://"):
        return raw_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    if raw_url.startswith("postgresql+asyncpg://"):
        return raw_url
    raise ValueError("DATABASE_URL must start with postgresql:// or postgresql+asyncpg://")


def _ordered_tables(sqlite_tables: list[str]) -> list[str]:
    ordered = [t for t in TABLE_ORDER if t in sqlite_tables]
    extras = sorted([t for t in sqlite_tables if t not in ordered])
    return ordered + extras


def _parse_datetime(value: str) -> datetime | str:
    """Best-effort parse for ISO-like timestamps; returns original value on failure."""
    candidate = value.strip()
    if not candidate:
        return value

    # Handle UTC 'Z'.
    if candidate.endswith("Z"):
        candidate = candidate[:-1] + "+00:00"

    try:
        return datetime.fromisoformat(candidate)
    except ValueError:
        return value


def _normalize_json(value: Any) -> Any:
    """Convert sqlite text payloads into Python JSON-native values when possible."""
    if value is None:
        return None
    if isinstance(value, (dict, list, int, float, bool)):
        return value
    if not isinstance(value, str):
        return value

    raw = value.strip()
    if not raw:
        return None

    # First try strict JSON.
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        pass

    # Fallback for Python-literal style dict/list strings from legacy writes.
    try:
        parsed = ast.literal_eval(raw)
        if isinstance(parsed, (dict, list, int, float, bool, str)):
            return parsed
    except (ValueError, SyntaxError):
        pass

    # As a last resort keep original string; JSON column can store string values.
    return value


def _normalize_value(value: Any, column_type: Any) -> Any:
    if value is None:
        return None

    if isinstance(column_type, JSON):
        return _normalize_json(value)

    if isinstance(column_type, Boolean):
        if isinstance(value, bool):
            return value
        if isinstance(value, int):
            return bool(value)
        if isinstance(value, str):
            lower = value.strip().lower()
            if lower in {"1", "true", "t", "yes", "y"}:
                return True
            if lower in {"0", "false", "f", "no", "n"}:
                return False
        return value

    if isinstance(column_type, DateTime) and isinstance(value, str):
        return _parse_datetime(value)

    return value


def _build_row_payload(row: dict[str, Any], target_table: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    for column in target_table.columns:
        name = column.name
        if name not in row:
            continue
        payload[name] = _normalize_value(row[name], column.type)
    return payload


async def _truncate_target_tables(async_engine: Any, tables: list[str]) -> None:
    # Truncate once with CASCADE so Supabase exactly matches local SQLite after migration.
    quoted = ", ".join([f'"{t}"' for t in tables])
    sql = f"TRUNCATE TABLE {quoted} CASCADE"
    async with async_engine.begin() as conn:
        for table in tables: await conn.execute(text(f'TRUNCATE TABLE "{table}" CASCADE'))


async def run_migration() -> int:
    load_dotenv()

    raw_database_url = os.getenv("DATABASE_URL", "").strip()
    if not raw_database_url:
        print("ERROR: DATABASE_URL is missing in backend/.env")
        return 1
    if "supabase.co" not in raw_database_url:
        print("ERROR: DATABASE_URL is not a Supabase URL")
        return 1

    if not os.path.exists("./suraksha_setu.db"):
        print("ERROR: Local sqlite database not found at backend/suraksha_setu.db")
        return 1

    supabase_async_url = _to_async_supabase_url(raw_database_url)
    sqlite_engine = create_engine(SQLITE_URL, echo=False)
    sqlite_inspector = inspect(sqlite_engine)
    sqlite_tables = sqlite_inspector.get_table_names()
    tables_to_migrate = _ordered_tables(sqlite_tables)

    if not tables_to_migrate:
        print("No sqlite tables found to migrate")
        return 0

    async_engine = create_async_engine(
        supabase_async_url,
        echo=False,
        pool_pre_ping=True,
        connect_args={
            "ssl": "require",
            "server_settings": {"application_name": "sqlite_to_supabase_migration"},
        },
    )

    target_metadata = MetaData()
    async with async_engine.begin() as conn:
        await conn.run_sync(target_metadata.reflect)

    target_tables = {name: table for name, table in target_metadata.tables.items()}
    missing_target_tables = [t for t in tables_to_migrate if t not in target_tables]
    if missing_target_tables:
        print("ERROR: These tables do not exist on Supabase:")
        for table_name in missing_target_tables:
            print(f"  - {table_name}")
        await async_engine.dispose()
        return 1

    print("Starting migration: SQLite -> Supabase")
    print(f"Source sqlite file: ./suraksha_setu.db")
    print(f"Tables: {len(tables_to_migrate)}")

    await _truncate_target_tables(async_engine, tables_to_migrate)
    print("Target tables truncated")

    summary: dict[str, dict[str, Any]] = {}
    total_inserted = 0
    total_skipped = 0

    for table_name in tables_to_migrate:
        target_table = target_tables[table_name]

        with sqlite_engine.connect() as sconn:
            rows = sconn.execute(text(f'SELECT * FROM "{table_name}"')).mappings().all()

        if not rows:
            summary[table_name] = {
                "source_count": 0,
                "inserted": 0,
                "skipped": 0,
                "errors": [],
            }
            print(f"{table_name}: 0 rows")
            continue

        inserted = 0
        skipped = 0
        errors: list[str] = []

        async with async_engine.connect() as conn:
            outer = await conn.begin()
            try:
                for idx, row in enumerate(rows, start=1):
                    savepoint = await conn.begin_nested()
                    try:
                        payload = _build_row_payload(dict(row), target_table)
                        stmt = insert(target_table).values(**payload)
                        await conn.execute(stmt)
                        await savepoint.commit()
                        inserted += 1
                    except Exception as exc:
                        await savepoint.rollback()
                        skipped += 1
                        if len(errors) < 5:
                            errors.append(f"row {idx}: {str(exc)[:160]}")
                await outer.commit()
            except Exception:
                await outer.rollback()
                raise

        summary[table_name] = {
            "source_count": len(rows),
            "inserted": inserted,
            "skipped": skipped,
            "errors": errors,
        }
        total_inserted += inserted
        total_skipped += skipped

        print(f"{table_name}: source={len(rows)} inserted={inserted} skipped={skipped}")
        for err in errors:
            print(f"  error: {err}")

    # Verification pass: compare source and target counts.
    mismatches: list[str] = []
    async with async_engine.connect() as conn:
        for table_name in tables_to_migrate:
            with sqlite_engine.connect() as sconn:
                source_count = sconn.execute(text(f'SELECT COUNT(*) FROM "{table_name}"')).scalar_one()
            target_count = (await conn.execute(text(f'SELECT COUNT(*) FROM "{table_name}"'))).scalar_one()
            if source_count != target_count:
                mismatches.append(f"{table_name}: source={source_count} target={target_count}")

    print("Migration summary")
    print(f"Total inserted: {total_inserted}")
    print(f"Total skipped: {total_skipped}")
    if mismatches:
        print("Count mismatches:")
        for item in mismatches:
            print(f"  - {item}")
    else:
        print("All table counts match between SQLite and Supabase")

    await async_engine.dispose()
    sqlite_engine.dispose()
    return 0 if not mismatches else 2


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(run_migration()))
    except KeyboardInterrupt:
        raise SystemExit(130)
#!/usr/bin/env python3
"""
Migration script: Transfer all data from local SQLite to Supabase PostgreSQL
Handles all dataset tables with proper ordering for foreign key constraints
"""

import asyncio
import os
import sys
from typing import List, Dict, Any
from sqlalchemy import create_engine, inspect, text, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from datetime import datetime
import json

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from database import Base

# ==================== DATABASE CONNECTIONS ====================

# Source: Local SQLite
SQLITE_URL = "sqlite+pysqlite:///./suraksha_setu.db"
sqlite_engine = create_engine(SQLITE_URL, echo=False)
SQLiteSession = sessionmaker(bind=sqlite_engine)

# Target: Supabase PostgreSQL (from .env)
from dotenv import load_dotenv
load_dotenv()

SUPABASE_URL = os.getenv('DATABASE_URL')
if not SUPABASE_URL or 'supabase' not in SUPABASE_URL:
    print("âŒ ERROR: Supabase DATABASE_URL not configured in .env")
    print("Make sure DATABASE_URL is set to your Supabase connection string")
    sys.exit(1)

# Convert to async PostgreSQL URL if needed
if SUPABASE_URL.startswith('postgresql://'):
    SUPABASE_ASYNC_URL = SUPABASE_URL.replace('postgresql://', 'postgresql+asyncpg://', 1)
else:
    SUPABASE_ASYNC_URL = SUPABASE_URL

async_engine = create_async_engine(
    SUPABASE_ASYNC_URL,
    echo=False,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
    connect_args={
        "ssl": "require",
        "server_settings": {"application_name": "migration_tool"}
    }
)

# Table order for insertion (respects foreign keys)
TABLE_ORDER = [
    'users',                      # No dependencies
    'mosdac_metadata',            # No dependencies
    'push_subscriptions',         # Depends: users
    'chat_messages',              # Depends: users
    'alerts',                     # No dependencies (geom is JSON)
    'alert_feedback',             # Depends: alerts, users
    'incident_logs',              # Depends: alerts, users
    'community_reports',          # Depends: users
    'status_checks',              # Depends: users
    'community_posts',            # Depends: users
    'user_reports',               # Depends: community_posts
    'comments',                   # Depends: users, community_posts, community_reports, comments (self)
    'direct_messages',            # Depends: community_posts
    'notifications',              # Depends: community_posts
    'ai_logs',                    # Depends: users
    'earthquake_dataset',         # No dependencies
    'flood_dataset',              # No dependencies
    'heatwave_dataset',           # No dependencies
    'nearby_disaster_dataset',    # No dependencies
    'weather_dataset',            # No dependencies
    'aqi_dataset',                # No dependencies
    'source_ingestion_logs',      # No dependencies
]

# ==================== MIGRATION LOGIC ====================

def get_async_session():
    """Create async session for Supabase"""
    return AsyncSession(async_engine, expire_on_commit=False)

def get_sqlite_session():
    """Create sync session for SQLite"""
    return SQLiteSession()

async def migrate_table(table_name: str, sqlite_session: Session, async_session: AsyncSession) -> Dict[str, Any]:
    """
    Migrate a single table from SQLite to Supabase using raw INSERT SQL
    Returns: {"table": name, "rows_migrated": count, "errors": [], "status": "success|error"}
    """
    result = {
        "table": table_name,
        "rows_migrated": 0,
        "rows_skipped": 0,
        "errors": [],
        "status": "pending"
    }

    try:
        # Get table structure from SQLite
        sqlite_inspector = inspect(sqlite_engine)
        columns = [col['name'] for col in sqlite_inspector.get_columns(table_name)]
        
        # Query all rows from SQLite
        query = text(f"SELECT {', '.join(f'`{col}`' for col in columns)} FROM `{table_name}`")
        rows = sqlite_session.execute(query).fetchall()
        
        if not rows:
            result["status"] = "success"
            result["rows_migrated"] = 0
            return result

        print(f"  ðŸ“Š {table_name}: Found {len(rows)} rows")

        # Insert into Supabase using raw SQL
        inserted = 0
        skipped = 0
        
        for row_idx, row in enumerate(rows):
            try:
                # Build row dictionary
                row_dict = dict(zip(columns, row))
                
                # Handle JSON fields
                for key, value in row_dict.items():
                    if isinstance(value, str) and (value.startswith('{') or value.startswith('[')):
                        try:
                            row_dict[key] = json.loads(value)
                        except:
                            pass  # Keep as string if not valid JSON

                # Build column list and values safely
                col_names = list(row_dict.keys())
                col_list = ', '.join([f'"{col}"' for col in col_names])
                
                # Build VALUES clause with proper escaping
                values_list = []
                value_placeholders = []
                for col_name, value in row_dict.items():
                    if value is None:
                        value_placeholders.append('NULL')
                    elif isinstance(value, (dict, list)):
                        # JSON values
                        values_list.append(json.dumps(value))
                        value_placeholders.append(f"'{json.dumps(value).replace(chr(39), chr(39)+chr(39))}'::jsonb")
                    elif isinstance(value, bool):
                        value_placeholders.append('true' if value else 'false')
                    elif isinstance(value, (int, float)):
                        value_placeholders.append(str(value))
                    elif isinstance(value, datetime):
                        value_placeholders.append(f"'{value.isoformat()}'")
                    else:
                        # String values - escape single quotes
                        escaped = str(value).replace("'", "''")
                        value_placeholders.append(f"'{escaped}'")

                values_clause = ', '.join(value_placeholders)
                
                # Build ON CONFLICT clause
                pk_col = 'id'
                update_cols = [col for col in col_names if col != pk_col]
                update_clause = ', '.join([f'"{col}" = EXCLUDED."{col}"' for col in update_cols])
                
                insert_sql = f"""
                    INSERT INTO "{table_name}" ({col_list})
                    VALUES ({values_clause})
                    ON CONFLICT ("{pk_col}") DO UPDATE SET {update_clause}
                """
                
                await async_session.execute(text(insert_sql))
                inserted += 1
                
            except Exception as e:
                skipped += 1
                error_msg = f"Row {row_idx+1}: {str(e)[:80]}"
                if len(result["errors"]) < 3:  # Only store first 3 errors
                    result["errors"].append(error_msg)
                if skipped <= 3:  # Print first 3 errors only
                    print(f"    âš ï¸  {error_msg}")

        await async_session.commit()
        
        result["rows_migrated"] = inserted
        result["rows_skipped"] = skipped
        result["status"] = "success"
        print(f"  âœ… {table_name}: {inserted} rows migrated, {skipped} skipped")
        
    except Exception as e:
        await async_session.rollback()
        result["status"] = "error"
        result["errors"].append(str(e)[:200])
        print(f"  âŒ {table_name}: {str(e)[:150]}")

    return result

async def run_migration():
    """Main migration orchestrator"""
    print("\n" + "="*60)
    print("ðŸš€ SURAKSHA SETU - SQLite â†’ Supabase Migration")
    print("="*60)
    
    # Check SQLite exists
    if not os.path.exists('./suraksha_setu.db'):
        print("âŒ ERROR: Local SQLite database (suraksha_setu.db) not found")
        print("   Cannot proceed with migration")
        return
    
    print(f"ðŸ“¦ Source: SQLite ({os.path.getsize('./suraksha_setu.db') / (1024*1024):.1f} MB)")
    print(f"ðŸŽ¯ Target: Supabase PostgreSQL")
    print(f"ðŸ“‹ Tables: {len(TABLE_ORDER)}")
    print("-" * 60)

    sqlite_session = get_sqlite_session()
    async with async_engine.begin() as conn:
        # Ensure tables exist in Supabase
        await conn.run_sync(Base.metadata.create_all)

    async with get_async_session() as async_session:
        all_results = []
        total_migrated = 0
        total_errors = 0

        for table_name in TABLE_ORDER:
            try:
                result = await migrate_table(table_name, sqlite_session, async_session)
                all_results.append(result)
                total_migrated += result.get("rows_migrated", 0)
                total_errors += len(result.get("errors", []))
            except Exception as e:
                print(f"  âŒ CRITICAL ERROR on {table_name}: {str(e)}")
                all_results.append({
                    "table": table_name,
                    "rows_migrated": 0,
                    "status": "error",
                    "errors": [str(e)]
                })

    sqlite_session.close()
    
    # Summary Report
    print("\n" + "="*60)
    print("ðŸ“Š MIGRATION SUMMARY")
    print("="*60)
    
    successful = sum(1 for r in all_results if r["status"] == "success")
    failed = sum(1 for r in all_results if r["status"] == "error")
    
    print(f"âœ… Successful: {successful}/{len(TABLE_ORDER)} tables")
    print(f"âŒ Failed: {failed}/{len(TABLE_ORDER)} tables")
    print(f"ðŸ“ˆ Total rows migrated: {total_migrated}")
    print(f"âš ï¸  Total errors: {total_errors}")
    
    print("\nDetailed Results:")
    for result in all_results:
        status_emoji = "âœ…" if result["status"] == "success" else "âŒ"
        print(f"  {status_emoji} {result['table']:30s} | Rows: {result.get('rows_migrated', 0):6d}")
        if result.get("errors") and len(result["errors"]) <= 3:
            for error in result["errors"][:3]:
                print(f"       â””â”€ {error}")

    print("\n" + "="*60)
    if failed == 0 and total_errors == 0:
        print("âœ¨ MIGRATION COMPLETE - All data transferred successfully!")
    else:
        print("âš ï¸  MIGRATION PARTIAL - Some tables had errors (see above)")
    print("="*60 + "\n")

if __name__ == "__main__":
    asyncio.run(run_migration())


