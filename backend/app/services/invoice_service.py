"""Invoice processing service."""

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Optional, Dict, Any, List, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from app.models.invoice import Invoice, OcrResult, LlmResult, ParsingDiff, InvoiceStatus
from app.services.ocr_service import get_ocr_service, get_field_extractor
from app.services.llm_service import get_llm_service
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

_ocr_executor = ThreadPoolExecutor(max_workers=settings.ocr_max_workers)
_llm_executor = ThreadPoolExecutor(max_workers=settings.llm_max_workers)
logger.info(f"Initialized thread pools: OCR={settings.ocr_max_workers}, LLM={settings.llm_max_workers}")

# 🚨 瘦身后的比对列表：彻底移除商品明细字段，只保留全票头主干信息
COMPARABLE_FIELDS = [
    'invoice_number',
    'invoice_code',
    'issue_date',
    'buyer_name',
    'buyer_tax_id',
    'seller_name',
    'seller_tax_id',
    'total_with_tax',
    'amount',
    'tax_amount'
]

def _reset_extracted_fields(invoice: Invoice) -> None:
    """Reset extracted fields to avoid stale values on reprocess."""
    for field_name in COMPARABLE_FIELDS:
        setattr(invoice, field_name, None)
    # 重新解析时，也清空旧的 items 数组
    invoice.items = None

def _run_ocr(file_data: bytes, file_type: str) -> Tuple[str, float, Dict[str, Any]]:
    ocr_service = get_ocr_service()
    extractor = get_field_extractor()

    if file_type == 'pdf':
        raw_text, confidence, ocr_lines = ocr_service.process_pdf(file_data)
    else:
        raw_text, confidence, ocr_lines = ocr_service.process_image(file_data)

    ocr_fields = extractor.extract_fields(raw_text, ocr_lines)
    return raw_text, confidence, ocr_fields

def _run_llm_vision(file_data: bytes, file_type: str) -> Dict[str, Any]:
    llm_service = get_llm_service()

    if not llm_service.is_available or not llm_service.supports_vision():
        return {}

    mime_map = {
        'pdf': 'application/pdf',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
    }
    mime_type = mime_map.get(file_type, 'image/png')

    if file_type == 'pdf':
        try:
            from pdf2image import convert_from_bytes
            from io import BytesIO

            images = convert_from_bytes(file_data, dpi=300, first_page=1, last_page=1)
            if images:
                buffer = BytesIO()
                images[0].save(buffer, format='PNG', optimize=False)
                file_data = buffer.getvalue()
                mime_type = 'image/png'
                logger.info(f"PDF converted to image: {images[0].size[0]}x{images[0].size[1]} pixels, {len(file_data)} bytes")
            else:
                logger.warning("Failed to convert PDF to image for LLM vision")
                return {}
        except Exception as e:
            logger.error(f"PDF to image conversion failed: {e}")
            return {}

    return llm_service.parse_invoice_from_image(file_data, mime_type)

def _has_meaningful_fields(fields: Dict[str, Any]) -> bool:
    if not fields:
        return False
    for key, value in fields.items():
        if value is None:
            continue
        # 只要存在非空的 items 数组，或者非空的字符串，就认为是有意义的结果
        if key == 'items' and isinstance(value, list) and len(value) > 0:
            return True
        if isinstance(value, str) and value.strip():
            return True
    return False

async def process_invoice(invoice_id: int, db: AsyncSession) -> bool:
    try:
        query = select(Invoice).where(Invoice.id == invoice_id)
        result = await db.execute(query)
        invoice = result.scalar_one_or_none()

        if not invoice:
            logger.error(f"Invoice {invoice_id} not found")
            return False

        await db.execute(delete(ParsingDiff).where(ParsingDiff.invoice_id == invoice_id))
        await db.execute(delete(LlmResult).where(LlmResult.invoice_id == invoice_id))
        await db.execute(delete(OcrResult).where(OcrResult.invoice_id == invoice_id))
        logger.info(f"Cleared existing processing results for invoice {invoice_id}")

        loop = asyncio.get_running_loop()

        ocr_task = loop.run_in_executor(
            _ocr_executor, _run_ocr, invoice.file_data, invoice.file_type
        )
        llm_task = loop.run_in_executor(
            _llm_executor, _run_llm_vision, invoice.file_data, invoice.file_type
        )

        logger.info(f"Running OCR and LLM vision in parallel for invoice {invoice_id}")
        ocr_result_data, llm_fields = await asyncio.gather(ocr_task, llm_task)

        raw_text, confidence, ocr_fields = ocr_result_data
        has_llm = _has_meaningful_fields(llm_fields)

        logger.info(f"OCR completed: {len(ocr_fields)} fields extracted")
        logger.info(f"LLM vision completed: {len(llm_fields)} fields extracted (has_llm={has_llm})")

        # 🚨 OCR 不提取商品明细，所以全部剔除 item_name 等字段
        ocr_result = OcrResult(
            invoice_id=invoice_id,
            raw_text=raw_text,
            invoice_number=ocr_fields.get('invoice_number'),
            issue_date=ocr_fields.get('issue_date'),
            buyer_name=ocr_fields.get('buyer_name'),
            buyer_tax_id=ocr_fields.get('buyer_tax_id'),
            seller_name=ocr_fields.get('seller_name'),
            seller_tax_id=ocr_fields.get('seller_tax_id'),
            total_with_tax=ocr_fields.get('total_with_tax'),
            amount=ocr_fields.get('amount'),
            tax_amount=ocr_fields.get('tax_amount'),
            tax_rate=ocr_fields.get('tax_rate'),
        )
        db.add(ocr_result)

        # 🚨 在保存 LLM 结果时，将提取到的 items 数组直接无脑存入 JSONB
        if has_llm:
            llm_result = LlmResult(
                invoice_id=invoice_id,
                invoice_number=llm_fields.get('invoice_number'),
                issue_date=llm_fields.get('issue_date'),
                buyer_name=llm_fields.get('buyer_name'),
                buyer_tax_id=llm_fields.get('buyer_tax_id'),
                seller_name=llm_fields.get('seller_name'),
                seller_tax_id=llm_fields.get('seller_tax_id'),
                total_with_tax=llm_fields.get('total_with_tax'),
                amount=llm_fields.get('amount'),
                tax_amount=llm_fields.get('tax_amount'),
                tax_rate=llm_fields.get('tax_rate'),
                items=llm_fields.get('items', []) # 核心桥接点：将明细存入
            )
            db.add(llm_result)
        else:
            logger.info(f"LLM vision not available - invoice {invoice_id} using OCR-only flow")

        # 比对头信息
        final_fields, diffs = _compare_and_resolve(ocr_fields, llm_fields, has_llm)

        _reset_extracted_fields(invoice)

        for diff in diffs:
            parsing_diff = ParsingDiff(
                invoice_id=invoice_id,
                field_name=diff['field_name'],
                ocr_value=diff['ocr_value'],
                llm_value=diff['llm_value'],
                final_value=diff['final_value'],
                source=diff['source'],
                resolved=0 if diff['needs_review'] else 1,
            )
            db.add(parsing_diff)

        # 更新发票抬头基础字段
        _update_invoice_from_fields(invoice, final_fields)

        # 🚨 终极偏心：完全信任大模型提取的商品明细，直接挂载给 invoice 主表
        if has_llm and 'items' in llm_fields:
            invoice.items = llm_fields.get('items', [])

        has_conflicts = any(d['needs_review'] for d in diffs)

        # 判断必填项（去掉了 item_name）
        critical_fields = [
            'invoice_number',
            'issue_date',
            'total_with_tax',
            'buyer_name',
            'buyer_tax_id',
            'seller_name',
            'seller_tax_id'
        ]
        missing_fields = [f for f in critical_fields if not final_fields.get(f)]
        missing_critical = bool(missing_fields)
        if missing_critical:
            logger.warning(f"Invoice {invoice_id} missing critical fields: {missing_fields}")

        needs_review = has_conflicts or missing_critical

        # 🚨 无论机器觉得多完美，一律强制设为”待确认”，交由员工在前端确认！
        invoice.status = InvoiceStatus.REVIEWING

        await db.commit()
        logger.info(f"Invoice {invoice_id} processed successfully (needs_review={needs_review})")
        return True

    except Exception as e:
        logger.error(f"Failed to process invoice {invoice_id}: {e}")
        await db.rollback()
        return False

def _compare_and_resolve(
    ocr_fields: Dict[str, Any],
    llm_fields: Dict[str, Any],
    has_llm: bool
) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    final_fields = {}
    diffs = []

    for field_name in COMPARABLE_FIELDS:
        ocr_value = _normalize_value(ocr_fields.get(field_name))
        llm_value = _normalize_value(llm_fields.get(field_name)) if has_llm else None

        if not has_llm:
            final_value = ocr_value
            source = 'ocr'
            needs_review = False
        elif _values_are_equal(field_name, ocr_value, llm_value):
            final_value = ocr_value or llm_value
            source = 'matched'
            needs_review = False
        elif ocr_value and llm_value:
            # 🚨 终极偏心策略：只针对发票号码无脑信任 OCR
            if field_name == 'invoice_number':
                final_value = ocr_value
                source = 'ocr'
                needs_review = False
            else:
                final_value = None
                source = 'conflict'
                needs_review = True
        elif llm_value and not ocr_value:
            final_value = llm_value
            source = 'llm'
            needs_review = False
        else:
            final_value = ocr_value
            source = 'ocr'
            needs_review = False

        final_fields[field_name] = final_value

        if has_llm and (ocr_value or llm_value):
            diffs.append({
                'field_name': field_name,
                'ocr_value': ocr_value,
                'llm_value': llm_value,
                'final_value': final_value,
                'source': source,
                'needs_review': needs_review,
            })

    return final_fields, diffs

def _normalize_value(value: Any) -> Optional[str]:
    if value is None:
        return None
    value_str = str(value).strip()
    if not value_str:
        return None
    return value_str

# 剔除了 quantity 和 unit_price
NUMERIC_FIELDS = ['total_with_tax', 'amount', 'tax_amount']

def _values_are_equal(field_name: str, value1: Optional[str], value2: Optional[str]) -> bool:
    if not value1 and not value2:
        return True
    if not value1 or not value2:
        return False

    if field_name in NUMERIC_FIELDS:
        try:
            from decimal import Decimal, InvalidOperation
            clean1 = value1.replace('¥', '').replace('￥', '').replace(',', '').strip()
            clean2 = value2.replace('¥', '').replace('￥', '').replace(',', '').strip()
            num1 = Decimal(clean1)
            num2 = Decimal(clean2)
            return num1 == num2
        except (InvalidOperation, ValueError):
            pass

    return value1 == value2

def _update_invoice_from_fields(invoice: Invoice, fields: dict) -> None:
    from datetime import datetime
    from decimal import Decimal

    if fields.get('invoice_number'):
        invoice.invoice_number = fields['invoice_number']
    if fields.get('issue_date'):
        try:
            invoice.issue_date = datetime.strptime(fields['issue_date'], '%Y-%m-%d').date()
        except ValueError:
            pass
    if fields.get('buyer_name'):
        invoice.buyer_name = fields['buyer_name']
    if fields.get('buyer_tax_id'):
        invoice.buyer_tax_id = fields['buyer_tax_id']
    if fields.get('seller_name'):
        invoice.seller_name = fields['seller_name']
    if fields.get('seller_tax_id'):
        invoice.seller_tax_id = fields['seller_tax_id']

    if fields.get('total_with_tax'):
        try:
            invoice.total_with_tax = Decimal(fields['total_with_tax'])
        except (ValueError, TypeError):
            pass
    if fields.get('amount'):
        try:
            invoice.amount = Decimal(fields['amount'])
        except (ValueError, TypeError):
            pass
    if fields.get('tax_amount'):
        try:
            invoice.tax_amount = Decimal(fields['tax_amount'])
        except (ValueError, TypeError):
            pass
    if fields.get('tax_rate'):
        invoice.tax_rate = fields['tax_rate']

def check_llm_available() -> bool:
    return get_llm_service().is_available