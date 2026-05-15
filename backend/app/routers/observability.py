"""Observability router — AI engine monitoring stats endpoint."""

import logging
from datetime import datetime, timedelta, date
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/observability", tags=["Observability"])


@router.get("/stats")
async def get_observability_stats(db: AsyncSession = Depends(get_db)):
    """聚合 AI 引擎可观测性数据：KPI、时序延迟、仲裁漏斗、最近日志。"""
    today = date.today()
    yesterday = today - timedelta(days=1)
    now = datetime.now()
    past_24h = now - timedelta(hours=24)

    # ── KPI: 日总调用量 ──
    today_count = await db.scalar(
        text("SELECT COUNT(*) FROM ai_call_logs WHERE created_at::date = :d"),
        {"d": today},
    ) or 0
    yesterday_count = await db.scalar(
        text("SELECT COUNT(*) FROM ai_call_logs WHERE created_at::date = :d"),
        {"d": yesterday},
    ) or 0
    if yesterday_count > 0:
        daily_change_pct = round((today_count - yesterday_count) / yesterday_count * 100, 1)
    elif today_count > 0:
        daily_change_pct = 100.0
    else:
        daily_change_pct = 0.0

    # ── KPI: OCR / LLM 平均延迟（全天） ──
    ocr_avg = await db.scalar(
        text("SELECT AVG(duration_ms) FROM ai_call_logs WHERE engine='ocr' AND created_at::date = :d"),
        {"d": today},
    ) or 0
    llm_avg = await db.scalar(
        text("SELECT AVG(duration_ms) FROM ai_call_logs WHERE engine='llm' AND created_at::date = :d"),
        {"d": today},
    ) or 0

    # ── KPI: HITL 降级拦截率 ──
    today_invoice_count = await db.scalar(
        text("SELECT COUNT(DISTINCT invoice_id) FROM ai_call_logs WHERE created_at::date = :d"),
        {"d": today},
    ) or 0
    hitl_count = await db.scalar(
        text("""
            SELECT COUNT(DISTINCT pd.invoice_id)
            FROM parsing_diffs pd
            JOIN ai_call_logs acl ON pd.invoice_id = acl.invoice_id
            WHERE acl.created_at::date = :d AND pd.resolved = 0
        """),
        {"d": today},
    ) or 0
    hitl_rate = round(hitl_count / today_invoice_count * 100, 1) if today_invoice_count > 0 else 0.0

    # ── 折线图: 过去 24 小时逐小时引擎延迟 ──
    line_rows = (await db.execute(
        text("""
            SELECT
                date_trunc('hour', created_at) AS hour_bucket,
                engine,
                AVG(duration_ms)::int AS avg_ms
            FROM ai_call_logs
            WHERE created_at >= :since
            GROUP BY hour_bucket, engine
            ORDER BY hour_bucket, engine
        """),
        {"since": past_24h},
    )).fetchall()

    line_data: list[dict] = []
    for row in line_rows:
        hour_bucket = row[0]
        if hasattr(hour_bucket, 'isoformat'):
            hour_str = hour_bucket.strftime('%H:%M')
        else:
            hour_str = str(hour_bucket)[-8:-3] if len(str(hour_bucket)) >= 5 else str(hour_bucket)
        engine_name = 'OCR 引擎延迟' if row[1] == 'ocr' else 'LLM 引擎延迟'
        line_data.append({"time": hour_str, "category": engine_name, "value": row[2]})

    # ── 漏斗图: 总流入 → OCR → LLM → 双引擎一致 ──
    processed_total = await db.scalar(
        text("SELECT COUNT(DISTINCT invoice_id) FROM ai_call_logs WHERE created_at::date = :d"),
        {"d": today},
    ) or 0
    ocr_extracted = await db.scalar(
        text("SELECT COUNT(*) FROM ocr_results WHERE created_at::date = :d"),
        {"d": today},
    ) or 0
    llm_extracted = await db.scalar(
        text("SELECT COUNT(*) FROM llm_results WHERE created_at::date = :d"),
        {"d": today},
    ) or 0
    matched = await db.scalar(
        text("""
            SELECT COUNT(DISTINCT acl.invoice_id)
            FROM ai_call_logs acl
            WHERE acl.created_at::date = :d
            AND NOT EXISTS (
                SELECT 1 FROM parsing_diffs pd
                WHERE pd.invoice_id = acl.invoice_id AND pd.resolved = 0
            )
        """),
        {"d": today},
    ) or 0

    funnel_data = [
        {"stage": "总单据流入", "count": processed_total},
        {"stage": "OCR 初步提取", "count": ocr_extracted},
        {"stage": "LLM 语义校验比对", "count": llm_extracted},
        {"stage": "双引擎一致通过", "count": matched},
    ]

    # ── 最近日志 ──
    log_rows = (await db.execute(
        text("""
            SELECT
                to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') AS ts,
                request_id,
                engine,
                status,
                duration_ms
            FROM ai_call_logs
            ORDER BY created_at DESC
            LIMIT 20
        """),
    )).fetchall()

    status_map = {
        'success': 'success',
        'degraded': 'degraded',
        'error': 'circuit_break',
    }
    recent_logs = []
    for i, row in enumerate(log_rows):
        recent_logs.append({
            "key": str(i + 1),
            "timestamp": row[0],
            "requestId": row[1],
            "engine": row[2].upper(),
            "status": status_map.get(row[3], 'success'),
            "duration": row[4],
        })

    return {
        "kpi": {
            "daily_calls": today_count,
            "daily_calls_change": daily_change_pct,
            "ocr_avg_latency_ms": round(ocr_avg) if ocr_avg > 0 else 0,
            "llm_avg_latency_ms": round(llm_avg) if llm_avg > 0 else 0,
            "hitl_rate": hitl_rate,
        },
        "line_data": line_data,
        "funnel_data": funnel_data,
        "recent_logs": recent_logs,
    }
