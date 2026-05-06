"""项目/预算 Pydantic 模型。"""
from typing import Optional
from decimal import Decimal
from datetime import datetime
from pydantic import BaseModel, Field


class ProjectCreate(BaseModel):
    project_code: str = Field(..., description="项目编号")
    project_name: str = Field(..., description="项目名称")
    budget: Decimal = Field(..., description="预算金额")


class ProjectUpdate(BaseModel):
    project_name: Optional[str] = None
    budget: Optional[Decimal] = None


class ProjectResponse(BaseModel):
    id: int
    project_code: str
    project_name: str
    budget: Decimal
    used_amount: Decimal = Decimal(0)
    remaining: Decimal = Decimal(0)
    usage_rate: float = 0.0
    created_at: datetime

    class Config:
        from_attributes = True
