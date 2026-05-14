from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
# 🚀 1. 在这里导入 auth 路由
from app.routers import invoices, settings, reimbursements, auth, admin, notifications, projects, bank_cards, applications, approval_rules, borrowings, reason_categories, ws, carbon, audit_trail, observability

from app.config import get_settings
from app.routers import health, invoices, settings as settings_router
from app.rate_limit import limiter
from app.models.user import User

settings = get_settings()

app = FastAPI(
    title="智能报销财务系统",
    description="智能报销财务系统 API - 发票上传、解析、报销管理",
    version="1.0.0",
)

# Add rate limiter to app state
app.state.limiter = limiter


# Custom rate limit exceeded handler with Chinese message
@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={"detail": f"请求过于频繁，请稍后再试。限制: {exc.detail}"}
    )


# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:15173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(health.router, prefix="/api", tags=["Health"])
app.include_router(invoices.router, prefix="/api/invoices", tags=["Invoices"])

app.include_router(
    reimbursements.router,
    prefix="/api/reimbursements",
    tags=["reimbursements"]
)

app.include_router(settings_router.router, prefix="/api/settings", tags=["Settings"])

# 🚀 2. 在这里挂载 auth 路由（和其他路由保持阵型一致）
app.include_router(auth.router, prefix="/api/auth", tags=["Auth"])
app.include_router(admin.router, prefix="/api/admin", tags=["Admin"])
app.include_router(notifications.router, prefix="/api/notifications", tags=["Notifications"])
app.include_router(projects.router, prefix="/api/projects", tags=["Projects"])
app.include_router(bank_cards.router, prefix="/api/bank-cards", tags=["BankCards"])
app.include_router(applications.router, prefix="/api/applications", tags=["Applications"])
app.include_router(approval_rules.router, prefix="/api/approval-rules", tags=["ApprovalRules"])
app.include_router(borrowings.router, prefix="/api/borrowings", tags=["Borrowings"])
app.include_router(reason_categories.router, prefix="/api/reason-categories", tags=["ReasonCategories"])
app.include_router(ws.router, prefix="/ws", tags=["WebSocket"])
app.include_router(carbon.router, tags=["Carbon"])
app.include_router(audit_trail.router, tags=["Audit"])
app.include_router(observability.router, tags=["Observability"])


# 🚀 3. 终极改造：系统冷启动时自动建表 + 植入超级管理员
@app.on_event("startup")
async def startup():
    from app.database import engine, Base
    from app.models.user import User
    from app.routers.auth import hash_password
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import AsyncSession

    # 1. 自动同步建表 + 补齐缺失列 + 数据迁移
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        from sqlalchemy import text

        # --- 补齐缺失的列 ---
        migration_sqls = [
            "ALTER TABLE reimbursements ADD COLUMN IF NOT EXISTS ai_review_detail JSONB",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS department VARCHAR(100)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS signature TEXT",
            # 借款申请表
            "CREATE TABLE IF NOT EXISTS borrowings ("
            " id SERIAL PRIMARY KEY,"
            " user_id INTEGER REFERENCES users(id),"
            " title VARCHAR(255) NOT NULL,"
            " estimated_amount NUMERIC(12,2) NOT NULL,"
            " expected_repayment_date DATE,"
            " status VARCHAR(20) NOT NULL DEFAULT '待审批',"
            " reject_reason VARCHAR(500),"
            " approved_by INTEGER REFERENCES users(id),"
            " reimbursement_id INTEGER REFERENCES reimbursements(id),"
            " repaid_amount NUMERIC(12,2),"
            " created_at TIMESTAMP DEFAULT NOW(),"
            " updated_at TIMESTAMP DEFAULT NOW()"
            ")",
            "ALTER TABLE reimbursements ADD COLUMN IF NOT EXISTS review_note TEXT",
            # bank_cards 表
            "CREATE TABLE IF NOT EXISTS bank_cards ("
            " id SERIAL PRIMARY KEY,"
            " user_id INTEGER REFERENCES users(id),"
            " bank_name VARCHAR(100) NOT NULL,"
            " account_name VARCHAR(50) NOT NULL,"
            " card_number VARCHAR(30) NOT NULL,"
            " is_default BOOLEAN DEFAULT FALSE,"
            " created_at TIMESTAMP DEFAULT NOW()"
            ")",
            "ALTER TABLE reimbursements ADD COLUMN IF NOT EXISTS bank_card_id INTEGER REFERENCES bank_cards(id)",
            "ALTER TABLE reimbursements ADD COLUMN IF NOT EXISTS application_id INTEGER REFERENCES applications(id)",
            # 动态审批规则表
            "CREATE TABLE IF NOT EXISTS approval_rules ("
            " id SERIAL PRIMARY KEY,"
            " name VARCHAR(100) NOT NULL,"
            " entity_type VARCHAR(50) NOT NULL DEFAULT 'reimbursement',"
            " priority INTEGER NOT NULL DEFAULT 100,"
            " conditions JSONB NOT NULL DEFAULT '{}',"
            " action VARCHAR(50) NOT NULL DEFAULT 'NONE',"
            " is_active BOOLEAN DEFAULT TRUE,"
            " created_at TIMESTAMP DEFAULT NOW()"
            ")",
            # 模拟银企直联打款字段
            "ALTER TABLE reimbursements ADD COLUMN IF NOT EXISTS payment_transaction_id VARCHAR(64)",
            "ALTER TABLE reimbursements ADD COLUMN IF NOT EXISTS payment_time TIMESTAMP",
            "ALTER TABLE reimbursements ADD COLUMN IF NOT EXISTS payment_bank VARCHAR(100)",
            # 申请单关联项目
            "ALTER TABLE borrowings ADD COLUMN IF NOT EXISTS application_id INTEGER REFERENCES applications(id)",
            "ALTER TABLE reimbursements ADD COLUMN IF NOT EXISTS borrowing_id INTEGER REFERENCES borrowings(id)",
            "ALTER TABLE applications ADD COLUMN IF NOT EXISTS project_code VARCHAR(100)",
            # applications 表
            "CREATE TABLE IF NOT EXISTS applications ("
            " id SERIAL PRIMARY KEY,"
            " user_id INTEGER REFERENCES users(id),"
            " title VARCHAR(255) NOT NULL,"
            " description TEXT,"
            " estimated_amount NUMERIC(12,2) DEFAULT 0,"
            " status VARCHAR(20) DEFAULT 'SUBMITTED',"
            " approved_by INTEGER REFERENCES users(id),"
            " reject_reason TEXT,"
            " created_at TIMESTAMP DEFAULT NOW(),"
            " updated_at TIMESTAMP DEFAULT NOW()"
            ")",
            # notifications 表（create_all 会处理，这里兜底）
            "CREATE TABLE IF NOT EXISTS notifications ("
            " id SERIAL PRIMARY KEY,"
            " user_id INTEGER REFERENCES users(id),"
            " title VARCHAR(255) NOT NULL,"
            " message TEXT,"
            " is_read BOOLEAN DEFAULT FALSE,"
            " entity_type VARCHAR(50),"
            " entity_id INTEGER,"
            " created_at TIMESTAMP DEFAULT NOW()"
            ")",
            # 外键迁移：新列
            "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_hash VARCHAR(64)",
            "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS spend_category VARCHAR(50)",
            "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS carbon_kg NUMERIC(10,4)",
            "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS green_points INTEGER DEFAULT 0",
            "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS ground_truth JSONB",
            "ALTER TABLE reimbursements ADD COLUMN IF NOT EXISTS carbon_kg NUMERIC(10,4)",
            "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id)",
            "ALTER TABLE reimbursements ADD COLUMN IF NOT EXISTS submitter_id INTEGER REFERENCES users(id)",
            # 银行卡余额
            "ALTER TABLE bank_cards ADD COLUMN IF NOT EXISTS balance NUMERIC(12,2) DEFAULT 0",
            # 事由类别字典表
            "CREATE TABLE IF NOT EXISTS reason_categories ("
            " id SERIAL PRIMARY KEY,"
            " name VARCHAR(255) NOT NULL UNIQUE,"
            " sort_order INTEGER DEFAULT 0,"
            " is_active BOOLEAN DEFAULT TRUE,"
            " created_at TIMESTAMP DEFAULT NOW()"
            ")",
            # 三张表补齐 reason_category_id 外键列
            "ALTER TABLE applications ADD COLUMN IF NOT EXISTS reason_category_id INTEGER REFERENCES reason_categories(id)",
            "ALTER TABLE borrowings ADD COLUMN IF NOT EXISTS reason_category_id INTEGER REFERENCES reason_categories(id)",
            "ALTER TABLE reimbursements ADD COLUMN IF NOT EXISTS reason_category_id INTEGER REFERENCES reason_categories(id)",
            # AI 引擎调用日志表
            "CREATE TABLE IF NOT EXISTS ai_call_logs ("
            " id SERIAL PRIMARY KEY,"
            " invoice_id INTEGER REFERENCES invoices(id),"
            " engine VARCHAR(10) NOT NULL,"
            " status VARCHAR(20) NOT NULL,"
            " duration_ms INTEGER NOT NULL,"
            " request_id VARCHAR(36) NOT NULL,"
            " error_message TEXT,"
            " created_at TIMESTAMP DEFAULT NOW()"
            ")",
            # 交易流水表
            "CREATE TABLE IF NOT EXISTS transactions ("
            " id SERIAL PRIMARY KEY,"
            " type VARCHAR(20) NOT NULL,"
            " amount NUMERIC(12,2) NOT NULL,"
            " bank_card_id INTEGER REFERENCES bank_cards(id),"
            " borrowing_id INTEGER REFERENCES borrowings(id),"
            " reimbursement_id INTEGER REFERENCES reimbursements(id),"
            " balance_before NUMERIC(12,2) NOT NULL,"
            " balance_after NUMERIC(12,2) NOT NULL,"
            " note VARCHAR(300),"
            " created_at TIMESTAMP DEFAULT NOW()"
            ")",
        ]
        for sql in migration_sqls:
            try:
                await conn.execute(text(sql))
            except Exception:
                pass

        # --- 数据迁移：旧字符串列 → 新外键列 ---
        data_migration_sqls = [
            "UPDATE invoices SET owner_id = u.id FROM users u WHERE u.username = invoices.owner AND invoices.owner_id IS NULL",
            "UPDATE reimbursements SET submitter_id = u.id FROM users u WHERE u.username = reimbursements.submitter AND reimbursements.submitter_id IS NULL",
        ]
        for sql in data_migration_sqls:
            try:
                result = await conn.execute(text(sql))
                if result.rowcount and result.rowcount > 0:
                    print(f"✅ 数据迁移 ({result.rowcount} 行): {sql[:80]}...")
            except Exception as e:
                print(f"⚠️ 迁移跳过: {e}")

        # --- 植入默认审批规则 ---
        try:
            existing = await conn.execute(text("SELECT COUNT(*) FROM approval_rules"))
            if existing.scalar() == 0:
                import json as _json
                default_rule = _json.dumps({
                    "operator": "AND",
                    "rules": [
                        {"field": "total_amount", "op": "<", "value": 500},
                        {"field": "ai_risk_level", "op": "in", "value": ["低风险"]},
                    ]
                })
                await conn.execute(text(
                    "INSERT INTO approval_rules (name, entity_type, priority, conditions, action, is_active) "
                    "VALUES (:name, :entity_type, :priority, :conditions::jsonb, :action, :is_active)"
                ), {
                    "name": "小额低风险秒批",
                    "entity_type": "reimbursement",
                    "priority": 1,
                    "conditions": default_rule,
                    "action": "AUTO_APPROVE",
                    "is_active": True,
                })
                print("✅ 已植入默认规则：小额低风险秒批")
        except Exception as e:
            print(f"⚠️ 默认规则跳过: {e}")

        # --- 修复 + 植入默认事由类别 ---
        try:
            # 修复已存在但 is_active 为 NULL 的记录
            await conn.execute(text(
                "UPDATE reason_categories SET is_active = TRUE WHERE is_active IS NULL"
            ))
            existing = await conn.execute(text("SELECT COUNT(*) FROM reason_categories"))
            if existing.scalar() == 0:
                categories = [
                    ("差旅费", 1), ("办公用品采购", 2), ("会议费", 3),
                    ("招待费", 4), ("培训费", 5), ("交通费", 6),
                    ("印刷费", 7), ("通讯费", 8), ("设备采购", 9),
                    ("设备维修", 10), ("其他费用", 11),
                ]
                for name, sort_order in categories:
                    await conn.execute(text(
                        "INSERT INTO reason_categories (name, sort_order, is_active) VALUES (:name, :sort_order, TRUE)"
                    ), {"name": name, "sort_order": sort_order})
                print("✅ 已植入默认事由类别（10 条）")
        except Exception as e:
            print(f"⚠️ 默认事由类别跳过: {e}")

    # 2. 自动检查并创建初始超级管理员
    async with AsyncSession(engine) as db:
        try:
            # 去数据库里找有没有叫 admin 的人
            query = select(User).where(User.username == "admin")
            result = await db.execute(query)
            admin_user = result.scalar_one_or_none()

            # 如果没有，系统就自己造一个！
            if not admin_user:
                print("======================================================")
                print("🛠️ 检测到无管理员账号，系统正在自动创建超级管理员...")
                new_admin = User(
                    username="admin",
                    password_hash=hash_password("admin123"),  # 初始密码
                    role="admin",
                    full_name="财务总监"
                )
                db.add(new_admin)
                await db.commit()
                print("✅ 超级管理员创建成功！")
                print("👉 登录账号: admin")
                print("👉 登录密码: admin123")
                print("======================================================")
        except Exception as e:
            print(f"创建管理员账号时出现异常: {e}")


@app.get("/")
async def root():
    return {"message": "发票管理系统 API", "version": "1.0.0"}