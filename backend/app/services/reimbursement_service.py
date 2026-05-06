from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models.reimbursement import Reimbursement
from app.models.invoice import InvoiceStatus
from app.models.notification import Notification


async def delete_reimbursement_logic(
    reimb_id: int,
    db: AsyncSession,
    deleted_by_username: str = "管理员",
) -> bool:
    """删除报销单，释放关联发票，并发通知给提交人。"""
    query = select(Reimbursement).options(selectinload(Reimbursement.invoices)).where(Reimbursement.id == reimb_id)
    result = await db.execute(query)
    reimb = result.scalar_one_or_none()

    if not reimb:
        return False

    submitter_id = reimb.submitter_id
    reimb_title = reimb.title

    # 释放绑定的发票
    for inv in reimb.invoices:
        inv.reimbursement_id = None
        inv.status = InvoiceStatus.CONFIRMED

    # 发通知给提交人
    if submitter_id:
        db.add(Notification(
            user_id=submitter_id,
            title="报销单已撤销",
            message=f"您的报销单[{reimb_title}]已被{deleted_by_username}撤销，关联发票已恢复为可用状态。",
            entity_type="reimbursement",
            entity_id=reimb_id,
        ))

    # 删除报销单
    await db.delete(reimb)
    await db.commit()

    return True
