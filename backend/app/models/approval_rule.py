"""动态审批规则模型。"""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text
from sqlalchemy.dialects.postgresql import JSONB
from app.database import Base


class ApprovalRule(Base):
    __tablename__ = "approval_rules"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    entity_type = Column(String(50), nullable=False, default="reimbursement")
    priority = Column(Integer, nullable=False, default=100)
    conditions = Column(JSONB, nullable=False, default={})
    action = Column(String(50), nullable=False, default="NONE")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
