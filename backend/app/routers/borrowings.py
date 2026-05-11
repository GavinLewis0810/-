from datetime import date
from decimal import Decimal
from typing import Optional
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user
from app.models.borrowing import Borrowing, BorrowingStatus
from app.models.application import Application, ApplicationStatus
from app.models.reimbursement import Reimbursement, ReimbursementStatus
from app.models.bank_card import BankCard
from app.models.transaction import Transaction
from app.models.user import User
from app.models.notification import Notification
from app.services.ws_manager import push_notification

router = APIRouter()


def _borrowing_to_response(b: Borrowing) -> dict:
    return {
        "id": b.id,
        "title": b.title,
        "estimated_amount": float(b.estimated_amount),
        "expected_repayment_date": b.expected_repayment_date.isoformat() if b.expected_repayment_date else None,
        "status": b.status,
        "reject_reason": b.reject_reason,
        "repaid_amount": float(b.repaid_amount) if b.repaid_amount else None,
        "reimbursement_id": b.reimbursement_id,
        "application_id": b.application_id,
        "application_title": b.application.title if b.application else None,
        "user_name": b.user.full_name if b.user else None,
        "approver_name": b.approver.full_name if b.approver else None,
        "created_at": b.created_at.isoformat() if b.created_at else None,
    }


_BASE_OPTIONS = [
    selectinload(Borrowing.user),
    selectinload(Borrowing.approver),
    selectinload(Borrowing.application),
]


class BorrowCreate(BaseModel):
    title: Optional[str] = None
    estimated_amount: float
    expected_repayment_date: Optional[str] = None
    application_id: int


@router.get("")
async def list_borrowings(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """获取借款申请列表。管理员看全部，员工只看自己的。"""
    query = select(Borrowing).options(*_BASE_OPTIONS).order_by(Borrowing.created_at.desc())

    if current_user["role"] != "admin":
        query = query.where(Borrowing.user_id == current_user["id"])

    result = await db.execute(query)
    borrowings = result.scalars().all()
    return [_borrowing_to_response(b) for b in borrowings]


@router.post("")
async def create_borrowing(
    data: BorrowCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """财务管理员对已通过的事前申请进行先行拨款（即创建借款，自动批准）。"""
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="仅财务管理员可进行拨款操作")

    # 验证关联的事前申请
    app = await db.get(Application, data.application_id)
    if not app:
        raise HTTPException(status_code=404, detail="事前申请不存在")
    if app.status != ApplicationStatus.APPROVED.value:
        raise HTTPException(status_code=400, detail="只能对状态为「已通过」的事前申请单进行拨款")

    # 校验申请剩余额度（已通过的报销 + 已批准未冲销的拨款）
    app_used_by_reimb = await db.scalar(
        select(func.coalesce(func.sum(Reimbursement.total_amount), 0)).where(
            Reimbursement.application_id == data.application_id,
            Reimbursement.status.in_([ReimbursementStatus.APPROVED, ReimbursementStatus.COMPLETED]),
        )
    ) or 0
    app_used_by_borrowing = await db.scalar(
        select(func.coalesce(func.sum(Borrowing.estimated_amount), 0)).where(
            Borrowing.application_id == data.application_id,
            Borrowing.status == BorrowingStatus.APPROVED.value,
        )
    ) or 0
    app_remaining = app.estimated_amount - Decimal(str(app_used_by_reimb)) - Decimal(str(app_used_by_borrowing))
    if Decimal(str(data.estimated_amount)) > app_remaining:
        raise HTTPException(
            status_code=400,
            detail=f"拨款金额 ¥{data.estimated_amount:.2f} 超出申请单剩余额度 ¥{float(app_remaining):.2f}"
                  f"（申请总额 ¥{float(app.estimated_amount):.2f}，已报销 ¥{float(app_used_by_reimb):.2f}，已拨款 ¥{float(app_used_by_borrowing):.2f}）",
        )

    # 拨款：借款归属申请提交人，财务操作直接批准
    # 事由自动从申请单继承
    b = Borrowing(
        user_id=app.user_id,
        title=data.title or f"先行拨款-{app.title}",
        estimated_amount=data.estimated_amount,
        expected_repayment_date=date.fromisoformat(data.expected_repayment_date) if data.expected_repayment_date else None,
        application_id=data.application_id,
        reason_category_id=app.reason_category_id,
        status=BorrowingStatus.APPROVED.value,
        approved_by=current_user["id"],
    )
    db.add(b)

    # 通知申请人拨款已到账
    await push_notification(
        db, app.user_id,
        title="先行拨款已到账",
        message=f"您的事前申请「{app.title}」已获得拨款 ¥{data.estimated_amount:.2f}（{data.title}），请及时报销冲销。",
        entity_type="borrowing", entity_id=b.id,
    )

    # 银行卡余额变动：找到申请人的默认银行卡，存入拨款
    card = (await db.execute(
        select(BankCard).where(BankCard.user_id == app.user_id, BankCard.is_default == True)
    )).scalar_one_or_none()
    if not card:
        card = (await db.execute(
            select(BankCard).where(BankCard.user_id == app.user_id)
        )).scalars().first()

    if card:
        balance_before = card.balance
        card.balance = Decimal(str(card.balance)) + Decimal(str(data.estimated_amount))
        db.add(Transaction(
            type="拨款",
            amount=data.estimated_amount,
            bank_card_id=card.id,
            borrowing_id=b.id,
            balance_before=balance_before,
            balance_after=card.balance,
            note=f"事前申请「{app.title}」先行拨款，{data.title}",
        ))

    await db.commit()
    await db.refresh(b)

    # 重新加载关系
    query = select(Borrowing).options(*_BASE_OPTIONS).where(Borrowing.id == b.id)
    result = await db.execute(query)
    b = result.scalar_one()
    return _borrowing_to_response(b)


@router.put("/{borrowing_id}/approve")
async def approve_borrowing(
    borrowing_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """管理员批准借款。"""
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="仅管理员可审批")

    query = select(Borrowing).options(*_BASE_OPTIONS).where(Borrowing.id == borrowing_id)
    result = await db.execute(query)
    b = result.scalar_one_or_none()
    if not b:
        raise HTTPException(status_code=404, detail="借款申请不存在")
    if b.status != BorrowingStatus.SUBMITTED.value:
        raise HTTPException(status_code=400, detail="只能审批状态为'待审批'的借款申请")

    b.status = BorrowingStatus.APPROVED.value
    b.approved_by = current_user["id"]

    await push_notification(
        db, b.user_id,
        title="借款申请已批准",
        message=f"您的借款「{b.title}」¥{float(b.estimated_amount):.2f} 已批准，请及时报销冲销。",
        entity_type="borrowing", entity_id=b.id,
    )

    await db.commit()
    await db.refresh(b)
    return _borrowing_to_response(b)


@router.put("/{borrowing_id}/reject")
async def reject_borrowing(
    borrowing_id: int,
    data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """驳回借款申请。"""
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="仅管理员可审批")

    query = select(Borrowing).options(*_BASE_OPTIONS).where(Borrowing.id == borrowing_id)
    result = await db.execute(query)
    b = result.scalar_one_or_none()
    if not b:
        raise HTTPException(status_code=404, detail="借款申请不存在")

    b.status = BorrowingStatus.REJECTED.value
    b.reject_reason = data.get("reason", "")

    await push_notification(
        db, b.user_id,
        title="借款申请已驳回",
        message=f"您的借款「{b.title}」已被驳回。原因：{b.reject_reason or '无'}",
        entity_type="borrowing", entity_id=b.id,
    )

    await db.commit()
    await db.refresh(b)
    return _borrowing_to_response(b)


@router.delete("/{borrowing_id}")
async def delete_borrowing(
    borrowing_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """删除借款。草稿/已驳回直接删；已批准/已冲销会回退银行卡余额。"""
    query = select(Borrowing).where(Borrowing.id == borrowing_id)
    result = await db.execute(query)
    b = result.scalar_one_or_none()
    if not b:
        raise HTTPException(status_code=404, detail="借款申请不存在")

    if current_user["role"] != "admin" and b.user_id != current_user["id"]:
        raise HTTPException(status_code=403, detail="无权删除")

    # 已批准或已冲销的借款，删除时需回退银行卡余额
    if b.status in [BorrowingStatus.APPROVED.value, BorrowingStatus.REPAID.value]:
        # 先查有没有实际的拨款流水（旧借款可能没有）
        disburse_txs = (await db.execute(
            select(Transaction).where(
                Transaction.borrowing_id == borrowing_id,
                Transaction.type == "拨款",
            )
        )).scalars().all()

        if disburse_txs:
            # 用实际拨款金额回退（防止旧数据金额不一致）
            total_disbursed = sum((tx.amount for tx in disburse_txs), Decimal("0"))
            card = (await db.execute(
                select(BankCard).where(BankCard.user_id == b.user_id, BankCard.is_default == True)
            )).scalar_one_or_none()
            if not card:
                card = (await db.execute(
                    select(BankCard).where(BankCard.user_id == b.user_id)
                )).scalars().first()
            if card:
                balance_before = card.balance
                card.balance = Decimal(str(card.balance)) - total_disbursed
                db.add(Transaction(
                    type="拨款撤回",
                    amount=Decimal(str(-total_disbursed)),
                    bank_card_id=card.id,
                    borrowing_id=None,
                    balance_before=balance_before,
                    balance_after=card.balance,
                    note=f"借款「{b.title}」被删除，拨款 ¥{float(total_disbursed):.2f} 已撤回",
                ))

        # 清除报销单对借款的引用
        if b.reimbursement_id:
            from app.models.reimbursement import Reimbursement
            reimb = await db.get(Reimbursement, b.reimbursement_id)
            if reimb:
                reimb.borrowing_id = None

    # 解除所有关联交易流水的借款引用，防止外键冲突
    existing_txs = (await db.execute(
        select(Transaction).where(Transaction.borrowing_id == borrowing_id)
    )).scalars().all()
    for tx in existing_txs:
        tx.borrowing_id = None

    await db.delete(b)
    await db.commit()
    return {"message": "已删除"}
