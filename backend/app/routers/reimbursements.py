import logging

from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from typing import List, Optional
from decimal import Decimal

from app.database import get_db

logger = logging.getLogger(__name__)
from app.models.reimbursement import Reimbursement, ReimbursementStatus
from app.models.invoice import Invoice, InvoiceStatus
from app.models.user import User
from app.models.audit_log import AuditLog
from app.models.notification import Notification
from app.models.project import Project
from app.models.application import Application, ApplicationStatus
from app.schemas.reimbursement import ReimbursementCreate, ReimbursementResponse, ReimbursementReview
from app.services.reimbursement_service import delete_reimbursement_logic
from app.services.audit_service import log_audit_no_commit, get_client_info
from app.dependencies import get_current_user

router = APIRouter()


@router.post("", response_model=ReimbursementResponse)
async def create_reimbursement(
    data: ReimbursementCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    query = select(Invoice).where(Invoice.id.in_(data.invoice_ids))
    result = await db.execute(query)
    invoices = result.scalars().all()

    if not invoices:
        raise HTTPException(status_code=404, detail="未找到指定的发票")

    total = sum([inv.total_with_tax for inv in invoices if inv.total_with_tax])

    # 预算超标检查
    budget_warning = None
    if data.project_code:
        project = await db.scalar(select(Project).where(Project.project_code == data.project_code))
        if project and project.budget > 0:
            used = await db.scalar(
                select(func.coalesce(func.sum(Reimbursement.total_amount), 0)).where(
                    Reimbursement.project_code == data.project_code,
                    Reimbursement.status.in_([ReimbursementStatus.SUBMITTED, ReimbursementStatus.APPROVED, ReimbursementStatus.COMPLETED]),
                )
            ) or 0
            if Decimal(str(used)) + total > project.budget:
                budget_warning = f"警告：该项目预算 ¥{float(project.budget):.2f}，已使用 ¥{float(used):.2f}，本次 ¥{float(total):.2f} 将超出预算"

    reimb = Reimbursement(
        title=data.title,
        project_code=data.project_code,
        total_amount=total,
        submitter=current_user["username"],
        submitter_id=current_user["id"],
        bank_card_id=data.bank_card_id,
        application_id=data.application_id,
        borrowing_id=data.borrowing_id,
        status=ReimbursementStatus.SUBMITTED
    )
    # 关联申请单校验：归属 + 状态 + 剩余额度
    if data.application_id:
        app = await db.get(Application, data.application_id)
        if not app:
            raise HTTPException(status_code=400, detail="申请单不存在")
        if app.user_id != current_user["id"]:
            raise HTTPException(status_code=400, detail="申请单不属于您")
        if app.status != ApplicationStatus.APPROVED:
            raise HTTPException(status_code=400, detail="只能关联状态为「已通过」的事前申请单")

        # 计算该申请单已被占用的额度（已通过+已打款的报销单）
        app_used = await db.scalar(
            select(func.coalesce(func.sum(Reimbursement.total_amount), 0)).where(
                Reimbursement.application_id == data.application_id,
                Reimbursement.status.in_([ReimbursementStatus.APPROVED, ReimbursementStatus.COMPLETED]),
            )
        ) or 0
        # 自动继承申请单的项目编号
        if app.project_code and not data.project_code:
            data.project_code = app.project_code

        app_remaining = app.estimated_amount - Decimal(str(app_used))
        if Decimal(str(total)) > app_remaining:
            raise HTTPException(
                status_code=400,
                detail=f"报销金额 ¥{float(total):.2f} 超出申请单剩余额度 ¥{float(app_remaining):.2f}"
                      f"（申请总额 ¥{float(app.estimated_amount):.2f}，已使用 ¥{float(app_used):.2f}）",
            )
    db.add(reimb)
    await db.flush()

    for inv in invoices:
        # 防止拿别人的发票报销
        if inv.owner_id and inv.owner_id != current_user["id"]:
            raise HTTPException(status_code=403, detail=f"发票 {inv.invoice_number or inv.id} 不属于您，无法报销")
        # 防止同一张发票重复打包
        if inv.reimbursement_id is not None:
            raise HTTPException(status_code=400, detail=f"发票 {inv.invoice_number or inv.id} 已被其他报销单占用")
        # 按发票号码去重：同一号码不能同时被多人使用
        if inv.invoice_number:
            dup = await db.scalar(
                select(func.count(Invoice.id)).where(
                    Invoice.invoice_number == inv.invoice_number,
                    Invoice.id != inv.id,
                    Invoice.reimbursement_id.isnot(None),
                )
            )
            if dup and dup > 0:
                raise HTTPException(status_code=400, detail=f"发票号码 {inv.invoice_number} 已被他人提交报销，无法重复使用")
        inv.reimbursement_id = reimb.id

    # 通知所有管理员：有新的报销单待审批
    admin_query = select(User).where(User.role == "admin")
    admin_result = await db.execute(admin_query)
    admins = admin_result.scalars().all()
    for admin in admins:
        db.add(Notification(
            user_id=admin.id,
            title="新报销单待审批",
            message=f"员工 {current_user.get('full_name') or current_user.get('username')} 提交了报销单「{reimb.title}」，金额 ¥{float(reimb.total_amount or 0):.2f}，请及时审批。",
            entity_type="reimbursement",
            entity_id=reimb.id,
        ))

    await db.commit()

    fetch_query = select(Reimbursement).options(selectinload(Reimbursement.invoices)).where(
        Reimbursement.id == reimb.id)
    fetch_result = await db.execute(fetch_query)
    return fetch_result.scalar_one()


@router.get("", response_model=List[ReimbursementResponse])
async def get_reimbursements(
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """获取报销单列表。管理员看全部，员工只看自己的。"""
    query = select(Reimbursement).options(selectinload(Reimbursement.invoices)).order_by(
        Reimbursement.created_at.desc())

    # 数据隔离：员工只能看自己提交的报销单（通过外键）
    if current_user["role"] != "admin":
        query = query.where(Reimbursement.submitter_id == current_user["id"])

    query = query.offset(skip).limit(limit)
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/{reimb_id}", response_model=ReimbursementResponse)
async def get_reimbursement_detail(
    reimb_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """获取单个报销单详情（含关联发票完整信息）。"""
    from app.models.borrowing import Borrowing
    query = select(Reimbursement).options(
        selectinload(Reimbursement.invoices),
        selectinload(Reimbursement.bank_card),
        selectinload(Reimbursement.borrowing).selectinload(Borrowing.application),
    ).where(Reimbursement.id == reimb_id)

    # 数据隔离
    if current_user["role"] != "admin":
        query = query.where(Reimbursement.submitter_id == current_user["id"])

    result = await db.execute(query)
    reimb = result.scalar_one_or_none()
    if not reimb:
        raise HTTPException(status_code=404, detail="报销单不存在")

    # 计算 bank_card_info 供前端打印凭证使用
    if reimb.bank_card:
        masked = reimb.bank_card.card_number[-4:] if len(reimb.bank_card.card_number) >= 4 else reimb.bank_card.card_number
        reimb.bank_card_info = f"{reimb.bank_card.bank_name} (尾号{masked})"
    elif reimb.payment_bank:
        reimb.bank_card_info = reimb.payment_bank
    else:
        reimb.bank_card_info = None

    # 财务总监电子签名（查 admin 用户）
    reviewer_sig = None
    from app.models.user import User
    admin_query = select(User).where(User.role == "admin").limit(1)
    admin_result = await db.execute(admin_query)
    admin_user = admin_result.scalar_one_or_none()
    if admin_user and admin_user.signature:
        reviewer_sig = admin_user.signature

    # 手动构造返回 dict，确保 reviewer_signature 不会被 Pydantic 过滤掉
    from app.schemas.reimbursement import ReimbursementResponse
    resp = ReimbursementResponse.model_validate(reimb)
    resp_dict = resp.model_dump()
    resp_dict["reviewer_signature"] = reviewer_sig
    # 借款冲销信息
    if reimb.borrowing:
        resp_dict["borrowing_info"] = {
            "id": reimb.borrowing.id,
            "title": reimb.borrowing.title,
            "estimated_amount": float(reimb.borrowing.estimated_amount),
            "repaid_amount": float(reimb.borrowing.repaid_amount) if reimb.borrowing.repaid_amount else None,
            "status": reimb.borrowing.status,
        }
    else:
        resp_dict["borrowing_info"] = None
    return resp_dict


@router.get("/export/excel")
async def export_reimbursements_excel(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """导出报销单为 Excel 格式。"""
    from io import BytesIO
    from urllib.parse import quote
    from fastapi.responses import StreamingResponse

    try:
        import openpyxl
        from openpyxl.styles import Font, Alignment, Border, Side, PatternFill
    except ImportError:
        raise HTTPException(status_code=500, detail="Excel 导出需要 openpyxl 库")

    query = select(Reimbursement).options(
        selectinload(Reimbursement.invoices),
        selectinload(Reimbursement.submitter_user),
    ).order_by(Reimbursement.created_at.desc())

    if current_user["role"] != "admin":
        query = query.where(Reimbursement.submitter_id == current_user["id"])

    result = await db.execute(query)
    reimbursements = result.scalars().all()

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "报销单台账"

    headers = [
        "报销单号", "报销事由", "项目编号", "报销总金额", "提交人",
        "审批人", "审批意见", "驳回理由", "状态", "AI风险评级",
        "关联发票数", "关联发票号码", "提交时间", "更新时间",
    ]

    header_font = Font(bold=True, color="FFFFFF", size=11)
    header_fill = PatternFill(start_color="E42313", end_color="E42313", fill_type="solid")
    header_align = Alignment(horizontal="center", vertical="center")
    thin_border = Border(
        left=Side(style="thin"), right=Side(style="thin"),
        top=Side(style="thin"), bottom=Side(style="thin"),
    )

    for col, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = header_align
        cell.border = thin_border

    for row, r in enumerate(reimbursements, 2):
        invoice_nums = ", ".join(
            [inv.invoice_number for inv in (r.invoices or []) if inv.invoice_number]
        ) or "-"

        data = [
            r.id,
            r.title,
            r.project_code or "-",
            float(r.total_amount or 0),
            r.submitter_name or r.submitter or "-",
            r.reviewer or "-",
            r.review_note or "-",
            r.reject_reason or "-",
            r.status.value if r.status else "-",
            r.ai_risk_level or "-",
            len(r.invoices or []),
            invoice_nums,
            r.created_at.strftime("%Y-%m-%d %H:%M") if r.created_at else "-",
            r.updated_at.strftime("%Y-%m-%d %H:%M") if r.updated_at else "-",
        ]

        for col, value in enumerate(data, 1):
            cell = ws.cell(row=row, column=col, value=value)
            cell.border = thin_border
            cell.alignment = Alignment(vertical="center")

    # 自适应列宽
    for col in ws.columns:
        max_len = 0
        col_letter = col[0].column_letter
        for cell in col:
            try:
                max_len = max(max_len, len(str(cell.value)))
            except Exception:
                pass
        ws.column_dimensions[col_letter].width = min(max_len + 4, 50)

    # 合计行
    total_row = len(reimbursements) + 2
    ws.cell(row=total_row, column=1, value="合计").font = Font(bold=True)
    ws.cell(row=total_row, column=4, value=sum(float(r.total_amount or 0) for r in reimbursements))
    ws.cell(row=total_row, column=4).font = Font(bold=True, color="E42313")

    output = BytesIO()
    wb.save(output)
    output.seek(0)

    filename = quote("报销单台账.xlsx")
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"},
    )
async def review_reimbursement(reimb_id: int, data: ReimbursementReview, db: AsyncSession = Depends(get_db)):
    query = select(Reimbursement).options(selectinload(Reimbursement.invoices)).where(Reimbursement.id == reimb_id)
    result = await db.execute(query)
    reimb = result.scalar_one_or_none()

    if not reimb:
        raise HTTPException(status_code=404, detail="报销单不存在")

    if data.action == "APPROVE":
        reimb.status = ReimbursementStatus.APPROVED
    elif data.action == "REJECT":
        reimb.status = ReimbursementStatus.REJECTED
        reimb.reject_reason = data.reject_reason
        for inv in reimb.invoices:
            inv.reimbursement_id = None
            inv.status = InvoiceStatus.CONFIRMED

    await db.commit()
    await db.refresh(reimb)
    return reimb


@router.delete("/{reimb_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_reimbursement(
    reimb_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    success = await delete_reimbursement_logic(
        reimb_id, db,
        deleted_by_username=current_user.get("full_name") or current_user.get("username", "管理员"),
    )
    if not success:
        raise HTTPException(status_code=404, detail="报销单不存在")
    return None


@router.post("/{reimb_id}/ai-check")
async def ai_check_reimbursement(
    reimb_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    AI 智能合规审查
    """
    import json
    import logging
    from app.services.prompts import build_ai_check_prompt
    from app.services.llm_service import get_llm_service

    logger = logging.getLogger(__name__)

    # 1. 查报销单 + 预加载关联发票
    query = select(Reimbursement).options(
        selectinload(Reimbursement.invoices)
    ).where(Reimbursement.id == reimb_id)
    result = await db.execute(query)
    reimb = result.scalar_one_or_none()

    if not reimb:
        raise HTTPException(status_code=404, detail="报销单不存在")
    if not reimb.invoices:
        raise HTTPException(status_code=400, detail="该报销单没有关联发票，无法审查")

    # 2. 提取发票数据
    invoices_data = []
    for inv in reimb.invoices:
        invoices_data.append({
            "invoice_number": inv.invoice_number or "无号码",
            "seller_name": inv.seller_name or "",
            "total_with_tax": str(inv.total_with_tax) if inv.total_with_tax else "0.00",
            "items": inv.items or [],
        })

    # 3. 检查预算
    budget_info = ""
    if reimb.project_code:
        project = await db.scalar(select(Project).where(Project.project_code == reimb.project_code))
        if project and project.budget > 0:
            used = await db.scalar(
                select(func.coalesce(func.sum(Reimbursement.total_amount), 0)).where(
                    Reimbursement.project_code == reimb.project_code,
                    Reimbursement.status.in_([ReimbursementStatus.SUBMITTED, ReimbursementStatus.APPROVED, ReimbursementStatus.COMPLETED]),
                )
            ) or 0
            remaining = project.budget - Decimal(str(used))
            budget_info = f"\n## 项目预算信息\n- 项目：{project.project_name}（{project.project_code}）\n- 预算总额：¥{float(project.budget):.2f}\n- 已使用：¥{float(used):.2f}\n- 剩余：¥{float(remaining):.2f}\n- {'⚠️ 注意：本次报销将超出项目预算！' if remaining < reimb.total_amount else '预算充足'}"

    # 4. 构造 Prompt
    prompt = build_ai_check_prompt(
        reimb_title=reimb.title,
        reimb_amount=str(reimb.total_amount),
        invoices=invoices_data,
        budget_info=budget_info,
    )

    # 4. 调用 LLM（使用现有的 QwenProvider）
    try:
        llm_service = get_llm_service()
        provider = llm_service.active_provider
        if not provider or not provider.is_configured():
            raise HTTPException(status_code=500, detail="LLM 服务未配置")

        llm_response = provider.chat_completion(
            system_prompt="你是一位严格的财务审计专家，你的职责是找出报销单中的一切可疑之处。默认持怀疑态度，只有证据充分时才判定合规。必须严格按照 JSON 格式输出。",
            user_prompt=prompt
        )
    except Exception as exc:
        logger.error(f"LLM 调用失败：{exc}")
        raise HTTPException(status_code=500, detail=f"AI 审查服务调用失败：{str(exc)}")

    # 5. 解析结果
    cleaned = llm_response.strip()
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        cleaned = "\n".join(lines[1:-1]) if len(lines) > 2 else lines[0]

    try:
        result_dict = json.loads(cleaned)
    except json.JSONDecodeError:
        logger.warning(f"AI 返回非 JSON 格式，原文：{llm_response}")
        result_dict = {
            "compliance_status": "未知",
            "risk_level": "未知",
            "reason": "AI 返回格式异常，请查看备注",
            "remarks": llm_response,
            "details": [],
        }

    # 🚀🚀🚀 核心逻辑：把 AI 的完整审查报告永久刻在数据库里！
    reimb.ai_risk_level = result_dict.get("risk_level", "未知")
    
    # 🛑 核心修复：绝对不能只存一段纯文本！必须把整个字典转化为 JSON 字符串，喂给 ai_reason！
    reimb.ai_reason = json.dumps(result_dict, ensure_ascii=False)
    
    # 兼容原有的字段（如果有的话）
    if hasattr(reimb, 'ai_review_detail'):
        reimb.ai_review_detail = result_dict 

    await db.commit()  # 提交到 PostgreSQL 数据库保存！

    # 动态规则引擎：AI 审查完成后自动匹配规则
    from app.services.rule_engine import match_rules
    from app.models.notification import Notification

    action = await match_rules("reimbursement", {
        "total_amount": float(reimb.total_amount or 0),
        "ai_risk_level": result_dict.get("risk_level", ""),
        "compliance_status": result_dict.get("compliance_status", ""),
    }, db)

    if action == "AUTO_APPROVE":
        reimb.status = ReimbursementStatus.APPROVED
        reimb.reviewer = "AI规则引擎"  # 标记非人工审批
        for inv in reimb.invoices:
            inv.status = InvoiceStatus.REIMBURSED
        if reimb.submitter_id:
            db.add(Notification(
                user_id=reimb.submitter_id,
                title="报销单自动审批通过",
                message=f"您的报销单「{reimb.title}」¥{float(reimb.total_amount or 0):.2f} 已由AI规则引擎自动审批通过，进入待打款队列。",
                entity_type="reimbursement", entity_id=reimb.id,
            ))
        await db.commit()
        await db.refresh(reimb)

    return result_dict


# ============================================================
# 第四步（配套）：后端审批通过 / 驳回端点
# ============================================================

@router.put("/{reimb_id}/approve")
async def approve_reimbursement(
    reimb_id: int,
    body: dict,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """审批通过报销单"""
    query = select(Reimbursement).options(
        selectinload(Reimbursement.invoices)
    ).where(Reimbursement.id == reimb_id)
    result = await db.execute(query)
    reimb = result.scalar_one_or_none()

    if not reimb:
        raise HTTPException(status_code=404, detail="报销单不存在")
    if reimb.status != ReimbursementStatus.SUBMITTED:
        raise HTTPException(status_code=400, detail="只能审批状态为「待审批」的报销单")

    reimb.status = ReimbursementStatus.APPROVED
    reimb.reviewer = body.get("reviewer", "系统")
    reimb.review_note = body.get("review_note", "")

    # 审批通过后，关联发票才正式变为「已报销」
    for inv in reimb.invoices:
        inv.status = InvoiceStatus.REIMBURSED

    # 预算/风险预警检查
    warnings = []
    if reimb.ai_risk_level and ("高" in str(reimb.ai_risk_level) or "危" in str(reimb.ai_risk_level)):
        warnings.append(f"⚠️ AI 风险评级：{reimb.ai_risk_level}")
    if reimb.project_code:
        project = await db.scalar(select(Project).where(Project.project_code == reimb.project_code))
        if project and project.budget > 0:
            used = await db.scalar(
                select(func.coalesce(func.sum(Reimbursement.total_amount), 0)).where(
                    Reimbursement.project_code == reimb.project_code,
                    Reimbursement.status.in_([ReimbursementStatus.SUBMITTED, ReimbursementStatus.APPROVED, ReimbursementStatus.COMPLETED]),
                )
            ) or 0
            if Decimal(str(used)) > project.budget:
                warnings.append(f"⚠️ 项目 {project.project_name} 预算已超支！预算 ¥{float(project.budget):.2f}，已使用 ¥{float(used):.2f}")

    client_info = get_client_info(request)
    await log_audit_no_commit(
        db=db,
        entity_type="reimbursement",
        entity_id=reimb_id,
        action="approve",
        new_value={
            "status": ReimbursementStatus.APPROVED.value,
            "review_note": reimb.review_note or "",
            "invoice_count": len(reimb.invoices),
        },
        ip_address=client_info.get("ip_address"),
        user_agent=client_info.get("user_agent"),
    )

    # 发通知给提交人
    if reimb.submitter_id:
        db.add(Notification(
            user_id=reimb.submitter_id,
            title="报销单审批通过",
            message=f"您的报销单「{reimb.title}」已审批通过，金额 ¥{float(reimb.total_amount or 0):.2f}，预计 3 个工作日内到账。",
            entity_type="reimbursement",
            entity_id=reimb.id,
        ))

    await db.commit()
    await db.refresh(reimb)

    return {
        "message": "审批通过",
        "reimbursement_id": reimb_id,
        "invoice_count": len(reimb.invoices),
        "warnings": warnings,
    }


@router.put("/{reimb_id}/reject")
async def reject_reimbursement(
    reimb_id: int,
    body: dict,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """驳回报销单，释放关联发票"""
    query = select(Reimbursement).options(
        selectinload(Reimbursement.invoices)
    ).where(Reimbursement.id == reimb_id)
    result = await db.execute(query)
    reimb = result.scalar_one_or_none()

    if not reimb:
        raise HTTPException(status_code=404, detail="报销单不存在")
    if reimb.status != ReimbursementStatus.SUBMITTED:
        raise HTTPException(status_code=400, detail="只能驳回状态为「待审批」的报销单")

    reimb.status = ReimbursementStatus.REJECTED
    reject_reason = body.get("reject_reason", "无")
    reimb.reject_reason = reject_reason

    for inv in reimb.invoices:
        inv.reimbursement_id = None
        inv.status = InvoiceStatus.CONFIRMED

    client_info = get_client_info(request)
    await log_audit_no_commit(
        db=db,
        entity_type="reimbursement",
        entity_id=reimb_id,
        action="reject",
        new_value={
            "status": ReimbursementStatus.REJECTED.value,
            "reject_reason": reject_reason,
            "invoice_count": len(reimb.invoices),
        },
        ip_address=client_info.get("ip_address"),
        user_agent=client_info.get("user_agent"),
    )

    # 发通知给提交人
    if reimb.submitter_id:
        db.add(Notification(
            user_id=reimb.submitter_id,
            title="报销单已驳回",
            message=f"您的报销单「{reimb.title}」已被驳回。理由：{reject_reason}",
            entity_type="reimbursement",
            entity_id=reimb.id,
        ))

    await db.commit()
    await db.refresh(reimb)

    return {
        "message": "已驳回，关联发票已释放",
        "reimbursement_id": reimb_id,
    }


@router.put("/{reimb_id}/complete")
async def complete_reimbursement(
    reimb_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """出纳确认打款，模拟银企直联转账，报销单进入已完成状态。"""
    from app.services.payment_service import mock_bank_transfer

    query = select(Reimbursement).options(
        selectinload(Reimbursement.invoices),
        selectinload(Reimbursement.bank_card),
    ).where(Reimbursement.id == reimb_id)
    result = await db.execute(query)
    reimb = result.scalar_one_or_none()

    if not reimb:
        raise HTTPException(status_code=404, detail="报销单不存在")
    if reimb.status != ReimbursementStatus.APPROVED:
        raise HTTPException(status_code=400, detail="只能对已通过的报销单操作")

    # 模拟银企直联打款
    payment_result = mock_bank_transfer(reimb, reimb.bank_card)

    reimb.status = ReimbursementStatus.COMPLETED
    reimb.payment_transaction_id = payment_result["transaction_id"]
    reimb.payment_time = payment_result["transfer_time"]
    reimb.payment_bank = payment_result["to_bank"]

    # 通知提交人（含交易流水号）
    if reimb.submitter_id:
        db.add(Notification(
            user_id=reimb.submitter_id,
            title="报销款已打款",
            message=f"您的报销单「{reimb.title}」¥{float(reimb.total_amount or 0):.2f} 已打入尾号 {payment_result['to_account'][-4:]} 的{payment_result['to_bank']}，流水号 {payment_result['transaction_id']}，预计 {payment_result['estimated_arrival'][:16].replace('T', ' ')} 前到账。",
            entity_type="reimbursement",
            entity_id=reimb.id,
        ))

    # 审计
    client_info = get_client_info(request)
    await log_audit_no_commit(
        db=db, entity_type="reimbursement", entity_id=reimb_id,
        action="complete",
        new_value={
            "status": ReimbursementStatus.COMPLETED.value,
            "transaction_id": payment_result["transaction_id"],
            "payment_bank": payment_result["to_bank"],
        },
        ip_address=client_info.get("ip_address"),
        user_agent=client_info.get("user_agent"),
    )

    # 自动冲销关联借款
    if reimb.borrowing_id:
        from app.models.borrowing import Borrowing, BorrowingStatus
        b_query = select(Borrowing).where(Borrowing.id == reimb.borrowing_id)
        b_result = await db.execute(b_query)
        borrowing = b_result.scalar_one_or_none()
        if borrowing:
            borrowing.status = BorrowingStatus.REPAID.value
            borrowing.reimbursement_id = reimb.id
            borrowing.repaid_amount = reimb.total_amount

            reimb_amt = float(reimb.total_amount)
            borrow_amt = float(borrowing.estimated_amount)

            if reimb_amt > borrow_amt:
                # 超额冲销：报销金额 > 借款金额，通知借款人和所有管理员
                excess = reimb_amt - borrow_amt
                db.add(Notification(
                    user_id=borrowing.user_id,
                    title="借款超额冲销提醒",
                    message=f"您的借款「{borrowing.title}」（借款金额 ¥{borrow_amt:.2f}）已被报销单 #{reimb.id} 超额冲销，冲销金额 ¥{reimb_amt:.2f}，超出 ¥{excess:.2f}，请关注。",
                    entity_type="borrowing",
                    entity_id=borrowing.id,
                ))
                admins = (await db.execute(select(User).where(User.role == "admin"))).scalars().all()
                for admin in admins:
                    db.add(Notification(
                        user_id=admin.id,
                        title="借款超额冲销预警",
                        message=f"员工 {reimb.submitter} 的借款「{borrowing.title}」（¥{borrow_amt:.2f}）被报销单 #{reimb.id} 超额冲销 ¥{reimb_amt:.2f}，超出 ¥{excess:.2f}",
                        entity_type="borrowing",
                        entity_id=borrowing.id,
                    ))
            elif reimb_amt < borrow_amt:
                # 部分冲销：报销金额 < 借款金额，通知借款人还有未冲销余额
                shortfall = borrow_amt - reimb_amt
                db.add(Notification(
                    user_id=borrowing.user_id,
                    title="借款部分冲销提醒",
                    message=f"您的借款「{borrowing.title}」（借款金额 ¥{borrow_amt:.2f}）已被报销单 #{reimb.id} 部分冲销 ¥{reimb_amt:.2f}，尚有 ¥{shortfall:.2f} 未冲销，请关注。",
                    entity_type="borrowing",
                    entity_id=borrowing.id,
                ))
            else:
                # 等额冲销，正常通知
                db.add(Notification(
                    user_id=borrowing.user_id,
                    title="借款已冲销",
                    message=f"您的借款「{borrowing.title}」¥{borrow_amt:.2f} 已被报销单 #{reimb.id} 全额冲销，冲销金额 ¥{reimb_amt:.2f}",
                    entity_type="borrowing",
                    entity_id=borrowing.id,
                ))

    await db.commit()
    await db.refresh(reimb)

    return {"message": "已确认打款，报销单完成", "reimbursement_id": reimb_id, "payment": payment_result}


@router.get("/{reimb_id}/timeline")
async def get_reimbursement_timeline(
    reimb_id: int,
    db: AsyncSession = Depends(get_db),
):
    """获取报销单的资金追踪时间轴。"""
    # 1. 查报销单
    query = select(Reimbursement).where(Reimbursement.id == reimb_id)
    result = await db.execute(query)
    reimb = result.scalar_one_or_none()
    if not reimb:
        raise HTTPException(status_code=404, detail="报销单不存在")

    timeline = []

    # 2. 节点 1：提交报销
    timeline.append({
        "time": reimb.created_at.isoformat() if reimb.created_at else None,
        "status": "done",
        "title": "提交报销单",
        "description": f"报销事由：{reimb.title} | 金额：¥{float(reimb.total_amount or 0):.2f}",
    })

    # 3. 节点 2：AI 审查（如果有）
    if reimb.ai_risk_level:
        import json as _json
        risk_label = "低风险"
        status_icon = "done"
        if reimb.ai_risk_level and ("高" in str(reimb.ai_risk_level) or "危" in str(reimb.ai_risk_level)):
            risk_label = "高风险"
            status_icon = "error"

        # 从 JSON 中提取简洁摘要
        desc = "暂无审查意见"
        if reimb.ai_reason:
            try:
                ai_obj = _json.loads(reimb.ai_reason) if isinstance(reimb.ai_reason, str) else reimb.ai_reason
                parts = []
                if ai_obj.get("compliance_status"):
                    parts.append(ai_obj["compliance_status"])
                if ai_obj.get("reason"):
                    parts.append(ai_obj["reason"])
                desc = " · ".join(parts) if parts else str(reimb.ai_reason)[:120]
            except Exception:
                desc = str(reimb.ai_reason)[:120]

        timeline.append({
            "time": reimb.updated_at.isoformat() if reimb.updated_at else None,
            "status": status_icon,
            "title": f"AI 探针扫描 — {risk_label}",
            "description": desc,
        })

    # 4. 从审计日志中提取关键事件
    audit_query = select(AuditLog).where(
        AuditLog.entity_type == "reimbursement",
        AuditLog.entity_id == reimb_id,
    ).order_by(AuditLog.created_at.asc())
    audit_result = await db.execute(audit_query)
    audit_logs = audit_result.scalars().all()

    for log in audit_logs:
        if log.action == "approve":
            timeline.append({
                "time": log.created_at.isoformat() if log.created_at else None,
                "status": "done",
                "title": "财务审批通过",
                "description": log.details or "报销单已审批",
            })
        elif log.action == "reject":
            timeline.append({
                "time": log.created_at.isoformat() if log.created_at else None,
                "status": "error",
                "title": "审批驳回",
                "description": log.details or "报销单已被驳回",
            })

    # 5. 根据当前状态补充节点
    if reimb.status == ReimbursementStatus.SUBMITTED and not reimb.ai_risk_level:
        timeline.append({
            "time": None,
            "status": "processing",
            "title": "等待 AI 探针扫描",
            "description": "系统将自动进行合规审查",
        })
    elif reimb.status == ReimbursementStatus.SUBMITTED and reimb.ai_risk_level:
        timeline.append({
            "time": None,
            "status": "processing",
            "title": "等待财务总监审批",
            "description": f"审批人：{reimb.reviewer or 'admin（财务总监）'}",
        })
    elif reimb.status == ReimbursementStatus.APPROVED:
        timeline.append({
            "time": None,
            "status": "pending",
            "title": "预计打款到账",
            "description": "审批已通过，等待出纳打款",
        })
    elif reimb.status == ReimbursementStatus.COMPLETED:
        payment_desc = f"报销款 ¥{float(reimb.total_amount or 0):.2f} 已打入收款账户"
        if reimb.payment_transaction_id:
            payment_desc += f"，流水号 {reimb.payment_transaction_id}"
        if reimb.payment_bank:
            payment_desc += f"（{reimb.payment_bank}）"
        timeline.append({
            "time": reimb.payment_time.isoformat() if reimb.payment_time else (reimb.updated_at.isoformat() if reimb.updated_at else None),
            "status": "done",
            "title": "银企直联打款到账",
            "description": payment_desc,
        })
    elif reimb.status == ReimbursementStatus.REJECTED:
        timeline.append({
            "time": None,
            "status": "error",
            "title": "已被驳回",
            "description": reimb.reject_reason or "报销单被驳回，关联发票已释放",
        })

    return {"timeline": timeline, "reimbursement_id": reimb_id}


@router.get("/dashboard/stats")
async def get_dashboard_stats(db: AsyncSession = Depends(get_db)):
    """获取大屏的【全真】统计图表数据 (发票级细粒度拆分)"""
    # 已报销的发票总数 + 已报销总金额
    reimbursed_invoice_count = await db.scalar(
        select(func.count(Invoice.id)).where(Invoice.status == InvoiceStatus.REIMBURSED)
    ) or 0
    total_reimbursed_amount = await db.scalar(
        select(func.coalesce(func.sum(Reimbursement.total_amount), 0)).where(
            Reimbursement.status.in_([ReimbursementStatus.APPROVED, ReimbursementStatus.COMPLETED])
        )
    ) or 0

    query = select(Reimbursement).options(
        selectinload(Reimbursement.invoices),
        selectinload(Reimbursement.submitter_user),
    )
    result = await db.execute(query)
    reimbs = result.scalars().all()

    trend_dict = {}
    pie_dict = {}
    ai_reject_count = 0

    for r in reimbs:
        dept = r.project_code or '通用部门'

        # ==========================================
        # 1. 柱状图真实数据：【细化到发票级别】进行打散统计
        # ==========================================
        if r.invoices:
            # 如果报销单底下有发票，就一张张遍历，分别计算月份和金额
            for inv in r.invoices:
                # 拿发票自己的时间，如果没有，降级用报销单的创建时间
                month = inv.issue_date.strftime('%Y-%m') if inv.issue_date else (
                    r.created_at.strftime('%Y-%m') if r.created_at else "2026-05")
                # 拿发票自己的金额 (确保转换成 float 进行累加)
                inv_amount = float(inv.total_with_tax or 0)

                trend_key = f"{month}_{dept}"
                if trend_key not in trend_dict:
                    trend_dict[trend_key] = {"month": month, "type": dept, "value": 0}

                # 精准累加这单张发票的金额
                trend_dict[trend_key]["value"] += inv_amount
        else:
            # 防御性编程：如果报销单刚建好，还没绑发票，就用报销单总金额和创建时间
            month = r.created_at.strftime('%Y-%m') if r.created_at else "2026-05"
            amount = float(r.total_amount or 0)
            trend_key = f"{month}_{dept}"
            if trend_key not in trend_dict:
                trend_dict[trend_key] = {"month": month, "type": dept, "value": 0}
            trend_dict[trend_key]["value"] += amount

        # ==========================================
        # 2. 饼图真实数据：按报销单的 AI 风险等级分组 (报销单级别)
        # ==========================================
        risk = getattr(r, 'ai_risk_level', None)
        if not risk:
            risk = "未经AI审查"

        if risk not in pie_dict:
            pie_dict[risk] = {"type": risk, "value": 0}

        # 饼图统计的是“单数”，所以每次 +1
        pie_dict[risk]["value"] += 1

        # 3. 真实统计高危拦截单量
        if risk in ["高", "高风险", "不合规", "高危"]:
            ai_reject_count += 1

    # 4. 预算使用率数据
    budget_data = []
    projects = (await db.execute(select(Project))).scalars().all()
    for p in projects:
        used = await db.scalar(
            select(func.coalesce(func.sum(Reimbursement.total_amount), 0)).where(
                Reimbursement.project_code == p.project_code,
                Reimbursement.status.in_([ReimbursementStatus.SUBMITTED, ReimbursementStatus.APPROVED, ReimbursementStatus.COMPLETED]),
            )
        ) or 0
        budget_data.append({
            "project_code": p.project_code,
            "project_name": p.project_name,
            "budget": float(p.budget),
            "used": float(used),
            "remaining": float(p.budget) - float(used),
            "usage_rate": round(float(used) / float(p.budget) * 100, 1) if float(p.budget) > 0 else 0,
        })

    # 5. 审批通过率（已通过+已打款 / 排除草稿和驳回的）
    total_reimbs = len(reimbs)
    approved_count = sum(1 for r in reimbs if r.status in [ReimbursementStatus.APPROVED, ReimbursementStatus.COMPLETED])
    decided_count = sum(1 for r in reimbs if r.status not in [ReimbursementStatus.DRAFT, ReimbursementStatus.SUBMITTED])
    approval_rate = round(approved_count / decided_count * 100, 1) if decided_count > 0 else 0

    # 6. 最近 10 条待审批
    pending_list = []
    for r in reimbs:
        if r.status == ReimbursementStatus.SUBMITTED:
            pending_list.append({
                "id": r.id,
                "title": r.title,
                "submitter": r.submitter_name or r.submitter or "-",
                "amount": float(r.total_amount or 0),
                "created_at": r.created_at.isoformat() if r.created_at else "",
            })
    pending_list.sort(key=lambda x: x["created_at"], reverse=True)
    pending_list = pending_list[:10]

    return {
        "trendData": list(trend_dict.values()),
        "pieData": list(pie_dict.values()),
        "aiRejectCount": ai_reject_count,
        "budgetData": budget_data,
        "approvalRate": approval_rate,
        "approvedCount": approved_count,
        "totalReimbCount": total_reimbs,
        "pendingList": pending_list,
        "reimbursedInvoiceCount": reimbursed_invoice_count,
        "totalReimbursedAmount": float(total_reimbursed_amount),
    }