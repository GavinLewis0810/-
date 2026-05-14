"""项目/预算管理模型。"""
from datetime import datetime
from decimal import Decimal
from sqlalchemy import Column, Integer, String, DateTime, Numeric
from app.database import Base


class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    project_code = Column(String(100), unique=True, nullable=False, index=True)
    project_name = Column(String(255), nullable=False)
    budget = Column(Numeric(12, 2), nullable=False, default=0)

    created_at = Column(DateTime, default=datetime.now, nullable=False)
