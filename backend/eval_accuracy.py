"""双引擎字段提取精度评估脚本。

口径与前端精度评估页保持一致：
1. OCR 准确率
2. LLM 准确率
3. 二选一命中率：OCR/LLM 候选中至少一方命中真值
4. 自动直出正确率：系统无需人工介入即可直接通过且结果正确
5. 最终确认正确率：用户/管理员完成选择或修正后的最终结果正确率

用法：
    cd backend
    python eval_accuracy.py
"""

import os
from collections import defaultdict

from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/invoice_db")
AUTO_PASS_THRESHOLD = 0.80

COMPARABLE_FIELDS = [
    "invoice_number",
    "issue_date",
    "buyer_name",
    "buyer_tax_id",
    "seller_name",
    "seller_tax_id",
    "total_with_tax",
    "amount",
    "tax_amount",
]

NUMERIC_FIELDS = {"total_with_tax", "amount", "tax_amount"}
FIELD_LABELS = {
    "invoice_number": "发票号码",
    "issue_date": "开票日期",
    "buyer_name": "购买方名称",
    "buyer_tax_id": "购买方纳税人识别号",
    "seller_name": "销售方名称",
    "seller_tax_id": "销售方纳税人识别号",
    "total_with_tax": "价税合计",
    "amount": "总金额",
    "tax_amount": "总税额",
}


def get_connection():
    import psycopg2

    return psycopg2.connect(DATABASE_URL.replace("+asyncpg", ""))


def normalize_value(value, field_name: str) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if field_name in NUMERIC_FIELDS:
        text = text.replace("¥", "").replace("￥", "").replace(",", "").replace(" ", "")
        try:
            return f"{float(text):.2f}"
        except ValueError:
            return text
    if field_name == "issue_date":
        return text.replace("/", "-").replace(".", "-")
    return text


def values_equal(value1: str, value2: str, field_name: str) -> bool:
    left = normalize_value(value1, field_name)
    right = normalize_value(value2, field_name)

    if not left and not right:
        return True
    if not left or not right:
        return False

    if field_name in NUMERIC_FIELDS:
        try:
            num1 = float(left)
            num2 = float(right)
            if num2 == 0:
                return num1 == 0
            return abs(num1 - num2) / abs(num2) < 0.01
        except ValueError:
            return left == right

    return left == right


def has_conflict(field_name: str, ocr_value: str, llm_value: str) -> bool:
    return bool(ocr_value and llm_value and not values_equal(ocr_value, llm_value, field_name))


def pick_auto_value(field_name: str, ocr_value: str, llm_value: str) -> str:
    if has_conflict(field_name, ocr_value, llm_value):
        return ""
    return ocr_value or llm_value or ""


def main():
    print("=" * 96)
    print("  双引擎字段提取精度评估")
    print("=" * 96)

    conn = get_connection()
    cur = conn.cursor()

    cur.execute(
        """
        SELECT id, ground_truth, invoice_number, issue_date, buyer_name, buyer_tax_id,
               seller_name, seller_tax_id, total_with_tax, amount, tax_amount
        FROM invoices
        WHERE ground_truth IS NOT NULL
        ORDER BY id
        """
    )
    invoice_rows = cur.fetchall()

    if not invoice_rows:
        print("\n暂无 ground_truth 标注数据。")
        conn.close()
        return

    print(f"\n已标注发票数: {len(invoice_rows)}\n")

    field_stats = defaultdict(
        lambda: {
            "ocr": 0,
            "llm": 0,
            "candidate_hit": 0,
            "auto_pass": 0,
            "final": 0,
            "total": 0,
        }
    )
    overall = {"ocr": 0, "llm": 0, "candidate_hit": 0, "auto_pass": 0, "final": 0, "total": 0}
    workflow = {"auto_pass_count": 0, "manual_needed_count": 0}
    cross = {
        "agree": 0,
        "agree_both_correct": 0,
        "agree_both_wrong": 0,
        "disagree": 0,
        "disagree_ocr_correct": 0,
        "disagree_llm_correct": 0,
        "disagree_candidate_hit": 0,
        "disagree_neither": 0,
    }

    for row in invoice_rows:
        (
            invoice_id,
            ground_truth,
            invoice_number,
            issue_date,
            buyer_name,
            buyer_tax_id,
            seller_name,
            seller_tax_id,
            total_with_tax,
            amount,
            tax_amount,
        ) = row

        gt = ground_truth if isinstance(ground_truth, dict) else {}
        final_invoice_map = {
            "invoice_number": invoice_number,
            "issue_date": issue_date,
            "buyer_name": buyer_name,
            "buyer_tax_id": buyer_tax_id,
            "seller_name": seller_name,
            "seller_tax_id": seller_tax_id,
            "total_with_tax": total_with_tax,
            "amount": amount,
            "tax_amount": tax_amount,
        }

        cur.execute(
            """
            SELECT invoice_number, issue_date, buyer_name, buyer_tax_id,
                   seller_name, seller_tax_id, total_with_tax, amount, tax_amount
            FROM ocr_results
            WHERE invoice_id = %s
            """,
            (invoice_id,),
        )
        ocr_row = cur.fetchone()

        cur.execute(
            """
            SELECT invoice_number, issue_date, buyer_name, buyer_tax_id,
                   seller_name, seller_tax_id, total_with_tax, amount, tax_amount
            FROM llm_results
            WHERE invoice_id = %s
            """,
            (invoice_id,),
        )
        llm_row = cur.fetchone()

        cur.execute(
            """
            SELECT field_name, final_value, confidence
            FROM parsing_diffs
            WHERE invoice_id = %s
            """,
            (invoice_id,),
        )
        diff_rows = cur.fetchall()
        diff_map = {field_name: {"final_value": final_value, "confidence": confidence} for field_name, final_value, confidence in diff_rows}

        for index, field_name in enumerate(COMPARABLE_FIELDS):
            gt_value = normalize_value(gt.get(field_name), field_name)
            if not gt_value:
                continue

            ocr_value = normalize_value(ocr_row[index] if ocr_row else None, field_name)
            llm_value = normalize_value(llm_row[index] if llm_row else None, field_name)

            diff = diff_map.get(field_name, {})
            final_value = normalize_value(diff.get("final_value", final_invoice_map.get(field_name)), field_name)
            confidence = float(diff["confidence"]) if diff.get("confidence") is not None else None

            ocr_ok = values_equal(ocr_value, gt_value, field_name)
            llm_ok = values_equal(llm_value, gt_value, field_name)
            candidate_hit = ocr_ok or llm_ok

            auto_value = pick_auto_value(field_name, ocr_value, llm_value)
            auto_pass = bool(auto_value) and not has_conflict(field_name, ocr_value, llm_value)
            if auto_pass and confidence is not None and confidence < AUTO_PASS_THRESHOLD:
                auto_pass = False
            auto_ok = auto_pass and values_equal(auto_value, gt_value, field_name)

            final_ok = values_equal(final_value, gt_value, field_name)

            field_stats[field_name]["ocr"] += int(ocr_ok)
            field_stats[field_name]["llm"] += int(llm_ok)
            field_stats[field_name]["candidate_hit"] += int(candidate_hit)
            field_stats[field_name]["auto_pass"] += int(auto_ok)
            field_stats[field_name]["final"] += int(final_ok)
            field_stats[field_name]["total"] += 1

            overall["ocr"] += int(ocr_ok)
            overall["llm"] += int(llm_ok)
            overall["candidate_hit"] += int(candidate_hit)
            overall["auto_pass"] += int(auto_ok)
            overall["final"] += int(final_ok)
            overall["total"] += 1

            if auto_pass:
                workflow["auto_pass_count"] += 1
            else:
                workflow["manual_needed_count"] += 1

            if ocr_value and llm_value:
                if values_equal(ocr_value, llm_value, field_name):
                    cross["agree"] += 1
                    if ocr_ok and llm_ok:
                        cross["agree_both_correct"] += 1
                    elif not ocr_ok and not llm_ok:
                        cross["agree_both_wrong"] += 1
                else:
                    cross["disagree"] += 1
                    cross["disagree_candidate_hit"] += int(candidate_hit)
                    if ocr_ok:
                        cross["disagree_ocr_correct"] += 1
                    if llm_ok:
                        cross["disagree_llm_correct"] += 1
                    if not candidate_hit:
                        cross["disagree_neither"] += 1

    print("-" * 96)
    print(f"  {'字段':<18} {'OCR':>8} {'LLM':>8} {'二选一':>8} {'自动直出':>10} {'最终确认':>10} {'样本':>6}")
    print("-" * 96)

    for field_name in COMPARABLE_FIELDS:
        stats = field_stats[field_name]
        if stats["total"] == 0:
            continue
        label = FIELD_LABELS.get(field_name, field_name)
        total = stats["total"]
        print(
            f"  {label:<18} "
            f"{stats['ocr'] / total:>7.1%} "
            f"{stats['llm'] / total:>7.1%} "
            f"{stats['candidate_hit'] / total:>7.1%} "
            f"{stats['auto_pass'] / total:>9.1%} "
            f"{stats['final'] / total:>9.1%} "
            f"{total:>6}"
        )

    total_fields = overall["total"]
    print("-" * 96)
    print(
        f"  {'总计':<18} "
        f"{overall['ocr'] / total_fields:>7.1%} "
        f"{overall['llm'] / total_fields:>7.1%} "
        f"{overall['candidate_hit'] / total_fields:>7.1%} "
        f"{overall['auto_pass'] / total_fields:>9.1%} "
        f"{overall['final'] / total_fields:>9.1%} "
        f"{total_fields:>6}"
    )
    print("=" * 96)

    agree = cross["agree"]
    disagree = cross["disagree"]
    pairs = agree + disagree
    manual_gain_count = max(0, overall["final"] - overall["auto_pass"])

    print("\n冲突分析")
    print("-" * 60)
    if pairs:
        print(f"一致率:             {agree / pairs:.1%} ({agree}/{pairs})")
        print(f"冲突率:             {disagree / pairs:.1%} ({disagree}/{pairs})")
        if agree:
            print(f"一致且都正确:       {cross['agree_both_correct'] / agree:.1%} ({cross['agree_both_correct']}/{agree})")
            print(f"一致但都错误:       {cross['agree_both_wrong'] / agree:.1%} ({cross['agree_both_wrong']}/{agree})")
        if disagree:
            print(f"冲突时 OCR 正确:    {cross['disagree_ocr_correct'] / disagree:.1%} ({cross['disagree_ocr_correct']}/{disagree})")
            print(f"冲突时 LLM 正确:    {cross['disagree_llm_correct'] / disagree:.1%} ({cross['disagree_llm_correct']}/{disagree})")
            print(f"冲突时可二选一命中: {cross['disagree_candidate_hit'] / disagree:.1%} ({cross['disagree_candidate_hit']}/{disagree})")
            print(f"冲突时双方都错:     {cross['disagree_neither'] / disagree:.1%} ({cross['disagree_neither']}/{disagree})")
    else:
        print("暂无可比较的 OCR/LLM 配对字段。")

    print("\n审核价值")
    print("-" * 60)
    print(f"系统可自动通过占比: {workflow['auto_pass_count'] / total_fields:.1%} ({workflow['auto_pass_count']}/{total_fields})")
    print(f"需要人工处理字段:   {workflow['manual_needed_count']}/{total_fields}")
    print(f"人工补救新增正确:   {manual_gain_count}/{total_fields}")
    print("=" * 96)

    conn.close()


if __name__ == "__main__":
    main()
