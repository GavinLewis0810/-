from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models.reimbursement import Reimbursement
from app.models.invoice import InvoiceStatus


async def delete_reimbursement_logic(reimb_id: int, db: AsyncSession) -> bool:
    """
    业务逻辑：删除报销单，并释放关联的发票
    返回 True 表示删除成功，False 表示报销单不存在
    """
    # 1. 查出报销单以及它关联的发票
    query = select(Reimbursement).options(selectinload(Reimbursement.invoices)).where(Reimbursement.id == reimb_id)
    result = await db.execute(query)
    reimb = result.scalar_one_or_none()

    if not reimb:
        return False

    # 2. 释放绑定的发票，让它们恢复为“已确认”的自由身
    for inv in reimb.invoices:
        inv.reimbursement_id = None
        inv.status = InvoiceStatus.CONFIRMED

    # 3. 删除报销单并提交事务
    await db.delete(reimb)
    await db.commit()

    return True