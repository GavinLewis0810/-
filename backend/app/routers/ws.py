import asyncio
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

from app.routers.auth import _session_store
from app.services.ws_manager import ws_manager

logger = logging.getLogger(__name__)
router = APIRouter()


@router.websocket("/notify")
async def ws_notify(ws: WebSocket, token: str = Query(...)):
    """WebSocket 通知端点。客户端通过 ?token=xxx 认证。"""
    # 验证 token
    user = _session_store.get(token)
    print(f"[WS] token={token[:12]}... store_keys={len(_session_store)} found={user is not None}")
    if not user:
        await ws.close(code=4001, reason="会话已过期")
        return

    user_id: int = user["id"]
    await ws_manager.connect(user_id, ws)

    try:
        # 心跳：每 30 秒 ping，60 秒无 pong 则断开
        while True:
            try:
                await asyncio.wait_for(ws.receive_text(), timeout=30)
                # 收到客户端消息（客户端可发 ping 或 ignore）
            except asyncio.TimeoutError:
                # 30 秒没收到消息 → 发 ping
                try:
                    await ws.send_text('{"type":"ping"}')
                except Exception:
                    break
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.warning(f"WebSocket 异常: user_id={user_id}, {e}")
    finally:
        ws_manager.disconnect(user_id, ws)
