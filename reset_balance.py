import asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

async def main():
    engine = create_async_engine('postgresql+asyncpg://postgres:Gai20040810@localhost:5432/invoice_manager')
    async with engine.begin() as conn:
        result = await conn.execute(text(
            "UPDATE bank_cards SET balance = 0 "
            "FROM users "
            "WHERE bank_cards.user_id = users.id "
            "AND users.username = 'Gavin'"
        ))
        print(f'Updated {result.rowcount} card(s)')
    await engine.dispose()

asyncio.run(main())
