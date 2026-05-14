"""Image forensics result model — stores tampering analysis for each uploaded invoice."""

from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from app.database import Base


class ImageForensicsResult(Base):
    __tablename__ = "image_forensics_results"

    id = Column(Integer, primary_key=True, index=True)
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=False, unique=True)

    risk_score = Column(Integer, nullable=False, default=0, comment="综合风险评分 0-100")
    risk_level = Column(String(20), nullable=False, default="unknown", comment="low / medium / high / unknown")

    # Per-detector raw results (JSONB)
    metadata_result = Column(JSONB, nullable=True, comment="EXIF/XMP/PNG元数据分析")
    ela_result = Column(JSONB, nullable=True, comment="Error Level Analysis 结果")
    jpeg_double_compression_result = Column(JSONB, nullable=True, comment="JPEG双重压缩检测")
    noise_consistency_result = Column(JSONB, nullable=True, comment="噪声一致性分析")

    summary = Column(Text, nullable=True, comment="人类可读的检测摘要")
    details = Column(JSONB, nullable=True, comment="详细发现列表")

    created_at = Column(DateTime, default=datetime.now, nullable=False)

    invoice = relationship("Invoice", back_populates="forensics_result")
