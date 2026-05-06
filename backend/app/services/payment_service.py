"""模拟银企直联打款服务 —— Mock Bank-Enterprise Integration."""
import random
import time
import uuid
from datetime import datetime, timedelta
from decimal import Decimal


def mock_bank_transfer(reimbursement, bank_card) -> dict:
    """模拟银企直联打款，生成交易凭证。

    Args:
        reimbursement: Reimbursement ORM 对象
        bank_card: BankCard ORM 对象（收款卡）
    """
    # 模拟银行处理延迟（500ms~1.5s随机）
    time.sleep(random.uniform(0.5, 1.5))

    now = datetime.utcnow()
    tx_id = f"TRX-{now.strftime('%Y%m%d')}-{random.randint(100000000, 999999999)}"
    batch_no = f"BAT{now.strftime('%Y%m%d%H%M%S')}"

    # 脱敏卡号
    def mask_card(card_num: str) -> str:
        if len(card_num) <= 4:
            return "****" + card_num[-4:]
        return card_num[:4] + "****" + card_num[-4:]

    # 模拟到账时间（2小时内）
    arrival_time = now + timedelta(minutes=random.randint(30, 120))

    return {
        "transaction_id": tx_id,
        "batch_no": batch_no,
        "amount": float(reimbursement.total_amount or 0),
        "from_bank": "中国工商银行北京分行（企业账户）",
        "from_account": mask_card("6222020200123456789"),
        "to_bank": bank_card.bank_name if bank_card else "未知银行",
        "to_account": bank_card.card_number if bank_card else "****",
        "payee_name": bank_card.account_name if bank_card else "未知",
        "transfer_time": now,                           # datetime 对象，直接写入数据库
        "transfer_time_str": now.isoformat(),           # 字符串，前端展示用
        "estimated_arrival": arrival_time.isoformat(),
        "status": "SUCCESS",
        "message": f"交易成功，预计 {arrival_time.strftime('%H:%M')} 前到账",
    }
