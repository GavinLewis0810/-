"""Invoice processing service."""

import asyncio
import logging
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Optional, Dict, Any, List, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from app.models.invoice import Invoice, OcrResult, LlmResult, ParsingDiff, InvoiceStatus
from app.models.image_forensics import ImageForensicsResult
from app.models.ai_call_log import AICallLog
from app.services.ocr_service import get_ocr_service, get_field_extractor
from app.services.llm_service import get_llm_service
from app.services.image_forensics import get_forensics_service
from app.services.carbon_config import classify_by_keywords, compute_carbon
from app.services.green_config import compute_green_points
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

_ocr_executor = ThreadPoolExecutor(max_workers=settings.ocr_max_workers)
_llm_executor = ThreadPoolExecutor(max_workers=settings.llm_max_workers)
_forensics_executor = ThreadPoolExecutor(max_workers=2)
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

def _run_ocr(file_data: bytes, file_type: str) -> Tuple[str, float, Dict[str, Any], Dict[str, Optional[float]], int, str, Optional[str]]:
    start = time.time()
    error_msg = None
    try:
        ocr_service = get_ocr_service()
        extractor = get_field_extractor()

        if file_type == 'pdf':
            raw_text, confidence, ocr_lines = ocr_service.process_pdf(file_data)
        else:
            raw_text, confidence, ocr_lines = ocr_service.process_image(file_data)

        ocr_fields, ocr_confs = extractor.extract_fields(raw_text, ocr_lines)
        duration_ms = int((time.time() - start) * 1000)
        status = 'degraded' if duration_ms > 5000 else 'success'
        return raw_text, confidence, ocr_fields, ocr_confs, duration_ms, status, None
    except Exception as e:
        duration_ms = int((time.time() - start) * 1000)
        error_msg = str(e)[:500]
        logger.error(f"OCR failed after {duration_ms}ms: {error_msg}")
        return '', 0.0, {}, {}, duration_ms, 'error', error_msg

def _run_llm_vision(file_data: bytes, file_type: str) -> Tuple[Dict[str, Any], int, str, Optional[str]]:
    start = time.time()
    error_msg = None
    try:
        llm_service = get_llm_service()

        if not llm_service.is_available or not llm_service.supports_vision():
            duration_ms = int((time.time() - start) * 1000)
            return {}, duration_ms, 'success', None

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
                    duration_ms = int((time.time() - start) * 1000)
                    return {}, duration_ms, 'error', 'PDF conversion produced no images'
            except Exception as e:
                logger.error(f"PDF to image conversion failed: {e}")
                duration_ms = int((time.time() - start) * 1000)
                return {}, duration_ms, 'error', str(e)[:500]

        result = llm_service.parse_invoice_from_image(file_data, mime_type)
        duration_ms = int((time.time() - start) * 1000)
        status = 'degraded' if duration_ms > 10000 else 'success'
        return result, duration_ms, status, None
    except Exception as e:
        duration_ms = int((time.time() - start) * 1000)
        error_msg = str(e)[:500]
        logger.error(f"LLM vision failed after {duration_ms}ms: {error_msg}")
        return {}, duration_ms, 'error', error_msg

def _run_forensics(file_data: bytes, file_type: str) -> dict:
    start = time.time()
    try:
        service = get_forensics_service()
        result = service.analyze(file_data, file_type)
        duration_ms = int((time.time() - start) * 1000)
        logger.info(f"Image forensics completed: risk_score={result.get('risk_score')}, level={result.get('risk_level')}, {duration_ms}ms")
        return result
    except Exception as e:
        duration_ms = int((time.time() - start) * 1000)
        logger.error(f"Image forensics failed after {duration_ms}ms: {e}")
        return {'risk_score': 0, 'risk_level': 'unknown', 'summary': f'取证分析失败: {e}', 'details': [str(e)]}

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
        await db.execute(delete(ImageForensicsResult).where(ImageForensicsResult.invoice_id == invoice_id))
        await db.execute(delete(AICallLog).where(AICallLog.invoice_id == invoice_id))
        logger.info(f"Cleared existing processing results for invoice {invoice_id}")

        loop = asyncio.get_running_loop()

        ocr_task = loop.run_in_executor(
            _ocr_executor, _run_ocr, invoice.file_data, invoice.file_type
        )
        llm_task = loop.run_in_executor(
            _llm_executor, _run_llm_vision, invoice.file_data, invoice.file_type
        )
        forensics_task = loop.run_in_executor(
            _forensics_executor, _run_forensics, invoice.file_data, invoice.file_type
        )

        logger.info(f"Running OCR, LLM vision and image forensics in parallel for invoice {invoice_id}")
        ocr_result_data, llm_result_data, forensics_data = await asyncio.gather(
            ocr_task, llm_task, forensics_task
        )

        raw_text, confidence, ocr_fields, ocr_confs, ocr_duration_ms, ocr_status, ocr_error = ocr_result_data
        llm_fields, llm_duration_ms, llm_status, llm_error = llm_result_data
        has_llm = _has_meaningful_fields(llm_fields)

        # Persist AI call logs for observability
        db.add(AICallLog(
            invoice_id=invoice_id, engine='ocr', status=ocr_status,
            duration_ms=ocr_duration_ms, request_id=str(uuid.uuid4()),
            error_message=ocr_error,
        ))
        db.add(AICallLog(
            invoice_id=invoice_id, engine='llm', status=llm_status,
            duration_ms=llm_duration_ms, request_id=str(uuid.uuid4()),
            error_message=llm_error,
        ))

        logger.info(f"OCR completed: {len(ocr_fields)} fields extracted ({ocr_duration_ms}ms, {ocr_status})")
        logger.info(f"LLM vision completed: {len(llm_fields)} fields extracted ({llm_duration_ms}ms, {llm_status})")

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
                items=llm_fields.get('items', []), # 核心桥接点：将明细存入
                confidence_scores=llm_fields.get('confidence_scores'),  # HITL置信度
            )
            db.add(llm_result)
        else:
            logger.info(f"LLM vision not available - invoice {invoice_id} using OCR-only flow")

        # 比对头信息
        llm_confidence = llm_fields.get('confidence_scores') if has_llm else None
        final_fields, diffs = _compare_and_resolve(ocr_fields, llm_fields, has_llm, llm_confidence, ocr_confs)

        _reset_extracted_fields(invoice)

        for diff in diffs:
            parsing_diff = ParsingDiff(
                invoice_id=invoice_id,
                field_name=diff['field_name'],
                ocr_value=diff['ocr_value'],
                llm_value=diff['llm_value'],
                final_value=diff['final_value'],
                source=diff['source'],
                confidence=diff.get('confidence'),      # 综合融合置信度
                ocr_confidence=diff.get('ocr_confidence'),  # OCR字段级
                llm_confidence=diff.get('llm_confidence'),  # LLM自评
                resolved=0 if diff['needs_review'] else 1,
            )
            db.add(parsing_diff)

        # 更新发票抬头基础字段
        _update_invoice_from_fields(invoice, final_fields)

        # 🚨 终极偏心：完全信任大模型提取的商品明细，直接挂载给 invoice 主表
        if has_llm and 'items' in llm_fields:
            invoice.items = llm_fields.get('items', [])

        # 🌿 ESG 碳足迹：LLM 分类 + 关键词兜底
        llm_category = llm_fields.get('spend_category') if has_llm else None
        category = llm_category if llm_category and llm_category != '其他' else classify_by_keywords(
            seller_name=invoice.seller_name or '',
            item_name=(invoice.items[0].get('item_name', '') if invoice.items else '')
        )
        invoice.spend_category = category
        invoice.carbon_kg = compute_carbon(category, float(invoice.total_with_tax or 0))
        invoice.green_points, _ = compute_green_points(category, invoice.items)
        logger.info(f"Carbon: category={category}, carbon_kg={invoice.carbon_kg}, green_points={invoice.green_points}")

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

        # 🔍 图像取证结果持久化
        if forensics_data and forensics_data.get('risk_score') is not None:
            fr = ImageForensicsResult(
                invoice_id=invoice_id,
                risk_score=forensics_data.get('risk_score', 0),
                risk_level=forensics_data.get('risk_level', 'unknown'),
                metadata_result=forensics_data.get('metadata_result'),
                ela_result=forensics_data.get('ela_result'),
                jpeg_double_compression_result=forensics_data.get('jpeg_double_compression_result'),
                noise_consistency_result=forensics_data.get('noise_consistency_result'),
                summary=forensics_data.get('summary', ''),
                details=forensics_data.get('details', []),
            )
            db.add(fr)
            logger.info("Image forensics saved: score=%d level=%s", fr.risk_score, fr.risk_level)

        # 🚨 无论机器觉得多完美，一律强制设为"待确认"，交由员工在前端确认！
        invoice.status = InvoiceStatus.REVIEWING

        await db.commit()
        logger.info(f"Invoice {invoice_id} processed successfully (needs_review={needs_review})")
        return True

    except Exception as e:
        logger.error(f"Failed to process invoice {invoice_id}: {e}")
        await db.rollback()
        return False

def _fuse_confidence(
    ocr_conf: Optional[float],   # OCR字段级置信度 (0-100, 来自PaddleOCR)
    llm_conf: Optional[float],   # LLM自评置信度 (0.0-1.0, 来自Qwen)
    ocr_value: Optional[str],
    llm_value: Optional[str],
    field_name: str,
) -> Optional[float]:
    """双引擎置信度融合：取较低者(min) + 冲突惩罚.

    Args:
        ocr_conf: OCR字段置信度 (0-100), None表示OCR未提取到
        llm_conf: LLM自评置信度 (0.0-1.0), None表示LLM未给出
        ocr_value: OCR提取的字段值
        llm_value: LLM提取的字段值
        field_name: 字段名

    Returns:
        综合置信度 (0.0-1.0), None表示无法评估
    """
    parts = []

    # OCR置信度归一化到 0-1
    if ocr_conf is not None:
        parts.append(min(ocr_conf / 100.0, 1.0))

    # LLM置信度（已是 0-1），先做基础校准
    if llm_conf is not None:
        calibrated = llm_conf
        # 校准1: LLM未提取到值但自评高 → 降权
        if llm_value is None and calibrated > 0.5:
            calibrated = 0.30
        # 校准2: LLM有值但OCR无 → 无法交叉验证，上限0.75
        elif llm_value and not ocr_value and calibrated > 0.75:
            calibrated = 0.75
        parts.append(calibrated)

    if not parts:
        return None

    # 核心策略：取较低者（最保守估计）
    composite = min(parts)

    # 冲突惩罚：双方都有值但不一致 → 至少有一方是错的
    if ocr_value and llm_value and ocr_value != llm_value:
        composite = max(composite - 0.15, 0.10)

    return round(composite, 2)


def _compare_and_resolve(
    ocr_fields: Dict[str, Any],
    llm_fields: Dict[str, Any],
    has_llm: bool,
    llm_confidence: Optional[Dict[str, Any]] = None,
    ocr_confs: Optional[Dict[str, Optional[float]]] = None,
) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    """双引擎比对 + 置信度融合决策.

    新规则（删除硬编码偏心策略）：
    - 综合置信度 ≥ 0.80 + 一致 → 自动采纳
    - 综合置信度 ≥ 0.80 + 仅一方有值 → 采纳（已过门槛）
    - 综合置信度 < 0.80 → 无论一致与否，标记人工审核
    - 双方都有但冲突 → 标记人工审核
    """
    final_fields = {}
    diffs = []

    for field_name in COMPARABLE_FIELDS:
        ocr_value = _normalize_value(ocr_fields.get(field_name))
        llm_value = _normalize_value(llm_fields.get(field_name)) if has_llm else None

        # 提取双引擎置信度
        ocr_field_conf = None
        if ocr_confs and isinstance(ocr_confs, dict):
            raw = ocr_confs.get(field_name)
            if raw is not None and isinstance(raw, (int, float)):
                ocr_field_conf = float(raw)

        llm_field_conf = None
        if llm_confidence and isinstance(llm_confidence, dict):
            raw = llm_confidence.get(field_name)
            if raw is not None and isinstance(raw, (int, float)):
                llm_field_conf = float(raw)

        # 融合为综合置信度
        composite_conf = _fuse_confidence(
            ocr_field_conf, llm_field_conf,
            ocr_value, llm_value, field_name
        )

        # 自动决策
        if not has_llm:
            final_value = ocr_value
            source = 'ocr'
            needs_review = False
        elif _values_are_equal(field_name, ocr_value, llm_value):
            final_value = ocr_value or llm_value
            source = 'matched'
            # 即使一致，高置信度自动过，低置信度人工审
            needs_review = composite_conf is not None and composite_conf < 0.80
        elif ocr_value and llm_value:
            # 双方都有但不同 → 一律人工审核
            final_value = None
            source = 'conflict'
            needs_review = True
        elif llm_value and not ocr_value:
            # 仅LLM有值 → 置信度门槛决定
            final_value = llm_value
            source = 'llm'
            needs_review = composite_conf is not None and composite_conf < 0.80
        else:
            # 仅OCR有值 → 置信度门槛决定
            final_value = ocr_value
            source = 'ocr'
            needs_review = composite_conf is not None and composite_conf < 0.80

        final_fields[field_name] = final_value

        if has_llm and (ocr_value or llm_value):
            diffs.append({
                'field_name': field_name,
                'ocr_value': ocr_value,
                'llm_value': llm_value,
                'final_value': final_value,
                'source': source,
                'needs_review': needs_review,
                'confidence': composite_conf,
                'ocr_confidence': round(ocr_field_conf / 100.0, 2) if ocr_field_conf is not None else None,
                'llm_confidence': llm_field_conf,
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