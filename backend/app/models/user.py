from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(20), default="employee", nullable=False)
    full_name = Column(String(50), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    department = Column(String(100), nullable=True, default=None)
    signature = Column(Text, nullable=True, default=None)  # base64 PNG

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # 反向关系
    invoices = relationship("Invoice", back_populates="owner_user", foreign_keys="Invoice.owner_id")
    reimbursements = relationship("Reimbursement", back_populates="submitter_user", foreign_keys="Reimbursement.submitter_id")