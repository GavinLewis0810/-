"""消息通知模型。"""
from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Boolean, Text, ForeignKey
from app.database import Base


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=True)
    is_read = Column(Boolean, default=False, nullable=False)
    entity_type = Column(String(50), nullable=True)  # 'reimbursement'
    entity_id = Column(Integer, nullable=True)       # reimbursement.id

    created_at = Column(DateTime, default=datetime.now, nullable=False)
