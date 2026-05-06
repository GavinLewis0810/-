"""管理员专属端点：用户管理。"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel

from app.database import get_db
from app.models.user import User
from app.models.invoice import Invoice
from app.models.reimbursement import Reimbursement
from app.dependencies import get_current_user
from app.routers.auth import hash_password

router = APIRouter()


def _require_admin(current_user: dict):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="仅管理员可执行此操作")


# -------- 响应模型 --------
class UserItem(BaseModel):
    id: int
    username: str
    full_name: str
    role: str
    department: Optional[str] = None
    is_active: bool
    created_at: Optional[str] = None
    invoice_count: int = 0
    reimbursement_count: int = 0

    class Config:
        from_attributes = True


class ResetPasswordRequest(BaseModel):
    new_password: str


# -------- 端点 --------
@router.get("/users", response_model=list[UserItem])
async def list_users(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """管理员查看所有用户（含发票数、报销单数统计）。"""
    _require_admin(current_user)

    query = select(User).order_by(User.created_at.desc())
    result = await db.execute(query)
    users = result.scalars().all()

    user_list = []
    for u in users:
        # 统计发票数
        inv_count = await db.scalar(
            select(func.count(Invoice.id)).where(Invoice.owner_id == u.id)
        ) or 0
        # 统计报销单数
        reimb_count = await db.scalar(
            select(func.count(Reimbursement.id)).where(Reimbursement.submitter_id == u.id)
        ) or 0

        user_list.append(UserItem(
            id=u.id,
            username=u.username,
            full_name=u.full_name,
            role=u.role,
            department=u.department,
            is_active=u.is_active,
            created_at=u.created_at.isoformat() if u.created_at else None,
            invoice_count=inv_count,
            reimbursement_count=reimb_count,
        ))

    return user_list


@router.put("/users/{user_id}/toggle-status")
async def toggle_user_status(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """启用/禁用用户账号。管理员账号不允许禁用。"""
    _require_admin(current_user)

    query = select(User).where(User.id == user_id)
    result = await db.execute(query)
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if user.role == "admin":
        raise HTTPException(status_code=400, detail="不允许禁用管理员账号")

    user.is_active = not user.is_active
    await db.commit()

    return {"message": f"用户 {user.username} 已{'启用' if user.is_active else '禁用'}", "is_active": user.is_active}


@router.put("/users/{user_id}/reset-password")
async def reset_user_password(
    user_id: int,
    data: ResetPasswordRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """重置用户密码。"""
    _require_admin(current_user)

    query = select(User).where(User.id == user_id)
    result = await db.execute(query)
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    if not data.new_password or len(data.new_password) < 3:
        raise HTTPException(status_code=400, detail="密码至少 3 位")

    user.password_hash = hash_password(data.new_password)
    await db.commit()

    return {"message": f"用户 {user.username} 的密码已重置"}
