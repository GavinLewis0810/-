"""事由类别管理端点。"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from app.database import get_db
from app.models.reason_category import ReasonCategory
from app.dependencies import get_current_user

router = APIRouter()


class ReasonCategoryCreate(BaseModel):
    name: str
    sort_order: int = 0


class ReasonCategoryUpdate(BaseModel):
    name: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class ReasonCategoryResponse(BaseModel):
    id: int
    name: str
    sort_order: int
    is_active: bool

    class Config:
        from_attributes = True


@router.get("", response_model=List[ReasonCategoryResponse])
async def list_reason_categories(db: AsyncSession = Depends(get_db)):
    """获取所有启用的事由类别（按排序排列）。"""
    query = select(ReasonCategory).where(ReasonCategory.is_active == True).order_by(ReasonCategory.sort_order)
    result = await db.execute(query)
    return result.scalars().all()


@router.post("", response_model=ReasonCategoryResponse)
async def create_reason_category(
    data: ReasonCategoryCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """管理员新增事由类别。"""
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="仅管理员可操作")

    existing = await db.scalar(select(ReasonCategory).where(ReasonCategory.name == data.name))
    if existing:
        raise HTTPException(status_code=400, detail=f"事由类别「{data.name}」已存在")

    rc = ReasonCategory(name=data.name, sort_order=data.sort_order)
    db.add(rc)
    await db.commit()
    await db.refresh(rc)
    return rc


@router.put("/{rc_id}", response_model=ReasonCategoryResponse)
async def update_reason_category(
    rc_id: int,
    data: ReasonCategoryUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """管理员编辑事由类别。"""
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="仅管理员可操作")

    rc = await db.get(ReasonCategory, rc_id)
    if not rc:
        raise HTTPException(status_code=404, detail="事由类别不存在")

    if data.name is not None:
        dup = await db.scalar(
            select(ReasonCategory).where(ReasonCategory.name == data.name, ReasonCategory.id != rc_id)
        )
        if dup:
            raise HTTPException(status_code=400, detail=f"事由类别「{data.name}」已存在")
        rc.name = data.name
    if data.sort_order is not None:
        rc.sort_order = data.sort_order
    if data.is_active is not None:
        rc.is_active = data.is_active

    await db.commit()
    await db.refresh(rc)
    return rc


@router.delete("/{rc_id}")
async def delete_reason_category(
    rc_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """管理员删除事由类别。"""
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="仅管理员可操作")

    rc = await db.get(ReasonCategory, rc_id)
    if not rc:
        raise HTTPException(status_code=404, detail="事由类别不存在")

    await db.delete(rc)
    await db.commit()
    return {"message": "已删除"}
