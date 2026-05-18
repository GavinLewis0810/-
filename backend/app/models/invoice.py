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
    REVIEWING = "待确认"     # 双引擎提取完成，等待用户确认
    CONFIRMED = "已确认"     # 用户已确认，字段未被修改，自动进入报销池
    PENDING_RECHECK = "待重审"  # 用户修改了字段，管理员需核对原始图像
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

    # ESG 碳足迹追踪
    spend_category = Column(String(50), nullable=True, comment="消费类别(LLM分类)")
    carbon_kg = Column(Numeric(10, 4), nullable=True, comment="碳足迹(kg CO2)")
    green_points = Column(Integer, nullable=True, default=0, comment="绿色积分")

    # Status management
    status = Column(SQLEnum(InvoiceStatus), default=InvoiceStatus.PENDING, nullable=False)

    # 数据防篡改：SHA-256 数字指纹
    invoice_hash = Column(String(64), nullable=True, comment="SHA-256数据完整性校验哈希")

    # 人工标注真值（用于双引擎精度评估）
    ground_truth = Column(JSONB, nullable=True, comment="人工标注字段真值，格式同ParsingDiff字段名")

    # 发票确认流程：字段级状态快照
    field_states = Column(JSONB, nullable=True, comment="字段确认快照 {field: {status,ocr,llm,confidence}}")
    user_corrections = Column(JSONB, nullable=True, comment="用户修正记录 {field: user_entered_value}")

    # 归属人：外键关联到 users 表
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    # 保留旧字段用于数据迁移（迁移后可删除）
    owner = Column(String(100), nullable=True)

    # Metadata
    created_at = Column(DateTime, default=datetime.now, nullable=False)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now, nullable=False)

    # Relationships
    owner_user = relationship("User", back_populates="invoices", foreign_keys=[owner_id])
    ocr_result = relationship("OcrResult", back_populates="invoice", uselist=False, cascade="all, delete-orphan")
    llm_result = relationship("LlmResult", back_populates="invoice", uselist=False, cascade="all, delete-orphan")
    parsing_diffs = relationship("ParsingDiff", back_populates="invoice", cascade="all, delete-orphan")
    forensics_result = relationship("ImageForensicsResult", back_populates="invoice", uselist=False, cascade="all, delete-orphan")
    ai_call_logs = relationship("AICallLog", back_populates="invoice", cascade="all, delete-orphan")

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

    created_at = Column(DateTime, default=datetime.now, nullable=False)

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

    # 🚨 HITL置信度：LLM对各字段的自评置信度 (JSONB格式)
    confidence_scores = Column(JSONB, nullable=True, comment="LLM对各提取字段的自评置信度(0.0-1.0)")

    created_at = Column(DateTime, default=datetime.now, nullable=False)

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
    confidence = Column(Numeric(4, 2), nullable=True, comment="综合融合置信度(0.00-1.00)")
    ocr_confidence = Column(Numeric(4, 2), nullable=True, comment="OCR字段级置信度(0.00-1.00)")
    llm_confidence = Column(Numeric(4, 2), nullable=True, comment="LLM自评置信度(0.00-1.00)")
    resolved = Column(Integer, default=0)  # 0=未解决, 1=已解决

    created_at = Column(DateTime, default=datetime.now, nullable=False)

    invoice = relationship("Invoice", back_populates="parsing_diffs")