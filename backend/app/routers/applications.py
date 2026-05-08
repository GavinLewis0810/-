"""事前申请单管理端点。"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from pydantic import BaseModel

from app.database import get_db
from app.models.application import Application, ApplicationStatus
from app.models.reimbursement import Reimbursement, ReimbursementStatus
from app.models.borrowing import Borrowing
from app.models.project import Project
from app.models.notification import Notification
from app.models.user import User
from app.dependencies import get_current_user

router = APIRouter()


class AppCreate(BaseModel):
    title: str
    description: str = ""
    estimated_amount: float = 0
    project_code: Optional[str] = None
    reason_category_id: Optional[int] = None


class AppResponse(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    estimated_amount: float
    used_amount: float = 0
    project_code: Optional[str] = None
    project_name: Optional[str] = None
    status: ApplicationStatus
    reject_reason: Optional[str] = None
    user_name: Optional[str] = None
    created_at: str

    class Config:
        from_attributes = True


@router.get("", response_model=List[AppResponse])
async def list_applications(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """员工看自己的申请单，管理员看全部。"""
    query = select(Application).options(selectinload(Application.user))
    if current_user["role"] != "admin":
        query = query.where(Application.user_id == current_user["id"])
    query = query.order_by(Application.created_at.desc())
    result = await db.execute(query)
    apps = result.scalars().all()

    # 批量查询每个申请单的已使用额度
    app_ids = [a.id for a in apps]
    used_map: dict[int, float] = {}
    if app_ids:
        used_rows = await db.execute(
            select(Reimbursement.application_id, func.coalesce(func.sum(Reimbursement.total_amount), 0))
            .where(
                Reimbursement.application_id.in_(app_ids),
                Reimbursement.status.in_([ReimbursementStatus.APPROVED, ReimbursementStatus.COMPLETED]),
            )
            .group_by(Reimbursement.application_id)
        )
        for row in used_rows:
            used_map[row[0]] = float(row[1])

    # 批量查询项目名称
    project_codes = list({a.project_code for a in apps if a.project_code})
    project_name_map: dict[str, str] = {}
    if project_codes:
        projects = (await db.execute(
            select(Project).where(Project.project_code.in_(project_codes))
        )).scalars().all()
        for p in projects:
            project_name_map[p.project_code] = p.project_name

    return [AppResponse(
        id=a.id, title=a.title, description=a.description,
        estimated_amount=float(a.estimated_amount),
        used_amount=used_map.get(a.id, 0),
        project_code=a.project_code,
        project_name=project_name_map.get(a.project_code) if a.project_code else None,
        status=a.status,
        reject_reason=a.reject_reason,
        user_name=a.user.full_name if a.user else None,
        created_at=a.created_at.isoformat() if a.created_at else "",
    ) for a in apps]


@router.post("", response_model=AppResponse)
async def create_application(
    data: AppCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """员工提交事前申请单。"""
    project_name = None
    if data.project_code:
        project = await db.scalar(select(Project).where(Project.project_code == data.project_code))
        if not project:
            raise HTTPException(status_code=400, detail=f"项目 {data.project_code} 不存在")
        project_name = project.project_name

    app = Application(
        user_id=current_user["id"],
        project_code=data.project_code,
        title=data.title,
        description=data.description,
        estimated_amount=data.estimated_amount,
        reason_category_id=data.reason_category_id,
        status=ApplicationStatus.SUBMITTED,
    )
    db.add(app)
    await db.flush()

    # 通知管理员
    admins = (await db.execute(select(User).where(User.role == "admin"))).scalars().all()
    for admin in admins:
        db.add(Notification(
            user_id=admin.id,
            title="新的事前申请单待审批",
            message=f"员工 {current_user.get('full_name')} 提交了申请「{data.title}」，预估金额 ¥{data.estimated_amount:.2f}" + (
                f"（项目：{project_name}）" if project_name else ""),
            entity_type="application",
            entity_id=app.id,
        ))

    await db.commit()
    await db.refresh(app)
    return AppResponse(
        id=app.id, title=app.title, description=app.description,
        estimated_amount=float(app.estimated_amount), used_amount=0,
        project_code=app.project_code, project_name=project_name,
        status=app.status,
        reject_reason=None,
        user_name=current_user.get("full_name"),
        created_at=app.created_at.isoformat() if app.created_at else "",
    )


@router.put("/{app_id}/approve")
async def approve_application(
    app_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """管理员审批通过申请单。"""
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="仅管理员可操作")
    app = await db.get(Application, app_id)
    if not app: raise HTTPException(status_code=404, detail="申请单不存在")
    app.status = ApplicationStatus.APPROVED
    app.approved_by = current_user["id"]

    db.add(Notification(
        user_id=app.user_id, title="事前申请已通过",
        message=f"您的申请「{app.title}」已通过，预估金额 ¥{float(app.estimated_amount):.2f}，可以提交报销了。",
        entity_type="application", entity_id=app.id,
    ))
    await db.commit()
    return {"message": "已通过"}


@router.put("/{app_id}/reject")
async def reject_application(
    app_id: int,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """管理员驳回申请单。"""
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="仅管理员可操作")
    app = await db.get(Application, app_id)
    if not app: raise HTTPException(status_code=404, detail="申请单不存在")
    app.status = ApplicationStatus.REJECTED
    app.reject_reason = body.get("reason", "")

    db.add(Notification(
        user_id=app.user_id, title="事前申请已驳回",
        message=f"您的申请「{app.title}」已被驳回。原因：{app.reject_reason or '无'}",
        entity_type="application", entity_id=app.id,
    ))
    await db.commit()
    return {"message": "已驳回"}


@router.delete("/{app_id}")
async def delete_application(
    app_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """删除事前申请单。已通过的申请若有关联借款/报销则不可删。"""
    app = await db.get(Application, app_id)
    if not app: raise HTTPException(status_code=404, detail="不存在")
    if app.user_id != current_user["id"] and current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="无权操作")

    # 检查关联的借款
    linked_borrowings = (await db.execute(
        select(func.count(Borrowing.id)).where(Borrowing.application_id == app_id)
    )).scalar() or 0

    # 检查关联的报销单
    linked_reimbs = (await db.execute(
        select(func.count(Reimbursement.id)).where(Reimbursement.application_id == app_id)
    )).scalar() or 0

    if linked_borrowings > 0 or linked_reimbs > 0:
        parts = []
        if linked_borrowings > 0:
            parts.append(f"{linked_borrowings} 条借款申请")
        if linked_reimbs > 0:
            parts.append(f"{linked_reimbs} 条报销单")
        raise HTTPException(
            status_code=400,
            detail=f"无法删除：该事前申请单下已有 {'、'.join(parts)}，请先处理关联数据后再删除",
        )

    await db.delete(app)
    await db.commit()
    return {"message": "已删除"}
