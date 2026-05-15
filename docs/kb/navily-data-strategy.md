---
title: Navily Data Extraction Strategy
tags: [navily, api, data, sync, export, duckdb]
---

# Navily Data Extraction Strategy

How to get all the data out of Navily for offline analysis and cross-system joins.

---

## Bulk Export Endpoints

> TODO Phase 3c: Cross-reference from architecture spec. Rank by volume and completeness.

| Endpoint | Method | Format | Row Limit | Notes |
|----------|--------|--------|-----------|-------|
| | | | | |

## Response Format Decoding

> TODO Phase 3c: Document decoding strategy for each export format encountered.

| Format | Detection | Decoding |
|--------|-----------|----------|
| Raw base64 | Response is plain base64 text | `Buffer.from(body, 'base64')` |
| JSON-wrapped base64 | `{"data": "base64..."}` | Parse JSON, decode `data` field |
| Direct binary (XLSX) | `content-type: application/octet-stream` | Write body to file, parse with library |
| CSV with BOM | Starts with `\uFEFF` | Strip BOM, parse as CSV |

## Pagination Strategies

> TODO Phase 3b/7: Document which strategy each domain needs.

| Domain | Strategy | Params | Notes |
|--------|----------|--------|-------|
| | Offset/limit | `offset=0&limit=100` | |
| | Cursor-based | `cursor=abc123` | |
| | Date windowing | `from=...&to=...` | |
| | Tree traversal (BFS) | `/nodes/{id}/children` | |

## Sync Approach per Domain

> TODO Phase 9: Choose strategy for each entity domain.

| Domain | Strategy | Frequency | Key Field | Notes |
|--------|----------|-----------|-----------|-------|
| | Full refresh | Daily | — | Small dimension table |
| | Incremental by date | Hourly | OrderDate | Large fact table |
| | Snapshot + diff | Daily | — | No updated_at field |

## Data Availability Matrix

> TODO Phase 3c/9: For each entity, document how it can be accessed.

| Entity | JSON API | CSV Export | Excel Export | Date Range | Org-scoped |
|--------|----------|------------|--------------|------------|------------|
| | | | | | |

## DuckDB Schema

> TODO Phase 9: Design tables. Always include org_id for multi-tenant, synced_at for audit.

```sql
-- Example:
-- CREATE TABLE IF NOT EXISTS navily_orders (
--   id VARCHAR PRIMARY KEY,
--   org_id VARCHAR NOT NULL,
--   order_date TIMESTAMP,
--   total_amount DECIMAL(12,2),
--   synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
-- );
```

## Sync State Tracking

> TODO Phase 9: Define what gets tracked for resumable incremental syncs.

| Entity | Last Sync | Cursor | Status | Row Count |
|--------|-----------|--------|--------|-----------|
| | | | | |
