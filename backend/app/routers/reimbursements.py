from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import List

from app.database import get_db
from app.models.reimbursement import Reimbursement, ReimbursementStatus
from app.models.invoice import Invoice, InvoiceStatus
from app.schemas.reimbursement import ReimbursementCreate, ReimbursementResponse, ReimbursementReview
from app.services.reimbursement_service import delete_reimbursement_logic # 引入刚才写的服务
router = APIRouter()


@router.post("", response_model=ReimbursementResponse)
async def create_reimbursement(data: ReimbursementCreate, db: AsyncSession = Depends(get_db)):
    # 1. 查出用户选中的发票
    query = select(Invoice).where(Invoice.id.in_(data.invoice_ids))
    result = await db.execute(query)
    invoices = result.scalars().all()

    if not invoices:
        raise HTTPException(status_code=404, detail="未找到指定的发票")

    # 2. 计算总金额
    total = sum([inv.amount for inv in invoices if inv.amount])

    # 3. 创建报销单
    reimb = Reimbursement(
        title=data.title,
        project_code=data.project_code,
        total_amount=total,
        status=ReimbursementStatus.SUBMITTED
    )
    db.add(reimb)
    await db.flush()  # 刷新获取生成的报销单ID

    # 4. 把发票绑定到这个报销单上
    for inv in invoices:
        inv.reimbursement_id = reimb.id
        inv.status = InvoiceStatus.REIMBURSED  # 更新为"已报销"

    # 5. 提交所有更改到数据库
    await db.commit()

    # 6. 【安全返回】使用 selectinload 预加载，避免 MissingGreenlet 报错
    fetch_query = select(Reimbursement).options(selectinload(Reimbursement.invoices)).where(
        Reimbursement.id == reimb.id)
    fetch_result = await db.execute(fetch_query)
    return fetch_result.scalar_one()

@router.get("", response_model=List[ReimbursementResponse])
async def get_reimbursements(skip: int = 0, limit: int = 100, db: AsyncSession = Depends(get_db)):
    # 【关键修复】：使用 selectinload 预先加载底下的发票数据
    query = select(Reimbursement).options(selectinload(Reimbursement.invoices)).order_by(
        Reimbursement.created_at.desc()).offset(skip).limit(limit)
    result = await db.execute(query)
    return result.scalars().all()


@router.put("/{reimb_id}/review", response_model=ReimbursementResponse)
async def review_reimbursement(reimb_id: int, data: ReimbursementReview, db: AsyncSession = Depends(get_db)):
    # 审批时同样需要预加载发票
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
        # 驳回后，释放底下关联的发票
        for inv in reimb.invoices:
            inv.reimbursement_id = None
            inv.status = InvoiceStatus.CONFIRMED

    await db.commit()
    await db.refresh(reimb)
    return reimb


@router.delete("/{reimb_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_reimbursement(reimb_id: int, db: AsyncSession = Depends(get_db)):
    """
    路由层：接收前端的删除请求，呼叫 Service 处理逻辑
    """
    success = await delete_reimbursement_logic(reimb_id, db)

    if not success:
        raise HTTPException(status_code=404, detail="报销单不存在")

    return None