from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import List, Optional

from app.database import get_db
from app.models.reimbursement import Reimbursement, ReimbursementStatus
from app.models.invoice import Invoice, InvoiceStatus
from app.schemas.reimbursement import ReimbursementCreate, ReimbursementResponse, ReimbursementReview
from app.services.reimbursement_service import delete_reimbursement_logic
from app.services.audit_service import log_audit_no_commit, get_client_info

router = APIRouter()


@router.post("", response_model=ReimbursementResponse)
async def create_reimbursement(data: ReimbursementCreate, db: AsyncSession = Depends(get_db)):
    query = select(Invoice).where(Invoice.id.in_(data.invoice_ids))
    result = await db.execute(query)
    invoices = result.scalars().all()

    if not invoices:
        raise HTTPException(status_code=404, detail="未找到指定的发票")

    total = sum([inv.total_with_tax for inv in invoices if inv.total_with_tax])

    reimb = Reimbursement(
        title=data.title,
        project_code=data.project_code,
        total_amount=total,
        status=ReimbursementStatus.SUBMITTED
    )
    db.add(reimb)
    await db.flush()

    for inv in invoices:
        inv.reimbursement_id = reimb.id
        inv.status = InvoiceStatus.REIMBURSED

    await db.commit()

    fetch_query = select(Reimbursement).options(selectinload(Reimbursement.invoices)).where(
        Reimbursement.id == reimb.id)
    fetch_result = await db.execute(fetch_query)
    return fetch_result.scalar_one()


@router.get("", response_model=List[ReimbursementResponse])
async def get_reimbursements(skip: int = 0, limit: int = 100, db: AsyncSession = Depends(get_db)):
    query = select(Reimbursement).options(selectinload(Reimbursement.invoices)).order_by(
        Reimbursement.created_at.desc()).offset(skip).limit(limit)
    result = await db.execute(query)
    return result.scalars().all()


@router.put("/{reimb_id}/review", response_model=ReimbursementResponse)
async def review_reimbursement(reimb_id: int, data: ReimbursementReview, db: AsyncSession = Depends(get_db)):
    query = select(Reimbursement).options(selectinload(Reimbursement.invoices)).where(Reimbursement.id == reimb_id)
    result = await db.execute(query)
    reimb = result.scalar_one_or_none()

    if not reimb:
        raise HTTPException(status_code=404, detail="报销单不存在")

    if data.action == "APPROVE":
        reimb.status = ReimbursementStatus.APPROVED
    elif data.action == "REJECT":
        reimb.status = ReimbursementStatus.REJECTED
        reimb.reject_reason = data.reject_reason
        for inv in reimb.invoices:
            inv.reimbursement_id = None
            inv.status = InvoiceStatus.CONFIRMED

    await db.commit()
    await db.refresh(reimb)
    return reimb


@router.delete("/{reimb_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_reimbursement(reimb_id: int, db: AsyncSession = Depends(get_db)):
    success = await delete_reimbursement_logic(reimb_id, db)
    if not success:
        raise HTTPException(status_code=404, detail="报销单不存在")
    return None


@router.post("/{reimb_id}/ai-check")
async def ai_check_reimbursement(
    reimb_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    AI 智能合规审查
    """
    import json
    import logging
    from app.services.prompts import build_ai_check_prompt
    from app.services.llm_service import get_llm_service

    logger = logging.getLogger(__name__)

    # 1. 查报销单 + 预加载关联发票
    query = select(Reimbursement).options(
        selectinload(Reimbursement.invoices)
    ).where(Reimbursement.id == reimb_id)
    result = await db.execute(query)
    reimb = result.scalar_one_or_none()

    if not reimb:
        raise HTTPException(status_code=404, detail="报销单不存在")
    if not reimb.invoices:
        raise HTTPException(status_code=400, detail="该报销单没有关联发票，无法审查")

    # 2. 提取发票数据
    invoices_data = []
    for inv in reimb.invoices:
        invoices_data.append({
            "invoice_number": inv.invoice_number or "无号码",
            "seller_name": inv.seller_name or "",
            "total_with_tax": str(inv.total_with_tax) if inv.total_with_tax else "0.00",
            "items": inv.items or [],
        })

    # 3. 构造 Prompt
    prompt = build_ai_check_prompt(
        reimb_title=reimb.title,
        reimb_amount=str(reimb.total_amount),
        invoices=invoices_data
    )

    # 4. 调用 LLM（使用现有的 QwenProvider）
    try:
        llm_service = get_llm_service()
        provider = llm_service.active_provider
        if not provider or not provider.is_configured():
            raise HTTPException(status_code=500, detail="LLM 服务未配置")

        llm_response = provider.chat_completion(
            system_prompt="你是一位严谨的财务审计专家。请严格按照 JSON 格式输出审计结果。",
            user_prompt=prompt
        )
    except Exception as exc:
        logger.error(f"LLM 调用失败：{exc}")
        raise HTTPException(status_code=500, detail=f"AI 审查服务调用失败：{str(exc)}")

    # 5. 解析结果
    cleaned = llm_response.strip()
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        cleaned = "\n".join(lines[1:-1]) if len(lines) > 2 else lines[0]

    try:
        result_dict = json.loads(cleaned)
    except json.JSONDecodeError:
        logger.warning(f"AI 返回非 JSON 格式，原文：{llm_response}")
        result_dict = {
            "compliance_status": "未知",
            "risk_level": "未知",
            "reason": "AI 返回格式异常，请查看备注",
            "remarks": llm_response,
            "details": [],
        }

    return result_dict


# ============================================================
# 第四步（配套）：后端审批通过 / 驳回端点
# ============================================================

@router.put("/{reimb_id}/approve")
async def approve_reimbursement(
    reimb_id: int,
    body: dict,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """审批通过报销单"""
    query = select(Reimbursement).options(
        selectinload(Reimbursement.invoices)
    ).where(Reimbursement.id == reimb_id)
    result = await db.execute(query)
    reimb = result.scalar_one_or_none()

    if not reimb:
        raise HTTPException(status_code=404, detail="报销单不存在")
    if reimb.status != ReimbursementStatus.SUBMITTED:
        raise HTTPException(status_code=400, detail="只能审批状态为「待审批」的报销单")

    reimb.status = ReimbursementStatus.APPROVED
    reimb.reviewer = body.get("reviewer", "系统")
    review_note = body.get("review_note", "")
    if hasattr(reimb, "review_note"):
        reimb.review_note = review_note

    client_info = get_client_info(request)
    await log_audit_no_commit(
        db=db,
        entity_type="reimbursement",
        entity_id=reimb_id,
        action="approve",
        new_value={
            "status": ReimbursementStatus.APPROVED.value,
            "review_note": review_note,
            "invoice_count": len(reimb.invoices),
        },
        ip_address=client_info.get("ip_address"),
        user_agent=client_info.get("user_agent"),
    )

    await db.commit()
    await db.refresh(reimb)

    return {
        "message": "审批通过",
        "reimbursement_id": reimb_id,
        "invoice_count": len(reimb.invoices),
    }


@router.put("/{reimb_id}/reject")
async def reject_reimbursement(
    reimb_id: int,
    body: dict,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """驳回报销单，释放关联发票"""
    query = select(Reimbursement).options(
        selectinload(Reimbursement.invoices)
    ).where(Reimbursement.id == reimb_id)
    result = await db.execute(query)
    reimb = result.scalar_one_or_none()

    if not reimb:
        raise HTTPException(status_code=404, detail="报销单不存在")
    if reimb.status != ReimbursementStatus.SUBMITTED:
        raise HTTPException(status_code=400, detail="只能驳回状态为「待审批」的报销单")

    reimb.status = ReimbursementStatus.REJECTED
    reject_reason = body.get("reject_reason", "无")
    reimb.reject_reason = reject_reason

    for inv in reimb.invoices:
        inv.reimbursement_id = None
        inv.status = InvoiceStatus.CONFIRMED

    client_info = get_client_info(request)
    await log_audit_no_commit(
        db=db,
        entity_type="reimbursement",
        entity_id=reimb_id,
        action="reject",
        new_value={
            "status": ReimbursementStatus.REJECTED.value,
            "reject_reason": reject_reason,
            "invoice_count": len(reimb.invoices),
        },
        ip_address=client_info.get("ip_address"),
        user_agent=client_info.get("user_agent"),
    )

    await db.commit()
    await db.refresh(reimb)

    return {
        "message": "已驳回，关联发票已释放",
        "reimbursement_id": reimb_id,
    }