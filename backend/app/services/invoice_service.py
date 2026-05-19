"""Invoice processing service."""

import asyncio
import logging
import re
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
    'tax_rate',
    'tax_amount'
]

SUBJECT_FIELDS = [
    'buyer_name',
    'buyer_tax_id',
    'seller_name',
    'seller_tax_id',
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
        final_fields, diffs, decision_trace = _compare_and_resolve(ocr_fields, llm_fields, has_llm, llm_confidence, ocr_confs)

        _reset_extracted_fields(invoice)

        for diff in diffs:
            parsing_diff = ParsingDiff(
                invoice_id=invoice_id,
                field_name=diff['field_name'],
                ocr_value=diff['ocr_value'],
                llm_value=diff['llm_value'],
                machine_value=diff.get('machine_value'),
                machine_source=diff.get('machine_source'),
                machine_confidence=diff.get('machine_confidence'),
                decision_rule_type=diff.get('decision_rule_type'),
                decision_reason=diff.get('decision_reason'),
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
        invoice.decision_trace = decision_trace

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


def _is_company_name(value: Optional[str]) -> bool:
    if not value:
        return False
    return any(token in value for token in ('公司', '有限', '科技', '商贸', '集团', '中心', '大学', '超市', '店', '部'))


def _looks_person_name(value: Optional[str]) -> bool:
    if not value:
        return False
    text = value.strip()
    if _is_company_name(text):
        return False
    if re.fullmatch(r'[\u4e00-\u9fff]{2,4}', text):
        return True
    return False


def _normalize_tax_id(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    cleaned = ''.join(ch for ch in value.strip().upper() if ch.isalnum())
    if not cleaned:
        return None
    return cleaned.replace('O', '0').replace('I', '1')


def _classify_tax_id(value: Optional[str]) -> str:
    candidate = _normalize_tax_id(value)
    if not candidate:
        return 'missing'
    if candidate.isdigit() and len(candidate) == 18:
        return 'person'
    if candidate.isalnum() and len(candidate) == 18 and any(ch.isalpha() for ch in candidate):
        return 'company'
    if candidate.isalnum() and 15 <= len(candidate) <= 20:
        return 'company_like'
    return 'unknown'


def _score_name_tax_pair(name: Optional[str], tax_id: Optional[str]) -> Tuple[float, List[str], List[str]]:
    reasons: List[str] = []
    risks: List[str] = []
    if not name and not tax_id:
        return 0.0, ['pair_missing'], ['主体字段缺失']

    name_kind = 'company' if _is_company_name(name) else 'person' if _looks_person_name(name) else 'generic'
    tax_kind = _classify_tax_id(tax_id)
    reasons.extend([f'name_kind={name_kind}', f'tax_kind={tax_kind}'])

    if not name or not tax_id:
        risks.append('名称或税号缺失')
        return 0.45, reasons + ['pair_incomplete'], risks

    if name_kind == 'company' and tax_kind in ('company', 'company_like'):
        return 1.0, reasons + ['company_pair_match'], risks
    if name_kind == 'person' and tax_kind == 'person':
        return 0.95, reasons + ['person_pair_match'], risks
    if name_kind == 'company' and tax_kind == 'person':
        risks.append('公司名称与个人证件号错配')
        return 0.12, reasons + ['company_name_person_tax_mismatch'], risks
    if name_kind == 'person' and tax_kind in ('company', 'company_like'):
        risks.append('自然人名称与企业税号错配')
        return 0.15, reasons + ['person_name_company_tax_mismatch'], risks
    if name_kind == 'generic' and tax_kind in ('company', 'company_like'):
        return 0.68, reasons + ['generic_name_company_tax'], risks
    if tax_kind == 'unknown':
        risks.append('税号格式不稳定')
        return 0.38, reasons + ['tax_unknown'], risks
    return 0.55, reasons + ['pair_weak_match'], risks


def _score_subject_roles(fields: Dict[str, Optional[str]]) -> Tuple[float, List[str], List[str]]:
    buyer_name = fields.get('buyer_name')
    seller_name = fields.get('seller_name')
    buyer_tax_id = fields.get('buyer_tax_id')
    seller_tax_id = fields.get('seller_tax_id')

    reasons: List[str] = []
    risks: List[str] = []
    score = 0.75

    if buyer_name and seller_name and buyer_name == seller_name:
        score -= 0.45
        risks.append('买卖方名称相同，疑似主体串位')
        reasons.append('duplicate_names')
    if buyer_tax_id and seller_tax_id and _normalize_tax_id(buyer_tax_id) == _normalize_tax_id(seller_tax_id):
        score -= 0.45
        risks.append('买卖方税号相同，疑似镜像复制')
        reasons.append('duplicate_tax_ids')
    if seller_name and _is_company_name(seller_name):
        score += 0.12
        reasons.append('seller_company_like')
    if buyer_name and _looks_person_name(buyer_name):
        score += 0.08
        reasons.append('buyer_person_like')
    if buyer_name and seller_name and buyer_name != seller_name:
        score += 0.05
        reasons.append('distinct_counterparties')

    return max(0.0, min(score, 1.0)), reasons, risks


def _scheme_confidence_score(
    fields: Dict[str, Optional[str]],
    origins: Dict[str, str],
    ocr_conf_map: Dict[str, Optional[float]],
    llm_conf_map: Dict[str, Optional[float]],
) -> float:
    values: List[float] = []
    for field_name, field_value in fields.items():
        if not field_value:
            continue
        origin = origins.get(field_name)
        if origin == 'ocr':
            values.append(_normalize_confidence(ocr_conf_map.get(field_name), 'ocr'))
        elif origin == 'llm':
            values.append(_normalize_confidence(llm_conf_map.get(field_name), 'llm'))
    if not values:
        return 0.0
    return round(sum(values) / len(values), 2)


def _build_subject_schemes(
    ocr_fields: Dict[str, Optional[str]],
    llm_fields: Dict[str, Optional[str]],
) -> List[Dict[str, Any]]:
    ocr_original = {field: ocr_fields.get(field) for field in SUBJECT_FIELDS}
    llm_original = {field: llm_fields.get(field) for field in SUBJECT_FIELDS}
    ocr_swapped = {
        'buyer_name': ocr_fields.get('seller_name'),
        'buyer_tax_id': ocr_fields.get('seller_tax_id'),
        'seller_name': ocr_fields.get('buyer_name'),
        'seller_tax_id': ocr_fields.get('buyer_tax_id'),
    }
    llm_swapped = {
        'buyer_name': llm_fields.get('seller_name'),
        'buyer_tax_id': llm_fields.get('seller_tax_id'),
        'seller_name': llm_fields.get('buyer_name'),
        'seller_tax_id': llm_fields.get('buyer_tax_id'),
    }
    mixed_ocr_buyer = {
        'buyer_name': ocr_fields.get('buyer_name'),
        'buyer_tax_id': ocr_fields.get('buyer_tax_id'),
        'seller_name': llm_fields.get('seller_name'),
        'seller_tax_id': llm_fields.get('seller_tax_id'),
    }
    mixed_llm_buyer = {
        'buyer_name': llm_fields.get('buyer_name'),
        'buyer_tax_id': llm_fields.get('buyer_tax_id'),
        'seller_name': ocr_fields.get('seller_name'),
        'seller_tax_id': ocr_fields.get('seller_tax_id'),
    }

    return [
        {
            'key': 'ocr_original',
            'label': 'OCR原组',
            'display_label': '按OCR整组',
            'fields': ocr_original,
            'origins': {field: 'ocr' for field in SUBJECT_FIELDS},
        },
        {
            'key': 'llm_original',
            'label': 'LLM原组',
            'display_label': '按LLM整组',
            'fields': llm_original,
            'origins': {field: 'llm' for field in SUBJECT_FIELDS},
        },
        {
            'key': 'ocr_swapped',
            'label': '交换后采用OCR',
            'display_label': '买卖方对调后按OCR',
            'fields': ocr_swapped,
            'origins': {field: 'ocr' for field in SUBJECT_FIELDS},
        },
        {
            'key': 'llm_swapped',
            'label': '交换后采用LLM',
            'display_label': '买卖方对调后按LLM',
            'fields': llm_swapped,
            'origins': {field: 'llm' for field in SUBJECT_FIELDS},
        },
        {
            'key': 'ocr_buyer_llm_seller',
            'label': '买方OCR/卖方LLM',
            'display_label': '买方按OCR, 卖方按LLM',
            'fields': mixed_ocr_buyer,
            'origins': {
                'buyer_name': 'ocr',
                'buyer_tax_id': 'ocr',
                'seller_name': 'llm',
                'seller_tax_id': 'llm',
            },
        },
        {
            'key': 'llm_buyer_ocr_seller',
            'label': '买方LLM/卖方OCR',
            'display_label': '买方按LLM, 卖方按OCR',
            'fields': mixed_llm_buyer,
            'origins': {
                'buyer_name': 'llm',
                'buyer_tax_id': 'llm',
                'seller_name': 'ocr',
                'seller_tax_id': 'ocr',
            },
        },
    ]


def _evaluate_subject_scheme(
    scheme: Dict[str, Any],
    ocr_conf_map: Dict[str, Optional[float]],
    llm_conf_map: Dict[str, Optional[float]],
) -> Dict[str, Any]:
    fields = scheme['fields']
    buyer_pair, buyer_reasons, buyer_risks = _score_name_tax_pair(fields.get('buyer_name'), fields.get('buyer_tax_id'))
    seller_pair, seller_reasons, seller_risks = _score_name_tax_pair(fields.get('seller_name'), fields.get('seller_tax_id'))
    role_score, role_reasons, role_risks = _score_subject_roles(fields)
    completeness = round(sum(1 for field in SUBJECT_FIELDS if fields.get(field)) / len(SUBJECT_FIELDS), 2)
    confidence_score = _scheme_confidence_score(fields, scheme['origins'], ocr_conf_map, llm_conf_map)
    distinct_score = 1.0
    if fields.get('buyer_name') and fields.get('seller_name') and fields['buyer_name'] == fields['seller_name']:
        distinct_score = 0.1
    elif fields.get('buyer_tax_id') and fields.get('seller_tax_id') and _normalize_tax_id(fields['buyer_tax_id']) == _normalize_tax_id(fields['seller_tax_id']):
        distinct_score = 0.1

    score = round(
        ((buyer_pair + seller_pair) / 2) * 0.30
        + role_score * 0.22
        + confidence_score * 0.18
        + completeness * 0.15
        + distinct_score * 0.15,
        2,
    )
    risk_reasons = []
    for risk in buyer_risks + seller_risks + role_risks:
        if risk not in risk_reasons:
            risk_reasons.append(risk)

    return {
        **scheme,
        'score': score,
        'pair_score': round((buyer_pair + seller_pair) / 2, 2),
        'role_score': round(role_score, 2),
        'confidence_score': confidence_score,
        'completeness': completeness,
        'risk_reasons': risk_reasons,
        'reasons': buyer_reasons + seller_reasons + role_reasons + [f'completeness={completeness:.2f}', f'confidence={confidence_score:.2f}'],
    }


def _build_subject_review(
    ocr_fields: Dict[str, Optional[str]],
    llm_fields: Dict[str, Optional[str]],
    ocr_conf_map: Dict[str, Optional[float]],
    llm_conf_map: Dict[str, Optional[float]],
    has_llm: bool,
) -> Optional[Dict[str, Any]]:
    if not has_llm:
        return None
    if not any(ocr_fields.get(field) or llm_fields.get(field) for field in SUBJECT_FIELDS):
        return None

    ranked = sorted(
        [_evaluate_subject_scheme(scheme, ocr_conf_map, llm_conf_map) for scheme in _build_subject_schemes(ocr_fields, llm_fields)],
        key=lambda item: item['score'],
        reverse=True,
    )
    best = ranked[0]
    second = ranked[1] if len(ranked) > 1 else None
    score_gap = round(best['score'] - (second['score'] if second else 0.0), 2)
    critical_risks = list(best['risk_reasons'])
    manual_review_required = (
        best['score'] < 0.88
        or score_gap < 0.20
        or best['completeness'] < 1.0
        or bool(critical_risks)
    )
    risk_level = 'high' if manual_review_required else 'low'
    if not manual_review_required and score_gap < 0.28:
        risk_level = 'medium'

    # 构建人话风险提示
    primary_message_parts = []
    if manual_review_required:
        if best['score'] >= 0.88 and score_gap < 0.20:
            primary_message_parts.append('推荐可信，但与备选差距过小，需人工拍板')
        elif any('对调' in (r or '') or '角色' in (r or '') or '买卖' in (r or '') for r in critical_risks):
            primary_message_parts.append('买卖方角色可能对调，需人工确认')
        elif best['completeness'] < 1.0:
            primary_message_parts.append('主体信息不完整，需人工补充')
        elif best['score'] < 0.88:
            primary_message_parts.append('系统可信度不足，需人工复核')
        else:
            primary_message_parts.append('需人工确认主体信息')
    else:
        primary_message_parts.append('系统已自动确认主体信息')

    action_hint = (
        '建议先采纳系统推荐方案，再提交确认'
        if manual_review_required
        else '可直接确认，或展开备选方案查看其他选项'
    )

    return {
        'group_key': 'buyer_seller_subject',
        'manual_review_required': manual_review_required,
        'auto_accepted': not manual_review_required,
        'risk_level': risk_level,
        'risk_reasons': critical_risks if critical_risks else (['方案分差不足，建议人工复核'] if manual_review_required else []),
        'primary_message': '；'.join(primary_message_parts),
        'action_hint': action_hint,
        'recommended_scheme_key': best['key'],
        'recommended_scheme_label': best['label'],
        'recommended_score': best['score'],
        'second_best_score': second['score'] if second else None,
        'score_gap': score_gap,
        'recommended_fields': best['fields'],
        'recommended_origins': best['origins'],
        'candidate_schemes': [
            {
                'key': item['key'],
                'label': item['label'],
                'display_label': item.get('display_label', item['label']),
                'score': item['score'],
                'fields': item['fields'],
                'origins': item['origins'],
                'risk_reasons': item['risk_reasons'],
            }
            for item in ranked
        ],
        'decision_reason': best['reasons'] + [f'score_gap={score_gap:.2f}'],
    }


def _build_subject_decisions(subject_review: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    recommended_fields = subject_review.get('recommended_fields') or {}
    recommended_origins = subject_review.get('recommended_origins') or {}
    manual_review_required = bool(subject_review.get('manual_review_required'))
    decision_reason = list(subject_review.get('decision_reason') or [])
    risk_reasons = list(subject_review.get('risk_reasons') or [])
    machine_confidence = round(float(subject_review.get('recommended_score') or 0.0), 2)

    decisions: Dict[str, Dict[str, Any]] = {}
    for field_name in SUBJECT_FIELDS:
        recommended_value = recommended_fields.get(field_name)
        origin = recommended_origins.get(field_name)
        if manual_review_required:
            decisions[field_name] = {
                'machine_value': recommended_value,
                'machine_source': origin or 'manual_review',
                'machine_confidence': machine_confidence,
                'decision_rule_type': 'subject_group',
                'decision_reason': decision_reason + risk_reasons + ['subject_group_manual_review'],
                'final_value': None,
                'source': 'conflict',
                'needs_review': True,
            }
        else:
            decisions[field_name] = {
                'machine_value': recommended_value,
                'machine_source': origin or 'matched',
                'machine_confidence': machine_confidence,
                'decision_rule_type': 'subject_group',
                'decision_reason': decision_reason + ['subject_group_auto_accept'],
                'final_value': recommended_value,
                'source': origin or 'matched',
                'needs_review': False,
            }
    return decisions


def _compare_and_resolve(
    ocr_fields: Dict[str, Any],
    llm_fields: Dict[str, Any],
    has_llm: bool,
    llm_confidence: Optional[Dict[str, Any]] = None,
    ocr_confs: Optional[Dict[str, Optional[float]]] = None,
) -> Tuple[Dict[str, Any], List[Dict[str, Any]], Dict[str, Any]]:
    """双引擎比对 + 字段级融合裁决.

    返回两层信息：
    1. machine_*: 机器自动裁决结果（用于离线实验与答辩展示）
    2. final_*: 在线流程当前可写入的业务值；高风险冲突仍可转人工
    """
    final_fields = {}
    diffs = []
    normalized_ocr = {
        field_name: _normalize_value(ocr_fields.get(field_name))
        for field_name in COMPARABLE_FIELDS
    }
    normalized_llm = {
        field_name: _normalize_value(llm_fields.get(field_name)) if has_llm else None
        for field_name in COMPARABLE_FIELDS
    }
    ocr_conf_map = {
        field_name: (float(ocr_confs.get(field_name)) if ocr_confs and isinstance(ocr_confs.get(field_name), (int, float)) else None)
        for field_name in COMPARABLE_FIELDS
    }
    llm_conf_map = {
        field_name: (float(llm_confidence.get(field_name)) if llm_confidence and isinstance(llm_confidence.get(field_name), (int, float)) else None)
        for field_name in COMPARABLE_FIELDS
    }
    decision_trace: Dict[str, Any] = {
        'machine_summary': {
            'has_llm': has_llm,
        }
    }

    subject_review = _build_subject_review(
        normalized_ocr,
        normalized_llm,
        ocr_conf_map,
        llm_conf_map,
        has_llm,
    )
    if subject_review:
        decision_trace['subject_review'] = subject_review
    subject_decisions = _build_subject_decisions(subject_review) if subject_review else {}

    for field_name in COMPARABLE_FIELDS:
        ocr_value = normalized_ocr.get(field_name)
        llm_value = normalized_llm.get(field_name)

        # 提取双引擎置信度
        ocr_field_conf = ocr_conf_map.get(field_name)
        llm_field_conf = llm_conf_map.get(field_name)

        # 融合为综合置信度
        composite_conf = _fuse_confidence(
            ocr_field_conf, llm_field_conf,
            ocr_value, llm_value, field_name
        )

        decision = subject_decisions.get(field_name)
        if decision is None:
            decision = _decide_field_value(
                field_name=field_name,
                ocr_value=ocr_value,
                llm_value=llm_value,
                ocr_confidence=ocr_field_conf,
                llm_confidence=llm_field_conf,
                fallback_confidence=composite_conf,
                ocr_fields=normalized_ocr,
                llm_fields=normalized_llm,
                has_llm=has_llm,
            )
        final_value = decision['final_value']
        source = decision['source']
        needs_review = decision['needs_review']

        final_fields[field_name] = final_value

        if has_llm and (ocr_value or llm_value):
            diffs.append({
                'field_name': field_name,
                'ocr_value': ocr_value,
                'llm_value': llm_value,
                'machine_value': decision['machine_value'],
                'machine_source': decision['machine_source'],
                'machine_confidence': decision['machine_confidence'],
                'decision_rule_type': decision['decision_rule_type'],
                'decision_reason': decision['decision_reason'],
                'final_value': final_value,
                'source': source,
                'needs_review': needs_review,
                'confidence': composite_conf,
                'ocr_confidence': round(ocr_field_conf / 100.0, 2) if ocr_field_conf is not None else None,
                'llm_confidence': llm_field_conf,
            })

    return final_fields, diffs, decision_trace


AUTO_DECISION_THRESHOLD = 0.72
AUTO_DECISION_GAP = 0.12
FIELD_TYPE_RULES = {
    'invoice_number': 'invoice_no_pattern',
    'issue_date': 'date_validity',
    'buyer_name': 'name_semantic',
    'buyer_tax_id': 'tax_id_format',
    'seller_name': 'name_semantic',
    'seller_tax_id': 'tax_id_format',
    'total_with_tax': 'numeric_consistency',
    'amount': 'numeric_consistency',
    'tax_rate': 'fallback_confidence',
    'tax_amount': 'numeric_consistency',
}


def _normalize_confidence(value: Optional[float], scale: str) -> float:
    if value is None:
        return 0.0
    val = float(value)
    if scale == 'ocr':
        return max(0.0, min(val / 100.0, 1.0))
    return max(0.0, min(val, 1.0))


def _numeric_value(value: Optional[str]) -> Optional[float]:
    if not value:
        return None
    clean = value.replace('¥', '').replace('￥', '').replace(',', '').strip()
    try:
        return float(clean)
    except ValueError:
        return None


def _candidate_numeric_consistency(fields: Dict[str, Optional[str]]) -> float:
    total = _numeric_value(fields.get('total_with_tax'))
    amount = _numeric_value(fields.get('amount'))
    tax = _numeric_value(fields.get('tax_amount'))
    if total is None and amount is None and tax is None:
        return 0.0
    if total is not None and amount is not None and tax is not None:
        return 1.0 if abs((amount + tax) - total) <= 0.05 else 0.25
    return 0.55


def _score_tax_id(value: Optional[str]) -> float:
    if not value:
        return 0.0
    candidate = value.strip().upper()
    candidate = candidate.replace('O', '0').replace('I', '1')
    if candidate.isalnum() and 15 <= len(candidate) <= 20:
        return 1.0
    if candidate.isalnum() and 10 <= len(candidate) <= 25:
        return 0.6
    return 0.2


def _score_date(value: Optional[str]) -> float:
    if not value:
        return 0.0
    from datetime import datetime

    normalized = value.replace('/', '-').replace('.', '-').strip()
    for fmt in ('%Y-%m-%d', '%Y-%m', '%Y%m%d'):
        try:
            parsed = datetime.strptime(normalized, fmt)
            if 2015 <= parsed.year <= 2035:
                return 1.0
            return 0.4
        except ValueError:
            continue
    return 0.1


def _score_invoice_number(value: Optional[str]) -> float:
    if not value:
        return 0.0
    candidate = ''.join(ch for ch in value if ch.isalnum())
    if candidate.isdigit() and 8 <= len(candidate) <= 20:
        return 1.0
    if len(candidate) >= 8:
        return 0.6
    return 0.2


def _score_name(value: Optional[str]) -> float:
    if not value:
        return 0.0
    text = value.strip()
    base = 0.45
    if any(suffix in text for suffix in ('公司', '有限', '科技', '商贸', '集团', '大学', '中心')):
        base += 0.35
    if len(text) < 2 or len(text) > 40:
        base -= 0.2
    noise_count = sum(1 for ch in text if ch in '@#$%^&*_=+~`')
    base -= min(noise_count * 0.1, 0.3)
    return max(0.0, min(base, 1.0))


def _score_tax_rate(value: Optional[str]) -> float:
    if not value:
        return 0.0
    text = value.strip().replace('%', '')
    try:
        rate = float(text)
        return 1.0 if 0 <= rate <= 100 else 0.2
    except ValueError:
        return 0.2


def _score_rule_validity(field_name: str, value: Optional[str], engine_fields: Dict[str, Optional[str]]) -> float:
    if field_name in NUMERIC_FIELDS:
        if _numeric_value(value) is None:
            return 0.0
        return _candidate_numeric_consistency(engine_fields)
    if field_name in ('buyer_tax_id', 'seller_tax_id'):
        return _score_tax_id(value)
    if field_name == 'issue_date':
        return _score_date(value)
    if field_name == 'invoice_number':
        return _score_invoice_number(value)
    if field_name in ('buyer_name', 'seller_name'):
        return _score_name(value)
    if field_name == 'tax_rate':
        return _score_tax_rate(value)
    return 0.5 if value else 0.0


def _score_candidate(
    field_name: str,
    value: Optional[str],
    engine: str,
    raw_confidence: Optional[float],
    engine_fields: Dict[str, Optional[str]],
) -> Tuple[float, List[str]]:
    if not value:
        return 0.0, [f'{engine}_missing']

    normalized_conf = _normalize_confidence(raw_confidence, 'ocr' if engine == 'ocr' else 'llm')
    validity_score = _score_rule_validity(field_name, value, engine_fields)
    consistency_score = _candidate_numeric_consistency(engine_fields) if field_name in NUMERIC_FIELDS else validity_score
    total = round(normalized_conf * 0.45 + validity_score * 0.4 + consistency_score * 0.15, 2)

    reasons = [
        f'{engine}_confidence={normalized_conf:.2f}',
        f'{engine}_rule_score={validity_score:.2f}',
    ]
    if field_name in NUMERIC_FIELDS:
        reasons.append(f'{engine}_consistency={consistency_score:.2f}')
    return total, reasons


def _manual_decision(rule_type: str, reason: List[str], confidence: Optional[float]) -> Dict[str, Any]:
    machine_conf = round(float(confidence), 2) if confidence is not None else None
    return {
        'machine_value': None,
        'machine_source': 'manual_review',
        'machine_confidence': machine_conf,
        'decision_rule_type': rule_type,
        'decision_reason': reason,
        'final_value': None,
        'source': 'conflict',
        'needs_review': True,
    }


def _decide_field_value(
    field_name: str,
    ocr_value: Optional[str],
    llm_value: Optional[str],
    ocr_confidence: Optional[float],
    llm_confidence: Optional[float],
    fallback_confidence: Optional[float],
    ocr_fields: Dict[str, Optional[str]],
    llm_fields: Dict[str, Optional[str]],
    has_llm: bool,
) -> Dict[str, Any]:
    rule_type = FIELD_TYPE_RULES.get(field_name, 'fallback_confidence')
    machine_confidence = round(float(fallback_confidence), 2) if fallback_confidence is not None else None

    if not has_llm:
        return {
            'machine_value': ocr_value,
            'machine_source': 'ocr',
            'machine_confidence': machine_confidence,
            'decision_rule_type': 'single_engine',
            'decision_reason': ['llm_unavailable'],
            'final_value': ocr_value,
            'source': 'ocr',
            'needs_review': False,
        }

    if _values_are_equal(field_name, ocr_value, llm_value):
        matched_value = ocr_value or llm_value
        needs_review = machine_confidence is not None and machine_confidence < 0.80
        return {
            'machine_value': matched_value,
            'machine_source': 'matched',
            'machine_confidence': machine_confidence,
            'decision_rule_type': 'agreement',
            'decision_reason': ['ocr_llm_agree'],
            'final_value': None if needs_review else matched_value,
            'source': 'conflict' if needs_review else 'matched',
            'needs_review': needs_review,
        }

    if ocr_value and llm_value:
        ocr_score, ocr_reasons = _score_candidate(field_name, ocr_value, 'ocr', ocr_confidence, ocr_fields)
        llm_score, llm_reasons = _score_candidate(field_name, llm_value, 'llm', llm_confidence, llm_fields)
        score_gap = round(abs(ocr_score - llm_score), 2)
        winning_source = 'ocr' if ocr_score >= llm_score else 'llm'
        winning_score = max(ocr_score, llm_score)
        winning_value = ocr_value if winning_source == 'ocr' else llm_value
        reasons = ocr_reasons + llm_reasons + [f'score_gap={score_gap:.2f}']

        if winning_score >= AUTO_DECISION_THRESHOLD and score_gap >= AUTO_DECISION_GAP:
            return {
                'machine_value': winning_value,
                'machine_source': winning_source,
                'machine_confidence': winning_score,
                'decision_rule_type': rule_type,
                'decision_reason': reasons + [f'auto_select_{winning_source}'],
                'final_value': winning_value,
                'source': winning_source,
                'needs_review': False,
            }

        return _manual_decision(rule_type, reasons + ['manual_review_due_to_close_scores'], machine_confidence)

    if ocr_value or llm_value:
        source = 'ocr' if ocr_value else 'llm'
        value = ocr_value or llm_value
        raw_conf = ocr_confidence if ocr_value else llm_confidence
        engine_fields = ocr_fields if ocr_value else llm_fields
        score, reasons = _score_candidate(field_name, value, source, raw_conf, engine_fields)
        if score >= AUTO_DECISION_THRESHOLD:
            return {
                'machine_value': value,
                'machine_source': source,
                'machine_confidence': score,
                'decision_rule_type': rule_type,
                'decision_reason': reasons + [f'single_side_select_{source}'],
                'final_value': value,
                'source': source,
                'needs_review': False,
            }
        return _manual_decision(rule_type, reasons + ['manual_review_due_to_low_score'], score)

    return _manual_decision(rule_type, ['ocr_llm_both_empty'], machine_confidence)

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
