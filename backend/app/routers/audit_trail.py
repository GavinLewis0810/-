"""操作审计与流程洞察 API"""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, text, case
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.audit_log import AuditLog
from app.models.reimbursement import Reimbursement, ReimbursementStatus
from app.schemas.invoice import (
    AuditLogItem, AuditLogResponse, AuditStats, FlowStat,
)

router = APIRouter(prefix="/api/audit", tags=["audit"])


@router.get("/logs", response_model=AuditLogResponse)
async def get_logs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    entity_type: Optional[str] = None,
    action: Optional[str] = None,
    user_id: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """分页查询审计日志"""
    query = select(AuditLog)
    count_query = select(func.count(AuditLog.id))

    if entity_type:
        query = query.where(AuditLog.entity_type == entity_type)
        count_query = count_query.where(AuditLog.entity_type == entity_type)
    if action:
        query = query.where(AuditLog.action == action)
        count_query = count_query.where(AuditLog.action == action)
    if user_id:
        query = query.where(AuditLog.user_id == user_id)
        count_query = count_query.where(AuditLog.user_id == user_id)
    if date_from:
        query = query.where(AuditLog.created_at >= datetime.fromisoformat(date_from))
        count_query = count_query.where(AuditLog.created_at >= datetime.fromisoformat(date_from))
    if date_to:
        query = query.where(AuditLog.created_at <= datetime.fromisoformat(date_to))
        count_query = count_query.where(AuditLog.created_at <= datetime.fromisoformat(date_to))

    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    query = query.order_by(AuditLog.created_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    logs = result.scalars().all()

    items = [
        AuditLogItem(
            id=log.id,
            entity_type=log.entity_type,
            entity_id=log.entity_id,
            action=log.action,
            old_value=log.old_value,
            new_value=log.new_value,
            user_id=log.user_id,
            ip_address=log.ip_address,
            user_agent=log.user_agent,
            details=log.details,
            created_at=log.created_at.strftime('%Y-%m-%dT%H:%M:%SZ'),
        )
        for log in logs
    ]

    return AuditLogResponse(items=items, total=total, page=page, page_size=page_size)


@router.get("/stats", response_model=AuditStats)
async def get_stats(db: AsyncSession = Depends(get_db)):
    """审计摘要统计"""
    now = datetime.now()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    # 今日/本月计数
    today_count = await db.scalar(
        select(func.count(AuditLog.id)).where(AuditLog.created_at >= today_start)
    ) or 0
    month_count = await db.scalar(
        select(func.count(AuditLog.id)).where(AuditLog.created_at >= month_start)
    ) or 0

    # 按动作统计
    action_result = await db.execute(
        select(AuditLog.action, func.count(AuditLog.id))
        .where(AuditLog.created_at >= month_start)
        .group_by(AuditLog.action)
    )
    by_action = [{"action": r[0], "count": r[1]} for r in action_result.all()]

    # 按实体类型统计
    entity_result = await db.execute(
        select(AuditLog.entity_type, func.count(AuditLog.id))
        .where(AuditLog.created_at >= month_start)
        .group_by(AuditLog.entity_type)
    )
    by_entity = [{"entity_type": r[0], "count": r[1]} for r in entity_result.all()]

    return AuditStats(
        today_count=today_count,
        month_count=month_count,
        by_action=by_action,
        by_entity=by_entity,
    )


@router.get("/flow-stats", response_model=FlowStat)
async def get_flow_stats(db: AsyncSession = Depends(get_db)):
    """审批流程耗时：找最新一条已完成报销单，读其审计日志时间戳直接算"""
    # 1. 找到最近完成的报销单
    latest_complete = await db.scalar(
        select(AuditLog)
        .where(AuditLog.entity_type == "reimbursement")
        .where(AuditLog.action == "complete")
        .order_by(AuditLog.created_at.desc())
        .limit(1)
    )

    s2a = a2p = total = 0.0
    latest_eid = None

    if latest_complete:
        eid = latest_complete.entity_id
        latest_eid = eid
        comp_time = latest_complete.created_at

        # 2. 查同一报销单的 submit 和 approve 时间
        submit_log = await db.scalar(
            select(AuditLog).where(AuditLog.entity_type == "reimbursement")
            .where(AuditLog.entity_id == eid).where(AuditLog.action == "submit")
            .order_by(AuditLog.created_at).limit(1)
        )
        approve_log = await db.scalar(
            select(AuditLog).where(AuditLog.entity_type == "reimbursement")
            .where(AuditLog.entity_id == eid).where(AuditLog.action == "approve")
            .order_by(AuditLog.created_at).limit(1)
        )

        if submit_log and approve_log:
            s2a = max((approve_log.created_at - submit_log.created_at).total_seconds() / 60, 0.1)
        if approve_log:
            a2p = max((comp_time - approve_log.created_at).total_seconds() / 60, 0.1)
        if submit_log:
            total = max((comp_time - submit_log.created_at).total_seconds() / 60, 0.1)

    # 3. 近30天平均
    thirty_days_ago = datetime.now() - timedelta(days=30)
    complete_logs = (await db.execute(
        select(AuditLog).where(AuditLog.entity_type == "reimbursement")
        .where(AuditLog.action == "complete")
        .where(AuditLog.created_at >= thirty_days_ago)
    )).scalars().all()

    avg_s2a = avg_a2p = avg_total = 0.0
    all_diffs = []
    for clog in complete_logs:
        eid = clog.entity_id
        sl = await db.scalar(
            select(AuditLog).where(AuditLog.entity_type == "reimbursement")
            .where(AuditLog.entity_id == eid).where(AuditLog.action == "submit")
            .order_by(AuditLog.created_at).limit(1)
        )
        al = await db.scalar(
            select(AuditLog).where(AuditLog.entity_type == "reimbursement")
            .where(AuditLog.entity_id == eid).where(AuditLog.action == "approve")
            .order_by(AuditLog.created_at).limit(1)
        )
        if sl and al:
            all_diffs.append({
                "s2a": (al.created_at - sl.created_at).total_seconds() / 60,
                "a2p": (clog.created_at - al.created_at).total_seconds() / 60,
                "tot": (clog.created_at - sl.created_at).total_seconds() / 60,
            })

    if all_diffs:
        avg_s2a = round(sum(d["s2a"] for d in all_diffs) / len(all_diffs), 1)
        avg_a2p = round(sum(d["a2p"] for d in all_diffs) / len(all_diffs), 1)
        avg_total = round(sum(d["tot"] for d in all_diffs) / len(all_diffs), 1)

    pending_count = await db.scalar(
        select(func.count(Reimbursement.id))
        .where(Reimbursement.status == ReimbursementStatus.SUBMITTED)
    ) or 0

    return FlowStat(
        latest_reimb_id=latest_eid,
        latest_submit_to_approve_minutes=round(s2a, 1),
        latest_approve_to_pay_minutes=round(a2p, 1),
        latest_total_minutes=round(total, 1),
        avg_submit_to_approve_minutes=avg_s2a,
        avg_approve_to_pay_minutes=avg_a2p,
        avg_total_minutes=avg_total,
        pending_count=pending_count,
    )
