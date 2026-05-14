"""双引擎字段提取精度评估脚本

在有 ground_truth 标注的发票上，对比 OCR / LLM / 融合 三种策略的准确率。

用法:
    cd backend
    python eval_accuracy.py

输出:
    1. 逐字段准确率对比表
    2. 交叉验证分析：OCR与LLM一致/不一致时的准确率
    3. 人工复核节省率

依赖: psycopg2-binary (已在 requirements.txt)
"""

import os
import sys
from collections import defaultdict

# ── 从 .env 或环境变量读取数据库连接 ──
from dotenv import load_dotenv
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/invoice_db")


def get_connection():
    import psycopg2
    url = DATABASE_URL
    # postgresql+asyncpg://user:pass@host:port/db → postgresql://user:pass@host:port/db
    url = url.replace("+asyncpg", "")
    return psycopg2.connect(url)


# ── 字段定义 ──
# Must match OcrResult / LlmResult column names
COMPARABLE_FIELDS = [
    'invoice_number',
    'issue_date',
    'buyer_name',
    'buyer_tax_id',
    'seller_name',
    'seller_tax_id',
    'total_with_tax',
    'amount',
    'tax_amount',
]

NUMERIC_FIELDS = {'total_with_tax', 'amount', 'tax_amount'}
DATE_FIELDS = {'issue_date'}

FIELD_LABELS = {
    'invoice_number': '发票号码',
    'issue_date': '开票日期',
    'buyer_name': '购买方名称',
    'buyer_tax_id': '购买方纳税人识别号',
    'seller_name': '销售方名称',
    'seller_tax_id': '销售方纳税人识别号',
    'total_with_tax': '价税合计',
    'amount': '总金额',
    'tax_amount': '总税额',
}


def normalize_value(value, field_name: str) -> str:
    """Normalize a field value for comparison."""
    if value is None:
        return ""
    s = str(value).strip()
    if field_name in NUMERIC_FIELDS:
        # Remove currency symbols and commas
        s = s.replace('¥', '').replace('￥', '').replace(',', '').replace(' ', '')
        # Try to parse as float and format consistently
        try:
            return f"{float(s):.2f}"
        except ValueError:
            return s
    if field_name in DATE_FIELDS:
        # Normalize date format
        s = s.replace('/', '-').replace('.', '-')
        return s
    return s


def values_equal(v1: str, v2: str, field_name: str) -> bool:
    """Check if two normalized values are equal."""
    n1 = normalize_value(v1, field_name)
    n2 = normalize_value(v2, field_name)
    if not n1 and not n2:
        return True
    if not n1 or not n2:
        return False

    if field_name in NUMERIC_FIELDS:
        try:
            num1 = float(n1)
            num2 = float(n2)
            if num2 == 0:
                return num1 == 0
            return abs(num1 - num2) / abs(num2) < 0.01  # 1% tolerance
        except ValueError:
            return n1 == n2
    return n1 == n2


def main():
    print("=" * 80)
    print("  双引擎字段提取精度评估")
    print("=" * 80)

    conn = get_connection()
    cur = conn.cursor()

    # ── 1. 加载有 ground_truth 的发票 ──
    cur.execute("""
        SELECT id, file_name, ground_truth
        FROM invoices
        WHERE ground_truth IS NOT NULL
        ORDER BY id
    """)
    gt_rows = cur.fetchall()

    if not gt_rows:
        print("\n⚠️  没有找到 ground_truth 标注数据。")
        print("   请在发票详情页点击「设为真值」对至少1张发票进行人工标注。\n")
        conn.close()
        return

    print(f"\n  已标注发票数: {len(gt_rows)}\n")

    # ── 2. 逐张发票逐字段评估 ──
    # per-field accumulators: field -> {ocr_correct, llm_correct, fusion_correct, total}
    field_stats = defaultdict(lambda: {'ocr': 0, 'llm': 0, 'fusion': 0, 'total': 0})

    # Cross-validation accumulators
    agree_stats = {'ocr_llm_agree': 0, 'agree_both_correct': 0, 'agree_both_wrong': 0}
    disagree_stats = {'ocr_llm_disagree': 0, 'ocr_correct': 0, 'llm_correct': 0, 'neither_correct': 0}

    overall = {'ocr_correct': 0, 'llm_correct': 0, 'fusion_correct': 0, 'total': 0}

    for invoice_id, file_name, gt_json in gt_rows:
        gt = gt_json if isinstance(gt_json, dict) else {}

        # Get OCR result
        cur.execute("""
            SELECT invoice_number, issue_date, buyer_name, buyer_tax_id,
                   seller_name, seller_tax_id, total_with_tax, amount, tax_amount
            FROM ocr_results WHERE invoice_id = %s
        """, (invoice_id,))
        ocr_row = cur.fetchone()

        # Get LLM result
        cur.execute("""
            SELECT invoice_number, issue_date, buyer_name, buyer_tax_id,
                   seller_name, seller_tax_id, total_with_tax, amount, tax_amount
            FROM llm_results WHERE invoice_id = %s
        """, (invoice_id,))
        llm_row = cur.fetchone()

        # Get ParsingDiffs (fusion result)
        cur.execute("""
            SELECT field_name, final_value FROM parsing_diffs
            WHERE invoice_id = %s
        """, (invoice_id,))
        diff_rows = cur.fetchall()
        fusion_map = {row[0]: row[1] for row in diff_rows}

        for i, field in enumerate(COMPARABLE_FIELDS):
            gt_val = normalize_value(gt.get(field), field)
            if not gt_val:
                continue  # skip fields not annotated

            ocr_val = normalize_value(ocr_row[i] if ocr_row else None, field)
            llm_val = normalize_value(llm_row[i] if llm_row else None, field)
            fusion_val = normalize_value(fusion_map.get(field), field)

            ocr_ok = values_equal(ocr_val, gt_val, field)
            llm_ok = values_equal(llm_val, gt_val, field)
            fusion_ok = values_equal(fusion_val, gt_val, field)

            field_stats[field]['ocr'] += int(ocr_ok)
            field_stats[field]['llm'] += int(llm_ok)
            field_stats[field]['fusion'] += int(fusion_ok)
            field_stats[field]['total'] += 1

            overall['ocr_correct'] += int(ocr_ok)
            overall['llm_correct'] += int(llm_ok)
            overall['fusion_correct'] += int(fusion_ok)
            overall['total'] += 1

            # Cross-validation: OCR vs LLM agreement
            ocr_has = bool(ocr_val)
            llm_has = bool(llm_val)

            if ocr_has and llm_has:
                if ocr_val == llm_val:
                    agree_stats['ocr_llm_agree'] += 1
                    if ocr_ok and llm_ok:
                        agree_stats['agree_both_correct'] += 1
                    elif not ocr_ok and not llm_ok:
                        agree_stats['agree_both_wrong'] += 1
                else:
                    disagree_stats['ocr_llm_disagree'] += 1
                    if ocr_ok:
                        disagree_stats['ocr_correct'] += 1
                    if llm_ok:
                        disagree_stats['llm_correct'] += 1
                    if not ocr_ok and not llm_ok:
                        disagree_stats['neither_correct'] += 1

    # ── 3. 输出逐字段准确率表 ──
    print("-" * 80)
    print(f"  {'字段':<16} {'OCR准确率':>10} {'LLM准确率':>10} {'融合准确率':>10} {'样本数':>8}")
    print("-" * 80)

    for field in COMPARABLE_FIELDS:
        st = field_stats[field]
        if st['total'] == 0:
            continue
        label = FIELD_LABELS.get(field, field)
        print(f"  {label:<16} {st['ocr']/st['total']:>9.1%}  {st['llm']/st['total']:>9.1%}  {st['fusion']/st['total']:>9.1%}  {st['total']:>6}")
    print("-" * 80)
    print(f"  {'总计':<16} {overall['ocr_correct']/overall['total']:>9.1%}  {overall['llm_correct']/overall['total']:>9.1%}  {overall['fusion_correct']/overall['total']:>9.1%}  {overall['total']:>6}")
    print("=" * 80)

    # ── 4. 交叉验证分析 ──
    print()
    print("-" * 60)
    print("  交叉验证分析")
    print("-" * 60)

    agree = agree_stats['ocr_llm_agree']
    disagree = disagree_stats['ocr_llm_disagree']
    total_pairs = agree + disagree

    if total_pairs > 0:
        agree_rate = agree / total_pairs
        print(f"  OCR与LLM一致的比例:      {agree_rate:.1%} ({agree}/{total_pairs})")
        if agree > 0:
            print(f"    一致时两者都正确:      {agree_stats['agree_both_correct']/agree:.1%} ({agree_stats['agree_both_correct']}/{agree})")
            print(f"    一致时两者都错:        {agree_stats['agree_both_wrong']/agree:.1%} ({agree_stats['agree_both_wrong']}/{agree})")
        print(f"  OCR与LLM不一致的比例:    {disagree/total_pairs:.1%} ({disagree}/{total_pairs})")
        if disagree > 0:
            print(f"    冲突时OCR正确:         {disagree_stats['ocr_correct']/disagree:.1%} ({disagree_stats['ocr_correct']}/{disagree})")
            print(f"    冲突时LLM正确:         {disagree_stats['llm_correct']/disagree:.1%} ({disagree_stats['llm_correct']}/{disagree})")
            print(f"    冲突时都错:            {disagree_stats['neither_correct']/disagree:.1%} ({disagree_stats['neither_correct']}/{disagree})")
    print("-" * 60)

    # ── 5. 人工复核节省率 ──
    # 一致且都正确的字段 → 可免检
    if total_pairs > 0:
        auto_pass = agree_stats['agree_both_correct']
        need_review = total_pairs - auto_pass
        print(f"\n  人工复核节省率: {auto_pass/total_pairs:.1%}")
        print(f"    - 可自动通过（一致且正确）: {auto_pass}/{total_pairs}")
        print(f"    - 需人工复核（冲突或一致但错）: {need_review}/{total_pairs}")
        print("=" * 80)

    conn.close()


if __name__ == '__main__':
    main()
