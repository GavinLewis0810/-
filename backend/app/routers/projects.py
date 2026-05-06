"""项目管理 + 预算端点。"""
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from decimal import Decimal

from app.database import get_db
from app.models.project import Project
from app.models.reimbursement import Reimbursement, ReimbursementStatus
from app.schemas.project import ProjectCreate, ProjectUpdate, ProjectResponse
from app.dependencies import get_current_user

router = APIRouter()


def _require_admin(current_user: dict):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="仅管理员可执行此操作")


async def _get_project_budget_usage(project_code: str, db: AsyncSession) -> Decimal:
    """计算某项目已使用的预算（已通过 + 待审批）。"""
    used = await db.scalar(
        select(func.coalesce(func.sum(Reimbursement.total_amount), 0)).where(
            Reimbursement.project_code == project_code,
            Reimbursement.status.in_([ReimbursementStatus.SUBMITTED, ReimbursementStatus.APPROVED, ReimbursementStatus.COMPLETED]),
        )
    ) or 0
    return Decimal(str(used))


async def _build_project_response(project: Project, db: AsyncSession) -> ProjectResponse:
    used = await _get_project_budget_usage(project.project_code, db)
    remaining = project.budget - used
    rate = float(used / project.budget * 100) if project.budget > 0 else 0
    return ProjectResponse(
        id=project.id,
        project_code=project.project_code,
        project_name=project.project_name,
        budget=project.budget,
        used_amount=used,
        remaining=remaining,
        usage_rate=round(rate, 1),
        created_at=project.created_at,
    )


@router.get("", response_model=List[ProjectResponse])
async def list_projects(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """获取所有项目（管理员用，员工也能看到列表用于选择）。"""
    result = await db.execute(select(Project).order_by(Project.created_at.desc()))
    projects = result.scalars().all()
    return [await _build_project_response(p, db) for p in projects]


@router.post("", response_model=ProjectResponse)
async def create_project(
    data: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """管理员创建项目。"""
    _require_admin(current_user)

    existing = await db.scalar(select(Project).where(Project.project_code == data.project_code))
    if existing:
        raise HTTPException(status_code=400, detail="项目编号已存在")

    project = Project(
        project_code=data.project_code,
        project_name=data.project_name,
        budget=data.budget,
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return await _build_project_response(project, db)


@router.put("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: int,
    data: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """管理员修改项目（名称或预算）。"""
    _require_admin(current_user)

    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    if data.project_name is not None:
        project.project_name = data.project_name
    if data.budget is not None:
        project.budget = data.budget

    await db.commit()
    await db.refresh(project)
    return await _build_project_response(project, db)


@router.delete("/{project_id}")
async def delete_project(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """管理员删除项目。"""
    _require_admin(current_user)

    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    await db.delete(project)
    await db.commit()
    return {"message": f"项目 {project.project_code} 已删除"}
