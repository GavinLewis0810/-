"""AI call log model — records every OCR/LLM invocation for observability."""

from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base


class AICallLog(Base):
    __tablename__ = "ai_call_logs"

    id = Column(Integer, primary_key=True, index=True)
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=False)
    engine = Column(String(10), nullable=False, comment="ocr or llm")
    status = Column(String(20), nullable=False, comment="success / degraded / error")
    duration_ms = Column(Integer, nullable=False, comment="响应耗时(毫秒)")
    request_id = Column(String(36), nullable=False, comment="UUID v4 请求ID")
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.now, nullable=False)

    invoice = relationship("Invoice", back_populates="ai_call_logs")
