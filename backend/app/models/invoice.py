from datetime import datetime, date
from decimal import Decimal
from enum import Enum
from sqlalchemy import (
    Column, Integer, String, DateTime, Date, Numeric,
    Text, LargeBinary, ForeignKey, Enum as SQLEnum
)
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import JSONB  # 🚨 引入 PostgreSQL 专属的 JSONB 神器

from app.database import Base

# Import AuditLog to ensure it's registered with Base.metadata
from app.models.audit_log import AuditLog  # noqa: F401


class InvoiceStatus(str, Enum):
    UPLOADED = "已上传"
    PROCESSING = "解析中"
    PENDING = "待处理"       # legacy
    REVIEWING = "待确认"     # 需要人工比对 OCR/LLM 差异后确认
    CONFIRMED = "已确认"     # 员工已确认/已提交报销待审批
    REIMBURSED = "已报销"    # 报销单审批通过
    NOT_REIMBURSED = "未报销"


class Invoice(Base):
    __tablename__ = "invoices"

    id = Column(Integer, primary_key=True, index=True)

    # File storage
    file_name = Column(String(255), nullable=False)
    file_type = Column(String(20), nullable=False)  # pdf, jpg, png
    file_data = Column(LargeBinary, nullable=False)

    # Required fields (NOT NULL)
    invoice_number = Column(String(50), nullable=True)  # 发票号码
    issue_date = Column(Date, nullable=True)  # 开票日期
    buyer_name = Column(String(255), nullable=True)  # 购买方名称
    buyer_tax_id = Column(String(50), nullable=True)  # 购买方纳税人识别号
    seller_name = Column(String(255), nullable=True)  # 销售方名称
    seller_tax_id = Column(String(50), nullable=True)  # 销售方纳税人识别号
    total_with_tax = Column(Numeric(12, 2), nullable=True)  # 价税合计金额(全局)

    # Optional fields (can be NULL)
    amount = Column(Numeric(12, 2), nullable=True)  # 总金额(不含税, 全局)
    tax_rate = Column(String(20), nullable=True)  # 全局税率(如果整单单一税率)
    tax_amount = Column(Numeric(12, 2), nullable=True)  # 总税额(全局)

    # 🚨 新增：发票明细列表 (使用 PostgreSQL 专属的高性能 JSONB)
    items = Column(JSONB, nullable=True, comment="发票商品明细(JSONB数组)")

    # Status management
    status = Column(SQLEnum(InvoiceStatus), default=InvoiceStatus.PENDING, nullable=False)

    # 归属人：外键关联到 users 表
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    # 保留旧字段用于数据迁移（迁移后可删除）
    owner = Column(String(100), nullable=True)

    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    owner_user = relationship("User", back_populates="invoices", foreign_keys=[owner_id])
    ocr_result = relationship("OcrResult", back_populates="invoice", uselist=False, cascade="all, delete-orphan")
    llm_result = relationship("LlmResult", back_populates="invoice", uselist=False, cascade="all, delete-orphan")
    parsing_diffs = relationship("ParsingDiff", back_populates="invoice", cascade="all, delete-orphan")

    # 报销单外键和反向关联
    reimbursement_id = Column(Integer, ForeignKey("reimbursements.id"), nullable=True)
    reimbursement = relationship("Reimbursement", back_populates="invoices")

    @property
    def owner_name(self):
        """从外键关系获取归属人用户名。"""
        return self.owner_user.username if self.owner_user else self.owner


class OcrResult(Base):
    __tablename__ = "ocr_results"

    id = Column(Integer, primary_key=True, index=True)
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=False, unique=True)

    # Parsed fields from OCR (只保留发票主干抬头信息)
    raw_text = Column(Text, nullable=True)  # 原始OCR文本
    invoice_number = Column(String(50), nullable=True)
    issue_date = Column(String(50), nullable=True)
    buyer_name = Column(String(255), nullable=True)
    buyer_tax_id = Column(String(50), nullable=True)
    seller_name = Column(String(255), nullable=True)
    seller_tax_id = Column(String(50), nullable=True)
    total_with_tax = Column(String(50), nullable=True)
    amount = Column(String(50), nullable=True)
    tax_rate = Column(String(20), nullable=True)
    tax_amount = Column(String(50), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    invoice = relationship("Invoice", back_populates="ocr_result")


class LlmResult(Base):
    __tablename__ = "llm_results"

    id = Column(Integer, primary_key=True, index=True)
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=False, unique=True)

    # Parsed fields from LLM (发票主干抬头信息)
    invoice_number = Column(String(50), nullable=True)
    issue_date = Column(String(50), nullable=True)
    buyer_name = Column(String(255), nullable=True)
    buyer_tax_id = Column(String(50), nullable=True)
    seller_name = Column(String(255), nullable=True)
    seller_tax_id = Column(String(50), nullable=True)
    total_with_tax = Column(String(50), nullable=True)
    amount = Column(String(50), nullable=True)
    tax_rate = Column(String(20), nullable=True)
    tax_amount = Column(String(50), nullable=True)

    # 🚨 新增：大模型解析的商品明细 (JSONB格式)
    items = Column(JSONB, nullable=True, comment="大模型解析的商品明细")

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    invoice = relationship("Invoice", back_populates="llm_result")


class ParsingDiff(Base):
    __tablename__ = "parsing_diffs"

    id = Column(Integer, primary_key=True, index=True)
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=False)

    field_name = Column(String(100), nullable=False)  # 字段名
    ocr_value = Column(Text, nullable=True)  # OCR解析值
    llm_value = Column(Text, nullable=True)  # LLM解析值
    final_value = Column(Text, nullable=True)  # 最终确认值
    source = Column(String(20), nullable=True)  # ocr/llm/manual
    resolved = Column(Integer, default=0)  # 0=未解决, 1=已解决

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    invoice = relationship("Invoice", back_populates="parsing_diffs")