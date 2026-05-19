"""
GM(1,1) 灰色预测 + Markov 残差修正 组合模型
纯 Python 实现，零外部依赖

论文参考：
  基于灰色-马尔可夫组合模型的科研经费消耗推演与提前干预机制研究

GM(1,1) 负责捕捉整体趋势（发展系数 a + 灰作用量 b）
Markov 负责修正残差波动（状态转移矩阵）
"""

import math
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.reimbursement import Reimbursement, ReimbursementStatus
from app.models.project import Project


def _month_start(dt: datetime) -> datetime:
    return datetime(dt.year, dt.month, 1)


def _add_months(dt: datetime, months: int) -> datetime:
    year = dt.year + (dt.month - 1 + months) // 12
    month = (dt.month - 1 + months) % 12 + 1
    return datetime(year, month, 1)


# ──────────────────────────────────────────────
#  GM(1,1) 核心算法
# ──────────────────────────────────────────────

def _level_ratio_test(data: list[float]) -> bool:
    """级比检验：判断数据是否适合 GM(1,1) 建模"""
    n = len(data)
    if n < 3:
        return False
    lower = math.exp(-2 / (n + 1))
    upper = math.exp(2 / (n + 1))
    for k in range(1, n):
        if data[k - 1] == 0:
            return False
        lam = data[k - 1] / data[k]
        if not (lower <= lam <= upper):
            return False
    return True


def _gm11_predict(data: list[float], predict_steps: int = 12) -> dict:
    """
    GM(1,1) 灰色预测

    Args:
        data: 原始序列（累计值，单调递增），长度 >= 3
        predict_steps: 向后预测的步数

    Returns:
        {
            "a": 发展系数,
            "b": 灰作用量,
            "fitted": [拟合值序列],
            "predicted": [未来预测值序列],
            "residuals": [残差序列],
            "avg_rel_error": 平均相对误差,
        }
    """
    n = len(data)
    x0 = data[:]  # 原始序列 X^(0)

    # 1-AGO 累加生成 X^(1)
    x1 = []
    s = 0.0
    for v in x0:
        s += v
        x1.append(s)

    # 紧邻均值生成 Z^(1)
    Z = []
    for k in range(1, n):
        Z.append(0.5 * (x1[k] + x1[k - 1]))

    # 构造 B 矩阵和 Y 向量
    # B = [[-z1, 1], [-z2, 1], ...]^T, Y = [x0[1], x0[2], ...]^T
    # 求解 [a, b]^T = (B^T·B)^(-1)·B^T·Y

    sum_z = sum(Z)
    sum_z2 = sum(z * z for z in Z)
    sum_y = sum(x0[1:])
    sum_zy = sum(z * y for z, y in zip(Z, x0[1:]))
    m = n - 1  # B 的行数

    # (B^T·B) = [[sum_z2, -sum_z], [-sum_z, m]]
    # (B^T·B)^(-1) = 1/(m*sum_z2 - sum_z^2) * [[m, sum_z], [sum_z, sum_z2]]
    det = m * sum_z2 - sum_z * sum_z
    if abs(det) < 1e-12:
        # 矩阵奇异，回退到简单线性外推
        raise ValueError("GM(1,1) 矩阵不可逆，数据可能不适合灰色预测")

    a = (m * (-sum_zy) + sum_z * sum_y) / det
    b = (sum_z * (-sum_zy) + sum_z2 * sum_y) / det

    if abs(a) < 1e-12:
        raise ValueError("发展系数 a 接近于 0，数据无明显趋势")

    # 时间响应式: x̂^(1)(k+1) = (x0[0] - b/a) * e^(-a*k) + b/a
    C = x0[0] - b / a

    # 拟合值（对历史数据）
    fitted_x1 = []
    fitted_x0 = [x0[0]]  # 第一个点直接取原始值
    for k in range(n):
        val = C * math.exp(-a * k) + b / a
        fitted_x1.append(val)
        if k > 0:
            fitted_x0.append(val - fitted_x1[k - 1])

    # 残差
    residuals = [x0[k] - fitted_x0[k] for k in range(n)]

    # 平均相对误差
    rel_errors = [abs(residuals[k]) / x0[k] * 100 if x0[k] > 0 else 0 for k in range(n)]
    avg_rel_error = sum(rel_errors) / n

    # 预测未来值
    predicted = []
    for k in range(n, n + predict_steps):
        val_next = C * math.exp(-a * k) + b / a
        val_prev = C * math.exp(-a * (k - 1)) + b / a
        predicted.append(val_next - val_prev)

    return {
        "a": a,
        "b": b,
        "C": C,
        "fitted": fitted_x0,
        "predicted": predicted,
        "residuals": residuals,
        "avg_rel_error": avg_rel_error,
    }


# ──────────────────────────────────────────────
#  Markov 残差修正
# ──────────────────────────────────────────────

def _build_markov_correction(residuals: list[float], n_states: int = 3) -> dict:
    """
    基于残差序列构建 Markov 状态转移矩阵

    Args:
        residuals: GM(1,1) 的残差序列
        n_states: 状态划分数（默认 3: 负偏/正常/正偏）

    Returns:
        {
            "states": [(lower, upper, midpoint), ...],
            "transition_matrix": [[p_ij], ...],  # 状态转移概率矩阵
            "current_state": int,  # 当前所处的状态索引
            "state_sequence": [int, ...],  # 历史状态序列
        }
    """
    n = len(residuals)
    if n < 3:
        return {"states": [], "transition_matrix": [], "current_state": 0, "state_sequence": []}

    eps_min = min(residuals)
    eps_max = max(residuals)
    eps_range = eps_max - eps_min

    if eps_range < 1e-8:
        # 残差几乎为 0，Markov 修正无意义
        span = 1.0
    else:
        span = eps_range

    # 等距划分状态区间
    state_width = span / n_states
    states = []
    for i in range(n_states):
        lower = eps_min + i * state_width
        upper = eps_min + (i + 1) * state_width
        midpoint = (lower + upper) / 2
        states.append((lower, upper, midpoint))

    # 将每个残差划分到对应状态
    state_seq = []
    for eps in residuals:
        for i, (lo, hi, _) in enumerate(states):
            if i == n_states - 1:
                if lo <= eps <= hi or eps >= hi:
                    state_seq.append(i)
                    break
            else:
                if lo <= eps < hi:
                    state_seq.append(i)
                    break

    # 构建状态转移计数矩阵
    trans_count = [[0] * n_states for _ in range(n_states)]
    for t in range(len(state_seq) - 1):
        i, j = state_seq[t], state_seq[t + 1]
        trans_count[i][j] += 1

    # 归一化为概率矩阵
    trans_prob = []
    for i in range(n_states):
        row_sum = sum(trans_count[i])
        if row_sum > 0:
            trans_prob.append([c / row_sum for c in trans_count[i]])
        else:
            trans_prob.append([1.0 / n_states] * n_states)

    current_state = state_seq[-1] if state_seq else 0

    return {
        "states": states,
        "transition_matrix": trans_prob,
        "current_state": current_state,
        "state_sequence": state_seq,
    }


def _markov_adjust(predictions: list[float], markov: dict, steps: int) -> list[float]:
    """
    用 Markov 状态转移概率加权修正预测值

    对每一步预测，根据当前最可能转移到哪个状态，
    用该状态的残差中点作为修正量
    """
    if not markov.get("states"):
        return predictions

    states = markov["states"]
    trans_prob = markov["transition_matrix"]
    current = markov["current_state"]

    adjusted = []
    state = current
    for val in predictions:
        probs = trans_prob[state]
        correction = sum(prob * states[idx][2] for idx, prob in enumerate(probs))
        adjusted.append(val + correction)
        state = max(range(len(probs)), key=lambda i: probs[i])

    return adjusted


# ──────────────────────────────────────────────
#  业务层：预算耗尽预测
# ──────────────────────────────────────────────

async def predict_budget_exhaustion(
    db: AsyncSession,
    months_back: int = 6,
    predict_months: int = 18,
) -> list[dict]:
    """
    为所有项目生成预算耗尽预测

    Args:
        db: 数据库会话
        months_back: 回溯多少个月的历史数据（用于建模）
        predict_months: 向前预测多少个月

    Returns:
        [{project_code, project_name, budget, spent, remaining,
          daily_burn_rate, monthly_burn_rate,
          predicted_exhaustion_date, days_remaining,
          status, trend, r_squared,
          cumulative_data, prediction_line, gm11_quality}, ...]
    """
    projects = (await db.execute(select(Project))).scalars().all()

    predictions = []
    for p in projects:
        pred = await _predict_single_project(db, p, months_back, predict_months)
        predictions.append(pred)

    # 按紧迫度排序：critical > warning > normal > exhausted > insufficient_data
    urgency = {"critical": 0, "warning": 1, "normal": 2, "exhausted": 3, "insufficient_data": 4}
    predictions.sort(key=lambda x: urgency.get(x.get("status", "normal"), 99))

    return predictions


async def _predict_single_project(
    db: AsyncSession,
    project: Project,
    months_back: int,
    predict_months: int,
) -> dict:
    """对单个项目执行预测"""
    budget = float(project.budget or 0)
    project_code = project.project_code
    project_name = project.project_name

    base = {
        "project_code": project_code,
        "project_name": project_name,
        "budget": budget,
        "spent": 0.0,
        "remaining": budget,
        "daily_burn_rate": 0.0,
        "monthly_burn_rate": 0.0,
        "predicted_exhaustion_date": None,
        "days_remaining": None,
        "status": "normal",
        "trend": "stable",
        "r_squared": None,
        "gm11_quality": None,  # GM(1,1) 平均相对误差 (%)
        "cumulative_data": [],
        "prediction_line": [],
    }

    if budget <= 0:
        base["status"] = "insufficient_data"
        return base

    # 查询该项目的已报销记录，按时间排序
    cutoff = datetime.now() - timedelta(days=months_back * 31)
    result = await db.execute(
        select(Reimbursement)
        .where(
            Reimbursement.project_code == project_code,
            Reimbursement.status.in_([
                ReimbursementStatus.SUBMITTED,
                ReimbursementStatus.APPROVED,
                ReimbursementStatus.COMPLETED,
            ]),
        )
        .order_by(Reimbursement.created_at.asc())
    )
    reimbursements = result.scalars().all()

    if not reimbursements:
        base["status"] = "insufficient_data"
        return base

    # 构建 (date, cumulative_amount) 序列
    points: list[tuple[datetime, float]] = []
    cum = 0.0
    for r in reimbursements:
        cum += float(r.total_amount or 0)
        points.append((r.created_at or datetime.now(), cum))

    # 如果记录都集中在最近，也纳入早期月份（往前补零点可能不反映实际）
    # 实际做法：用全部可用记录

    spent = cum
    remaining = budget - spent
    base["spent"] = spent
    base["remaining"] = remaining

    # 如果已超预算
    if remaining <= 0:
        base["status"] = "exhausted"
        base["days_remaining"] = 0
        base["predicted_exhaustion_date"] = datetime.now().strftime("%Y-%m-%d")
        # 仍然构建 cumulative_data 供图表展示
        base["cumulative_data"] = [
            {"date": dt.strftime("%Y-%m-%d"), "amount": amt, "type": "actual"}
            for dt, amt in points
        ]
        return base

    n = len(points)
    if n < 3:
        # 数据点不足，用简单线性外推
        return _fallback_linear(points, budget, spent, remaining, base)

    # 提取累计值序列
    cum_values = [amt for _, amt in points]

    # ── GM(1,1) 预测 ──
    try:
        gm_result = _gm11_predict(cum_values, predict_steps=predict_months)
    except (ValueError, ZeroDivisionError):
        return _fallback_linear(points, budget, spent, remaining, base)

    # ── Markov 残差修正 ──
    residuals = gm_result["residuals"]
    markov = _build_markov_correction(residuals)
    if markov.get("states"):
        adjusted_predicted = _markov_adjust(gm_result["predicted"], markov, predict_months)
    else:
        adjusted_predicted = gm_result["predicted"]

    # 过滤掉负值预测增量（GM(1,1) 对小样本可能产生负增量）
    positive_predicted = [v for v in adjusted_predicted if v > 0]

    # ── 计算消耗率：模型值 + 历史均值双保险 ──
    if positive_predicted:
        model_monthly = sum(positive_predicted[:min(6, len(positive_predicted))]) / min(6, len(positive_predicted))
    else:
        model_monthly = 0.0

    # 历史简单平均消耗率（总支出 / 总天数）
    if len(points) >= 2:
        first_date, last_date = points[0][0], points[-1][0]
        total_days_span = (last_date - first_date).days
    else:
        total_days_span = 0

    if total_days_span > 0 and spent > 0:
        historical_daily = spent / total_days_span
        historical_monthly = historical_daily * 30.42
    else:
        historical_daily = 0.0
        historical_monthly = 0.0

    # 择优：模型合理就用模型，否则用历史均值兜底
    if model_monthly > 0 and model_monthly >= historical_monthly * 0.3:
        avg_monthly = model_monthly
    elif historical_monthly > 0:
        avg_monthly = historical_monthly
    else:
        avg_monthly = 0.0

    daily_burn = avg_monthly / 30.42 if avg_monthly > 0 else 0.0
    base["daily_burn_rate"] = round(daily_burn, 2)
    base["monthly_burn_rate"] = round(avg_monthly, 2)
    base["gm11_quality"] = round(gm_result["avg_rel_error"], 2)
    base["r_squared"] = round(gm_result.get("avg_rel_error", 0.0), 2)

    # ── 推演耗尽日期 ──
    exhaustion_date = None
    days_remaining = None
    pred_line = []

    if daily_burn <= 0.01:
        base["status"] = "normal"
        base["trend"] = "stable"
        base["days_remaining"] = 9999
        base["predicted_exhaustion_date"] = "短期内不会耗尽"
    else:
        cum_predicted = spent
        last_date = points[-1][0]
        found = False

        for i, inc in enumerate(adjusted_predicted):
            if inc <= 0:
                continue
            month_date = last_date + timedelta(days=30.42 * (i + 1))
            cum_predicted = spent + sum(adjusted_predicted[:i + 1])

            # 确保累计值单调递增
            prev_cum = spent + sum(adjusted_predicted[:i]) if i > 0 else spent
            display_cum = max(cum_predicted, prev_cum + 0.01)

            pred_line.append({
                "date": month_date.strftime("%Y-%m-%d"),
                "amount": round(display_cum, 2),
            })

            if not found and display_cum >= budget:
                exhaustion_date = month_date
                days_remaining = (exhaustion_date - datetime.now()).days
                found = True

        if not found and len(adjusted_predicted) > 0:
            # 在预测期内不会耗尽，估算
            if daily_burn > 0.001:
                total_days = int(remaining / daily_burn)
                exhaustion_date = datetime.now() + timedelta(days=total_days)
                days_remaining = total_days
            else:
                days_remaining = 9999

        base["days_remaining"] = days_remaining
        base["predicted_exhaustion_date"] = (
            exhaustion_date.strftime("%Y-%m-%d") if exhaustion_date else "短期内不会耗尽"
        )
        base["prediction_line"] = pred_line

        if days_remaining is not None:
            if days_remaining <= 0:
                base["status"] = "exhausted"
            elif days_remaining <= 30:
                base["status"] = "critical"
            elif days_remaining <= 90:
                base["status"] = "warning"
            else:
                base["status"] = "normal"

    # 趋势判断：看 GM(1,1) 的发展系数 a
    a = gm_result.get("a", 0)
    if a > 0.01:
        base["trend"] = "increasing"
    elif a < -0.01:
        base["trend"] = "decreasing"
    else:
        base["trend"] = "stable"

    # ── 构建前端图表数据 ──
    cum_data = []
    for dt, amt in points:
        cum_data.append({
            "date": dt.strftime("%Y-%m-%d"),
            "amount": round(amt, 2),
            "type": "actual",
        })

    # 在最后一个实际数据点后插入预测点
    if pred_line:
        last_actual = cum_data[-1]["amount"] if cum_data else spent
        for i, pred_point in enumerate(pred_line):
            pred_amount = pred_point["amount"]
            cum_data.append({
                "date": pred_point["date"],
                "amount": round(pred_amount, 2),
                "type": "predicted",
            })

    base["cumulative_data"] = cum_data

    return base


def _fallback_linear(
    points: list[tuple[datetime, float]],
    budget: float,
    spent: float,
    remaining: float,
    base: dict,
) -> dict:
    """数据点不足时，回退到简单线性回归"""
    n = len(points)
    if n < 2:
        base["status"] = "insufficient_data"
        base["cumulative_data"] = [
            {"date": dt.strftime("%Y-%m-%d"), "amount": amt, "type": "actual"}
            for dt, amt in points
        ]
        return base

    # 线性回归：x = 天数偏移, y = 累计支出
    x_vals = [(dt - points[0][0]).days for dt, _ in points]
    y_vals = [amt for _, amt in points]

    n_pts = len(x_vals)
    sum_x = sum(x_vals)
    sum_y = sum(y_vals)
    sum_xy = sum(x * y for x, y in zip(x_vals, y_vals))
    sum_x2 = sum(x * x for x in x_vals)

    denom = n_pts * sum_x2 - sum_x * sum_x
    if abs(denom) < 1e-12:
        slope = 0.0
    else:
        slope = (n_pts * sum_xy - sum_x * sum_y) / denom

    y_mean = sum_y / n_pts
    ss_res = sum((y - (slope * x + (sum_y - slope * sum_x) / n_pts)) ** 2 for x, y in zip(x_vals, y_vals))
    ss_tot = sum((y - y_mean) ** 2 for y in y_vals)
    r2 = 1 - (ss_res / ss_tot) if ss_tot > 0 else 0

    # 历史简单平均消耗率（兜底值）
    total_days_span = (points[-1][0] - points[0][0]).days if len(points) >= 2 else 0
    if total_days_span > 0 and spent > 0:
        historical_daily = spent / total_days_span
        historical_monthly = historical_daily * 30.42
    else:
        historical_daily = 0.0
        historical_monthly = 0.0

    # 线性回归合理就用它，否则用历史均值兜底
    if slope > 0.01:
        daily_burn = slope
    elif historical_daily > 0:
        daily_burn = historical_daily
    else:
        daily_burn = 0.001
    monthly_burn = daily_burn * 30.42

    base["daily_burn_rate"] = round(daily_burn, 2)
    base["monthly_burn_rate"] = round(monthly_burn, 2)
    base["r_squared"] = round(r2, 4)
    base["trend"] = "increasing" if slope > 0.01 else ("decreasing" if slope < -0.01 else "stable")

    if remaining <= 0:
        base["status"] = "exhausted"
        base["days_remaining"] = 0
        base["predicted_exhaustion_date"] = datetime.now().strftime("%Y-%m-%d")
    else:
        days = int(remaining / daily_burn) if daily_burn > 0 else 9999
        base["days_remaining"] = days
        if days <= 30:
            base["status"] = "critical"
        elif days <= 90:
            base["status"] = "warning"
        else:
            base["status"] = "normal"
        base["predicted_exhaustion_date"] = (datetime.now() + timedelta(days=days)).strftime("%Y-%m-%d") if days < 9999 else "短期内不会耗尽"

    # 构建 cumulative_data
    cum_data = [{"date": dt.strftime("%Y-%m-%d"), "amount": amt, "type": "actual"} for dt, amt in points]
    # 添加线性预测线
    if slope > 0 and remaining > 0 and points:
        last_dt, last_amt = points[-1]
        steps = 12
        pred_line = []
        for i in range(1, steps + 1):
            future_dt = last_dt + timedelta(days=30 * i)
            future_amt = last_amt + slope * 30 * i
            pred_line.append({
                "date": future_dt.strftime("%Y-%m-%d"),
                "amount": round(future_amt, 2),
            })
            cum_data.append({
                "date": future_dt.strftime("%Y-%m-%d"),
                "amount": round(future_amt, 2),
                "type": "predicted",
            })
        base["prediction_line"] = pred_line

    base["cumulative_data"] = cum_data
    return base


def _build_monthly_points_v2(
    reimbursements: list[Reimbursement],
    months_back: int,
) -> tuple[list[tuple[datetime, float]], list[float], float, float]:
    now = datetime.now()
    current_month = _month_start(now)
    window_start = _add_months(current_month, -(months_back - 1))
    month_keys = [_add_months(window_start, offset) for offset in range(months_back)]

    spent = 0.0
    prior_spent = 0.0
    monthly_spend_map = {month.strftime("%Y-%m"): 0.0 for month in month_keys}
    for reimbursement in reimbursements:
        amount = float(reimbursement.total_amount or 0)
        created_at = reimbursement.created_at or now
        spent += amount
        month_bucket = _month_start(created_at)
        if month_bucket < window_start:
            prior_spent += amount
            continue
        key = month_bucket.strftime("%Y-%m")
        if key in monthly_spend_map:
            monthly_spend_map[key] += amount

    points: list[tuple[datetime, float]] = []
    window_cumulative: list[float] = []
    running_total = prior_spent
    running_window = 0.0
    for month in month_keys:
        month_amount = monthly_spend_map.get(month.strftime("%Y-%m"), 0.0)
        running_total += month_amount
        running_window += month_amount
        points.append((month, running_total))
        window_cumulative.append(running_window)

    return points, window_cumulative, spent, sum(monthly_spend_map.values())


async def _predict_single_project(
    db: AsyncSession,
    project: Project,
    months_back: int,
    predict_months: int,
) -> dict:
    budget = float(project.budget or 0)
    project_code = project.project_code
    project_name = project.project_name

    base = {
        "project_code": project_code,
        "project_name": project_name,
        "budget": budget,
        "spent": 0.0,
        "remaining": budget,
        "daily_burn_rate": 0.0,
        "monthly_burn_rate": 0.0,
        "predicted_exhaustion_date": None,
        "days_remaining": None,
        "status": "normal",
        "trend": "stable",
        "r_squared": None,
        "gm11_quality": None,
        "model_type": "unknown",
        "model_label": "未建模",
        "data_granularity": "monthly_cumulative",
        "window_months": months_back,
        "prediction_note": "基于近月累计支出做趋势预警，耗尽日期仅供参考",
        "cumulative_data": [],
        "prediction_line": [],
    }

    if budget <= 0:
        base["status"] = "insufficient_data"
        return base

    result = await db.execute(
        select(Reimbursement)
        .where(
            Reimbursement.project_code == project_code,
            Reimbursement.status.in_([
                ReimbursementStatus.SUBMITTED,
                ReimbursementStatus.APPROVED,
                ReimbursementStatus.COMPLETED,
            ]),
        )
        .order_by(Reimbursement.created_at.asc())
    )
    reimbursements = result.scalars().all()
    if not reimbursements:
        base["status"] = "insufficient_data"
        return base

    points, window_cumulative, spent, recent_spent = _build_monthly_points_v2(reimbursements, months_back)
    remaining = budget - spent
    base["spent"] = spent
    base["remaining"] = remaining

    if remaining <= 0:
        base["status"] = "exhausted"
        base["days_remaining"] = 0
        base["predicted_exhaustion_date"] = datetime.now().strftime("%Y-%m-%d")
        base["cumulative_data"] = [
            {"date": dt.strftime("%Y-%m-%d"), "amount": round(amt, 2), "type": "actual"}
            for dt, amt in points
        ]
        return base

    model_points = [(dt, amt) for dt, amt in points]
    while len(model_points) > 1 and model_points[0][1] <= 0:
        model_points.pop(0)

    cum_values = [amt for _, amt in model_points]
    active_months = sum(1 for value in window_cumulative if value > 0)
    if len(cum_values) < 3 or active_months < 2 or not _level_ratio_test(cum_values):
        return _fallback_linear_v2(points, budget, spent, remaining, recent_spent, base)

    try:
        gm_result = _gm11_predict(cum_values, predict_steps=predict_months)
    except (ValueError, ZeroDivisionError):
        return _fallback_linear_v2(points, budget, spent, remaining, recent_spent, base)

    residuals = gm_result["residuals"]
    markov = _build_markov_correction(residuals)
    adjusted_predicted = (
        _markov_adjust(gm_result["predicted"], markov, predict_months)
        if markov.get("states")
        else gm_result["predicted"]
    )
    positive_predicted = [value for value in adjusted_predicted if value > 0]
    model_monthly = (
        sum(positive_predicted[:min(6, len(positive_predicted))]) / min(6, len(positive_predicted))
        if positive_predicted
        else 0.0
    )

    if len(model_points) >= 2:
        first_date, last_date = model_points[0][0], model_points[-1][0]
        total_days_span = (last_date - first_date).days
    else:
        total_days_span = 0

    if total_days_span > 0 and recent_spent > 0:
        historical_daily = recent_spent / total_days_span
        historical_monthly = historical_daily * 30.42
    else:
        historical_daily = 0.0
        historical_monthly = 0.0

    if model_monthly > 0 and model_monthly >= historical_monthly * 0.3:
        avg_monthly = model_monthly
    elif historical_monthly > 0:
        avg_monthly = historical_monthly
    else:
        avg_monthly = 0.0

    daily_burn = avg_monthly / 30.42 if avg_monthly > 0 else 0.0
    base["daily_burn_rate"] = round(daily_burn, 2)
    base["monthly_burn_rate"] = round(avg_monthly, 2)
    base["gm11_quality"] = round(gm_result["avg_rel_error"], 2)
    base["r_squared"] = None
    base["model_type"] = "gm_markov"
    base["model_label"] = "GM(1,1)+Markov（月累计）"

    exhaustion_date = None
    days_remaining = None
    pred_line = []
    if daily_burn <= 0.01:
        base["status"] = "normal"
        base["trend"] = "stable"
        base["days_remaining"] = 9999
        base["predicted_exhaustion_date"] = "短期内不会耗尽"
    else:
        last_date = points[-1][0]
        found = False
        for index, increment in enumerate(adjusted_predicted):
            if increment <= 0:
                continue
            month_date = _add_months(last_date, index + 1)
            cumulative_predicted = spent + sum(adjusted_predicted[:index + 1])
            previous_cumulative = spent + sum(adjusted_predicted[:index]) if index > 0 else spent
            display_cumulative = max(cumulative_predicted, previous_cumulative + 0.01)
            pred_line.append({
                "date": month_date.strftime("%Y-%m-%d"),
                "amount": round(display_cumulative, 2),
            })
            if not found and display_cumulative >= budget:
                exhaustion_date = month_date
                days_remaining = (exhaustion_date - datetime.now()).days
                found = True

        if not found and adjusted_predicted:
            if daily_burn > 0.001:
                total_days = int(remaining / daily_burn)
                exhaustion_date = datetime.now() + timedelta(days=total_days)
                days_remaining = total_days
            else:
                days_remaining = 9999

        base["days_remaining"] = days_remaining
        base["predicted_exhaustion_date"] = (
            exhaustion_date.strftime("%Y-%m-%d") if exhaustion_date else "短期内不会耗尽"
        )
        base["prediction_line"] = pred_line
        if days_remaining is not None:
            if days_remaining <= 0:
                base["status"] = "exhausted"
            elif days_remaining <= 30:
                base["status"] = "critical"
            elif days_remaining <= 90:
                base["status"] = "warning"
            else:
                base["status"] = "normal"

    a = gm_result.get("a", 0)
    if a > 0.01:
        base["trend"] = "increasing"
    elif a < -0.01:
        base["trend"] = "decreasing"
    else:
        base["trend"] = "stable"

    base["cumulative_data"] = [
        {"date": dt.strftime("%Y-%m-%d"), "amount": round(amt, 2), "type": "actual"}
        for dt, amt in points
    ] + [
        {"date": point["date"], "amount": round(point["amount"], 2), "type": "predicted"}
        for point in pred_line
    ]
    return base


def _fallback_linear_v2(
    points: list[tuple[datetime, float]],
    budget: float,
    spent: float,
    remaining: float,
    recent_spent: float,
    base: dict,
) -> dict:
    if len(points) < 2:
        base["status"] = "insufficient_data"
        base["model_type"] = "insufficient"
        base["model_label"] = "数据不足"
        base["cumulative_data"] = [
            {"date": dt.strftime("%Y-%m-%d"), "amount": round(amt, 2), "type": "actual"}
            for dt, amt in points
        ]
        return base

    x_vals = [(dt - points[0][0]).days for dt, _ in points]
    y_vals = [amt for _, amt in points]
    n_pts = len(x_vals)
    sum_x = sum(x_vals)
    sum_y = sum(y_vals)
    sum_xy = sum(x * y for x, y in zip(x_vals, y_vals))
    sum_x2 = sum(x * x for x in x_vals)
    denom = n_pts * sum_x2 - sum_x * sum_x
    slope = 0.0 if abs(denom) < 1e-12 else (n_pts * sum_xy - sum_x * sum_y) / denom

    y_mean = sum_y / n_pts
    intercept = (sum_y - slope * sum_x) / n_pts
    ss_res = sum((y - (slope * x + intercept)) ** 2 for x, y in zip(x_vals, y_vals))
    ss_tot = sum((y - y_mean) ** 2 for y in y_vals)
    r2 = 1 - (ss_res / ss_tot) if ss_tot > 0 else 0

    total_days_span = (points[-1][0] - points[0][0]).days if len(points) >= 2 else 0
    if total_days_span > 0 and recent_spent > 0:
        historical_daily = recent_spent / total_days_span
    else:
        historical_daily = 0.0

    if slope > 0.01:
        daily_burn = slope
    elif historical_daily > 0:
        daily_burn = historical_daily
    else:
        daily_burn = 0.001
    monthly_burn = daily_burn * 30.42

    base["daily_burn_rate"] = round(daily_burn, 2)
    base["monthly_burn_rate"] = round(monthly_burn, 2)
    base["r_squared"] = round(r2, 4)
    base["model_type"] = "linear_fallback"
    base["model_label"] = "线性趋势估算（月累计）"

    if slope > 0.01:
        base["trend"] = "increasing"
    elif slope < -0.01:
        base["trend"] = "decreasing"
    else:
        base["trend"] = "stable"

    if remaining <= 0:
        base["status"] = "exhausted"
        base["days_remaining"] = 0
        base["predicted_exhaustion_date"] = datetime.now().strftime("%Y-%m-%d")
    else:
        days = int(remaining / daily_burn) if daily_burn > 0 else 9999
        base["days_remaining"] = days
        if days <= 30:
            base["status"] = "critical"
        elif days <= 90:
            base["status"] = "warning"
        else:
            base["status"] = "normal"
        base["predicted_exhaustion_date"] = (
            (datetime.now() + timedelta(days=days)).strftime("%Y-%m-%d")
            if days < 9999
            else "短期内不会耗尽"
        )

    cum_data = [
        {"date": dt.strftime("%Y-%m-%d"), "amount": round(amt, 2), "type": "actual"}
        for dt, amt in points
    ]
    if slope > 0 and remaining > 0 and points:
        last_dt, last_amt = points[-1]
        pred_line = []
        for step in range(1, 13):
            future_dt = _add_months(last_dt, step)
            future_amt = last_amt + monthly_burn * step
            pred_line.append({
                "date": future_dt.strftime("%Y-%m-%d"),
                "amount": round(future_amt, 2),
            })
            cum_data.append({
                "date": future_dt.strftime("%Y-%m-%d"),
                "amount": round(future_amt, 2),
                "type": "predicted",
            })
        base["prediction_line"] = pred_line

    base["cumulative_data"] = cum_data
    return base
