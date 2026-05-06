"""消息通知端点。"""
from typing import Optional, List
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel, field_validator

from app.database import get_db
from app.models.notification import Notification
from app.dependencies import get_current_user

router = APIRouter()


class NotificationItem(BaseModel):
    id: int
    title: str
    message: Optional[str] = None
    is_read: bool
    entity_type: Optional[str] = None
    entity_id: Optional[int] = None
    created_at: str  # ISO 格式字符串

    @field_validator('created_at', mode='before')
    @classmethod
    def serialize_datetime(cls, v):
        if isinstance(v, datetime):
            return v.isoformat()
        return str(v) if v else ''

    class Config:
        from_attributes = True


@router.get("", response_model=List[NotificationItem])
async def get_notifications(
    unread_only: bool = False,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """获取当前用户的通知列表。"""
    query = select(Notification).where(
        Notification.user_id == current_user["id"]
    ).order_by(Notification.created_at.desc()).limit(limit)

    if unread_only:
        query = query.where(Notification.is_read == False)  # noqa: E712

    result = await db.execute(query)
    return result.scalars().all()


@router.get("/unread-count")
async def get_unread_count(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """获取未读通知数量。"""
    count = await db.scalar(
        select(func.count(Notification.id)).where(
            Notification.user_id == current_user["id"],
            Notification.is_read == False,  # noqa: E712
        )
    ) or 0
    return {"count": count}


@router.post("/{notif_id}/read")
async def mark_as_read(
    notif_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """标记单条通知为已读。"""
    query = select(Notification).where(
        Notification.id == notif_id,
        Notification.user_id == current_user["id"],
    )
    result = await db.execute(query)
    notif = result.scalar_one_or_none()
    if not notif:
        raise HTTPException(status_code=404, detail="通知不存在")
    notif.is_read = True
    await db.commit()
    return {"message": "已读"}


@router.post("/read-all")
async def mark_all_read(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """标记所有通知为已读。"""
    query = select(Notification).where(
        Notification.user_id == current_user["id"],
        Notification.is_read == False,  # noqa: E712
    )
    result = await db.execute(query)
    for notif in result.scalars().all():
        notif.is_read = True
    await db.commit()
    return {"message": "全部已读"}
