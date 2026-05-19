"""ESG 碳足迹追踪 API"""
from collections import defaultdict
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.invoice import Invoice, InvoiceStatus

# 碳足迹统计包含的状态：已确认 + 已报销
CARBON_STATUSES = [InvoiceStatus.CONFIRMED, InvoiceStatus.REIMBURSED]
from app.schemas.invoice import (
    CarbonMyStats, CarbonRankItem, CarbonCompanyStats,
)
from app.services.carbon_config import CARBON_FACTORS, TREE_OFFSET_KG, trees_needed
from app.services.green_config import compute_green_points

router = APIRouter(prefix="/api/carbon", tags=["carbon"])


@router.get("/factors")
async def get_factors():
    """返回碳排放系数表"""
    return {"factors": CARBON_FACTORS, "tree_offset_kg": TREE_OFFSET_KG}


@router.get("/my-stats", response_model=CarbonMyStats)
async def my_stats(
    months: int = Query(1, description="统计最近N个月"),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """当前用户的碳足迹统计"""
    if current_user["role"] == "admin":
        return CarbonMyStats(
            total_carbon_kg=0, tree_offset=0, green_points=0,
            point_sources=[], category_breakdown=[],
            monthly_trend=[], rank=0, rank_percentile=0,
            suggestion="管理员不参与碳足迹排名，以下为全公司数据总览",
        )

    since = datetime.now() - timedelta(days=30 * months)

    # 获取该用户的所有已确认发票
    inv_query = (
        select(Invoice)
        .where(Invoice.status.in_(CARBON_STATUSES))
        .where(Invoice.owner_id == current_user["id"])
    )
    result = await db.execute(inv_query)
    invoices = result.scalars().all()
    print(f"[CARBON] user_id={current_user['id']}, found={len(invoices)} invoices")

    # Python 聚合
    cat_map: dict = {}
    month_map: dict = {}
    total_points = 0
    all_sources: list[str] = []
    for inv in invoices:
        cat = inv.spend_category or "其他"
        if cat not in cat_map:
            cat_map[cat] = {"carbon_kg": 0.0, "count": 0}
        cat_map[cat]["carbon_kg"] += float(inv.carbon_kg or 0)
        cat_map[cat]["count"] += 1
        total_points += (inv.green_points or 0)
        _, sources = compute_green_points(cat, inv.items)
        all_sources.extend(sources)

        if inv.updated_at:
            m = inv.updated_at.strftime("%Y-%m")
            month_map[m] = month_map.get(m, 0) + float(inv.carbon_kg or 0)

    # 去重积分来源
    unique_sources = list(dict.fromkeys(all_sources))

    category_breakdown = [
        {"category": k, "carbon_kg": round(v["carbon_kg"], 2), "count": v["count"]}
        for k, v in cat_map.items()
    ]
    total_carbon = round(sum(c["carbon_kg"] for c in category_breakdown), 2)
    monthly_trend = [
        {"month": k, "carbon_kg": round(v, 2)}
        for k, v in sorted(month_map.items())
    ]

    # 全员排名（按绿色积分降序）
    rank_query = (
        select(
            func.sum(Invoice.green_points).label("total_points"),
        )
        .where(Invoice.status.in_(CARBON_STATUSES))
        .where(Invoice.updated_at >= since)
        .group_by(Invoice.owner_id)
    )
    rank_result = await db.execute(rank_query)
    all_points = sorted([int(r[0] or 0) for r in rank_result.all()], reverse=True)
    rank = next((i + 1 for i, p in enumerate(all_points) if p <= total_points), len(all_points) or 1)
    total_users = len(all_points) or 1
    rank_percentile = round((total_users - rank) / total_users * 100, 1)

    suggestion = "多选择软件服务替代硬件采购，优先考虑翻新/节能设备"
    if category_breakdown:
        top_cat = max(category_breakdown, key=lambda c: c["carbon_kg"])
        if top_cat["category"] == "航空":
            suggestion = "下次出差优先选择高铁，每次可减少约 60% 碳排放"
        elif top_cat["category"] == "出租车/网约车":
            suggestion = "短途出行建议选择公共交通，碳排放可降低 75%"

    return CarbonMyStats(
        total_carbon_kg=total_carbon,
        tree_offset=trees_needed(total_carbon),
        green_points=total_points,
        point_sources=unique_sources,
        category_breakdown=category_breakdown,
        monthly_trend=monthly_trend,
        rank=rank,
        rank_percentile=rank_percentile,
        suggestion=suggestion,
    )


@router.get("/ranking", response_model=list[CarbonRankItem])
async def ranking(
    months: int = Query(1, description="统计最近N个月"),
    db: AsyncSession = Depends(get_db),
):
    """全员低碳排名（碳足迹越低排名越前）"""
    since = datetime.now() - timedelta(days=30 * months)

    rank_query = (
        select(
            Invoice.owner_id,
            func.sum(Invoice.green_points).label("total_points"),
            func.sum(Invoice.carbon_kg).label("total_carbon"),
            func.count(Invoice.id).label("cnt"),
        )
        .join(User, Invoice.owner_id == User.id)
        .where(Invoice.status.in_(CARBON_STATUSES))
        .where(User.role != "admin")
        .group_by(Invoice.owner_id)
    )
    result = await db.execute(rank_query)
    # 按绿色积分降序
    rows = sorted(result.all(), key=lambda r: int(r[1] or 0), reverse=True)

    user_ids = [r[0] for r in rows if r[0]]
    users_map = {}
    if user_ids:
        user_query = select(User).where(User.id.in_(user_ids))
        user_result = await db.execute(user_query)
        for u in user_result.scalars():
            users_map[u.id] = u

    items = []
    for i, (uid, pts, carbon, cnt) in enumerate(rows):
        u = users_map.get(uid) if uid else None
        # 构造积分来源
        _, sources = compute_green_points("", None)  # 兜底：展示无纸化
        items.append(CarbonRankItem(
            rank=i + 1,
            username=u.username if u else "未知",
            full_name=u.full_name if u else "未知",
            department=u.department if u else None,
            green_points=int(pts or 0),
            point_sources=["无纸化"] + ([f"+{int(pts or 0) - 2}"] if int(pts or 0) > 2 else []),
            total_carbon_kg=round(float(carbon or 0), 2),
            invoice_count=cnt,
            tree_offset=trees_needed(float(carbon or 0)),
        ))
    return items


@router.get("/company-stats", response_model=CarbonCompanyStats)
async def company_stats(
    months: int = Query(1, description="统计最近N个月"),
    db: AsyncSession = Depends(get_db),
):
    """全公司碳足迹汇总（管理员）"""
    since = datetime.now() - timedelta(days=30 * months)

    inv_query = (
        select(Invoice)
        .where(Invoice.status.in_(CARBON_STATUSES))
    )
    result = await db.execute(inv_query)
    invoices = result.scalars().all()

    cat_map: dict = {}
    month_map: dict = {}
    user_ids = set()
    for inv in invoices:
        cat = inv.spend_category or "其他"
        cat_map[cat] = cat_map.get(cat, 0) + float(inv.carbon_kg or 0)
        if inv.updated_at:
            m = inv.updated_at.strftime("%Y-%m")
            month_map[m] = month_map.get(m, 0) + float(inv.carbon_kg or 0)
        if inv.owner_id:
            user_ids.add(inv.owner_id)

    category_breakdown = sorted(
        [{"category": k, "carbon_kg": round(v, 2)} for k, v in cat_map.items()],
        key=lambda c: c["carbon_kg"], reverse=True
    )
    total_carbon = round(sum(c["carbon_kg"] for c in category_breakdown), 2)

    monthly_trend = [
        {"month": k, "carbon_kg": round(v, 2)}
        for k, v in sorted(month_map.items())
    ]

    return CarbonCompanyStats(
        total_carbon_kg=total_carbon,
        total_tree_offset=trees_needed(total_carbon),
        avg_carbon_per_user=round(total_carbon / max(len(user_ids), 1), 2),
        top_category=category_breakdown[0]["category"] if category_breakdown else "无数据",
        category_breakdown=category_breakdown,
        monthly_trend=monthly_trend,
    )
