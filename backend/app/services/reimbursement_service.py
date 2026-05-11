from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from sqlalchemy.orm import selectinload

from app.models.reimbursement import Reimbursement
from app.models.invoice import InvoiceStatus
from app.models.notification import Notification
from app.services.ws_manager import push_notification
from app.models.borrowing import Borrowing
from app.models.transaction import Transaction


async def delete_reimbursement_logic(
    reimb_id: int,
    db: AsyncSession,
    deleted_by_username: str = "管理员",
) -> bool:
    """删除报销单，释放关联发票，解除借款/交易关联，并发通知给提交人。"""
    query = select(Reimbursement).options(selectinload(Reimbursement.invoices)).where(Reimbursement.id == reimb_id)
    result = await db.execute(query)
    reimb = result.scalar_one_or_none()

    if not reimb:
        return False

    submitter_id = reimb.submitter_id
    reimb_title = reimb.title

    # 解除关联借款的冲销引用
    await db.execute(
        update(Borrowing).where(Borrowing.reimbursement_id == reimb_id).values(reimbursement_id=None)
    )
    # 解除关联交易流水的引用
    await db.execute(
        update(Transaction).where(Transaction.reimbursement_id == reimb_id).values(reimbursement_id=None)
    )

    # 释放绑定的发票
    for inv in reimb.invoices:
        inv.reimbursement_id = None
        inv.status = InvoiceStatus.CONFIRMED

    # 发通知给提交人
    if submitter_id:
        await push_notification(
            db, submitter_id,
            title="报销单已撤销",
            message=f"您的报销单[{reimb_title}]已被{deleted_by_username}撤销，关联发票已恢复为可用状态。",
            entity_type="reimbursement", entity_id=reimb_id,
        )

    # 删除报销单
    await db.delete(reimb)
    await db.commit()

    return True
