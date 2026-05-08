"""事前申请单模型。"""
from datetime import datetime
from decimal import Decimal
from enum import Enum
from sqlalchemy import Column, Integer, String, DateTime, Numeric, Text, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import relationship
from app.database import Base


class ApplicationStatus(str, Enum):
    DRAFT = "草稿"
    SUBMITTED = "待审批"
    APPROVED = "已通过"
    REJECTED = "已驳回"


class Application(Base):
    __tablename__ = "applications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    project_code = Column(String(100), nullable=True, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    estimated_amount = Column(Numeric(12, 2), default=0)
    status = Column(SQLEnum(ApplicationStatus), default=ApplicationStatus.SUBMITTED, nullable=False)
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    reject_reason = Column(Text, nullable=True)
    reason_category_id = Column(Integer, ForeignKey("reason_categories.id"), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    user = relationship("User", foreign_keys=[user_id])
    approver = relationship("User", foreign_keys=[approved_by])
    reason_category = relationship("ReasonCategory")
